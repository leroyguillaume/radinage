use crate::{
    AppState, auth,
    auth::middleware::AuthUser,
    domain::user::UserRole,
    error::{AppError, AppResult},
    repositories::UserRepository,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    /// Unique login name for the new user.
    pub username: String,
    /// Plain-text password (will be hashed before storage).
    /// When omitted, an invitation link is generated instead.
    pub password: Option<String>,
}

/// Representation of a user account.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    /// Unique identifier of the user.
    pub id: Uuid,
    /// Login name of the user.
    pub username: String,
    /// Role granted to the user (`admin` or `user`).
    pub role: UserRole,
    /// Shareable invitation link (only present when the user was created without a password).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation_link: Option<String>,
}

fn build_invitation_link(webapp_url: &str, token: Uuid) -> String {
    let base = webapp_url.trim_end_matches('/');
    format!("{base}/activate?token={token}")
}

pub async fn create_user<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<UserResponse>)> {
    auth_user.require_admin()?;

    let id = Uuid::new_v4();

    let invitation_link = match body.password {
        Some(ref password) => {
            let password_hash = auth::hash_password(password)?;
            state
                .user_repo
                .create(id, &body.username, &password_hash, UserRole::User)
                .await?;
            None
        }
        None => {
            let token = Uuid::new_v4();
            state
                .user_repo
                .create_with_invitation(id, &body.username, token, UserRole::User)
                .await?;
            Some(build_invitation_link(&state.config.webapp_url, token))
        }
    };

    Ok((
        StatusCode::CREATED,
        Json(UserResponse {
            id,
            username: body.username,
            role: UserRole::User,
            invitation_link,
        }),
    ))
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchUsersParams {
    /// Username search pattern (case-insensitive substring match).
    pub q: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchUserEntry {
    pub id: Uuid,
    pub username: String,
}

pub async fn search_users<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Query(params): Query<SearchUsersParams>,
) -> AppResult<Json<Vec<SearchUserEntry>>> {
    auth_user.require_admin()?;

    let results = state.user_repo.search_by_username(&params.q, 10).await?;

    // Exclude the requesting admin from results
    let entries = results
        .into_iter()
        .filter(|(id, _)| *id != auth_user.id)
        .map(|(id, username)| SearchUserEntry { id, username })
        .collect();

    Ok(Json(entries))
}

/// Request body for resetting a user's password.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
    /// The username of the account to reset.
    pub username: String,
}

/// Response returned when a password reset link is generated.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordResponse {
    /// Shareable link for the user to set a new password.
    pub reset_link: String,
}

pub async fn reset_password<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<ResetPasswordRequest>,
) -> AppResult<Json<ResetPasswordResponse>> {
    auth_user.require_admin()?;

    // Prevent resetting own password
    let target = state
        .user_repo
        .find_by_username(&body.username)
        .await?
        .ok_or(AppError::NotFound)?;
    if target.id == auth_user.id {
        return Err(AppError::BadRequest(
            "cannot reset your own password".to_string(),
        ));
    }

    let token = Uuid::new_v4();
    let found = state
        .user_repo
        .set_reset_token(&body.username, token)
        .await?;
    if !found {
        return Err(AppError::NotFound);
    }

    let base = state.config.webapp_url.trim_end_matches('/');
    Ok(Json(ResetPasswordResponse {
        reset_link: format!("{base}/activate?token={token}&reset=true"),
    }))
}

