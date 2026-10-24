use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::{
        budget::LabelPattern,
        category::{Category, CategoryColor, CategoryFields, CategoryIcon, CategoryRule},
    },
    error::{AppError, AppResult},
    repositories::{CategoryRepository, OperationRepository},
    services::matcher::{MatcherService, MatcherServiceImpl},
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

const MAX_NAME_LEN: usize = 50;
const MAX_RULES: usize = 20;
const MAX_PATTERN_LEN: usize = 100;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body of a create or update: the whole category, every field replaced on update.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "name": "Groceries",
    "color": "#12b886",
    "icon": "cart",
    "netTotals": true,
    "rules": [{ "labelPattern": { "type": "contains", "value": "CARREFOUR" } }],
})))]
pub struct CategoryRequest {
    /// Name shown on operations, unique per user (1 to 50 characters).
    pub name: String,
    /// Colour the category is shown with.
    pub color: CategoryColor,
    /// Icon shown inside the colour; omitted or null for none.
    #[serde(default)]
    pub icon: Option<CategoryIcon>,
    /// When true, statistics count the category's net total, a refund offsetting the spending
    /// it refunds; otherwise its income and expenses apart. Default: false.
    #[serde(default)]
    #[schemars(default)]
    pub net_totals: bool,
    /// Rules giving the category to the operations they match that have none of their own,
    /// at most 20, each value trimmed and 1 to 100 characters long; omitted for none.
    #[serde(default)]
    pub rules: Vec<CategoryRule>,
}

/// A category (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CategoryResponse {
    pub id: Uuid,
    pub name: String,
    pub color: CategoryColor,
    pub icon: Option<CategoryIcon>,
    pub net_totals: bool,
    pub rules: Vec<CategoryRule>,
    pub created_at: DateTime<Utc>,
}

impl From<Category> for CategoryResponse {
    fn from(c: Category) -> Self {
        Self {
            id: c.id,
            name: c.fields.name,
            color: c.fields.color,
            icon: c.fields.icon,
            net_totals: c.fields.net_totals,
            rules: c.fields.rules,
            created_at: c.created_at,
        }
    }
}

impl TryFrom<CategoryRequest> for CategoryFields {
    type Error = AppError;

    fn try_from(body: CategoryRequest) -> AppResult<Self> {
        let name = body.name.trim().to_string();
        if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
            return Err(AppError::BadRequest(format!(
                "name must be 1 to {MAX_NAME_LEN} characters"
            )));
        }
        if body.rules.len() > MAX_RULES {
            return Err(AppError::BadRequest(format!(
                "a category has at most {MAX_RULES} rules"
            )));
        }
        let rules = body
            .rules
            .into_iter()
            .map(|rule| trimmed_rule(rule.label_pattern))
            .collect::<AppResult<_>>()?;
        Ok(Self {
            name,
            color: body.color,
            icon: body.icon,
            net_totals: body.net_totals,
            rules,
        })
    }
}

fn trimmed_rule(pattern: LabelPattern) -> AppResult<CategoryRule> {
    Ok(CategoryRule {
        label_pattern: super::trimmed_label_pattern(pattern, MAX_PATTERN_LEN)?,
    })
}

/// Body of an apply of a category's rules.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCategoryRequest {
    /// When true, also replace the category of the matching operations that have another one
    /// of their own. Default: false.
    #[serde(default)]
    #[schemars(default)]
    pub force: bool,
}

/// Result of applying a category's rules to operations.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCategoryResponse {
    /// Matching operations put in the category.
    pub updated: usize,
    /// Matching operations left as they were: split, or in another category without `force`.
    pub skipped: usize,
}

