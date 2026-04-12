use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The role of a user, determining their access level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[schemars(transform = crate::schema::flatten_string_enum)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    /// Full access, including user management.
    Admin,
    /// Standard access to own data only.
    User,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserRole::Admin => "admin",
            UserRole::User => "user",
        }
    }
}

impl std::fmt::Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for UserRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin" => Ok(UserRole::Admin),
            "user" => Ok(UserRole::User),
            other => Err(format!("unknown role: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_str_roundtrips() {
        assert_eq!(UserRole::Admin.as_str(), "admin");
        assert_eq!(UserRole::User.as_str(), "user");
    }

    #[test]
    fn from_str_valid() {
        assert_eq!("admin".parse::<UserRole>().unwrap(), UserRole::Admin);
        assert_eq!("user".parse::<UserRole>().unwrap(), UserRole::User);
    }

    #[test]
    fn from_str_invalid() {
        assert!("superuser".parse::<UserRole>().is_err());
        assert!("".parse::<UserRole>().is_err());
    }

    #[test]
    fn display_matches_as_str() {
        assert_eq!(UserRole::Admin.to_string(), "admin");
        assert_eq!(UserRole::User.to_string(), "user");
    }
}
