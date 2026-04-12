use crate::domain::user::UserRole;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// JWT claims payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtClaims {
    /// Subject: user id
    pub sub: Uuid,
    /// Expiration (unix timestamp)
    pub exp: usize,
    /// Role
    pub role: UserRole,
}