/// Fail with `BadRequest` unless `category_id` is absent or one of the user's categories.
pub async fn ensure_category_is_users(
    repo: &impl CategoryRepository,
    category_id: Option<Uuid>,
    user_id: Uuid,
) -> AppResult<()> {
    match category_id {
        Some(id) if !repo.exists(id, user_id).await? => {
            Err(AppError::BadRequest(format!("unknown category {id}")))
        }
        _ => Ok(()),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_categories<U, O, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
) -> AppResult<Json<Vec<CategoryResponse>>> {
    let categories = state.category_repo.list(auth_user.id).await?;
    Ok(Json(
        categories.into_iter().map(CategoryResponse::from).collect(),
    ))
}

pub async fn create_category<U, O, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<CategoryRequest>,
) -> AppResult<(StatusCode, Json<CategoryResponse>)> {
    let fields = CategoryFields::try_from(body)?;
    let max = state.config.max_categories_per_user;
    if state.category_repo.count(auth_user.id).await? >= i64::from(max) {
        return Err(AppError::Conflict(format!(
            "category limit reached ({max})"
        )));
    }
    let category = state.category_repo.create(auth_user.id, &fields).await?;
    Ok((StatusCode::CREATED, Json(category.into())))
}

pub async fn update_category<U, O, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CategoryRequest>,
) -> AppResult<Json<CategoryResponse>> {
    let fields = CategoryFields::try_from(body)?;
    let category = state
        .category_repo
        .update(id, auth_user.id, &fields)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(category.into()))
}

