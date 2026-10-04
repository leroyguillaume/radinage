use crate::{
    domain::operation::{BudgetLink, NewOperationSplit, Operation, OperationSplit},
    error::{AppError, AppResult},
    repositories::SortOrder,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::Deserialize;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use uuid::Uuid;

/// Sort field for operation listings.
#[derive(Debug, Deserialize, Clone, Copy, Default, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum OperationSortField {
    /// Sort by operation date (default).
    #[default]
    Date,
    /// Sort alphabetically by label.
    Label,
    /// Sort by amount.
    Amount,
}

impl OperationSortField {
    pub fn as_sql(&self) -> &'static str {
        match self {
            Self::Date => "COALESCE(effective_date, date)",
            Self::Label => "label",
            Self::Amount => "amount",
        }
    }
}

/// Parameters for a paginated, filtered, sorted list of operations.
pub struct ListOperationsParams {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    /// Label filter already formatted as `%pattern%` for SQL LIKE.
    pub label_filter: Option<String>,
    pub amount: Option<Decimal>,
    pub sort: OperationSortField,
    pub order: SortOrder,
    pub limit: i64,
    pub offset: i64,
    /// When false (default), ignored operations are excluded from results.
    pub include_ignored: bool,
}

/// A single row returned by the monthly-summary query: an unsplit operation, or one split
/// part reported as `manual` when it has a budget and `unlinked` otherwise.
pub struct SummaryRow {
    pub amount: Decimal,
    pub budget_link_type: String,
    pub budget_type: Option<String>,
}

