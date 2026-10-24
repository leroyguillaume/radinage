use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::LabelPattern,
        operation::Operation,
        transfer::{self, TransferRule, TransferRuleFields},
    },
    error::{AppError, AppResult},
    handlers::{accounts::account_receiving_operations, ignore_rules::MAX_VALUE_LEN},
    repositories::{AccountRepository, OperationRepository},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body of a create or update: the whole rule, every field replaced on update.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "accountId": "0b6f1f5e-8c1a-4f3e-9d2a-1c7e5b9a4d10",
    "counterpartAccountId": "5d2c8e4a-3b7f-4a1e-8c6d-9f0b2a7e1c35",
    "labelPattern": { "type": "contains", "value": "VIR SEPA VERS BOURSO" },
    "counterpartLabelPattern": { "type": "contains", "value": "VIR SEPA DE M LEROY" }
})))]
pub struct TransferRuleRequest {
    /// Imported checking account whose operations `labelPattern` recognizes.
    pub account_id: Uuid,
    /// Another of the caller's accounts, the other account of the transfers.
    pub counterpart_account_id: Uuid,
    /// Pattern the label of an operation of `accountId` must match; its value is trimmed and
    /// 1 to 200 characters.
    pub label_pattern: LabelPattern,
    /// Pattern the label of the other side must match on `counterpartAccountId`: required when
    /// that account receives operations, absent otherwise. Same constraints.
    #[serde(default)]
    pub counterpart_label_pattern: Option<LabelPattern>,
}

/// A transfer rule (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransferRuleResponse {
    pub id: Uuid,
    pub account_id: Uuid,
    pub counterpart_account_id: Uuid,
    pub label_pattern: LabelPattern,
    /// Null when the other account does not receive operations.
    pub counterpart_label_pattern: Option<LabelPattern>,
    pub created_at: DateTime<Utc>,
}

impl From<TransferRule> for TransferRuleResponse {
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

/// Result of applying a transfer rule to the existing operations.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTransferRuleResponse {
    /// Matching operations the rule made transfers.
    pub transferred: usize,
    /// Matching operations left as they are: already transfers, or split.
    pub skipped: usize,
}

/// The fields of `body`, checked against the user's accounts: the rule applies to an account
/// receiving operations and names another of the user's accounts, with a pattern for the other
/// side exactly when that account receives operations too.
pub async fn transfer_rule_fields(
    repo: &impl AccountRepository,
    user_id: Uuid,
    body: TransferRuleRequest,
) -> AppResult<TransferRuleFields> {
    let label_pattern = super::trimmed_label_pattern(body.label_pattern, MAX_VALUE_LEN)?;
    if body.counterpart_account_id == body.account_id {
        return Err(AppError::BadRequest(
            "a transfer rule names two different accounts".to_string(),
        ));
    }
    account_receiving_operations(repo, body.account_id, user_id).await?;
    let counterpart = repo
        .find(body.counterpart_account_id, user_id)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(format!("unknown account {}", body.counterpart_account_id))
        })?;
    let counterpart_label_pattern = match (
        counterpart.fields.receives_operations(),
        body.counterpart_label_pattern,
    ) {
        (true, Some(pattern)) => Some(super::trimmed_label_pattern(pattern, MAX_VALUE_LEN)?),
        (false, None) => None,
        (true, None) => {
            return Err(AppError::BadRequest(format!(
                "account '{}' receives operations: the rule needs the label of the other side",
                counterpart.fields.name
            )));
        }
        (false, Some(_)) => {
            return Err(AppError::BadRequest(format!(
                "account '{}' does not receive operations: there is no other side to recognize",
                counterpart.fields.name
            )));
        }
    };
    Ok(TransferRuleFields {
        account_id: body.account_id,
        counterpart_account_id: body.counterpart_account_id,
        label_pattern,
        counterpart_label_pattern,
    })
}

/// Make a new operation a transfer when one of `rules` recognizes it, on either of its
/// accounts, paired with the other side when that one is already in. Returns the operation as
/// it now stands.
pub async fn auto_transfer_operation(
    op_repo: &impl OperationRepository,
    rules: &[TransferRule],
    op: Operation,
) -> AppResult<Operation> {
    let Some((rule, other)) = transfer::first_match(rules, &op) else {
        return Ok(op);
    };
    op_repo
        .set_transfer(op.id, op.user_id, other, Some(rule.id))
        .await?;
    op_repo.pair_transfer(op.id, op.user_id, None).await?;
    op_repo.find_by_id(op.id, op.user_id).await
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_transfer_rules<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
) -> AppResult<Json<Vec<TransferRuleResponse>>> {
    let rules = state.account_repo.list_transfer_rules(auth_user.id).await?;
    Ok(Json(rules.into_iter().map(Into::into).collect()))
}

