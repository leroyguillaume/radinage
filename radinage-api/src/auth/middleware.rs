use crate::{
    AppState, auth::hash_session_token, domain::user::UserRole, error::AppError,
    repositories::UserRepository,
};
use aide::{OperationInput, openapi};
use axum::{
    extract::{FromRequestParts, Request, State},
    http::{HeaderMap, request::Parts},
    middleware::Next,
    response::Response,
};
use axum_extra::headers::{Authorization, HeaderMapExt, authorization::Bearer};
use uuid::Uuid;

/// Authenticated user, resolved from the session by [`authenticate`].
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub role: UserRole,
}

impl AuthUser {
    pub fn require_admin(&self) -> Result<(), AppError> {
        if self.role == UserRole::Admin {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}

fn add_bearer_security(operation: &mut openapi::Operation) {
    let mut requirement = indexmap::IndexMap::new();
    requirement.insert("bearerAuth".to_string(), vec![]);
    operation.security.push(requirement);
}

impl OperationInput for AuthUser {
    fn operation_input(_: &mut aide::generate::GenContext, operation: &mut openapi::Operation) {
        add_bearer_security(operation);
    }
}

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or(AppError::Unauthorized)
    }
}

/// The bearer token of the request, whether or not it names a live session.
pub struct SessionToken(pub String);

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .typed_get::<Authorization<Bearer>>()
        .map(|Authorization(bearer)| bearer.token().to_string())
}

impl OperationInput for SessionToken {
    fn operation_input(_: &mut aide::generate::GenContext, operation: &mut openapi::Operation) {
        add_bearer_security(operation);
    }
}

impl<S: Send + Sync> FromRequestParts<S> for SessionToken {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        bearer_token(&parts.headers)
            .map(SessionToken)
            .ok_or(AppError::Unauthorized)
    }
}

/// Resolve the bearer token to the session's owner and their current role, and hand them to
/// [`AuthUser`]. A request without a live session goes through untouched: the routes that
/// require one reject it through the extractor.
pub async fn authenticate<U: UserRepository, O, B, P, C, R, A>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    if let Some(token) = bearer_token(request.headers()) {
        let session = state
            .user_repo
            .find_session_user(&hash_session_token(&token))
            .await?;
        if let Some((id, role)) = session {
            request.extensions_mut().insert(AuthUser { id, role });
        }
    }
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::{MockBudgetRepository, MockOperationRepository};
    use crate::{
        repositories::MockUserRepository,
        test_util::{TestState, auth_header, json_request, make_test_state},
    };
    use axum::{Router, http::StatusCode, middleware::from_fn_with_state, routing::get};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use tower::ServiceExt;

    async fn admin_only(user: AuthUser) -> Result<StatusCode, AppError> {
        user.require_admin()?;
        Ok(StatusCode::NO_CONTENT)
    }

    fn admin_router(state: TestState) -> Router {
        Router::new()
            .route("/admin", get(admin_only))
            .layer(from_fn_with_state(state, authenticate))
    }

    async fn status(app: &Router, auth: Option<&str>) -> StatusCode {
        app.clone()
            .oneshot(json_request("GET", "/admin", None, auth))
            .await
            .unwrap()
            .status()
    }

    fn state_with(user_repo: MockUserRepository) -> TestState {
        make_test_state(
            user_repo,
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        )
    }

    #[tokio::test]
    async fn live_session_authenticates_its_owner() {
        let app = admin_router(state_with(MockUserRepository::new()));
        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);

        assert_eq!(status(&app, Some(&auth)).await, StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn missing_token_is_unauthorized() {
        let app = admin_router(state_with(MockUserRepository::new()));

        assert_eq!(status(&app, None).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn revoked_or_expired_session_is_unauthorized() {
        let mut repo = MockUserRepository::new();
        repo.expect_find_session_user()
            .once()
            .returning(|_| Box::pin(async { Ok(None) }));
        let app = admin_router(state_with(repo));

        let auth = auth_header(Uuid::new_v4(), UserRole::Admin);
        assert_eq!(status(&app, Some(&auth)).await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_is_looked_up_by_its_hash() {
        let mut repo = MockUserRepository::new();
        repo.expect_find_session_user()
            .withf(|hash| hash == hash_session_token("opaque").as_slice())
            .once()
            .returning(|_| Box::pin(async { Ok(Some((Uuid::new_v4(), UserRole::Admin))) }));
        let app = admin_router(state_with(repo));

        assert_eq!(
            status(&app, Some("Bearer opaque")).await,
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn role_change_takes_effect_on_the_next_request() {
        let demoted = Arc::new(AtomicBool::new(false));
        let mut repo = MockUserRepository::new();
        let flag = demoted.clone();
        repo.expect_find_session_user()
            .times(2)
            .returning(move |_| {
                let role = if flag.load(Ordering::SeqCst) {
                    UserRole::User
                } else {
                    UserRole::Admin
                };
                Box::pin(async move { Ok(Some((Uuid::nil(), role))) })
            });
        let app = admin_router(state_with(repo));

        assert_eq!(
            status(&app, Some("Bearer session")).await,
            StatusCode::NO_CONTENT
        );
        demoted.store(true, Ordering::SeqCst);
        assert_eq!(
            status(&app, Some("Bearer session")).await,
            StatusCode::FORBIDDEN
        );
    }
}
