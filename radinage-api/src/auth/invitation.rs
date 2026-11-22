use crate::{
    auth::{generate_session_token, hash_session_token},
    error::AppResult,
};
use chrono::{DateTime, Utc};
use std::time::Duration;

/// A freshly issued invitation: the token goes into the link, only its hash is stored.
pub struct IssuedInvitation {
    pub token: String,
    pub token_hash: Vec<u8>,
    pub expires_at: DateTime<Utc>,
}

/// Issue an invitation token, as random as a session token, valid for `ttl`.
pub fn issue(ttl: Duration) -> AppResult<IssuedInvitation> {
    let token = generate_session_token()?;
    Ok(IssuedInvitation {
        token_hash: hash_token(&token),
        token,
        expires_at: Utc::now() + ttl,
    })
}

/// The digest under which an invitation token is stored and looked up, the same as a session's.
pub fn hash_token(token: &str) -> Vec<u8> {
    hash_session_token(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: Duration = Duration::from_secs(3600);

    #[test]
    fn issued_tokens_are_unique() {
        let a = issue(HOUR).unwrap();
        let b = issue(HOUR).unwrap();
        assert_ne!(a.token, b.token);
        assert_ne!(a.token_hash, b.token_hash);
    }

    #[test]
    fn issued_hash_matches_token_hash() {
        let invitation = issue(HOUR).unwrap();
        assert_eq!(invitation.token_hash, hash_token(&invitation.token));
        assert_ne!(invitation.token_hash, invitation.token.as_bytes());
    }

    #[test]
    fn issued_invitation_expires_after_ttl() {
        let before = Utc::now();
        let invitation = issue(2 * HOUR).unwrap();
        let after = Utc::now();
        assert!(invitation.expires_at >= before + 2 * HOUR);
        assert!(invitation.expires_at <= after + 2 * HOUR);
    }
}
