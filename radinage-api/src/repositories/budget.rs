use crate::{
    domain::budget::{
        Budget, BudgetKind, BudgetType, ClosedPeriod, CurrentPeriod, LabelPattern, Recurrence,
        Rule, YearMonth,
    },
    error::{AppError, AppResult},
    repositories::SortOrder,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::Deserialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Sort field for budget listings.
#[derive(Debug, Deserialize, Clone, Copy, Default, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum BudgetSortField {
    /// Sort by creation date (default).
    #[default]
    CreatedAt,
    /// Sort alphabetically by label.
    Label,
}

impl BudgetSortField {
    pub fn as_sql(&self) -> &'static str {
        match self {
            Self::CreatedAt => "created_at",
            Self::Label => "label",
        }
    }
}

/// Parameters for listing budgets (sorted, optionally filtered).
pub struct ListBudgetsParams {
    /// Label filter already formatted as `%pattern%` for SQL LIKE.
    pub label_filter: Option<String>,
    pub sort: BudgetSortField,
    pub order: SortOrder,
}

/// Data access interface for budgets.
#[cfg_attr(test, mockall::automock)]
pub trait BudgetRepository: Send + Sync + 'static {
    /// Fetch a single budget by id, scoped to the given user.
    fn find_by_id(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Budget>> + Send;

    /// Check whether a budget with the given id exists for the given user.
    fn exists(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Count the total number of budgets for a user.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// List all budgets for a user with sorting and optional filtering.
    fn list(
        &self,
        user_id: Uuid,
        params: &ListBudgetsParams,
    ) -> impl std::future::Future<Output = AppResult<Vec<Budget>>> + Send;

    /// Insert a new budget (including its periods and rules). Returns the created budget.
    fn create(
        &self,
        user_id: Uuid,
        label: &str,
        budget_type: BudgetType,
        kind: &BudgetKind,
        rules: &[Rule],
    ) -> impl std::future::Future<Output = AppResult<Budget>> + Send;

    /// Replace a budget's fields, periods, and rules atomically.
    /// Returns `Some(budget)` if found, `None` if not found.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        label: &str,
        budget_type: BudgetType,
        kind: &BudgetKind,
        rules: &[Rule],
    ) -> impl std::future::Future<Output = AppResult<Option<Budget>>> + Send;

    /// Delete a budget and its related rows. Returns `true` if found.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Fetch all budgets belonging to a user (no pagination).
    fn list_all_for_user(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<Budget>>> + Send;
}

/// PostgreSQL-backed budget repository.
#[derive(Clone)]
pub struct PgBudgetRepository {
    pool: PgPool,
}

impl PgBudgetRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Fetch the full budget record (main row + periods + rules) by id and user.
    async fn fetch_full(&self, id: Uuid, user_id: Uuid) -> AppResult<Budget> {
        let row = sqlx::query(
            r#"SELECT id, user_id, label, budget_type, kind_type, recurrence,
                      kind_month, kind_year, kind_amount, created_at
               FROM budgets WHERE id = $1 AND user_id = $2"#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;

        self.row_to_budget(&row).await
    }

    /// Map a budget main-row to a fully populated `Budget`, loading periods and rules.
    async fn row_to_budget(&self, row: &sqlx::postgres::PgRow) -> AppResult<Budget> {
        let id: Uuid = row.try_get("id")?;

        let kind_type: &str = row.try_get("kind_type")?;
        let kind = if kind_type == "occasional" {
            BudgetKind::Occasional {
                month: row.try_get::<i16, _>("kind_month").unwrap_or(1) as u32,
                year: row.try_get::<i32, _>("kind_year").unwrap_or(2024) as u32,
                amount: row
                    .try_get::<Decimal, _>("kind_amount")
                    .unwrap_or(Decimal::ZERO),
            }
        } else {
            let recurrence_str: String = row
                .try_get::<String, _>("recurrence")
                .unwrap_or_else(|_| "monthly".to_string());
            let recurrence: Recurrence = recurrence_str.parse().unwrap_or(Recurrence::Monthly);
            let period_rows = sqlx::query(
                "SELECT start_year, start_month, end_year, end_month, amount FROM budget_periods
                 WHERE budget_id = $1 ORDER BY position",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await?;

            if period_rows.is_empty() {
                return Err(AppError::Internal(
                    "recurring budget has no periods".to_string(),
                ));
            }

            let last_idx = period_rows.len() - 1;
            let closed_periods = period_rows[..last_idx]
                .iter()
                .map(|p| {
                    let start_year: i32 = p.try_get("start_year").unwrap();
                    let start_month: i32 = p.try_get("start_month").unwrap();
                    let end_year: i32 = p.try_get("end_year").unwrap();
                    let end_month: i32 = p.try_get("end_month").unwrap();
                    ClosedPeriod {
                        start: YearMonth::new(start_year, start_month as u32),
                        end: YearMonth::new(end_year, end_month as u32),
                        amount: p.try_get("amount").unwrap(),
                    }
                })
                .collect();

            let last = &period_rows[last_idx];
            let start_year: i32 = last.try_get("start_year").unwrap();
            let start_month: i32 = last.try_get("start_month").unwrap();
            let end_year: Option<i32> = last.try_get("end_year").unwrap();
            let end_month: Option<i32> = last.try_get("end_month").unwrap();
            let current_period = CurrentPeriod {
                start: YearMonth::new(start_year, start_month as u32),
                end: end_year
                    .zip(end_month)
                    .map(|(y, m)| YearMonth::new(y, m as u32)),
                amount: last.try_get("amount").unwrap(),
            };

            BudgetKind::Recurring {
                recurrence,
                closed_periods,
                current_period,
            }
        };

        let rule_rows = sqlx::query(
            "SELECT pattern_type, pattern_value, match_amount FROM budget_rules
             WHERE budget_id = $1 ORDER BY position",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let rules = rule_rows
            .iter()
            .map(|r| {
                let pt: &str = r.try_get("pattern_type").unwrap_or("contains");
                let pv: String = r.try_get("pattern_value").unwrap_or_default();
                let label_pattern = match pt {
                    "starts_with" => LabelPattern::StartsWith(pv),
                    "ends_with" => LabelPattern::EndsWith(pv),
                    _ => LabelPattern::Contains(pv),
                };
                Rule {
                    label_pattern,
                    match_amount: r.try_get("match_amount").unwrap_or(false),
                }
            })
            .collect();

        let budget_type_str: &str = row.try_get("budget_type")?;
        let budget_type: BudgetType = budget_type_str
            .parse()
            .map_err(|_| AppError::Internal("invalid budget_type in DB".to_string()))?;

        let created_at: DateTime<Utc> = row.try_get("created_at")?;

        Ok(Budget {
            id,
            user_id: row.try_get("user_id")?,
            label: row.try_get("label")?,
            budget_type,
            kind,
            rules,
            created_at,
        })
    }

    async fn insert_periods(
        &self,
        budget_id: Uuid,
        closed_periods: &[ClosedPeriod],
        current_period: &CurrentPeriod,
    ) -> AppResult<()> {
        for (pos, p) in closed_periods.iter().enumerate() {
            sqlx::query(
                "INSERT INTO budget_periods (id, budget_id, position, start_year, start_month, end_year, end_month, amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(Uuid::new_v4())
            .bind(budget_id)
            .bind(pos as i32)
            .bind(p.start.year)
            .bind(p.start.month as i32)
            .bind(p.end.year)
            .bind(p.end.month as i32)
            .bind(p.amount)
            .execute(&self.pool)
            .await?;
        }

        let current_pos = closed_periods.len() as i32;
        sqlx::query(
            "INSERT INTO budget_periods (id, budget_id, position, start_year, start_month, end_year, end_month, amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(Uuid::new_v4())
        .bind(budget_id)
        .bind(current_pos)
        .bind(current_period.start.year)
        .bind(current_period.start.month as i32)
        .bind(current_period.end.map(|e| e.year))
        .bind(current_period.end.map(|e| e.month as i32))
        .bind(current_period.amount)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn insert_rules(&self, budget_id: Uuid, rules: &[Rule]) -> AppResult<()> {
        for (pos, r) in rules.iter().enumerate() {
            let (pattern_type, pattern_value) = label_pattern_to_cols(&r.label_pattern);
            sqlx::query(
                "INSERT INTO budget_rules
                 (id, budget_id, position, pattern_type, pattern_value, match_amount)
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(Uuid::new_v4())
            .bind(budget_id)
            .bind(pos as i32)
            .bind(pattern_type)
            .bind(pattern_value)
            .bind(r.match_amount)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }
}

/// Extract (kind_type, recurrence, kind_month, kind_year, kind_amount) from a `BudgetKind`.
fn kind_to_cols(
    kind: &BudgetKind,
) -> (
    &'static str,
    Option<&'static str>,
    Option<i16>,
    Option<i32>,
    Option<Decimal>,
) {
    match kind {
        BudgetKind::Recurring { recurrence, .. } => {
            ("recurring", Some(recurrence.as_str()), None, None, None)
        }
        BudgetKind::Occasional {
            month,
            year,
            amount,
        } => (
            "occasional",
            None,
            Some(*month as i16),
            Some(*year as i32),
            Some(*amount),
        ),
    }
}

/// Extract (pattern_type, pattern_value) from a `LabelPattern`.
fn label_pattern_to_cols(p: &LabelPattern) -> (&'static str, &str) {
    match p {
        LabelPattern::StartsWith(v) => ("starts_with", v.as_str()),
        LabelPattern::EndsWith(v) => ("ends_with", v.as_str()),
        LabelPattern::Contains(v) => ("contains", v.as_str()),
    }
}

impl BudgetRepository for PgBudgetRepository {
    async fn find_by_id(&self, id: Uuid, user_id: Uuid) -> AppResult<Budget> {
        self.fetch_full(id, user_id).await
    }

    async fn exists(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let row = sqlx::query("SELECT id FROM budgets WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.is_some())
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS count FROM budgets WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("count")?)
    }

    async fn list(&self, user_id: Uuid, params: &ListBudgetsParams) -> AppResult<Vec<Budget>> {
        let sql = format!(
            r#"SELECT id FROM budgets
               WHERE user_id = $1
                 AND ($2::text IS NULL OR LOWER(label) LIKE $2)
               ORDER BY {sort_col} {sort_dir}"#,
            sort_col = params.sort.as_sql(),
            sort_dir = params.order.as_sql(),
        );

        let id_rows = sqlx::query(&sql)
            .bind(user_id)
            .bind(params.label_filter.as_deref())
            .fetch_all(&self.pool)
            .await?;

        let mut budgets = Vec::with_capacity(id_rows.len());
        for row in &id_rows {
            let id: Uuid = row.try_get("id")?;
            budgets.push(self.fetch_full(id, user_id).await?);
        }

        Ok(budgets)
    }

    async fn create(
        &self,
        user_id: Uuid,
        label: &str,
        budget_type: BudgetType,
        kind: &BudgetKind,
        rules: &[Rule],
    ) -> AppResult<Budget> {
        let id = Uuid::new_v4();
        let (kind_type, recurrence, kind_month, kind_year, kind_amount) = kind_to_cols(kind);

        sqlx::query(
            r#"INSERT INTO budgets
               (id, user_id, label, budget_type, kind_type, recurrence, kind_month, kind_year, kind_amount)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        )
        .bind(id)
        .bind(user_id)
        .bind(label)
        .bind(budget_type.as_str())
        .bind(kind_type)
        .bind(recurrence)
        .bind(kind_month)
        .bind(kind_year)
        .bind(kind_amount)
        .execute(&self.pool)
        .await?;

        if let BudgetKind::Recurring {
            closed_periods,
            current_period,
            ..
        } = kind
        {
            self.insert_periods(id, closed_periods, current_period)
                .await?;
        }
        self.insert_rules(id, rules).await?;

        self.fetch_full(id, user_id).await
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        label: &str,
        budget_type: BudgetType,
        kind: &BudgetKind,
        rules: &[Rule],
    ) -> AppResult<Option<Budget>> {
        let (kind_type, recurrence, kind_month, kind_year, kind_amount) = kind_to_cols(kind);

        let affected = sqlx::query(
            r#"UPDATE budgets SET label = $1, budget_type = $2, kind_type = $3,
               recurrence = $4, kind_month = $5, kind_year = $6, kind_amount = $7
               WHERE id = $8 AND user_id = $9"#,
        )
        .bind(label)
        .bind(budget_type.as_str())
        .bind(kind_type)
        .bind(recurrence)
        .bind(kind_month)
        .bind(kind_year)
        .bind(kind_amount)
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?
        .rows_affected();

        if affected == 0 {
            return Ok(None);
        }

        sqlx::query("DELETE FROM budget_periods WHERE budget_id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM budget_rules WHERE budget_id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if let BudgetKind::Recurring {
            closed_periods,
            current_period,
            ..
        } = kind
        {
            self.insert_periods(id, closed_periods, current_period)
                .await?;
        }
        self.insert_rules(id, rules).await?;

        Ok(Some(self.fetch_full(id, user_id).await?))
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let affected = sqlx::query("DELETE FROM budgets WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(affected > 0)
    }

    async fn list_all_for_user(&self, user_id: Uuid) -> AppResult<Vec<Budget>> {
        let id_rows = sqlx::query("SELECT id FROM budgets WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        let mut budgets = Vec::with_capacity(id_rows.len());
        for row in &id_rows {
            let id: Uuid = row.try_get("id")?;
            budgets.push(self.fetch_full(id, user_id).await?);
        }
        Ok(budgets)
    }
}

#[cfg(test)]
mod tests {
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

    fn occasional_kind() -> BudgetKind {
        BudgetKind::Occasional {
            month: 3,
            year: 2024,
            amount: dec!(-500),
        }
    }

    fn recurring_kind() -> BudgetKind {
        BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: Some(YearMonth::new(2024, 12)),
                amount: dec!(2000),
            },
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_and_find_occasional_budget(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let budget = repo
            .create(
                user_id,
                "Vacances",
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();

        assert_eq!(budget.label, "Vacances");
        assert_eq!(budget.budget_type, BudgetType::Expense);
        assert!(matches!(budget.kind, BudgetKind::Occasional { .. }));
        assert!(budget.rules.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_recurring_budget_with_rules(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let rules = vec![Rule {
            label_pattern: LabelPattern::StartsWith("SALAIRE".to_string()),
            match_amount: false,
        }];

        let budget = repo
            .create(
                user_id,
                "Salaire",
                BudgetType::Income,
                &recurring_kind(),
                &rules,
            )
            .await
            .unwrap();

        assert_eq!(budget.rules.len(), 1);
        assert!(matches!(budget.kind, BudgetKind::Recurring { .. }));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_by_id_not_found(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let err = repo.find_by_id(Uuid::new_v4(), user_id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn exists_returns_correct_value(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let budget = repo
            .create(user_id, "B", BudgetType::Expense, &occasional_kind(), &[])
            .await
            .unwrap();

        assert!(repo.exists(budget.id, user_id).await.unwrap());
        assert!(!repo.exists(Uuid::new_v4(), user_id).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_budget_fields(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let budget = repo
            .create(
                user_id,
                "Original",
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();

        let updated = repo
            .update(
                budget.id,
                user_id,
                "Updated",
                BudgetType::Savings,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.label, "Updated");
        assert_eq!(updated.budget_type, BudgetType::Savings);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_nonexistent_returns_none(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let result = repo
            .update(
                Uuid::new_v4(),
                user_id,
                "X",
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();

        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_budget(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let budget = repo
            .create(
                user_id,
                "ToDelete",
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();

        assert!(repo.delete(budget.id, user_id).await.unwrap());
        assert!(!repo.delete(budget.id, user_id).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_budgets_returns_all(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        for i in 0..4 {
            repo.create(
                user_id,
                &format!("Budget {i}"),
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();
        }

        let params = ListBudgetsParams {
            label_filter: None,
            sort: BudgetSortField::CreatedAt,
            order: SortOrder::Desc,
        };
        let budgets = repo.list(user_id, &params).await.unwrap();
        assert_eq!(budgets.len(), 4);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_recurring_budget_with_all_recurrences(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        let recurrences = [
            (Recurrence::Weekly, "weekly"),
            (Recurrence::Monthly, "monthly"),
            (Recurrence::Quarterly, "quarterly"),
            (Recurrence::Yearly, "yearly"),
        ];

        for (recurrence, label) in recurrences {
            let kind = BudgetKind::Recurring {
                recurrence,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: dec!(500),
                },
            };
            let budget = repo
                .create(user_id, label, BudgetType::Expense, &kind, &[])
                .await
                .unwrap();

            match budget.kind {
                BudgetKind::Recurring {
                    recurrence: got, ..
                } => assert_eq!(got, recurrence),
                _ => panic!("expected recurring budget"),
            }

            // Round-trip: fetch from DB and verify
            let fetched = repo.find_by_id(budget.id, user_id).await.unwrap();
            match fetched.kind {
                BudgetKind::Recurring {
                    recurrence: got, ..
                } => assert_eq!(got, recurrence),
                _ => panic!("expected recurring budget on fetch"),
            }
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_all_for_user(pool: PgPool) {
        let repo = PgBudgetRepository::new(pool.clone());
        let user_id = setup_user(&pool).await;

        for i in 0..3 {
            repo.create(
                user_id,
                &format!("B{i}"),
                BudgetType::Expense,
                &occasional_kind(),
                &[],
            )
            .await
            .unwrap();
        }

        let all = repo.list_all_for_user(user_id).await.unwrap();
        assert_eq!(all.len(), 3);
    }
}
