use super::{label_pattern_from_cols, label_pattern_to_cols};
use crate::{
    domain::category::{Category, CategoryColor, CategoryFields, CategoryIcon, CategoryRule},
    error::{AppError, AppResult},
};
use sqlx::{PgConnection, PgPool, Row, postgres::PgRow};
use std::collections::HashMap;
use uuid::Uuid;

const COLUMNS: &str = "id, user_id, name, color, icon, net_totals, created_at";

/// Data access interface for categories.
#[cfg_attr(test, mockall::automock)]
pub trait CategoryRepository: Send + Sync + 'static {
    /// All categories of a user with their rules, by name.
    fn list(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<Category>>> + Send;

    /// Number of categories a user has.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// Whether the category exists and belongs to the user.
    fn exists(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Create a category and its rules. Returns `AppError::Conflict` if the user already has one by that name.
    fn create(
        &self,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> impl std::future::Future<Output = AppResult<Category>> + Send;

    /// Replace a category's fields and rules. Returns `None` if it does not exist or belongs to another
    /// user, `AppError::Conflict` if the new name is taken.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> impl std::future::Future<Output = AppResult<Option<Category>>> + Send;

    /// Delete a category, leaving what used it uncategorized. Returns `false` if it does not
    /// exist or belongs to another user.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;
}

/// PostgreSQL-backed category repository.
#[derive(Clone)]
pub struct PgCategoryRepository {
    pool: PgPool,
}

impl PgCategoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn row_to_category(row: &PgRow, rules: Vec<CategoryRule>) -> AppResult<Category> {
    let color: &str = row.try_get("color")?;
    let icon: Option<&str> = row.try_get("icon")?;
    Ok(Category {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: CategoryFields {
            name: row.try_get("name")?,
            color: color.parse::<CategoryColor>().map_err(AppError::Internal)?,
            icon: icon
                .map(str::parse::<CategoryIcon>)
                .transpose()
                .map_err(AppError::Internal)?,
            net_totals: row.try_get("net_totals")?,
            rules,
        },
        created_at: row.try_get("created_at")?,
    })
}

fn map_name_conflict(e: sqlx::Error, name: &str) -> AppError {
    match e {
        sqlx::Error::Database(ref db) if db.constraint() == Some("categories_user_name_key") => {
            AppError::Conflict(format!("category '{name}' already exists"))
        }
        other => AppError::Database(other),
    }
}

async fn insert_rules(
    conn: &mut PgConnection,
    category_id: Uuid,
    rules: &[CategoryRule],
) -> AppResult<()> {
    for (position, rule) in (0_i32..).zip(rules) {
        let (pattern_type, pattern_value) = label_pattern_to_cols(&rule.label_pattern);
        sqlx::query(
            "INSERT INTO category_rules (category_id, position, pattern_type, pattern_value) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(category_id)
        .bind(position)
        .bind(pattern_type)
        .bind(pattern_value)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

impl CategoryRepository for PgCategoryRepository {
    async fn list(&self, user_id: Uuid) -> AppResult<Vec<Category>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLUMNS} FROM categories WHERE user_id = $1 ORDER BY name"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let rule_rows = sqlx::query(
            "SELECT r.category_id, r.pattern_type, r.pattern_value FROM category_rules r \
             JOIN categories c ON c.id = r.category_id \
             WHERE c.user_id = $1 ORDER BY r.position",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let mut rules: HashMap<Uuid, Vec<CategoryRule>> = HashMap::new();
        for row in &rule_rows {
            rules
                .entry(row.try_get("category_id")?)
                .or_default()
                .push(CategoryRule {
                    label_pattern: label_pattern_from_cols(
                        row.try_get("pattern_type")?,
                        row.try_get("pattern_value")?,
                    )?,
                });
        }
        rows.iter()
            .map(|row| {
                let id: Uuid = row.try_get("id")?;
                row_to_category(row, rules.remove(&id).unwrap_or_default())
            })
            .collect()
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM categories WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("n")?)
    }

    async fn exists(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id = $1 AND user_id = $2) AS found",
        )
        .bind(id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("found")?)
    }

    async fn create(&self, user_id: Uuid, fields: &CategoryFields) -> AppResult<Category> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(&format!(
            "INSERT INTO categories (user_id, name, color, icon, net_totals) \
             VALUES ($1, $2, $3, $4, $5) RETURNING {COLUMNS}"
        ))
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.color.as_str())
        .bind(fields.icon.as_ref().map(CategoryIcon::as_str))
        .bind(fields.net_totals)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        let category = row_to_category(&row, fields.rules.clone())?;
        insert_rules(&mut tx, category.id, &fields.rules).await?;
        tx.commit().await?;
        Ok(category)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> AppResult<Option<Category>> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(&format!(
            "UPDATE categories SET name = $3, color = $4, icon = $5, net_totals = $6 \
             WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
        ))
        .bind(id)
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.color.as_str())
        .bind(fields.icon.as_ref().map(CategoryIcon::as_str))
        .bind(fields.net_totals)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        let Some(row) = row else {
            return Ok(None);
        };
        sqlx::query("DELETE FROM category_rules WHERE category_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        insert_rules(&mut tx, id, &fields.rules).await?;
        tx.commit().await?;
        row_to_category(&row, fields.rules.clone()).map(Some)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM categories WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{budget::LabelPattern, user::UserRole},
        repositories::{PgUserRepository, UserRepository},
    };

    async fn make_user(pool: &PgPool, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        PgUserRepository::new(pool.clone())
            .create(id, username, "hash", UserRole::User)
            .await
            .unwrap();
        id
    }

    fn fields(name: &str) -> CategoryFields {
        CategoryFields {
            name: name.to_string(),
            color: "#12b886".parse::<CategoryColor>().unwrap(),
            icon: None,
            net_totals: false,
            rules: Vec::new(),
        }
    }

    fn rule(pattern: LabelPattern) -> CategoryRule {
        CategoryRule {
            label_pattern: pattern,
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_then_list_per_user_by_name(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);

        let transport = repo.create(alice, &fields("Transport")).await.unwrap();
        let food = repo.create(alice, &fields("Food")).await.unwrap();

        assert_eq!(transport.fields, fields("Transport"));
        assert_eq!(repo.list(alice).await.unwrap(), [food, transport]);
        assert_eq!(repo.count(alice).await.unwrap(), 2);
        assert!(repo.list(bob).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn duplicate_name_is_a_conflict_per_user(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);

        repo.create(alice, &fields("Food")).await.unwrap();

        assert!(matches!(
            repo.create(alice, &fields("Food")).await,
            Err(AppError::Conflict(_))
        ));
        repo.create(bob, &fields("Food")).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn exists_and_update_are_scoped_to_the_owner(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);
        let created = repo.create(alice, &fields("Food")).await.unwrap();
        let changed = CategoryFields {
            name: "Groceries".to_string(),
            color: "#fd7e14".parse::<CategoryColor>().unwrap(),
            icon: Some(CategoryIcon::Cart),
            net_totals: true,
            rules: Vec::new(),
        };

        assert!(repo.exists(created.id, alice).await.unwrap());
        assert!(!repo.exists(created.id, bob).await.unwrap());
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
        let cleared = repo
            .update(created.id, alice, &fields("Groceries"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cleared.fields.icon, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_own_category_only(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);
        let created = repo.create(alice, &fields("Food")).await.unwrap();

        assert!(!repo.delete(created.id, bob).await.unwrap());
        assert!(repo.delete(created.id, alice).await.unwrap());
        assert!(!repo.delete(created.id, alice).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn rules_are_stored_in_order_and_replaced(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let repo = PgCategoryRepository::new(pool);
        let with_rules = CategoryFields {
            rules: vec![
                rule(LabelPattern::Contains("CARREFOUR".to_string())),
                rule(LabelPattern::StartsWith("CB BIOCOOP".to_string())),
                rule(LabelPattern::EndsWith("LECLERC".to_string())),
            ],
            ..fields("Groceries")
        };

        let created = repo.create(alice, &with_rules).await.unwrap();
        repo.create(alice, &fields("Food")).await.unwrap();

        assert_eq!(created.fields, with_rules);
        let listed = repo.list(alice).await.unwrap();
        assert_eq!(listed[0].fields.rules, []);
        assert_eq!(listed[1].fields, with_rules);

        let fewer = CategoryFields {
            rules: vec![rule(LabelPattern::Contains("LIDL".to_string()))],
            ..fields("Groceries")
        };
        repo.update(created.id, alice, &fewer).await.unwrap();
        assert_eq!(repo.list(alice).await.unwrap()[1].fields, fewer);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn failed_create_writes_no_rules(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let repo = PgCategoryRepository::new(pool.clone());
        repo.create(alice, &fields("Food")).await.unwrap();
        let duplicate = CategoryFields {
            rules: vec![rule(LabelPattern::Contains("LIDL".to_string()))],
            ..fields("Food")
        };

        assert!(repo.create(alice, &duplicate).await.is_err());
        let row = sqlx::query("SELECT COUNT(*) AS n FROM category_rules")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<i64, _>("n"), 0);
    }
}