pub async fn delete_category<U, O, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if !state.category_repo.delete(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn apply_category<U, O: OperationRepository, B, P, C: CategoryRepository, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ApplyCategoryRequest>,
) -> AppResult<Json<ApplyCategoryResponse>> {
    let user_id = auth_user.id;
    let category = state
        .category_repo
        .list(user_id)
        .await?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(AppError::NotFound)?;
    let ops = state.operation_repo.list_all_for_user(user_id).await?;

    let matcher = MatcherServiceImpl;
    let mut updated = 0usize;
    let mut skipped = 0usize;
    for op in ops {
        if op.category_id == Some(id)
            || matcher
                .match_category(&op, std::slice::from_ref(&category))
                .is_none()
        {
            continue;
        }
        if op.is_split() || op.transfer.is_some() || (!body.force && op.category_id.is_some()) {
            skipped += 1;
            continue;
        }
        state
            .operation_repo
            .set_category(op.id, user_id, Some(id))
            .await?;
        updated += 1;
    }

    Ok(Json(ApplyCategoryResponse { updated, skipped }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::operation::{BudgetLink, Operation, OperationSplit};
    use crate::{
        domain::user::UserRole,
        repositories::{
            MockBudgetRepository, MockCategoryRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, make_test_state_with_categories,
            response_json,
        },
    };
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use tower::ServiceExt;

    fn request(name: &str) -> CategoryRequest {
        CategoryRequest {
            name: name.to_string(),
            color: "#12b886".parse::<CategoryColor>().unwrap(),
            icon: None,
            net_totals: false,
            rules: Vec::new(),
        }
    }

    fn category(user_id: Uuid, fields: CategoryFields) -> Category {
        Category {
            id: Uuid::new_v4(),
            user_id,
            fields,
            created_at: Utc::now(),
        }
    }

    fn app(category_repo: MockCategoryRepository) -> axum::Router {
        app_with_operations(category_repo, MockOperationRepository::new())
    }

    fn app_with_operations(
        category_repo: MockCategoryRepository,
        op_repo: MockOperationRepository,
    ) -> axum::Router {
        build_test_router(make_test_state_with_categories(
            MockUserRepository::new(),
            op_repo,
            MockBudgetRepository::new(),
            category_repo,
        ))
    }

    fn contains(value: &str) -> CategoryRule {
        CategoryRule {
            label_pattern: LabelPattern::Contains(value.to_string()),
        }
    }

    fn operation(label: &str, category_id: Option<Uuid>, split: bool) -> Operation {
        Operation {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            account_id: Uuid::nil(),
            amount: Decimal::new(-30, 0),
            date: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
            effective_date: None,
            label: label.to_string(),
            budget_link: BudgetLink::Unlinked,
            ignored: false,
            ignore_rule_id: None,
            category_id,
            budget_category_id: None,
            transfer: None,
            splits: if split {
                vec![OperationSplit {
                    id: Uuid::new_v4(),
                    amount: Decimal::new(-30, 0),
                    effective_date: None,
                    budget_id: None,
                    category_id: None,
                    budget_category_id: None,
                }]
            } else {
                Vec::new()
            },
        }
    }

    fn body(req: &CategoryRequest) -> String {
        serde_json::to_string(req).unwrap()
    }

    #[test]
    fn request_is_trimmed_into_fields() {
        let fields = CategoryFields::try_from(request("  Food  ")).unwrap();
        assert_eq!(fields.name, "Food");
        assert_eq!(fields.color, "#12b886".parse::<CategoryColor>().unwrap());
    }

    #[test]
    fn blank_or_overlong_name_is_rejected() {
        for name in ["   ", &"x".repeat(MAX_NAME_LEN + 1)] {
            assert!(matches!(
                CategoryFields::try_from(request(name)),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[test]
    fn rule_values_are_trimmed() {
        let req = CategoryRequest {
            rules: vec![CategoryRule {
                label_pattern: LabelPattern::StartsWith("  CB BIOCOOP ".to_string()),
            }],
            ..request("Food")
        };
        assert_eq!(
            CategoryFields::try_from(req).unwrap().rules[0].label_pattern,
            LabelPattern::StartsWith("CB BIOCOOP".to_string())
        );
    }

    #[test]
    fn blank_overlong_or_too_many_rules_are_rejected() {
        let cases = [
            vec![contains("  ")],
            vec![contains(&"x".repeat(MAX_PATTERN_LEN + 1))],
            vec![contains("EDF"); MAX_RULES + 1],
        ];
        for rules in cases {
            let req = CategoryRequest {
                rules,
                ..request("Food")
            };
            assert!(matches!(
                CategoryFields::try_from(req),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[tokio::test]
    async fn apply_categorizes_matching_operations_and_skips_the_others() {
        let user_id = Uuid::new_v4();
        let target = category(
            user_id,
            CategoryFields {
                rules: vec![contains("EDF")],
                ..CategoryFields::try_from(request("Energy")).unwrap()
            },
        );
        let id = target.id;
        let category_repo = || {
            let target = target.clone();
            let mut repo = MockCategoryRepository::new();
            repo.expect_list().returning(move |_| {
                let target = target.clone();
                Box::pin(async move { Ok(vec![target]) })
            });
            repo
        };
        let uncategorized = operation("PRLV EDF", None, false);
        let elsewhere = operation("PRLV EDF", Some(Uuid::new_v4()), false);
        let ops = vec![
            uncategorized.clone(),
            elsewhere.clone(),
            operation("PRLV EDF", Some(id), false),
            operation("PRLV EDF", None, true),
            operation("CB LIDL", None, false),
        ];
        let expected = move |force: bool| {
            let mut ids = vec![uncategorized.id];
            if force {
                ids.push(elsewhere.id);
            }
            ids
        };

        for force in [false, true] {
            let mut op_repo = MockOperationRepository::new();
            let listed = ops.clone();
            op_repo.expect_list_all_for_user().returning(move |_| {
                let listed = listed.clone();
                Box::pin(async move { Ok(listed) })
            });
            let updated_ids = expected(force);
            op_repo
                .expect_set_category()
                .withf(move |op_id, uid, cid| {
                    updated_ids.contains(op_id) && *uid == user_id && *cid == Some(id)
                })
                .times(expected(force).len())
                .returning(|_, _, _| Box::pin(async { Ok(true) }));

            let auth = auth_header(user_id, UserRole::User);
            let resp = app_with_operations(category_repo(), op_repo)
                .oneshot(json_request(
                    "POST",
                    &format!("/categories/{id}/apply"),
                    Some(&format!(r#"{{"force":{force}}}"#)),
                    Some(&auth),
                ))
                .await
                .unwrap();

            assert_eq!(resp.status(), StatusCode::OK);
            let json: ApplyCategoryResponse = response_json(resp).await;
            assert_eq!(json.updated, if force { 2 } else { 1 });
            assert_eq!(json.skipped, if force { 1 } else { 2 });
        }
    }

    #[tokio::test]
    async fn apply_unknown_category_is_not_found() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_list()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        let mut op_repo = MockOperationRepository::new();
        op_repo.expect_set_category().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app_with_operations(repo, op_repo)
            .oneshot(json_request(
                "POST",
                &format!("/categories/{}/apply", Uuid::new_v4()),
                Some("{}"),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn ensure_category_is_users_accepts_none_and_own_rejects_others() {
        let mut repo = MockCategoryRepository::new();
        let own = Uuid::new_v4();
        repo.expect_exists()
            .returning(move |id, _| Box::pin(async move { Ok(id == own) }));
        let user_id = Uuid::new_v4();

        assert!(ensure_category_is_users(&repo, None, user_id).await.is_ok());
        assert!(
            ensure_category_is_users(&repo, Some(own), user_id)
                .await
                .is_ok()
        );
        assert!(matches!(
            ensure_category_is_users(&repo, Some(Uuid::new_v4()), user_id).await,
            Err(AppError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn list_returns_categories_without_user_id() {
        let user_id = Uuid::new_v4();
        let existing = category(user_id, CategoryFields::try_from(request("Food")).unwrap());
        let mut repo = MockCategoryRepository::new();
        repo.expect_list()
            .withf(move |id| *id == user_id)
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async move { Ok(vec![existing]) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let resp = app(repo)
            .oneshot(json_request("GET", "/categories", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json[0]["name"], "Food");
        assert_eq!(json[0]["color"], "#12b886");
        assert!(json[0]["icon"].is_null());
        assert!(json[0].get("userId").is_none());
    }

    #[tokio::test]
    async fn create_stores_validated_fields() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_count().returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create()
            .withf(|_, fields| fields.name == "Food")
            .returning(|user_id, fields| {
                let created = category(user_id, fields.clone());
                Box::pin(async move { Ok(created) })
            });

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/categories",
                Some(&body(&request(" Food "))),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: CategoryResponse = response_json(resp).await;
        assert_eq!(json.name, "Food");
    }

    #[tokio::test]
    async fn create_beyond_limit_is_a_conflict() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_count()
            .returning(|_| Box::pin(async { Ok(50) }));
        repo.expect_create().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/categories",
                Some(&body(&request("Food"))),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_with_unknown_color_is_rejected() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_create().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/categories",
                Some(r#"{"name":"Food","color":"purple"}"#),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert!(resp.status().is_client_error());
    }

    #[tokio::test]
    async fn create_with_unknown_icon_is_rejected() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_create().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/categories",
                Some(r##"{"name":"Food","color":"#12b886","icon":"rocket"}"##),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert!(resp.status().is_client_error());
    }

    #[tokio::test]
    async fn update_unknown_category_is_not_found() {
        let mut repo = MockCategoryRepository::new();
        repo.expect_update()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "PUT",
                &format!("/categories/{}", Uuid::new_v4()),
                Some(&body(&request("Food"))),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_returns_new_fields() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut repo = MockCategoryRepository::new();
        repo.expect_update()
            .withf(move |cid, uid, _| *cid == id && *uid == user_id)
            .returning(|id, user_id, fields| {
                let updated = Category {
                    id,
                    ..category(user_id, fields.clone())
                };
                Box::pin(async move { Ok(Some(updated)) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let req = CategoryRequest {
            name: "Groceries".to_string(),
            color: "#fd7e14".parse::<CategoryColor>().unwrap(),
            icon: Some(CategoryIcon::Cart),
            net_totals: true,
            rules: Vec::new(),
        };
        let resp = app(repo)
            .oneshot(json_request(
                "PUT",
                &format!("/categories/{id}"),
                Some(&body(&req)),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: CategoryResponse = response_json(resp).await;
        assert_eq!(json.id, id);
        assert_eq!(json.color, "#fd7e14".parse::<CategoryColor>().unwrap());
        assert_eq!(json.icon, Some(CategoryIcon::Cart));
        assert!(json.net_totals);
    }

    #[tokio::test]
    async fn delete_returns_no_content_then_not_found() {
        let mut repo = MockCategoryRepository::new();
        let mut calls = 0;
        repo.expect_delete().times(2).returning(move |_, _| {
            calls += 1;
            let found = calls == 1;
            Box::pin(async move { Ok(found) })
        });
        let app = app(repo);
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let uri = format!("/categories/{}", Uuid::new_v4());

        let first = app
            .clone()
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();
        let second = app
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(first.status(), StatusCode::NO_CONTENT);
        assert_eq!(second.status(), StatusCode::NOT_FOUND);
    }
}
