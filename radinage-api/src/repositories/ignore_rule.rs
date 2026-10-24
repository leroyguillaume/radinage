use crate::{
    domain::ignore_rule::{IgnoreRule, IgnoreRuleFields},
    error::AppResult,
    repositories::{label_pattern_from_cols, label_pattern_to_cols},
};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

const COLUMNS: &str = "id, user_id, pattern_type, pattern_value, amount, created_at";

/// Data access interface for ignore rules.
#[cfg_attr(test, mockall::automock)]
pub trait IgnoreRuleRepository: Send + Sync + 'static {
    /// All ignore rules of a user, oldest first: the order they are tried in.
    fn list(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<IgnoreRule>>> + Send;

    /// Number of ignore rules a user has.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// The rule, or `None` if it does not exist or belongs to another user.
    fn find_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Option<IgnoreRule>>> + Send;

    fn create(
        &self,
        user_id: Uuid,
        fields: &IgnoreRuleFields,
    ) -> impl std::future::Future<Output = AppResult<IgnoreRule>> + Send;

    /// Replace a rule's fields, leaving the operations it already ignored as they are.
    /// Returns `None` if it does not exist or belongs to another user.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &IgnoreRuleFields,
    ) -> impl std::future::Future<Output = AppResult<Option<IgnoreRule>>> + Send;

    /// Delete a rule and stop ignoring the operations it ignored. Returns `false` if it does
    /// not exist or belongs to another user.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;
}

/// PostgreSQL-backed ignore rule repository.
#[derive(Clone)]
pub struct PgIgnoreRuleRepository {
    pool: PgPool,
}

impl PgIgnoreRuleRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn row_to_rule(row: &PgRow) -> AppResult<IgnoreRule> {
    let pattern_type: &str = row.try_get("pattern_type")?;
    Ok(IgnoreRule {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: IgnoreRuleFields {
            label_pattern: label_pattern_from_cols(pattern_type, row.try_get("pattern_value")?)?,
            amount: row.try_get("amount")?,
        },
        created_at: row.try_get("created_at")?,
    })
}

