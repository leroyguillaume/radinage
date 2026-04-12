use crate::{
    domain::operation::{BudgetLink, Operation},
    error::{AppError, AppResult},
    repositories::SortOrder,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::Deserialize;
use sqlx::{PgPool, Row};
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

/// A single row returned by the monthly-summary query.
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

    /// Fetch operation rows for the monthly summary, joining budget type from the budgets table.
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
    })
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

        row_to_operation(&row)
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
        let ops = rows
            .iter()
            .map(row_to_operation)
            .collect::<AppResult<Vec<_>>>()?;

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
            "UPDATE operations SET budget_link_type = 'auto', budget_link_id = $1 WHERE id = $2",
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

        rows.iter().map(row_to_operation).collect()
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
