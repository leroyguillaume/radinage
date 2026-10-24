use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::Budget,
        operation::{
            BudgetLink, NewOperation, NewOperationSplit, Operation, OperationSplit, validate_splits,
        },
        transfer::Transfer,
    },
    error::{AppError, AppResult},
    handlers::{
        accounts::account_receiving_operations, categories::ensure_category_is_users,
        ignore_rules::auto_ignore_operation, transfer_rules::auto_transfer_operation,
    },
    repositories::{
        AccountRepository, BudgetRepository, CategoryFilter, CategoryRepository,
        IgnoreRuleRepository, IgnoredFilter, ListOperationsParams, OperationDirection,
        OperationRepository, OperationSortField, OperationTotals, SortOrder,
    },
    services::matcher::{MatcherService, MatcherServiceImpl},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use axum_extra::extract::Query;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// A bank operation (debit or credit) on the user's account.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationResponse {
    /// Unique identifier of the operation.
    pub id: Uuid,
    /// Account the operation was recorded or imported on.
    pub account_id: Uuid,
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
    /// Ignore rule that ignored this operation, `null` when it is ignored by hand or not ignored.
    pub ignore_rule_id: Option<Uuid>,
    /// Category the user put this operation in, `null` when none. Always `null` when split.
    pub category_id: Option<Uuid>,
    /// Category the operation counts towards: its own, else its linked budget's. Always `null`
    /// when split, each part carrying its own.
    pub effective_category_id: Option<Uuid>,
    /// Transfer with another of the user's accounts, `null` when the operation is not one.
    pub transfer: Option<TransferResponse>,
    /// Parts this operation is split into, ordered by position; empty when not split.
    /// A split operation is accounted through its parts and its own budget link is unlinked.
    pub splits: Vec<OperationSplitResponse>,
}

/// An operation's transfer with another of the user's accounts. A transfer with a savings
/// account counts as savings when the operation is a debit, deducted from savings when it is
/// a credit; a transfer with a checking account is neither income nor expense.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransferResponse {
    /// The other account: where the money went, or where it came from.
    pub account_id: Uuid,
    /// Transfer rule that made the operation a transfer, `null` when set by hand or by
    /// pairing.
    pub rule_id: Option<Uuid>,
    /// The operation on the other side, when the other account receives operations and it
    /// has been found.
    pub operation_id: Option<Uuid>,
}

impl From<Transfer> for TransferResponse {
    fn from(t: Transfer) -> Self {
        Self {
            account_id: t.account_id,
            rule_id: t.rule_id,
            operation_id: t.operation_id,
        }
    }
}

/// One part of a split operation. It shares the operation's ignored flag.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationSplitResponse {
    /// Unique identifier of the part.
    pub id: Uuid,
    /// Signed amount of the part, with the same sign as the operation amount.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Optional override date attributing the part to another month than its operation's,
    /// `null` when the part follows the operation.
    pub effective_date: Option<NaiveDate>,
    /// Budget this part is assigned to, or `null` when it is unbudgeted.
    pub budget_id: Option<Uuid>,
    /// Category the user put this part in, `null` when none.
    pub category_id: Option<Uuid>,
    /// Category the part counts towards: its own, else its budget's.
    pub effective_category_id: Option<Uuid>,
}

impl From<OperationSplit> for OperationSplitResponse {
    fn from(split: OperationSplit) -> Self {
        Self {
            id: split.id,
            amount: split.amount,
            effective_date: split.effective_date,
            budget_id: split.budget_id,
            category_id: split.category_id,
            effective_category_id: split.effective_category_id(),
        }
    }
}

