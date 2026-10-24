use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::LabelPattern,
        ignore_rule::{self, IgnoreRule, IgnoreRuleFields},
        operation::Operation,
    },
    error::{AppError, AppResult},
    repositories::{IgnoreRuleRepository, OperationRepository},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub(super) const MAX_VALUE_LEN: usize = 200;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body of a create or update: the whole rule, every field replaced on update.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({ "labelPattern": { "type": "contains", "value": "VIR INTERNE" }, "amount": null })))]
pub struct IgnoreRuleRequest {
    /// Pattern the operation label must match; its value is trimmed and 1 to 200 characters.
    pub label_pattern: LabelPattern,
    /// Positive amount the operation's amount must equal, whatever its sign; omitted or null for any.
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub amount: Option<Decimal>,
}

/// An ignore rule (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreRuleResponse {
    pub id: Uuid,
    pub label_pattern: LabelPattern,
    #[schemars(with = "Option<String>")]
    pub amount: Option<Decimal>,
    pub created_at: DateTime<Utc>,
}

impl From<IgnoreRule> for IgnoreRuleResponse {
    fn from(rule: IgnoreRule) -> Self {
        Self {
            id: rule.id,
            label_pattern: rule.fields.label_pattern,
            amount: rule.fields.amount,
            created_at: rule.created_at,
        }
    }
}

/// Result of applying an ignore rule to the existing operations.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyIgnoreRuleResponse {
    /// Matching operations the rule now ignores.
    pub ignored: usize,
    /// Matching operations that were already ignored, by hand or by a rule, and are left as is.
    pub already_ignored: usize,
}

impl TryFrom<IgnoreRuleRequest> for IgnoreRuleFields {
    type Error = AppError;

    fn try_from(body: IgnoreRuleRequest) -> AppResult<Self> {
        let label_pattern = super::trimmed_label_pattern(body.label_pattern, MAX_VALUE_LEN)?;
        if body.amount.is_some_and(|a| a <= Decimal::ZERO) {
            return Err(AppError::BadRequest("amount must be positive".to_string()));
        }
        Ok(Self {
            label_pattern,
            amount: body.amount,
        })
    }
}

/// Ignore a new operation when one of `rules` matches it.
pub async fn auto_ignore_operation(
    op_repo: &impl OperationRepository,
    rules: &[IgnoreRule],
    op: &Operation,
) -> AppResult<()> {
    if let Some(rule) = ignore_rule::first_match(rules, op) {
        op_repo.ignore_by_rule(op.id, rule.id).await?;
    }
    Ok(())
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_ignore_rules<U, O, B, P, C, R: IgnoreRuleRepository, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
) -> AppResult<Json<Vec<IgnoreRuleResponse>>> {
    let rules = state.ignore_rule_repo.list(auth_user.id).await?;
    Ok(Json(
        rules.into_iter().map(IgnoreRuleResponse::from).collect(),
    ))
}

pub async fn create_ignore_rule<U, O, B, P, C, R: IgnoreRuleRepository, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<IgnoreRuleRequest>,
) -> AppResult<(StatusCode, Json<IgnoreRuleResponse>)> {
    let fields = IgnoreRuleFields::try_from(body)?;
    let max = state.config.max_ignore_rules_per_user;
    if state.ignore_rule_repo.count(auth_user.id).await? >= i64::from(max) {
        return Err(AppError::Conflict(format!(
            "ignore rule limit reached ({max})"
        )));
    }
    let rule = state.ignore_rule_repo.create(auth_user.id, &fields).await?;
    Ok((StatusCode::CREATED, Json(rule.into())))
}

pub async fn update_ignore_rule<U, O, B, P, C, R: IgnoreRuleRepository, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<IgnoreRuleRequest>,
) -> AppResult<Json<IgnoreRuleResponse>> {
    let fields = IgnoreRuleFields::try_from(body)?;
    let rule = state
        .ignore_rule_repo
        .update(id, auth_user.id, &fields)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(rule.into()))
}

