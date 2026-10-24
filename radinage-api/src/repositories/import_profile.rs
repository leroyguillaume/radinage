use crate::{
    domain::import_profile::{ImportProfile, ImportProfileFields},
    error::{AppError, AppResult},
};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

const COLUMNS: &str = "id, user_id, name, account_id, label_col, label_fallback_col, amount_col, date_col, date_format, skip_lines, \
     csv_delimiter, last_used_at, created_at";

/// Data access interface for import profiles.
#[cfg_attr(test, mockall::automock)]
pub trait ImportProfileRepository: Send + Sync + 'static {
    /// All profiles of a user, most recently used first, never-used ones last by name.
    fn list(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<ImportProfile>>> + Send;

    /// Number of profiles a user has.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// Create a profile. Returns `AppError::Conflict` if the user already has one by that name.
    fn create(
        &self,
        user_id: Uuid,
        fields: &ImportProfileFields,
    ) -> impl std::future::Future<Output = AppResult<ImportProfile>> + Send;

    /// Replace a profile's fields. Returns `None` if it does not exist or belongs to another
    /// user, `AppError::Conflict` if the new name is taken.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &ImportProfileFields,
    ) -> impl std::future::Future<Output = AppResult<Option<ImportProfile>>> + Send;

    /// Delete a profile. Returns `false` if it does not exist or belongs to another user.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Record that an import just used the profile; a no-op if it is not the user's.
    fn mark_used(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<()>> + Send;
}

/// PostgreSQL-backed import profile repository.
#[derive(Clone)]
pub struct PgImportProfileRepository {
    pool: PgPool,
}

impl PgImportProfileRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn to_db(value: usize) -> AppResult<i32> {
    i32::try_from(value).map_err(|_| AppError::BadRequest(format!("{value} is too large")))
}

fn optional_to_db(value: Option<usize>) -> AppResult<Option<i32>> {
    value.map(to_db).transpose()
}

fn column_index(column: &str, value: i32) -> AppResult<usize> {
    usize::try_from(value).map_err(|_| AppError::Internal(format!("negative {column}: {value}")))
}

fn from_db(row: &PgRow, column: &str) -> AppResult<usize> {
    column_index(column, row.try_get(column)?)
}

fn optional_from_db(row: &PgRow, column: &str) -> AppResult<Option<usize>> {
    let value: Option<i32> = row.try_get(column)?;
    value.map(|v| column_index(column, v)).transpose()
}

fn row_to_profile(row: &PgRow) -> AppResult<ImportProfile> {
    Ok(ImportProfile {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: ImportProfileFields {
            name: row.try_get("name")?,
            account_id: row.try_get("account_id")?,
            label_col: from_db(row, "label_col")?,
            label_fallback_col: optional_from_db(row, "label_fallback_col")?,
            amount_col: from_db(row, "amount_col")?,
            date_col: from_db(row, "date_col")?,
            date_format: row.try_get("date_format")?,
            skip_lines: from_db(row, "skip_lines")?,
            csv_delimiter: row
                .try_get::<&str, _>("csv_delimiter")?
                .parse()
                .map_err(AppError::Internal)?,
        },
        last_used_at: row.try_get("last_used_at")?,
        created_at: row.try_get("created_at")?,
    })
}

fn map_name_conflict(e: sqlx::Error, name: &str) -> AppError {
    match e {
        sqlx::Error::Database(ref db)
            if db.constraint() == Some("import_profiles_user_name_key") =>
        {
            AppError::Conflict(format!("import profile '{name}' already exists"))
        }
        other => AppError::Database(other),
    }
}