impl From<Operation> for OperationResponse {
    fn from(op: Operation) -> Self {
        let effective_category_id = op.effective_category_id();
        Self {
            id: op.id,
            account_id: op.account_id,
            amount: op.amount,
            date: op.date,
            effective_date: op.effective_date,
            label: op.label,
            budget_link: op.budget_link,
            ignored: op.ignored,
            ignore_rule_id: op.ignore_rule_id,
            category_id: op.category_id,
            effective_category_id,
            transfer: op.transfer.map(Into::into),
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
    /// Account to record the operation on: one of the user's imported checking accounts.
    pub account_id: Uuid,
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

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetCategoryRequest {
    /// One of the caller's categories.
    pub category_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetAccountRequest {
    /// One of the caller's imported checking accounts.
    pub account_id: Uuid,
}

/// Body of `PUT /operations/{id}/transfer`.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetTransferRequest {
    /// Another of the caller's accounts: where the money went, or where it came from.
    pub account_id: Uuid,
    /// Operation of that account on the other side of the transfer, of opposite amount; when
    /// omitted, the closest one by date within a few days is looked for.
    #[serde(default)]
    pub counterpart_id: Option<Uuid>,
}

/// Most operations a single request changes at once.
const MAX_OPERATIONS_AT_ONCE: usize = 1000;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetOperationsAccountRequest {
    /// Between 1 and 1000 of the caller's operations; unknown ones are left out.
    pub operation_ids: Vec<Uuid>,
    /// One of the caller's imported checking accounts.
    pub account_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetOperationsCategoryRequest {
    /// Between 1 and 1000 of the caller's operations; unknown and split ones are left out.
    pub operation_ids: Vec<Uuid>,
    /// One of the caller's categories, or `null` to clear the operations' own category.
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OperationsUpdatedResponse {
    /// How many of the requested operations changed.
    pub updated: u64,
}

/// Full set of parts to split an operation into, replacing any existing split.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "splits": [
        {
            "amount": "-30",
            "budgetId": "3f1c2a9e-8d4b-4c7a-9e21-5b6f0d8a1c42",
            "categoryId": null
        },
        {
            "amount": "-70",
            "budgetId": null,
            "categoryId": "9b2e4f1a-6c3d-4e8b-a1f2-7d5c0e9b3a61"
        }
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
    /// Optional override date for the part, or `null` (the default) to follow the operation.
    #[serde(default)]
    pub effective_date: Option<NaiveDate>,
    /// One of the caller's budgets, or `null` to leave the part unbudgeted.
    pub budget_id: Option<Uuid>,
    /// One of the caller's categories, or `null` (the default) to fall back on the budget's.
    #[serde(default)]
    pub category_id: Option<Uuid>,
}

impl From<OperationSplitRequest> for NewOperationSplit {
    fn from(split: OperationSplitRequest) -> Self {
        Self {
            amount: split.amount,
            effective_date: split.effective_date,
            budget_id: split.budget_id,
            category_id: split.category_id,
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
    /// Include only operations whose absolute amount is at least this.
    #[schemars(with = "Option<String>")]
    pub amount_min: Option<Decimal>,
    /// Include only operations whose absolute amount is at most this.
    #[schemars(with = "Option<String>")]
    pub amount_max: Option<Decimal>,
    /// Include only expenses (negative amounts) or only income (positive amounts).
    pub direction: Option<OperationDirection>,
    /// Page number (1-based, default: 1).
    #[schemars(range(min = 1), default = "default_page")]
    pub page: Option<u32>,
    /// Number of results per page (1–500, default: 100).
    #[schemars(range(min = 1, max = 500), default = "default_operations_page_size")]
    pub page_size: Option<u32>,
    /// Keep the operations that are not ignored (`excluded`, default), the ignored ones alone
    /// (`only`) or both (`included`).
    pub ignored: Option<IgnoredFilter>,
    /// Include only operations counting towards one of these categories: an unsplit
    /// operation through its effective category, a split one through any of its parts.
    /// Repeat the parameter for several categories.
    #[serde(default)]
    pub category_id: Vec<Uuid>,
    /// Include operations without an effective category, or split with such a part
    /// (default: false). Combined with `categoryId`, keeps the operations matching either.
    #[serde(default)]
    pub uncategorized: bool,
    /// Include only operations linked to one of these budgets, a split operation through any
    /// of its parts. Repeat the parameter for several budgets.
    #[serde(default)]
    pub budget_id: Vec<Uuid>,
    /// Include only operations of one of these accounts. Repeat the parameter for several
    /// accounts.
    #[serde(default)]
    pub account_id: Vec<Uuid>,
    /// Include only the transfers with one of these accounts. Repeat the parameter for
    /// several accounts.
    #[serde(default)]
    pub transfer_account_id: Vec<Uuid>,
}

fn default_page() -> Option<u32> {
    Some(1)
}

fn default_operations_page_size() -> Option<u32> {
    Some(100)
}

/// One page of operations, with the totals of every operation matching the filters.
#[derive(Debug, Serialize, JsonSchema)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct OperationListResponse {
    /// Operations on the current page.
    pub data: Vec<OperationResponse>,
    /// Total number of operations matching the query.
    pub total: i64,
    /// Current page number (1-based).
    pub page: u32,
    /// Number of items per page.
    pub page_size: u32,
    /// Last available page number.
    pub max_page: u32,
    /// Aggregates over every matching operation, across all pages.
    pub totals: OperationTotalsResponse,
}

/// Aggregates over the operations matching a listing's filters.
#[derive(Debug, Serialize, JsonSchema)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct OperationTotalsResponse {
    /// Sum of the positive amounts.
    #[schemars(with = "String")]
    pub income: Decimal,
    /// Sum of the negative amounts, zero or negative.
    #[schemars(with = "String")]
    pub expense: Decimal,
    /// Earliest accounting date (effective date if set, otherwise date), `null` when nothing
    /// matches.
    pub first_date: Option<NaiveDate>,
    /// Latest accounting date, `null` when nothing matches.
    pub last_date: Option<NaiveDate>,
}

impl From<OperationTotals> for OperationTotalsResponse {
    fn from(totals: OperationTotals) -> Self {
        Self {
            income: totals.income,
            expense: totals.expense,
            first_date: totals.first_date,
            last_date: totals.last_date,
        }
    }
}

pub fn compute_max_page(total: i64, page_size: u32) -> u32 {
    let page_size = page_size.max(1) as i64;
    ((total + page_size - 1) / page_size).max(1) as u32
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_operations<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Query(q): Query<ListOperationsQuery>,
) -> AppResult<Json<OperationListResponse>> {
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(100).clamp(1, 500);

    let params = ListOperationsParams {
        date_from: q.date_from,
        date_to: q.date_to,
        label_filter: q
            .label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| format!("%{}%", l.to_lowercase())),
        amount: q.amount,
        amount_min: q.amount_min,
        amount_max: q.amount_max,
        direction: q.direction,
        sort: q.sort.unwrap_or_default(),
        order: q.order.unwrap_or_default(),
        limit: page_size as i64,
        offset: ((page - 1) * page_size) as i64,
        ignored: q.ignored.unwrap_or_default(),
        category: CategoryFilter {
            category_ids: q.category_id,
            uncategorized: q.uncategorized,
        },
        budget_ids: q.budget_id,
        account_ids: q.account_id,
        transfer_account_ids: q.transfer_account_id,
    };

    let (ops, totals) = state.operation_repo.list(auth_user.id, &params).await?;
    let total = totals.count;
    let max_page = compute_max_page(total, page_size);
    let data = ops.into_iter().map(OperationResponse::from).collect();
    Ok(Json(OperationListResponse {
        data,
        total,
        page,
        page_size,
        max_page,
        totals: totals.into(),
    }))
}

pub async fn get_operation<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn create_operation<
    U,
    O: OperationRepository,
    B: BudgetRepository,
    P,
    C: CategoryRepository,
    R: IgnoreRuleRepository,
    A: AccountRepository,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<CreateOperationRequest>,
) -> AppResult<(StatusCode, Json<OperationResponse>)> {
    let user_id = auth_user.id;
    account_receiving_operations(&state.account_repo, body.account_id, user_id).await?;
    let id = Uuid::new_v4();
    state
        .operation_repo
        .insert(
            id,
            user_id,
            &NewOperation {
                account_id: body.account_id,
                amount: body.amount,
                date: body.date,
                effective_date: body.effective_date,
                label: body.label.clone(),
            },
        )
        .await?;

    let op = Operation {
        id,
        user_id,
        account_id: body.account_id,
        amount: body.amount,
        date: body.date,
        effective_date: body.effective_date,
        label: body.label,
        budget_link: BudgetLink::Unlinked,
        ignored: false,
        ignore_rule_id: None,
        category_id: None,
        budget_category_id: None,
        transfer: None,
        splits: Vec::new(),
    };
    let transfer_rules = state.account_repo.list_transfer_rules(user_id).await?;
    let op = auto_transfer_operation(&state.operation_repo, &transfer_rules, op).await?;
    auto_match_operation(
        &state.operation_repo,
        &state.budget_repo,
        &state.category_repo,
        &op,
    )
    .await?;
    let ignore_rules = state.ignore_rule_repo.list(user_id).await?;
    auto_ignore_operation(&state.operation_repo, &ignore_rules, &op).await?;

    let updated = state.operation_repo.find_by_id(id, user_id).await?;
    Ok((StatusCode::CREATED, Json(updated.into())))
}

pub async fn update_operation<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
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
    // A new amount may no longer match the other side, nor the budget of money put aside.
    if let Some(transfer) = current.transfer
        && current.amount != body.amount
    {
        state
            .operation_repo
            .set_transfer(id, auth_user.id, transfer.account_id, transfer.rule_id)
            .await?;
        state
            .operation_repo
            .pair_transfer(id, auth_user.id, None)
            .await?;
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn delete_operation<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let found = state.operation_repo.delete(id, auth_user.id).await?;
    if !found {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn link_budget<U, O: OperationRepository, B: BudgetRepository, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(op_id): Path<Uuid>,
    Json(body): Json<LinkBudgetRequest>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    if !state.budget_repo.exists(body.budget_id, user_id).await? {
        return Err(AppError::NotFound);
    }
    let op = ensure_not_split(&state.operation_repo, op_id, user_id, "budget link").await?;
    if op.transfer.is_some() {
        let budget = state
            .budget_repo
            .find_by_id(body.budget_id, user_id)
            .await?;
        if !op.accepts_budget(&budget) {
            return Err(AppError::Conflict(
                "the operation is a transfer: only money put on a savings account can be linked \
                 to a budget, a savings one sending its money there"
                    .to_string(),
            ));
        }
    }

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

pub async fn unlink_budget<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    ensure_not_split(&state.operation_repo, id, auth_user.id, "budget link").await?;
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

pub async fn set_category<U, O: OperationRepository, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetCategoryRequest>,
) -> AppResult<Json<OperationResponse>> {
    if !state
        .category_repo
        .exists(body.category_id, auth_user.id)
        .await?
    {
        return Err(AppError::NotFound);
    }
    store_category(
        &state.operation_repo,
        id,
        auth_user.id,
        Some(body.category_id),
    )
    .await
}

pub async fn set_account<U, O: OperationRepository, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetAccountRequest>,
) -> AppResult<Json<OperationResponse>> {
    account_receiving_operations(&state.account_repo, body.account_id, auth_user.id).await?;
    if state
        .operation_repo
        .set_accounts(&[id], auth_user.id, body.account_id)
        .await?
        == 0
    {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

pub async fn set_operations_account<U, O: OperationRepository, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<SetOperationsAccountRequest>,
) -> AppResult<Json<OperationsUpdatedResponse>> {
    ensure_operation_count(&body.operation_ids)?;
    account_receiving_operations(&state.account_repo, body.account_id, auth_user.id).await?;
    let updated = state
        .operation_repo
        .set_accounts(&body.operation_ids, auth_user.id, body.account_id)
        .await?;
    Ok(Json(OperationsUpdatedResponse { updated }))
}

pub async fn set_operations_category<
    U,
    O: OperationRepository,
    B,
    P,
    C: CategoryRepository,
    R,
    A,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<SetOperationsCategoryRequest>,
) -> AppResult<Json<OperationsUpdatedResponse>> {
    ensure_operation_count(&body.operation_ids)?;
    ensure_category_is_users(&state.category_repo, body.category_id, auth_user.id).await?;
    let updated = state
        .operation_repo
        .set_categories(&body.operation_ids, auth_user.id, body.category_id)
        .await?;
    Ok(Json(OperationsUpdatedResponse { updated }))
}

fn ensure_operation_count(ids: &[Uuid]) -> AppResult<()> {
    if ids.is_empty() || ids.len() > MAX_OPERATIONS_AT_ONCE {
        return Err(AppError::BadRequest(format!(
            "between 1 and {MAX_OPERATIONS_AT_ONCE} operations expected, got {}",
            ids.len()
        )));
    }
    Ok(())
}

pub async fn clear_category<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    store_category(&state.operation_repo, id, auth_user.id, None).await
}

/// Set an unsplit operation's own category and return the operation.
async fn store_category(
    op_repo: &impl OperationRepository,
    id: Uuid,
    user_id: Uuid,
    category_id: Option<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let op = ensure_not_split(op_repo, id, user_id, "category").await?;
    if op.transfer.is_some() && category_id.is_some() {
        return Err(AppError::Conflict(
            "the operation is a transfer: it has no category".to_string(),
        ));
    }
    if !op_repo.set_category(id, user_id, category_id).await? {
        return Err(AppError::NotFound);
    }
    let op = op_repo.find_by_id(id, user_id).await?;
    Ok(Json(op.into()))
}

pub async fn ignore_operation<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
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

pub async fn unignore_operation<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
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

pub async fn replace_splits<
    U,
    O: OperationRepository,
    B: BudgetRepository,
    P,
    C: CategoryRepository,
    R,
    A,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ReplaceOperationSplitsRequest>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    let op = state.operation_repo.find_by_id(id, user_id).await?;
    if op.transfer.is_some() {
        return Err(AppError::Conflict(
            "the operation is a transfer: it cannot be split".to_string(),
        ));
    }

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
    let mut category_ids: Vec<Uuid> = splits.iter().filter_map(|s| s.category_id).collect();
    category_ids.sort_unstable();
    category_ids.dedup();
    for category_id in category_ids {
        ensure_category_is_users(&state.category_repo, Some(category_id), user_id).await?;
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

pub async fn clear_splits<U, O: OperationRepository, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    if !state.operation_repo.clear_splits(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    let op = state.operation_repo.find_by_id(id, auth_user.id).await?;
    Ok(Json(op.into()))
}

/// The operation, unless it is split: its budget link or category cannot change then, since
/// it is accounted through its parts.
async fn ensure_not_split(
    op_repo: &impl OperationRepository,
    id: Uuid,
    user_id: Uuid,
    what: &str,
) -> AppResult<Operation> {
    let op = op_repo.find_by_id(id, user_id).await?;
    if op.is_split() {
        return Err(AppError::Conflict(format!(
            "the operation is split: its {what} cannot be changed"
        )));
    }
    Ok(op)
}

pub async fn set_transfer<U, O: OperationRepository, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetTransferRequest>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    let op = state.operation_repo.find_by_id(id, user_id).await?;
    if op.is_split() {
        return Err(AppError::Conflict(
            "the operation is split: it cannot be a transfer".to_string(),
        ));
    }
    if body.account_id == op.account_id {
        return Err(AppError::BadRequest(
            "a transfer is with another account than the operation's".to_string(),
        ));
    }
    if state
        .account_repo
        .find(body.account_id, user_id)
        .await?
        .is_none()
    {
        return Err(AppError::BadRequest(format!(
            "unknown account {}",
            body.account_id
        )));
    }
    if let Some(counterpart_id) = body.counterpart_id {
        let fits = match state
            .operation_repo
            .find_by_id(counterpart_id, user_id)
            .await
        {
            Ok(c) => c.account_id == body.account_id && c.amount == -op.amount && !c.is_split(),
            Err(AppError::NotFound) => false,
            Err(e) => return Err(e),
        };
        if !fits {
            return Err(AppError::BadRequest(format!(
                "operation {counterpart_id} is not an operation of the other account of \
                 opposite amount"
            )));
        }
    }
    // The same transfer again keeps the rule that made it and its other side.
    let unchanged = op.transfer.is_some_and(|t| t.account_id == body.account_id);
    if !unchanged {
        state
            .operation_repo
            .set_transfer(id, user_id, body.account_id, None)
            .await?;
    }
    if !unchanged || body.counterpart_id.is_some() {
        state
            .operation_repo
            .pair_transfer(id, user_id, body.counterpart_id)
            .await?;
    }
    let op = state.operation_repo.find_by_id(id, user_id).await?;
    Ok(Json(op.into()))
}

pub async fn clear_transfer<
    U,
    O: OperationRepository,
    B: BudgetRepository,
    P,
    C: CategoryRepository,
    R,
    A,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<OperationResponse>> {
    let user_id = auth_user.id;
    let other_side = state
        .operation_repo
        .find_by_id(id, user_id)
        .await?
        .transfer
        .and_then(|t| t.operation_id);
    if !state.operation_repo.clear_transfer(id, user_id).await? {
        return Err(AppError::NotFound);
    }
    // Marking a transfer cleared its category and budget: the rules may give them back.
    for cleared in std::iter::once(id).chain(other_side) {
        let op = state.operation_repo.find_by_id(cleared, user_id).await?;
        auto_match_operation(
            &state.operation_repo,
            &state.budget_repo,
            &state.category_repo,
            &op,
        )
        .await?;
    }
    let op = state.operation_repo.find_by_id(id, user_id).await?;
    Ok(Json(op.into()))
}

// ── Auto-matching helper ──────────────────────────────────────────────────────

/// Run automatic budget and category matching for a single operation.
/// A split operation is never matched; a manual budget link and an own category are kept. A
/// transfer is only matched to the budgets it accepts, and never to a category.
pub async fn auto_match_operation<OR, BR, CR>(
    op_repo: &OR,
    budget_repo: &BR,
    category_repo: &CR,
    op: &Operation,
) -> AppResult<()>
where
    OR: OperationRepository,
    BR: BudgetRepository,
    CR: CategoryRepository,
{
    if op.is_split() {
        return Ok(());
    }
    if !op.budget_link.is_manual() && op.may_have_budget() {
        let budgets: Vec<Budget> = budget_repo
            .list_all_for_user(op.user_id)
            .await?
            .into_iter()
            .filter(|b| op.accepts_budget(b))
            .collect();
        if let Some(budget_id) = MatcherServiceImpl.match_operation(op, &budgets) {
            op_repo.set_auto_link(op.id, budget_id).await?;
        }
    }
    if op.category_id.is_none() && op.transfer.is_none() {
        let categories = category_repo.list(op.user_id).await?;
        if let Some(category_id) = MatcherServiceImpl.match_category(op, &categories) {
            op_repo
                .set_category(op.id, op.user_id, Some(category_id))
                .await?;
        }
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
        repositories::{
            MockBudgetRepository, MockCategoryRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, main_accounts, make_test_state,
            make_test_state_with_categories, no_categories, response_json,
        },
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
            account_id: Uuid::nil(),
            amount: Decimal::new(-50, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Test".to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            transfer: None,
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
            category_id: None,
            account_id: None,
            created_at: Utc::now(),
        }
    }

    /// An operation of `user_id` that is a transfer with the checking account `account_id`.
    fn internal_transfer(id: Uuid, user_id: Uuid, account_id: Uuid) -> Operation {
        Operation {
            transfer: Some(Transfer {
                account_id,
                account_kind: crate::domain::account::AccountKind::Checking,
                rule_id: None,
                operation_id: None,
            }),
            ..make_op(id, user_id)
        }
    }

    /// `op_repo` finding `op` whatever id it is asked for.
    fn finding(op: Operation) -> MockOperationRepository {
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_find_by_id().returning(move |_, _| {
            let op = op.clone();
            Box::pin(async move { Ok(op) })
        });
        op_repo
    }

    async fn put_transfer(
        op_repo: MockOperationRepository,
        user_id: Uuid,
        id: Uuid,
        body: serde_json::Value,
    ) -> Response {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));
        let auth = auth_header(user_id, UserRole::User);
        app.oneshot(json_request(
            "PUT",
            &format!("/operations/{id}/transfer"),
            Some(&body.to_string()),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn set_transfer_marks_the_operation_then_pairs_it() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let joint = Uuid::new_v4();
        let mut op_repo = finding(make_op(id, user_id));
        op_repo
            .expect_set_transfer()
            .withf(move |i, u, a, r| *i == id && *u == user_id && *a == joint && r.is_none())
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_pair_transfer()
            .withf(move |i, _, c| *i == id && c.is_none())
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let resp = put_transfer(
            op_repo,
            user_id,
            id,
            serde_json::json!({"accountId": joint}),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn the_same_transfer_again_keeps_its_rule_and_other_side() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let joint = Uuid::new_v4();
        let mut op_repo = finding(internal_transfer(id, user_id, joint));
        op_repo.expect_set_transfer().never();
        op_repo.expect_pair_transfer().never();

        let resp = put_transfer(
            op_repo,
            user_id,
            id,
            serde_json::json!({"accountId": joint}),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn set_transfer_refuses_the_own_account_a_split_operation_and_a_wrong_counterpart() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let own = serde_json::json!({"accountId": Uuid::nil()});
        let resp = put_transfer(finding(make_op(id, user_id)), user_id, id, own).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let split = Operation {
            splits: vec![OperationSplit {
                id: Uuid::new_v4(),
                amount: Decimal::new(-50, 0),
                effective_date: None,
                budget_id: None,
                category_id: None,
                budget_category_id: None,
            }],
            ..make_op(id, user_id)
        };
        let body = serde_json::json!({"accountId": Uuid::new_v4()});
        let resp = put_transfer(finding(split), user_id, id, body).await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);

        let joint = Uuid::new_v4();
        let mut op_repo = finding(internal_transfer(id, user_id, joint));
        op_repo
            .expect_pair_transfer()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));
        let body = serde_json::json!({"accountId": joint, "counterpartId": Uuid::new_v4()});
        let resp = put_transfer(op_repo, user_id, id, body).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn an_internal_transfer_takes_neither_budget_nor_category() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let mut op_repo = finding(internal_transfer(id, user_id, Uuid::new_v4()));
        op_repo.expect_set_budget_link().never();
        op_repo.expect_set_category().never();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_exists()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        budget_repo.expect_find_by_id().returning(|id, user_id| {
            let mut budget = make_budget(id, user_id);
            budget.budget_type = BudgetType::Savings;
            Box::pin(async move { Ok(budget) })
        });
        let mut category_repo = MockCategoryRepository::new();
        category_repo
            .expect_exists()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        let app = build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            category_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);

