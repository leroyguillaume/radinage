use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::operation::{
        BudgetLink, NewOperationSplit, Operation, OperationSplit, validate_splits,
    },
    error::{AppError, AppResult},
    repositories::{
        BudgetRepository, ListOperationsParams, OperationRepository, OperationSortField, SortOrder,
    },
    services::matcher::{MatcherService, MatcherServiceImpl},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
#[cfg(test)]
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// A bank operation (debit or credit) on the user's account.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    /// Unique identifier of the operation.
    pub id: Uuid,
    /// Signed amount: negative for expenses, positive for income.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Date the operation was recorded on the bank statement.
    pub date: NaiveDate,
    /// Optional override date used to attribute the operation to a different month.
    pub effective_date: Option<NaiveDate>,
    /// Free-text label describing the operation (e.g. bank statement wording).
    pub label: String,
    /// How this operation is linked to a budget category, if at all.
    pub budget_link: BudgetLink,
    /// Whether this operation is ignored (excluded from summaries and budgets).
    pub ignored: bool,
    /// Parts this operation is split into, ordered by position; empty when not split.
    /// A split operation is accounted through its parts and its own budget link is unlinked.
    pub splits: Vec<OperationSplitResponse>,
}

/// One part of a split operation. It shares the operation's dates and ignored flag.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationSplitResponse {
    /// Unique identifier of the part.
    pub id: Uuid,
    /// Signed amount of the part, with the same sign as the operation amount.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Budget this part is assigned to, or `null` when it is unbudgeted.
    pub budget_id: Option<Uuid>,
}

impl From<OperationSplit> for OperationSplitResponse {
    fn from(split: OperationSplit) -> Self {
        Self {
            id: split.id,
            amount: split.amount,
            budget_id: split.budget_id,
        }
    }
}

impl From<Operation> for OperationResponse {
    fn from(op: Operation) -> Self {
        Self {
            id: op.id,
            amount: op.amount,
            date: op.date,
            effective_date: op.effective_date,
            label: op.label,
            budget_link: op.budget_link,
            ignored: op.ignored,
            splits: op
                .splits
                .into_iter()
                .map(OperationSplitResponse::from)
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateOperationRequest {
    /// Signed amount: negative for expenses, positive for income.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Date the operation occurred.
    pub date: NaiveDate,
    /// Optional override date to attribute the operation to a different month.
    pub effective_date: Option<NaiveDate>,
    /// Free-text label describing the operation.
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOperationRequest {
    /// New signed amount.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// New date.
    pub date: NaiveDate,
    /// Optional override date to attribute the operation to a different month.
    pub effective_date: Option<NaiveDate>,
    /// New label.
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkBudgetRequest {
    /// Identifier of the target budget category.
    pub budget_id: Uuid,
}

/// Full set of parts to split an operation into, replacing any existing split.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "splits": [
        { "amount": "-30", "budgetId": "3f1c2a9e-8d4b-4c7a-9e21-5b6f0d8a1c42" },
        { "amount": "-70", "budgetId": null }
    ]
})))]
pub struct ReplaceOperationSplitsRequest {
    /// At least 2 parts, in display order. Their amounts must be non-zero, share the
    /// operation's sign and sum exactly to the operation amount.
    pub splits: Vec<OperationSplitRequest>,
}

/// One part of a split operation, as sent by the client.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationSplitRequest {
    /// Signed amount of the part.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// One of the caller's budgets, or `null` to leave the part unbudgeted.
    pub budget_id: Option<Uuid>,
}

impl From<OperationSplitRequest> for NewOperationSplit {
    fn from(split: OperationSplitRequest) -> Self {
        Self {
            amount: split.amount,
            budget_id: split.budget_id,
        }
    }
}

