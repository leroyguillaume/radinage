use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        account::{Account, AccountBalance, AccountFields, AccountKind},
        budget::{Budget, BudgetFields, BudgetKind, BudgetType, LabelPattern, Rule},
        category::{Category, CategoryColor, CategoryFields, CategoryIcon, CategoryRule},
        ignore_rule::{IgnoreRule, IgnoreRuleFields},
        import_profile::{CsvDelimiter, ImportProfile, ImportProfileFields},
        operation::{
            BudgetLink, NewOperation, NewOperationSplit, Operation, OperationSplit, validate_splits,
        },
        transfer::{TransferRule, TransferRuleFields},
    },
    error::{AppError, AppResult},
    handlers::{
        accounts::AccountRequest,
        categories::CategoryRequest,
        ignore_rules::{IgnoreRuleRequest, MAX_VALUE_LEN},
        import_profiles::ImportProfileRequest,
    },
    repositories::{
        AccountRepository, BudgetRepository, CategoryRepository, IgnoreRuleRepository,
        ImportProfileRepository, OperationRepository,
    },
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    /// Payload account a savings budget's money goes to; absent from exports made before
    /// budgets could have one.
    #[serde(default)]
    pub account_id: Option<Uuid>,
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
            account_id: b.account_id,
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
    #[serde(default)]
    pub icon: Option<CategoryIcon>,
    /// Absent from exports made before categories could net their totals.
    #[serde(default)]
    pub net_totals: bool,
    /// Absent from exports made before categories had rules.
    #[serde(default)]
    pub rules: Vec<CategoryRule>,
}

impl From<Category> for ExportCategory {
    fn from(c: Category) -> Self {
        Self {
            id: c.id,
            name: c.fields.name,
            color: c.fields.color,
            icon: c.fields.icon,
            net_totals: c.fields.net_totals,
            rules: c.fields.rules,
        }
    }
}

/// An ignore rule inside an export payload (omits `userId`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportIgnoreRule {
    /// Identifier the payload's operations refer to it by.
    pub id: Uuid,
    pub label_pattern: LabelPattern,
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub amount: Option<Decimal>,
}

impl From<IgnoreRule> for ExportIgnoreRule {
    fn from(rule: IgnoreRule) -> Self {
        Self {
            id: rule.id,
            label_pattern: rule.fields.label_pattern,
            amount: rule.fields.amount,
        }
    }
}

/// A transfer rule inside an export payload (omits `userId`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransferRule {
    /// Identifier the payload's operations refer to it by.
    pub id: Uuid,
    /// Payload account whose operations `labelPattern` recognizes.
    pub account_id: Uuid,
    /// Payload account the transfers are with.
    pub counterpart_account_id: Uuid,
    pub label_pattern: LabelPattern,
    /// Label of the other side on `counterpartAccountId`, when that account receives
    /// operations.
    #[serde(default)]
    pub counterpart_label_pattern: Option<LabelPattern>,
    pub created_at: DateTime<Utc>,
}

impl From<TransferRule> for ExportTransferRule {
    fn from(rule: TransferRule) -> Self {
        Self {
            id: rule.id,
            account_id: rule.fields.account_id,
            counterpart_account_id: rule.fields.counterpart_account_id,
            label_pattern: rule.fields.label_pattern,
            counterpart_label_pattern: rule.fields.counterpart_label_pattern,
            created_at: rule.created_at,
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
    /// Payload account the operation is on; absent from exports made before accounts existed,
    /// the operation then going to the default account.
    #[serde(default)]
    pub account_id: Option<Uuid>,
    /// Ignore rule that ignored the operation; absent from exports made before ignore rules
    /// existed.
    #[serde(default)]
    pub ignore_rule_id: Option<Uuid>,
    /// Payload account the operation is a transfer with; absent from exports made before
    /// transfers existed.
    #[serde(default)]
    pub transfer_account_id: Option<Uuid>,
    /// Transfer rule that made the operation a transfer.
    #[serde(default)]
    pub transfer_rule_id: Option<Uuid>,
    /// Payload operation on the other side of the transfer.
    #[serde(default)]
    pub transfer_operation_id: Option<Uuid>,
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
    /// Absent from exports made before parts had their own date.
    #[serde(default)]
    pub effective_date: Option<NaiveDate>,
    pub budget_id: Option<Uuid>,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub category_id: Option<Uuid>,
}

impl From<OperationSplit> for ExportOperationSplit {
    fn from(split: OperationSplit) -> Self {
        Self {
            amount: split.amount,
            effective_date: split.effective_date,
            budget_id: split.budget_id,
            category_id: split.category_id,
        }
    }
}

impl From<&ExportOperationSplit> for NewOperationSplit {
    fn from(split: &ExportOperationSplit) -> Self {
        Self {
            amount: split.amount,
            effective_date: split.effective_date,
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
            account_id: Some(op.account_id),
            ignore_rule_id: op.ignore_rule_id,
            transfer_account_id: op.transfer.map(|t| t.account_id),
            transfer_rule_id: op.transfer.and_then(|t| t.rule_id),
            transfer_operation_id: op.transfer.and_then(|t| t.operation_id),
            category_id: op.category_id,
            splits: op
                .splits
                .into_iter()
                .map(ExportOperationSplit::from)
                .collect(),
        }
    }
}

/// An account inside an export payload (omits `userId`), with its balances.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportAccount {
    /// Identifier the payload's operations and import profiles refer to it by.
    pub id: Uuid,
    pub name: String,
    pub kind: AccountKind,
    #[serde(default)]
    pub imported: bool,
    /// Balances read on the account, most recent first.
    #[serde(default)]
    pub balances: Vec<ExportAccountBalance>,
}

/// A balance read on an account, inside an export payload.
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
    /// Payload account the profile imports on; absent from exports made before accounts
    /// existed, the profile then importing on the default account.
    #[serde(default)]
    pub account_id: Option<Uuid>,
    pub label_col: usize,
    /// Absent from exports made before profiles had a label fallback column.
    #[serde(default)]
    pub label_fallback_col: Option<usize>,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    pub skip_lines: usize,
    /// Absent from exports made before profiles had a CSV delimiter.
    #[serde(default)]
    pub csv_delimiter: CsvDelimiter,
}

impl From<ImportProfile> for ExportImportProfile {
    fn from(p: ImportProfile) -> Self {
        Self {
            name: p.fields.name,
            account_id: Some(p.fields.account_id),
            label_col: p.fields.label_col,
            label_fallback_col: p.fields.label_fallback_col,
            amount_col: p.fields.amount_col,
            date_col: p.fields.date_col,
            date_format: p.fields.date_format,
            skip_lines: p.fields.skip_lines,
            csv_delimiter: p.fields.csv_delimiter,
        }
    }
}

