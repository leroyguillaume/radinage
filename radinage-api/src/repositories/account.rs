use crate::{
    domain::account::{Account, AccountBalance, AccountFields, BalanceEntry},
    error::{AppError, AppResult},
};
use sqlx::{PgPool, Row, postgres::PgRow};
use uuid::Uuid;

/// An account `a` with its latest balance `b` and its current balance, filtered by the
/// `WHERE` clause appended to it.
const ACCOUNT_SELECT: &str = "SELECT a.id, a.user_id, a.name, a.kind, a.imported, a.created_at,
            b.id AS balance_id, b.amount AS balance_amount, b.date AS balance_date,
            b.amount + CASE WHEN a.kind = 'checking' AND a.imported
                THEN COALESCE((SELECT SUM(o.amount) FROM operations o
                               WHERE o.account_id = a.id AND o.date > b.date), 0)
                ELSE 0 END AS current_balance
     FROM accounts a
     LEFT JOIN LATERAL (SELECT id, amount, date FROM account_balances
                        WHERE account_id = a.id ORDER BY date DESC LIMIT 1) b ON TRUE";

/// Data access interface for accounts and their balances.
#[cfg_attr(test, mockall::automock)]
pub trait AccountRepository: Send + Sync + 'static {
    /// All accounts of a user, checking ones first, then by name.
    fn list(
        &self,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<Account>>> + Send;

    /// One account of a user, `None` if it does not exist or belongs to another user.
    fn find(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Option<Account>>> + Send;

    /// Number of accounts a user has.
    fn count(&self, user_id: Uuid) -> impl std::future::Future<Output = AppResult<i64>> + Send;

    /// Create an account. Returns `AppError::Conflict` if the user already has one by that name.
    fn create(
        &self,
        user_id: Uuid,
        fields: &AccountFields,
    ) -> impl std::future::Future<Output = AppResult<Account>> + Send;

    /// Replace an account's fields. Returns `None` if it does not exist or belongs to another
    /// user, `AppError::Conflict` if the new name is taken.
    fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &AccountFields,
    ) -> impl std::future::Future<Output = AppResult<Option<Account>>> + Send;

    /// Whether operations or import profiles point at the account.
    fn is_used(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// Delete an account and its balances. Returns `false` if it does not exist or belongs to
    /// another user, `AppError::Conflict` while operations or import profiles point at it.
    fn delete(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;

    /// The balances of a user's account, most recent first; empty for another user's account.
    fn list_balances(
        &self,
        account_id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<Vec<BalanceEntry>>> + Send;

    /// Add a balance to a user's account. Returns `None` if the account is not the user's,
    /// `AppError::Conflict` if it already has a balance on that date.
    fn add_balance(
        &self,
        account_id: Uuid,
        user_id: Uuid,
        balance: AccountBalance,
    ) -> impl std::future::Future<Output = AppResult<Option<BalanceEntry>>> + Send;

    /// Replace one balance of a user's account. Returns `None` if no such balance is the
    /// user's, `AppError::Conflict` if the account already has another balance on that date.
    fn update_balance(
        &self,
        id: Uuid,
        account_id: Uuid,
        user_id: Uuid,
        balance: AccountBalance,
    ) -> impl std::future::Future<Output = AppResult<Option<BalanceEntry>>> + Send;

    /// Delete one balance of a user's account. Returns `false` if no such balance is the user's.
    fn delete_balance(
        &self,
        id: Uuid,
        account_id: Uuid,
        user_id: Uuid,
    ) -> impl std::future::Future<Output = AppResult<bool>> + Send;
}

/// PostgreSQL-backed account repository.
#[derive(Clone)]
pub struct PgAccountRepository {
    pool: PgPool,
}

impl PgAccountRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn row_to_account(row: &PgRow) -> AppResult<Account> {
    let balance_id: Option<Uuid> = row.try_get("balance_id")?;
    let balance_date: Option<chrono::NaiveDate> = row.try_get("balance_date")?;
    let balance_amount: Option<rust_decimal::Decimal> = row.try_get("balance_amount")?;
    Ok(Account {
        id: row.try_get("id")?,
        user_id: row.try_get("user_id")?,
        fields: AccountFields {
            name: row.try_get("name")?,
            kind: row
                .try_get::<&str, _>("kind")?
                .parse()
                .map_err(AppError::Internal)?,
            imported: row.try_get("imported")?,
        },
        balance: balance_id
            .zip(balance_date)
            .zip(balance_amount)
            .map(|((id, date), amount)| BalanceEntry {
                id,
                balance: AccountBalance { amount, date },
            }),
        current_balance: row.try_get("current_balance")?,
        created_at: row.try_get("created_at")?,
    })
}

fn row_to_entry(row: &PgRow) -> AppResult<BalanceEntry> {
    Ok(BalanceEntry {
        id: row.try_get("id")?,
        balance: AccountBalance {
            amount: row.try_get("amount")?,
            date: row.try_get("date")?,
        },
    })
}

fn map_name_conflict(e: sqlx::Error, name: &str) -> AppError {
    match e {
        sqlx::Error::Database(ref db) if db.constraint() == Some("accounts_user_name_key") => {
            AppError::Conflict(format!("account '{name}' already exists"))
        }
        other => AppError::Database(other),
    }
}

fn map_date_conflict(e: sqlx::Error, balance: AccountBalance) -> AppError {
    match e {
        sqlx::Error::Database(ref db)
            if db.constraint() == Some("account_balances_account_date_key") =>
        {
            AppError::Conflict(format!(
                "the account already has a balance on {}",
                balance.date
            ))
        }
        other => AppError::Database(other),
    }
}

impl AccountRepository for PgAccountRepository {
    async fn list(&self, user_id: Uuid) -> AppResult<Vec<Account>> {
        let rows = sqlx::query(&format!(
            "{ACCOUNT_SELECT} WHERE a.user_id = $1 ORDER BY a.kind, a.name"
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_account).collect()
    }

    async fn find(&self, id: Uuid, user_id: Uuid) -> AppResult<Option<Account>> {
        let row = sqlx::query(&format!(
            "{ACCOUNT_SELECT} WHERE a.id = $1 AND a.user_id = $2"
        ))
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(row_to_account).transpose()
    }

    async fn count(&self, user_id: Uuid) -> AppResult<i64> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM accounts WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.try_get("n")?)
    }

    async fn create(&self, user_id: Uuid, fields: &AccountFields) -> AppResult<Account> {
        let row = sqlx::query(
            "INSERT INTO accounts (user_id, name, kind, imported) VALUES ($1, $2, $3, $4) \
             RETURNING id",
        )
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.kind.as_str())
        .bind(fields.imported)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?;
        self.find(row.try_get("id")?, user_id)
            .await?
            .ok_or_else(|| AppError::Internal("created account vanished".to_string()))
    }

    async fn update(
        &self,
        id: Uuid,
        user_id: Uuid,
        fields: &AccountFields,
    ) -> AppResult<Option<Account>> {
        let updated = sqlx::query(
            "UPDATE accounts SET name = $3, kind = $4, imported = $5 \
             WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .bind(&fields.name)
        .bind(fields.kind.as_str())
        .bind(fields.imported)
        .execute(&self.pool)
        .await
        .map_err(|e| map_name_conflict(e, &fields.name))?
        .rows_affected();
        if updated == 0 {
            return Ok(None);
        }
        self.find(id, user_id).await
    }

    async fn is_used(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT EXISTS (SELECT 1 FROM operations WHERE account_id = $1 AND user_id = $2)
                 OR EXISTS (SELECT 1 FROM import_profiles WHERE account_id = $1 AND user_id = $2)
                 AS used",
        )
        .bind(id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("used")?)
    }

    async fn delete(&self, id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query("DELETE FROM accounts WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
                    AppError::Conflict(
                        "the account still holds operations or import profiles".to_string(),
                    )
                }
                other => AppError::Database(other),
            })?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_balances(&self, account_id: Uuid, user_id: Uuid) -> AppResult<Vec<BalanceEntry>> {
        let rows = sqlx::query(
            "SELECT ab.id, ab.amount, ab.date FROM account_balances ab
             JOIN accounts a ON a.id = ab.account_id
             WHERE ab.account_id = $1 AND a.user_id = $2
             ORDER BY ab.date DESC",
        )
        .bind(account_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(row_to_entry).collect()
    }

    async fn add_balance(
        &self,
        account_id: Uuid,
        user_id: Uuid,
        balance: AccountBalance,
    ) -> AppResult<Option<BalanceEntry>> {
        let row = sqlx::query(
            "INSERT INTO account_balances (account_id, date, amount)
             SELECT id, $3, $4 FROM accounts WHERE id = $1 AND user_id = $2
             RETURNING id, amount, date",
        )
        .bind(account_id)
        .bind(user_id)
        .bind(balance.date)
        .bind(balance.amount)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| map_date_conflict(e, balance))?;
        row.as_ref().map(row_to_entry).transpose()
    }

    async fn update_balance(
        &self,
        id: Uuid,
        account_id: Uuid,
        user_id: Uuid,
        balance: AccountBalance,
    ) -> AppResult<Option<BalanceEntry>> {
        let row = sqlx::query(
            "UPDATE account_balances ab SET date = $4, amount = $5
             FROM accounts a
             WHERE ab.id = $1 AND ab.account_id = $2 AND a.id = ab.account_id AND a.user_id = $3
             RETURNING ab.id, ab.amount, ab.date",
        )
        .bind(id)
        .bind(account_id)
        .bind(user_id)
        .bind(balance.date)
        .bind(balance.amount)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| map_date_conflict(e, balance))?;
        row.as_ref().map(row_to_entry).transpose()
    }

    async fn delete_balance(&self, id: Uuid, account_id: Uuid, user_id: Uuid) -> AppResult<bool> {
        let result = sqlx::query(
            "DELETE FROM account_balances ab USING accounts a
             WHERE ab.id = $1 AND ab.account_id = $2 AND a.id = ab.account_id AND a.user_id = $3",
        )
        .bind(id)
        .bind(account_id)
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
        domain::{account::AccountKind, user::UserRole},
        repositories::{PgUserRepository, UserRepository},
    };
    use chrono::NaiveDate;
    use rust_decimal_macros::dec;

    async fn make_user(pool: &PgPool, username: &str) -> Uuid {
        let id = Uuid::new_v4();
        PgUserRepository::new(pool.clone())
            .create(id, username, "hash", UserRole::User)
            .await
            .unwrap();
        id
    }

    fn checking(name: &str) -> AccountFields {
        AccountFields {
            name: name.to_string(),
            kind: AccountKind::Checking,
            imported: true,
        }
    }

    fn savings(name: &str) -> AccountFields {
        AccountFields {
            name: name.to_string(),
            kind: AccountKind::Savings,
            imported: false,
        }
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn balance(amount: rust_decimal::Decimal, on: NaiveDate) -> AccountBalance {
        AccountBalance { amount, date: on }
    }

    async fn insert_operation(
        pool: &PgPool,
        user_id: Uuid,
        account_id: Uuid,
        amount: rust_decimal::Decimal,
        on: NaiveDate,
        ignored: bool,
    ) {
        sqlx::query(
            "INSERT INTO operations (id, user_id, account_id, amount, date, label, ignored)
             VALUES ($1, $2, $3, $4, $5, 'op', $6)",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(account_id)
        .bind(amount)
        .bind(on)
        .bind(ignored)
        .execute(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn create_then_list_per_user_checking_first(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgAccountRepository::new(pool);

        repo.create(alice, &savings("Livret A")).await.unwrap();
        let created = repo.create(alice, &checking("Perso")).await.unwrap();
        repo.create(alice, &checking("Joint")).await.unwrap();

        assert_eq!(created.fields, checking("Perso"));
        assert_eq!(created.balance, None);
        assert_eq!(created.current_balance, None);
        let names: Vec<String> = repo
            .list(alice)
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.fields.name)
            .collect();
        assert_eq!(names, ["Joint", "Perso", "Livret A"]);
        assert_eq!(repo.count(alice).await.unwrap(), 3);
        assert!(repo.list(bob).await.unwrap().is_empty());
        assert!(repo.find(created.id, bob).await.unwrap().is_none());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn duplicate_name_is_a_conflict_per_user(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgAccountRepository::new(pool);

        let perso = repo.create(alice, &checking("Perso")).await.unwrap();
        let joint = repo.create(alice, &checking("Joint")).await.unwrap();

        assert!(matches!(
            repo.create(alice, &savings("Perso")).await,
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            repo.update(joint.id, alice, &checking("Perso")).await,
            Err(AppError::Conflict(_))
        ));
        repo.create(bob, &checking("Perso")).await.unwrap();
        assert!(
            repo.update(perso.id, bob, &checking("Mine"))
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn current_balance_adds_the_operations_dated_after_the_latest_balance(pool: PgPool) {
        let user_id = make_user(&pool, "alice").await;
        let repo = PgAccountRepository::new(pool.clone());
        let perso = repo.create(user_id, &checking("Perso")).await.unwrap();
        let joint = repo.create(user_id, &checking("Joint")).await.unwrap();
        repo.add_balance(perso.id, user_id, balance(dec!(900), date(2026, 1, 31)))
            .await
            .unwrap();
        repo.add_balance(perso.id, user_id, balance(dec!(1000), date(2026, 2, 28)))
            .await
            .unwrap();
        // Included in the balance read that day.
        insert_operation(
            &pool,
            user_id,
            perso.id,
            dec!(-30),
            date(2026, 2, 28),
            false,
        )
        .await;
        insert_operation(&pool, user_id, perso.id, dec!(-40), date(2026, 3, 2), false).await;
        // Ignored, but it still left the account.
        insert_operation(&pool, user_id, perso.id, dec!(-500), date(2026, 3, 3), true).await;
        insert_operation(&pool, user_id, joint.id, dec!(500), date(2026, 3, 3), true).await;

        let perso = repo.find(perso.id, user_id).await.unwrap().unwrap();
        let joint = repo.find(joint.id, user_id).await.unwrap().unwrap();

        assert_eq!(
            perso.balance.map(|e| e.balance),
            Some(balance(dec!(1000), date(2026, 2, 28)))
        );
        assert_eq!(perso.current_balance, Some(dec!(460)));
        assert_eq!(joint.current_balance, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_not_receiving_operations_is_worth_its_latest_balance(pool: PgPool) {
        let user_id = make_user(&pool, "alice").await;
        let repo = PgAccountRepository::new(pool);
        let livret = repo.create(user_id, &savings("Livret A")).await.unwrap();
        repo.add_balance(livret.id, user_id, balance(dec!(9760), date(2026, 10, 21)))
            .await
            .unwrap();

        let livret = repo.find(livret.id, user_id).await.unwrap().unwrap();

        assert_eq!(livret.current_balance, Some(dec!(9760)));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn balances_are_one_per_date_and_scoped_to_their_owner(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgAccountRepository::new(pool);
        let account = repo.create(alice, &checking("Perso")).await.unwrap();
        let other = repo.create(alice, &checking("Joint")).await.unwrap();

        let older = repo
            .add_balance(account.id, alice, balance(dec!(100), date(2026, 1, 1)))
            .await
            .unwrap()
            .unwrap();
        let newer = repo
            .add_balance(account.id, alice, balance(dec!(200), date(2026, 2, 1)))
            .await
            .unwrap()
            .unwrap();

        assert!(
            repo.add_balance(account.id, bob, balance(dec!(1), date(2026, 3, 1)))
                .await
                .unwrap()
                .is_none()
        );
        assert!(matches!(
            repo.add_balance(account.id, alice, balance(dec!(1), date(2026, 1, 1)))
                .await,
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            repo.update_balance(older.id, account.id, alice, newer.balance)
                .await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            repo.list_balances(account.id, alice).await.unwrap(),
            [newer, older]
        );
        assert!(
            repo.list_balances(account.id, bob)
                .await
                .unwrap()
                .is_empty()
        );

        let fixed = balance(dec!(150), date(2026, 1, 2));
        assert!(
            repo.update_balance(older.id, other.id, alice, fixed)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            repo.update_balance(older.id, account.id, bob, fixed)
                .await
                .unwrap()
                .is_none()
        );
        let updated = repo
            .update_balance(older.id, account.id, alice, fixed)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.balance, fixed);

        assert!(
            !repo
                .delete_balance(newer.id, account.id, bob)
                .await
                .unwrap()
        );
        assert!(
            repo.delete_balance(newer.id, account.id, alice)
                .await
                .unwrap()
        );
        let account = repo.find(account.id, alice).await.unwrap().unwrap();
        assert_eq!(account.balance, Some(updated));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_holding_operations_cannot_be_deleted(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let repo = PgAccountRepository::new(pool.clone());
        let used = repo.create(alice, &checking("Perso")).await.unwrap();
        let unused = repo.create(alice, &savings("Livret A")).await.unwrap();
        repo.add_balance(unused.id, alice, balance(dec!(1), date(2026, 1, 1)))
            .await
            .unwrap();
        insert_operation(&pool, alice, used.id, dec!(-1), date(2026, 1, 1), false).await;

        assert!(repo.is_used(used.id, alice).await.unwrap());
        assert!(!repo.is_used(unused.id, alice).await.unwrap());
        assert!(matches!(
            repo.delete(used.id, alice).await,
            Err(AppError::Conflict(_))
        ));
        assert!(!repo.delete(unused.id, bob).await.unwrap());
        assert!(repo.delete(unused.id, alice).await.unwrap());
        assert!(!repo.delete(unused.id, alice).await.unwrap());
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_operation_cannot_point_at_another_users_account(pool: PgPool) {
        let alice = make_user(&pool, "alice").await;
        let bob = make_user(&pool, "bob").await;
        let account = PgAccountRepository::new(pool.clone())
            .create(alice, &checking("Perso"))
            .await
            .unwrap();

        let result = sqlx::query(
            "INSERT INTO operations (id, user_id, account_id, amount, date, label)
             VALUES ($1, $2, $3, -1, '2026-01-01', 'op')",
        )
        .bind(Uuid::new_v4())
        .bind(bob)
        .bind(account.id)
        .execute(&pool)
        .await;

        assert!(result.is_err());
    }
}