#[derive(Debug, Deserialize, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListOperationsQuery {
    /// Field to sort results by (default: `date`).
    pub sort: Option<OperationSortField>,
    /// Sort direction: `asc` or `desc` (default: `desc`).
    pub order: Option<SortOrder>,
    /// Include only operations on or after this date.
    pub date_from: Option<NaiveDate>,
    /// Include only operations on or before this date.
    pub date_to: Option<NaiveDate>,
    /// Case-insensitive substring filter on the operation label.
    pub label: Option<String>,
    /// Filter by exact amount.
    #[schemars(with = "Option<String>")]
    pub amount: Option<Decimal>,
    /// Page number (1-based, default: 1).
    #[schemars(range(min = 1), default = "default_page")]
    pub page: Option<u32>,
    /// Number of results per page (1–500, default: 100).
    #[schemars(range(min = 1, max = 500), default = "default_operations_page_size")]
    pub page_size: Option<u32>,
    /// Include ignored operations in results (default: false).
    #[serde(default)]
    pub include_ignored: bool,
}

fn default_page() -> Option<u32> {
    Some(1)
}

fn default_operations_page_size() -> Option<u32> {
    Some(100)
}

/// Paginated list wrapper returned by all list endpoints.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: JsonSchema> {
    /// Items on the current page.
    pub data: Vec<T>,
    /// Total number of items matching the query.
    pub total: i64,
    /// Current page number (1-based).
    pub page: u32,
    /// Number of items per page.
    pub page_size: u32,
    /// Last available page number.
    pub max_page: u32,
}

#[cfg(test)]
impl<'de, T: JsonSchema + DeserializeOwned> serde::Deserialize<'de> for PaginatedResponse<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Helper<T> {
            data: Vec<T>,
            total: i64,
            page: u32,
            page_size: u32,
            max_page: u32,
        }
        let h = Helper::<T>::deserialize(deserializer)?;
        Ok(Self {
            data: h.data,
            total: h.total,
            page: h.page,
            page_size: h.page_size,
            max_page: h.max_page,
        })
    }
}

pub fn compute_max_page(total: i64, page_size: u32) -> u32 {
    let page_size = page_size.max(1) as i64;
    ((total + page_size - 1) / page_size).max(1) as u32
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_operations<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Query(q): Query<ListOperationsQuery>,
) -> AppResult<Json<PaginatedResponse<OperationResponse>>> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(100).clamp(1, 500);

    let params = ListOperationsParams {
        date_from: q.date_from,
        date_to: q.date_to,
        label_filter: q
            .label
            .as_deref()
            .map(|l| format!("%{}%", l.to_lowercase())),
        amount: q.amount,
        sort: q.sort.unwrap_or_default(),
        order: q.order.unwrap_or_default(),
        limit: page_size as i64,
        offset: ((page - 1) * page_size) as i64,
        include_ignored: q.include_ignored,
    };

    let (ops, total) = state.operation_repo.list(auth_user.id, &params).await?;
    let max_page = compute_max_page(total, page_size);
    let data = ops.into_iter().map(OperationResponse::from).collect();
    Ok(Json(PaginatedResponse {
        data,
        total,
        page,
        page_size,
        max_page,
    }))
}

pub async fn get_operation<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn create_operation<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<CreateOperationRequest>,
) -> AppResult<(StatusCode, Json<OperationResponse>)> {
    let user_id = auth_user.id;
    let id = Uuid::new_v4();
    state
        .operation_repo
        .insert(
            id,
            user_id,
            body.amount,
            body.date,
            body.effective_date,
            &body.label,
        )
        .await?;

    let op = Operation {
        id,
        user_id,
        amount: body.amount,
        date: body.date,
        effective_date: body.effective_date,
        label: body.label,
        budget_link: BudgetLink::Unlinked,
        ignored: false,
        splits: Vec::new(),
    };
    auto_match_operation(&state.operation_repo, &state.budget_repo, &op).await?;

    let updated = state.operation_repo.find_by_id(id, user_id).await?;
    Ok((StatusCode::CREATED, Json(updated.into())))
}

