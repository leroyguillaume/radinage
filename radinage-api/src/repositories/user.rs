use crate::{
    domain::user::UserRole,
    error::{AppError, AppResult},
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// User credentials returned from a database lookup.
pub struct UserCredentials {
    pub id: Uuid,
    pub password_hash: String,
    pub role: UserRole,
}

/// Data access interface for users.
#[cfg_attr(test, mockall::automock)]
pub trait UserRepository: Send + Sync + 'static {
    /// Fetch user credentials by username. Returns `None` if no user matches.
    fn find_by_username(
        &self,
        username: &str,
    ) -> impl std::future::Future<Output = AppResult<Option<UserCredentials>>> + Send;

    /// Insert a new user. Returns `AppError::Conflict` on duplicate username.
    fn create(
        &self,
        id: Uuid,
        username: &str,
        password_hash: &str,
        role: UserRole,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Insert a new user with an invitation token (no password yet).
    /// Returns `AppError::Conflict` on duplicate username.
    fn create_with_invitation(
        &self,
        id: Uuid,
        username: &str,
        invitation_token: Uuid,
        role: UserRole,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Find a user by invitation token. Returns `None` if no match.
    fn find_by_invitation_token(
        &self,
        token: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Option<Uuid>>> + Send;

    /// Activate a user account: set password hash and clear invitation token.
    fn activate(
        &self,
        user_id: Uuid,
        password_hash: &str,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Find a user's password hash by user ID.
    fn find_password_hash(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<String>> + Send;

    /// Update a user's password hash.
    fn change_password(
        &self,
        user_id: Uuid,
        new_password_hash: &str,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;

    /// Search for users whose username contains the given pattern (case-insensitive).
    /// Returns up to `limit` results as `(id, username)` pairs.
    fn search_by_username(
        &self,
        pattern: &str,
        limit: i64,
    ) -> impl std::future::Future<Output = AppResult<Vec<(Uuid, String)>>> + Send;

    /// Delete a user by ID. Returns `false` if the user does not exist.
    fn delete(&self, id: Uuid) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Set a reset token on an existing user, clearing the current password.
    /// Returns `false` if the username does not exist.
    fn set_reset_token(
        &self,
        username: &str,
        token: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Create an admin user if none exists yet. Returns `true` if a new admin was created.
    fn seed_admin(
        &self,
        username: &str,
        password_hash: &str,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;
}

/// PostgreSQL-backed user repository.
#[derive(Clone)]
pub struct PgUserRepository {
    pool: PgPool,
}

impl PgUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserRepository for PgUserRepository {
    async fn create_with_invitation(
        &self,
        id: Uuid,
        username: &str,
        invitation_token: Uuid,
        role: UserRole,
    ) -> AppResult<()> {
        // Store a placeholder hash that can never match any password.
        let placeholder_hash = "!not-activated";
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, role, invitation_token) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(id)
        .bind(username)
        .bind(placeholder_hash)
        .bind(role.as_str())
        .bind(invitation_token)
        .execute(&self.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.constraint() == Some("users_username_key") => {
                AppError::Conflict(format!("username '{username}' already exists"))
            }
            other => AppError::Database(other),
        })?;
        Ok(())
    }

    async fn find_by_invitation_token(&self, token: Uuid) -> AppResult<Option<Uuid>> {
        let row = sqlx::query("SELECT id FROM users WHERE invitation_token = $1")
            .bind(token)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            None => Ok(None),
            Some(r) => Ok(Some(r.try_get("id")?)),
        }
    }

    async fn activate(&self, user_id: Uuid, password_hash: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET password_hash = $1, invitation_token = NULL WHERE id = $2")
            .bind(password_hash)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_password_hash(&self, user_id: Uuid) -> AppResult<String> {
        let row = sqlx::query("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            None => Err(AppError::NotFound),
            Some(r) => Ok(r.try_get("password_hash")?),
        }
    }

    async fn change_password(&self, user_id: Uuid, new_password_hash: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
            .bind(new_password_hash)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> AppResult<bool> {
        let affected = sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(affected > 0)
    }

    async fn search_by_username(
        &self,
        pattern: &str,
        limit: i64,
    ) -> AppResult<Vec<(Uuid, String)>> {
        let like = format!("%{}%", pattern.to_lowercase());
        let rows = sqlx::query(
            "SELECT id, username FROM users WHERE LOWER(username) LIKE $1 ORDER BY username LIMIT $2",
        )
        .bind(&like)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| (r.try_get("id").unwrap(), r.try_get("username").unwrap()))
            .collect())
    }

    async fn set_reset_token(&self, username: &str, token: Uuid) -> AppResult<bool> {
        let affected = sqlx::query(
            "UPDATE users SET invitation_token = $1, password_hash = '!not-activated' \
             WHERE username = $2",
        )
        .bind(token)
        .bind(username)
        .execute(&self.pool)
        .await?
        .rows_affected();
        Ok(affected > 0)
    }

    async fn seed_admin(&self, username: &str, password_hash: &str) -> AppResult<bool> {
        let exists = sqlx::query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
            .fetch_optional(&self.pool)
            .await?;

        if exists.is_some() {
            return Ok(false);
        }

        let id = Uuid::new_v4();
        self.create(id, username, password_hash, UserRole::Admin)
            .await?;
        Ok(true)
    }

    async fn find_by_username(&self, username: &str) -> AppResult<Option<UserCredentials>> {
        let row = sqlx::query("SELECT id, password_hash, role FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            None => Ok(None),
            Some(r) => {
                let role_str: String = r.try_get("role")?;
                let role = role_str
                    .parse()
                    .map_err(|_| AppError::Internal("invalid role in database".to_string()))?;
                Ok(Some(UserCredentials {
                    id: r.try_get("id")?,
                    password_hash: r.try_get("password_hash")?,
                    role,
                }))
            }
        }
    }

    async fn create(
        &self,
        id: Uuid,
        username: &str,
        password_hash: &str,
        role: UserRole,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(username)
        .bind(password_hash)
        .bind(role.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.constraint() == Some("users_username_key") => {
                AppError::Conflict(format!("username '{username}' already exists"))
            }
            other => AppError::Database(other),
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test(migrations = "./migrations")]
    async fn find_by_username_returns_none_when_not_found(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let result = repo.find_by_username("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_and_find_user(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        repo.create(id, "alice", "hash123", UserRole::User)
            .await
            .unwrap();

        let creds = repo.find_by_username("alice").await.unwrap().unwrap();
        assert_eq!(creds.id, id);
        assert_eq!(creds.password_hash, "hash123");
        assert_eq!(creds.role, UserRole::User);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_duplicate_username_returns_conflict(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        repo.create(id1, "bob", "hash1", UserRole::User)
            .await
            .unwrap();

        let err = repo
            .create(id2, "bob", "hash2", UserRole::User)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_with_invitation_and_activate(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        let token = Uuid::new_v4();
        repo.create_with_invitation(id, "invited", token, UserRole::User)
            .await
            .unwrap();

        // User exists but cannot login (placeholder hash)
        let creds = repo.find_by_username("invited").await.unwrap().unwrap();
        assert_eq!(creds.id, id);

        // Token lookup works
        let found = repo.find_by_invitation_token(token).await.unwrap();
        assert_eq!(found, Some(id));

        // Activate sets the real password
        repo.activate(id, "real_hash").await.unwrap();
        let creds = repo.find_by_username("invited").await.unwrap().unwrap();
        assert_eq!(creds.password_hash, "real_hash");

        // Token is cleared
        let found = repo.find_by_invitation_token(token).await.unwrap();
        assert!(found.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_by_invitation_token_returns_none_for_unknown(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let result = repo.find_by_invitation_token(Uuid::new_v4()).await.unwrap();
        assert!(result.is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_with_invitation_duplicate_username_returns_conflict(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        repo.create(Uuid::new_v4(), "taken", "hash", UserRole::User)
            .await
            .unwrap();

        let err = repo
            .create_with_invitation(Uuid::new_v4(), "taken", Uuid::new_v4(), UserRole::User)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn invited_user_placeholder_hash_never_matches(pool: PgPool) {
        use crate::auth;

        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        let token = Uuid::new_v4();
        repo.create_with_invitation(id, "pending", token, UserRole::User)
            .await
            .unwrap();

        let creds = repo.find_by_username("pending").await.unwrap().unwrap();
        // The placeholder hash must not validate any password attempt
        assert!(auth::verify_password("", &creds.password_hash).is_err());
        assert!(auth::verify_password("password", &creds.password_hash).is_err());
        assert!(auth::verify_password("!not-activated", &creds.password_hash).is_err());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn full_invitation_flow_create_activate_login(pool: PgPool) {
        use crate::auth;

        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        let token = Uuid::new_v4();

        // 1. Admin creates user with invitation
        repo.create_with_invitation(id, "newuser", token, UserRole::User)
            .await
            .unwrap();

        // 2. Cannot login yet (placeholder hash)
        let creds = repo.find_by_username("newuser").await.unwrap().unwrap();
        assert!(auth::verify_password("chosen_password", &creds.password_hash).is_err());

        // 3. Activate account with chosen password
        let real_hash = auth::hash_password("chosen_password").unwrap();
        repo.activate(id, &real_hash).await.unwrap();

        // 4. Now login works
        let creds = repo.find_by_username("newuser").await.unwrap().unwrap();
        assert!(auth::verify_password("chosen_password", &creds.password_hash).unwrap());
        assert!(!auth::verify_password("wrong_password", &creds.password_hash).unwrap());

        // 5. Token is consumed, cannot activate again
        assert!(
            repo.find_by_invitation_token(token)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_user_removes_user(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        repo.create(id, "deleteme", "hash", UserRole::User)
            .await
            .unwrap();

        assert!(repo.delete(id).await.unwrap());
        assert!(repo.find_by_username("deleteme").await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_user_unknown_returns_false(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        assert!(!repo.delete(Uuid::new_v4()).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn search_by_username_returns_matching_users(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id_alice = Uuid::new_v4();
        let id_bob = Uuid::new_v4();
        let id_alicia = Uuid::new_v4();
        repo.create(id_alice, "alice", "hash", UserRole::User)
            .await
            .unwrap();
        repo.create(id_bob, "bob", "hash", UserRole::User)
            .await
            .unwrap();
        repo.create(id_alicia, "alicia", "hash", UserRole::User)
            .await
            .unwrap();

        let results = repo.search_by_username("ali", 10).await.unwrap();
        let usernames: Vec<&str> = results.iter().map(|(_, u)| u.as_str()).collect();
        assert_eq!(usernames, vec!["alice", "alicia"]);

        // Case-insensitive
        let results = repo.search_by_username("ALI", 10).await.unwrap();
        assert_eq!(results.len(), 2);

        // Limit
        let results = repo.search_by_username("ali", 1).await.unwrap();
        assert_eq!(results.len(), 1);

        // No match
        let results = repo.search_by_username("zzz", 10).await.unwrap();
        assert!(results.is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_reset_token_invalidates_password_and_enables_reactivation(pool: PgPool) {
        use crate::auth;

        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        let hash = auth::hash_password("original").unwrap();
        repo.create(id, "resetme", &hash, UserRole::User)
            .await
            .unwrap();

        // Reset generates a token and invalidates the password
        let token = Uuid::new_v4();
        assert!(repo.set_reset_token("resetme", token).await.unwrap());

        // Old password no longer works
        let creds = repo.find_by_username("resetme").await.unwrap().unwrap();
        assert!(auth::verify_password("original", &creds.password_hash).is_err());

        // Token lookup works
        assert_eq!(
            repo.find_by_invitation_token(token).await.unwrap(),
            Some(id)
        );

        // Activate with new password
        let new_hash = auth::hash_password("new_password").unwrap();
        repo.activate(id, &new_hash).await.unwrap();

        let creds = repo.find_by_username("resetme").await.unwrap().unwrap();
        assert!(auth::verify_password("new_password", &creds.password_hash).unwrap());

        // Token consumed
        assert!(
            repo.find_by_invitation_token(token)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn set_reset_token_unknown_user_returns_false(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        assert!(!repo.set_reset_token("ghost", Uuid::new_v4()).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn change_password_updates_hash(pool: PgPool) {
        use crate::auth;

        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        let original = auth::hash_password("old_pass").unwrap();
        repo.create(id, "user1", &original, UserRole::User)
            .await
            .unwrap();

        let new_hash = auth::hash_password("new_pass").unwrap();
        repo.change_password(id, &new_hash).await.unwrap();

        let creds = repo.find_by_username("user1").await.unwrap().unwrap();
        assert!(auth::verify_password("new_pass", &creds.password_hash).unwrap());
        assert!(!auth::verify_password("old_pass", &creds.password_hash).unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_password_hash_returns_hash(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        repo.create(id, "user2", "myhash", UserRole::User)
            .await
            .unwrap();

        let hash = repo.find_password_hash(id).await.unwrap();
        assert_eq!(hash, "myhash");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn find_password_hash_unknown_user_returns_not_found(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let err = repo.find_password_hash(Uuid::new_v4()).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_admin_user(pool: PgPool) {
        let repo = PgUserRepository::new(pool);
        let id = Uuid::new_v4();
        repo.create(id, "admin_user", "adminhash", UserRole::Admin)
            .await
            .unwrap();

        let creds = repo.find_by_username("admin_user").await.unwrap().unwrap();
        assert_eq!(creds.role, UserRole::Admin);
    }
}
