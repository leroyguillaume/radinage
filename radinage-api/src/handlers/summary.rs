use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{budget::BudgetType, last_day_of_month},
    error::{AppError, AppResult},
    repositories::{CategoryTotal, OperationRepository, SummaryCategory},
};
use axum::{
    Json,
    extract::{Query, State},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

pub async fn get_category_summary<U, O: OperationRepository, B, P, C>(
    State(state): State<AppState<U, O, B, P, C>>,
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

pub async fn get_summary<U, O: OperationRepository, B, P, C>(
    State(state): State<AppState<U, O, B, P, C>>,
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
        domain::user::UserRole,
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
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(-800, 0),
                        budget_link_type: "manual".to_string(),
                        budget_type: Some("expense".to_string()),
                    },
                    SummaryRow {
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(-50, 0),
                        budget_link_type: "unlinked".to_string(),
                        budget_type: None,
                    },
                    SummaryRow {
                        date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
                        budget_id: None,
                        amount: Decimal::new(3000, 0),
                        budget_link_type: "auto".to_string(),
                        budget_type: Some("income".to_string()),
                    },
                    SummaryRow {
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