pub async fn update_operation<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateOperationRequest>,
) -> AppResult<Json<OperationResponse>> {
    let current = state.operation_repo.find_by_id(id, auth_user.id).await?;
    if current.is_split() && current.amount != body.amount {
        return Err(AppError::Conflict(
            "the operation is split: remove its splits before changing its amount".to_string(),
        ));
    }
    let found = state
        .operation_repo
        .update(
            id,
            auth_user.id,
            body.amount,
            body.date,
            body.effective_date,
            &body.label,
        )
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn delete_operation<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let found = state.operation_repo.delete(id, auth_user.id).await?;
    if !found {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn link_budget<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(op_id): Path<Uuid>,
    Json(body): Json<LinkBudgetRequest>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    if !state.budget_repo.exists(body.budget_id, user_id).await? {
        return Err(AppError::NotFound);
    }
    ensure_not_split(&state.operation_repo, op_id, user_id).await?;

    let link = BudgetLink::Manual {
        budget_id: body.budget_id,
    };
    let found = state
        .operation_repo
        .set_budget_link(op_id, user_id, &link)
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }

    let op = state.operation_repo.find_by_id(op_id, user_id).await?;
    Ok(Json(op.into()))
}

pub async fn unlink_budget<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    ensure_not_split(&state.operation_repo, id, auth_user.id).await?;
    let found = state
        .operation_repo
        .set_budget_link(id, auth_user.id, &BudgetLink::Unlinked)
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn ignore_operation<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let found = state
        .operation_repo
        .set_ignored(id, auth_user.id, true)
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn unignore_operation<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let found = state
        .operation_repo
        .set_ignored(id, auth_user.id, false)
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn replace_splits<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ReplaceOperationSplitsRequest>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    let op = state.operation_repo.find_by_id(id, user_id).await?;

    let splits: Vec<NewOperationSplit> = body.splits.into_iter().map(Into::into).collect();
    validate_splits(op.amount, &splits).map_err(|e| AppError::BadRequest(e.to_string()))?;

    let mut budget_ids: Vec<Uuid> = splits.iter().filter_map(|s| s.budget_id).collect();
    budget_ids.sort_unstable();
    budget_ids.dedup();
    for budget_id in budget_ids {
        if !state.budget_repo.exists(budget_id, user_id).await? {
            return Err(AppError::BadRequest(format!("unknown budget {budget_id}")));
        }
    }

    if !state
        .operation_repo
        .replace_splits(id, user_id, &splits)
        .await?
    {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, user_id).await?;
    Ok(Json(op.into()))
}

