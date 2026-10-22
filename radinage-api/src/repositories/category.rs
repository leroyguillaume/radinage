use crate::{
    domain::category::{Category, CategoryColor, CategoryFields},
    error::{AppError, AppResult},
};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

const COLUMNS: &str = "id, user_id, name, color, created_at";

/// Data access interface for categories.
#[cfg_attr(test, mockall::automock)]
pub trait CategoryRepository: Send + Sync + 'static {
    /// All categories of a user, by name.
    fn list(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<Category>>> + Send;

    /// Number of categories a user has.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// Whether the category exists and belongs to the user.
    fn exists(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Create a category. Returns `AppError::Conflict` if the user already has one by that name.
    fn create(
        &self,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> impl std::future::Future<Output = AppResult<Category>> + Send;

    /// Replace a category's fields. Returns `None` if it does not exist or belongs to another
    /// user, `AppError::Conflict` if the new name is taken.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> impl std::future::Future<Output = AppResult<Option<Category>>> + Send;

    /// Delete a category, leaving what used it uncategorized. Returns `false` if it does not
    /// exist or belongs to another user.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;
}

/// PostgreSQL-backed category repository.
#[derive(Clone)]
pub struct PgCategoryRepository {
    pool: PgPool,
}

impl PgCategoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn row_to_category(row: &PgRow) -> AppResult<Category> {
    let color: &str = row.try_get("color")?;
    Ok(Category {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: CategoryFields {
            name: row.try_get("name")?,
            color: color.parse::<CategoryColor>().map_err(AppError::Internal)?,
        },
        created_at: row.try_get("created_at")?,
    })
}

fn map_name_conflict(e: sqlx::Error, name: &str) -> AppError {
    match e {
        sqlx::Error::Database(ref db) if db.constraint() == Some("categories_user_name_key") => {
            AppError::Conflict(format!("category '{name}' already exists"))
        }
        other => AppError::Database(other),
    }
}

impl CategoryRepository for PgCategoryRepository {
    async fn list(&self, user_id: Uuid) -> AppResult<Vec<Category>> {
        let rows = sqlx::query(&format!(
            "SELECT {COLUMNS} FROM categories WHERE user_id = $1 ORDER BY name"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_category).collect()
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM categories WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("n")?)
    }

    async fn exists(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id = $1 AND user_id = $2) AS found",
        )
        .bind(id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("found")?)
    }

    async fn create(&self, user_id: Uuid, fields: &CategoryFields) -> AppResult<Category> {
        let row = sqlx::query(&format!(
            "INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3) RETURNING {COLUMNS}"
        ))
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.color.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        row_to_category(&row)
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &CategoryFields,
    ) -> AppResult<Option<Category>> {
        let row = sqlx::query(&format!(
            "UPDATE categories SET name = $3, color = $4 \
             WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
        ))
        .bind(id)
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.color.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        row.as_ref().map(row_to_category).transpose()
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM categories WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::user::UserRole,
        repositories::{PgUserRepository, UserRepository},
    };

    async fn make_user(pool: &PgPool, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        PgUserRepository::new(pool.clone())
            .create(id, username, "hash", UserRole::User)
            .await
            .unwrap();
        id
    }

    fn fields(name: &str) -> CategoryFields {
        CategoryFields {
            name: name.to_string(),
            color: CategoryColor::Teal,
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_then_list_per_user_by_name(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);

        let transport = repo.create(alice, &fields("Transport")).await.unwrap();
        let food = repo.create(alice, &fields("Food")).await.unwrap();

        assert_eq!(transport.fields, fields("Transport"));
        assert_eq!(repo.list(alice).await.unwrap(), [food, transport]);
        assert_eq!(repo.count(alice).await.unwrap(), 2);
        assert!(repo.list(bob).await.unwrap().is_empty());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn duplicate_name_is_a_conflict_per_user(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);

        repo.create(alice, &fields("Food")).await.unwrap();

        assert!(matches!(
            repo.create(alice, &fields("Food")).await,
            Err(AppError::Conflict(_))
        ));
        repo.create(bob, &fields("Food")).await.unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn exists_and_update_are_scoped_to_the_owner(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);
        let created = repo.create(alice, &fields("Food")).await.unwrap();
        let changed = CategoryFields {
            name: "Groceries".to_string(),
            color: CategoryColor::Orange,
        };

        assert!(repo.exists(created.id, alice).await.unwrap());
        assert!(!repo.exists(created.id, bob).await.unwrap());
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
    async fn delete_own_category_only(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgCategoryRepository::new(pool);
        let created = repo.create(alice, &fields("Food")).await.unwrap();

        assert!(!repo.delete(created.id, bob).await.unwrap());
        assert!(repo.delete(created.id, alice).await.unwrap());
        assert!(!repo.delete(created.id, alice).await.unwrap());
    }
}
