use crate::{
    domain::{
        budget::BudgetType,
        operation::{BudgetLink, NewOperationSplit, Operation, OperationSplit},
    },
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
            Self::Date => "COALESCE(o.effective_date, o.date)",
            Self::Label => "o.label",
            Self::Amount => "o.amount",
        }
    }
}

/// Parameters for a paginated, filtered, sorted list of operations.
#[derive(Debug, Default)]
pub struct ListOperationsParams {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    /// Label filter already formatted as `%pattern%` for SQL LIKE.
    pub label_filter: Option<String>,
    pub amount: Option<Decimal>,
    /// Inclusive lower bound on the absolute amount.
    pub amount_min: Option<Decimal>,
    /// Inclusive upper bound on the absolute amount.
    pub amount_max: Option<Decimal>,
    pub direction: Option<OperationDirection>,
    pub sort: OperationSortField,
    pub order: SortOrder,
    pub limit: i64,
    pub offset: i64,
    /// When false (default), ignored operations are excluded from results.
    pub include_ignored: bool,
    pub category: CategoryFilter,
    /// When not empty, keeps the operations linked to one of these budgets, a split operation
    /// through any of its parts.
    pub budget_ids: Vec<Uuid>,
}

/// Which categories the operations listed must count towards: an unsplit operation through
/// its effective category, a split one through any of its parts. Empty means no filter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CategoryFilter {
    pub category_ids: Vec<Uuid>,
    /// Also keeps the operations, or parts, without an effective category.
    pub uncategorized: bool,
}

impl CategoryFilter {
    fn is_empty(&self) -> bool {
        self.category_ids.is_empty() && !self.uncategorized
    }
}

/// Sign of the operations listed.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum OperationDirection {
    /// Negative amounts.
    Expense,
    /// Positive amounts.
    Income,
}

/// Aggregates over every operation matching a listing's filters, across all pages.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OperationTotals {
    pub count: i64,
    /// Sum of the positive amounts.
    pub income: Decimal,
    /// Sum of the negative amounts.
    pub expense: Decimal,
    /// Earliest accounting date, `None` when nothing matches.
    pub first_date: Option<NaiveDate>,
    /// Latest accounting date, `None` when nothing matches.
    pub last_date: Option<NaiveDate>,
}

/// Non-ignored amounts of one effective category over a date range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CategoryTotal {
    /// `None` for amounts without a category.
    pub category_id: Option<Uuid>,
    /// Sum of the positive amounts.
    pub income: Decimal,
    /// Sum of the negative amounts.
    pub expense: Decimal,
}

/// A single row returned by the monthly-summary query: an unsplit operation, or one split
/// part reported as `manual` when it has a budget and `unlinked` otherwise.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryRow {
    pub amount: Decimal,
    /// Accounting date of the operation (its effective date if set, otherwise its date).
    pub date: NaiveDate,
    pub budget_link_type: String,
    /// Budget the operation (or split part) counts towards, if any.
    pub budget_id: Option<Uuid>,
    pub budget_type: Option<String>,
}

/// Where a summary row's amount is accounted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SummaryCategory {
    /// Not linked to any budget, or linked to a budget whose type is unknown.
    Unbudgeted,
    /// Linked to a budget of the given type.
    Budgeted(BudgetType),
}

impl SummaryRow {
    /// Category of this row, `None` for a link type the summary does not count.
    pub fn category(&self) -> Option<SummaryCategory> {
        match self.budget_link_type.as_str() {
            "unlinked" => Some(SummaryCategory::Unbudgeted),
            "manual" | "auto" => Some(
                self.budget_type
                    .as_deref()
                    .and_then(|s| s.parse::<BudgetType>().ok())
                    .map_or(SummaryCategory::Unbudgeted, SummaryCategory::Budgeted),
            ),
            _ => None,
        }
    }
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

