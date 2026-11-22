use crate::{
    AppState,
    auth::{self, middleware::SessionToken},
    domain::user::UserRole,
    error::{AppError, AppResult},
    repositories::UserRepository,
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::Utc;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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
    /// Opaque session token to send as a Bearer token in the `Authorization` header of
    /// subsequent requests, until it expires or is revoked.
    pub token: String,
    /// The role granted to the authenticated user.
    pub role: UserRole,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivateRequest {
    /// The invitation token received in the shareable link.
    pub token: String,
    /// The password the user wants to set for their account.
    pub password: String,
}

/// Response returned after successful account activation.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivateResponse {
    /// Opaque session token for immediate authentication after activation.
    pub token: String,
    /// The role granted to the activated user.
    pub role: UserRole,
}

pub async fn activate<U: UserRepository, O, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    Json(body): Json<ActivateRequest>,
) -> AppResult<(StatusCode, Json<ActivateResponse>)> {
    let user_id = state
        .user_repo
        .find_by_invitation_token(&auth::invitation::hash_token(&body.token))
        .await?
        .filter(|invitation| invitation.expires_at > Utc::now())
        .map(|invitation| invitation.user_id)
        .ok_or(AppError::NotFound)?;

    let password_hash = auth::hash_password(&body.password)?;
    state.user_repo.activate(user_id, &password_hash).await?;

    let token = auth::open_session(&state.user_repo, &state.config, user_id).await?;
    Ok((
        StatusCode::OK,
        Json(ActivateResponse {
            token,
            role: UserRole::User,
        }),
    ))
}

pub async fn login<U: UserRepository, O, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
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

    let token = auth::open_session(&state.user_repo, &state.config, creds.id).await?;
    Ok(Json(LoginResponse {
        token,
        role: creds.role,
    }))
}

pub async fn logout<U: UserRepository, O, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    SessionToken(token): SessionToken,
) -> AppResult<StatusCode> {
    state
        .user_repo
        .delete_session(&auth::hash_session_token(&token))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        repositories::{
            MockBudgetRepository, MockOperationRepository, MockUserRepository, PendingInvitation,
            UserCredentials,
        },
        test_util::{build_test_router, json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use chrono::{DateTime, TimeDelta};
    use tower::ServiceExt;
    use uuid::Uuid;

    const TOKEN: &str = "invitation-token";

    /// A user repository holding one invitation for `TOKEN`, expiring at `expires_at`.
    fn repo_with_invitation(user_id: Uuid, expires_at: DateTime<Utc>) -> MockUserRepository {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_invitation_token()
            .once()
            .withf(|hash| hash == auth::invitation::hash_token(TOKEN).as_slice())
            .returning(move |_| {
                Box::pin(async move {
                    Ok(Some(PendingInvitation {
                        user_id,
                        expires_at,
                    }))
                })
            });
        user_repo
    }

    fn activate_json(token: &str, password: &str) -> String {
        serde_json::to_string(&ActivateRequest {
            token: token.to_string(),
            password: password.to_string(),
        })
        .unwrap()
    }

    fn make_credentials(role: UserRole) -> UserCredentials {
        let hash = auth::hash_password("correct_pass").unwrap();
        UserCredentials {
            id: Uuid::new_v4(),
            password_hash: hash,
            role,
        }
    }

    fn expect_session(repo: &mut MockUserRepository, owner: Uuid) {
        repo.expect_create_session()
            .withf(move |hash, user_id, _| hash.len() == 32 && *user_id == owner)
            .once()
            .returning(|_, _, _| Box::pin(async { Ok(()) }));
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
        let owner = creds.id;
        let mut user_repo = MockUserRepository::new();
        expect_session(&mut user_repo, owner);
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
    async fn activate_with_valid_token_sets_password_and_returns_token() {
        let user_id = Uuid::new_v4();

        let mut user_repo = repo_with_invitation(user_id, Utc::now() + TimeDelta::hours(1));
        expect_session(&mut user_repo, user_id);
        user_repo
            .expect_activate()
            .once()
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = activate_json(TOKEN, "newpass123");
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

        let body = activate_json("unknown-token", "pass");
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn activate_with_expired_token_returns_not_found() {
        let mut user_repo =
            repo_with_invitation(Uuid::new_v4(), Utc::now() - TimeDelta::seconds(1));
        user_repo.expect_activate().never();

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = activate_json(TOKEN, "newpass123");
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn login_admin_role_preserved_in_token() {
        let creds = make_credentials(UserRole::Admin);
        let owner = creds.id;
        let mut user_repo = MockUserRepository::new();
        expect_session(&mut user_repo, owner);
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
    async fn activate_with_invalid_json_returns_error() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = r#"{"token": 42, "password": "p"}"#;
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

        let mut user_repo = repo_with_invitation(user_id, Utc::now() + TimeDelta::hours(1));
        expect_session(&mut user_repo, user_id);
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

        let body = activate_json(TOKEN, "my_password");
        let req = json_request("POST", "/auth/activate", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn logout_deletes_the_session_of_the_token() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_delete_session()
            .withf(|hash| hash == auth::hash_session_token("my-token").as_slice())
            .once()
            .returning(|_| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let req = json_request("DELETE", "/auth/session", None, Some("Bearer my-token"));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn logout_without_token_returns_unauthorized() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let req = json_request("DELETE", "/auth/session", None, None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
