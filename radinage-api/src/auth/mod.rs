pub mod invitation;
pub mod middleware;

use crate::{
    config::Config,
    error::{AppError, AppResult},
    repositories::UserRepository,
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn hash_password(password: &str) -> AppResult<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
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

/// A new session token: 256 bits from the operating system's CSPRNG, base64url-encoded.
pub fn generate_session_token() -> AppResult<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| AppError::Internal(format!("random generator error: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// The SHA-256 digest under which a session token is stored and looked up.
pub fn hash_session_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Open a session for a user and return its token, which only the caller ever sees.
pub async fn open_session(
    user_repo: &impl UserRepository,
    config: &Config,
    user_id: Uuid,
) -> AppResult<String> {
    let token = generate_session_token()?;
    let expires_at = chrono::Utc::now() + config.session_lifetime();
    user_repo
        .create_session(&hash_session_token(&token), user_id, expires_at)
        .await?;
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{repositories::MockUserRepository, test_util::make_test_config};

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
    fn session_token_carries_256_random_bits() {
        let token = generate_session_token().unwrap();
        assert_eq!(URL_SAFE_NO_PAD.decode(&token).unwrap().len(), 32);
        assert_ne!(token, generate_session_token().unwrap());
    }

    #[test]
    fn session_token_hash_is_its_sha256() {
        let hash = hash_session_token("abc");
        assert_eq!(
            URL_SAFE_NO_PAD.encode(&hash),
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
    }

    #[tokio::test]
    async fn open_session_stores_only_the_token_hash_until_the_lifetime_ends() {
        let config = make_test_config();
        let user_id = Uuid::new_v4();
        let before = chrono::Utc::now();
        let stored = std::sync::Arc::new(std::sync::Mutex::new(None));

        let mut repo = MockUserRepository::new();
        let sink = stored.clone();
        repo.expect_create_session()
            .once()
            .returning(move |hash, owner, expires_at| {
                *sink.lock().unwrap() = Some((hash.to_vec(), owner, expires_at));
                Box::pin(async { Ok(()) })
            });

        let token = open_session(&repo, &config, user_id).await.unwrap();

        let (hash, owner, expires_at) = stored.lock().unwrap().take().unwrap();
        assert_eq!(hash, hash_session_token(&token));
        assert_eq!(owner, user_id);
        assert!(expires_at >= before + config.session_lifetime());
        assert!(expires_at <= chrono::Utc::now() + config.session_lifetime());
    }
}