    /// List operations with filtering and pagination, with the totals of every match.
    fn list(
        &self,
        user_id: Uuid,
        params: &ListOperationsParams,
    ) -> impl std::future::Future<Output = AppResult<(Vec<Operation>, OperationTotals)>> + Send;

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

    /// Set or clear the category of an operation scoped to the given user.
    /// Returns `true` if found, `false` if not.
    fn set_category(
        &self,
        id: Uuid,
        user_id: Uuid,
        category_id: Option<Uuid>,
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

    /// Mark a not yet ignored operation as ignored by the rule; one already ignored keeps how
    /// it was.
    fn ignore_by_rule(
        &self,
        op_id: Uuid,
        rule_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Set or clear the ignored flag on an operation, by hand: it no longer records a rule.
    /// Returns `true` if found.
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

    /// Atomically replace an operation's splits and reset its own budget link to unlinked and
    /// its own category to none.
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

    /// Fetch the non-ignored amounts whose accounting date falls in `[month_start, month_end]`,
    /// joining budget type from the budgets table. A split operation yields one row per split
    /// instead of a row for itself. Backs both the summary and the forecast.
    fn list_for_summary(
        &self,
        user_id: Uuid,
        month_start: NaiveDate,
        month_end: NaiveDate,
    ) -> impl std::future::Future<Output = AppResult<Vec<SummaryRow>>> + Send;

    /// Totals per effective category of the non-ignored amounts whose accounting date falls in
    /// `[from, to]`, a split operation counting through its parts. Amounts linked to a savings
    /// budget are left out: they are neither income nor expenses.
    fn category_totals(
        &self,
        user_id: Uuid,
        from: NaiveDate,
        to: NaiveDate,
    ) -> impl std::future::Future<Output = AppResult<Vec<CategoryTotal>>> + Send;
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

/// Columns read into an [`Operation`], from `operations o`.
const OPERATION_COLUMNS: &str = "o.id, o.user_id, o.amount, o.date, o.effective_date, o.label, \
     o.budget_link_type, o.budget_link_id, o.ignored, o.ignore_rule_id, o.category_id, \
     (SELECT b.category_id FROM budgets b WHERE b.id = o.budget_link_id) AS budget_category_id";

/// Effective category of an unsplit operation `o`.
const OPERATION_CATEGORY: &str = "COALESCE(o.category_id, \
     (SELECT b.category_id FROM budgets b WHERE b.id = o.budget_link_id))";

/// Effective category of a split part `s`.
const SPLIT_CATEGORY: &str =
    "COALESCE(s.category_id, (SELECT b.category_id FROM budgets b WHERE b.id = s.budget_id))";

/// `AND` clause keeping an unsplit operation `o` whose `operation_test` holds, and a split one
/// with a part `s` whose `split_test` holds.
fn whole_or_any_part(operation_test: &str, split_test: &str) -> String {
    format!(
        "AND CASE WHEN EXISTS (SELECT 1 FROM operation_splits s WHERE s.operation_id = o.id)
             THEN EXISTS (SELECT 1 FROM operation_splits s
                          WHERE s.operation_id = o.id AND {split_test})
             ELSE {operation_test}
         END"
    )
}

/// Filters shared by the listing and its totals, binding `$1` to `$9` as [`bind_list_filters`]
/// does.
fn list_filters_sql(params: &ListOperationsParams) -> String {
    let ignored = if params.include_ignored {
        ""
    } else {
        "AND o.ignored = FALSE"
    };
    let direction = match params.direction {
        None => "",
        Some(OperationDirection::Expense) => "AND o.amount < 0",
        Some(OperationDirection::Income) => "AND o.amount > 0",
    };
    let category = if params.category.is_empty() {
        String::new()
    } else {
        let test = |expr: &str| {
            let null = if params.category.uncategorized {
                format!(" OR {expr} IS NULL")
            } else {
                String::new()
            };
            format!("({expr} = ANY($6){null})")
        };
        whole_or_any_part(&test(OPERATION_CATEGORY), &test(SPLIT_CATEGORY))
    };
    let budget = if params.budget_ids.is_empty() {
        String::new()
    } else {
        whole_or_any_part("o.budget_link_id = ANY($7)", "s.budget_id = ANY($7)")
    };
    format!(
        "WHERE o.user_id = $1
           AND ($2::date IS NULL OR COALESCE(o.effective_date, o.date) >= $2)
           AND ($3::date IS NULL OR COALESCE(o.effective_date, o.date) <= $3)
           AND ($4::text IS NULL OR LOWER(o.label) LIKE $4)
           AND ($5::numeric IS NULL OR o.amount = $5)
           AND ($8::numeric IS NULL OR ABS(o.amount) >= $8)
           AND ($9::numeric IS NULL OR ABS(o.amount) <= $9)
           {ignored}
           {direction}
           {category}
           {budget}"
    )
}

fn bind_list_filters<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    user_id: Uuid,
    params: &'q ListOperationsParams,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    query
        .bind(user_id)
        .bind(params.date_from)
        .bind(params.date_to)
        .bind(params.label_filter.as_deref())
        .bind(params.amount)
        .bind(&params.category.category_ids)
        .bind(&params.budget_ids)
        .bind(params.amount_min)
        .bind(params.amount_max)
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
        ignore_rule_id: row.try_get("ignore_rule_id")?,
        category_id: row.try_get("category_id")?,
        budget_category_id: row.try_get("budget_category_id")?,
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
        "SELECT s.id, s.operation_id, s.amount, s.budget_id, s.category_id,
                (SELECT b.category_id FROM budgets b WHERE b.id = s.budget_id) AS budget_category_id
         FROM operation_splits s
         WHERE s.operation_id = ANY($1) ORDER BY s.operation_id, s.position",
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
                category_id: row.try_get("category_id")?,
                budget_category_id: row.try_get("budget_category_id")?,
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
        let row = sqlx::query(&format!(
            "SELECT {OPERATION_COLUMNS} FROM operations o WHERE o.id = $1 AND o.user_id = $2"
        ))
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
    ) -> AppResult<(Vec<Operation>, OperationTotals)> {
        let filters = list_filters_sql(params);
        let sql = format!(
            "SELECT {OPERATION_COLUMNS} FROM operations o
             {filters}
             ORDER BY {sort_col} {sort_dir}, o.id DESC
             LIMIT $10 OFFSET $11",
            sort_col = params.sort.as_sql(),
            sort_dir = params.order.as_sql(),
        );
        let rows = bind_list_filters(sqlx::query(&sql), user_id, params)
            .bind(params.limit)
            .bind(params.offset)
            .fetch_all(&self.pool)
            .await?;

        let totals_sql = format!(
            "SELECT COUNT(*) AS count,
                    COALESCE(SUM(o.amount) FILTER (WHERE o.amount > 0), 0) AS income,
                    COALESCE(SUM(o.amount) FILTER (WHERE o.amount < 0), 0) AS expense,
                    MIN(COALESCE(o.effective_date, o.date)) AS first_date,
                    MAX(COALESCE(o.effective_date, o.date)) AS last_date
             FROM operations o {filters}"
        );
        let totals_row = bind_list_filters(sqlx::query(&totals_sql), user_id, params)
            .fetch_one(&self.pool)
            .await?;
        let totals = OperationTotals {
            count: totals_row.try_get("count")?,
            income: totals_row.try_get("income")?,
            expense: totals_row.try_get("expense")?,
            first_date: totals_row.try_get("first_date")?,
            last_date: totals_row.try_get("last_date")?,
        };

        let mut ops = rows
            .iter()
            .map(row_to_operation)
            .collect::<AppResult<Vec<_>>>()?;
        attach_splits(&self.pool, &mut ops).await?;

        Ok((ops, totals))
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

    async fn set_category(
        &self,
        id: Uuid,
        user_id: Uuid,
        category_id: Option<Uuid>,
    ) -> AppResult<bool> {
        let affected =
            sqlx::query("UPDATE operations SET category_id = $1 WHERE id = $2 AND user_id = $3")
                .bind(category_id)
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
        let rows = sqlx::query(&format!(
            "SELECT {OPERATION_COLUMNS} FROM operations o WHERE o.user_id = $1"
        ))
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

    async fn ignore_by_rule(&self, op_id: Uuid, rule_id: Uuid) -> AppResult<()> {
        sqlx::query(
            "UPDATE operations SET ignored = TRUE, ignore_rule_id = $2 \
             WHERE id = $1 AND ignored = FALSE",
        )
        .bind(op_id)
        .bind(rule_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn set_ignored(&self, id: Uuid, user_id: Uuid, ignored: bool) -> AppResult<bool> {
        let affected = sqlx::query(
            "UPDATE operations SET ignored = $1, ignore_rule_id = NULL \
                 WHERE id = $2 AND user_id = $3",
        )
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
            "UPDATE operations
             SET budget_link_type = 'unlinked', budget_link_id = NULL, category_id = NULL
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
                "INSERT INTO operation_splits (operation_id, position, amount, budget_id, category_id)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(id)
            .bind(position)
            .bind(split.amount)
            .bind(split.budget_id)
            .bind(split.category_id)
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
            r#"SELECT o.amount, COALESCE(o.effective_date, o.date) AS accounting_date,
                      o.budget_link_type, o.budget_link_id AS budget_id, b.budget_type
               FROM operations o
               LEFT JOIN budgets b ON b.id = o.budget_link_id
               WHERE o.user_id = $1
                 AND COALESCE(o.effective_date, o.date) >= $2
                 AND COALESCE(o.effective_date, o.date) <= $3
                 AND o.ignored = FALSE
                 AND NOT EXISTS (SELECT 1 FROM operation_splits s WHERE s.operation_id = o.id)
               UNION ALL
               SELECT s.amount, COALESCE(o.effective_date, o.date),
                      CASE WHEN s.budget_id IS NULL THEN 'unlinked' ELSE 'manual' END,
                      s.budget_id, b.budget_type
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
            .map(|r| {
                Ok(SummaryRow {
                    amount: r.try_get("amount")?,
                    date: r.try_get("accounting_date")?,
                    budget_link_type: r.try_get("budget_link_type")?,
                    budget_id: r.try_get("budget_id")?,
                    budget_type: r.try_get("budget_type")?,
                })
            })
            .collect::<Result<_, sqlx::Error>>()?)
    }

    async fn category_totals(
        &self,
        user_id: Uuid,
        from: NaiveDate,
        to: NaiveDate,
    ) -> AppResult<Vec<CategoryTotal>> {
        let rows = sqlx::query(&format!(
            "WITH amounts AS (
                 SELECT o.amount, {OPERATION_CATEGORY} AS category_id
                 FROM operations o
                 LEFT JOIN budgets b ON b.id = o.budget_link_id
                 WHERE o.user_id = $1
                   AND COALESCE(o.effective_date, o.date) BETWEEN $2 AND $3
                   AND o.ignored = FALSE
                   AND b.budget_type IS DISTINCT FROM 'savings'
                   AND NOT EXISTS (SELECT 1 FROM operation_splits s WHERE s.operation_id = o.id)
                 UNION ALL
                 SELECT s.amount, {SPLIT_CATEGORY}
                 FROM operation_splits s
                 JOIN operations o ON o.id = s.operation_id
                 LEFT JOIN budgets b ON b.id = s.budget_id
                 WHERE o.user_id = $1
                   AND COALESCE(o.effective_date, o.date) BETWEEN $2 AND $3
                   AND o.ignored = FALSE
                   AND b.budget_type IS DISTINCT FROM 'savings'
             )
             SELECT category_id,
                    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income,
                    COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) AS expense
             FROM amounts
             GROUP BY category_id
             ORDER BY expense, income DESC"
        ))
        .bind(user_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| {
                Ok(CategoryTotal {
                    category_id: r.try_get("category_id")?,
                    income: r.try_get("income")?,
                    expense: r.try_get("expense")?,
                })
            })
            .collect::<Result<_, sqlx::Error>>()?)
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
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 2,
            ..Default::default()
        };

        let (ops, totals) = repo.list(user_id, &params).await.unwrap();
        assert_eq!(totals.count, 5);
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
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 10,
            ..Default::default()
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
        NewOperationSplit {
            amount,
            budget_id,
            category_id: None,
        }
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
            amount: Some(dec!(-100)),
            sort: OperationSortField::Date,
            order: SortOrder::Asc,
            limit: 10,
            ..Default::default()
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
    async fn list_for_summary_reports_accounting_date_and_budget(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let expense_id = setup_budget(&pool, user_id, "expense").await;

        // Dated in February, accounted in March through its effective date.
        let deferred_id = Uuid::new_v4();
        repo.insert(
            deferred_id,
            user_id,
            dec!(-12),
            NaiveDate::from_ymd_opt(2024, 2, 28).unwrap(),
            NaiveDate::from_ymd_opt(2024, 3, 2),
            "Card",
        )
        .await
        .unwrap();
        repo.set_auto_link(deferred_id, expense_id).await.unwrap();
        let split_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [part(dec!(-60), Some(expense_id)), part(dec!(-40), None)];
        repo.replace_splits(split_id, user_id, &parts)
            .await
            .unwrap();

        let mut rows = repo
            .list_for_summary(
                user_id,
                NaiveDate::from_ymd_opt(2024, 3, 1).unwrap(),
                NaiveDate::from_ymd_opt(2024, 3, 31).unwrap(),
            )
            .await
            .unwrap();
        rows.sort_by_key(|r| r.amount);

        let march = |day| NaiveDate::from_ymd_opt(2024, 3, day).unwrap();
        assert_eq!(
            rows,
            vec![
                SummaryRow {
                    amount: dec!(-60),
                    date: march(10),
                    budget_link_type: "manual".to_string(),
                    budget_id: Some(expense_id),
                    budget_type: Some("expense".to_string()),
                },
                SummaryRow {
                    amount: dec!(-40),
                    date: march(10),
                    budget_link_type: "unlinked".to_string(),
                    budget_id: None,
                    budget_type: None,
                },
                SummaryRow {
                    amount: dec!(-12),
                    date: march(2),
                    budget_link_type: "auto".to_string(),
                    budget_id: Some(expense_id),
                    budget_type: Some("expense".to_string()),
                },
            ]
        );
    }

    #[test]
    fn summary_row_category() {
        let row = |link: &str, budget_type: Option<&str>| SummaryRow {
            amount: dec!(-1),
            date: NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            budget_link_type: link.to_string(),
            budget_id: None,
            budget_type: budget_type.map(str::to_string),
        };
        let cases = [
            (row("unlinked", None), Some(SummaryCategory::Unbudgeted)),
            (
                row("manual", Some("savings")),
                Some(SummaryCategory::Budgeted(BudgetType::Savings)),
            ),
            (
                row("auto", Some("income")),
                Some(SummaryCategory::Budgeted(BudgetType::Income)),
            ),
            (row("manual", None), Some(SummaryCategory::Unbudgeted)),
            (
                row("auto", Some("bogus")),
                Some(SummaryCategory::Unbudgeted),
            ),
            (row("other", Some("expense")), None),
        ];
        for (r, expected) in cases {
            assert_eq!(r.category(), expected, "{r:?}");
        }
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

    async fn setup_category(pool: &PgPool, user_id: Uuid, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO categories (user_id, name, color) VALUES ($1, $2, 'teal') RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn set_budget_category(pool: &PgPool, budget_id: Uuid, category_id: Uuid) {
        sqlx::query("UPDATE budgets SET category_id = $1 WHERE id = $2")
            .bind(category_id)
            .bind(budget_id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn category_params(category_ids: &[Uuid], uncategorized: bool) -> ListOperationsParams {
        ListOperationsParams {
            category: CategoryFilter {
                category_ids: category_ids.to_vec(),
                uncategorized,
            },
            ..sorted_params()
        }
    }

    fn sorted_params() -> ListOperationsParams {
        ListOperationsParams {
            sort: OperationSortField::Amount,
            order: SortOrder::Asc,
            limit: 10,
            ..Default::default()
        }
    }

    async fn listed_ids(
        repo: &PgOperationRepository,
        user_id: Uuid,
        params: ListOperationsParams,
    ) -> (Vec<Uuid>, i64) {
        let (ops, totals) = repo.list(user_id, &params).await.unwrap();
        (ops.into_iter().map(|op| op.id).collect(), totals.count)
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn own_category_takes_precedence_over_the_budgets(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let food = setup_category(&pool, user_id, "Food").await;
        let fun = setup_category(&pool, user_id, "Fun").await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        set_budget_category(&pool, budget_id, food).await;
        let op_id = insert_op(&repo, user_id, dec!(-10)).await;
        repo.set_budget_link(op_id, user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.category_id, None);
        assert_eq!(op.effective_category_id(), Some(food));

        assert!(repo.set_category(op_id, user_id, Some(fun)).await.unwrap());
        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.category_id, Some(fun));
        assert_eq!(op.effective_category_id(), Some(fun));

        assert!(repo.set_category(op_id, user_id, None).await.unwrap());
        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.effective_category_id(), Some(food));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_category_of_other_users_operation_returns_false(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let other_id = setup_user(&pool).await;
        let category = setup_category(&pool, user_id, "Food").await;
        let op_id = insert_op(&repo, user_id, dec!(-10)).await;

        assert!(
            !repo
                .set_category(op_id, other_id, Some(category))
                .await
                .unwrap()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn replace_splits_clears_own_category_and_stores_parts_ones(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let food = setup_category(&pool, user_id, "Food").await;
        let fun = setup_category(&pool, user_id, "Fun").await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        set_budget_category(&pool, budget_id, fun).await;
        let op_id = insert_op(&repo, user_id, dec!(-100)).await;
        repo.set_category(op_id, user_id, Some(food)).await.unwrap();

        let parts = [
            NewOperationSplit {
                category_id: Some(food),
                ..part(dec!(-60), None)
            },
            part(dec!(-40), Some(budget_id)),
        ];
        repo.replace_splits(op_id, user_id, &parts).await.unwrap();

        let op = repo.find_by_id(op_id, user_id).await.unwrap();
        assert_eq!(op.category_id, None);
        let effective: Vec<_> = op
            .splits
            .iter()
            .map(OperationSplit::effective_category_id)
            .collect();
        assert_eq!(effective, [Some(food), Some(fun)]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_filters_by_effective_category_and_split_parts(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let food = setup_category(&pool, user_id, "Food").await;
        let fun = setup_category(&pool, user_id, "Fun").await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        set_budget_category(&pool, budget_id, food).await;

        let own = insert_op(&repo, user_id, dec!(-1)).await;
        repo.set_category(own, user_id, Some(food)).await.unwrap();
        let through_budget = insert_op(&repo, user_id, dec!(-2)).await;
        repo.set_budget_link(through_budget, user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();
        let overridden = insert_op(&repo, user_id, dec!(-3)).await;
        repo.set_budget_link(overridden, user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();
        repo.set_category(overridden, user_id, Some(fun))
            .await
            .unwrap();
        let none = insert_op(&repo, user_id, dec!(-4)).await;
        let split = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [
            NewOperationSplit {
                category_id: Some(fun),
                ..part(dec!(-60), None)
            },
            part(dec!(-40), None),
        ];
        repo.replace_splits(split, user_id, &parts).await.unwrap();

        assert_eq!(
            listed_ids(&repo, user_id, category_params(&[food], false)).await,
            (vec![through_budget, own], 2)
        );
        assert_eq!(
            listed_ids(&repo, user_id, category_params(&[fun], false)).await,
            (vec![split, overridden], 2)
        );
        assert_eq!(
            listed_ids(&repo, user_id, category_params(&[], true)).await,
            (vec![split, none], 2)
        );
        assert_eq!(
            listed_ids(&repo, user_id, category_params(&[food, fun], false)).await,
            (vec![split, overridden, through_budget, own], 4)
        );
        assert_eq!(
            listed_ids(&repo, user_id, category_params(&[food], true)).await,
            (vec![split, none, through_budget, own], 4)
        );
        assert_eq!(listed_ids(&repo, user_id, sorted_params()).await.1, 5);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_filters_by_budget_link_and_split_parts(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let rent = setup_budget(&pool, user_id, "expense").await;
        let food = setup_budget(&pool, user_id, "expense").await;

        let linked = insert_op(&repo, user_id, dec!(-1)).await;
        repo.set_budget_link(linked, user_id, &BudgetLink::Manual { budget_id: rent })
            .await
            .unwrap();
        let other = insert_op(&repo, user_id, dec!(-2)).await;
        repo.set_budget_link(other, user_id, &BudgetLink::Manual { budget_id: food })
            .await
            .unwrap();
        insert_op(&repo, user_id, dec!(-3)).await;
        let split = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [part(dec!(-60), Some(rent)), part(dec!(-40), None)];
        repo.replace_splits(split, user_id, &parts).await.unwrap();

        let by_budgets = |budget_ids: Vec<Uuid>| ListOperationsParams {
            budget_ids,
            ..sorted_params()
        };
        assert_eq!(
            listed_ids(&repo, user_id, by_budgets(vec![rent])).await,
            (vec![split, linked], 2)
        );
        assert_eq!(
            listed_ids(&repo, user_id, by_budgets(vec![rent, food])).await,
            (vec![split, other, linked], 3)
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_filters_by_direction_and_absolute_amount(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let small_expense = insert_op(&repo, user_id, dec!(-5)).await;
        let big_expense = insert_op(&repo, user_id, dec!(-50)).await;
        let small_income = insert_op(&repo, user_id, dec!(10)).await;
        let big_income = insert_op(&repo, user_id, dec!(500)).await;

        let expenses = ListOperationsParams {
            direction: Some(OperationDirection::Expense),
            ..sorted_params()
        };
        assert_eq!(
            listed_ids(&repo, user_id, expenses).await,
            (vec![big_expense, small_expense], 2)
        );
        let income = ListOperationsParams {
            direction: Some(OperationDirection::Income),
            ..sorted_params()
        };
        assert_eq!(
            listed_ids(&repo, user_id, income).await,
            (vec![small_income, big_income], 2)
        );
        let bounded = ListOperationsParams {
            amount_min: Some(dec!(5)),
            amount_max: Some(dec!(50)),
            ..sorted_params()
        };
        assert_eq!(
            listed_ids(&repo, user_id, bounded).await,
            (vec![big_expense, small_expense, small_income], 3)
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_totals_cover_every_page(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        for (amount, day) in [(dec!(-30), 5), (dec!(-12.5), 20), (dec!(100), 12)] {
            repo.insert(
                Uuid::new_v4(),
                user_id,
                amount,
                NaiveDate::from_ymd_opt(2024, 3, day).unwrap(),
                None,
                "Op",
            )
            .await
            .unwrap();
        }

        let params = ListOperationsParams {
            limit: 1,
            ..sorted_params()
        };
        let (ops, totals) = repo.list(user_id, &params).await.unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(
            totals,
            OperationTotals {
                count: 3,
                income: dec!(100),
                expense: dec!(-42.5),
                first_date: NaiveDate::from_ymd_opt(2024, 3, 5),
                last_date: NaiveDate::from_ymd_opt(2024, 3, 20),
            }
        );

        let (ops, totals) = repo.list(Uuid::new_v4(), &params).await.unwrap();
        assert!(ops.is_empty());
        assert_eq!(totals, OperationTotals::default());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn deleting_a_category_uncategorizes_operations_and_parts(pool: PgPool) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let food = setup_category(&pool, user_id, "Food").await;
        let op_id = insert_op(&repo, user_id, dec!(-10)).await;
        repo.set_category(op_id, user_id, Some(food)).await.unwrap();
        let split_id = insert_op(&repo, user_id, dec!(-100)).await;
        let parts = [
            NewOperationSplit {
                category_id: Some(food),
                ..part(dec!(-60), None)
            },
            part(dec!(-40), None),
        ];
        repo.replace_splits(split_id, user_id, &parts)
            .await
            .unwrap();

        sqlx::query("DELETE FROM categories WHERE id = $1")
            .bind(food)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            repo.find_by_id(op_id, user_id).await.unwrap().category_id,
            None
        );
        let split = repo.find_by_id(split_id, user_id).await.unwrap();
        assert!(split.splits.iter().all(|s| s.category_id.is_none()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn category_totals_sum_income_and_expense_per_effective_category_without_savings(
        pool: PgPool,
    ) {
        let repo = PgOperationRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;
        let food = setup_category(&pool, user_id, "Food").await;
        let fun = setup_category(&pool, user_id, "Fun").await;
        let budget_id = setup_budget(&pool, user_id, "expense").await;
        set_budget_category(&pool, budget_id, food).await;
        let savings_id = setup_budget(&pool, user_id, "savings").await;
        set_budget_category(&pool, savings_id, fun).await;

        let spent = insert_op(&repo, user_id, dec!(-30)).await;
        repo.set_category(spent, user_id, Some(food)).await.unwrap();
        let refund = insert_op(&repo, user_id, dec!(5)).await;
        repo.set_budget_link(refund, user_id, &BudgetLink::Manual { budget_id })
            .await
            .unwrap();
        let ignored = insert_op(&repo, user_id, dec!(-1000)).await;
        repo.set_category(ignored, user_id, Some(food))
            .await
            .unwrap();
        repo.set_ignored(ignored, user_id, true).await.unwrap();
        insert_op(&repo, user_id, dec!(-7)).await;
        let saved = insert_op(&repo, user_id, dec!(-200)).await;
        repo.set_budget_link(
            saved,
            user_id,
            &BudgetLink::Manual {
                budget_id: savings_id,
            },
        )
        .await
        .unwrap();
        let split = insert_op(&repo, user_id, dec!(-130)).await;
        let parts = [
            NewOperationSplit {
                category_id: Some(fun),
                ..part(dec!(-60), None)
            },
            part(dec!(-40), Some(budget_id)),
            part(dec!(-30), Some(savings_id)),
        ];
        repo.replace_splits(split, user_id, &parts).await.unwrap();
        repo.insert(
            Uuid::new_v4(),
            user_id,
            dec!(-500),
            NaiveDate::from_ymd_opt(2024, 4, 1).unwrap(),
            None,
            "Next month",
        )
        .await
        .unwrap();

        let march = (
            NaiveDate::from_ymd_opt(2024, 3, 1).unwrap(),
            NaiveDate::from_ymd_opt(2024, 3, 31).unwrap(),
        );
        let totals = repo
            .category_totals(user_id, march.0, march.1)
            .await
            .unwrap();

        let total = |category_id| CategoryTotal {
            category_id,
            income: Decimal::ZERO,
            expense: Decimal::ZERO,
        };
        assert_eq!(
            totals,
            [
                CategoryTotal {
                    income: dec!(5),
                    expense: dec!(-70),
                    ..total(Some(food))
                },
                CategoryTotal {
                    expense: dec!(-60),
                    ..total(Some(fun))
                },
                CategoryTotal {
                    expense: dec!(-7),
                    ..total(None)
                },
            ]
        );
    }
}