pub async fn delete_ignore_rule<U, O, B, P, C, R: IgnoreRuleRepository, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if !state.ignore_rule_repo.delete(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn apply_ignore_rule<U, O: OperationRepository, B, P, C, R: IgnoreRuleRepository, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ApplyIgnoreRuleResponse>> {
    let user_id = auth_user.id;
    let rule = state
        .ignore_rule_repo
        .find_by_id(id, user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let ops = state.operation_repo.list_all_for_user(user_id).await?;

    let mut result = ApplyIgnoreRuleResponse {
        ignored: 0,
        already_ignored: 0,
    };
    for op in ops.iter().filter(|op| rule.fields.matches(op)) {
        if op.ignored {
            result.already_ignored += 1;
        } else {
            state.operation_repo.ignore_by_rule(op.id, rule.id).await?;
            result.ignored += 1;
        }
    }
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{operation::BudgetLink, user::UserRole},
        repositories::{
            MockBudgetRepository, MockIgnoreRuleRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, make_test_state_with_ignore_rules,
            response_json,
        },
    };
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;
    use tower::ServiceExt;

    fn contains(value: &str) -> IgnoreRuleRequest {
        IgnoreRuleRequest {
            label_pattern: LabelPattern::Contains(value.to_string()),
            amount: None,
        }
    }

    fn rule(user_id: Uuid, fields: IgnoreRuleFields) -> IgnoreRule {
        IgnoreRule {
            id: Uuid::new_v4(),
            user_id,
            fields,
            created_at: Utc::now(),
        }
    }

    fn op(user_id: Uuid, label: &str, ignored: bool) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id,
            account_id: Uuid::nil(),
            amount: dec!(-500),
            date: NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored,
            ignore_rule_id: None,
            category_id: None,
            budget_category_id: None,
            transfer: None,
            splits: vec![],
        }
    }

    fn app(op_repo: MockOperationRepository, rule_repo: MockIgnoreRuleRepository) -> axum::Router {
        build_test_router(make_test_state_with_ignore_rules(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            rule_repo,
        ))
    }

    fn body(req: &IgnoreRuleRequest) -> String {
        serde_json::to_string(req).unwrap()
    }

    #[test]
    fn request_value_is_trimmed_into_fields() {
        let fields = IgnoreRuleFields::try_from(IgnoreRuleRequest {
            label_pattern: LabelPattern::StartsWith("  VIR LIVRET  ".to_string()),
            amount: Some(dec!(12.5)),
        })
        .unwrap();
        assert_eq!(
            fields.label_pattern,
            LabelPattern::StartsWith("VIR LIVRET".to_string())
        );
        assert_eq!(fields.amount, Some(dec!(12.5)));
    }

    #[test]
    fn blank_value_or_non_positive_amount_is_rejected() {
        let overlong = "x".repeat(MAX_VALUE_LEN + 1);
        for req in [
            contains("   "),
            contains(&overlong),
            IgnoreRuleRequest {
                amount: Some(dec!(-3)),
                ..contains("VIR")
            },
            IgnoreRuleRequest {
                amount: Some(Decimal::ZERO),
                ..contains("VIR")
            },
        ] {
            assert!(matches!(
                IgnoreRuleFields::try_from(req),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[tokio::test]
    async fn auto_ignore_operation_records_the_first_matching_rule() {
        let user_id = Uuid::new_v4();
        let rules = [
            rule(
                user_id,
                IgnoreRuleFields::try_from(contains("LOYER")).unwrap(),
            ),
            rule(
                user_id,
                IgnoreRuleFields::try_from(contains("VIR")).unwrap(),
            ),
        ];
        let target = op(user_id, "VIR INTERNE", false);
        let (op_id, rule_id) = (target.id, rules[1].id);
        let mut op_repo = MockOperationRepository::new();
        op_repo
            .expect_ignore_by_rule()
            .withf(move |o, r| *o == op_id && *r == rule_id)
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        auto_ignore_operation(&op_repo, &rules, &target)
            .await
            .unwrap();
        auto_ignore_operation(&op_repo, &rules, &op(user_id, "CB AMAZON", false))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_returns_rules_without_user_id() {
        let user_id = Uuid::new_v4();
        let existing = rule(
            user_id,
            IgnoreRuleFields {
                label_pattern: LabelPattern::Contains("VIR INTERNE".to_string()),
                amount: Some(dec!(250)),
            },
        );
        let mut repo = MockIgnoreRuleRepository::new();
        repo.expect_list()
            .withf(move |id| *id == user_id)
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async move { Ok(vec![existing]) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let resp = app(MockOperationRepository::new(), repo)
            .oneshot(json_request("GET", "/ignore-rules", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json[0]["labelPattern"]["type"], "contains");
        assert_eq!(json[0]["labelPattern"]["value"], "VIR INTERNE");
        assert_eq!(json[0]["amount"], "250");
        assert!(json[0].get("userId").is_none());
    }

    #[tokio::test]
    async fn create_stores_validated_fields() {
        let mut repo = MockIgnoreRuleRepository::new();
        repo.expect_count().returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create()
            .withf(|_, fields| fields.label_pattern == LabelPattern::Contains("VIR".to_string()))
            .returning(|user_id, fields| {
                let created = rule(user_id, fields.clone());
                Box::pin(async move { Ok(created) })
            });

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(MockOperationRepository::new(), repo)
            .oneshot(json_request(
                "POST",
                "/ignore-rules",
                Some(&body(&contains(" VIR "))),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["labelPattern"]["value"], "VIR");
        assert!(json["amount"].is_null());
    }

    #[tokio::test]
    async fn create_beyond_the_limit_is_a_conflict() {
        let mut repo = MockIgnoreRuleRepository::new();
        repo.expect_count()
            .returning(|_| Box::pin(async { Ok(100) }));
        repo.expect_create().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(MockOperationRepository::new(), repo)
            .oneshot(json_request(
                "POST",
                "/ignore-rules",
                Some(&body(&contains("VIR"))),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn update_or_delete_an_unknown_rule_is_not_found() {
        let mut repo = MockIgnoreRuleRepository::new();
        repo.expect_update()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));
        repo.expect_delete()
            .returning(|_, _| Box::pin(async { Ok(false) }));
        let router = app(MockOperationRepository::new(), repo);
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let uri = format!("/ignore-rules/{}", Uuid::new_v4());

        let resp = router
            .clone()
            .oneshot(json_request(
                "PUT",
                &uri,
                Some(&body(&contains("VIR"))),
                Some(&auth),
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let resp = router
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn apply_ignores_matching_operations_not_yet_ignored() {
        let user_id = Uuid::new_v4();
        let existing = rule(
            user_id,
            IgnoreRuleFields::try_from(contains("VIR")).unwrap(),
        );
        let rule_id = existing.id;
        let fresh = op(user_id, "VIR INTERNE", false);
        let fresh_id = fresh.id;
        let ops = vec![
            fresh,
            op(user_id, "VIR LIVRET", true),
            op(user_id, "CB AMAZON", false),
        ];

        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo
            .expect_find_by_id()
            .withf(move |id, user| *id == rule_id && *user == user_id)
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
            .expect_ignore_by_rule()
            .withf(move |o, r| *o == fresh_id && *r == rule_id)
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let auth = auth_header(user_id, UserRole::User);
        let resp = app(op_repo, rule_repo)
            .oneshot(json_request(
                "POST",
                &format!("/ignore-rules/{rule_id}/apply"),
                None,
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["ignored"], 1);
        assert_eq!(json["alreadyIgnored"], 1);
    }

    #[tokio::test]
    async fn apply_an_unknown_rule_is_not_found() {
        let mut rule_repo = MockIgnoreRuleRepository::new();
        rule_repo
            .expect_find_by_id()
            .returning(|_, _| Box::pin(async { Ok(None) }));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(MockOperationRepository::new(), rule_repo)
            .oneshot(json_request(
                "POST",
                &format!("/ignore-rules/{}/apply", Uuid::new_v4()),
                None,
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
