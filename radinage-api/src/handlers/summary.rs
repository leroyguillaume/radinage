use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::{BudgetType, YearMonth},
        last_day_of_month,
    },
    error::{AppError, AppResult},
    repositories::{
        BudgetRepository, CategoryTotal, OperationRepository, SummaryCategory, SummaryRow,
    },
    services::forecast::horizon,
};
use axum::{
    Json,
    extract::{Query, State},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Longest range `GET /summary/budgets` accepts, in months.
pub const MAX_BUDGET_SUMMARY_MONTHS: i64 = 24;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Query parameters for the summary endpoint.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryQuery {
    /// Start of the range (inclusive).
    pub from_year: i32,
    pub from_month: u32,
    /// End of the range (inclusive).
    pub to_year: i32,
    pub to_month: u32,
}

/// Actual totals for operations linked to a budget, grouped by budget type.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetedTotals {
    /// Total of operations linked to expense-type budgets.
    #[schemars(with = "String")]
    pub expense: Decimal,
    /// Total of operations linked to income-type budgets.
    #[schemars(with = "String")]
    pub income: Decimal,
    /// Total of operations linked to savings-type budgets.
    #[schemars(with = "String")]
    pub savings: Decimal,
}

/// Financial totals for a single month.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySummary {
    /// Year of this entry.
    pub year: i32,
    /// Month of this entry (1–12).
    pub month: u32,
    /// Total of operations not linked to any budget.
    #[schemars(with = "String")]
    pub unbudgeted: Decimal,
    /// Totals of operations linked to a budget, grouped by budget type.
    pub budgeted: BudgetedTotals,
}

/// Response containing one summary entry per month in the requested range.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    pub months: Vec<MonthlySummary>,
}

/// What one category received and spent over the range.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotalResponse {
    /// The category, `null` for the amounts without one.
    pub category_id: Option<Uuid>,
    /// Sum of the positive amounts.
    #[schemars(with = "String")]
    pub income: Decimal,
    /// Sum of the negative amounts (zero or negative).
    #[schemars(with = "String")]
    pub expense: Decimal,
}

impl From<CategoryTotal> for CategoryTotalResponse {
    fn from(t: CategoryTotal) -> Self {
        Self {
            category_id: t.category_id,
            income: t.income,
            expense: t.expense,
        }
    }
}

/// Totals per category over a month range, most spent first.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CategorySummaryResponse {
    pub categories: Vec<CategoryTotalResponse>,
}

/// What one budget expected and received in one month, signed like operations.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetMonthResponse {
    pub year: i32,
    /// Month number (1–12).
    pub month: u32,
    /// What the budget expects this month, null when it expects nothing.
    #[schemars(with = "Option<String>")]
    pub expected: Option<Decimal>,
    /// Net of the amounts linked to the budget this month.
    #[schemars(with = "String")]
    pub actual: Decimal,
}

/// One budget, month by month over the range.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSummaryEntryResponse {
    pub budget_id: Uuid,
    /// Every month of the range, in order.
    pub months: Vec<BudgetMonthResponse>,
}

/// Every budget of the user, month by month over a month range.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSummaryResponse {
    pub budgets: Vec<BudgetSummaryEntryResponse>,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// First and last day of the inclusive month range of `q`.
fn range_bounds(q: &SummaryQuery) -> AppResult<(NaiveDate, NaiveDate)> {
    if (q.from_year, q.from_month) > (q.to_year, q.to_month) {
        return Err(AppError::BadRequest("from must be <= to".to_string()));
    }
    let invalid = |year, month| AppError::BadRequest(format!("invalid year/month: {year}-{month}"));
    let start = NaiveDate::from_ymd_opt(q.from_year, q.from_month, 1)
        .ok_or_else(|| invalid(q.from_year, q.from_month))?;
    let end =
        last_day_of_month(q.to_year, q.to_month).ok_or_else(|| invalid(q.to_year, q.to_month))?;
    Ok((start, end))
}

pub async fn get_category_summary<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Query(q): Query<SummaryQuery>,
) -> AppResult<Json<CategorySummaryResponse>> {
    let (start, end) = range_bounds(&q)?;
    let totals = state
        .operation_repo
        .category_totals(auth_user.id, start, end)
        .await?;
    Ok(Json(CategorySummaryResponse {
        categories: totals.into_iter().map(Into::into).collect(),
    }))
}

