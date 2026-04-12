use crate::{auth::claims::JwtClaims, config::Config, domain::user::UserRole, error::AppError};
use aide::OperationInput;
use aide::openapi;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};
use axum_extra::{
    TypedHeader,
    headers::{Authorization, authorization::Bearer},
};
use jsonwebtoken::{DecodingKey, Validation, decode};
use uuid::Uuid;

/// Authenticated user injected by the Axum extractor.
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

impl OperationInput for AuthUser {
    fn operation_input(ctx: &mut aide::generate::GenContext, operation: &mut openapi::Operation) {
        let _ = ctx;
        let mut requirement = indexmap::IndexMap::new();
        requirement.insert("bearerAuth".to_string(), vec![]);
        operation.security.push(requirement);
    }
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    Config: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let config = Config::from_ref(state);
        let TypedHeader(Authorization(bearer)) =
            TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, state)
                .await
                .map_err(|_| AppError::Unauthorized)?;

        let key = DecodingKey::from_secret(config.jwt_secret.as_bytes());
        let token_data = decode::<JwtClaims>(bearer.token(), &key, &Validation::default())
            .map_err(|_| AppError::Unauthorized)?;

        Ok(AuthUser {
            id: token_data.claims.sub,
            role: token_data.claims.role,
        })
    }
}
