pub mod claims;
pub mod middleware;

use crate::{
    auth::claims::JwtClaims,
    domain::user::UserRole,
    error::{AppError, AppResult},
};
use argon2::password_hash::{SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use jsonwebtoken::{EncodingKey, Header, encode};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("password hash error: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("invalid password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Decode a JWT and return the claims (for testing only).
#[cfg(test)]
pub fn decode_token(
    jwt_secret: &str,
    token: &str,
) -> Result<crate::auth::claims::JwtClaims, jsonwebtoken::errors::Error> {
    let key = jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_bytes());
    jsonwebtoken::decode::<crate::auth::claims::JwtClaims>(
        token,
        &key,
        &jsonwebtoken::Validation::default(),
    )
    .map(|d| d.claims)
}

/// Generate a JWT using only the config values (no AppState required).
pub fn generate_token_from_config(
    config: &crate::config::Config,
    user_id: Uuid,
    role: UserRole,
) -> AppResult<String> {
    let expiration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + config.jwt_expiration_secs;

    let claims = JwtClaims {
        sub: user_id,
        exp: expiration as usize,
        role,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("JWT encode error: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::user::UserRole;
    use crate::test_util::make_test_config;

    #[test]
    fn hash_and_verify_correct_password() {
        let hash = hash_password("my_password").unwrap();
        assert!(verify_password("my_password", &hash).unwrap());
    }

    #[test]
    fn verify_wrong_password_returns_false() {
        let hash = hash_password("correct_password").unwrap();
        assert!(!verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn verify_invalid_hash_returns_error() {
        let result = verify_password("password", "not-a-valid-hash");
        assert!(result.is_err());
    }

    #[test]
    fn hash_is_different_each_call() {
        let h1 = hash_password("same_password").unwrap();
        let h2 = hash_password("same_password").unwrap();
        // Argon2 uses a random salt per hash, so hashes must differ
        assert_ne!(h1, h2);
    }

    #[test]
    fn generate_token_produces_decodable_jwt() {
        let config = make_test_config();
        let user_id = Uuid::new_v4();
        let token = generate_token_from_config(&config, user_id, UserRole::Admin).unwrap();
        let claims = decode_token(&config.jwt_secret, &token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.role, UserRole::Admin);
    }

    #[test]
    fn generate_token_user_role() {
        let config = make_test_config();
        let user_id = Uuid::new_v4();
        let token = generate_token_from_config(&config, user_id, UserRole::User).unwrap();
        let claims = decode_token(&config.jwt_secret, &token).unwrap();
        assert_eq!(claims.role, UserRole::User);
    }

    #[test]
    fn token_with_wrong_secret_fails_decode() {
        let config = make_test_config();
        let token = generate_token_from_config(&config, Uuid::new_v4(), UserRole::User).unwrap();
        assert!(decode_token("completely-different-secret-key!!", &token).is_err());
    }
}
