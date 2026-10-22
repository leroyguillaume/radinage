use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::{Budget, BudgetFields, BudgetKind, BudgetType, Rule},
        category::{Category, CategoryColor, CategoryFields},
        import_profile::{ImportProfile, ImportProfileFields},
        operation::{BudgetLink, NewOperationSplit, Operation, OperationSplit, validate_splits},
        user::AccountBalance,
    },
    error::{AppError, AppResult},
    handlers::{categories::CategoryRequest, import_profiles::ImportProfileRequest},
    repositories::{
        BudgetRepository, CategoryRepository, ImportProfileRepository, OperationRepository,
        UserRepository,
    },
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Current version of the export payload. Bump when breaking changes are made.
pub const EXPORT_VERSION: u32 = 1;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// A budget as stored inside an export payload (omits `userId`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportBudget {
    pub id: Uuid,
    pub label: String,
    pub budget_type: BudgetType,
    pub kind: BudgetKind,
    pub rules: Vec<Rule>,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub category_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

impl From<Budget> for ExportBudget {
    fn from(b: Budget) -> Self {
        Self {
            id: b.id,
            label: b.label,
            budget_type: b.budget_type,
            kind: b.kind,
            rules: b.rules,
            category_id: b.category_id,
            created_at: b.created_at,
        }
    }
}

/// A category inside an export payload (omits `userId`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportCategory {
    /// Identifier the payload's budgets, operations and split parts refer to it by.
    pub id: Uuid,
    pub name: String,
    pub color: CategoryColor,
}

impl From<Category> for ExportCategory {
    fn from(c: Category) -> Self {
        Self {
            id: c.id,
            name: c.fields.name,
            color: c.fields.color,
        }
    }
}

/// An operation as stored inside an export payload (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportOperation {
    pub id: Uuid,
    #[schemars(with = "String")]
    pub amount: Decimal,
    pub date: NaiveDate,
    pub effective_date: Option<NaiveDate>,
    pub label: String,
    pub budget_link: BudgetLink,
    pub ignored: bool,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub category_id: Option<Uuid>,
    /// Parts of a split operation, in order; absent from exports made before splits existed.
    #[serde(default)]
    pub splits: Vec<ExportOperationSplit>,
}

/// One part of a split operation inside an export payload.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportOperationSplit {
    #[schemars(with = "String")]
    pub amount: Decimal,
    pub budget_id: Option<Uuid>,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub category_id: Option<Uuid>,
}

impl From<OperationSplit> for ExportOperationSplit {
    fn from(split: OperationSplit) -> Self {
        Self {
            amount: split.amount,
            budget_id: split.budget_id,
            category_id: split.category_id,
        }
    }
}

impl From<&ExportOperationSplit> for NewOperationSplit {
    fn from(split: &ExportOperationSplit) -> Self {
        Self {
            amount: split.amount,
            budget_id: split.budget_id,
            category_id: split.category_id,
        }
    }
}

impl From<Operation> for ExportOperation {
    fn from(op: Operation) -> Self {
        Self {
            id: op.id,
            amount: op.amount,
            date: op.date,
            effective_date: op.effective_date,
            label: op.label,
            budget_link: op.budget_link,
            ignored: op.ignored,
            category_id: op.category_id,
            splits: op
                .splits
                .into_iter()
                .map(ExportOperationSplit::from)
                .collect(),
        }
    }
}

/// The recorded account balance inside an export payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportAccountBalance {
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Day the balance was read; operations accounted on that day are included in `amount`.
    pub date: NaiveDate,
}

impl From<AccountBalance> for ExportAccountBalance {
    fn from(balance: AccountBalance) -> Self {
        Self {
            amount: balance.amount,
            date: balance.date,
        }
    }
}

impl From<ExportAccountBalance> for AccountBalance {
    fn from(balance: ExportAccountBalance) -> Self {
        Self {
            amount: balance.amount,
            date: balance.date,
        }
    }
}

/// An import profile inside an export payload (omits `userId` and usage).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportImportProfile {
    pub name: String,
    pub label_col: usize,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    pub skip_lines: usize,
}

impl From<ImportProfile> for ExportImportProfile {
    fn from(p: ImportProfile) -> Self {
        Self {
            name: p.fields.name,
            label_col: p.fields.label_col,
            amount_col: p.fields.amount_col,
            date_col: p.fields.date_col,
            date_format: p.fields.date_format,
            skip_lines: p.fields.skip_lines,
        }
    }
}

impl From<ExportImportProfile> for ImportProfileRequest {
    fn from(p: ExportImportProfile) -> Self {
        Self {
            name: p.name,
            label_col: p.label_col,
            amount_col: p.amount_col,
            date_col: p.date_col,
            date_format: p.date_format,
            skip_lines: p.skip_lines,
        }
    }
}

