use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::budget::{
        Budget, BudgetKind, BudgetType, ClosedPeriod, CurrentPeriod, LabelPattern, Recurrence,
        Rule, YearMonth,
    },
    error::{AppError, AppResult},
    repositories::{
        BudgetRepository, BudgetSortField, ListBudgetsParams, OperationRepository, SortOrder,
    },
    services::matcher::{MatcherService, MatcherServiceImpl},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// A budget category used to classify and track spending.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetResponse {
    /// Unique identifier of the budget.
    pub id: Uuid,
    /// Human-readable name of the budget category (e.g. "Rent", "Groceries").
    pub label: String,
    /// Whether this budget tracks expenses, income, or savings.
    pub budget_type: BudgetType,
    /// Recurring (with periods) or occasional (single month) budget definition.
    pub kind: BudgetKind,
    /// Auto-matching rules used to link operations to this budget.
    pub rules: Vec<Rule>,
    /// Timestamp when the budget was created.
    pub created_at: DateTime<Utc>,
}

impl From<Budget> for BudgetResponse {
    fn from(b: Budget) -> Self {
        Self {
            id: b.id,
            label: b.label,
            budget_type: b.budget_type,
            kind: b.kind,
            rules: b.rules,
            created_at: b.created_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBudgetRequest {
    /// Human-readable name of the budget category.
    pub label: String,
    /// Whether this budget tracks expenses, income, or savings.
    pub budget_type: BudgetType,
    /// Recurring or occasional budget definition.
    pub kind: BudgetKindRequest,
    /// Auto-matching rules for linking operations automatically.
    pub rules: Vec<RuleRequest>,
}

/// Defines the budget scheduling type. Discriminated by the `type` field.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BudgetKindRequest {
    /// A recurring budget with at least one period. Past periods have a
    /// definite end date; only the current (last) period may be open-ended.
    Recurring {
        /// How often the budget repeats (weekly, monthly, quarterly, yearly).
        recurrence: Recurrence,
        /// Past periods whose date range is fully known (may be empty).
        #[serde(rename = "closedPeriods")]
        closed_periods: Vec<ClosedPeriodRequest>,
        /// The latest / active period, whose end date is optional.
        #[serde(rename = "currentPeriod")]
        current_period: CurrentPeriodRequest,
    },
    /// A one-off budget for a single specific month.
    Occasional {
        /// Month number (1–12).
        month: u32,
        /// Four-digit year.
        year: u32,
        /// Budgeted amount for that month (as a decimal string).
        #[schemars(with = "String")]
        amount: Decimal,
    },
}

/// A past period within a recurring budget whose month range is fully known.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClosedPeriodRequest {
    /// First month of the period (inclusive).
    pub start: YearMonth,
    /// Last month of the period (inclusive).
    pub end: YearMonth,
    /// Budgeted amount for this period (as a decimal string).
    #[schemars(with = "String")]
    pub amount: Decimal,
}

/// The current (last) period of a recurring budget. Its end month is optional.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPeriodRequest {
    /// First month of the period (inclusive).
    pub start: YearMonth,
    /// Last month of the period (inclusive). Omit if the period is open-ended.
    pub end: Option<YearMonth>,
    /// Budgeted amount for this period (as a decimal string).
    #[schemars(with = "String")]
    pub amount: Decimal,
}

/// An auto-matching rule that links operations to a budget based on their label.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuleRequest {
    /// Pattern to match against the operation label.
    pub label_pattern: LabelPatternRequest,
    /// When true, the operation amount must also match the budget amount.
    pub match_amount: bool,
}

/// Pattern used to match operation labels. Discriminated by the `type` field; the matched text goes in `value`.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum LabelPatternRequest {
    /// Match labels that begin with the given text (case-insensitive).
    StartsWith(String),
    /// Match labels that end with the given text (case-insensitive).
    EndsWith(String),
    /// Match labels that contain the given text anywhere (case-insensitive).
    Contains(String),
}