/// Net of the budget-linked rows, per budget and accounting month.
fn actuals_by_budget_and_month(rows: &[SummaryRow]) -> HashMap<(Uuid, YearMonth), Decimal> {
    let mut actuals = HashMap::new();
    for row in rows {
        if let (Some(budget_id), Some(SummaryCategory::Budgeted(_))) =
            (row.budget_id, row.category())
        {
            *actuals
                .entry((budget_id, YearMonth::of(row.date)))
                .or_default() += row.amount;
        }
    }
    actuals
}

pub async fn get_budget_summary<U, O: OperationRepository, B: BudgetRepository, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Query(q): Query<SummaryQuery>,
) -> AppResult<Json<BudgetSummaryResponse>> {
    let (start, end) = range_bounds(&q)?;
    let month_count = i64::from(q.to_year - q.from_year) * 12 + i64::from(q.to_month)
        - i64::from(q.from_month)
        + 1;
    if month_count > MAX_BUDGET_SUMMARY_MONTHS {
        return Err(AppError::BadRequest(format!(
            "range must not exceed {MAX_BUDGET_SUMMARY_MONTHS} months"
        )));
    }
    let months: Vec<YearMonth> = horizon(
        YearMonth::of(start),
        usize::try_from(month_count).unwrap_or(0),
    )
    .collect();

    let rows = state
        .operation_repo
        .list_for_summary(auth_user.id, start, end)
        .await?;
    let budgets = state.budget_repo.list_all_for_user(auth_user.id).await?;
    let actuals = actuals_by_budget_and_month(&rows);

    let budgets = budgets
        .into_iter()
        .map(|budget| BudgetSummaryEntryResponse {
            budget_id: budget.id,
            months: months
                .iter()
                .map(|&month| BudgetMonthResponse {
                    year: month.year,
                    month: month.month,
                    expected: budget
                        .kind
                        .expected_amount_for_month(month.year, month.month),
                    actual: actuals
                        .get(&(budget.id, month))
                        .copied()
                        .unwrap_or_default(),
                })
                .collect(),
        })
        .collect();
    Ok(Json(BudgetSummaryResponse { budgets }))
}