impl ImportProfileRepository for PgImportProfileRepository {
    async fn list(&self, user_id: Uuid) -> AppResult<Vec<ImportProfile>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLUMNS} FROM import_profiles WHERE user_id = $1 \
             ORDER BY last_used_at DESC NULLS LAST, name"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_profile).collect()
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM import_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("n")?)
    }

    async fn create(
        &self,
        user_id: Uuid,
        fields: &ImportProfileFields,
    ) -> AppResult<ImportProfile> {
        let row = sqlx::query(&format!(
            "INSERT INTO import_profiles \
             (user_id, name, label_col, amount_col, date_col, date_format, skip_lines, \
             csv_delimiter, account_id, label_fallback_col) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING {COLUMNS}"
        ))
        .bind(user_id)
        .bind(&fields.name)
        .bind(to_db(fields.label_col)?)
        .bind(to_db(fields.amount_col)?)
        .bind(to_db(fields.date_col)?)
        .bind(&fields.date_format)
        .bind(to_db(fields.skip_lines)?)
        .bind(fields.csv_delimiter.as_str())
        .bind(fields.account_id)
        .bind(optional_to_db(fields.label_fallback_col)?)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        row_to_profile(&row)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &ImportProfileFields,
    ) -> AppResult<Option<ImportProfile>> {
        let row = sqlx::query(&format!(
            "UPDATE import_profiles SET name = $3, label_col = $4, amount_col = $5, \
             date_col = $6, date_format = $7, skip_lines = $8, csv_delimiter = $9, \
             account_id = $10, label_fallback_col = $11 \
             WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
        ))
        .bind(id)
        .bind(user_id)
        .bind(&fields.name)
        .bind(to_db(fields.label_col)?)
        .bind(to_db(fields.amount_col)?)
        .bind(to_db(fields.date_col)?)
        .bind(&fields.date_format)
        .bind(to_db(fields.skip_lines)?)
        .bind(fields.csv_delimiter.as_str())
        .bind(fields.account_id)
        .bind(optional_to_db(fields.label_fallback_col)?)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        row.as_ref().map(row_to_profile).transpose()
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM import_profiles WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn mark_used(&self, id: Uuid, user_id: Uuid) -> AppResult<()> {
        sqlx::query(
            "UPDATE import_profiles SET last_used_at = now() WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{import_profile::CsvDelimiter, user::UserRole},
        repositories::{PgUserRepository, UserRepository},
    };

    /// A user with one imported checking account sharing its id.
    async fn make_user(pool: &PgPool, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        PgUserRepository::new(pool.clone())
            .create(id, username, "hash", UserRole::User)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO accounts (id, user_id, name, kind, imported) \
             VALUES ($1, $1, 'Main', 'checking', TRUE)",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    fn fields(account_id: Uuid, name: &str) -> ImportProfileFields {
        ImportProfileFields {
            name: name.to_string(),
            account_id,
            label_col: 1,
            label_fallback_col: None,
            amount_col: 3,
            date_col: 0,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1,
            csv_delimiter: CsvDelimiter::Comma,
        }
    }

    async fn only(repo: &PgImportProfileRepository, user_id: Uuid) -> ImportProfile {
        let mut profiles = repo.list(user_id).await.unwrap();
        assert_eq!(profiles.len(), 1);
        profiles.remove(0)
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_then_list_per_user(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);

        let created = repo.create(alice, &fields(alice, "Bank")).await.unwrap();

        assert_eq!(created.fields, fields(alice, "Bank"));
        assert_eq!(created.last_used_at, None);
        assert_eq!(only(&repo, alice).await, created);
        assert!(repo.list(bob).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_profile_cannot_point_at_another_users_account(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);

        assert!(repo.create(alice, &fields(bob, "Bank")).await.is_err());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn duplicate_name_is_a_conflict_per_user(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);

        repo.create(alice, &fields(alice, "Bank")).await.unwrap();

        assert!(matches!(
            repo.create(alice, &fields(alice, "Bank")).await,
            Err(AppError::Conflict(_))
        ));
        repo.create(bob, &fields(bob, "Bank")).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn list_orders_by_last_use_then_name(pool: PgPool) {
        let user_id = make_user(&pool, "alice").await;
        let repo = PgImportProfileRepository::new(pool);

        repo.create(user_id, &fields(user_id, "Zeta"))
            .await
            .unwrap();
        repo.create(user_id, &fields(user_id, "Alpha"))
            .await
            .unwrap();
        let used = repo
            .create(user_id, &fields(user_id, "Used"))
            .await
            .unwrap();
        repo.mark_used(used.id, user_id).await.unwrap();

        let names: Vec<String> = repo
            .list(user_id)
            .await
            .unwrap()
            .into_iter()
            .map(|p| p.fields.name)
            .collect();

        assert_eq!(names, ["Used", "Alpha", "Zeta"]);
        assert_eq!(repo.count(user_id).await.unwrap(), 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn update_replaces_fields_of_own_profile_only(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);
        let created = repo.create(alice, &fields(alice, "Bank")).await.unwrap();
        let changed = ImportProfileFields {
            label_fallback_col: Some(2),
            skip_lines: 4,
            csv_delimiter: CsvDelimiter::Semicolon,
            ..fields(alice, "Renamed")
        };

        assert!(
            repo.update(created.id, bob, &changed)
                .await
                .unwrap()
                .is_none()
        );
        let updated = repo
            .update(created.id, alice, &changed)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(updated.fields, changed);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn mark_used_ignores_another_users_profile(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);
        let created = repo.create(alice, &fields(alice, "Bank")).await.unwrap();

        repo.mark_used(created.id, bob).await.unwrap();
        assert!(only(&repo, alice).await.last_used_at.is_none());

        repo.mark_used(created.id, alice).await.unwrap();
        assert!(only(&repo, alice).await.last_used_at.is_some());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn delete_own_profile_only(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgImportProfileRepository::new(pool);
        let created = repo.create(alice, &fields(alice, "Bank")).await.unwrap();

        assert!(!repo.delete(created.id, bob).await.unwrap());
        assert!(repo.delete(created.id, alice).await.unwrap());
        assert!(!repo.delete(created.id, alice).await.unwrap());
    }
}