/// Full export payload: all budgets + operations for the authenticated user.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    /// Schema version of the payload (currently 1).
    pub version: u32,
    /// UTC timestamp at which the export was generated.
    pub exported_at: DateTime<Utc>,
    /// Recorded account balance, null when none is recorded.
    pub balance: Option<ExportAccountBalance>,
    pub categories: Vec<ExportCategory>,
    pub budgets: Vec<ExportBudget>,
    pub operations: Vec<ExportOperation>,
    pub import_profiles: Vec<ExportImportProfile>,
}

/// Input payload for an import request. Mirrors `ExportResponse` shape.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDataRequest {
    /// Must match the supported export version.
    pub version: u32,
    /// Account balance to record when the account has none; absent from exports made before
    /// balances existed.
    #[serde(default)]
    pub balance: Option<ExportAccountBalance>,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub categories: Vec<ExportCategory>,
    #[serde(default)]
    pub budgets: Vec<ExportBudget>,
    #[serde(default)]
    pub operations: Vec<ExportOperation>,
    /// Absent from exports made before import profiles existed.
    #[serde(default)]
    pub import_profiles: Vec<ExportImportProfile>,
}

/// Result of an import: how many items were created or skipped as duplicates.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDataResponse {
    pub imported_categories: usize,
    /// Categories skipped because the account already has one by that name, which is used
    /// instead.
    pub skipped_categories: usize,
    pub imported_budgets: usize,
    pub skipped_budgets: usize,
    pub imported_operations: usize,
    pub skipped_operations: usize,
    pub imported_import_profiles: usize,
    /// Profiles skipped because the account already has one by that name.
    pub skipped_import_profiles: usize,
    /// Whether the payload's balance was recorded: false when it carries none or the account
    /// already has one, which is kept.
    pub imported_balance: bool,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn export_data<
    U: UserRepository,
    O: OperationRepository,
    B: BudgetRepository,
    P: ImportProfileRepository,
    C: CategoryRepository,
>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
) -> AppResult<Json<ExportResponse>> {
    let user_id = auth_user.id;
    let balance = state.user_repo.find_balance(user_id).await?;
    let categories = state.category_repo.list(user_id).await?;
    let budgets = state.budget_repo.list_all_for_user(user_id).await?;
    let operations = state.operation_repo.list_all_for_user(user_id).await?;
    let import_profiles = state.import_profile_repo.list(user_id).await?;

    Ok(Json(ExportResponse {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        balance: balance.map(Into::into),
        categories: categories.into_iter().map(ExportCategory::from).collect(),
        budgets: budgets.into_iter().map(ExportBudget::from).collect(),
        operations: operations.into_iter().map(ExportOperation::from).collect(),
        import_profiles: import_profiles
            .into_iter()
            .map(ExportImportProfile::from)
            .collect(),
    }))
}

pub async fn import_data<
    U: UserRepository,
    O: OperationRepository,
    B: BudgetRepository,
    P: ImportProfileRepository,
    C: CategoryRepository,
