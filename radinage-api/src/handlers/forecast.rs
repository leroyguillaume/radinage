use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::budget::YearMonth,
    error::{AppError, AppResult},
    repositories::{BudgetRepository, OperationRepository, UserRepository},
    services::forecast::{
        Flows, Forecast, ForecastInput, ForecastMonth, MonthStatus, balance_adjustment_window,
        compute_forecast, horizon, starting_balance, unbudgeted_history,
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
    /// The month in progress: actual amounts so far, plus what the budgets still expect.
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
    /// Expense-budget amounts plus negative unbudgeted operations, plus `unbudgetedForecast`.
    #[schemars(with = "String")]
    pub expenses: Decimal,
    #[schemars(with = "String")]
    pub savings: Decimal,
    /// Income + expenses + savings.
    #[schemars(with = "String")]
    pub balance: Decimal,
    /// Part of the balance the budgets still expect this month on top of what is already
    /// linked to them (each budget's expected amount not yet reached). Zero outside the
    /// current month.
    #[schemars(with = "String")]
    pub committed: Decimal,
    /// Unbudgeted spending expected at `unbudgetedRate` and included in `expenses`: over the
    /// days after today for the current month, over every day for a future month, zero for a
    /// past month.
    #[schemars(with = "String")]
    pub unbudgeted_forecast: Decimal,
    /// Account balance at the end of this month: `startingBalance` (zero when none is
    /// recorded) plus the balances from the first month of the horizon up to this one.
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
            committed: m.committed,
            unbudgeted_forecast: m.unbudgeted_forecast,
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
    /// Account balance at the start of the first day of the horizon, derived from the balance
    /// recorded with `PUT /users/me/balance`: plus the operations accounted after its date and
    /// before the horizon, or minus those accounted from the horizon start through its date
    /// when it is more recent (operations on the balance date are included in it). Null when
    /// no balance is recorded, in which case the running balance starts from zero.
    #[schemars(with = "Option<String>")]
    pub starting_balance: Option<Decimal>,
    /// Cumulative balance at the end of the last month.
    #[schemars(with = "String")]
    pub end_balance: Decimal,
    /// Average daily spending outside any budget over the three complete months before the
    /// current one (negative operations only, days without any counted as zero), rounded to
    /// four decimals. Zero or negative; independent of the horizon.
    #[schemars(with = "String")]
    pub unbudgeted_rate: Decimal,
    /// Days from today (server date) to the last day of the horizon, both included; counted
    /// from the first day of the horizon when it has not started yet, zero once it is over.
    pub days_left: u32,
    /// What can still be spent per day on things outside any budget without ending the
    /// horizon below zero: (`endBalance` minus the summed `unbudgetedForecast`) / `daysLeft`,
    /// rounded to the cent. Negative when the budgets alone already end in the red; null when
    /// the horizon is over (`daysLeft` is zero).
    #[schemars(with = "Option<String>")]
    pub daily_budget: Option<Decimal>,
    /// First month of the horizon whose `cumulative` is below zero, null when none is.
    pub first_negative_month: Option<YearMonth>,
}

impl From<Forecast> for ForecastResponse {
    fn from(forecast: Forecast) -> Self {
        Self {
            months: forecast.months.iter().map(Into::into).collect(),
            totals: forecast.totals.into(),
            starting_balance: forecast.starting_balance,
            end_balance: forecast.end_balance,
            unbudgeted_rate: forecast.unbudgeted_rate,
            days_left: forecast.days_left,
            daily_budget: forecast.daily_budget,
            first_negative_month: forecast.first_negative_month,
        }
    }
}