#[derive(Debug, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBudgetsQuery {
    /// Field to sort results by (default: `createdAt`).
    pub sort: Option<BudgetSortField>,
    /// Sort direction: `asc` or `desc` (default: `desc`).
    pub order: Option<SortOrder>,
    /// Case-insensitive substring filter on the budget label.
    pub label: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBudgetRequest {
    /// When true, re-link even operations that already have a manual budget link. Default: false.
    #[serde(default)]
    #[schemars(default)]
    pub force: bool,
}

/// Result of applying budget rules to operations.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBudgetResponse {
    /// Number of operations that were newly linked to the budget.
    pub updated: usize,
    /// Number of operations skipped (e.g. already manually linked).
    pub skipped: usize,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_budgets<U, O, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Query(q): Query<ListBudgetsQuery>,
) -> AppResult<Json<Vec<BudgetResponse>>> {
    let params = ListBudgetsParams {
        label_filter: q
            .label
            .as_deref()
            .map(|l| format!("%{}%", l.to_lowercase())),
        sort: q.sort.unwrap_or_default(),
        order: q.order.unwrap_or_default(),
    };

    let budgets = state.budget_repo.list(auth_user.id, &params).await?;
    let data = budgets.into_iter().map(BudgetResponse::from).collect();
    Ok(Json(data))
}

pub async fn get_budget<U, O, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<BudgetResponse>> {
    let budget = state.budget_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(BudgetResponse::from(budget)))
}

pub async fn create_budget<U, O, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<CreateBudgetRequest>,
) -> AppResult<(StatusCode, Json<BudgetResponse>)> {
    let max = state.config.max_budgets_per_user;
    let count = state.budget_repo.count(auth_user.id).await?;
    if count >= i64::from(max) {
        return Err(AppError::Conflict(format!("budget limit reached ({max})")));
    }
    let (kind, rules) = request_to_domain(body.kind, body.rules);
    kind.validate_no_overlap().map_err(AppError::BadRequest)?;
    let budget = state
        .budget_repo
        .create(auth_user.id, &body.label, body.budget_type, &kind, &rules)
        .await?;
    Ok((StatusCode::CREATED, Json(BudgetResponse::from(budget))))
}

pub async fn update_budget<U, O, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateBudgetRequest>,
) -> AppResult<Json<BudgetResponse>> {
    let (kind, rules) = request_to_domain(body.kind, body.rules);
    kind.validate_no_overlap().map_err(AppError::BadRequest)?;
    let budget = state
        .budget_repo
        .update(
            id,
            auth_user.id,
            &body.label,
            body.budget_type,
            &kind,
            &rules,
        )
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(BudgetResponse::from(budget)))
}