pub async fn get_summary<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Query(q): Query<SummaryQuery>,
) -> AppResult<Json<SummaryResponse>> {
    let user_id = auth_user.id;
    range_bounds(&q)?;

    let from = (q.from_year, q.from_month);
    let to = (q.to_year, q.to_month);
    let mut months = Vec::new();
    let (mut year, mut month) = from;

    loop {
        let month_start = NaiveDate::from_ymd_opt(year, month, 1)
            .ok_or_else(|| AppError::BadRequest(format!("invalid year/month: {year}-{month}")))?;
        let month_end = last_day_of_month(year, month)
            .ok_or_else(|| AppError::BadRequest(format!("invalid year/month: {year}-{month}")))?;

        let summary_rows = state
            .operation_repo
            .list_for_summary(user_id, month_start, month_end)
            .await?;

        let mut unbudgeted = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        let mut income = Decimal::ZERO;
        let mut savings = Decimal::ZERO;

        for row in summary_rows {
            match row.category() {
                Some(SummaryCategory::Unbudgeted) => unbudgeted += row.amount,
                Some(SummaryCategory::Budgeted(BudgetType::Expense)) => expense += row.amount,
                Some(SummaryCategory::Budgeted(BudgetType::Income)) => income += row.amount,
                Some(SummaryCategory::Budgeted(BudgetType::Savings)) => savings += row.amount,
                None => {}
            }
        }

        months.push(MonthlySummary {
            year,
            month,
            unbudgeted,
            budgeted: BudgetedTotals {
                expense,
                income,
                savings,
            },
        });

        if (year, month) == to {
            break;
        }

        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
    }

    Ok(Json(SummaryResponse { months }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, CurrentPeriod, Recurrence},
            user::UserRole,
        },
        repositories::{
            MockBudgetRepository, MockOperationRepository, MockUserRepository, SummaryRow,
        },
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use rust_decimal::Decimal;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn summary_app(or: MockOperationRepository) -> axum::Router {
        build_test_router(make_test_state(
            MockUserRepository::new(),
            or,
            MockBudgetRepository::new(),
        ))
    }

    #[tokio::test]
    async fn summary_single_month_empty() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));

        let app = summary_app(or);
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "GET",
            "/summary?fromYear=2024&fromMonth=1&toYear=2024&toMonth=1",
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: SummaryResponse = response_json(resp).await;
        assert_eq!(json.months.len(), 1);
        assert_eq!(json.months[0].year, 2024);
        assert_eq!(json.months[0].month, 1);
        assert_eq!(json.months[0].unbudgeted, Decimal::ZERO);
        assert_eq!(json.months[0].budgeted.expense, Decimal::ZERO);
        assert_eq!(json.months[0].budgeted.income, Decimal::ZERO);
        assert_eq!(json.months[0].budgeted.savings, Decimal::ZERO);
    }

    #[tokio::test]
    async fn summary_range_returns_multiple_months() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));

        let app = summary_app(or);
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "GET",
            "/summary?fromYear=2024&fromMonth=11&toYear=2025&toMonth=2",
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: SummaryResponse = response_json(resp).await;
        assert_eq!(json.months.len(), 4);
        assert_eq!((json.months[0].year, json.months[0].month), (2024, 11));
        assert_eq!((json.months[3].year, json.months[3].month), (2025, 2));
    }

    #[tokio::test]
    async fn summary_totals_computed_correctly() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary().returning(|_, _, _| {
            Box::pin(async {
                Ok(vec![
                    SummaryRow {
                        account_id: Uuid::nil(),
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(-800, 0),
                        budget_link_type: "manual".to_string(),
                        budget_type: Some("expense".to_string()),
                    },
                    SummaryRow {
                        account_id: Uuid::nil(),
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(-50, 0),
                        budget_link_type: "unlinked".to_string(),
                        budget_type: None,
                    },
                    SummaryRow {
                        account_id: Uuid::nil(),
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(3000, 0),
                        budget_link_type: "auto".to_string(),
                        budget_type: Some("income".to_string()),
                    },
                    SummaryRow {
                        account_id: Uuid::nil(),
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(-200, 0),
                        budget_link_type: "manual".to_string(),
                        budget_type: Some("savings".to_string()),
                    },
                ])
            })
        });

        let app = summary_app(or);
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "GET",
            "/summary?fromYear=2024&fromMonth=1&toYear=2024&toMonth=1",
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        let json: SummaryResponse = response_json(resp).await;
        let m = &json.months[0];
        assert_eq!(m.unbudgeted, Decimal::new(-50, 0));
        assert_eq!(m.budgeted.expense, Decimal::new(-800, 0));
        assert_eq!(m.budgeted.income, Decimal::new(3000, 0));
        assert_eq!(m.budgeted.savings, Decimal::new(-200, 0));
    }

    #[tokio::test]
    async fn summary_from_after_to_returns_400() {
        let user_id = Uuid::new_v4();
        let app = summary_app(MockOperationRepository::new());
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "GET",
            "/summary?fromYear=2025&fromMonth=3&toYear=2025&toMonth=1",
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn category_summary_covers_the_whole_month_range() {
        let category_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_category_totals()
            .withf(|_, from, to| {
                *from == NaiveDate::from_ymd_opt(2024, 11, 1).unwrap()
                    && *to == NaiveDate::from_ymd_opt(2025, 2, 28).unwrap()
            })
            .once()
            .returning(move |_, _, _| {
                Box::pin(async move {
                    Ok(vec![
                        CategoryTotal {
                            category_id: Some(category_id),
                            income: Decimal::new(5, 0),
                            expense: Decimal::new(-70, 0),
                        },
                        CategoryTotal {
                            category_id: None,
                            income: Decimal::ZERO,
                            expense: Decimal::new(-7, 0),
                        },
                    ])
                })
            });

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request(
            "GET",
            "/summary/categories?fromYear=2024&fromMonth=11&toYear=2025&toMonth=2",
            None,
            Some(&auth),
        );
        let resp = summary_app(or).oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["categories"][0]["categoryId"], category_id.to_string());
        assert_eq!(json["categories"][0]["expense"], "-70");
        assert_eq!(json["categories"][1]["categoryId"], serde_json::Value::Null);
    }

    fn budget(kind: BudgetKind) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            label: "Budget".to_string(),
            budget_type: BudgetType::Expense,
            kind,
            rules: vec![],
            category_id: None,
            created_at: chrono::Utc::now(),
        }
    }

    fn linked(budget_id: Option<Uuid>, link: &str, date: NaiveDate, amount: i64) -> SummaryRow {
        SummaryRow {
            account_id: Uuid::nil(),
            amount: Decimal::new(amount, 0),
            date,
            budget_link_type: link.to_string(),
            budget_id,
            budget_type: budget_id.map(|_| "expense".to_string()),
        }
    }

    fn budget_summary_app(or: MockOperationRepository, budgets: Vec<Budget>) -> axum::Router {
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user().returning(move |_| {
            let budgets = budgets.clone();
            Box::pin(async move { Ok(budgets) })
        });
        build_test_router(make_test_state(MockUserRepository::new(), or, br))
    }

    async fn get_budget_summary(app: axum::Router, query: &str) -> axum::response::Response {
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request(
            "GET",
            &format!("/summary/budgets?{query}"),
            None,
            Some(&auth),
        );
        app.oneshot(req).await.unwrap()
    }

    #[tokio::test]
    async fn budget_summary_lists_expected_and_actual_per_budget_and_month() {
        let monthly = budget(BudgetKind::Recurring {
            recurrence: Recurrence::Monthly,
            closed_periods: vec![],
            current_period: CurrentPeriod {
                start: YearMonth::new(2024, 1),
                end: None,
                amount: Decimal::new(-450, 0),
            },
        });
        let occasional = budget(BudgetKind::Occasional {
            month: 2,
            year: 2025,
            amount: Decimal::new(-1500, 0),
        });
        let (monthly_id, occasional_id) = (monthly.id, occasional.id);
        let day = |y, m, d| NaiveDate::from_ymd_opt(y, m, d).unwrap();

        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, from, to| {
                *from == NaiveDate::from_ymd_opt(2024, 12, 1).unwrap()
                    && *to == NaiveDate::from_ymd_opt(2025, 2, 28).unwrap()
            })
            .once()
            .returning(move |_, _, _| {
                let rows = vec![
                    linked(Some(monthly_id), "auto", day(2024, 12, 3), -200),
                    linked(Some(monthly_id), "manual", day(2024, 12, 20), -280),
                    linked(Some(monthly_id), "auto", day(2025, 2, 1), -100),
                    linked(Some(occasional_id), "manual", day(2025, 2, 10), -1730),
                    linked(None, "unlinked", day(2024, 12, 5), -999),
                ];
                Box::pin(async move { Ok(rows) })
            });

        let resp = get_budget_summary(
            budget_summary_app(or, vec![monthly, occasional]),
            "fromYear=2024&fromMonth=12&toYear=2025&toMonth=2",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json,
            serde_json::json!({ "budgets": [
                { "budgetId": monthly_id, "months": [
                    { "year": 2024, "month": 12, "expected": "-450", "actual": "-480" },
                    { "year": 2025, "month": 1, "expected": "-450", "actual": "0" },
                    { "year": 2025, "month": 2, "expected": "-450", "actual": "-100" },
                ] },
                { "budgetId": occasional_id, "months": [
                    { "year": 2024, "month": 12, "expected": null, "actual": "0" },
                    { "year": 2025, "month": 1, "expected": null, "actual": "0" },
                    { "year": 2025, "month": 2, "expected": "-1500", "actual": "-1730" },
                ] },
            ] })
        );
    }

    #[tokio::test]
    async fn budget_summary_accepts_24_months_and_rejects_more() {
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        let app = budget_summary_app(or, vec![]);

        let ok = get_budget_summary(
            app.clone(),
            "fromYear=2024&fromMonth=1&toYear=2025&toMonth=12",
        )
        .await;
        let too_long =
            get_budget_summary(app, "fromYear=2024&fromMonth=1&toYear=2026&toMonth=1").await;

        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(too_long.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn budget_summary_rejects_a_reversed_range() {
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary().never();

        let resp = get_budget_summary(
            budget_summary_app(or, vec![]),
            "fromYear=2025&fromMonth=2&toYear=2024&toMonth=11",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn category_summary_rejects_a_reversed_range() {
        let mut or = MockOperationRepository::new();
        or.expect_category_totals().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request(
            "GET",
            "/summary/categories?fromYear=2025&fromMonth=2&toYear=2024&toMonth=11",
            None,
            Some(&auth),
        );
        let resp = summary_app(or).oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