>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
    Json(body): Json<ImportDataRequest>,
) -> AppResult<(StatusCode, Json<ImportDataResponse>)> {
    if body.version != EXPORT_VERSION {
        return Err(AppError::BadRequest(format!(
            "unsupported export version {} (expected {EXPORT_VERSION})",
            body.version
        )));
    }
    for op in body.operations.iter().filter(|op| !op.splits.is_empty()) {
        let parts: Vec<NewOperationSplit> = op.splits.iter().map(Into::into).collect();
        validate_splits(op.amount, &parts).map_err(|e| {
            AppError::BadRequest(format!("operation {}: invalid splits: {e}", op.id))
        })?;
    }

    let profiles = body
        .import_profiles
        .into_iter()
        .map(|p| {
            let name = p.name.clone();
            ImportProfileFields::try_from(ImportProfileRequest::from(p))
                .map_err(|e| AppError::BadRequest(format!("import profile '{name}': {e}")))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let categories = body
        .categories
        .iter()
        .map(|c| {
            let request = CategoryRequest {
                name: c.name.clone(),
                color: c.color,
            };
            CategoryFields::try_from(request)
                .map(|fields| (c.id, fields))
                .map_err(|e| AppError::BadRequest(format!("category '{}': {e}", c.name)))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let user_id = auth_user.id;

    let (category_id_map, imported_categories) = import_categories(
        &state.category_repo,
        user_id,
        &categories,
        state.config.max_categories_per_user,
    )
    .await?;
    let remap_category = |id: Option<Uuid>| id.and_then(|id| category_id_map.get(&id).copied());

    // Merge budgets by label: keep existing, create missing. Track id mapping
    // so that operations can re-point their budget links to the correct budget.
    let existing_budgets = state.budget_repo.list_all_for_user(user_id).await?;
    let mut budget_id_map: HashMap<Uuid, Uuid> = HashMap::new();
    for existing in &existing_budgets {
        if let Some(incoming) = body.budgets.iter().find(|b| b.label == existing.label) {
            budget_id_map.insert(incoming.id, existing.id);
        }
    }

    let mut imported_budgets = 0usize;
    let mut skipped_budgets = 0usize;
    for b in &body.budgets {
        if budget_id_map.contains_key(&b.id) {
            skipped_budgets += 1;
            continue;
        }
        let fields = BudgetFields {
            label: b.label.clone(),
            budget_type: b.budget_type,
            kind: b.kind.clone(),
            rules: b.rules.clone(),
            category_id: remap_category(b.category_id),
        };
        let created = state.budget_repo.create(user_id, &fields).await?;
        budget_id_map.insert(b.id, created.id);
        imported_budgets += 1;
    }

    // Merge operations by (date, amount, label): skip if a matching row already exists.
    let mut imported_operations = 0usize;
    let mut skipped_operations = 0usize;
    for op in &body.operations {
        let exists = state
            .operation_repo
            .exists_by_fields(user_id, op.amount, op.date, &op.label)
            .await?;
        if exists {
            skipped_operations += 1;
            continue;
        }

        let new_id = Uuid::new_v4();
        state
            .operation_repo
            .insert(
                new_id,
                user_id,
                op.amount,
                op.date,
                op.effective_date,
                &op.label,
            )
            .await?;

        if !op.splits.is_empty() {
            let splits: Vec<NewOperationSplit> = op
                .splits
                .iter()
                .map(|s| NewOperationSplit {
                    budget_id: s.budget_id.and_then(|bid| budget_id_map.get(&bid).copied()),
                    category_id: remap_category(s.category_id),
                    ..s.into()
                })
                .collect();
            state
                .operation_repo
                .replace_splits(new_id, user_id, &splits)
                .await?;
        }

        let remapped_link = match &op.budget_link {
            BudgetLink::Unlinked => BudgetLink::Unlinked,
            BudgetLink::Manual { budget_id } => match budget_id_map.get(budget_id) {
                Some(new_bid) => BudgetLink::Manual {
                    budget_id: *new_bid,
                },
                None => BudgetLink::Unlinked,
            },
            BudgetLink::Auto { budget_id } => match budget_id_map.get(budget_id) {
                Some(new_bid) => BudgetLink::Auto {
                    budget_id: *new_bid,
                },
                None => BudgetLink::Unlinked,
            },
        };
        if op.splits.is_empty() && !matches!(remapped_link, BudgetLink::Unlinked) {
            state
                .operation_repo
                .set_budget_link(new_id, user_id, &remapped_link)
                .await?;
        }

        let category_id = remap_category(op.category_id);
        if op.splits.is_empty() && category_id.is_some() {
            state
                .operation_repo
                .set_category(new_id, user_id, category_id)
                .await?;
        }

        if op.ignored {
            state
                .operation_repo
                .set_ignored(new_id, user_id, true)
                .await?;
        }

        imported_operations += 1;
    }

    let (imported_import_profiles, skipped_import_profiles) =
        import_profiles(&state.import_profile_repo, user_id, &profiles).await?;

    let imported_balance = match body.balance {
        Some(balance) if state.user_repo.find_balance(user_id).await?.is_none() => {
            state.user_repo.set_balance(user_id, balance.into()).await?;
            true
        }
        _ => false,
    };

    Ok((
        StatusCode::OK,
        Json(ImportDataResponse {
            imported_categories,
            skipped_categories: categories.len() - imported_categories,
            imported_budgets,
            skipped_budgets,
            imported_operations,
            skipped_operations,
            imported_import_profiles,
            skipped_import_profiles,
            imported_balance,
        }),
    ))
}

/// Create the payload's categories the account has no category by that name for, and map each
/// payload id to the account's category of that name; returns the map and how many were created.
/// Fails with `Conflict`, creating none, when they would exceed `max` categories.
async fn import_categories(
    repo: &impl CategoryRepository,
    user_id: Uuid,
    incoming: &[(Uuid, CategoryFields)],
    max: u32,
) -> AppResult<(HashMap<Uuid, Uuid>, usize)> {
    let mut id_map = HashMap::new();
    if incoming.is_empty() {
        return Ok((id_map, 0));
    }
    let mut by_name: HashMap<String, Uuid> = repo
        .list(user_id)
        .await?
        .into_iter()
        .map(|c| (c.fields.name, c.id))
        .collect();
    let mut new_names: Vec<&str> = incoming
        .iter()
        .map(|(_, fields)| fields.name.as_str())
        .filter(|name| !by_name.contains_key(*name))
        .collect();
    new_names.sort_unstable();
    new_names.dedup();
    if by_name.len() + new_names.len() > max as usize {
        return Err(AppError::Conflict(format!(
            "importing {} new categories would exceed the category limit ({max})",
            new_names.len()
        )));
    }

    let mut imported = 0usize;
    for (incoming_id, fields) in incoming {
        let id = match by_name.get(&fields.name) {
            Some(id) => *id,
            None => {
                let created = repo.create(user_id, fields).await?;
                by_name.insert(created.fields.name, created.id);
                imported += 1;
                created.id
            }
        };
        id_map.insert(*incoming_id, id);
    }
    Ok((id_map, imported))
}

/// Create the payload's profiles the account has no profile by that name for; returns how many
/// were imported and skipped.
async fn import_profiles(
    repo: &impl ImportProfileRepository,
    user_id: Uuid,
    incoming: &[ImportProfileFields],
) -> AppResult<(usize, usize)> {
    if incoming.is_empty() {
        return Ok((0, 0));
    }
    let mut names: Vec<String> = repo
        .list(user_id)
        .await?
        .into_iter()
        .map(|p| p.fields.name)
        .collect();
    let mut imported = 0usize;
    for profile in incoming {
        if names.contains(&profile.name) {
            continue;
        }
        repo.create(user_id, profile).await?;
        names.push(profile.name.clone());
        imported += 1;
    }
    Ok((imported, incoming.len() - imported))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType, CurrentPeriod, Recurrence, YearMonth},
            user::UserRole,
        },
        repositories::{
            MockBudgetRepository, MockCategoryRepository, MockImportProfileRepository,
            MockOperationRepository, MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, make_test_state,
            make_test_state_with_categories, make_test_state_with_profiles, response_json,
        },
    };
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use tower::ServiceExt;

    fn make_budget(user_id: Uuid, label: &str) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id,
            label: label.to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::new(10000, 2),
            },
            rules: vec![],
            category_id: None,
            created_at: Utc::now(),
        }
    }

    /// The budget a mocked `create` returns for `fields`.
    fn created_budget(user_id: Uuid, fields: &BudgetFields) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id,
            label: fields.label.clone(),
            budget_type: fields.budget_type,
            kind: fields.kind.clone(),
            rules: fields.rules.clone(),
            category_id: fields.category_id,
            created_at: Utc::now(),
        }
    }

    fn make_operation(user_id: Uuid, label: &str, budget_link: BudgetLink) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id,
            amount: Decimal::new(-1234, 2),
            date: NaiveDate::from_ymd_opt(2024, 3, 15).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link,
            ignored: false,
            category_id: None,
            budget_category_id: None,
            splits: vec![],
        }
    }

    #[tokio::test]
    async fn export_returns_all_budgets_and_operations() {
        let user_id = Uuid::new_v4();
        let budget = make_budget(user_id, "Groceries");
        let op = make_operation(user_id, "Carrefour", BudgetLink::Unlinked);

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(move |_| {
                let budget = budget.clone();
                Box::pin(async { Ok(vec![budget]) })
            });
        op_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(move |_| {
                let op = op.clone();
                Box::pin(async { Ok(vec![op]) })
            });

        let app = build_test_router(make_test_state(
            users_with_balance(None),
            op_repo,
            budget_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ExportResponse = response_json(resp).await;
        assert_eq!(json.version, EXPORT_VERSION);
        assert_eq!(json.budgets.len(), 1);
        assert_eq!(json.budgets[0].label, "Groceries");
        assert_eq!(json.operations.len(), 1);
        assert_eq!(json.operations[0].label, "Carrefour");
    }

    #[tokio::test]
    async fn export_requires_auth() {
        let op_repo = MockOperationRepository::new();
        let budget_repo = MockBudgetRepository::new();
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let resp = app
            .oneshot(json_request("GET", "/data/export", None, None))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn import_rejects_wrong_version() {
        let user_id = Uuid::new_v4();
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{"version":999,"budgets":[],"operations":[]}"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn import_creates_missing_and_skips_existing_by_label() {
        let user_id = Uuid::new_v4();
        let existing = make_budget(user_id, "Existing");

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async { Ok(vec![existing]) })
            });
        // One new budget is created (the "New" one); "Existing" is skipped.
        budget_repo
            .expect_create()
            .times(1)
            .returning(move |uid, fields| {
                let created = created_budget(uid, fields);
                Box::pin(async move { Ok(created) })
            });
        op_repo
            .expect_exists_by_fields()
            .times(0)
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "budgets": [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "label": "Existing",
                    "budgetType": "expense",
                    "kind": {"type":"occasional","month":1,"year":2024,"amount":"100"},
                    "rules": [],
                    "createdAt": "2024-01-01T00:00:00Z"
                },
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "label": "New",
                    "budgetType": "expense",
                    "kind": {"type":"occasional","month":2,"year":2024,"amount":"50"},
                    "rules": [],
                    "createdAt": "2024-01-01T00:00:00Z"
                }
            ],
            "operations": []
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_budgets, 1);
        assert_eq!(json.skipped_budgets, 1);
        assert_eq!(json.imported_operations, 0);
        assert_eq!(json.skipped_operations, 0);
        assert!(!json.imported_balance);
    }

    #[tokio::test]
    async fn import_remaps_budget_link_to_existing_budget_with_same_label() {
        let user_id = Uuid::new_v4();
        let existing_id = Uuid::new_v4();
        let existing = Budget {
            id: existing_id,
            ..make_budget(user_id, "Groceries")
        };

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async { Ok(vec![existing]) })
            });
        op_repo
            .expect_exists_by_fields()
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        // Link must be re-pointed to the existing budget id.
        op_repo
            .expect_set_budget_link()
            .withf(move |_id, _uid, link| {
                matches!(link, BudgetLink::Manual { budget_id } if *budget_id == existing_id)
            })
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "budgets": [
                {
                    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "label": "Groceries",
                    "budgetType": "expense",
                    "kind": {"type":"occasional","month":1,"year":2024,"amount":"100"},
                    "rules": [],
                    "createdAt": "2024-01-01T00:00:00Z"
                }
            ],
            "operations": [
                {
                    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "amount": "-12.34",
                    "date": "2024-03-15",
                    "effectiveDate": null,
                    "label": "Carrefour",
                    "budgetLink": {"type":"manual","budgetId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
                    "ignored": false
                }
            ]
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_budgets, 0);
        assert_eq!(json.skipped_budgets, 1);
        assert_eq!(json.imported_operations, 1);
    }

    #[tokio::test]
    async fn import_skips_duplicate_operations_and_restores_ignored_flag() {
        let user_id = Uuid::new_v4();

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        // Two ops: first is a duplicate, second is new and ignored.
        let mut call = 0;
        op_repo
            .expect_exists_by_fields()
            .times(2)
            .returning(move |_, _, _, _| {
                call += 1;
                let dup = call == 1;
                Box::pin(async move { Ok(dup) })
            });
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        // ignored=true → set_ignored should be called once.
        op_repo
            .expect_set_ignored()
            .withf(|_, _, ignored| *ignored)
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "budgets": [],
            "operations": [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "amount": "-5.00",
                    "date": "2024-01-01",
                    "effectiveDate": null,
                    "label": "Dup",
                    "budgetLink": {"type":"unlinked"},
                    "ignored": false
                },
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "amount": "-6.00",
                    "date": "2024-01-02",
                    "effectiveDate": null,
                    "label": "New",
                    "budgetLink": {"type":"unlinked"},
                    "ignored": true
                }
            ]
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_operations, 1);
        assert_eq!(json.skipped_operations, 1);
    }

    #[tokio::test]
    async fn import_unlinks_operation_when_referenced_budget_missing() {
        let user_id = Uuid::new_v4();

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        op_repo
            .expect_exists_by_fields()
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        // No set_budget_link call because the referenced budget is not in the payload.
        op_repo.expect_set_budget_link().times(0);

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "budgets": [],
            "operations": [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "amount": "-7.00",
                    "date": "2024-02-02",
                    "effectiveDate": null,
                    "label": "Orphan",
                    "budgetLink": {"type":"manual","budgetId":"ffffffff-ffff-ffff-ffff-ffffffffffff"},
                    "ignored": false
                }
            ]
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_operations, 1);
    }

    #[tokio::test]
    async fn export_includes_splits() {
        let user_id = Uuid::new_v4();
        let budget_id = Uuid::new_v4();
        let op = Operation {
            splits: vec![
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-234, 2),
                    budget_id: Some(budget_id),
                    category_id: None,
                    budget_category_id: None,
                },
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-1000, 2),
                    budget_id: None,
                    category_id: None,
                    budget_category_id: None,
                },
            ],
            ..make_operation(user_id, "Cash", BudgetLink::Unlinked)
        };

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        op_repo.expect_list_all_for_user().returning(move |_| {
            let op = op.clone();
            Box::pin(async { Ok(vec![op]) })
        });

        let app = build_test_router(make_test_state(
            users_with_balance(None),
            op_repo,
            budget_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        let splits = &json["operations"][0]["splits"];
        assert_eq!(splits[0]["amount"], "-2.34");
        assert_eq!(splits[0]["budgetId"], budget_id.to_string());
        assert!(splits[1]["budgetId"].is_null());
    }

    #[tokio::test]
    async fn import_restores_splits_with_remapped_budgets() {
        let user_id = Uuid::new_v4();
        let existing_id = Uuid::new_v4();
        let existing = Budget {
            id: existing_id,
            ..make_budget(user_id, "Groceries")
        };

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .once()
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async { Ok(vec![existing]) })
            });
        op_repo
            .expect_exists_by_fields()
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .once()
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_replace_splits()
            .withf(move |_, uid, splits| {
                *uid == user_id
                    && splits
                        == [
                            NewOperationSplit {
                                amount: Decimal::new(-30, 0),
                                budget_id: Some(existing_id),
                                category_id: None,
                            },
                            NewOperationSplit {
                                amount: Decimal::new(-70, 0),
                                budget_id: None,
                                category_id: None,
                            },
                        ]
            })
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));
        op_repo.expect_set_budget_link().never();

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "budgets": [
                {
                    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "label": "Groceries",
                    "budgetType": "expense",
                    "kind": {"type":"occasional","month":1,"year":2024,"amount":"100"},
                    "rules": [],
                    "createdAt": "2024-01-01T00:00:00Z"
                }
            ],
            "operations": [
                {
                    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "amount": "-100",
                    "date": "2024-03-15",
                    "effectiveDate": null,
                    "label": "Cash",
                    "budgetLink": {"type":"manual","budgetId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
                    "ignored": false,
                    "splits": [
                        {"amount": "-30", "budgetId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"},
                        {"amount": "-70", "budgetId": "ffffffff-ffff-ffff-ffff-ffffffffffff"}
                    ]
                }
            ]
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_operations, 1);
    }

    #[tokio::test]
    async fn import_rejects_invalid_splits_before_writing() {
        let user_id = Uuid::new_v4();
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = r#"{
            "version": 1,
            "operations": [
                {
                    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "amount": "-100",
                    "date": "2024-03-15",
                    "effectiveDate": null,
                    "label": "Cash",
                    "budgetLink": {"type":"unlinked"},
                    "ignored": false,
                    "splits": [
                        {"amount": "-30", "budgetId": null},
                        {"amount": "-60", "budgetId": null}
                    ]
                }
            ]
        }"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn import_round_trips_recurring_budget_kind() {
        let user_id = Uuid::new_v4();

        let op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        budget_repo
            .expect_list_all_for_user()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        budget_repo
            .expect_create()
            .withf(|_uid, fields| {
                fields.label == "Rent"
                    && matches!(
                        fields.kind,
                        BudgetKind::Recurring {
                            recurrence: Recurrence::Monthly,
                            ..
                        }
                    )
            })
            .times(1)
            .returning(move |uid, fields| {
                let created = created_budget(uid, fields);
                Box::pin(async move { Ok(created) })
            });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        // Build an export payload from a fresh Budget → ensures serde round-trips.
        let budget = Budget {
            id: Uuid::new_v4(),
            user_id,
            label: "Rent".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Recurring {
                recurrence: Recurrence::Monthly,
                closed_periods: vec![],
                current_period: CurrentPeriod {
                    start: YearMonth::new(2024, 1),
                    end: None,
                    amount: Decimal::new(80000, 2),
                },
            },
            rules: vec![],
            category_id: None,
            created_at: Utc::now(),
        };
        // Round-trip: serialize the export payload and feed it back as input.
        let export = ExportResponse {
            version: EXPORT_VERSION,
            exported_at: Utc::now(),
            balance: None,
            categories: vec![],
            budgets: vec![ExportBudget::from(budget)],
            operations: vec![],
            import_profiles: vec![],
        };
        let body = serde_json::to_string(&export).unwrap();

        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(&body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_budgets, 1);
    }

    fn users_with_balance(balance: Option<AccountBalance>) -> MockUserRepository {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_balance()
            .returning(move |_| Box::pin(async move { Ok(balance) }));
        user_repo
    }

    fn sample_balance() -> AccountBalance {
        AccountBalance {
            amount: Decimal::new(152340, 2),
            date: NaiveDate::from_ymd_opt(2026, 3, 31).unwrap(),
        }
    }

    fn empty_repos() -> (MockOperationRepository, MockBudgetRepository) {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        (op_repo, budget_repo)
    }

    async fn import_balance_payload(user_repo: MockUserRepository) -> ImportDataResponse {
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state(user_repo, op_repo, budget_repo));
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let body = r#"{"version":1,"balance":{"amount":"1523.40","date":"2026-03-31"},
                       "budgets":[],"operations":[]}"#;
        let resp = app
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        response_json(resp).await
    }

    #[tokio::test]
    async fn export_includes_the_recorded_balance() {
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state(
            users_with_balance(Some(sample_balance())),
            op_repo,
            budget_repo,
        ));
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json["balance"],
            serde_json::json!({"amount": "1523.40", "date": "2026-03-31"})
        );
    }

    #[tokio::test]
    async fn export_without_balance_has_a_null_balance() {
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state(
            users_with_balance(None),
            op_repo,
            budget_repo,
        ));
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        let json: serde_json::Value = response_json(resp).await;
        assert!(json["balance"].is_null());
    }

    #[tokio::test]
    async fn import_records_the_balance_when_the_account_has_none() {
        let mut user_repo = users_with_balance(None);
        user_repo
            .expect_set_balance()
            .withf(|_, balance| *balance == sample_balance())
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let json = import_balance_payload(user_repo).await;
        assert!(json.imported_balance);
    }

    #[tokio::test]
    async fn import_keeps_an_existing_balance() {
        let mut user_repo = users_with_balance(Some(AccountBalance {
            amount: Decimal::ONE,
            date: NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(),
        }));
        user_repo.expect_set_balance().never();

        let json = import_balance_payload(user_repo).await;
        assert!(!json.imported_balance);
    }

    fn profile_fields(name: &str) -> ImportProfileFields {
        ImportProfileFields {
            name: name.to_string(),
            label_col: 1,
            amount_col: 3,
            date_col: 0,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1,
        }
    }

    fn stored_profile(user_id: Uuid, name: &str) -> ImportProfile {
        ImportProfile {
            id: Uuid::new_v4(),
            user_id,
            fields: profile_fields(name),
            last_used_at: Some(Utc::now()),
            created_at: Utc::now(),
        }
    }

    fn profile_json(name: &str, date_col: usize) -> serde_json::Value {
        serde_json::json!({
            "name": name,
            "labelCol": 1,
            "amountCol": 3,
            "dateCol": date_col,
            "dateFormat": "%d/%m/%Y",
            "skipLines": 1
        })
    }

    async fn import_profiles_payload(
        profile_repo: MockImportProfileRepository,
        profiles: serde_json::Value,
    ) -> axum::response::Response {
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state_with_profiles(
            users_with_balance(None),
            op_repo,
            budget_repo,
            profile_repo,
        ));
        let body = serde_json::json!({ "version": 1, "importProfiles": profiles }).to_string();
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        app.oneshot(json_request(
            "POST",
            "/data/import",
            Some(&body),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn export_includes_import_profiles_without_usage() {
        let user_id = Uuid::new_v4();
        let mut profile_repo = MockImportProfileRepository::new();
        profile_repo.expect_list().returning(move |user_id| {
            let profile = stored_profile(user_id, "Bank");
            Box::pin(async move { Ok(vec![profile]) })
        });
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state_with_profiles(
            users_with_balance(None),
            op_repo,
            budget_repo,
            profile_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json["importProfiles"],
            serde_json::json!([profile_json("Bank", 0)])
        );
    }

    #[tokio::test]
    async fn import_creates_missing_profiles_and_skips_existing_by_name() {
        let mut profile_repo = MockImportProfileRepository::new();
        profile_repo.expect_list().returning(|user_id| {
            let profile = stored_profile(user_id, "Bank");
            Box::pin(async move { Ok(vec![profile]) })
        });
        profile_repo
            .expect_create()
            .withf(|_, fields| *fields == profile_fields("Savings"))
            .times(1)
            .returning(|user_id, fields| {
                let created = ImportProfile {
                    fields: fields.clone(),
                    ..stored_profile(user_id, "")
                };
                Box::pin(async move { Ok(created) })
            });

        let resp = import_profiles_payload(
            profile_repo,
            serde_json::json!([profile_json("Bank", 0), profile_json("Savings", 0)]),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_import_profiles, 1);
        assert_eq!(json.skipped_import_profiles, 1);
    }

    #[tokio::test]
    async fn import_rejects_an_invalid_profile_before_writing() {
        let mut profile_repo = MockImportProfileRepository::new();
        profile_repo.expect_create().never();

        let resp =
            import_profiles_payload(profile_repo, serde_json::json!([profile_json("Broken", 1)]))
                .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    fn make_category(user_id: Uuid, name: &str) -> Category {
        Category {
            id: Uuid::new_v4(),
            user_id,
            fields: CategoryFields {
                name: name.to_string(),
                color: CategoryColor::Teal,
            },
            created_at: Utc::now(),
        }
    }

    fn categories_listing(existing: Vec<Category>) -> MockCategoryRepository {
        let mut repo = MockCategoryRepository::new();
        repo.expect_list().returning(move |_| {
            let existing = existing.clone();
            Box::pin(async move { Ok(existing) })
        });
        repo
    }

    async fn post_import(app: axum::Router, user_id: Uuid, body: &str) -> axum::response::Response {
        let auth = auth_header(user_id, UserRole::User);
        app.oneshot(json_request(
            "POST",
            "/data/import",
            Some(body),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn export_includes_categories_and_their_references() {
        let user_id = Uuid::new_v4();
        let category = make_category(user_id, "Food");
        let category_id = category.id;
        let budget = Budget {
            category_id: Some(category_id),
            ..make_budget(user_id, "Groceries")
        };
        let op = Operation {
            category_id: Some(category_id),
            ..make_operation(user_id, "Carrefour", BudgetLink::Unlinked)
        };
        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo.expect_list_all_for_user().returning(move |_| {
            let budget = budget.clone();
            Box::pin(async { Ok(vec![budget]) })
        });
        op_repo.expect_list_all_for_user().returning(move |_| {
            let op = op.clone();
            Box::pin(async { Ok(vec![op]) })
        });
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_balance()
            .returning(|_| Box::pin(async { Ok(None) }));

        let app = build_test_router(make_test_state_with_categories(
            user_repo,
            op_repo,
            budget_repo,
            categories_listing(vec![category]),
        ));
        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["categories"][0]["id"], category_id.to_string());
        assert_eq!(json["categories"][0]["name"], "Food");
        assert_eq!(json["categories"][0]["color"], "teal");
        assert!(json["categories"][0].get("userId").is_none());
        assert_eq!(json["budgets"][0]["categoryId"], category_id.to_string());
        assert_eq!(json["operations"][0]["categoryId"], category_id.to_string());
    }

    #[tokio::test]
    async fn import_merges_categories_by_name_and_remaps_references() {
        let user_id = Uuid::new_v4();
        let existing = make_category(user_id, "Food");
        let existing_id = existing.id;
        let created_id = Uuid::new_v4();

        let mut category_repo = categories_listing(vec![existing]);
        category_repo
            .expect_create()
            .withf(|_, fields| fields.name == "Fun")
            .once()
            .returning(move |user_id, fields| {
                let created = Category {
                    id: created_id,
                    ..make_category(user_id, &fields.name)
                };
                Box::pin(async move { Ok(created) })
            });
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        budget_repo
            .expect_create()
            .withf(move |_, fields| fields.category_id == Some(created_id))
            .once()
            .returning(|uid, fields| {
                let created = created_budget(uid, fields);
                Box::pin(async move { Ok(created) })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_exists_by_fields()
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_set_category()
            .withf(move |_, _, category_id| *category_id == Some(existing_id))
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let body = r#"{
            "version": 1,
            "categories": [
                {"id": "11111111-1111-1111-1111-111111111111", "name": "Food", "color": "orange"},
                {"id": "22222222-2222-2222-2222-222222222222", "name": "Fun", "color": "grape"}
            ],
            "budgets": [
                {
                    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "label": "Outings",
                    "budgetType": "expense",
                    "kind": {"type":"occasional","month":1,"year":2024,"amount":"100"},
                    "rules": [],
                    "categoryId": "22222222-2222-2222-2222-222222222222",
                    "createdAt": "2024-01-01T00:00:00Z"
                }
            ],
            "operations": [
                {
                    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "amount": "-12.34",
                    "date": "2024-03-15",
                    "effectiveDate": null,
                    "label": "Carrefour",
                    "budgetLink": {"type":"unlinked"},
                    "ignored": false,
                    "categoryId": "11111111-1111-1111-1111-111111111111"
                }
            ]
        }"#;
        let app = build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            category_repo,
        ));
        let resp = post_import(app, user_id, body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_categories, 1);
        assert_eq!(json.skipped_categories, 1);
    }

    #[tokio::test]
    async fn import_beyond_the_category_limit_is_a_conflict_before_writing() {
        let user_id = Uuid::new_v4();
        let existing = (0..49)
            .map(|i| make_category(user_id, &format!("C{i}")))
            .collect();
        let mut category_repo = categories_listing(existing);
        category_repo.expect_create().never();
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_insert().never();

        let body = r#"{
            "version": 1,
            "categories": [
                {"id": "11111111-1111-1111-1111-111111111111", "name": "New 1", "color": "red"},
                {"id": "22222222-2222-2222-2222-222222222222", "name": "New 2", "color": "red"},
                {"id": "33333333-3333-3333-3333-333333333333", "name": "C0", "color": "red"}
            ]
        }"#;
        let app = build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            category_repo,
        ));
        let resp = post_import(app, user_id, body).await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }
}
