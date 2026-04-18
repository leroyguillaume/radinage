use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::{Budget, BudgetKind, BudgetType, Rule},
        operation::{BudgetLink, Operation},
    },
    error::AppResult,
    repositories::{BudgetRepository, OperationRepository},
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
            created_at: b.created_at,
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
    pub budgets: Vec<ExportBudget>,
    pub operations: Vec<ExportOperation>,
}

/// Input payload for an import request. Mirrors `ExportResponse` shape.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDataRequest {
    /// Must match the supported export version.
    pub version: u32,
    #[serde(default)]
    pub budgets: Vec<ExportBudget>,
    #[serde(default)]
    pub operations: Vec<ExportOperation>,
}

/// Result of an import: how many items were created or skipped as duplicates.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportDataResponse {
    pub imported_budgets: usize,
    pub skipped_budgets: usize,
    pub imported_operations: usize,
    pub skipped_operations: usize,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn export_data<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
) -> AppResult<Json<ExportResponse>> {
    let user_id = auth_user.id;
    let budgets = state.budget_repo.list_all_for_user(user_id).await?;
    let operations = state.operation_repo.list_all_for_user(user_id).await?;

    Ok(Json(ExportResponse {
        version: EXPORT_VERSION,
        exported_at: Utc::now(),
        budgets: budgets.into_iter().map(ExportBudget::from).collect(),
        operations: operations.into_iter().map(ExportOperation::from).collect(),
    }))
}

pub async fn import_data<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<ImportDataRequest>,
) -> AppResult<(StatusCode, Json<ImportDataResponse>)> {
    if body.version != EXPORT_VERSION {
        return Err(crate::error::AppError::BadRequest(format!(
            "unsupported export version {} (expected {EXPORT_VERSION})",
            body.version
        )));
    }

    let user_id = auth_user.id;

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
        let created = state
            .budget_repo
            .create(user_id, &b.label, b.budget_type, &b.kind, &b.rules)
            .await?;
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
        if !matches!(remapped_link, BudgetLink::Unlinked) {
            state
                .operation_repo
                .set_budget_link(new_id, user_id, &remapped_link)
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

    Ok((
        StatusCode::OK,
        Json(ImportDataResponse {
            imported_budgets,
            skipped_budgets,
            imported_operations,
            skipped_operations,
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType, CurrentPeriod, Recurrence, YearMonth},
            user::UserRole,
        },
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
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
            .returning(move |uid, label, bt, kind, rules| {
                let created = Budget {
                    id: Uuid::new_v4(),
                    user_id: uid,
                    label: label.to_string(),
                    budget_type: bt,
                    kind: kind.clone(),
                    rules: rules.to_vec(),
                    created_at: Utc::now(),
                };
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
            .withf(|_uid, label, _bt, kind, _rules| {
                *label == *"Rent"
                    && matches!(
                        kind,
                        BudgetKind::Recurring {
                            recurrence: Recurrence::Monthly,
                            ..
                        }
                    )
            })
            .times(1)
            .returning(move |uid, label, bt, kind, rules| {
                let created = Budget {
                    id: Uuid::new_v4(),
                    user_id: uid,
                    label: label.to_string(),
                    budget_type: bt,
                    kind: kind.clone(),
                    rules: rules.to_vec(),
                    created_at: Utc::now(),
                };
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
            created_at: Utc::now(),
        };
        // Round-trip: serialize the export payload and feed it back as input.
        let export = ExportResponse {
            version: EXPORT_VERSION,
            exported_at: Utc::now(),
            budgets: vec![ExportBudget::from(budget)],
            operations: vec![],
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
}
