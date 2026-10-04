use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::budget::YearMonth,
    error::{AppError, AppResult},
    repositories::{BudgetRepository, OperationRepository},
    services::forecast::{
        Flows, Forecast, ForecastInput, ForecastMonth, MonthStatus, compute_forecast, horizon,
    },
};
use axum::{
    Json,
    extract::{Query, State},
};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

const MAX_FORECAST_MONTHS: u32 = 24;

/// Query parameters for the forecast endpoint.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastQuery {
    /// Year of the first month of the horizon.
    pub from_year: i32,
    /// First month of the horizon (1–12).
    pub from_month: u32,
    /// Number of months in the horizon (1–24).
    pub months: u32,
}

/// Position of a month relative to today (server date).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "camelCase")]
pub enum ForecastMonthStatus {
    /// A month before the current one: actual amounts.
    Past,
    /// The month in progress: actual amounts so far.
    Current,
    /// A month after the current one: amounts expected by the budgets.
    Future,
}

impl From<MonthStatus> for ForecastMonthStatus {
    fn from(status: MonthStatus) -> Self {
        match status {
            MonthStatus::Past => Self::Past,
            MonthStatus::Current => Self::Current,
            MonthStatus::Future => Self::Future,
        }
    }
}

/// Forecast flows of one month. Income is positive, expenses and savings negative.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastMonthResponse {
    pub year: i32,
    /// Month number (1–12).
    pub month: u32,
    pub status: ForecastMonthStatus,
    /// Income-budget amounts plus positive unbudgeted operations.
    #[schemars(with = "String")]
    pub income: Decimal,
    /// Expense-budget amounts plus negative unbudgeted operations.
    #[schemars(with = "String")]
    pub expenses: Decimal,
    #[schemars(with = "String")]
    pub savings: Decimal,
    /// Income + expenses + savings.
    #[schemars(with = "String")]
    pub balance: Decimal,
    /// Sum of the balances from the first month of the horizon up to this one.
    #[schemars(with = "String")]
    pub cumulative: Decimal,
}

impl From<&ForecastMonth> for ForecastMonthResponse {
    fn from(m: &ForecastMonth) -> Self {
        Self {
            year: m.month.year,
            month: m.month.month,
            status: m.status.into(),
            income: m.flows.income,
            expenses: m.flows.expenses,
            savings: m.flows.savings,
            balance: m.flows.balance(),
            cumulative: m.cumulative,
        }
    }
}

/// Flows summed over every month of the horizon.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastTotalsResponse {
    #[schemars(with = "String")]
    pub income: Decimal,
    #[schemars(with = "String")]
    pub expenses: Decimal,
    #[schemars(with = "String")]
    pub savings: Decimal,
    #[schemars(with = "String")]
    pub balance: Decimal,
}

impl From<Flows> for ForecastTotalsResponse {
    fn from(flows: Flows) -> Self {
        Self {
            income: flows.income,
            expenses: flows.expenses,
            savings: flows.savings,
            balance: flows.balance(),
        }
    }
}

/// Month-by-month forecast over the requested horizon.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastResponse {
    pub months: Vec<ForecastMonthResponse>,
    pub totals: ForecastTotalsResponse,
    /// Cumulative balance at the end of the last month.
    #[schemars(with = "String")]
    pub end_balance: Decimal,
}

impl From<Forecast> for ForecastResponse {
    fn from(forecast: Forecast) -> Self {
        Self {
            months: forecast.months.iter().map(Into::into).collect(),
            totals: forecast.totals.into(),
            end_balance: forecast.end_balance,
        }
    }
}