/// The request a payload profile is validated as, before its account is known: the account
/// is set once the payload accounts are imported.
impl From<ExportImportProfile> for ImportProfileRequest {
    fn from(p: ExportImportProfile) -> Self {
        Self {
            name: p.name,
            account_id: Uuid::nil(),
            label_col: p.label_col,
            label_fallback_col: p.label_fallback_col,
            amount_col: p.amount_col,
            date_col: p.date_col,
            date_format: p.date_format,
            skip_lines: p.skip_lines,
            csv_delimiter: p.csv_delimiter,
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
    pub accounts: Vec<ExportAccount>,
    pub categories: Vec<ExportCategory>,
    pub budgets: Vec<ExportBudget>,
    pub ignore_rules: Vec<ExportIgnoreRule>,
    pub transfer_rules: Vec<ExportTransferRule>,
    pub operations: Vec<ExportOperation>,
    pub import_profiles: Vec<ExportImportProfile>,
}

/// Input payload for an import request. Mirrors `ExportResponse` shape.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDataRequest {
    /// Must match the supported export version.
    pub version: u32,
    /// Absent from exports made before accounts existed.
    #[serde(default)]
    pub accounts: Vec<ExportAccount>,
    /// The single balance of exports made before accounts existed, recorded on the default
    /// account when it has none.
    #[serde(default)]
    pub balance: Option<ExportAccountBalance>,
    /// Absent from exports made before categories existed.
    #[serde(default)]
    pub categories: Vec<ExportCategory>,
    #[serde(default)]
    pub budgets: Vec<ExportBudget>,
    /// Absent from exports made before ignore rules existed.
    #[serde(default)]
    pub ignore_rules: Vec<ExportIgnoreRule>,
    /// Absent from exports made before transfers existed.
    #[serde(default)]
    pub transfer_rules: Vec<ExportTransferRule>,
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
    pub imported_ignore_rules: usize,
    /// Rules skipped because the account already has one with the same pattern and amount,
    /// which is used instead.
    pub skipped_ignore_rules: usize,
    pub imported_transfer_rules: usize,
    /// Rules skipped because the user already has one with the same accounts and pattern, which
    /// is used instead, or because they name an account the payload does not carry.
    pub skipped_transfer_rules: usize,
    pub imported_operations: usize,
    pub skipped_operations: usize,
    pub imported_import_profiles: usize,
    /// Profiles skipped because the account already has one by that name.
    pub skipped_import_profiles: usize,
    pub imported_accounts: usize,
    /// Accounts skipped because the user already has one by that name, which is used instead
    /// and keeps its own balances.
    pub skipped_accounts: usize,
    /// Balances recorded: those of the accounts created, and the single balance of an older
    /// export when the default account had none.
    pub imported_balances: usize,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn export_data<
    U,
    O: OperationRepository,
    B: BudgetRepository,
    P: ImportProfileRepository,
    C: CategoryRepository,
    R: IgnoreRuleRepository,
    A: AccountRepository,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
) -> AppResult<Json<ExportResponse>> {
    let user_id = auth_user.id;
    let mut accounts = Vec::new();
    for account in state.account_repo.list(user_id).await? {
        let balances = state
            .account_repo
            .list_balances(account.id, user_id)
            .await?;
        accounts.push(ExportAccount {
            id: account.id,
            name: account.fields.name,
            kind: account.fields.kind,
            imported: account.fields.imported,
            balances: balances.into_iter().map(|e| e.balance.into()).collect(),
        });
    }
    let categories = state.category_repo.list(user_id).await?;
    let budgets = state.budget_repo.list_all_for_user(user_id).await?;
    let operations = state.operation_repo.list_all_for_user(user_id).await?;
    let import_profiles = state.import_profile_repo.list(user_id).await?;
    let ignore_rules = state.ignore_rule_repo.list(user_id).await?;
    let transfer_rules = state.account_repo.list_transfer_rules(user_id).await?;

    Ok(Json(ExportResponse {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        accounts,
        categories: categories.into_iter().map(ExportCategory::from).collect(),
        budgets: budgets.into_iter().map(ExportBudget::from).collect(),
        ignore_rules: ignore_rules
            .into_iter()
            .map(ExportIgnoreRule::from)
            .collect(),
        transfer_rules: transfer_rules
            .into_iter()
            .map(ExportTransferRule::from)
            .collect(),
        operations: operations.into_iter().map(ExportOperation::from).collect(),
        import_profiles: import_profiles
            .into_iter()
            .map(ExportImportProfile::from)
            .collect(),
    }))
}

pub async fn import_data<
    U,
    O: OperationRepository,
    B: BudgetRepository,
    P: ImportProfileRepository,
    C: CategoryRepository,
    R: IgnoreRuleRepository,
    A: AccountRepository,
>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
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
            let account_id = p.account_id;
            ImportProfileFields::try_from(ImportProfileRequest::from(p))
                .map(|fields| (account_id, fields))
                .map_err(|e| AppError::BadRequest(format!("import profile '{name}': {e}")))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let accounts = body
        .accounts
        .iter()
        .map(|a| {
            let request = AccountRequest {
                name: a.name.clone(),
                kind: a.kind,
                imported: a.imported,
            };
            AccountFields::try_from(request)
                .map(|fields| {
                    let balances = a.balances.iter().copied().map(Into::into).collect();
                    (a.id, fields, balances)
                })
                .map_err(|e| AppError::BadRequest(format!("account '{}': {e}", a.name)))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let categories = body
        .categories
        .iter()
        .map(|c| {
            let request = CategoryRequest {
                name: c.name.clone(),
                color: c.color.clone(),
                icon: c.icon,
                net_totals: c.net_totals,
                rules: c.rules.clone(),
            };
            CategoryFields::try_from(request)
                .map(|fields| (c.id, fields))
                .map_err(|e| AppError::BadRequest(format!("category '{}': {e}", c.name)))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let ignore_rules = body
        .ignore_rules
        .iter()
        .map(|r| {
            let request = IgnoreRuleRequest {
                label_pattern: r.label_pattern.clone(),
                amount: r.amount,
            };
            IgnoreRuleFields::try_from(request)
                .map(|fields| (r.id, fields))
                .map_err(|e| AppError::BadRequest(format!("ignore rule {}: {e}", r.id)))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let transfer_rules = body
        .transfer_rules
        .iter()
        .map(|r| {
            let trimmed = |pattern: &LabelPattern| {
                super::trimmed_label_pattern(pattern.clone(), MAX_VALUE_LEN)
                    .map_err(|e| AppError::BadRequest(format!("transfer rule {}: {e}", r.id)))
            };
            Ok((
                r.id,
                TransferRuleFields {
                    account_id: r.account_id,
                    counterpart_account_id: r.counterpart_account_id,
                    label_pattern: trimmed(&r.label_pattern)?,
                    counterpart_label_pattern: r
                        .counterpart_label_pattern
                        .as_ref()
                        .map(trimmed)
                        .transpose()?,
                },
            ))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let user_id = auth_user.id;

    let targets: Vec<Option<Uuid>> = body
        .operations
        .iter()
        .map(|op| op.account_id)
        .chain(profiles.iter().map(|(account_id, _)| *account_id))
        .collect();
    let legacy_balance = body.balance.map(Into::into);
    let account_plan = check_accounts(
        &state.account_repo,
        user_id,
        &accounts,
        &targets,
        legacy_balance,
        state.config.max_accounts_per_user,
    )
    .await?;

    check_transfer_rules(
        &state.account_repo,
        user_id,
        &transfer_rules,
        &accounts,
        &account_plan,
        state.config.max_transfer_rules_per_user,
    )
    .await?;

    let (ignore_rule_id_map, imported_ignore_rules) = import_ignore_rules(
        &state.ignore_rule_repo,
        user_id,
        &ignore_rules,
        state.config.max_ignore_rules_per_user,
    )
    .await?;

    let (category_id_map, imported_categories) = import_categories(
        &state.category_repo,
        user_id,
        &categories,
        state.config.max_categories_per_user,
    )
    .await?;
    let remap_category = |id: Option<Uuid>| id.and_then(|id| category_id_map.get(&id).copied());
    let imported = import_accounts(
        &state.account_repo,
        user_id,
        &accounts,
        account_plan,
        legacy_balance,
    )
    .await?;
    let (transfer_rule_id_map, imported_transfer_rules) =
        import_transfer_rules(&state.account_repo, user_id, &transfer_rules, &imported.ids).await?;

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
            account_id: imported
                .savings_account_for(b.account_id)
                .filter(|_| b.budget_type == BudgetType::Savings),
        };
        let created = state.budget_repo.create(user_id, &fields).await?;
        budget_id_map.insert(b.id, created.id);
        imported_budgets += 1;
    }

    // Merge operations by account, date, amount and label: skip if a matching row already
    // exists.
    let mut imported_operations = 0usize;
    let mut skipped_operations = 0usize;
    let mut transfers: HashMap<Uuid, RestoredTransfer> = HashMap::new();
    for op in &body.operations {
        let account_id = imported.account_for(op.account_id)?;
        let exists = state
            .operation_repo
            .exists_by_fields(user_id, account_id, op.amount, op.date, &op.label)
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
                &NewOperation {
                    account_id,
                    amount: op.amount,
                    date: op.date,
                    effective_date: op.effective_date,
                    label: op.label.clone(),
                },
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
            match op
                .ignore_rule_id
                .and_then(|id| ignore_rule_id_map.get(&id).copied())
            {
                Some(rule_id) => state.operation_repo.ignore_by_rule(new_id, rule_id).await?,
                None => {
                    state
                        .operation_repo
                        .set_ignored(new_id, user_id, true)
                        .await?;
                }
            }
        }

        let transfer_account_id = op
            .transfer_account_id
            .and_then(|id| imported.ids.get(&id).copied())
            .filter(|id| *id != account_id);
        if let Some(other_account_id) = transfer_account_id
            && op.splits.is_empty()
        {
            let rule_id = op
                .transfer_rule_id
                .and_then(|id| transfer_rule_id_map.get(&id).copied());
            let found = state
                .operation_repo
                .set_transfer(new_id, user_id, other_account_id, rule_id)
                .await?;
            if found {
                transfers.insert(
                    op.id,
                    RestoredTransfer {
                        new_id,
                        account_id,
                        other_account_id,
                        partner: op.transfer_operation_id,
                    },
                );
            }
        }

        imported_operations += 1;
    }
    pair_restored_transfers(&state.operation_repo, user_id, &transfers).await?;

    let profiles = profiles
        .into_iter()
        .map(|(account_id, fields)| {
            Ok(ImportProfileFields {
                account_id: imported.account_for(account_id)?,
                ..fields
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let (imported_import_profiles, skipped_import_profiles) =
        import_profiles(&state.import_profile_repo, user_id, &profiles).await?;

    Ok((
        StatusCode::OK,
        Json(ImportDataResponse {
            imported_categories,
            skipped_categories: categories.len() - imported_categories,
            imported_budgets,
            skipped_budgets,
            imported_ignore_rules,
            skipped_ignore_rules: ignore_rules.len() - imported_ignore_rules,
            imported_transfer_rules,
            skipped_transfer_rules: transfer_rules.len() - imported_transfer_rules,
            imported_operations,
            skipped_operations,
            imported_import_profiles,
            skipped_import_profiles,
            imported_accounts: imported.created,
            skipped_accounts: imported.skipped,
            imported_balances: imported.balances,
        }),
    ))
}

/// Name of the account created to hold what an older export, made before accounts existed,
/// carries, the same the accounts migration gives the account it creates.
const DEFAULT_ACCOUNT_NAME: &str = "Default";

/// The payload's accounts once imported.
struct ImportedAccounts {
    /// The user's account each payload account maps to.
    ids: HashMap<Uuid, Uuid>,
    /// Account taking what names no payload account; `None` when nothing does.
    default: Option<Uuid>,
    /// The user's savings accounts among those `ids` maps to.
    savings: HashSet<Uuid>,
    /// Accounts created, the default one included.
    created: usize,
    /// Payload accounts mapped to an account the user already had.
    skipped: usize,
    balances: usize,
}

impl ImportedAccounts {
    /// The user's account an operation or profile naming the payload account `id` goes to.
    fn account_for(&self, id: Option<Uuid>) -> AppResult<Uuid> {
        id.and_then(|id| self.ids.get(&id).copied())
            .or(self.default)
            .ok_or_else(|| AppError::Internal("no account resolved for an import".to_string()))
    }

    /// The user's account a budget naming the payload account `id` sends its money to: none
    /// when it maps to an account that is not a savings one, the user's by that name deciding.
    fn savings_account_for(&self, id: Option<Uuid>) -> Option<Uuid> {
        id.and_then(|id| self.ids.get(&id).copied())
            .filter(|id| self.savings.contains(id))
    }
}

/// What importing the payload's accounts takes, checked before anything is written.
struct AccountPlan {
    /// The user's accounts before the import.
    existing: Vec<Account>,
    /// Whether a target names no payload account, or an older export's balance is given.
    needs_default: bool,
}

/// Check, writing nothing, that every payload account a target names receives operations, the
/// user's account by that name deciding when there is one (`BadRequest`), and that the
/// accounts to create fit within `max` (`Conflict`).
async fn check_accounts(
    repo: &impl AccountRepository,
    user_id: Uuid,
    incoming: &[(Uuid, AccountFields, Vec<AccountBalance>)],
    targets: &[Option<Uuid>],
    legacy_balance: Option<AccountBalance>,
    max: u32,
) -> AppResult<AccountPlan> {
    let existing = repo.list(user_id).await?;
    let existing_named = |name: &str| existing.iter().find(|a| a.fields.name == name);

    let mut needs_default = legacy_balance.is_some();
    for target in targets {
        let named = target.and_then(|id| incoming.iter().find(|(i, _, _)| *i == id));
        match named {
            None => needs_default = true,
            Some((_, fields, _)) => {
                let receives = existing_named(&fields.name).map_or_else(
                    || fields.receives_operations(),
                    |a| a.fields.receives_operations(),
                );
                if !receives {
                    return Err(AppError::BadRequest(format!(
                        "account '{}' does not receive operations",
                        fields.name
                    )));
                }
            }
        }
    }
    let default_existing = existing.iter().find(|a| a.fields.receives_operations());

    let mut new_names: Vec<&str> = incoming
        .iter()
        .map(|(_, fields, _)| fields.name.as_str())
        .filter(|name| existing_named(name).is_none())
        .collect();
    if needs_default && default_existing.is_none() {
        new_names.push(DEFAULT_ACCOUNT_NAME);
    }
    new_names.sort_unstable();
    new_names.dedup();
    if existing.len() + new_names.len() > max as usize {
        return Err(AppError::Conflict(format!(
            "importing {} new accounts would exceed the account limit ({max})",
            new_names.len()
        )));
    }
    Ok(AccountPlan {
        existing,
        needs_default,
    })
}

/// Map each payload account to the user's account by that name, creating the missing ones with
/// their balances. When the plan needs it, also resolve the default account: the user's first
/// account receiving operations, else a new imported checking account, which gets
/// `legacy_balance` when it has no balance.
async fn import_accounts(
    repo: &impl AccountRepository,
    user_id: Uuid,
    incoming: &[(Uuid, AccountFields, Vec<AccountBalance>)],
    plan: AccountPlan,
    legacy_balance: Option<AccountBalance>,
) -> AppResult<ImportedAccounts> {
    let AccountPlan {
        existing,
        needs_default,
    } = plan;
    let default_existing = existing.iter().find(|a| a.fields.receives_operations());
    let mut by_name: HashMap<String, Uuid> = existing
        .iter()
        .map(|a| (a.fields.name.clone(), a.id))
        .collect();
    let mut imported = ImportedAccounts {
        ids: HashMap::new(),
        default: None,
        savings: existing
            .iter()
            .filter(|a| a.fields.kind == AccountKind::Savings)
            .map(|a| a.id)
            .collect(),
        created: 0,
        skipped: 0,
        balances: 0,
    };
    for (incoming_id, fields, balances) in incoming {
        let id = match by_name.get(&fields.name) {
            Some(id) => {
                imported.skipped += 1;
                *id
            }
            None => {
                let created = repo.create(user_id, fields).await?;
                for balance in balances {
                    repo.add_balance(created.id, user_id, *balance).await?;
                    imported.balances += 1;
                }
                if created.fields.kind == AccountKind::Savings {
                    imported.savings.insert(created.id);
                }
                by_name.insert(created.fields.name, created.id);
                imported.created += 1;
                created.id
            }
        };
        imported.ids.insert(*incoming_id, id);
    }

    if needs_default {
        let (id, has_balance) = match default_existing {
            Some(account) => (account.id, account.balance.is_some()),
            None => {
                let fields = AccountFields {
                    name: DEFAULT_ACCOUNT_NAME.to_string(),
                    kind: AccountKind::Checking,
                    imported: true,
                };
                imported.created += 1;
                (repo.create(user_id, &fields).await?.id, false)
            }
        };
        if let Some(balance) = legacy_balance
            && !has_balance
        {
            repo.add_balance(id, user_id, balance).await?;
            imported.balances += 1;
        }
        imported.default = Some(id);
    }
    Ok(imported)
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

/// Create the payload's ignore rules the account has no rule with the same fields for, and map
/// each payload id to the account's rule with those fields; returns the map and how many were
/// created. Fails with `Conflict`, creating none, when they would exceed `max` rules.
async fn import_ignore_rules(
    repo: &impl IgnoreRuleRepository,
    user_id: Uuid,
    incoming: &[(Uuid, IgnoreRuleFields)],
    max: u32,
) -> AppResult<(HashMap<Uuid, Uuid>, usize)> {
    let mut id_map = HashMap::new();
    if incoming.is_empty() {
        return Ok((id_map, 0));
    }
    let mut existing: Vec<(IgnoreRuleFields, Uuid)> = repo
        .list(user_id)
        .await?
        .into_iter()
        .map(|r| (r.fields, r.id))
        .collect();
    let mut new_fields: Vec<&IgnoreRuleFields> = Vec::new();
    for (_, fields) in incoming {
        if !existing.iter().any(|(f, _)| f == fields) && !new_fields.contains(&fields) {
            new_fields.push(fields);
        }
    }
    if existing.len() + new_fields.len() > max as usize {
        return Err(AppError::Conflict(format!(
            "importing {} new ignore rules would exceed the ignore rule limit ({max})",
            new_fields.len()
        )));
    }

    let mut imported = 0usize;
    for (incoming_id, fields) in incoming {
        let id = match existing.iter().find(|(f, _)| f == fields) {
            Some((_, id)) => *id,
            None => {
                let created = repo.create(user_id, fields).await?;
                existing.push((created.fields, created.id));
                imported += 1;
                created.id
            }
        };
        id_map.insert(*incoming_id, id);
    }
    Ok((id_map, imported))
}

/// The rules with their accounts replaced by the ones `ids` maps them to; a rule naming an
/// account `ids` does not map, or the same account twice, is dropped.
fn map_transfer_rules(
    incoming: &[(Uuid, TransferRuleFields)],
    ids: &HashMap<Uuid, Uuid>,
) -> Vec<(Uuid, TransferRuleFields)> {
    incoming
        .iter()
        .filter_map(|(id, fields)| {
            let account_id = *ids.get(&fields.account_id)?;
            let counterpart_account_id = *ids.get(&fields.counterpart_account_id)?;
            (account_id != counterpart_account_id).then(|| {
                (
                    *id,
                    TransferRuleFields {
                        account_id,
                        counterpart_account_id,
                        label_pattern: fields.label_pattern.clone(),
                        counterpart_label_pattern: fields.counterpart_label_pattern.clone(),
                    },
                )
            })
        })
        .collect()
}

/// The distinct fields of `mapped` that none of `existing` has.
fn new_transfer_rule_fields<'a>(
    existing: &[TransferRule],
    mapped: &'a [(Uuid, TransferRuleFields)],
) -> Vec<&'a TransferRuleFields> {
    let mut new_fields: Vec<&TransferRuleFields> = Vec::new();
    for (_, fields) in mapped {
        if !existing.iter().any(|r| r.fields == *fields) && !new_fields.contains(&fields) {
            new_fields.push(fields);
        }
    }
    new_fields
}

/// Check, writing nothing, that the payload's transfer rules apply to accounts receiving
/// operations (`BadRequest`) and that the ones to create fit within `max` (`Conflict`). The
/// accounts the import creates are stood in for by fresh ids: no rule exists on them yet.
async fn check_transfer_rules(
    repo: &impl AccountRepository,
    user_id: Uuid,
    incoming: &[(Uuid, TransferRuleFields)],
    accounts: &[(Uuid, AccountFields, Vec<AccountBalance>)],
    plan: &AccountPlan,
    max: u32,
) -> AppResult<()> {
    if incoming.is_empty() {
        return Ok(());
    }
    let mut ids = HashMap::new();
    let mut receiving = HashSet::new();
    for (incoming_id, fields, _) in accounts {
        let (id, receives) = match plan.existing.iter().find(|a| a.fields.name == fields.name) {
            Some(a) => (a.id, a.fields.receives_operations()),
            None => (Uuid::new_v4(), fields.receives_operations()),
        };
        ids.insert(*incoming_id, id);
        if receives {
            receiving.insert(id);
        }
    }
    let mapped = map_transfer_rules(incoming, &ids);
    if let Some((id, _)) = mapped
        .iter()
        .find(|(_, fields)| !receiving.contains(&fields.account_id))
    {
        return Err(AppError::BadRequest(format!(
            "transfer rule {id}: its account does not receive operations"
        )));
    }

    let existing = repo.list_transfer_rules(user_id).await?;
    let new_fields = new_transfer_rule_fields(&existing, &mapped);
    if existing.len() + new_fields.len() > max as usize {
        return Err(AppError::Conflict(format!(
            "importing {} new transfer rules would exceed the transfer rule limit ({max})",
            new_fields.len()
        )));
    }
    Ok(())
}

/// Create the payload's transfer rules the user has no rule with the same fields for, and map
/// each payload id to the user's rule with those fields; returns the map and how many were
/// created. `account_ids` maps the payload's accounts to the user's.
async fn import_transfer_rules(
    repo: &impl AccountRepository,
    user_id: Uuid,
    incoming: &[(Uuid, TransferRuleFields)],
    account_ids: &HashMap<Uuid, Uuid>,
) -> AppResult<(HashMap<Uuid, Uuid>, usize)> {
    let mut id_map = HashMap::new();
    let mapped = map_transfer_rules(incoming, account_ids);
    if mapped.is_empty() {
        return Ok((id_map, 0));
    }
    let mut existing: Vec<(TransferRuleFields, Uuid)> = repo
        .list_transfer_rules(user_id)
        .await?
        .into_iter()
        .map(|r| (r.fields, r.id))
        .collect();

    let mut imported = 0usize;
    for (incoming_id, fields) in &mapped {
        let id = match existing.iter().find(|(f, _)| f == fields) {
            Some((_, id)) => *id,
            None => {
                let created = repo.create_transfer_rule(user_id, fields).await?;
                existing.push((created.fields, created.id));
                imported += 1;
                created.id
            }
        };
        id_map.insert(*incoming_id, id);
    }
    Ok((id_map, imported))
}

/// An imported operation made a transfer again.
struct RestoredTransfer {
    new_id: Uuid,
    account_id: Uuid,
    other_account_id: Uuid,
    /// Payload operation on the other side.
    partner: Option<Uuid>,
}

/// Pair each restored transfer with its other side, once per pair, where both name each other
/// and each other's account; anything else is left unpaired.
async fn pair_restored_transfers(
    repo: &impl OperationRepository,
    user_id: Uuid,
    transfers: &HashMap<Uuid, RestoredTransfer>,
) -> AppResult<()> {
    let mut paired: HashSet<Uuid> = HashSet::new();
    for (payload_id, transfer) in transfers {
        let Some(partner_id) = transfer.partner else {
            continue;
        };
        let Some(partner) = transfers.get(&partner_id) else {
            continue;
        };
        let consistent = partner.partner == Some(*payload_id)
            && partner.account_id == transfer.other_account_id
            && partner.other_account_id == transfer.account_id;
        if !consistent || paired.contains(&transfer.new_id) {
            continue;
        }
        repo.pair_transfer(transfer.new_id, user_id, Some(partner.new_id))
            .await?;
        paired.insert(transfer.new_id);
        paired.insert(partner.new_id);
    }
    Ok(())
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
            account::{Account, BalanceEntry},
            budget::{Budget, BudgetKind, BudgetType, CurrentPeriod, Recurrence, YearMonth},
            transfer::Transfer,
            user::UserRole,
        },
        repositories::{
            MockAccountRepository, MockBudgetRepository, MockCategoryRepository,
            MockIgnoreRuleRepository, MockImportProfileRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, main_account, make_test_state,
            make_test_state_with_all, make_test_state_with_categories,
            make_test_state_with_ignore_rules, make_test_state_with_profiles, no_categories,
            no_ignore_rules, no_import_profiles, response_json,
        },
    };
    use axum::Router;
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
            account_id: None,
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
            account_id: None,
            created_at: Utc::now(),
        }
    }

    fn make_operation(user_id: Uuid, label: &str, budget_link: BudgetLink) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id,
            account_id: Uuid::nil(),
            amount: Decimal::new(-1234, 2),
            date: NaiveDate::from_ymd_opt(2024, 3, 15).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link,
            ignored: false,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            transfer: None,
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
            MockUserRepository::new(),
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
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));

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
        assert_eq!(json.imported_balances, 0);
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
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
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
            .returning(move |_, _, _, _, _| {
                call += 1;
                let dup = call == 1;
                Box::pin(async move { Ok(dup) })
            });
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
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

    fn contains_rule(user_id: Uuid, value: &str) -> IgnoreRule {
        IgnoreRule {
            id: Uuid::new_v4(),
            user_id,
            fields: IgnoreRuleFields {
                label_pattern: LabelPattern::Contains(value.to_string()),
                amount: None,
            },
            created_at: Utc::now(),
        }
    }

    fn rules_app(op_repo: MockOperationRepository, rule_repo: MockIgnoreRuleRepository) -> Router {
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        build_test_router(make_test_state_with_ignore_rules(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            rule_repo,
        ))
    }

    #[tokio::test]
    async fn export_includes_ignore_rules_and_the_rule_of_each_operation() {
        let user_id = Uuid::new_v4();
        let rule = contains_rule(user_id, "VIR INTERNE");
        let rule_id = rule.id;
        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo.expect_list().returning(move |_| {
            let rule = rule.clone();
            Box::pin(async move { Ok(vec![rule]) })
        });
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_list_all_for_user().returning(move |_| {
            let op = Operation {
                ignored: true,
                ignore_rule_id: Some(rule_id),
                ..make_operation(user_id, "VIR INTERNE", BudgetLink::Unlinked)
            };
            Box::pin(async move { Ok(vec![op]) })
        });

        let auth = auth_header(user_id, UserRole::User);
        let resp = rules_app(op_repo, rule_repo)
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["ignoreRules"][0]["id"], rule_id.to_string());
        assert_eq!(
            json["ignoreRules"][0]["labelPattern"]["value"],
            "VIR INTERNE"
        );
        assert_eq!(json["operations"][0]["ignoreRuleId"], rule_id.to_string());
    }

    #[tokio::test]
    async fn import_reuses_identical_rules_creates_others_and_remaps_operations() {
        let user_id = Uuid::new_v4();
        let existing = contains_rule(user_id, "VIR INTERNE");
        let existing_id = existing.id;
        let created_id = Uuid::new_v4();
        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo.expect_list().returning(move |_| {
            let existing = existing.clone();
            Box::pin(async move { Ok(vec![existing]) })
        });
        rule_repo
            .expect_create()
            .withf(|_, fields| fields.label_pattern == LabelPattern::EndsWith("LIVRET".to_string()))
            .once()
            .returning(move |user_id, fields| {
                let created = IgnoreRule {
                    id: created_id,
                    user_id,
                    fields: fields.clone(),
                    created_at: Utc::now(),
                };
                Box::pin(async move { Ok(created) })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_exists_by_fields()
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_ignore_by_rule()
            .withf(move |_, rule_id| *rule_id == existing_id || *rule_id == created_id)
            .times(2)
            .returning(|_, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_set_ignored()
            .withf(|_, _, ignored| *ignored)
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let op = |id: &str, label: &str, rule: &str| {
            format!(
                r#"{{"id":"{id}","amount":"-5","date":"2024-01-01","effectiveDate":null,
                "label":"{label}","budgetLink":{{"type":"unlinked"}},"ignored":true,
                "ignoreRuleId":{rule}}}"#
            )
        };
        let body = format!(
            r#"{{"version":1,
            "ignoreRules":[
                {{"id":"aaaaaaaa-0000-0000-0000-000000000001","labelPattern":{{"type":"contains","value":"VIR INTERNE"}}}},
                {{"id":"aaaaaaaa-0000-0000-0000-000000000002","labelPattern":{{"type":"endsWith","value":"LIVRET"}},"amount":null}}
            ],
            "operations":[{},{},{}]}}"#,
            op(
                "11111111-1111-1111-1111-111111111111",
                "VIR INTERNE",
                r#""aaaaaaaa-0000-0000-0000-000000000001""#
            ),
            op(
                "22222222-2222-2222-2222-222222222222",
                "VERS LIVRET",
                r#""aaaaaaaa-0000-0000-0000-000000000002""#
            ),
            op("33333333-3333-3333-3333-333333333333", "CB", "null"),
        );

        let auth = auth_header(user_id, UserRole::User);
        let resp = rules_app(op_repo, rule_repo)
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
        assert_eq!(json.imported_ignore_rules, 1);
        assert_eq!(json.skipped_ignore_rules, 1);
        assert_eq!(json.imported_operations, 3);
    }

