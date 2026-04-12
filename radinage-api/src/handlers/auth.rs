use crate::{
    AppState, auth,
    domain::user::UserRole,
    error::{AppError, AppResult},
    repositories::UserRepository,
};
use axum::{Json, extract::State, http::StatusCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    /// The user's unique login name.
    pub username: String,
    /// The user's password (plain text, validated against the stored hash).
    pub password: String,
}

/// Successful authentication response.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    /// JWT Bearer token to include in the `Authorization` header of subsequent requests.
    pub token: String,
    /// The role granted to the authenticated user.
    pub role: UserRole,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivateRequest {
    /// The invitation token received in the shareable link.
    pub token: Uuid,
    /// The password the user wants to set for their account.
    pub password: String,
}

/// Response returned after successful account activation.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivateResponse {
    /// JWT Bearer token for immediate authentication after activation.
    pub token: String,
    /// The role granted to the activated user.
    pub role: UserRole,
}

pub async fn activate<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    Json(body): Json<ActivateRequest>,
) -> AppResult<(StatusCode, Json<ActivateResponse>)> {
    let user_id = state
        .user_repo
        .find_by_invitation_token(body.token)
        .await?
        .ok_or(AppError::NotFound)?;

    let password_hash = auth::hash_password(&body.password)?;
    state.user_repo.activate(user_id, &password_hash).await?;

    let token = auth::generate_token_from_config(&state.config, user_id, UserRole::User)?;
    Ok((
        StatusCode::OK,
        Json(ActivateResponse {
            token,
            role: UserRole::User,
        }),
    ))
}

pub async fn login<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let creds = state
        .user_repo
        .find_by_username(&body.username)
        .await?
        .ok_or(AppError::Unauthorized)?;

    // An invalid hash (e.g. placeholder for not-yet-activated accounts)
    // is treated as a failed password check, not an internal error.
    if !auth::verify_password(&body.password, &creds.password_hash).unwrap_or(false) {
        return Err(AppError::Unauthorized);
    }

    let token = auth::generate_token_from_config(&state.config, creds.id, creds.role)?;
    Ok(Json(LoginResponse {
        token,
        role: creds.role,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        repositories::{
            MockBudgetRepository, MockOperationRepository, MockUserRepository, UserCredentials,
        },
        test_util::{
            build_test_router, json_request, make_test_config, make_test_state, response_json,
        },
    };
    use axum::http::StatusCode;
    use tower::ServiceExt;

    fn make_credentials(role: UserRole) -> UserCredentials {
        let hash = auth::hash_password("correct_pass").unwrap();
        UserCredentials {
            id: Uuid::new_v4(),
            password_hash: hash,
            role,
        }
    }

    fn login_json(username: &str, password: &str) -> String {
        serde_json::to_string(&LoginRequest {
            username: username.to_string(),
            password: password.to_string(),
        })
        .unwrap()
    }

    #[tokio::test]
    async fn login_with_correct_credentials_returns_token() {
        let creds = make_credentials(UserRole::User);
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(move |_| {
                let c = UserCredentials {
                    id: creds.id,
                    password_hash: creds.password_hash.clone(),
                    role: creds.role,
                };
                Box::pin(async move { Ok(Some(c)) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = login_json("alice", "correct_pass");
        let req = json_request("POST", "/auth/login", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: LoginResponse = response_json(resp).await;
        assert_eq!(json.role, UserRole::User);
        assert!(!json.token.is_empty());
    }

    #[tokio::test]
    async fn login_with_wrong_password_returns_unauthorized() {
        let creds = make_credentials(UserRole::User);
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(move |_| {
                let c = UserCredentials {
                    id: creds.id,
                    password_hash: creds.password_hash.clone(),
                    role: creds.role,
                };
                Box::pin(async move { Ok(Some(c)) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = login_json("alice", "wrong_pass");
        let req = json_request("POST", "/auth/login", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn login_with_unknown_user_returns_unauthorized() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(|_| Box::pin(async { Ok(None) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = login_json("ghost", "pass");
        let req = json_request("POST", "/auth/login", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn activate_with_valid_token_sets_password_and_returns_jwt() {
        let user_id = Uuid::new_v4();
        let token = Uuid::new_v4();

        let mut user_repo = MockUserRepository::new();
        let uid = user_id;
        user_repo
            .expect_find_by_invitation_token()
            .once()
            .returning(move |_| Box::pin(async move { Ok(Some(uid)) }));
        user_repo
            .expect_activate()
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = serde_json::to_string(&ActivateRequest {
            token,
            password: "newpass123".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ActivateResponse = response_json(resp).await;
        assert_eq!(json.role, UserRole::User);
        assert!(!json.token.is_empty());
    }

    #[tokio::test]
    async fn activate_with_unknown_token_returns_not_found() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_invitation_token()
            .once()
            .returning(|_| Box::pin(async { Ok(None) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = serde_json::to_string(&ActivateRequest {
            token: Uuid::new_v4(),
            password: "pass".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn login_admin_role_preserved_in_token() {
        let creds = make_credentials(UserRole::Admin);
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(move |_| {
                let c = UserCredentials {
                    id: creds.id,
                    password_hash: creds.password_hash.clone(),
                    role: creds.role,
                };
                Box::pin(async move { Ok(Some(c)) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = login_json("admin", "correct_pass");
        let req = json_request("POST", "/auth/login", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: LoginResponse = response_json(resp).await;
        assert_eq!(json.role, UserRole::Admin);
    }

    #[tokio::test]
    async fn activate_returns_decodable_jwt_for_correct_user() {
        let user_id = Uuid::new_v4();
        let token = Uuid::new_v4();

        let mut user_repo = MockUserRepository::new();
        let uid = user_id;
        user_repo
            .expect_find_by_invitation_token()
            .once()
            .returning(move |_| Box::pin(async move { Ok(Some(uid)) }));
        user_repo
            .expect_activate()
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = serde_json::to_string(&ActivateRequest {
            token,
            password: "newpass123".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ActivateResponse = response_json(resp).await;

        let config = make_test_config();
        let claims = auth::decode_token(&config.jwt_secret, &json.token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.role, UserRole::User);
    }

    #[tokio::test]
    async fn activate_with_invalid_json_returns_error() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = r#"{"token": "not-a-uuid", "password": "p"}"#;
        let req = json_request("POST", "/auth/activate", Some(body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn login_with_placeholder_hash_returns_unauthorized() {
        let mut user_repo = MockUserRepository::new();
        user_repo.expect_find_by_username().once().returning(|_| {
            Box::pin(async {
                Ok(Some(UserCredentials {
                    id: Uuid::new_v4(),
                    password_hash: "!not-activated".to_string(),
                    role: UserRole::User,
                }))
            })
        });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = login_json("invited_user", "any_password");
        let req = json_request("POST", "/auth/login", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn activate_stores_argon2_hash_not_plaintext() {
        let user_id = Uuid::new_v4();
        let token = Uuid::new_v4();

        let mut user_repo = MockUserRepository::new();
        let uid = user_id;
        user_repo
            .expect_find_by_invitation_token()
            .once()
            .returning(move |_| Box::pin(async move { Ok(Some(uid)) }));
        user_repo
            .expect_activate()
            .once()
            .withf(|_, hash| hash.starts_with("$argon2"))
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = serde_json::to_string(&ActivateRequest {
            token,
            password: "my_password".to_string(),
        })
        .unwrap();
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }
}
