use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::account::{
        Account, AccountBalance, AccountFields, AccountKind, BalanceEntry, DailyMovement,
    },
    error::{AppError, AppResult},
    repositories::AccountRepository,
    services::balance_history::{self, BalancePoint},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_NAME_LEN: usize = 100;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body of a create or update: the whole account, every field replaced on update.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "name": "Compte joint",
    "kind": "checking",
    "imported": true
})))]
pub struct AccountRequest {
    /// Name shown for the account, unique per user (1 to 100 characters).
    pub name: String,
    pub kind: AccountKind,
    /// Whether the account's statements are imported, so that it holds operations; only a
    /// checking account can be (default false).
    #[serde(default)]
    pub imported: bool,
}

/// A balance read on an account.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({"amount": "1523.40", "date": "2026-03-31"})))]
pub struct AccountBalanceRequest {
    /// Balance of the account at the end of `date`, as shown by the bank; negative when
    /// overdrawn.
    #[schemars(with = "String")]
    pub amount: Decimal,
    /// Day the balance was read, today or earlier. Operations accounted on that day are
    /// considered already included in `amount`.
    pub date: NaiveDate,
}

/// A balance kept in an account's history; operations accounted on `date` are included in
/// `amount`.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalanceEntryResponse {
    pub id: Uuid,
    #[schemars(with = "String")]
    pub amount: Decimal,
    pub date: NaiveDate,
}

impl From<BalanceEntry> for BalanceEntryResponse {
    fn from(entry: BalanceEntry) -> Self {
        Self {
            id: entry.id,
            amount: entry.balance.amount,
            date: entry.balance.date,
        }
    }
}

/// A balance in an account's history, with what was estimated for its day.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalanceReadingResponse {
    pub id: Uuid,
    #[schemars(with = "String")]
    pub amount: Decimal,
    pub date: NaiveDate,
    /// What the previous balance, plus what the account moved after it up to `date`,
    /// estimated for that day; `amount` minus it is what the movements do not explain
    /// (interest, market changes, fees). Null on the account's first balance.
    #[schemars(with = "Option<String>")]
    pub estimated: Option<Decimal>,
}

/// Query parameters of an account's balance history.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalanceHistoryQuery {
    /// First day (inclusive); from the earliest day anything is known when omitted.
    pub from: Option<NaiveDate>,
    /// Last day (inclusive); today when omitted.
    pub to: Option<NaiveDate>,
}

/// The balance of an account at the end of a day.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalancePointResponse {
    pub date: NaiveDate,
    #[schemars(with = "String")]
    pub balance: Decimal,
    /// Whether a balance was read that day, `balance` being that reading.
    pub read: bool,
    /// On a balance read after an earlier one, what the earlier one plus the movements in
    /// between estimated for that day; null otherwise.
    #[schemars(with = "Option<String>")]
    pub estimated: Option<Decimal>,
}

impl From<BalancePoint> for BalancePointResponse {
    fn from(p: BalancePoint) -> Self {
        Self {
            date: p.date,
            balance: p.balance,
            read: p.read,
            estimated: p.estimated,
        }
    }
}

/// An account (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccountResponse {
    pub id: Uuid,
    pub name: String,
    pub kind: AccountKind,
    pub imported: bool,
    /// Whether operations can be recorded or imported on the account: an imported checking
    /// account.
    pub receives_operations: bool,
    /// Most recent balance read, null when none is. An account receiving operations starts
    /// from it.
    pub balance: Option<BalanceEntryResponse>,
    /// Balance today: `balance`, plus, on an account receiving operations, every operation
    /// dated after it, ignored ones included; on any other account, minus every amount dated
    /// after it that left another account to land here, so that 100 put aside from the
    /// checking account (-100 there) adds 100: the transfers with the account, ignored ones
    /// included, and the other non-ignored amounts linked to its savings budgets. Null when no
    /// balance is read.
    #[schemars(with = "Option<String>")]
    pub current_balance: Option<Decimal>,
    /// Whether operations of other accounts are transfers with this one.
    pub transferred_into: bool,
    pub created_at: DateTime<Utc>,
}