pub async fn clear_splits<U, O: OperationRepository, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    if !state.operation_repo.clear_splits(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

/// Reject changes to the budget link of a split operation, which is accounted through its parts.
async fn ensure_not_split(
    op_repo: &impl OperationRepository,
    id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    if op_repo.find_by_id(id, user_id).await?.is_split() {
        return Err(AppError::Conflict(
            "the operation is split: its budget link cannot be changed".to_string(),
        ));
    }
    Ok(())
}

// ── Auto-matching helper ──────────────────────────────────────────────────────

/// Run automatic budget matching for a single operation.
/// Operations with a Manual link or with splits are never auto-matched.
pub async fn auto_match_operation<OR, BR>(
    op_repo: &OR,
    budget_repo: &BR,
    op: &Operation,
) -> AppResult<()>
where
    OR: OperationRepository,
    BR: BudgetRepository,
{
    if op.budget_link.is_manual() || op.is_split() {
        return Ok(());
    }

    let budgets = budget_repo.list_all_for_user(op.user_id).await?;
    if let Some(budget_id) = MatcherServiceImpl.match_operation(op, &budgets) {
        op_repo.set_auto_link(op.id, budget_id).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::user::UserRole;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType, LabelPattern, Rule},
            operation::BudgetLink,
        },
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use axum::{Router, http::StatusCode, response::Response};
    use chrono::{NaiveDate, Utc};
    use rust_decimal::Decimal;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn make_op(id: Uuid, user_id: Uuid) -> Operation {
        Operation {
            id,
            user_id,
            amount: Decimal::new(-50, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Test".to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            splits: vec![],
        }
    }

    fn make_budget(id: Uuid, user_id: Uuid) -> Budget {
        Budget {
            id,
            user_id,
            label: "Test budget".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(-50, 0),
            },
            rules: vec![],
            created_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn list_operations_returns_empty_page() {
        let user_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_list()
            .once()
            .returning(|_, _| Box::pin(async { Ok((vec![], 0)) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: PaginatedResponse<OperationResponse> = response_json(resp).await;
        assert_eq!(json.data.len(), 0);
        assert_eq!(json.total, 0);
        assert_eq!(json.page, 1);
        assert_eq!(json.page_size, 100);
    }

    #[tokio::test]
    async fn list_operations_pagination_values() {
        let user_id = Uuid::new_v4();
        let ops = vec![make_op(Uuid::new_v4(), user_id)];
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_list().once().returning(move |_, _| {
            let ops = ops.clone();
            Box::pin(async move { Ok((ops, 10)) })
        });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations?page=2&pageSize=5", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: PaginatedResponse<OperationResponse> = response_json(resp).await;
        assert_eq!(json.page, 2);
        assert_eq!(json.page_size, 5);
        assert_eq!(json.total, 10);
    }

    #[tokio::test]
    async fn create_operation_inserts_and_returns_created() {
        let user_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        op_repo
            .expect_insert()
            .once()
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        budget_repo
            .expect_list_all_for_user()
            .once()
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        let op = make_op(Uuid::new_v4(), user_id);
        op_repo.expect_find_by_id().once().returning(move |_, _| {
            let op = op.clone();
            Box::pin(async { Ok(op) })
        });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&CreateOperationRequest {
            amount: Decimal::new(-50, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Groceries".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/operations", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: OperationResponse = response_json(resp).await;
        assert_eq!(json.label, "Test");
    }

    #[tokio::test]
    async fn update_operation_not_found_returns_404() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_find_by_id()
            .once()
            .returning(|_, _| Box::pin(async { Err(AppError::NotFound) }));
        op_repo.expect_update().never();

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&UpdateOperationRequest {
            amount: Decimal::ZERO,
            date: NaiveDate::from_ymd_opt(2024, 1, 1).unwrap(),
            effective_date: None,
            label: "X".to_string(),
        })
        .unwrap();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}"),
            Some(&body),
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn link_budget_budget_not_found_returns_404() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_exists()
            .once()
            .returning(|_, _| Box::pin(async { Ok(false) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&LinkBudgetRequest {
            budget_id: Uuid::new_v4(),
        })
        .unwrap();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/budget"),
            Some(&body),
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn ignore_operation_returns_200() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let op = Operation {
            ignored: true,
            ..make_op(op_id, user_id)
        };
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_ignored()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));
        op_repo.expect_find_by_id().once().returning(move |_, _| {
            let o = op.clone();
            Box::pin(async { Ok(o) })
        });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/ignore"),
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationResponse = response_json(resp).await;
        assert!(json.ignored);
    }

    #[tokio::test]
    async fn ignore_operation_not_found_returns_404() {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_ignored()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(false) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let op_id = Uuid::new_v4();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/ignore"),
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unignore_operation_returns_200() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let op = make_op(op_id, user_id);
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_ignored()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));
        op_repo.expect_find_by_id().once().returning(move |_, _| {
            let o = op.clone();
            Box::pin(async { Ok(o) })
        });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/ignore"),
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationResponse = response_json(resp).await;
        assert!(!json.ignored);
    }

    fn split_op(id: Uuid, user_id: Uuid) -> Operation {
        Operation {
            splits: vec![
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-20, 0),
                    budget_id: None,
                },
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-30, 0),
                    budget_id: None,
                },
            ],
            ..make_op(id, user_id)
        }
    }

    fn split_app(op_repo: MockOperationRepository, budget_repo: MockBudgetRepository) -> Router {
        build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ))
    }

    fn expect_find_returning(op_repo: &mut MockOperationRepository, op: Operation) {
        op_repo.expect_find_by_id().once().returning(move |_, _| {
            let op = op.clone();
            Box::pin(async { Ok(op) })
        });
    }

    async fn put_splits(app: Router, user_id: Uuid, op_id: Uuid, body: &str) -> Response {
        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/splits"),
            Some(body),
            Some(&auth),
        );
        app.oneshot(req).await.unwrap()
    }

    async fn error_message(resp: Response) -> String {
        let json: serde_json::Value = response_json(resp).await;
        json["error"].as_str().unwrap_or_default().to_string()
    }

    #[tokio::test]
    async fn replace_splits_returns_updated_operation() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        let mut lookups = vec![split_op(op_id, user_id), make_op(op_id, user_id)];
        op_repo.expect_find_by_id().times(2).returning(move |_, _| {
            let op = lookups.pop().unwrap();
            Box::pin(async { Ok(op) })
        });
        budget_repo
            .expect_exists()
            .withf(move |id, uid| *id == budget_id && *uid == user_id)
            .once()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_replace_splits()
            .withf(move |id, uid, splits| {
                *id == op_id
                    && *uid == user_id
                    && splits
                        == [
                            NewOperationSplit {
                                amount: Decimal::new(-20, 0),
                                budget_id: Some(budget_id),
                            },
                            NewOperationSplit {
                                amount: Decimal::new(-30, 0),
                                budget_id: None,
                            },
                        ]
            })
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let body = format!(
            r#"{{"splits":[{{"amount":"-20","budgetId":"{budget_id}"}},{{"amount":"-30","budgetId":null}}]}}"#
        );
        let resp = put_splits(split_app(op_repo, budget_repo), user_id, op_id, &body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        let splits = json["splits"].as_array().unwrap();
        assert_eq!(splits.len(), 2);
        assert_eq!(splits[0]["amount"], "-20");
        assert!(splits[0]["id"].is_string());
        assert!(splits[0]["budgetId"].is_null());
        assert!(json.get("userId").is_none());
    }

    #[tokio::test]
    async fn replace_splits_sum_mismatch_returns_400() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, make_op(op_id, user_id));
        op_repo.expect_replace_splits().never();

        let body =
            r#"{"splits":[{"amount":"-20","budgetId":null},{"amount":"-20","budgetId":null}]}"#;
        let resp = put_splits(
            split_app(op_repo, MockBudgetRepository::new()),
            user_id,
            op_id,
            body,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            error_message(resp).await,
            "parts sum to -40 but the operation amount is -50"
        );
    }

    #[tokio::test]
    async fn replace_splits_single_part_returns_400() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, make_op(op_id, user_id));
        op_repo.expect_replace_splits().never();

        let body = r#"{"splits":[{"amount":"-50","budgetId":null}]}"#;
        let resp = put_splits(
            split_app(op_repo, MockBudgetRepository::new()),
            user_id,
            op_id,
            body,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(error_message(resp).await, "a split needs at least 2 parts");
    }

    #[tokio::test]
    async fn replace_splits_unknown_budget_returns_400() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();
        expect_find_returning(&mut op_repo, make_op(op_id, user_id));
        budget_repo
            .expect_exists()
            .once()
            .returning(|_, _| Box::pin(async { Ok(false) }));
        op_repo.expect_replace_splits().never();

        let body = format!(
            r#"{{"splits":[{{"amount":"-20","budgetId":"{budget_id}"}},{{"amount":"-30","budgetId":"{budget_id}"}}]}}"#
        );
        let resp = put_splits(split_app(op_repo, budget_repo), user_id, op_id, &body).await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            error_message(resp).await,
            format!("unknown budget {budget_id}")
        );
    }

    #[tokio::test]
    async fn replace_splits_operation_not_found_returns_404() {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_find_by_id()
            .once()
            .returning(|_, _| Box::pin(async { Err(AppError::NotFound) }));
        op_repo.expect_replace_splits().never();

        let body =
            r#"{"splits":[{"amount":"-20","budgetId":null},{"amount":"-30","budgetId":null}]}"#;
        let resp = put_splits(
            split_app(op_repo, MockBudgetRepository::new()),
            Uuid::new_v4(),
            Uuid::new_v4(),
            body,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn clear_splits_returns_unsplit_operation() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_clear_splits()
            .once()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        expect_find_returning(&mut op_repo, make_op(op_id, user_id));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/splits"),
            None,
            Some(&auth),
        );
        let resp = split_app(op_repo, MockBudgetRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationResponse = response_json(resp).await;
        assert!(json.splits.is_empty());
    }

    #[tokio::test]
    async fn clear_splits_not_found_returns_404() {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_clear_splits()
            .once()
            .returning(|_, _| Box::pin(async { Ok(false) }));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let op_id = Uuid::new_v4();
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/splits"),
            None,
            Some(&auth),
        );
        let resp = split_app(op_repo, MockBudgetRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn link_budget_on_split_operation_returns_409() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_exists()
            .once()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        expect_find_returning(&mut op_repo, split_op(op_id, user_id));
        op_repo.expect_set_budget_link().never();

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&LinkBudgetRequest {
            budget_id: Uuid::new_v4(),
        })
        .unwrap();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/budget"),
            Some(&body),
            Some(&auth),
        );
        let resp = split_app(op_repo, budget_repo).oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(
            error_message(resp).await,
            "the operation is split: its budget link cannot be changed"
        );
    }

    #[tokio::test]
    async fn unlink_budget_on_split_operation_returns_409() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, split_op(op_id, user_id));
        op_repo.expect_set_budget_link().never();

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/budget"),
            None,
            Some(&auth),
        );
        let resp = split_app(op_repo, MockBudgetRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn unlink_budget_on_unsplit_operation_returns_200() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_find_by_id()
            .times(2)
            .returning(move |_, _| Box::pin(async move { Ok(make_op(op_id, user_id)) }));
        op_repo
            .expect_set_budget_link()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/budget"),
            None,
            Some(&auth),
        );
        let resp = split_app(op_repo, MockBudgetRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn update_split_operation_amount_returns_409() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, split_op(op_id, user_id));
        op_repo.expect_update().never();

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&UpdateOperationRequest {
            amount: Decimal::new(-60, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Test".to_string(),
        })
        .unwrap();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}"),
            Some(&body),
            Some(&auth),
        );
        let resp = split_app(op_repo, MockBudgetRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn auto_match_skips_split_operation() {
        let op_repo = MockOperationRepository::new();
        let budget_repo = MockBudgetRepository::new();
        let op = split_op(Uuid::new_v4(), Uuid::new_v4());

        auto_match_operation(&op_repo, &budget_repo, &op)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn auto_match_skips_manual_link() {
        let op_repo = MockOperationRepository::new();
        let budget_repo = MockBudgetRepository::new();
        let op = Operation {
            budget_link: BudgetLink::Manual {
                budget_id: Uuid::new_v4(),
            },
            ..make_op(Uuid::new_v4(), Uuid::new_v4())
        };

        auto_match_operation(&op_repo, &budget_repo, &op)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn auto_match_sets_link_when_rule_matches() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();

        let mut budget = make_budget(budget_id, user_id);
        budget.rules = vec![Rule {
            label_pattern: LabelPattern::Contains("EDF".to_string()),
            match_amount: false,
        }];

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .once()
            .returning(move |_| {
                let budget = budget.clone();
                Box::pin(async { Ok(vec![budget]) })
            });
        op_repo
            .expect_set_auto_link()
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let op = Operation {
            id: op_id,
            label: "PRLV EDF ELECTRICITE".to_string(),
            ..make_op(op_id, user_id)
        };

        auto_match_operation(&op_repo, &budget_repo, &op)
            .await
            .unwrap();
    }
}