pub async fn get_forecast<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Query(q): Query<ForecastQuery>,
) -> AppResult<Json<ForecastResponse>> {
    if !(1..=MAX_FORECAST_MONTHS).contains(&q.months) {
        return Err(AppError::BadRequest(format!(
            "months must be between 1 and {MAX_FORECAST_MONTHS}"
        )));
    }
    let invalid =
        || AppError::BadRequest(format!("invalid month: {}-{}", q.from_year, q.from_month));
    let from = YearMonth::new(q.from_year, q.from_month);
    let months = q.months as usize;
    let start = from.first_day().ok_or_else(invalid)?;
    let end = horizon(from, months)
        .last()
        .and_then(YearMonth::last_day)
        .ok_or_else(invalid)?;

    let rows = state
        .operation_repo
        .list_for_summary(auth_user.id, start, end)
        .await?;
    let budgets = state.budget_repo.list_all_for_user(auth_user.id).await?;

    let forecast = compute_forecast(&ForecastInput {
        from,
        months,
        today: chrono::Local::now().date_naive(),
        budgets: &budgets,
        rows: &rows,
    });
    Ok(Json(forecast.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType, CurrentPeriod, Recurrence},
            user::UserRole,
        },
        repositories::{
            MockBudgetRepository, MockOperationRepository, MockUserRepository, SummaryRow,
        },
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn monthly_budget(user_id: Uuid, budget_type: BudgetType, amount: Decimal) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id,
            label: "Budget".to_string(),
            budget_type,
            kind: BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2000, 1),
                    end: None,
                    amount,
                },
            },
            rules: vec![],
            created_at: chrono::Utc::now(),
        }
    }

    fn unlinked(date: NaiveDate, amount: Decimal) -> SummaryRow {
        SummaryRow {
            amount,
            date,
            budget_link_type: "unlinked".to_string(),
            budget_id: None,
            budget_type: None,
        }
    }

    async fn get(
        operation_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        user_id: Uuid,
        query: &str,
    ) -> axum::response::Response {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            operation_repo,
            budget_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        app.oneshot(json_request(
            "GET",
            &format!("/forecast?{query}"),
            None,
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn past_months_use_actuals_and_classify_unbudgeted_by_sign() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(move |uid, start, end| {
                *uid == user_id
                    && *start == NaiveDate::from_ymd_opt(2020, 11, 1).unwrap()
                    && *end == NaiveDate::from_ymd_opt(2021, 1, 31).unwrap()
            })
            .returning(|_, _, _| {
                Box::pin(async {
                    let nov = NaiveDate::from_ymd_opt(2020, 11, 4).unwrap();
                    let jan = NaiveDate::from_ymd_opt(2021, 1, 20).unwrap();
                    Ok(vec![
                        unlinked(nov, dec!(1200.00)),
                        unlinked(nov, dec!(-800.00)),
                        SummaryRow {
                            amount: dec!(-300.00),
                            date: jan,
                            budget_link_type: "auto".to_string(),
                            budget_id: Some(Uuid::nil()),
                            budget_type: Some("savings".to_string()),
                        },
                    ])
                })
            });
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        let resp = get(or, br, user_id, "fromYear=2020&fromMonth=11&months=3").await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json,
            serde_json::json!({
                "months": [
                    {"year": 2020, "month": 11, "status": "past", "income": "1200.00",
                     "expenses": "-800.00", "savings": "0", "balance": "400.00",
                     "cumulative": "400.00"},
                    {"year": 2020, "month": 12, "status": "past", "income": "0",
                     "expenses": "0", "savings": "0", "balance": "0", "cumulative": "400.00"},
                    {"year": 2021, "month": 1, "status": "past", "income": "0",
                     "expenses": "0", "savings": "-300.00", "balance": "-300.00",
                     "cumulative": "100.00"},
                ],
                "totals": {"income": "1200.00", "expenses": "-800.00", "savings": "-300.00",
                           "balance": "100.00"},
                "endBalance": "100.00",
            })
        );
    }

    #[tokio::test]
    async fn future_months_use_budgets() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user()
            .withf(move |uid| *uid == user_id)
            .returning(move |_| {
                Box::pin(async move {
                    Ok(vec![
                        monthly_budget(user_id, BudgetType::Income, dec!(2500)),
                        monthly_budget(user_id, BudgetType::Expense, dec!(-800)),
                    ])
                })
            });

        let resp = get(or, br, user_id, "fromYear=2099&fromMonth=1&months=12").await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        assert_eq!(json.months.len(), 12);
        assert!(
            json.months
                .iter()
                .all(|m| m.status == ForecastMonthStatus::Future && m.balance == dec!(1700))
        );
        assert_eq!((json.months[11].year, json.months[11].month), (2099, 12));
        assert_eq!(json.totals.income, dec!(30000));
        assert_eq!(json.totals.expenses, dec!(-9600));
        assert_eq!(json.end_balance, dec!(20400));
    }

    #[tokio::test]
    async fn invalid_horizon_returns_400() {
        for query in [
            "fromYear=2026&fromMonth=1&months=0",
            "fromYear=2026&fromMonth=1&months=25",
            "fromYear=2026&fromMonth=13&months=1",
            "fromYear=2026&fromMonth=0&months=1",
        ] {
            let resp = get(
                MockOperationRepository::new(),
                MockBudgetRepository::new(),
                Uuid::new_v4(),
                query,
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{query}");
        }
    }

    #[tokio::test]
    async fn requires_authentication() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request(
                "GET",
                "/forecast?fromYear=2026&fromMonth=1&months=12",
                None,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