impl From<Account> for AccountResponse {
    fn from(a: Account) -> Self {
        Self {
            id: a.id,
            receives_operations: a.fields.receives_operations(),
            name: a.fields.name,
            kind: a.fields.kind,
            imported: a.fields.imported,
            balance: a.balance.map(Into::into),
            current_balance: a.current_balance,
            transferred_into: a.transferred_into,
            created_at: a.created_at,
        }
    }
}

impl TryFrom<AccountRequest> for AccountFields {
    type Error = AppError;

    fn try_from(body: AccountRequest) -> AppResult<Self> {
        let name = body.name.trim().to_string();
        if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
            return Err(AppError::BadRequest(format!(
                "name must be 1 to {MAX_NAME_LEN} characters"
            )));
        }
        if body.imported && body.kind != AccountKind::Checking {
            return Err(AppError::BadRequest(
                "only a checking account can be imported".to_string(),
            ));
        }
        Ok(Self {
            name,
            kind: body.kind,
            imported: body.imported,
        })
    }
}

impl TryFrom<AccountBalanceRequest> for AccountBalance {
    type Error = AppError;

    fn try_from(body: AccountBalanceRequest) -> AppResult<Self> {
        if body.date > chrono::Local::now().date_naive() {
            return Err(AppError::BadRequest(format!(
                "balance date {} is in the future",
                body.date
            )));
        }
        Ok(Self {
            amount: body.amount,
            date: body.date,
        })
    }
}

/// Path of one balance of an account.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalancePath {
    pub id: Uuid,
    pub balance_id: Uuid,
}

/// The user's account `id` when it receives operations: `BadRequest` otherwise, so that a
/// request naming another account fails as invalid input.
pub async fn account_receiving_operations(
    repo: &impl AccountRepository,
    id: Uuid,
    user_id: Uuid,
) -> AppResult<Account> {
    match repo.find(id, user_id).await? {
        Some(account) if account.fields.receives_operations() => Ok(account),
        Some(account) => Err(AppError::BadRequest(format!(
            "account '{}' does not receive operations",
            account.fields.name
        ))),
        None => Err(AppError::BadRequest(format!("unknown account {id}"))),
    }
}

/// Check that `id`, when given, is one of the user's savings accounts: `BadRequest` otherwise,
/// so that a budget naming another account fails as invalid input.
pub async fn ensure_savings_account(
    repo: &impl AccountRepository,
    id: Option<Uuid>,
    user_id: Uuid,
) -> AppResult<()> {
    let Some(id) = id else {
        return Ok(());
    };
    match repo.find(id, user_id).await? {
        Some(account) if account.fields.kind == AccountKind::Savings => Ok(()),
        Some(account) => Err(AppError::BadRequest(format!(
            "account '{}' is not a savings account",
            account.fields.name
        ))),
        None => Err(AppError::BadRequest(format!("unknown account {id}"))),
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_accounts<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
) -> AppResult<Json<Vec<AccountResponse>>> {
    let accounts = state.account_repo.list(auth_user.id).await?;
    Ok(Json(accounts.into_iter().map(Into::into).collect()))
}

pub async fn create_account<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Json(body): Json<AccountRequest>,
) -> AppResult<(StatusCode, Json<AccountResponse>)> {
    let fields = AccountFields::try_from(body)?;
    let max = state.config.max_accounts_per_user;
    if state.account_repo.count(auth_user.id).await? >= i64::from(max) {
        return Err(AppError::Conflict(format!("account limit reached ({max})")));
    }
    let account = state.account_repo.create(auth_user.id, &fields).await?;
    Ok((StatusCode::CREATED, Json(account.into())))
}