pub async fn delete_user<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    auth_user.require_admin()?;

    if id == auth_user.id {
        return Err(AppError::BadRequest(
            "cannot delete your own account".to_string(),
        ));
    }

    let found = state.user_repo.delete(id).await?;
    if !found {
        return Err(AppError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    /// The user's current password for verification.
    pub current_password: String,
    /// The new password to set.
    pub new_password: String,
}

pub async fn change_password<U: UserRepository, O, B>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    Json(body): Json<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    let current_hash = state.user_repo.find_password_hash(auth_user.id).await?;

    if !auth::verify_password(&body.current_password, &current_hash).unwrap_or(false) {
        return Err(AppError::BadRequest(
            "incorrect current password".to_string(),
        ));
    }

    let new_hash = auth::hash_password(&body.new_password)?;
    state
        .user_repo
        .change_password(auth_user.id, &new_hash)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        repositories::{
            MockBudgetRepository, MockOperationRepository, MockUserRepository, UserCredentials,
        },
        test_util::{auth_header, build_test_router, json_request, make_test_state, response_json},
    };
    use tower::ServiceExt;

    fn create_user_json(username: &str, password: Option<&str>) -> String {
        serde_json::to_string(&CreateUserRequest {
            username: username.to_string(),
            password: password.map(String::from),
        })
        .unwrap()
    }

    #[tokio::test]
    async fn create_user_with_password_returns_created_response() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_create()
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let admin_id = Uuid::new_v4();
        let auth = auth_header(admin_id, UserRole::Admin);
        let body = create_user_json("newuser", Some("pass123"));
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: UserResponse = response_json(resp).await;
        assert_eq!(json.username, "newuser");
        assert_eq!(json.role, UserRole::User);
        assert!(json.invitation_link.is_none());
    }

    #[tokio::test]
    async fn create_user_without_password_returns_invitation_link() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_create_with_invitation()
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let admin_id = Uuid::new_v4();
        let auth = auth_header(admin_id, UserRole::Admin);
        let body = create_user_json("newuser", None);
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: UserResponse = response_json(resp).await;
        assert_eq!(json.username, "newuser");
        assert!(json.invitation_link.is_some());
        let link = json.invitation_link.unwrap();
        assert!(link.starts_with("http://localhost:5173/activate?token="));
    }

    #[tokio::test]
    async fn create_user_propagates_conflict_error() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_create()
            .once()
            .returning(|_, username, _, _| {
                let msg = format!("username '{username}' already exists");
                Box::pin(async { Err(AppError::Conflict(msg)) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        let body = create_user_json("existing", Some("pass"));
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_user_forbidden_for_non_admin() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let body = create_user_json("newuser", Some("pass"));
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn build_invitation_link_format() {
        let token = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let link = build_invitation_link("https://app.example.com", token);
        assert_eq!(
            link,
            "https://app.example.com/activate?token=550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[test]
    fn build_invitation_link_strips_trailing_slash() {
        let token = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let link = build_invitation_link("https://app.example.com/", token);
        assert_eq!(
            link,
            "https://app.example.com/activate?token=550e8400-e29b-41d4-a716-446655440000"
        );
    }

    #[tokio::test]
    async fn create_user_invitation_conflict_returns_conflict() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_create_with_invitation()
            .once()
            .returning(|_, username, _, _| {
                let msg = format!("username '{username}' already exists");
                Box::pin(async { Err(AppError::Conflict(msg)) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        let body = create_user_json("existing", None);
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_user_without_password_forbidden_for_non_admin() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let body = create_user_json("newuser", None);
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn create_user_without_auth_returns_unauthorized() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = create_user_json("newuser", Some("pass"));
        let req = json_request("POST", "/users", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_user_with_password_omits_invitation_link_from_json() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_create()
            .once()
            .returning(|_, _, _, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        let body = create_user_json("newuser", Some("pass123"));
        let req = json_request("POST", "/users", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            raw.get("invitationLink").is_none(),
            "invitationLink should not be present in JSON when password is set"
        );
    }

    fn reset_password_json(username: &str) -> String {
        serde_json::to_string(&ResetPasswordRequest {
            username: username.to_string(),
        })
        .unwrap()
    }

    #[tokio::test]
    async fn reset_password_returns_link() {
        let admin_id = Uuid::new_v4();
        let target_id = Uuid::new_v4();
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(move |_| {
                Box::pin(async move {
                    Ok(Some(UserCredentials {
                        id: target_id,
                        password_hash: "hash".to_string(),
                        role: UserRole::User,
                    }))
                })
            });
        user_repo
            .expect_set_reset_token()
            .once()
            .returning(|_, _| Box::pin(async { Ok(true) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(admin_id, UserRole::Admin);
        let body = reset_password_json("alice");
        let req = json_request("POST", "/users/reset-password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ResetPasswordResponse = response_json(resp).await;
        assert!(
            json.reset_link
                .starts_with("http://localhost:5173/activate?token=")
        );
        assert!(json.reset_link.ends_with("&reset=true"));
    }

    #[tokio::test]
    async fn reset_password_unknown_user_returns_not_found() {
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

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        let body = reset_password_json("nobody");
        let req = json_request("POST", "/users/reset-password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn reset_password_self_returns_bad_request() {
        let admin_id = Uuid::new_v4();
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_find_by_username()
            .once()
            .returning(move |_| {
                Box::pin(async move {
                    Ok(Some(UserCredentials {
                        id: admin_id,
                        password_hash: "hash".to_string(),
                        role: UserRole::Admin,
                    }))
                })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(admin_id, UserRole::Admin);
        let body = reset_password_json("myadmin");
        let req = json_request("POST", "/users/reset-password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn reset_password_forbidden_for_non_admin() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let body = reset_password_json("alice");
        let req = json_request("POST", "/users/reset-password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn reset_password_without_auth_returns_unauthorized() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = reset_password_json("alice");
        let req = json_request("POST", "/users/reset-password", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn search_users_returns_results_excluding_self() {
        let admin_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_search_by_username()
            .once()
            .returning(move |_, _| {
                Box::pin(async move {
                    Ok(vec![
                        (admin_id, "admin".to_string()),
                        (user_id, "alice".to_string()),
                    ])
                })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(admin_id, UserRole::Admin);
        let req = json_request("GET", "/users?q=a", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: Vec<SearchUserEntry> = response_json(resp).await;
        assert_eq!(json.len(), 1);
        assert_eq!(json[0].username, "alice");
    }

    #[tokio::test]
    async fn search_users_forbidden_for_non_admin() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request("GET", "/users?q=a", None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    fn change_password_json(current: &str, new: &str) -> String {
        serde_json::to_string(&ChangePasswordRequest {
            current_password: current.to_string(),
            new_password: new.to_string(),
        })
        .unwrap()
    }

    #[tokio::test]
    async fn delete_user_returns_no_content() {
        let admin_id = Uuid::new_v4();
        let target_id = Uuid::new_v4();
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_delete()
            .once()
            .returning(|_| Box::pin(async { Ok(true) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(admin_id, UserRole::Admin);
        let req = json_request("DELETE", &format!("/users/{target_id}"), None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn delete_user_unknown_returns_not_found() {
        let mut user_repo = MockUserRepository::new();
        user_repo
            .expect_delete()
            .once()
            .returning(|_| Box::pin(async { Ok(false) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        let req = json_request(
            "DELETE",
            &format!("/users/{}", Uuid::new_v4()),
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_user_self_returns_bad_request() {
        let admin_id = Uuid::new_v4();
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(admin_id, UserRole::Admin);
        let req = json_request("DELETE", &format!("/users/{admin_id}"), None, Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn delete_user_forbidden_for_non_admin() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let req = json_request(
            "DELETE",
            &format!("/users/{}", Uuid::new_v4()),
            None,
            Some(&auth),
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn delete_user_without_auth_returns_unauthorized() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let req = json_request("DELETE", &format!("/users/{}", Uuid::new_v4()), None, None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn change_password_with_correct_current_returns_no_content() {
        let user_id = Uuid::new_v4();
        let current_hash = auth::hash_password("old_pass").unwrap();

        let mut user_repo = MockUserRepository::new();
        let hash = current_hash.clone();
        user_repo
            .expect_find_password_hash()
            .once()
            .returning(move |_| {
                let h = hash.clone();
                Box::pin(async move { Ok(h) })
            });
        user_repo
            .expect_change_password()
            .once()
            .withf(|_, hash| hash.starts_with("$argon2"))
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = change_password_json("old_pass", "new_pass");
        let req = json_request("PUT", "/users/me/password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn change_password_with_wrong_current_returns_bad_request() {
        let user_id = Uuid::new_v4();
        let current_hash = auth::hash_password("real_pass").unwrap();

        let mut user_repo = MockUserRepository::new();
        let hash = current_hash.clone();
        user_repo
            .expect_find_password_hash()
            .once()
            .returning(move |_| {
                let h = hash.clone();
                Box::pin(async move { Ok(h) })
            });

        let app = build_test_router(make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let auth = auth_header(user_id, UserRole::User);
        let body = change_password_json("wrong_pass", "new_pass");
        let req = json_request("PUT", "/users/me/password", Some(&body), Some(&auth));
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn change_password_without_auth_returns_unauthorized() {
        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));

        let body = change_password_json("old", "new");
        let req = json_request("PUT", "/users/me/password", Some(&body), None);
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}