        for (uri, body) in [
            (
                format!("/operations/{id}/budget"),
                serde_json::json!({"budgetId": budget_id}),
            ),
            (
                format!("/operations/{id}/category"),
                serde_json::json!({"categoryId": Uuid::new_v4()}),
            ),
        ] {
            let resp = app
                .clone()
                .oneshot(json_request(
                    "PUT",
                    &uri,
                    Some(&body.to_string()),
                    Some(&auth),
                ))
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::CONFLICT, "{uri}");
        }
    }

    #[tokio::test]
    async fn list_operations_returns_empty_page() {
        let user_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_list()
            .once()
            .returning(|_, _| Box::pin(async { Ok((vec![], OperationTotals::default())) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request("GET", "/operations", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationListResponse = response_json(resp).await;
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
            let totals = OperationTotals {
                count: 10,
                income: Decimal::new(1500, 2),
                expense: Decimal::new(-4250, 2),
                first_date: NaiveDate::from_ymd_opt(2024, 2, 4),
                last_date: NaiveDate::from_ymd_opt(2026, 10, 18),
            };
            Box::pin(async move { Ok((ops, totals)) })
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
        let json: OperationListResponse = response_json(resp).await;
        assert_eq!(json.page, 2);
        assert_eq!(json.page_size, 5);
        assert_eq!(json.total, 10);
        assert_eq!(json.max_page, 2);
        assert_eq!(json.totals.income, Decimal::new(1500, 2));
        assert_eq!(json.totals.expense, Decimal::new(-4250, 2));
        assert_eq!(json.totals.first_date, NaiveDate::from_ymd_opt(2024, 2, 4));
        assert_eq!(json.totals.last_date, NaiveDate::from_ymd_opt(2026, 10, 18));
    }

    #[tokio::test]
    async fn create_operation_inserts_and_returns_created() {
        let user_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        crate::test_util::no_waiting_transfers(&mut op_repo);
        let mut budget_repo = MockBudgetRepository::new();

        op_repo
            .expect_insert()
            .withf(|_, _, op| op.account_id.is_nil())
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
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
            account_id: Uuid::nil(),
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
    async fn create_operation_on_an_account_not_receiving_operations_is_a_bad_request() {
        use crate::{
            domain::account::{Account, AccountFields, AccountKind},
            repositories::MockAccountRepository,
            test_util::{
                make_test_state_with_all, no_categories, no_ignore_rules, no_import_profiles,
            },
        };

        let mut accounts = MockAccountRepository::new();
        accounts.expect_find().returning(|id, user_id| {
            Box::pin(async move {
                Ok(Some(Account {
                    id,
                    user_id,
                    fields: AccountFields {
                        name: "Compte pro".to_string(),
                        kind: AccountKind::Checking,
                        imported: false,
                    },
                    balance: None,
                    current_balance: None,
                    transferred_into: false,
                    created_at: chrono::Utc::now(),
                }))
            })
        });
        let app = build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            accounts,
        ));
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let body = serde_json::to_string(&CreateOperationRequest {
            account_id: Uuid::new_v4(),
            amount: Decimal::new(-50, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Groceries".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/operations", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn create_operation_is_ignored_by_a_matching_rule() {
        use crate::{
            domain::{
                budget::LabelPattern,
                ignore_rule::{IgnoreRule, IgnoreRuleFields},
            },
            repositories::MockIgnoreRuleRepository,
            test_util::make_test_state_with_ignore_rules,
        };

        let user_id = Uuid::new_v4();
        let rule = IgnoreRule {
            id: Uuid::new_v4(),
            user_id,
            fields: IgnoreRuleFields {
                label_pattern: LabelPattern::StartsWith("VIR INTERNE".to_string()),
                amount: None,
            },
            created_at: chrono::Utc::now(),
        };
        let rule_id = rule.id;
        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo
            .expect_list()
            .withf(move |id| *id == user_id)
            .returning(move |_| {
                let rule = rule.clone();
                Box::pin(async move { Ok(vec![rule]) })
            });
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        let mut op_repo = MockOperationRepository::new();
        crate::test_util::no_waiting_transfers(&mut op_repo);
        op_repo
            .expect_insert()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_ignore_by_rule()
            .withf(move |_, r| *r == rule_id)
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));
        let op = make_op(Uuid::new_v4(), user_id);
        op_repo.expect_find_by_id().returning(move |_, _| {
            let op = op.clone();
            Box::pin(async { Ok(op) })
        });

        let app = build_test_router(make_test_state_with_ignore_rules(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            rule_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&CreateOperationRequest {
            account_id: Uuid::nil(),
            amount: Decimal::new(-500, 0),
            date: NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            effective_date: None,
            label: "VIR INTERNE VERS LIVRET A".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/operations", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
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
            ignore_rule_id: None,
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
                    effective_date: None,
                    budget_id: None,
                    category_id: None,
                    budget_category_id: None,
                },
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-30, 0),
                    effective_date: NaiveDate::from_ymd_opt(2024, 2, 1),
                    budget_id: None,
                    category_id: None,
                    budget_category_id: None,
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
                                effective_date: None,
                                budget_id: Some(budget_id),
                                category_id: None,
                            },
                            NewOperationSplit {
                                amount: Decimal::new(-30, 0),
                                effective_date: NaiveDate::from_ymd_opt(2024, 2, 1),
                                budget_id: None,
                                category_id: None,
                            },
                        ]
            })
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let body = format!(
            r#"{{"splits":[{{"amount":"-20","budgetId":"{budget_id}"}},{{"amount":"-30","budgetId":null,"effectiveDate":"2024-02-01"}}]}}"#
        );
        let resp = put_splits(split_app(op_repo, budget_repo), user_id, op_id, &body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        let splits = json["splits"].as_array().unwrap();
        assert_eq!(splits.len(), 2);
        assert_eq!(splits[0]["amount"], "-20");
        assert!(splits[0]["id"].is_string());
        assert!(splits[0]["budgetId"].is_null());
        assert!(splits[0]["effectiveDate"].is_null());
        assert_eq!(splits[1]["effectiveDate"], "2024-02-01");
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
    async fn a_new_amount_makes_the_transfer_again_to_repair_it() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let joint = Uuid::new_v4();
        let mut op_repo = finding(internal_transfer(id, user_id, joint));
        op_repo
            .expect_update()
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_set_transfer()
            .withf(move |i, _, a, r| *i == id && *a == joint && r.is_none())
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_pair_transfer()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&UpdateOperationRequest {
            amount: Decimal::new(-40, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: "Test".to_string(),
        })
        .unwrap();
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request(
                "PUT",
                &format!("/operations/{id}"),
                Some(&body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn an_operation_no_longer_a_transfer_is_matched_again() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut op_repo = finding(internal_transfer(id, user_id, Uuid::new_v4()));
        op_repo
            .expect_clear_transfer()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(true) }));
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
        ));
        let auth = auth_header(user_id, UserRole::User);

        let resp = app
            .oneshot(json_request(
                "DELETE",
                &format!("/operations/{id}/transfer"),
                None,
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn money_put_aside_accepts_only_savings_budgets_of_its_account() {
        let user_id = Uuid::new_v4();
        let livret = Uuid::new_v4();
        let op = Operation {
            transfer: Some(Transfer {
                account_id: livret,
                account_kind: crate::domain::account::AccountKind::Savings,
                rule_id: None,
                operation_id: None,
            }),
            ..make_op(Uuid::new_v4(), user_id)
        };
        let budget = |budget_type, account_id| Budget {
            budget_type,
            account_id,
            ..make_budget(Uuid::new_v4(), user_id)
        };

        assert!(op.accepts_budget(&budget(BudgetType::Savings, Some(livret))));
        assert!(op.accepts_budget(&budget(BudgetType::Savings, None)));
        assert!(!op.accepts_budget(&budget(BudgetType::Savings, Some(Uuid::new_v4()))));
        assert!(!op.accepts_budget(&budget(BudgetType::Expense, None)));
        let taken_back = Operation {
            amount: Decimal::new(50, 0),
            ..op
        };
        assert!(!taken_back.accepts_budget(&budget(BudgetType::Savings, Some(livret))));
    }

    #[tokio::test]
    async fn auto_match_skips_split_operation() {
        let op_repo = MockOperationRepository::new();
        let budget_repo = MockBudgetRepository::new();
        let op = split_op(Uuid::new_v4(), Uuid::new_v4());

        auto_match_operation(&op_repo, &budget_repo, &no_categories(), &op)
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

        auto_match_operation(&op_repo, &budget_repo, &no_categories(), &op)
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

        auto_match_operation(&op_repo, &budget_repo, &no_categories(), &op)
            .await
            .unwrap();
    }

    fn categories_with_rule(category_id: Uuid, pattern: &str) -> MockCategoryRepository {
        use crate::domain::category::{Category, CategoryFields, CategoryRule};
        let category = Category {
            id: category_id,
            user_id: Uuid::new_v4(),
            fields: CategoryFields {
                name: "Energy".to_string(),
                color: "#12b886".parse().unwrap(),
                icon: None,
                rules: vec![CategoryRule {
                    label_pattern: LabelPattern::Contains(pattern.to_string()),
                }],
            },
            created_at: Utc::now(),
        };
        let mut repo = MockCategoryRepository::new();
        repo.expect_list().returning(move |_| {
            let category = category.clone();
            Box::pin(async move { Ok(vec![category]) })
        });
        repo
    }

    fn budgets_matching_none() -> MockBudgetRepository {
        let mut repo = MockBudgetRepository::new();
        repo.expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo
    }

    #[tokio::test]
    async fn auto_match_sets_category_when_rule_matches() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let category_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_category()
            .withf(move |id, uid, cid| *id == op_id && *uid == user_id && *cid == Some(category_id))
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));
        let op = Operation {
            label: "PRLV EDF ELECTRICITE".to_string(),
            ..make_op(op_id, user_id)
        };

        auto_match_operation(
            &op_repo,
            &budgets_matching_none(),
            &categories_with_rule(category_id, "edf"),
            &op,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn auto_match_keeps_own_category_and_ignores_unmatched_labels() {
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_set_category().never();
        let categories = categories_with_rule(Uuid::new_v4(), "EDF");
        let own = Operation {
            label: "PRLV EDF".to_string(),
            category_id: Some(Uuid::new_v4()),
            ..make_op(Uuid::new_v4(), Uuid::new_v4())
        };
        let unmatched = make_op(Uuid::new_v4(), Uuid::new_v4());

        for op in [own, unmatched] {
            auto_match_operation(&op_repo, &budgets_matching_none(), &categories, &op)
                .await
                .unwrap();
        }
    }

    fn category_app(
        op_repo: MockOperationRepository,
        category_repo: MockCategoryRepository,
    ) -> Router {
        build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            category_repo,
        ))
    }

    fn categories_existing(found: bool) -> MockCategoryRepository {
        let mut repo = MockCategoryRepository::new();
        repo.expect_exists()
            .returning(move |_, _| Box::pin(async move { Ok(found) }));
        repo
    }

    async fn put_category(app: Router, user_id: Uuid, op_id: Uuid, category_id: Uuid) -> Response {
        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::to_string(&SetCategoryRequest { category_id }).unwrap();
        let req = json_request(
            "PUT",
            &format!("/operations/{op_id}/category"),
            Some(&body),
            Some(&auth),
        );
        app.oneshot(req).await.unwrap()
    }

    #[tokio::test]
    async fn response_exposes_own_and_effective_category() {
        let own = Uuid::new_v4();
        let budgets = Uuid::new_v4();
        let op = Operation {
            budget_category_id: Some(budgets),
            ..make_op(Uuid::new_v4(), Uuid::new_v4())
        };

        let json = serde_json::to_value(OperationResponse::from(op.clone())).unwrap();
        assert_eq!(json["categoryId"], serde_json::Value::Null);
        assert_eq!(json["effectiveCategoryId"], budgets.to_string());

        let json = serde_json::to_value(OperationResponse::from(Operation {
            category_id: Some(own),
            ..op
        }))
        .unwrap();
        assert_eq!(json["categoryId"], own.to_string());
        assert_eq!(json["effectiveCategoryId"], own.to_string());
    }

    #[tokio::test]
    async fn set_category_stores_it_and_returns_the_operation() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let category_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        let mut calls = 0;
        op_repo.expect_find_by_id().times(2).returning(move |_, _| {
            calls += 1;
            let category_id = (calls == 2).then_some(category_id);
            Box::pin(async move {
                Ok(Operation {
                    category_id,
                    ..make_op(op_id, user_id)
                })
            })
        });
        op_repo
            .expect_set_category()
            .withf(move |id, uid, cid| *id == op_id && *uid == user_id && *cid == Some(category_id))
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let app = category_app(op_repo, categories_existing(true));
        let resp = put_category(app, user_id, op_id, category_id).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationResponse = response_json(resp).await;
        assert_eq!(json.category_id, Some(category_id));
    }

    #[tokio::test]
    async fn set_unknown_category_returns_404() {
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_set_category().never();

        let app = category_app(op_repo, categories_existing(false));
        let resp = put_category(app, Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()).await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn set_category_on_split_operation_returns_409() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, split_op(op_id, user_id));
        op_repo.expect_set_category().never();

        let app = category_app(op_repo, categories_existing(true));
        let resp = put_category(app, user_id, op_id, Uuid::new_v4()).await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(
            error_message(resp).await,
            "the operation is split: its category cannot be changed"
        );
    }

    #[tokio::test]
    async fn clear_category_stores_none() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_find_by_id()
            .times(2)
            .returning(move |_, _| Box::pin(async move { Ok(make_op(op_id, user_id)) }));
        op_repo
            .expect_set_category()
            .withf(|_, _, cid| cid.is_none())
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let auth = auth_header(user_id, UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/operations/{op_id}/category"),
            None,
            Some(&auth),
        );
        let resp = category_app(op_repo, MockCategoryRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    async fn expect_list_params(
        query: &str,
        check: impl Fn(&ListOperationsParams) -> bool + Send + 'static,
    ) {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_list()
            .withf(move |_, params| check(params))
            .once()
            .returning(|_, _| Box::pin(async { Ok((vec![], OperationTotals::default())) }));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request("GET", &format!("/operations?{query}"), None, Some(&auth));
        let resp = category_app(op_repo, MockCategoryRepository::new())
            .oneshot(req)
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK, "{query}");
    }

    #[tokio::test]
    async fn list_operations_passes_the_category_filter() {
        let food = Uuid::new_v4();
        let fun = Uuid::new_v4();
        for (query, expected) in [
            (format!("categoryId={food}"), (vec![food], false)),
            (
                format!("categoryId={food}&categoryId={fun}"),
                (vec![food, fun], false),
            ),
            ("uncategorized=true".to_string(), (vec![], true)),
            (
                format!("categoryId={food}&uncategorized=true"),
                (vec![food], true),
            ),
            (String::new(), (vec![], false)),
        ] {
            let expected = CategoryFilter {
                category_ids: expected.0,
                uncategorized: expected.1,
            };
            expect_list_params(&query, move |params| params.category == expected).await;
        }
    }

    #[tokio::test]
    async fn list_operations_passes_budgets_direction_and_amount_bounds() {
        let rent = Uuid::new_v4();
        let food = Uuid::new_v4();
        let query =
            format!("budgetId={rent}&budgetId={food}&direction=expense&amountMin=5&amountMax=50.5");
        expect_list_params(&query, move |params| {
            params.budget_ids == [rent, food]
                && params.direction == Some(OperationDirection::Expense)
                && params.amount_min == Some(Decimal::new(5, 0))
                && params.amount_max == Some(Decimal::new(505, 1))
        })
        .await;
    }

    async fn put_account(
        op_repo: MockOperationRepository,
        account_repo: crate::repositories::MockAccountRepository,
        user_id: Uuid,
        op_id: Uuid,
        account_id: Uuid,
    ) -> axum::response::Response {
        use crate::test_util::{
            make_test_state_with_all, no_categories, no_ignore_rules, no_import_profiles,
        };
        let app = build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        let body = serde_json::json!({ "accountId": account_id }).to_string();
        app.oneshot(json_request(
            "PUT",
            &format!("/operations/{op_id}/account"),
            Some(&body),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn set_account_moves_the_operation_and_returns_it() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let joint = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_accounts()
            .withf(move |ids, uid, aid| ids == [op_id] && *uid == user_id && *aid == joint)
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(1) }));
        op_repo.expect_find_by_id().returning(move |_, _| {
            Box::pin(async move {
                Ok(Operation {
                    account_id: joint,
                    ..make_op(op_id, user_id)
                })
            })
        });

        let resp = put_account(op_repo, main_accounts(), user_id, op_id, joint).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationResponse = response_json(resp).await;
        assert_eq!(json.account_id, joint);
    }

    #[tokio::test]
    async fn set_account_refuses_an_account_not_receiving_operations() {
        let mut accounts = crate::repositories::MockAccountRepository::new();
        accounts
            .expect_find()
            .returning(|_, _| Box::pin(async { Ok(None) }));
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_set_accounts().never();

        let resp = put_account(
            op_repo,
            accounts,
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn set_account_of_an_unknown_operation_returns_404() {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_accounts()
            .returning(|_, _, _| Box::pin(async { Ok(0) }));

        let resp = put_account(
            op_repo,
            main_accounts(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    async fn put_bulk(app: Router, user_id: Uuid, path: &str, body: serde_json::Value) -> Response {
        let auth = auth_header(user_id, UserRole::User);
        app.oneshot(json_request(
            "PUT",
            path,
            Some(&body.to_string()),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    fn accounts_app(op_repo: MockOperationRepository) -> Router {
        use crate::test_util::{
            make_test_state_with_all, no_categories, no_ignore_rules, no_import_profiles,
        };
        build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            main_accounts(),
        ))
    }

    #[tokio::test]
    async fn set_operations_account_moves_them_and_counts_the_moved() {
        let user_id = Uuid::new_v4();
        let joint = Uuid::new_v4();
        let ids = [Uuid::new_v4(), Uuid::new_v4()];
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_accounts()
            .withf(move |got, uid, aid| got == ids && *uid == user_id && *aid == joint)
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(2) }));

        let resp = put_bulk(
            accounts_app(op_repo),
            user_id,
            "/operations/account",
            serde_json::json!({ "operationIds": ids, "accountId": joint }),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: OperationsUpdatedResponse = response_json(resp).await;
        assert_eq!(json.updated, 2);
    }

    #[tokio::test]
    async fn set_operations_account_needs_between_1_and_1000_operations() {
        for count in [0, MAX_OPERATIONS_AT_ONCE + 1] {
            let mut op_repo = MockOperationRepository::new();
            op_repo.expect_set_accounts().never();
            let ids: Vec<Uuid> = (0..count).map(|_| Uuid::new_v4()).collect();

            let resp = put_bulk(
                accounts_app(op_repo),
                Uuid::new_v4(),
                "/operations/account",
                serde_json::json!({ "operationIds": ids, "accountId": Uuid::new_v4() }),
            )
            .await;

            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{count} operations");
        }
    }

    #[tokio::test]
    async fn set_operations_category_sets_or_clears_it() {
        let user_id = Uuid::new_v4();
        let ids = [Uuid::new_v4(), Uuid::new_v4()];
        for category_id in [Some(Uuid::new_v4()), None] {
            let mut op_repo = MockOperationRepository::new();
            op_repo
                .expect_set_categories()
                .withf(move |got, uid, cid| got == ids && *uid == user_id && *cid == category_id)
                .once()
                .returning(|_, _, _| Box::pin(async { Ok(1) }));

            let resp = put_bulk(
                category_app(op_repo, categories_existing(true)),
                user_id,
                "/operations/category",
                serde_json::json!({ "operationIds": ids, "categoryId": category_id }),
            )
            .await;

            assert_eq!(resp.status(), StatusCode::OK);
            let json: OperationsUpdatedResponse = response_json(resp).await;
            assert_eq!(json.updated, 1);
        }
    }

    #[tokio::test]
    async fn set_operations_category_refuses_an_unknown_category() {
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_set_categories().never();

        let resp = put_bulk(
            category_app(op_repo, categories_existing(false)),
            Uuid::new_v4(),
            "/operations/category",
            serde_json::json!({ "operationIds": [Uuid::new_v4()], "categoryId": Uuid::new_v4() }),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn list_operations_passes_the_accounts() {
        let perso = Uuid::new_v4();
        let joint = Uuid::new_v4();
        expect_list_params(
            &format!("accountId={perso}&accountId={joint}"),
            move |params| params.account_ids == [perso, joint],
        )
        .await;
        expect_list_params("", |params| params.account_ids.is_empty()).await;
    }

    #[tokio::test]
    async fn list_operations_passes_the_ignored_filter() {
        for (query, expected) in [
            ("", IgnoredFilter::Excluded),
            ("ignored=excluded", IgnoredFilter::Excluded),
            ("ignored=only", IgnoredFilter::Only),
            ("ignored=included", IgnoredFilter::Included),
        ] {
            expect_list_params(query, move |params| params.ignored == expected).await;
        }
    }

    #[tokio::test]
    async fn list_operations_treats_a_blank_label_as_no_filter() {
        expect_list_params("label=%20%20", |params| params.label_filter.is_none()).await;
        expect_list_params("label=Amazon", |params| {
            params.label_filter.as_deref() == Some("%amazon%")
        })
        .await;
    }

    #[tokio::test]
    async fn replace_splits_unknown_category_returns_400() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let category_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        expect_find_returning(&mut op_repo, make_op(op_id, user_id));
        op_repo.expect_replace_splits().never();

        let body = format!(
            r#"{{"splits":[{{"amount":"-20","budgetId":null,"categoryId":"{category_id}"}},{{"amount":"-30","budgetId":null}}]}}"#
        );
        let app = category_app(op_repo, categories_existing(false));
        let resp = put_splits(app, user_id, op_id, &body).await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            error_message(resp).await,
            format!("unknown category {category_id}")
        );
    }

    #[tokio::test]
    async fn replace_splits_stores_part_categories() {
        let user_id = Uuid::new_v4();
        let op_id = Uuid::new_v4();
        let category_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_find_by_id()
            .times(2)
            .returning(move |_, _| Box::pin(async move { Ok(make_op(op_id, user_id)) }));
        op_repo
            .expect_replace_splits()
            .withf(move |_, _, splits| {
                splits.iter().map(|s| s.category_id).collect::<Vec<_>>()
                    == [Some(category_id), None]
            })
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let body = format!(
            r#"{{"splits":[{{"amount":"-20","budgetId":null,"categoryId":"{category_id}"}},{{"amount":"-30","budgetId":null}}]}}"#
        );
        let app = category_app(op_repo, categories_existing(true));
        let resp = put_splits(app, user_id, op_id, &body).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }
}