pub async fn get_forecast<U: UserRepository, O: OperationRepository, B: BudgetRepository>(
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

    let today = chrono::Local::now().date_naive();
    let rows = state
        .operation_repo
        .list_for_summary(auth_user.id, start, end)
        .await?;
    let (history_start, history_end) = unbudgeted_history(today);
    let extra_history = if start <= history_start && history_end <= end {
        None
    } else {
        Some(
            state
                .operation_repo
                .list_for_summary(auth_user.id, history_start, history_end)
                .await?,
        )
    };
    let budgets = state.budget_repo.list_all_for_user(auth_user.id).await?;
    let starting_balance = match state.user_repo.find_balance(auth_user.id).await? {
        None => None,
        Some(balance) => Some(match balance_adjustment_window(balance.date, start) {
            Some((first, last)) if start <= first && last <= end => {
                starting_balance(balance, start, &rows)
            }
            Some((first, last)) => {
                let between = state
                    .operation_repo
                    .list_for_summary(auth_user.id, first, last)
                    .await?;
                starting_balance(balance, start, &between)
            }
            None => balance.amount,
        }),
    };

    let forecast = compute_forecast(&ForecastInput {
        from,
        months,
        today,
        budgets: &budgets,
        rows: &rows,
        history: extra_history.as_deref().unwrap_or(&rows),
        starting_balance,
    });
    Ok(Json(forecast.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType, CurrentPeriod, Recurrence},
            user::{AccountBalance, UserRole},
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

    /// Expect the fetch of the unbudgeted-rate history window, answering `rows`.
    fn expect_history(or: &mut MockOperationRepository, rows: Vec<SummaryRow>) {
        let (start, end) = unbudgeted_history(chrono::Local::now().date_naive());
        or.expect_list_for_summary()
            .withf(move |_, s, e| *s == start && *e == end)
            .times(1)
            .returning(move |_, _, _| {
                let rows = rows.clone();
                Box::pin(async move { Ok(rows) })
            });
    }

    fn expect_no_history(or: &mut MockOperationRepository) {
        expect_history(or, vec![]);
    }

    fn users_with_balance(user_id: Uuid, balance: Option<AccountBalance>) -> MockUserRepository {
        let mut ur = MockUserRepository::new();
        ur.expect_find_balance()
            .withf(move |uid| *uid == user_id)
            .returning(move |_| Box::pin(async move { Ok(balance) }));
        ur
    }

    async fn get(
        operation_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        user_id: Uuid,
        query: &str,
    ) -> axum::response::Response {
        get_with_balance(operation_repo, budget_repo, user_id, None, query).await
    }

    async fn get_with_balance(
        operation_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        user_id: Uuid,
        balance: Option<AccountBalance>,
        query: &str,
    ) -> axum::response::Response {
        let app = build_test_router(make_test_state(
            users_with_balance(user_id, balance),
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
        expect_no_history(&mut or);
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
                     "committed": "0", "unbudgetedForecast": "0", "cumulative": "400.00"},
                    {"year": 2020, "month": 12, "status": "past", "income": "0",
                     "expenses": "0", "savings": "0", "balance": "0", "committed": "0",
                     "unbudgetedForecast": "0", "cumulative": "400.00"},
                    {"year": 2021, "month": 1, "status": "past", "income": "0",
                     "expenses": "0", "savings": "-300.00", "balance": "-300.00",
                     "committed": "0", "unbudgetedForecast": "0", "cumulative": "100.00"},
                ],
                "totals": {"income": "1200.00", "expenses": "-800.00", "savings": "-300.00",
                           "balance": "100.00"},
                "startingBalance": null,
                "endBalance": "100.00",
                "unbudgetedRate": "0",
                "daysLeft": 0,
                "dailyBudget": null,
                "firstNegativeMonth": null,
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
    async fn current_month_exposes_what_budgets_still_expect() {
        let user_id = Uuid::new_v4();
        let current = YearMonth::of(chrono::Local::now().date_naive());
        let groceries = monthly_budget(user_id, BudgetType::Expense, dec!(-550));
        let groceries_id = groceries.id;
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary().returning(move |_, start, _| {
            Box::pin(async move {
                Ok(vec![SummaryRow {
                    amount: dec!(-330),
                    date: start,
                    budget_link_type: "manual".to_string(),
                    budget_id: Some(groceries_id),
                    budget_type: Some("expense".to_string()),
                }])
            })
        });
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user().returning(move |_| {
            let groceries = groceries.clone();
            Box::pin(async move { Ok(vec![groceries]) })
        });

        let resp = get(
            or,
            br,
            user_id,
            &format!(
                "fromYear={}&fromMonth={}&months=1",
                current.year, current.month
            ),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        let month = &json.months[0];
        assert_eq!(month.status, ForecastMonthStatus::Current);
        assert_eq!(month.expenses, dec!(-550));
        assert_eq!(month.committed, dec!(-220));
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

    #[tokio::test]
    async fn future_months_forecast_unbudgeted_spending_from_the_history_window() {
        let user_id = Uuid::new_v4();
        let (history_start, history_end) = unbudgeted_history(chrono::Local::now().date_naive());
        let history_days = (history_end - history_start).num_days() + 1;
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, start, _| *start == NaiveDate::from_ymd_opt(2099, 2, 1).unwrap())
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        expect_history(
            &mut or,
            vec![
                unlinked(history_start, Decimal::from(-10 * history_days)),
                unlinked(history_end, dec!(5000)),
            ],
        );
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        let resp = get(or, br, user_id, "fromYear=2099&fromMonth=2&months=2").await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        assert_eq!(json.unbudgeted_rate, dec!(-10));
        let months: Vec<_> = json
            .months
            .iter()
            .map(|m| (m.unbudgeted_forecast, m.expenses))
            .collect();
        assert_eq!(
            months,
            vec![(dec!(-280), dec!(-280)), (dec!(-310), dec!(-310))]
        );
        assert_eq!(json.end_balance, dec!(-590));
    }

    #[tokio::test]
    async fn history_inside_the_horizon_is_fetched_once() {
        let user_id = Uuid::new_v4();
        let today = chrono::Local::now().date_naive();
        let (history_start, _) = unbudgeted_history(today);
        let from = YearMonth::of(history_start);
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .times(1)
            .returning(move |_, _, _| {
                Box::pin(async move { Ok(vec![unlinked(history_start, dec!(-50))]) })
            });
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        let resp = get(
            or,
            br,
            user_id,
            &format!("fromYear={}&fromMonth={}&months=4", from.year, from.month),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        assert!(json.unbudgeted_rate < Decimal::ZERO);
        // The history row is counted once, in its own past month.
        assert_eq!(json.months[0].expenses, dec!(-50));
        assert_eq!(json.months[0].unbudgeted_forecast, Decimal::ZERO);
    }

    #[tokio::test]
    async fn future_horizon_exposes_daily_budget_and_first_negative_month() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user().returning(move |_| {
            Box::pin(async move {
                Ok(vec![
                    monthly_budget(user_id, BudgetType::Income, dec!(1000)),
                    monthly_budget(user_id, BudgetType::Expense, dec!(-1060)),
                ])
            })
        });

        let resp = get(or, br, user_id, "fromYear=2099&fromMonth=1&months=2").await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        // -60 per month over January and February 2099 (59 days), no unbudgeted history.
        assert_eq!(json["endBalance"], "-120");
        assert_eq!(json["daysLeft"], 59);
        assert_eq!(json["dailyBudget"], "-2.03");
        assert_eq!(
            json["firstNegativeMonth"],
            serde_json::json!({"year": 2099, "month": 1})
        );
    }

    fn no_budgets() -> MockBudgetRepository {
        let mut br = MockBudgetRepository::new();
        br.expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        br
    }

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[tokio::test]
    async fn an_older_balance_is_brought_forward_to_the_horizon_start() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, start, end| *start == day(2020, 1, 1) && *end == day(2020, 1, 31))
            .times(1)
            .returning(|_, _, _| {
                Box::pin(async { Ok(vec![unlinked(day(2020, 1, 10), dec!(-100))]) })
            });
        or.expect_list_for_summary()
            .withf(|_, start, end| *start == day(2019, 11, 16) && *end == day(2019, 12, 31))
            .times(1)
            .returning(|_, _, _| {
                Box::pin(async {
                    Ok(vec![
                        unlinked(day(2019, 11, 20), dec!(-40)),
                        unlinked(day(2019, 12, 31), dec!(15.50)),
                    ])
                })
            });
        expect_no_history(&mut or);
        let balance = AccountBalance {
            amount: dec!(1000),
            date: day(2019, 11, 15),
        };

        let resp = get_with_balance(
            or,
            no_budgets(),
            user_id,
            Some(balance),
            "fromYear=2020&fromMonth=1&months=1",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        assert_eq!(json.starting_balance, Some(dec!(975.50)));
        assert_eq!(json.months[0].cumulative, dec!(875.50));
        assert_eq!(json.end_balance, dec!(875.50));
    }

    #[tokio::test]
    async fn a_balance_inside_the_horizon_reuses_its_rows() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, start, end| *start == day(2020, 1, 1) && *end == day(2020, 2, 29))
            .times(1)
            .returning(|_, _, _| {
                Box::pin(async {
                    Ok(vec![
                        unlinked(day(2020, 1, 10), dec!(-100)),
                        unlinked(day(2020, 2, 5), dec!(-20)),
                        unlinked(day(2020, 2, 20), dec!(-7)),
                    ])
                })
            });
        expect_no_history(&mut or);
        let balance = AccountBalance {
            amount: dec!(500),
            date: day(2020, 2, 5),
        };

        let resp = get_with_balance(
            or,
            no_budgets(),
            user_id,
            Some(balance),
            "fromYear=2020&fromMonth=1&months=2",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        // 500 + 100 + 20: the operations up to and on the balance date are taken back out.
        assert_eq!(json.starting_balance, Some(dec!(620)));
        assert_eq!(json.end_balance, dec!(493));
    }

    #[tokio::test]
    async fn a_balance_after_the_horizon_fetches_the_operations_up_to_it() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, start, end| *start == day(2020, 1, 1) && *end == day(2020, 1, 31))
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        or.expect_list_for_summary()
            .withf(|_, start, end| *start == day(2020, 1, 1) && *end == day(2020, 3, 1))
            .times(1)
            .returning(|_, _, _| {
                Box::pin(async { Ok(vec![unlinked(day(2020, 2, 1), dec!(-60))]) })
            });
        expect_no_history(&mut or);
        let balance = AccountBalance {
            amount: dec!(40),
            date: day(2020, 3, 1),
        };

        let resp = get_with_balance(
            or,
            no_budgets(),
            user_id,
            Some(balance),
            "fromYear=2020&fromMonth=1&months=1",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ForecastResponse = response_json(resp).await;
        assert_eq!(json.starting_balance, Some(dec!(100)));
    }

    #[tokio::test]
    async fn a_balance_on_the_eve_of_the_horizon_is_taken_as_is() {
        let user_id = Uuid::new_v4();
        let mut or = MockOperationRepository::new();
        or.expect_list_for_summary()
            .withf(|_, start, _| *start == day(2099, 1, 1))
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(vec![]) }));
        expect_no_history(&mut or);
        let balance = AccountBalance {
            amount: dec!(310),
            date: day(2098, 12, 31),
        };

        let resp = get_with_balance(
            or,
            no_budgets(),
            user_id,
            Some(balance),
            "fromYear=2099&fromMonth=1&months=1",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["startingBalance"], "310");
        assert_eq!(json["endBalance"], "310");
        // 310 over the 31 days of January 2099.
        let daily_budget: Decimal = json["dailyBudget"].as_str().unwrap().parse().unwrap();
        assert_eq!(daily_budget, dec!(10));
    }
}