/// Data access interface for operations.
#[cfg_attr(test, mockall::automock)]
pub trait OperationRepository: Send + Sync + 'static {
    /// Fetch a single operation by id, scoped to the given user.
    fn find_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Operation>> + Send;

    /// List operations with filtering and pagination. Returns `(rows, total_count)`.
    fn list(
        &self,
        user_id: Uuid,
        params: &ListOperationsParams,
    ) -> impl std::future::Future<Output = AppResult<(Vec<Operation>, i64)>> + Send;

    /// Insert a new operation row. The budget link starts as `Unlinked`.
    fn insert(
        &self,
        id: Uuid,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        effective_date: Option<NaiveDate>,
        label: &str,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Update an existing operation's fields. Returns `true` if found, `false` if not.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        effective_date: Option<NaiveDate>,
        label: &str,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Delete an operation. Returns `true` if found, `false` if not.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Set the budget link on an operation scoped to the given user.
    /// Returns `true` if found, `false` if not.
    fn set_budget_link(
        &self,
        id: Uuid,
        user_id: Uuid,
        link: &BudgetLink,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Set an auto budget link without a user-id check (used internally by the matcher).
    /// Split operations are left untouched.
    fn set_auto_link(
        &self,
        op_id: Uuid,
        budget_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Fetch all operations belonging to a user (no pagination).
    fn list_all_for_user(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<Operation>>> + Send;

    /// Set or clear the ignored flag on an operation. Returns `true` if found.
    fn set_ignored(
        &self,
        id: Uuid,
        user_id: Uuid,
        ignored: bool,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Check whether an operation with the same (user_id, date, label, amount) already exists.
    fn exists_by_fields(
        &self,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        label: &str,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Atomically replace an operation's splits and reset its own budget link to unlinked.
    /// Returns `true` if found, `false` if not.
    fn replace_splits(
        &self,
        id: Uuid,
        user_id: Uuid,
        splits: &[NewOperationSplit],
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Remove all splits of an operation. Returns `true` if found, `false` if not.
    fn clear_splits(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Fetch amounts for the monthly summary, joining budget type from the budgets table.
    /// A split operation yields one row per split instead of a row for itself.
    fn list_for_summary(
        &self,
        user_id: Uuid,
        month_start: NaiveDate,
        month_end: NaiveDate,
    ) -> impl std::future::Future<Output = AppResult<Vec<SummaryRow>>> + Send;
}

/// PostgreSQL-backed operation repository.
#[derive(Clone)]
pub struct PgOperationRepository {
    pool: PgPool,
}

impl PgOperationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Build a `BudgetLink` from the raw database columns.
fn budget_link_from_cols(link_type: &str, budget_id: Option<Uuid>) -> BudgetLink {
    match link_type {
        "manual" => BudgetLink::Manual {
            budget_id: budget_id.unwrap_or_default(),
        },
        "auto" => BudgetLink::Auto {
            budget_id: budget_id.unwrap_or_default(),
        },
        _ => BudgetLink::Unlinked,
    }
}

/// Map a database row to an `Operation`.
fn row_to_operation(row: &sqlx::postgres::PgRow) -> AppResult<Operation> {
    let link_type: &str = row.try_get("budget_link_type").unwrap_or("unlinked");
    let link_id: Option<Uuid> = row.try_get("budget_link_id").unwrap_or(None);
    Ok(Operation {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        amount: row.try_get("amount")?,
        date: row.try_get("date")?,
        effective_date: row.try_get("effective_date").unwrap_or(None),
        label: row.try_get("label")?,
        budget_link: budget_link_from_cols(link_type, link_id),
        ignored: row.try_get("ignored").unwrap_or(false),
        splits: Vec::new(),
    })
}

/// Fill in the splits of the given operations with a single query.
async fn attach_splits(pool: &PgPool, ops: &mut [Operation]) -> AppResult<()> {
    if ops.is_empty() {
        return Ok(());
    }
    let ids: Vec<Uuid> = ops.iter().map(|op| op.id).collect();
    let rows = sqlx::query(
        "SELECT id, operation_id, amount, budget_id FROM operation_splits
         WHERE operation_id = ANY($1) ORDER BY operation_id, position",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    let mut by_operation: HashMap<Uuid, Vec<OperationSplit>> = HashMap::new();
    for row in &rows {
        by_operation
            .entry(row.try_get("operation_id")?)
            .or_default()
            .push(OperationSplit {
                id: row.try_get("id")?,
                amount: row.try_get("amount")?,
                budget_id: row.try_get("budget_id")?,
            });
    }
    for op in ops {
        if let Some(splits) = by_operation.remove(&op.id) {
            op.splits = splits;
        }
    }
    Ok(())
}

impl OperationRepository for PgOperationRepository {
    async fn find_by_id(&self, id: Uuid, user_id: Uuid) -> AppResult<Operation> {
        let row = sqlx::query(
            "SELECT id, user_id, amount, date, effective_date, label, budget_link_type, budget_link_id, ignored
             FROM operations WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;

        let mut ops = [row_to_operation(&row)?];
        attach_splits(&self.pool, &mut ops).await?;
        let [op] = ops;
        Ok(op)
    }

    async fn list(
        &self,
        user_id: Uuid,
        params: &ListOperationsParams,
    ) -> AppResult<(Vec<Operation>, i64)> {
        let ignored_filter = if params.include_ignored {
            ""
        } else {
            "AND ignored = FALSE"
        };
        let sql = format!(
            r#"SELECT id, user_id, amount, date, effective_date, label, budget_link_type, budget_link_id, ignored
               FROM operations
               WHERE user_id = $1
                 AND ($2::date IS NULL OR COALESCE(effective_date, date) >= $2)
                 AND ($3::date IS NULL OR COALESCE(effective_date, date) <= $3)
                 AND ($4::text IS NULL OR LOWER(label) LIKE $4)
                 AND ($5::numeric IS NULL OR amount = $5)
                 {ignored_filter}
               ORDER BY {sort_col} {sort_dir}, id DESC
               LIMIT $6 OFFSET $7"#,
            sort_col = params.sort.as_sql(),
            sort_dir = params.order.as_sql(),
        );

        let rows = sqlx::query(&sql)
            .bind(user_id)
            .bind(params.date_from)
            .bind(params.date_to)
            .bind(params.label_filter.as_deref())
            .bind(params.amount)
            .bind(params.limit)
            .bind(params.offset)
            .fetch_all(&self.pool)
            .await?;

        let count_sql = format!(
            r#"SELECT COUNT(*) AS count
               FROM operations
               WHERE user_id = $1
                 AND ($2::date IS NULL OR COALESCE(effective_date, date) >= $2)
                 AND ($3::date IS NULL OR COALESCE(effective_date, date) <= $3)
                 AND ($4::text IS NULL OR LOWER(label) LIKE $4)
                 AND ($5::numeric IS NULL OR amount = $5)
                 {ignored_filter}"#,
        );
        let count_row = sqlx::query(&count_sql)
            .bind(user_id)
            .bind(params.date_from)
            .bind(params.date_to)
            .bind(params.label_filter.as_deref())
            .bind(params.amount)
            .fetch_one(&self.pool)
            .await?;

        let total: i64 = count_row.try_get("count")?;
        let mut ops = rows
            .iter()
            .map(row_to_operation)
            .collect::<AppResult<Vec<_>>>()?;
        attach_splits(&self.pool, &mut ops).await?;

        Ok((ops, total))
    }

    async fn insert(
        &self,
        id: Uuid,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        effective_date: Option<NaiveDate>,
        label: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO operations (id, user_id, amount, date, effective_date, label) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(id)
        .bind(user_id)
        .bind(amount)
        .bind(date)
        .bind(effective_date)
        .bind(label)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        effective_date: Option<NaiveDate>,
        label: &str,
    ) -> AppResult<bool> {
        let affected = sqlx::query(
            "UPDATE operations SET amount = $1, date = $2, effective_date = $3, label = $4
             WHERE id = $5 AND user_id = $6",
        )
        .bind(amount)
        .bind(date)
        .bind(effective_date)
        .bind(label)
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let affected = sqlx::query("DELETE FROM operations WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(affected > 0)
    }

    async fn set_budget_link(&self, id: Uuid, user_id: Uuid, link: &BudgetLink) -> AppResult<bool> {
        let (link_type, link_id) = budget_link_to_cols(link);
        let affected = sqlx::query(
            "UPDATE operations SET budget_link_type = $1, budget_link_id = $2
             WHERE id = $3 AND user_id = $4",
        )
        .bind(link_type)
        .bind(link_id)
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    async fn set_auto_link(&self, op_id: Uuid, budget_id: Uuid) -> AppResult<()> {
        sqlx::query(
            "UPDATE operations SET budget_link_type = 'auto', budget_link_id = $1
             WHERE id = $2
               AND NOT EXISTS (SELECT 1 FROM operation_splits WHERE operation_id = $2)",
        )
        .bind(budget_id)
        .bind(op_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_all_for_user(&self, user_id: Uuid) -> AppResult<Vec<Operation>> {
        let rows = sqlx::query(
            "SELECT id, user_id, amount, date, effective_date, label, budget_link_type, budget_link_id, ignored
             FROM operations WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let mut ops = rows
            .iter()
            .map(row_to_operation)
            .collect::<AppResult<Vec<_>>>()?;
        attach_splits(&self.pool, &mut ops).await?;
        Ok(ops)
    }

    async fn set_ignored(&self, id: Uuid, user_id: Uuid, ignored: bool) -> AppResult<bool> {
        let affected =
            sqlx::query("UPDATE operations SET ignored = $1 WHERE id = $2 AND user_id = $3")
                .bind(ignored)
                .bind(id)
                .bind(user_id)
                .execute(&self.pool)
                .await?
                .rows_affected();
        Ok(affected > 0)
    }

    async fn exists_by_fields(
        &self,
        user_id: Uuid,
        amount: Decimal,
        date: NaiveDate,
        label: &str,
    ) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT EXISTS(SELECT 1 FROM operations WHERE user_id = $1 AND amount = $2 AND date = $3 AND label = $4) AS found",
        )
        .bind(user_id)
        .bind(amount)
        .bind(date)
        .bind(label)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("found")?)
    }

    async fn replace_splits(
        &self,
        id: Uuid,
        user_id: Uuid,
        splits: &[NewOperationSplit],
    ) -> AppResult<bool> {
        let mut tx = self.pool.begin().await?;
        // Locking the row serialises concurrent replacements of the same operation's splits.
        let found = sqlx::query(
            "UPDATE operations SET budget_link_type = 'unlinked', budget_link_id = NULL
             WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            > 0;
        if !found {
            return Ok(false);
        }

        sqlx::query("DELETE FROM operation_splits WHERE operation_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for (position, split) in (0_i32..).zip(splits) {
            sqlx::query(
                "INSERT INTO operation_splits (operation_id, position, amount, budget_id)
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(id)
            .bind(position)
            .bind(split.amount)
            .bind(split.budget_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    async fn clear_splits(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let row = sqlx::query(
            "WITH owned AS (SELECT id FROM operations WHERE id = $1 AND user_id = $2),
                  removed AS (
                      DELETE FROM operation_splits
                      WHERE operation_id IN (SELECT id FROM owned)
                  )
             SELECT EXISTS(SELECT 1 FROM owned) AS found",
        )
        .bind(id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("found")?)
    }

    async fn list_for_summary(
        &self,
        user_id: Uuid,
        month_start: NaiveDate,
        month_end: NaiveDate,
    ) -> AppResult<Vec<SummaryRow>> {
        let rows = sqlx::query(
            r#"SELECT o.amount, o.budget_link_type, b.budget_type
               FROM operations o
               LEFT JOIN budgets b ON b.id = o.budget_link_id
               WHERE o.user_id = $1
                 AND COALESCE(o.effective_date, o.date) >= $2
                 AND COALESCE(o.effective_date, o.date) <= $3
                 AND o.ignored = FALSE
                 AND NOT EXISTS (SELECT 1 FROM operation_splits s WHERE s.operation_id = o.id)
               UNION ALL
               SELECT s.amount,
                      CASE WHEN s.budget_id IS NULL THEN 'unlinked' ELSE 'manual' END,
                      b.budget_type
               FROM operation_splits s
               JOIN operations o ON o.id = s.operation_id
               LEFT JOIN budgets b ON b.id = s.budget_id
               WHERE o.user_id = $1
                 AND COALESCE(o.effective_date, o.date) >= $2
                 AND COALESCE(o.effective_date, o.date) <= $3
                 AND o.ignored = FALSE"#,
        )
        .bind(user_id)
        .bind(month_start)
        .bind(month_end)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| SummaryRow {
                amount: r.try_get("amount").unwrap_or(Decimal::ZERO),
                budget_link_type: r
                    .try_get::<&str, _>("budget_link_type")
                    .unwrap_or("unlinked")
                    .to_string(),
                budget_type: r
                    .try_get::<Option<String>, _>("budget_type")
                    .unwrap_or(None),
            })
            .collect())
    }
}

/// Convert a `BudgetLink` to the (link_type, link_id) pair stored in the database.
fn budget_link_to_cols(link: &BudgetLink) -> (&'static str, Option<Uuid>) {
    match link {
        BudgetLink::Unlinked => ("unlinked", None),
        BudgetLink::Manual { budget_id } => ("manual", Some(*budget_id)),
        BudgetLink::Auto { budget_id } => ("auto", Some(*budget_id)),
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn budget_link_from_cols_unlinked() {
        assert_eq!(
            budget_link_from_cols("unlinked", None),
            BudgetLink::Unlinked
        );
    }

    #[test]
    fn budget_link_from_cols_unknown_defaults_to_unlinked() {
        assert_eq!(budget_link_from_cols("other", None), BudgetLink::Unlinked);
    }

    #[test]
    fn budget_link_from_cols_manual() {
        let id = Uuid::new_v4();
        assert_eq!(
            budget_link_from_cols("manual", Some(id)),
            BudgetLink::Manual { budget_id: id }
        );
    }

    #[test]
    fn budget_link_from_cols_auto() {
        let id = Uuid::new_v4();
        assert_eq!(
            budget_link_from_cols("auto", Some(id)),
            BudgetLink::Auto { budget_id: id }
        );
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use rust_decimal_macros::dec;
    use sqlx::PgPool;

    async fn setup_user(pool: &PgPool) -> Uuid {
        let user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, 'user')",
        )
        .bind(user_id)
        .bind(format!("user_{user_id}"))
        .bind("hash")
        .execute(pool)
        .await
        .unwrap();
        user_id
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn insert_and_find_by_id(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let op_id = Uuid::new_v4();

        repo.insert(
            op_id,
            user_id,
            dec!(-50),
            NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            None,
            "Groceries",
        )
        .await
        .unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.id, op_id);
        assert_eq!(op.label, "Groceries");
        assert_eq!(op.amount, dec!(-50));
        assert_eq!(op.budget_link, BudgetLink::Unlinked);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_by_id_wrong_user_returns_not_found(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let other_user_id = setup_user(&pool).await;
        let op_id = Uuid::new_v4();

        repo.insert(
            op_id,
            user_id,
            dec!(-10),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            None,
            "Test",
        )
        .await
        .unwrap();

        let err = repo.find_by_id(op_id, other_user_id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_operation(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let op_id = Uuid::new_v4();

        repo.insert(
            op_id,
            user_id,
            dec!(-100),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            None,
            "Original",
        )
        .await
        .unwrap();

        let found = repo
            .update(
                op_id,
                user_id,
                dec!(-200),
                NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
                None,
                "Updated",
            )
            .await
            .unwrap();
        assert!(found);

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.label, "Updated");
        assert_eq!(op.amount, dec!(-200));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_nonexistent_returns_false(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let found = repo
            .update(
                Uuid::new_v4(),
                user_id,
                dec!(-10),
                NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
                None,
                "X",
            )
            .await
            .unwrap();
        assert!(!found);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_operation(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let op_id = Uuid::new_v4();

        repo.insert(
            op_id,
            user_id,
            dec!(-50),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            None,
            "ToDelete",
        )
        .await
        .unwrap();

        assert!(repo.delete(op_id, user_id).await.unwrap());
        assert!(!repo.delete(op_id, user_id).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_with_pagination(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        for i in 0..5i32 {
            repo.insert(
                Uuid::new_v4(),
                user_id,
                Decimal::from(i),
                NaiveDate::from_ymd_opt(2024, 1, i as u32 + 1).unwrap(),
                None,
                &format!("Op {i}"),
            )
            .await
            .unwrap();
        }

        let params = ListOperationsParams {
            date_from: None,
            date_to: None,
            label_filter: None,
            amount: None,
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 2,
            offset: 0,
            include_ignored: false,
        };

        let (ops, total) = repo.list(user_id, &params).await.unwrap();
        assert_eq!(total, 5);
        assert_eq!(ops.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_sorts_by_effective_date_when_present(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        // Op A: date Jan 10, no effective_date → sorting key = Jan 10
        let id_a = Uuid::new_v4();
        repo.insert(
            id_a,
            user_id,
            dec!(-10),
            NaiveDate::from_ymd_opt(2024, 1, 10).unwrap(),
            None,
            "A",
        )
        .await
        .unwrap();

        // Op B: date Jan 5, effective_date Jan 20 → sorting key = Jan 20
        let id_b = Uuid::new_v4();
        repo.insert(
            id_b,
            user_id,
            dec!(-20),
            NaiveDate::from_ymd_opt(2024, 1, 5).unwrap(),
            Some(NaiveDate::from_ymd_opt(2024, 1, 20).unwrap()),
            "B",
        )
        .await
        .unwrap();

        // Op C: date Jan 15, no effective_date → sorting key = Jan 15
        let id_c = Uuid::new_v4();
        repo.insert(
            id_c,
            user_id,
            dec!(-30),
            NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            None,
            "C",
        )
        .await
        .unwrap();

        let params = ListOperationsParams {
            date_from: None,
            date_to: None,
            label_filter: None,
            amount: None,
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 10,
            offset: 0,
            include_ignored: false,
        };

        let (ops, _) = repo.list(user_id, &params).await.unwrap();
        assert_eq!(ops.len(), 3);
        // Ascending by COALESCE(effective_date, date): A (Jan 10), C (Jan 15), B (Jan 20)
        assert_eq!(ops[0].id, id_a);
        assert_eq!(ops[1].id, id_c);
        assert_eq!(ops[2].id, id_b);
    }

    async fn setup_budget(pool: &PgPool, user_id: Uuid, budget_type: &str) -> Uuid {
        let budget_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO budgets (id, user_id, label, budget_type, kind_type) VALUES ($1, $2, $3, $4, 'occasional')",
        )
        .bind(budget_id)
        .bind(user_id)
        .bind(format!("budget_{budget_id}"))
        .bind(budget_type)
        .execute(pool)
        .await
        .unwrap();
        budget_id
    }

    async fn insert_op(repo: &PgOperationRepository, user_id: Uuid, amount: Decimal) -> Uuid {
        let op_id = Uuid::new_v4();
        repo.insert(
            op_id,
            user_id,
            amount,
            NaiveDate::from_ymd_opt(2024, 3, 10).unwrap(),
            None,
            "Cash withdrawal",
        )
        .await
        .unwrap();
        op_id
    }

    fn part(amount: Decimal, budget_id: Option<Uuid>) -> NewOperationSplit {
        NewOperationSplit { amount, budget_id }
    }

    fn split_amounts(op: &Operation) -> Vec<(Decimal, Option<Uuid>)> {
        op.splits.iter().map(|s| (s.amount, s.budget_id)).collect()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn replace_splits_stores_parts_in_order_and_unlinks(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;
        repo.set_budget_link(op_id, user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();

        let parts = [
            part(dec!(-30), Some(budget_id)),
            part(dec!(-30), None),
            part(dec!(-40), Some(budget_id)),
        ];
        assert!(repo.replace_splits(op_id, user_id, &parts).await.unwrap());

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.budget_link, BudgetLink::Unlinked);
        assert_eq!(
            split_amounts(&op),
            vec![
                (dec!(-30), Some(budget_id)),
                (dec!(-30), None),
                (dec!(-40), Some(budget_id)),
            ]
        );

        let replacement = [part(dec!(-99.5), None), part(dec!(-0.5), Some(budget_id))];
        assert!(
            repo.replace_splits(op_id, user_id, &replacement)
                .await
                .unwrap()
        );
        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(
            split_amounts(&op),
            vec![(dec!(-99.5), None), (dec!(-0.5), Some(budget_id))]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn replace_splits_of_other_users_operation_returns_false(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let other_user_id = setup_user(&pool).await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;

        let parts = [part(dec!(-50), None), part(dec!(-50), None)];
        assert!(
            !repo
                .replace_splits(op_id, other_user_id, &parts)
                .await
                .unwrap()
        );
        assert!(
            repo.find_by_id(op_id, user_id)
                .await
                .unwrap()
                .splits
                .is_empty()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn clear_splits_removes_parts_and_is_idempotent(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let other_user_id = setup_user(&pool).await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [part(dec!(-50), None), part(dec!(-50), None)];
        repo.replace_splits(op_id, user_id, &parts).await.unwrap();

        assert!(!repo.clear_splits(op_id, other_user_id).await.unwrap());
        assert!(repo.find_by_id(op_id, user_id).await.unwrap().is_split());

        assert!(repo.clear_splits(op_id, user_id).await.unwrap());
        assert!(!repo.find_by_id(op_id, user_id).await.unwrap().is_split());
        assert!(repo.clear_splits(op_id, user_id).await.unwrap());
        assert!(!repo.clear_splits(Uuid::new_v4(), user_id).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn splits_are_listed_with_their_operations(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let split_id = insert_op(&repo, user_id, dec!(-100)).await;
        let plain_id = insert_op(&repo, user_id, dec!(-5)).await;
        let parts = [part(dec!(-60), None), part(dec!(-40), None)];
        repo.replace_splits(split_id, user_id, &parts)
            .await
            .unwrap();

        let all = repo.list_all_for_user(user_id).await.unwrap();
        let split = all.iter().find(|op| op.id == split_id).unwrap();
        let plain = all.iter().find(|op| op.id == plain_id).unwrap();
        assert_eq!(
            split_amounts(split),
            vec![(dec!(-60), None), (dec!(-40), None)]
        );
        assert!(plain.splits.is_empty());

        let params = ListOperationsParams {
            date_from: None,
            date_to: None,
            label_filter: None,
            amount: Some(dec!(-100)),
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 10,
            offset: 0,
            include_ignored: false,
        };
        let (ops, _) = repo.list(user_id, &params).await.unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].splits.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn deleting_a_budget_unassigns_its_split_parts(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [part(dec!(-60), Some(budget_id)), part(dec!(-40), None)];
        repo.replace_splits(op_id, user_id, &parts).await.unwrap();

        sqlx::query("DELETE FROM budgets WHERE id = $1")
            .bind(budget_id)
            .execute(&pool)
            .await
            .unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(
            split_amounts(&op),
            vec![(dec!(-60), None), (dec!(-40), None)]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_auto_link_leaves_split_operations_alone(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [part(dec!(-50), None), part(dec!(-50), None)];
        repo.replace_splits(op_id, user_id, &parts).await.unwrap();

        repo.set_auto_link(op_id, budget_id).await.unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.budget_link, BudgetLink::Unlinked);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_for_summary_counts_split_parts_instead_of_their_operation(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let expense_id = setup_budget(&pool, user_id, "expense").await;
        let savings_id = setup_budget(&pool, user_id, "savings").await;

        let plain_id = insert_op(&repo, user_id, dec!(-7)).await;
        repo.set_budget_link(
            plain_id,
            user_id,
            &BudgetLink::Manual {
                budget_id: expense_id,
            },
        )
        .await
        .unwrap();
        let split_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [
            part(dec!(-30), Some(expense_id)),
            part(dec!(-25), Some(savings_id)),
            part(dec!(-45), None),
        ];
        repo.replace_splits(split_id, user_id, &parts)
            .await
            .unwrap();
        let ignored_id = insert_op(&repo, user_id, dec!(-80)).await;
        let ignored_parts = [part(dec!(-40), Some(expense_id)), part(dec!(-40), None)];
        repo.replace_splits(ignored_id, user_id, &ignored_parts)
            .await
            .unwrap();
        repo.set_ignored(ignored_id, user_id, true).await.unwrap();

        let mut rows: Vec<(Decimal, String, Option<String>)> = repo
            .list_for_summary(
                user_id,
                NaiveDate::from_ymd_opt(2024, 3, 1).unwrap(),
                NaiveDate::from_ymd_opt(2024, 3, 31).unwrap(),
            )
            .await
            .unwrap()
            .into_iter()
            .map(|r| (r.amount, r.budget_link_type, r.budget_type))
            .collect();
        rows.sort();

        assert_eq!(
            rows,
            vec![
                (dec!(-45), "unlinked".to_string(), None),
                (dec!(-30), "manual".to_string(), Some("expense".to_string())),
                (dec!(-25), "manual".to_string(), Some("savings".to_string())),
                (dec!(-7), "manual".to_string(), Some("expense".to_string())),
            ]
        );

        let outside = repo
            .list_for_summary(
                user_id,
                NaiveDate::from_ymd_opt(2024, 4, 1).unwrap(),
                NaiveDate::from_ymd_opt(2024, 4, 30).unwrap(),
            )
            .await
            .unwrap();
        assert!(outside.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_auto_link_updates_row(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let op_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();

        // Insert a dummy budget so the FK is satisfied
        sqlx::query(
            "INSERT INTO budgets (id, user_id, label, budget_type, kind_type) VALUES ($1,$2,'B','expense','occasional')",
        )
        .bind(budget_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

        repo.insert(
            op_id,
            user_id,
            dec!(-10),
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            None,
            "Op",
        )
        .await
        .unwrap();

        repo.set_auto_link(op_id, budget_id).await.unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.budget_link, BudgetLink::Auto { budget_id });
    }
}