pub async fn create_transfer_rule<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<TransferRuleRequest>,
) -> AppResult<(StatusCode, Json<TransferRuleResponse>)> {
    let fields = transfer_rule_fields(&state.account_repo, auth_user.id, body).await?;
    let max = state.config.max_transfer_rules_per_user;
    if state
        .account_repo
        .count_transfer_rules(auth_user.id)
        .await?
        >= i64::from(max)
    {
        return Err(AppError::Conflict(format!(
            "transfer rule limit reached ({max})"
        )));
    }
    let rule = state
        .account_repo
        .create_transfer_rule(auth_user.id, &fields)
        .await?;
    Ok((StatusCode::CREATED, Json(rule.into())))
}

pub async fn update_transfer_rule<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<TransferRuleRequest>,
) -> AppResult<Json<TransferRuleResponse>> {
    let fields = transfer_rule_fields(&state.account_repo, auth_user.id, body).await?;
    let rule = state
        .account_repo
        .update_transfer_rule(id, auth_user.id, &fields)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(rule.into()))
}

pub async fn delete_transfer_rule<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if !state
        .account_repo
        .delete_transfer_rule(id, auth_user.id)
        .await?
    {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn apply_transfer_rule<U, O: OperationRepository, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ApplyTransferRuleResponse>> {
    let user_id = auth_user.id;
    let rule = state
        .account_repo
        .find_transfer_rule(id, user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let ops = state.operation_repo.list_all_for_user(user_id).await?;

    let mut result = ApplyTransferRuleResponse {
        transferred: 0,
        skipped: 0,
    };
    let matched: Vec<(Uuid, Uuid)> = ops
        .iter()
        .filter_map(|op| rule.fields.other_account_of(op).map(|other| (op, other)))
        .filter_map(|(op, other)| {
            if op.is_split() || op.transfer.is_some() {
                result.skipped += 1;
                None
            } else {
                Some((op.id, other))
            }
        })
        .collect();
    // Every side is marked before any pairing, so each finds the other already recognized.
    for &(id, other) in &matched {
        state
            .operation_repo
            .set_transfer(id, user_id, other, Some(rule.id))
            .await?;
    }
    for &(id, _) in &matched {
        state
            .operation_repo
            .pair_transfer(id, user_id, None)
            .await?;
    }
    result.transferred = matched.len();
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            account::{Account, AccountFields, AccountKind},
            operation::BudgetLink,
            transfer::Transfer,
            user::UserRole,
        },
        repositories::{
            MockAccountRepository, MockBudgetRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, main_account, make_test_state_with_all,
            no_categories, no_ignore_rules, no_import_profiles, response_json,
        },
    };
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;
    use tower::ServiceExt;

    const MAIN: Uuid = Uuid::from_u128(1);
    const LIVRET: Uuid = Uuid::from_u128(2);
    const JOINT: Uuid = Uuid::from_u128(3);

    /// Finds the imported checking accounts `MAIN` and `JOINT` and the savings account
    /// `LIVRET`, nothing else.
    fn accounts() -> MockAccountRepository {
        let mut repo = MockAccountRepository::new();
        repo.expect_find().returning(|id, user_id| {
            let found = match id {
                MAIN | JOINT => Some(main_account(id, user_id)),
                LIVRET => Some(Account {
                    fields: AccountFields {
                        name: "Livret A".to_string(),
                        kind: AccountKind::Savings,
                        imported: false,
                    },
                    ..main_account(id, user_id)
                }),
                _ => None,
            };
            Box::pin(async move { Ok(found) })
        });
        repo
    }

    fn app(op_repo: MockOperationRepository, account_repo: MockAccountRepository) -> axum::Router {
        build_test_router(make_test_state_with_all(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        ))
    }

    fn rule(user_id: Uuid, value: &str) -> TransferRule {
        TransferRule {
            id: Uuid::new_v4(),
            user_id,
            fields: TransferRuleFields {
                account_id: MAIN,
                counterpart_account_id: LIVRET,
                label_pattern: LabelPattern::Contains(value.to_string()),
                counterpart_label_pattern: None,
            },
            created_at: Utc::now(),
        }
    }

    fn op(user_id: Uuid, label: &str) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id,
            account_id: MAIN,
            amount: dec!(-300),
            date: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            transfer: None,
            splits: vec![],
        }
    }

    async fn post(
        app: axum::Router,
        uri: &str,
        body: serde_json::Value,
        user_id: Uuid,
    ) -> axum::response::Response {
        let auth = auth_header(user_id, UserRole::User);
        app.oneshot(json_request(
            "POST",
            uri,
            Some(&body.to_string()),
            Some(&auth),
        ))
        .await
        .unwrap()
    }

    fn body(account: Uuid, counterpart: Uuid, value: &str) -> serde_json::Value {
        serde_json::json!({
            "accountId": account,
            "counterpartAccountId": counterpart,
            "labelPattern": {"type": "contains", "value": value},
        })
    }

    #[tokio::test]
    async fn create_trims_the_pattern_and_returns_201() {
        let mut repo = accounts();
        repo.expect_count_transfer_rules()
            .returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create_transfer_rule()
            .withf(|_, f| f.label_pattern == LabelPattern::Contains("VIR LIVRET".to_string()))
            .times(1)
            .returning(|user_id, f| {
                let created = TransferRule {
                    id: Uuid::new_v4(),
                    user_id,
                    fields: f.clone(),
                    created_at: Utc::now(),
                };
                Box::pin(async move { Ok(created) })
            });

        let resp = post(
            app(MockOperationRepository::new(), repo),
            "/transfer-rules",
            body(MAIN, LIVRET, "  VIR LIVRET "),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["counterpartAccountId"], LIVRET.to_string());
        assert!(json.get("userId").is_none());
    }

    fn with_other_side(mut body: serde_json::Value, value: &str) -> serde_json::Value {
        body["counterpartLabelPattern"] = serde_json::json!({"type": "contains", "value": value});
        body
    }

    #[tokio::test]
    async fn create_rejects_bad_accounts_and_patterns() {
        let cases = [
            body(MAIN, MAIN, "VIR"),
            body(LIVRET, MAIN, "VIR"),
            body(MAIN, Uuid::new_v4(), "VIR"),
            body(MAIN, LIVRET, "   "),
            // The other side's label exactly when the other account receives operations.
            body(MAIN, JOINT, "VIR"),
            with_other_side(body(MAIN, LIVRET, "VIR"), "VIR"),
            with_other_side(body(MAIN, JOINT, "VIR"), "  "),
        ];
        for case in cases {
            let resp = post(
                app(MockOperationRepository::new(), accounts()),
                "/transfer-rules",
                case.clone(),
                Uuid::new_v4(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{case}");
        }
    }

    #[tokio::test]
    async fn create_keeps_the_label_of_the_other_side_between_imported_accounts() {
        let mut repo = accounts();
        repo.expect_count_transfer_rules()
            .returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create_transfer_rule()
            .withf(|_, f| {
                f.counterpart_label_pattern
                    == Some(LabelPattern::Contains("VIR DE M LEROY".to_string()))
            })
            .times(1)
            .returning(|user_id, f| {
                let created = TransferRule {
                    id: Uuid::new_v4(),
                    user_id,
                    fields: f.clone(),
                    created_at: Utc::now(),
                };
                Box::pin(async move { Ok(created) })
            });

        let resp = post(
            app(MockOperationRepository::new(), repo),
            "/transfer-rules",
            with_other_side(body(MAIN, JOINT, "VIR VERS JOINT"), " VIR DE M LEROY"),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["counterpartLabelPattern"]["value"], "VIR DE M LEROY");
    }

    #[tokio::test]
    async fn create_is_refused_at_the_rule_limit() {
        let mut repo = accounts();
        repo.expect_count_transfer_rules()
            .returning(|_| Box::pin(async { Ok(100) }));
        repo.expect_create_transfer_rule().never();

        let resp = post(
            app(MockOperationRepository::new(), repo),
            "/transfer-rules",
            body(MAIN, LIVRET, "VIR"),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn apply_makes_matching_operations_transfers_and_skips_the_others() {
        let user_id = Uuid::new_v4();
        let existing = rule(user_id, "livret");
        let rule_id = existing.id;
        let fresh = op(user_id, "VIR INTERNE VERS LIVRET A");
        let fresh_id = fresh.id;
        let already = Operation {
            transfer: Some(Transfer {
                account_id: LIVRET,
                account_kind: AccountKind::Savings,
                rule_id: None,
                operation_id: None,
            }),
            ..op(user_id, "VIR LIVRET A")
        };
        let elsewhere = Operation {
            account_id: LIVRET,
            ..op(user_id, "VIR LIVRET A")
        };
        let ops = vec![fresh, already, elsewhere, op(user_id, "CB AMAZON")];

        let mut account_repo = accounts();
        account_repo
            .expect_find_transfer_rule()
            .returning(move |_, _| {
                let existing = existing.clone();
                Box::pin(async move { Ok(Some(existing)) })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_list_all_for_user().returning(move |_| {
            let ops = ops.clone();
            Box::pin(async move { Ok(ops) })
        });
        op_repo
            .expect_set_transfer()
            .withf(move |id, _, account, rule| {
                *id == fresh_id && *account == LIVRET && *rule == Some(rule_id)
            })
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_pair_transfer()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let resp = post(
            app(op_repo, account_repo),
            &format!("/transfer-rules/{rule_id}/apply"),
            serde_json::json!({}),
            user_id,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json, serde_json::json!({"transferred": 1, "skipped": 1}));
    }

    #[tokio::test]
    async fn apply_marks_both_sides_before_pairing_them() {
        let user_id = Uuid::new_v4();
        let mut existing = rule(user_id, "VIR VERS JOINT");
        existing.fields.counterpart_account_id = JOINT;
        existing.fields.counterpart_label_pattern =
            Some(LabelPattern::Contains("VIR DE".to_string()));
        let rule_id = existing.id;
        let out = op(user_id, "VIR VERS JOINT");
        let incoming = Operation {
            account_id: JOINT,
            amount: dec!(300),
            ..op(user_id, "VIR DE M LEROY")
        };
        let refund = Operation {
            account_id: JOINT,
            amount: dec!(300),
            ..op(user_id, "REMBOURSEMENT")
        };
        let marked = [(out.id, JOINT), (incoming.id, MAIN)];
        let ops = vec![out, incoming, refund];

        let mut account_repo = accounts();
        account_repo
            .expect_find_transfer_rule()
            .returning(move |_, _| {
                let existing = existing.clone();
                Box::pin(async move { Ok(Some(existing)) })
            });
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_list_all_for_user().returning(move |_| {
            let ops = ops.clone();
            Box::pin(async move { Ok(ops) })
        });
        let mut sequence = mockall::Sequence::new();
        for (id, other) in marked {
            op_repo
                .expect_set_transfer()
                .withf(move |i, _, a, r| *i == id && *a == other && *r == Some(rule_id))
                .times(1)
                .in_sequence(&mut sequence)
                .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        }
        op_repo
            .expect_pair_transfer()
            .times(2)
            .in_sequence(&mut sequence)
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let resp = post(
            app(op_repo, account_repo),
            &format!("/transfer-rules/{rule_id}/apply"),
            serde_json::json!({}),
            user_id,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json, serde_json::json!({"transferred": 2, "skipped": 0}));
    }

    #[tokio::test]
    async fn a_new_operation_follows_the_first_matching_rule_and_no_other() {
        let user_id = Uuid::new_v4();
        let rules = [rule(user_id, "amazon"), rule(user_id, "livret")];
        let matched = op(user_id, "VIR LIVRET A");
        let matched_id = matched.id;
        let rule_id = rules[1].id;

        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_set_transfer()
            .withf(move |id, _, account, rule| {
                *id == matched_id && *account == LIVRET && *rule == Some(rule_id)
            })
            .times(1)
            .returning(|_, _, _, _| Box::pin(async { Ok(true) }));
        op_repo
            .expect_pair_transfer()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(None) }));
        op_repo
            .expect_find_by_id()
            .times(1)
            .returning(|id, user_id| {
                let reloaded = Operation {
                    id,
                    ..op(user_id, "VIR LIVRET A")
                };
                Box::pin(async move { Ok(reloaded) })
            });

        let reloaded = auto_transfer_operation(&op_repo, &rules, matched)
            .await
            .unwrap();
        assert_eq!(reloaded.id, matched_id);
        let unmatched = op(user_id, "CB CARREFOUR");
        let unmatched_id = unmatched.id;
        let same = auto_transfer_operation(&op_repo, &rules, unmatched)
            .await
            .unwrap();
        assert_eq!(same.id, unmatched_id);
    }
}