pub async fn update_account<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AccountRequest>,
) -> AppResult<Json<AccountResponse>> {
    let fields = AccountFields::try_from(body)?;
    if !fields.receives_operations() && state.account_repo.is_used(id, auth_user.id).await? {
        return Err(AppError::Conflict(
            "the account holds operations or import profiles, so it must stay an imported \
             checking account"
                .to_string(),
        ));
    }
    if fields.kind != AccountKind::Savings
        && state
            .account_repo
            .has_savings_budgets(id, auth_user.id)
            .await?
    {
        return Err(AppError::Conflict(
            "savings budgets send their money to the account, so it must stay a savings account"
                .to_string(),
        ));
    }
    if let Some(current) = state.account_repo.find(id, auth_user.id).await?
        && current.transferred_into
        && current.fields.kind != fields.kind
    {
        return Err(AppError::Conflict(
            "operations are transfers with the account, so it must keep its kind".to_string(),
        ));
    }
    let account = state
        .account_repo
        .update(id, auth_user.id, &fields)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(account.into()))
}

pub async fn delete_account<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if !state.account_repo.delete(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// The balances of the user's account `id`, oldest first, and what it moved each day: 404
/// when the account is not the user's.
async fn readings_and_movements(
    repo: &impl AccountRepository,
    id: Uuid,
    user_id: Uuid,
) -> AppResult<(Vec<BalanceEntry>, Vec<DailyMovement>)> {
    if repo.find(id, user_id).await?.is_none() {
        return Err(AppError::NotFound);
    }
    let mut entries = repo.list_balances(id, user_id).await?;
    entries.reverse();
    let movements = repo.daily_movements(id, user_id).await?;
    Ok((entries, movements))
}

pub async fn list_balances<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<BalanceReadingResponse>>> {
    let (entries, movements) =
        readings_and_movements(&state.account_repo, id, auth_user.id).await?;
    let readings: Vec<AccountBalance> = entries.iter().map(|e| e.balance).collect();
    let estimated = balance_history::estimates(&readings, &movements);
    Ok(Json(
        entries
            .into_iter()
            .zip(estimated)
            .rev()
            .map(|(entry, estimated)| BalanceReadingResponse {
                id: entry.id,
                amount: entry.balance.amount,
                date: entry.balance.date,
                estimated,
            })
            .collect(),
    ))
}

pub async fn balance_history<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Query(query): Query<BalanceHistoryQuery>,
) -> AppResult<Json<Vec<BalancePointResponse>>> {
    let to = query
        .to
        .unwrap_or_else(|| chrono::Local::now().date_naive());
    if query.from.is_some_and(|from| from > to) {
        return Err(AppError::BadRequest("from is after to".to_string()));
    }
    let (entries, movements) =
        readings_and_movements(&state.account_repo, id, auth_user.id).await?;
    let readings: Vec<AccountBalance> = entries.iter().map(|e| e.balance).collect();
    let points = balance_history::timeline(&readings, &movements, query.from, to);
    Ok(Json(points.into_iter().map(Into::into).collect()))
}

pub async fn add_balance<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<AccountBalanceRequest>,
) -> AppResult<(StatusCode, Json<BalanceEntryResponse>)> {
    let balance = AccountBalance::try_from(body)?;
    let entry = state
        .account_repo
        .add_balance(id, auth_user.id, balance)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok((StatusCode::CREATED, Json(entry.into())))
}

pub async fn update_balance<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(path): Path<BalancePath>,
    Json(body): Json<AccountBalanceRequest>,
) -> AppResult<Json<BalanceEntryResponse>> {
    let balance = AccountBalance::try_from(body)?;
    let entry = state
        .account_repo
        .update_balance(path.balance_id, path.id, auth_user.id, balance)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(entry.into()))
}