impl IgnoreRuleRepository for PgIgnoreRuleRepository {
    async fn list(&self, user_id: Uuid) -> AppResult<Vec<IgnoreRule>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLUMNS} FROM ignore_rules WHERE user_id = $1 ORDER BY created_at, id"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_rule).collect()
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM ignore_rules WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("n")?)
    }

    async fn find_by_id(&self, id: Uuid, user_id: Uuid) -> AppResult<Option<IgnoreRule>> {
        let row = sqlx::query(&format!(
            "SELECT {COLUMNS} FROM ignore_rules WHERE id = $1 AND user_id = $2"
        ))
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_rule).transpose()
    }

    async fn create(&self, user_id: Uuid, fields: &IgnoreRuleFields) -> AppResult<IgnoreRule> {
        let (pattern_type, pattern_value) = label_pattern_to_cols(&fields.label_pattern);
        let row = sqlx::query(&format!(
            "INSERT INTO ignore_rules (user_id, pattern_type, pattern_value, amount) \
             VALUES ($1, $2, $3, $4) RETURNING {COLUMNS}"
        ))
        .bind(user_id)
        .bind(pattern_type)
        .bind(pattern_value)
        .bind(fields.amount)
        .fetch_one(&self.pool)
        .await?;
        row_to_rule(&row)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &IgnoreRuleFields,
    ) -> AppResult<Option<IgnoreRule>> {
        let (pattern_type, pattern_value) = label_pattern_to_cols(&fields.label_pattern);
        let row = sqlx::query(&format!(
            "UPDATE ignore_rules SET pattern_type = $3, pattern_value = $4, amount = $5 \
             WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
        ))
        .bind(id)
        .bind(user_id)
        .bind(pattern_type)
        .bind(pattern_value)
        .bind(fields.amount)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_rule).transpose()
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE operations SET ignored = FALSE, ignore_rule_id = NULL \
             WHERE ignore_rule_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        let deleted = sqlx::query("DELETE FROM ignore_rules WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            > 0;
        tx.commit().await?;
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{budget::LabelPattern, user::UserRole},
        repositories::{
            OperationRepository, PgOperationRepository, PgUserRepository, UserRepository,
        },
    };
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;

    async fn make_user(pool: &PgPool, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        PgUserRepository::new(pool.clone())
            .create(id, username, "hash", UserRole::User)
            .await
            .unwrap();
        id
    }

    fn contains(value: &str) -> IgnoreRuleFields {
        IgnoreRuleFields {
            label_pattern: LabelPattern::Contains(value.to_string()),
            amount: None,
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_then_list_per_user_oldest_first(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgIgnoreRuleRepository::new(pool);
        let with_amount = IgnoreRuleFields {
            label_pattern: LabelPattern::StartsWith("REMB".to_string()),
            amount: Some(dec!(250)),
        };

        let first = repo.create(alice, &contains("VIR INTERNE")).await.unwrap();
        let second = repo.create(alice, &with_amount).await.unwrap();

        assert_eq!(second.fields, with_amount);
        assert_eq!(repo.list(alice).await.unwrap(), [first, second]);
        assert_eq!(repo.count(alice).await.unwrap(), 2);
        assert!(repo.list(bob).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_and_update_are_scoped_to_the_owner(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgIgnoreRuleRepository::new(pool);
        let created = repo.create(alice, &contains("VIR")).await.unwrap();
        let changed = IgnoreRuleFields {
            label_pattern: LabelPattern::EndsWith("LIVRET".to_string()),
            amount: Some(dec!(12.5)),
        };

        assert!(repo.find_by_id(created.id, bob).await.unwrap().is_none());
        assert!(
            repo.update(created.id, bob, &changed)
                .await
                .unwrap()
                .is_none()
        );
        let updated = repo
            .update(created.id, alice, &changed)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.fields, changed);
        assert_eq!(
            repo.find_by_id(created.id, alice).await.unwrap(),
            Some(updated)
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_stops_ignoring_only_what_the_rule_ignored(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgIgnoreRuleRepository::new(pool.clone());
        let ops = PgOperationRepository::new(pool);
        let rule = repo.create(alice, &contains("VIR")).await.unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let by_rule = Uuid::new_v4();
        let by_hand = Uuid::new_v4();
        for id in [by_rule, by_hand] {
            ops.insert(id, alice, dec!(-10), date, None, "VIR")
                .await
                .unwrap();
        }
        ops.ignore_by_rule(by_rule, rule.id).await.unwrap();
        ops.set_ignored(by_hand, alice, true).await.unwrap();

        assert!(!repo.delete(rule.id, bob).await.unwrap());
        assert!(ops.find_by_id(by_rule, alice).await.unwrap().ignored);

        assert!(repo.delete(rule.id, alice).await.unwrap());
        let freed = ops.find_by_id(by_rule, alice).await.unwrap();
        assert!(!freed.ignored);
        assert_eq!(freed.ignore_rule_id, None);
        assert!(ops.find_by_id(by_hand, alice).await.unwrap().ignored);
        assert!(!repo.delete(rule.id, alice).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_rule_never_overrides_how_an_operation_is_already_ignored(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let repo = PgIgnoreRuleRepository::new(pool.clone());
        let ops = PgOperationRepository::new(pool);
        let first = repo.create(alice, &contains("VIR")).await.unwrap();
        let second = repo.create(alice, &contains("VIR INTERNE")).await.unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let (by_hand, by_rule) = (Uuid::new_v4(), Uuid::new_v4());
        for id in [by_hand, by_rule] {
            ops.insert(id, alice, dec!(-10), date, None, "VIR INTERNE")
                .await
                .unwrap();
        }
        ops.set_ignored(by_hand, alice, true).await.unwrap();
        ops.ignore_by_rule(by_rule, first.id).await.unwrap();

        ops.ignore_by_rule(by_hand, second.id).await.unwrap();
        ops.ignore_by_rule(by_rule, second.id).await.unwrap();

        assert_eq!(
            ops.find_by_id(by_hand, alice).await.unwrap().ignore_rule_id,
            None
        );
        assert_eq!(
            ops.find_by_id(by_rule, alice).await.unwrap().ignore_rule_id,
            Some(first.id)
        );

        ops.set_ignored(by_rule, alice, true).await.unwrap();
        let now_by_hand = ops.find_by_id(by_rule, alice).await.unwrap();
        assert!(now_by_hand.ignored);
        assert_eq!(now_by_hand.ignore_rule_id, None);
    }
}
