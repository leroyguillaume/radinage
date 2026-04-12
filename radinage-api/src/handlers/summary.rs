use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{budget::BudgetType, last_day_of_month},
    error::{AppError, AppResult},
    repositories::OperationRepository,
};
use axum::{
    Json,
    extract::{Query, State},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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

// ── Handler ──────────────────────────────────────────────────────────────────

pub async fn get_summary<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Query(q): Query<SummaryQuery>,
) -> AppResult<Json<SummaryResponse>> {
    let user_id = auth_user.id;

    let from = (q.from_year, q.from_month);
    let to = (q.to_year, q.to_month);
    if from > to {
        return Err(AppError::BadRequest("from must be <= to".to_string()));
    }

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
            match row.budget_link_type.as_str() {
                "unlinked" => unbudgeted += row.amount,
                "manual" | "auto" => {
                    match row
                        .budget_type
                        .as_deref()
                        .and_then(|s| s.parse::<BudgetType>().ok())
                    {
                        Some(BudgetType::Expense) => expense += row.amount,
                        Some(BudgetType::Income) => income += row.amount,
                        Some(BudgetType::Savings) => savings += row.amount,
                        None => unbudgeted += row.amount,
                    }
                }
                _ => {}
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
                        amount: Decimal::new(-800, 0),
                        budget_link_type: "manual".to_string(),
                        budget_type: Some("expense".to_string()),
                    },
                    SummaryRow {
                        amount: Decimal::new(-50, 0),
                        budget_link_type: "unlinked".to_string(),
                        budget_type: None,
                    },
                    SummaryRow {
                        amount: Decimal::new(3000, 0),
                        budget_link_type: "auto".to_string(),
                        budget_type: Some("income".to_string()),
                    },
                    SummaryRow {
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
}