pub async fn delete_balance<U, O, B, P, C, R, A: AccountRepository>(
    State(state): State<AppState<U, O, B, P, C, R, A>>,
    auth_user: AuthUser,
    Path(path): Path<BalancePath>,
) -> AppResult<StatusCode> {
    if !state
        .account_repo
        .delete_balance(path.balance_id, path.id, auth_user.id)
        .await?
    {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::user::UserRole,
        repositories::MockAccountRepository,
        test_util::{
            auth_header, build_test_router, json_request, make_test_state_with_accounts,
            response_json,
        },
    };
    use rust_decimal_macros::dec;
    use tower::ServiceExt;

    fn app(repo: MockAccountRepository) -> axum::Router {
        build_test_router(make_test_state_with_accounts(repo))
    }

    fn account(user_id: Uuid, kind: AccountKind, imported: bool) -> Account {
        Account {
            id: Uuid::new_v4(),
            user_id,
            fields: AccountFields {
                name: "Perso".to_string(),
                kind,
                imported,
            },
            balance: Some(BalanceEntry {
                id: Uuid::nil(),
                balance: AccountBalance {
                    amount: dec!(1000),
                    date: NaiveDate::from_ymd_opt(2026, 2, 28).unwrap(),
                },
            }),
            current_balance: Some(dec!(960)),
            transferred_into: false,
            created_at: Utc::now(),
        }
    }

    async fn send(
        repo: MockAccountRepository,
        method: &str,
        uri: &str,
        body: Option<serde_json::Value>,
        user_id: Uuid,
    ) -> axum::response::Response {
        let auth = auth_header(user_id, UserRole::User);
        let body = body.map(|b| b.to_string());
        app(repo)
            .oneshot(json_request(method, uri, body.as_deref(), Some(&auth)))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn list_returns_the_accounts_without_user_id() {
        let user_id = Uuid::new_v4();
        let listed = account(user_id, AccountKind::Checking, true);
        let id = listed.id;
        let mut repo = MockAccountRepository::new();
        repo.expect_list()
            .withf(move |uid| *uid == user_id)
            .returning(move |_| {
                let listed = listed.clone();
                Box::pin(async move { Ok(vec![listed]) })
            });

        let resp = send(repo, "GET", "/accounts", None, user_id).await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json[0]["id"], id.to_string());
        assert_eq!(json[0]["kind"], "checking");
        assert_eq!(json[0]["receivesOperations"], true);
        assert_eq!(
            json[0]["balance"],
            serde_json::json!({"id": Uuid::nil(), "amount": "1000", "date": "2026-02-28"})
        );
        assert_eq!(json[0]["currentBalance"], "960");
        assert!(json[0].get("userId").is_none());
    }

    #[tokio::test]
    async fn create_trims_the_name_and_returns_201() {
        let user_id = Uuid::new_v4();
        let mut repo = MockAccountRepository::new();
        repo.expect_count().returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create()
            .withf(|_, f| f.name == "Joint" && f.kind == AccountKind::Checking && f.imported)
            .returning(move |uid, f| {
                let created = Account {
                    fields: f.clone(),
                    balance: None,
                    current_balance: None,
                    transferred_into: false,
                    ..account(uid, AccountKind::Checking, true)
                };
                Box::pin(async move { Ok(created) })
            });

        let body = serde_json::json!({"name": "  Joint ", "kind": "checking", "imported": true});
        let resp = send(repo, "POST", "/accounts", Some(body), user_id).await;

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json["name"], "Joint");
        assert_eq!(json["balance"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn create_rejects_an_imported_savings_account_and_a_blank_name() {
        for body in [
            serde_json::json!({"name": "Livret", "kind": "savings", "imported": true}),
            serde_json::json!({"name": "  ", "kind": "checking"}),
        ] {
            let resp = send(
                MockAccountRepository::new(),
                "POST",
                "/accounts",
                Some(body.clone()),
                Uuid::new_v4(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{body}");
        }
    }

    #[tokio::test]
    async fn create_is_refused_at_the_account_limit() {
        let mut repo = MockAccountRepository::new();
        repo.expect_count()
            .returning(|_| Box::pin(async { Ok(20) }));

        let body = serde_json::json!({"name": "One more", "kind": "savings"});
        let resp = send(repo, "POST", "/accounts", Some(body), Uuid::new_v4()).await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn an_account_in_use_must_keep_receiving_operations() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut repo = MockAccountRepository::new();
        repo.expect_is_used()
            .withf(move |aid, uid| *aid == id && *uid == user_id)
            .returning(|_, _| Box::pin(async { Ok(true) }));

        let body = serde_json::json!({"name": "Perso", "kind": "checking", "imported": false});
        let resp = send(repo, "PUT", &format!("/accounts/{id}"), Some(body), user_id).await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn an_account_saved_into_must_stay_a_savings_account() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut repo = MockAccountRepository::new();
        repo.expect_is_used()
            .returning(|_, _| Box::pin(async { Ok(false) }));
        repo.expect_has_savings_budgets()
            .withf(move |aid, uid| *aid == id && *uid == user_id)
            .returning(|_, _| Box::pin(async { Ok(true) }));
        repo.expect_find().returning(|_, uid| {
            Box::pin(async move { Ok(Some(account(uid, AccountKind::Savings, false))) })
        });
        repo.expect_update().returning(move |_, uid, f| {
            let updated = Account {
                fields: f.clone(),
                ..account(uid, AccountKind::Savings, false)
            };
            Box::pin(async move { Ok(Some(updated)) })
        });
        let app = app(repo);
        let auth = auth_header(user_id, UserRole::User);
        let uri = format!("/accounts/{id}");
        let put = |kind: &str| {
            let body = serde_json::json!({"name": "Livret", "kind": kind}).to_string();
            app.clone()
                .oneshot(json_request("PUT", &uri, Some(&body), Some(&auth)))
        };

        assert_eq!(
            put("checking").await.unwrap().status(),
            StatusCode::CONFLICT
        );
        assert_eq!(put("savings").await.unwrap().status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn update_of_an_unknown_account_is_404() {
        let mut repo = MockAccountRepository::new();
        repo.expect_has_savings_budgets()
            .returning(|_, _| Box::pin(async { Ok(false) }));
        repo.expect_find()
            .returning(|_, _| Box::pin(async { Ok(None) }));
        repo.expect_update()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let body = serde_json::json!({"name": "Perso", "kind": "checking", "imported": true});
        let resp = send(
            repo,
            "PUT",
            &format!("/accounts/{}", Uuid::new_v4()),
            Some(body),
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn delete_returns_204_then_404() {
        for (deleted, status) in [
            (true, StatusCode::NO_CONTENT),
            (false, StatusCode::NOT_FOUND),
        ] {
            let mut repo = MockAccountRepository::new();
            repo.expect_delete()
                .returning(move |_, _| Box::pin(async move { Ok(deleted) }));

            let resp = send(
                repo,
                "DELETE",
                &format!("/accounts/{}", Uuid::new_v4()),
                None,
                Uuid::new_v4(),
            )
            .await;

            assert_eq!(resp.status(), status);
        }
    }

    #[tokio::test]
    async fn add_balance_records_a_balance_dated_today_or_earlier() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let today = chrono::Local::now().date_naive();
        for date in [today, today - chrono::Days::new(400)] {
            let mut repo = MockAccountRepository::new();
            repo.expect_add_balance()
                .withf(move |aid, uid, b| {
                    *aid == id
                        && *uid == user_id
                        && *b
                            == AccountBalance {
                                amount: dec!(-80.10),
                                date,
                            }
                })
                .returning(|_, _, balance| {
                    Box::pin(async move {
                        Ok(Some(BalanceEntry {
                            id: Uuid::new_v4(),
                            balance,
                        }))
                    })
                });

            let body = serde_json::json!({"amount": "-80.10", "date": date});
            let resp = send(
                repo,
                "POST",
                &format!("/accounts/{id}/balances"),
                Some(body),
                user_id,
            )
            .await;

            assert_eq!(resp.status(), StatusCode::CREATED, "{date}");
            let json: BalanceEntryResponse = response_json(resp).await;
            assert_eq!(json.amount, dec!(-80.10));
            assert_eq!(json.date, date);
        }
    }

    #[tokio::test]
    async fn a_balance_dated_in_the_future_is_rejected() {
        let tomorrow = chrono::Local::now().date_naive() + chrono::Days::new(1);
        let body = serde_json::json!({"amount": "10", "date": tomorrow});
        let id = Uuid::new_v4();
        for (method, uri) in [
            ("POST", format!("/accounts/{id}/balances")),
            ("PUT", format!("/accounts/{id}/balances/{}", Uuid::new_v4())),
        ] {
            let resp = send(
                MockAccountRepository::new(),
                method,
                &uri,
                Some(body.clone()),
                Uuid::new_v4(),
            )
            .await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{method}");
        }
    }

    #[tokio::test]
    async fn a_balance_on_an_unknown_account_is_404() {
        let mut repo = MockAccountRepository::new();
        repo.expect_add_balance()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));
        let id = Uuid::new_v4();
        let body = serde_json::json!({"amount": "10", "date": "2026-01-01"});

        let resp = send(
            repo,
            "POST",
            &format!("/accounts/{id}/balances"),
            Some(body),
            Uuid::new_v4(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn list_balances_of_an_unknown_account_is_404() {
        let mut repo = MockAccountRepository::new();
        repo.expect_find()
            .returning(|_, _| Box::pin(async { Ok(None) }));

        let resp = send(
            repo,
            "GET",
            &format!("/accounts/{}/balances", Uuid::new_v4()),
            None,
            Uuid::new_v4(),
        )
        .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    fn day(m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, m, d).unwrap()
    }

    /// An account of `user_id` read at 1000 on March 31 and 1150 on May 31, most recent
    /// first as the repository lists them, that gained 100 on the 10th of April to June.
    fn account_with_history(user_id: Uuid) -> MockAccountRepository {
        let mut repo = MockAccountRepository::new();
        repo.expect_find()
            .withf(move |_, uid| *uid == user_id)
            .returning(move |_, uid| {
                let found = account(uid, AccountKind::Savings, false);
                Box::pin(async move { Ok(Some(found)) })
            });
        repo.expect_list_balances().returning(|_, _| {
            let entry = |amount, date| BalanceEntry {
                id: Uuid::nil(),
                balance: AccountBalance { amount, date },
            };
            Box::pin(async move {
                Ok(vec![
                    entry(dec!(1150), day(5, 31)),
                    entry(dec!(1000), day(3, 31)),
                ])
            })
        });
        repo.expect_daily_movements().returning(|_, _| {
            Box::pin(async {
                Ok([4, 5, 6]
                    .map(|m| DailyMovement {
                        date: day(m, 10),
                        amount: dec!(100),
                    })
                    .to_vec())
            })
        });
        repo
    }

    #[tokio::test]
    async fn list_balances_gives_what_each_one_was_estimated_at() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();

        let resp = send(
            account_with_history(user_id),
            "GET",
            &format!("/accounts/{id}/balances"),
            None,
            user_id,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(
            json,
            serde_json::json!([
                {"id": Uuid::nil(), "amount": "1150", "date": "2026-05-31", "estimated": "1200"},
                {"id": Uuid::nil(), "amount": "1000", "date": "2026-03-31", "estimated": null},
            ])
        );
    }

    #[tokio::test]
    async fn balance_history_follows_the_account_between_two_days() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();

        let resp = send(
            account_with_history(user_id),
            "GET",
            &format!("/accounts/{id}/balance-history?from=2026-05-01&to=2026-06-30"),
            None,
            user_id,
        )
        .await;

        assert_eq!(resp.status(), StatusCode::OK);
        let json: Vec<BalancePointResponse> = response_json(resp).await;
        let summary: Vec<_> = json
            .iter()
            .map(|p| (p.date, p.balance, p.read, p.estimated))
            .collect();
        assert_eq!(
            summary,
            [
                (day(5, 1), dec!(1100), false, None),
                (day(5, 10), dec!(1200), false, None),
                (day(5, 31), dec!(1150), true, Some(dec!(1200))),
                (day(6, 10), dec!(1250), false, None),
                (day(6, 30), dec!(1250), false, None),
            ]
        );
    }

    #[tokio::test]
    async fn balance_history_rejects_a_reversed_range_and_an_unknown_account() {
        let mut unknown = MockAccountRepository::new();
        unknown
            .expect_find()
            .returning(|_, _| Box::pin(async { Ok(None) }));
        let id = Uuid::new_v4();
        for (repo, query, status) in [
            (
                MockAccountRepository::new(),
                "from=2026-06-01&to=2026-05-01",
                StatusCode::BAD_REQUEST,
            ),
            (unknown, "to=2026-05-01", StatusCode::NOT_FOUND),
        ] {
            let resp = send(
                repo,
                "GET",
                &format!("/accounts/{id}/balance-history?{query}"),
                None,
                Uuid::new_v4(),
            )
            .await;
            assert_eq!(resp.status(), status, "{query}");
        }
    }

    #[tokio::test]
    async fn update_and_delete_balance_address_it_through_its_account() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let balance_id = Uuid::new_v4();
        let mut repo = MockAccountRepository::new();
        repo.expect_update_balance()
            .withf(move |bid, aid, uid, _| *bid == balance_id && *aid == id && *uid == user_id)
            .returning(|id, _, _, balance| {
                Box::pin(async move { Ok(Some(BalanceEntry { id, balance })) })
            });
        repo.expect_delete_balance()
            .withf(move |bid, aid, uid| *bid == balance_id && *aid == id && *uid == user_id)
            .returning(|_, _, _| Box::pin(async { Ok(true) }));
        let app = app(repo);
        let auth = auth_header(user_id, UserRole::User);
        let uri = format!("/accounts/{id}/balances/{balance_id}");
        let body = serde_json::json!({"amount": "12.5", "date": "2026-01-01"}).to_string();

        let updated = app
            .clone()
            .oneshot(json_request("PUT", &uri, Some(&body), Some(&auth)))
            .await
            .unwrap();
        let deleted = app
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(updated.status(), StatusCode::OK);
        let json: BalanceEntryResponse = response_json(updated).await;
        assert_eq!(json.id, balance_id);
        assert_eq!(json.amount, dec!(12.5));
        assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn account_endpoints_require_authentication() {
        let id = Uuid::new_v4();
        for (method, uri) in [
            ("GET", "/accounts".to_string()),
            ("POST", "/accounts".to_string()),
            ("PUT", format!("/accounts/{id}")),
            ("DELETE", format!("/accounts/{id}")),
            ("GET", format!("/accounts/{id}/balances")),
            ("POST", format!("/accounts/{id}/balances")),
            ("GET", format!("/accounts/{id}/balance-history")),
        ] {
            let resp = app(MockAccountRepository::new())
                .oneshot(json_request(method, &uri, None, None))
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
        }
    }

    #[tokio::test]
    async fn only_an_account_receiving_operations_is_accepted_for_them() {
        let user_id = Uuid::new_v4();
        for (found, ok) in [
            (Some(account(user_id, AccountKind::Checking, true)), true),
            (Some(account(user_id, AccountKind::Checking, false)), false),
            (Some(account(user_id, AccountKind::Savings, false)), false),
            (None, false),
        ] {
            let mut repo = MockAccountRepository::new();
            repo.expect_find().returning(move |_, _| {
                let found = found.clone();
                Box::pin(async move { Ok(found) })
            });

            let result = account_receiving_operations(&repo, Uuid::new_v4(), user_id).await;

            assert_eq!(result.is_ok(), ok);
            if !ok {
                assert!(matches!(result, Err(AppError::BadRequest(_))));
            }
        }
    }

    #[tokio::test]
    async fn only_a_savings_account_is_accepted_for_a_budget() {
        let user_id = Uuid::new_v4();
        for (found, ok) in [
            (Some(account(user_id, AccountKind::Savings, false)), true),
            (Some(account(user_id, AccountKind::Checking, false)), false),
            (None, false),
        ] {
            let mut repo = MockAccountRepository::new();
            repo.expect_find().returning(move |_, _| {
                let found = found.clone();
                Box::pin(async move { Ok(found) })
            });

            let result = ensure_savings_account(&repo, Some(Uuid::new_v4()), user_id).await;

            assert_eq!(result.is_ok(), ok);
            if !ok {
                assert!(matches!(result, Err(AppError::BadRequest(_))));
            }
        }
        let unlinked = ensure_savings_account(&MockAccountRepository::new(), None, user_id).await;
        assert!(unlinked.is_ok());
    }
}