    #[tokio::test]
    async fn import_beyond_the_ignore_rule_limit_is_a_conflict() {
        let user_id = Uuid::new_v4();
        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo.expect_list().returning(move |_| {
            let full: Vec<_> = (0..100)
                .map(|i| contains_rule(user_id, &format!("RULE {i}")))
                .collect();
            Box::pin(async move { Ok(full) })
        });
        rule_repo.expect_create().never();
        let body = r#"{"version":1,"ignoreRules":[{"id":"aaaaaaaa-0000-0000-0000-000000000001","labelPattern":{"type":"contains","value":"NEW"}}]}"#;

        let auth = auth_header(user_id, UserRole::User);
        let resp = rules_app(MockOperationRepository::new(), rule_repo)
            .oneshot(json_request(
                "POST",
                "/data/import",
                Some(body),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
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
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
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
                    effective_date: None,
                    budget_id: Some(budget_id),
                    category_id: None,
                    budget_category_id: None,
                },
                OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-1000, 2),
                    effective_date: NaiveDate::from_ymd_opt(2024, 4, 1),
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
            MockUserRepository::new(),
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
        assert!(splits[0]["effectiveDate"].is_null());
        assert!(splits[1]["budgetId"].is_null());
        assert_eq!(splits[1]["effectiveDate"], "2024-04-01");
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
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_replace_splits()
            .withf(move |_, uid, splits| {
                *uid == user_id
                    && splits
                        == [
                            NewOperationSplit {
                                amount: Decimal::new(-30, 0),
                                effective_date: None,
                                budget_id: Some(existing_id),
                                category_id: None,
                            },
                            NewOperationSplit {
                                amount: Decimal::new(-70, 0),
                                effective_date: NaiveDate::from_ymd_opt(2024, 4, 1),
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
                        {"amount": "-70", "budgetId": "ffffffff-ffff-ffff-ffff-ffffffffffff", "effectiveDate": "2024-04-01"}
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
            account_id: None,
            created_at: Utc::now(),
        };
        // Round-trip: serialize the export payload and feed it back as input.
        let export = ExportResponse {
            version: EXPORT_VERSION,
            exported_at: Utc::now(),
            accounts: vec![],
            categories: vec![],
            budgets: vec![ExportBudget::from(budget)],
            ignore_rules: vec![],
            transfer_rules: vec![],
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

    fn data_app(op_repo: MockOperationRepository, account_repo: MockAccountRepository) -> Router {
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        ))
    }

    async fn import_payload(app: Router, body: &str) -> axum::response::Response {
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        app.oneshot(json_request(
            "POST",
            "/data/import",
            Some(body),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    /// An account repository listing `accounts`.
    fn accounts_listing(accounts: Vec<Account>) -> MockAccountRepository {
        let mut repo = MockAccountRepository::new();
        repo.expect_list().returning(move |_| {
            let accounts = accounts.clone();
            Box::pin(async move { Ok(accounts) })
        });
        repo
    }

    /// The account a mocked `create` returns for `fields`.
    fn created_account(user_id: Uuid, fields: &AccountFields) -> Account {
        Account {
            fields: fields.clone(),
            ..main_account(Uuid::new_v4(), user_id)
        }
    }

    #[tokio::test]
    async fn export_includes_every_account_with_its_balances() {
        let user_id = Uuid::new_v4();
        let account = main_account(Uuid::new_v4(), user_id);
        let account_id = account.id;
        let mut account_repo = accounts_listing(vec![account]);
        account_repo
            .expect_list_transfer_rules()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        account_repo
            .expect_list_balances()
            .withf(move |id, uid| *id == account_id && *uid == user_id)
            .returning(|_, _| {
                Box::pin(async {
                    Ok(vec![BalanceEntry {
                        id: Uuid::new_v4(),
                        balance: sample_balance(),
                    }])
                })
            });
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        ));
        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json["accounts"],
            serde_json::json!([{
                "id": account_id,
                "name": "Main",
                "kind": "checking",
                "imported": true,
                "balances": [{"amount": "1523.40", "date": "2026-03-31"}]
            }])
        );
        assert!(json.get("balance").is_none());
    }

    fn named_account(user_id: Uuid, name: &str) -> Account {
        let account = main_account(Uuid::new_v4(), user_id);
        Account {
            fields: AccountFields {
                name: name.to_string(),
                ..account.fields.clone()
            },
            ..account
        }
    }

    fn transfer_rule(
        user_id: Uuid,
        account_id: Uuid,
        counterpart: Uuid,
        value: &str,
    ) -> TransferRule {
        TransferRule {
            id: Uuid::new_v4(),
            user_id,
            fields: TransferRuleFields {
                account_id,
                counterpart_account_id: counterpart,
                label_pattern: LabelPattern::Contains(value.to_string()),
                counterpart_label_pattern: None,
            },
            created_at: Utc::now(),
        }
    }

    /// An account repository listing `accounts` and `rules`, with no balance.
    fn accounts_with_rules(
        accounts: Vec<Account>,
        rules: Vec<TransferRule>,
    ) -> MockAccountRepository {
        let mut repo = accounts_listing(accounts);
        repo.expect_list_balances()
            .returning(|_, _| Box::pin(async { Ok(vec![]) }));
        repo.expect_list_transfer_rules().returning(move |_| {
            let rules = rules.clone();
            Box::pin(async move { Ok(rules) })
        });
        repo
    }

    #[tokio::test]
    async fn export_includes_transfer_rules_and_the_transfer_of_each_operation() {
        let user_id = Uuid::new_v4();
        let main = named_account(user_id, "Main");
        let joint = named_account(user_id, "Joint");
        let rule = transfer_rule(user_id, main.id, joint.id, "VIR JOINT");
        let (main_id, joint_id, rule_id) = (main.id, joint.id, rule.id);
        let partner_id = Uuid::new_v4();
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_list_all_for_user().returning(move |_| {
            let op = Operation {
                account_id: main_id,
                transfer: Some(Transfer {
                    account_id: joint_id,
                    account_kind: AccountKind::Checking,
                    rule_id: Some(rule_id),
                    operation_id: Some(partner_id),
                }),
                ..make_operation(user_id, "VIR JOINT", BudgetLink::Unlinked)
            };
            Box::pin(async move { Ok(vec![op]) })
        });
        let app = data_app(op_repo, accounts_with_rules(vec![main, joint], vec![rule]));

        let auth = auth_header(user_id, UserRole::User);
        let resp = app
            .oneshot(json_request("GET", "/data/export", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        let exported = &json["transferRules"][0];
        assert_eq!(exported["id"], rule_id.to_string());
        assert_eq!(exported["accountId"], main_id.to_string());
        assert_eq!(exported["counterpartAccountId"], joint_id.to_string());
        assert_eq!(exported["labelPattern"]["value"], "VIR JOINT");
        assert!(exported["createdAt"].is_string());
        let op = &json["operations"][0];
        assert_eq!(op["transferAccountId"], joint_id.to_string());
        assert_eq!(op["transferRuleId"], rule_id.to_string());
        assert_eq!(op["transferOperationId"], partner_id.to_string());
    }

    const MAIN_ID: &str = "aaaaaaaa-0000-0000-0000-00000000000a";
    const JOINT_ID: &str = "aaaaaaaa-0000-0000-0000-00000000000b";

    fn transfer_payload(rules: &str, operations: &str) -> String {
        format!(
            r#"{{"version":1,
            "accounts":[
                {{"id":"{MAIN_ID}","name":"Main","kind":"checking","imported":true,"balances":[]}},
                {{"id":"{JOINT_ID}","name":"Joint","kind":"checking","imported":true,"balances":[]}}
            ],
            "transferRules":[{rules}],
            "operations":[{operations}]}}"#
        )
    }

    fn payload_rule(id: &str, account: &str, counterpart: &str, value: &str) -> String {
        format!(
            r#"{{"id":"{id}","accountId":"{account}","counterpartAccountId":"{counterpart}",
            "labelPattern":{{"type":"contains","value":"{value}"}},
            "createdAt":"2026-01-01T00:00:00Z"}}"#
        )
    }

    fn payload_transfer_op(id: &str, account: &str, amount: &str, transfer: &str) -> String {
        format!(
            r#"{{"id":"{id}","amount":"{amount}","date":"2024-01-01","effectiveDate":null,
            "label":"VIR","budgetLink":{{"type":"unlinked"}},"ignored":false,
            "accountId":"{account}",{transfer}}}"#
        )
    }

    fn inserting_operations() -> MockOperationRepository {
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_exists_by_fields()
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        op_repo
    }

    #[tokio::test]
    async fn import_reuses_identical_transfer_rules_creates_others_and_restores_the_pair() {
        let user_id = Uuid::new_v4();
        let main = named_account(user_id, "Main");
        let joint = named_account(user_id, "Joint");
        let (main_id, joint_id) = (main.id, joint.id);
        let existing = transfer_rule(user_id, main_id, joint_id, "VIR JOINT");
        let existing_id = existing.id;
        let created_id = Uuid::new_v4();
        let mut account_repo = accounts_with_rules(vec![main, joint], vec![existing]);
        account_repo
            .expect_create_transfer_rule()
            .withf(move |_, fields| {
                fields.account_id == joint_id
                    && fields.counterpart_account_id == main_id
                    && fields.label_pattern == LabelPattern::Contains("VIR MAIN".to_string())
            })
            .once()
            .returning(move |user_id, fields| {
                let created = TransferRule {
                    id: created_id,
                    user_id,
                    fields: fields.clone(),
                    created_at: Utc::now(),
                };
                Box::pin(async move { Ok(created) })
            });
        let mut op_repo = inserting_operations();
        op_repo
            .expect_set_transfer()
            .withf(move |_, _, account_id, rule_id| {
                *account_id == joint_id && *rule_id == Some(existing_id)
            })
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_set_transfer()
            .withf(move |_, _, account_id, rule_id| {
                *account_id == main_id && *rule_id == Some(created_id)
            })
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_pair_transfer()
            .withf(|id, _, counterpart| counterpart.is_some_and(|c| c != *id))
            .once()
            .returning(|_, _, counterpart| Box::pin(async move { Ok(counterpart) }));

        let (rule_a, rule_b) = (
            "bbbbbbbb-0000-0000-0000-000000000001",
            "bbbbbbbb-0000-0000-0000-000000000002",
        );
        let (op_a, op_b) = (
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        );
        let body = transfer_payload(
            &format!(
                "{},{}",
                payload_rule(rule_a, MAIN_ID, JOINT_ID, "VIR JOINT"),
                payload_rule(rule_b, JOINT_ID, MAIN_ID, "VIR MAIN"),
            ),
            &format!(
                "{},{}",
                payload_transfer_op(
                    op_a,
                    MAIN_ID,
                    "-100",
                    &format!(
                        r#""transferAccountId":"{JOINT_ID}","transferRuleId":"{rule_a}","transferOperationId":"{op_b}""#
                    )
                ),
                payload_transfer_op(
                    op_b,
                    JOINT_ID,
                    "100",
                    &format!(
                        r#""transferAccountId":"{MAIN_ID}","transferRuleId":"{rule_b}","transferOperationId":"{op_a}""#
                    )
                ),
            ),
        );

        let resp = import_payload(data_app(op_repo, account_repo), &body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_transfer_rules, 1);
        assert_eq!(json.skipped_transfer_rules, 1);
        assert_eq!(json.imported_operations, 2);
    }

    #[tokio::test]
    async fn import_leaves_a_transfer_with_an_unknown_account_an_ordinary_operation() {
        let user_id = Uuid::new_v4();
        let account_repo = accounts_with_rules(
            vec![
                named_account(user_id, "Main"),
                named_account(user_id, "Joint"),
            ],
            vec![],
        );
        let mut op_repo = inserting_operations();
        op_repo.expect_set_transfer().never();
        op_repo.expect_pair_transfer().never();
        let body = transfer_payload(
            "",
            &payload_transfer_op(
                "11111111-1111-1111-1111-111111111111",
                MAIN_ID,
                "-100",
                r#""transferAccountId":"cccccccc-0000-0000-0000-000000000001","transferOperationId":"22222222-2222-2222-2222-222222222222""#,
            ),
        );

        let resp = import_payload(data_app(op_repo, account_repo), &body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_operations, 1);
    }

    #[tokio::test]
    async fn import_beyond_the_transfer_rule_limit_is_a_conflict() {
        let user_id = Uuid::new_v4();
        let main = named_account(user_id, "Main");
        let joint = named_account(user_id, "Joint");
        let full: Vec<_> = (0..100)
            .map(|i| transfer_rule(user_id, main.id, joint.id, &format!("RULE {i}")))
            .collect();
        let mut account_repo = accounts_with_rules(vec![main, joint], full);
        account_repo.expect_create_transfer_rule().never();
        account_repo.expect_create().never();
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_insert().never();
        let body = transfer_payload(
            &payload_rule(
                "bbbbbbbb-0000-0000-0000-000000000001",
                MAIN_ID,
                JOINT_ID,
                "NEW",
            ),
            "",
        );

        let resp = import_payload(data_app(op_repo, account_repo), &body).await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn an_older_export_lands_on_a_new_default_account_with_its_balance() {
        let mut account_repo = accounts_listing(vec![]);
        account_repo
            .expect_create()
            .withf(|_, f| f.name == DEFAULT_ACCOUNT_NAME && f.receives_operations())
            .once()
            .returning(|uid, f| {
                let created = created_account(uid, f);
                Box::pin(async move { Ok(created) })
            });
        account_repo
            .expect_add_balance()
            .withf(|_, _, balance| *balance == sample_balance())
            .once()
            .returning(|_, _, balance| {
                Box::pin(async move {
                    Ok(Some(BalanceEntry {
                        id: Uuid::new_v4(),
                        balance,
                    }))
                })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_exists_by_fields()
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        let body = r#"{"version":1,"balance":{"amount":"1523.40","date":"2026-03-31"},
            "operations":[{"id":"33333333-3333-3333-3333-333333333333","amount":"-12",
                           "date":"2026-04-02","effectiveDate":null,"label":"Bakery",
                           "budgetLink":{"type":"unlinked"},"ignored":false}]}"#;

        let resp = import_payload(data_app(op_repo, account_repo), body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_accounts, 1);
        assert_eq!(json.imported_balances, 1);
        assert_eq!(json.imported_operations, 1);
    }

    #[tokio::test]
    async fn an_older_export_keeps_the_balance_of_an_existing_account() {
        let user_id = Uuid::new_v4();
        let existing = Account {
            balance: Some(BalanceEntry {
                id: Uuid::new_v4(),
                balance: sample_balance(),
            }),
            ..main_account(Uuid::new_v4(), user_id)
        };
        let mut account_repo = accounts_listing(vec![existing]);
        account_repo.expect_create().never();
        account_repo.expect_add_balance().never();
        let body = r#"{"version":1,"balance":{"amount":"1","date":"2026-05-01"}}"#;

        let resp =
            import_payload(data_app(MockOperationRepository::new(), account_repo), body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_accounts, 0);
        assert_eq!(json.imported_balances, 0);
    }

    #[tokio::test]
    async fn import_creates_the_missing_accounts_and_puts_operations_on_them() {
        let user_id = Uuid::new_v4();
        let existing = Account {
            fields: AccountFields {
                name: "Joint".to_string(),
                ..main_account(Uuid::nil(), user_id).fields
            },
            ..main_account(Uuid::new_v4(), user_id)
        };
        let existing_id = existing.id;
        let created_id = Uuid::new_v4();
        let mut account_repo = accounts_listing(vec![existing]);
        account_repo
            .expect_create()
            .withf(|_, f| f.name == "Perso")
            .once()
            .returning(move |uid, f| {
                let created = Account {
                    id: created_id,
                    ..created_account(uid, f)
                };
                Box::pin(async move { Ok(created) })
            });
        account_repo
            .expect_add_balance()
            .withf(move |id, _, _| *id == created_id)
            .once()
            .returning(|_, _, balance| {
                Box::pin(async move {
                    Ok(Some(BalanceEntry {
                        id: Uuid::new_v4(),
                        balance,
                    }))
                })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_exists_by_fields()
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .withf(move |_, _, op| {
                (op.label == "On perso" && op.account_id == created_id)
                    || (op.label == "On joint" && op.account_id == existing_id)
            })
            .times(2)
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        let body = r#"{"version":1,
            "accounts":[
                {"id":"11111111-1111-1111-1111-111111111111","name":"Perso","kind":"checking",
                 "imported":true,"balances":[{"amount":"10","date":"2026-01-31"}]},
                {"id":"22222222-2222-2222-2222-222222222222","name":"Joint","kind":"checking",
                 "imported":true,"balances":[{"amount":"99","date":"2026-01-31"}]}],
            "operations":[
                {"id":"33333333-3333-3333-3333-333333333333","amount":"-1","date":"2026-02-01",
                 "effectiveDate":null,"label":"On perso","budgetLink":{"type":"unlinked"},
                 "ignored":false,"accountId":"11111111-1111-1111-1111-111111111111"},
                {"id":"44444444-4444-4444-4444-444444444444","amount":"-2","date":"2026-02-01",
                 "effectiveDate":null,"label":"On joint","budgetLink":{"type":"unlinked"},
                 "ignored":false,"accountId":"22222222-2222-2222-2222-222222222222"}]}"#;

        let resp = import_payload(data_app(op_repo, account_repo), body).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportDataResponse = response_json(resp).await;
        assert_eq!(json.imported_accounts, 1);
        assert_eq!(json.skipped_accounts, 1);
        assert_eq!(json.imported_balances, 1);
        assert_eq!(json.imported_operations, 2);
    }

    #[tokio::test]
    async fn import_sends_savings_budgets_to_the_savings_account_they_map_to() {
        let user_id = Uuid::new_v4();
        let account = |name: &str, kind| Account {
            fields: AccountFields {
                name: name.to_string(),
                kind,
                imported: false,
            },
            ..main_account(Uuid::new_v4(), user_id)
        };
        let livret = account("Livret", AccountKind::Savings);
        let livret_id = livret.id;
        let account_repo = accounts_listing(vec![livret, account("Joint", AccountKind::Checking)]);
        let mut budget_repo = MockBudgetRepository::new();
        budget_repo
            .expect_list_all_for_user()
            .returning(|_| Box::pin(async { Ok(vec![]) }));
        budget_repo
            .expect_create()
            .withf(move |_, f| {
                f.account_id
                    == match f.label.as_str() {
                        "To livret" => Some(livret_id),
                        _ => None,
                    }
            })
            .times(3)
            .returning(|user_id, f| {
                let created = Budget {
                    id: Uuid::new_v4(),
                    user_id,
                    label: f.label.clone(),
                    budget_type: f.budget_type,
                    kind: f.kind.clone(),
                    rules: vec![],
                    category_id: None,
                    account_id: f.account_id,
                    created_at: Utc::now(),
                };
                Box::pin(async move { Ok(created) })
            });
        let app = build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            budget_repo,
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        ));
        let budget = |id: u8, label: &str, budget_type: &str, account: u8| {
            serde_json::json!({
                "id": Uuid::from_u128(id.into()), "label": label, "budgetType": budget_type,
                "kind": {"type": "occasional", "month": 1, "year": 2026, "amount": "-10"},
                "rules": [], "accountId": Uuid::from_u128(account.into()),
                "createdAt": "2026-01-01T00:00:00Z"
            })
        };
        let body = serde_json::json!({"version": 1,
            "accounts": [
                {"id": Uuid::from_u128(1), "name": "Livret", "kind": "savings", "balances": []},
                {"id": Uuid::from_u128(2), "name": "Joint", "kind": "savings", "balances": []}],
            "budgets": [
                budget(11, "To livret", "savings", 1),
                // The user's account by that name is not a savings one.
                budget(12, "To joint", "savings", 2),
                budget(13, "Expense", "expense", 1)],
            "operations": []});

        let resp = post_import(app, user_id, &body.to_string()).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn import_refuses_operations_on_an_account_not_receiving_them() {
        let mut account_repo = accounts_listing(vec![]);
        account_repo.expect_create().never();
        let body = r#"{"version":1,
            "accounts":[{"id":"11111111-1111-1111-1111-111111111111","name":"Livret A",
                         "kind":"savings"}],
            "operations":[
                {"id":"33333333-3333-3333-3333-333333333333","amount":"-1","date":"2026-02-01",
                 "effectiveDate":null,"label":"Op","budgetLink":{"type":"unlinked"},
                 "ignored":false,"accountId":"11111111-1111-1111-1111-111111111111"}]}"#;

        let resp =
            import_payload(data_app(MockOperationRepository::new(), account_repo), body).await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    fn profile_fields(name: &str) -> ImportProfileFields {
        ImportProfileFields {
            name: name.to_string(),
            account_id: Uuid::nil(),
            label_col: 1,
            label_fallback_col: None,
            amount_col: 3,
            date_col: 0,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1,
            csv_delimiter: CsvDelimiter::Comma,
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
            "accountId": Uuid::nil(),
            "labelCol": 1,
            "labelFallbackCol": null,
            "amountCol": 3,
            "dateCol": date_col,
            "dateFormat": "%d/%m/%Y",
            "skipLines": 1,
            "csvDelimiter": "comma"
        })
    }

    #[test]
    fn exported_profile_without_delimiter_reads_as_comma() {
        let mut json = profile_json("Bank", 0);
        json.as_object_mut().unwrap().remove("csvDelimiter");
        let profile: ExportImportProfile = serde_json::from_value(json).unwrap();
        assert_eq!(profile.csv_delimiter, CsvDelimiter::Comma);
    }

    #[test]
    fn exported_profile_without_label_fallback_has_none() {
        let mut json = profile_json("Bank", 0);
        json.as_object_mut().unwrap().remove("labelFallbackCol");
        let profile: ExportImportProfile = serde_json::from_value(json).unwrap();
        assert_eq!(profile.label_fallback_col, None);
    }

    async fn import_profiles_payload(
        profile_repo: MockImportProfileRepository,
        profiles: serde_json::Value,
    ) -> axum::response::Response {
        let (op_repo, budget_repo) = empty_repos();
        let app = build_test_router(make_test_state_with_profiles(
            MockUserRepository::new(),
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
            MockUserRepository::new(),
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
                color: "#12b886".parse::<CategoryColor>().unwrap(),
                icon: None,
                net_totals: false,
                rules: Vec::new(),
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
        let app = build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
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
        assert_eq!(json["categories"][0]["color"], "#12b886");
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
            .withf(|_, fields| fields.name == "Fun" && fields.icon == Some(CategoryIcon::Games))
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
            .returning(|_, _, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
        op_repo
            .expect_set_category()
            .withf(move |_, _, category_id| *category_id == Some(existing_id))
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(true) }));

        let body = r##"{
            "version": 1,
            "categories": [
                {"id": "11111111-1111-1111-1111-111111111111", "name": "Food", "color": "#fd7e14"},
                {"id": "22222222-2222-2222-2222-222222222222", "name": "Fun", "color": "grape", "icon": "games"}
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
        }"##;
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

        let body = r##"{
            "version": 1,
            "categories": [
                {"id": "11111111-1111-1111-1111-111111111111", "name": "New 1", "color": "#fa5252"},
                {"id": "22222222-2222-2222-2222-222222222222", "name": "New 2", "color": "#fa5252"},
                {"id": "33333333-3333-3333-3333-333333333333", "name": "C0", "color": "#fa5252"}
            ]
        }"##;
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