pub async fn delete_budget<U, O, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let found = state.budget_repo.delete(id, auth_user.id).await?;
    if !found {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn apply_budget<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(budget_id): Path<Uuid>,
    Json(body): Json<ApplyBudgetRequest>,
) -> AppResult<Json<ApplyBudgetResponse>> {
    let user_id = auth_user.id;
    let budget = state.budget_repo.find_by_id(budget_id, user_id).await?;
    let ops = state.operation_repo.list_all_for_user(user_id).await?;

    let matcher = MatcherServiceImpl;
    let mut updated = 0usize;
    let mut skipped = 0usize;

    for op in ops {
        if !body.force && op.budget_link.is_manual() {
            skipped += 1;
            continue;
        }
        if matcher
            .match_operation(&op, std::slice::from_ref(&budget))
            .is_some()
        {
            state.operation_repo.set_auto_link(op.id, budget.id).await?;
            updated += 1;
        }
    }

    Ok(Json(ApplyBudgetResponse { updated, skipped }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Convert request DTOs to domain types.
fn request_to_domain(kind: BudgetKindRequest, rules: Vec<RuleRequest>) -> (BudgetKind, Vec<Rule>) {
    let domain_kind = match kind {
        BudgetKindRequest::Recurring {
            recurrence,
            closed_periods,
            current_period,
        } => BudgetKind::Recurring {
            recurrence,
            closed_periods: closed_periods
                .into_iter()
                .map(|p| ClosedPeriod {
                    start: p.start,
                    end: p.end,
                    amount: p.amount,
                })
                .collect(),
            current_period: CurrentPeriod {
                start: current_period.start,
                end: current_period.end,
                amount: current_period.amount,
            },
        },
        BudgetKindRequest::Occasional {
            month,
            year,
            amount,
        } => BudgetKind::Occasional {
            month,
            year,
            amount,
        },
    };

    let domain_rules = rules
        .into_iter()
        .map(|r| Rule {
            label_pattern: match r.label_pattern {
                LabelPatternRequest::StartsWith(v) => LabelPattern::StartsWith(v),
                LabelPatternRequest::EndsWith(v) => LabelPattern::EndsWith(v),
                LabelPatternRequest::Contains(v) => LabelPattern::Contains(v),
            },
            match_amount: r.match_amount,
        })
        .collect();

    (domain_kind, domain_rules)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::BudgetKind,
            operation::{BudgetLink, Operation},
            user::UserRole,
        },
        error::AppError,
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use chrono::{NaiveDate, Utc};
    use rust_decimal::Decimal;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn make_budget(id: Uuid, user_id: Uuid) -> Budget {
        Budget {
            id,
            user_id,
            label: "Test".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(-100, 0),
                },
            },
            rules: vec![],
            created_at: Utc::now(),
        }
    }

    fn make_op_unlinked(user_id: Uuid) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id,
            amount: Decimal::new(-50, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 5).unwrap(),
            label: "Op".to_string(),
            effective_date: None,
            budget_link: BudgetLink::Unlinked,
            ignored: false,
        }
    }

    fn create_budget_json() -> String {
        serde_json::to_string(&CreateBudgetRequest {
            label: "Loyer".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKindRequest::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriodRequest {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(-800, 0),
                },
            },
            rules: vec![],
        })
        .unwrap()
    }

    #[tokio::test]
    async fn list_budgets_returns_all_budgets() {
        let user_id = Uuid::new_v4();
        let budgets = vec![make_budget(Uuid::new_v4(), user_id)];
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo.expect_list().once().returning(move |_, _| {
            let budgets = budgets.clone();
            Box::pin(async move { Ok(budgets) })
        });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/budgets", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: Vec<BudgetResponse> = response_json(resp).await;
        assert_eq!(json.len(), 1);
    }

    #[tokio::test]
    async fn create_budget_returns_201() {
        let user_id = Uuid::new_v4();
        let budget = make_budget(Uuid::new_v4(), user_id);
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_count()
            .once()
            .returning(|_| Box::pin(async { Ok(0) }));
        budget_repo
            .expect_create()
            .once()
            .returning(move |_, _, _, _, _| {
                let budget = budget.clone();
                Box::pin(async { Ok(budget) })
            });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = create_budget_json();
        let req = json_request("POST", "/budgets", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn create_budget_returns_409_when_limit_reached() {
        let user_id = Uuid::new_v4();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_count()
            .once()
            .returning(|_| Box::pin(async { Ok(100) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = create_budget_json();
        let req = json_request("POST", "/budgets", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_budget_returns_400_when_periods_overlap() {
        let user_id = Uuid::new_v4();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_count()
            .once()
            .returning(|_| Box::pin(async { Ok(0) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let body = r#"{
            "label": "Test",
            "budgetType": "expense",
            "kind": {
                "type": "recurring",
                "recurrence": "monthly",
                "closedPeriods": [
                    {"start": {"year": 2023, "month": 1}, "end": {"year": 2023, "month": 8}, "amount": "-700.00"}
                ],
                "currentPeriod": {
                    "start": {"year": 2023, "month": 6},
                    "end": null,
                    "amount": "-800.00"
                }
            },
            "rules": []
        }"#;
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("POST", "/budgets", Some(body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn update_budget_not_found_returns_404() {
        let user_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_update()
            .once()
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(None) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = create_budget_json();
        let req = json_request(
            "PUT",
            &format!("/budgets/{budget_id}"),
            Some(&body),
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn apply_budget_skips_manual_when_no_force() {
        let user_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let budget = make_budget(budget_id, user_id);

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_find_by_id()
            .once()
            .returning(move |_, _| {
                let budget = budget.clone();
                Box::pin(async { Ok(budget) })
            });

        let manual_op = Operation {
            budget_link: BudgetLink::Manual { budget_id },
            ..make_op_unlinked(user_id)
        };
        op_repo
            .expect_list_all_for_user()
            .once()
            .returning(move |_| {
                let op = manual_op.clone();
                Box::pin(async { Ok(vec![op]) })
            });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{"force": false}"#;
        let req = json_request(
            "POST",
            &format!("/budgets/{budget_id}/apply"),
            Some(body),
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ApplyBudgetResponse = response_json(resp).await;
        assert_eq!(json.skipped, 1);
        assert_eq!(json.updated, 0);
    }

    #[tokio::test]
    async fn apply_budget_budget_not_found_returns_404() {
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_find_by_id()
            .once()
            .returning(|_, _| Box::pin(async { Err(AppError::NotFound) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let budget_id = Uuid::new_v4();
        let body = r#"{"force": false}"#;
        let req = json_request(
            "POST",
            &format!("/budgets/{budget_id}/apply"),
            Some(body),
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn deserialize_frontend_recurring_payload() {
        // The enum uses rename_all=camelCase which renames variant names,
        // but internal fields of variants keep their own rename rules.
        // Fields like closed_periods/current_period must be sent as
        // closedPeriods/currentPeriod because the enum-level rename_all
        // applies to field names too in internally-tagged enums.
        let json = r#"{
            "label": "Loyer",
            "budgetType": "expense",
            "kind": {
                "type": "recurring",
                "recurrence": "monthly",
                "closedPeriods": [],
                "currentPeriod": {
                    "start": {"year": 2024, "month": 1},
                    "end": null,
                    "amount": "-800.00"
                }
            },
            "rules": []
        }"#;
        let req: CreateBudgetRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.label, "Loyer");
    }

    #[test]
    fn deserialize_frontend_recurring_with_closed_periods() {
        let json = r#"{
            "label": "Loyer",
            "budgetType": "expense",
            "kind": {
                "type": "recurring",
                "recurrence": "monthly",
                "closedPeriods": [
                    {"start": {"year": 2023, "month": 1}, "end": {"year": 2023, "month": 12}, "amount": "-700.00"}
                ],
                "currentPeriod": {
                    "start": {"year": 2024, "month": 1},
                    "end": null,
                    "amount": "-800.00"
                }
            },
            "rules": []
        }"#;
        let req: CreateBudgetRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.label, "Loyer");
    }

    #[test]
    fn serialize_budget_response_uses_camel_case() {
        let budget = Budget {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            label: "Loyer".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(-800, 0),
                },
            },
            rules: vec![],
            created_at: Utc::now(),
        };
        let resp = BudgetResponse::from(budget);
        let json = serde_json::to_string(&resp).unwrap();

        // Ensure the JSON uses camelCase field names
        assert!(
            json.contains("\"closedPeriods\""),
            "expected closedPeriods in JSON: {json}"
        );
        assert!(
            json.contains("\"currentPeriod\""),
            "expected currentPeriod in JSON: {json}"
        );
        assert!(
            json.contains("\"budgetType\""),
            "expected budgetType in JSON: {json}"
        );
        // Ensure it does NOT contain snake_case
        assert!(
            !json.contains("\"closed_periods\""),
            "unexpected closed_periods in JSON: {json}"
        );
        assert!(
            !json.contains("\"current_period\""),
            "unexpected current_period in JSON: {json}"
        );
    }

    #[test]
    fn deserialize_frontend_occasional_payload() {
        let json = r#"{
            "label": "Vacances",
            "budgetType": "expense",
            "kind": {
                "type": "occasional",
                "month": 7,
                "year": 2024,
                "amount": "-2000.00"
            },
            "rules": []
        }"#;
        let req: CreateBudgetRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.label, "Vacances");
    }
}
