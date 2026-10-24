mod auth;
mod config;
mod db;
mod domain;
mod error;
mod handlers;
mod repositories;
mod schema;
mod services;

use aide::{
    axum::{
        ApiRouter,
        routing::{delete_with, get_with, post_with, put_with},
    },
    openapi::{Info, OpenApi, ReferenceOr, SecurityScheme, Server, Tag},
};
use axum::{Extension, Json, Router, response::Html, routing::get};
use clap::Parser;
use config::Config;
use repositories::{
    PgAccountRepository, PgBudgetRepository, PgCategoryRepository, PgIgnoreRuleRepository,
    PgImportProfileRepository, PgOperationRepository, PgUserRepository, UserRepository,
};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

/// Inner application state holding repositories and configuration.
pub struct AppStateInner<U, O, B, P, C, R, A> {
    pub user_repo: U,
    pub operation_repo: O,
    pub budget_repo: B,
    pub import_profile_repo: P,
    pub category_repo: C,
    pub ignore_rule_repo: R,
    pub account_repo: A,
    pub config: Config,
}

/// Shared application state available to all handlers.
///
/// Wrapped in [`Arc`] so that it is cheaply cloneable (required by Axum)
/// without requiring `Clone` on the repository implementations.
pub struct AppState<U, O, B, P, C, R, A> {
    inner: Arc<AppStateInner<U, O, B, P, C, R, A>>,
}

impl<U, O, B, P, C, R, A> Clone for AppState<U, O, B, P, C, R, A> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<U, O, B, P, C, R, A> std::ops::Deref for AppState<U, O, B, P, C, R, A> {
    type Target = AppStateInner<U, O, B, P, C, R, A>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<U, O, B, P, C, R, A> AppState<U, O, B, P, C, R, A> {
    // One parameter per repository, plus the configuration: a builder would only rename them.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        user_repo: U,
        operation_repo: O,
        budget_repo: B,
        import_profile_repo: P,
        category_repo: C,
        ignore_rule_repo: R,
        account_repo: A,
        config: Config,
    ) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                user_repo,
                operation_repo,
                budget_repo,
                import_profile_repo,
                category_repo,
                ignore_rule_repo,
                account_repo,
                config,
            }),
        }
    }
}

impl<U, O, B, P, C, R, A> axum::extract::FromRef<AppState<U, O, B, P, C, R, A>> for Config {
    fn from_ref(state: &AppState<U, O, B, P, C, R, A>) -> Config {
        state.config.clone()
    }
}

/// Concrete application state used in production.
pub type ProdAppState = AppState<
    PgUserRepository,
    PgOperationRepository,
    PgBudgetRepository,
    PgImportProfileRepository,
    PgCategoryRepository,
    PgIgnoreRuleRepository,
    PgAccountRepository,
>;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::parse();

    let filter = EnvFilter::try_new(&config.log_filter).unwrap_or_default();
    let registry = tracing_subscriber::registry().with(filter);
    if config.log_json {
        registry.with(fmt::layer().json()).init();
    } else {
        registry.with(fmt::layer()).init();
    }

    let pool = db::create_pool(&config.database_url).await?;
    tracing::info!("Connected to database");

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("Migrations applied");

    let user_repo = PgUserRepository::new(pool.clone());
    let password_hash =
        auth::hash_password(&config.admin_password).map_err(|e| anyhow::anyhow!("{e}"))?;
    if user_repo
        .seed_admin(&config.admin_username, &password_hash)
        .await?
    {
        tracing::info!("Admin account '{}' created", config.admin_username);
    }

    let state = AppState::new(
        user_repo,
        PgOperationRepository::new(pool.clone()),
        PgBudgetRepository::new(pool.clone()),
        PgImportProfileRepository::new(pool.clone()),
        PgCategoryRepository::new(pool.clone()),
        PgIgnoreRuleRepository::new(pool.clone()),
        PgAccountRepository::new(pool),
        config.clone(),
    );

    let origins: Vec<_> = config
        .cors_origins
        .iter()
        .map(|o| o.parse().expect("Invalid CORS origin"))
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(Any)
        .allow_headers(Any);

    let api_router = build_router(state);
    let app = if let Some(root) = config.normalized_root_path() {
        Router::new().nest(&root, api_router)
    } else {
        api_router
    }
    .layer(TraceLayer::new_for_http())
    .layer(cors);

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("Listening on {}", config.listen_addr);
    axum::serve(listener, app).await?;
    Ok(())
}

pub(crate) fn build_router<U, O, B, P, C, R, A>(state: AppState<U, O, B, P, C, R, A>) -> Router
where
    U: repositories::UserRepository + 'static,
    O: repositories::OperationRepository + 'static,
    B: repositories::BudgetRepository + 'static,
    P: repositories::ImportProfileRepository + 'static,
    C: repositories::CategoryRepository + 'static,
    R: repositories::IgnoreRuleRepository + 'static,
    A: repositories::AccountRepository + 'static,
{
    aide::generate::on_error(|error| {
        tracing::warn!("aide schema generation error: {error}");
    });
    aide::generate::extract_schemas(true);

    let servers = match state.config.normalized_root_path() {
        Some(root) => vec![Server {
            url: root,
            ..Server::default()
        }],
        None => Vec::new(),
    };

    let mut api = OpenApi {
        info: Info {
            title: "Radinage API".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description: Some("Personal bank account tracking API".to_string()),
            ..Info::default()
        },
        servers,
        tags: vec![
            Tag {
                name: "Auth".to_string(),
                description: Some("Authenticate and obtain a JWT token. The returned token must be sent as a Bearer token in the `Authorization` header of all other requests.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Users".to_string(),
                description: Some("Manage user accounts. Only administrators can create new users.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Accounts".to_string(),
                description: Some("Manage the bank accounts a user follows and the balances read on them. A checking account whose statements are imported holds the operations: its balance is its most recent balance plus the operations dated after it, and the forecast starts from the sum of these accounts. A savings account is worth its most recent balance plus what the savings budgets sending their money to it saved after it, each amount linked to them, negative on the account it is on, adding its opposite. Any other account is worth its most recent balance.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Operations".to_string(),
                description: Some("Create, read, update, delete, and import bank operations (debits and credits). Operations can be linked to budget categories either manually or automatically via matching rules.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Budgets".to_string(),
                description: Some("Manage budget categories used to classify spending. Each budget has a type (expense, income, or savings), a scheduling kind (recurring with periods, or occasional for a single month), and optional auto-matching rules to link operations automatically.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Categories".to_string(),
                description: Some("Manage the categories a user sorts operations into, each with a name, a colour and optional label rules that categorize operations automatically. An operation, or each part of a split one, counts towards its own category, else towards the default category of the budget it is linked to. Categories are independent of budget types and listed by name.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Ignore rules".to_string(),
                description: Some("Manage the rules that ignore operations automatically. A rule matches an operation's label by prefix, suffix or substring, case-insensitively, and optionally its amount whatever the sign. An operation created by hand or by a statement import is ignored by the first of the user's rules, oldest first, that matches it; applying a rule ignores the existing operations it matches.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Import profiles".to_string(),
                description: Some("Manage the named file layouts a user imports bank statements with: which columns hold the label, the amount and the date, the date format, and how many leading rows to skip. Profiles are listed most recently used first.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Summary".to_string(),
                description: Some("Compute monthly financial summaries. Returns the total expected budget, actual spending per budget type, and the amount of unbudgeted expenses for a given month.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Forecast".to_string(),
                description: Some("Project the month-by-month balance over a horizon from actual operations and budgeted amounts.".to_string()),
                ..Tag::default()
            },
            Tag {
                name: "Data".to_string(),
                description: Some("Export and re-import a user's full data (accounts and their balances, categories, budgets, ignore rules, operations and import profiles) as JSON. Intended for backup and account migration.".to_string()),
                ..Tag::default()
            },
        ],
        ..OpenApi::default()
    };

    let router = ApiRouter::new()
        // Health check (no auth)
        .route("/health", get(health))
        // Public
        .api_route(
            "/auth/login",
            post_with(handlers::auth::login, |op| {
                op.tag("Auth")
                    .summary("Login")
                    .description("Authenticate with username and password. Returns a JWT token to use as Bearer authentication on all other endpoints.")
                    .id("login")
            }),
        )
        .api_route(
            "/auth/activate",
            post_with(handlers::auth::activate, |op| {
                op.tag("Auth")
                    .summary("Activate account")
                    .description("Activate a user account created via invitation. Accepts the invitation token and a password. Returns a JWT token for immediate authentication.")
                    .id("activate")
            }),
        )
        // Admin
        .api_route(
            "/users",
            post_with(handlers::users::create_user, |op| {
                op.tag("Users")
                    .summary("Create a user (admin only)")
                    .description("Register a new user account. Requires admin privileges. The created user can then authenticate via the login endpoint.")
                    .id("createUser")
            })
            .get_with(handlers::users::search_users, |op| {
                op.tag("Users")
                    .summary("Search users (admin only)")
                    .description("Search for users by username substring. Returns up to 10 matches, excluding the requesting admin.")
                    .id("searchUsers")
            }),
        )
        .api_route(
            "/users/me/password",
            put_with(handlers::users::change_password, |op| {
                op.tag("Users")
                    .summary("Change own password")
                    .description("Change the authenticated user's password. Requires the current password for verification.")
                    .id("changePassword")
            }),
        )
        .api_route(
            "/users/reset-password",
            post_with(handlers::users::reset_password, |op| {
                op.tag("Users")
                    .summary("Reset a user's password (admin only)")
                    .description("Generate a password reset link for the given user. Requires admin privileges. The user's current password is invalidated immediately.")
                    .id("resetPassword")
            }),
        )
        .api_route(
            "/users/{id}",
            delete_with(handlers::users::delete_user, |op| {
                op.tag("Users")
                    .summary("Delete a user (admin only)")
                    .description("Permanently delete a user and all their data. Requires admin privileges. Cannot delete your own account.")
                    .id("deleteUser")
            }),
        )
        // Accounts
        .api_route(
            "/accounts",
            get_with(handlers::accounts::list_accounts, |op| {
                op.tag("Accounts")
                    .summary("List accounts")
                    .description("Retrieve all accounts of the authenticated user, checking accounts first, then by name, each with its most recent balance and its balance today. A user has at most MAX_ACCOUNTS_PER_USER accounts.")
                    .id("listAccounts")
            })
            .post_with(handlers::accounts::create_account, |op| {
                op.tag("Accounts")
                    .summary("Create an account")
                    .description("Create a checking or savings account. The name is trimmed, 1 to 100 characters long and unique for the user (409 otherwise). Only a checking account can be `imported`, which makes it the account operations are recorded and imported on (400 otherwise). Returns 409 once the user has MAX_ACCOUNTS_PER_USER accounts.")
                    .id("createAccount")
                    .response::<201, Json<handlers::accounts::AccountResponse>>()
            }),
        )
        .api_route(
            "/accounts/{id}",
            put_with(handlers::accounts::update_account, |op| {
                op.tag("Accounts")
                    .summary("Update an account")
                    .description("Replace the name, kind and `imported` flag of an account, with the same rules as creation. An account holding operations or import profiles must stay an imported checking account, one savings budgets send their money to a savings account (409 otherwise). Returns 404 if the account does not exist or belongs to another user.")
                    .id("updateAccount")
            })
            .delete_with(handlers::accounts::delete_account, |op| {
                op.tag("Accounts")
                    .summary("Delete an account")
                    .description("Permanently delete an account and its balances; the savings budgets sending their money to it no longer do. Returns 409 while operations or import profiles point at it, 404 if it does not exist or belongs to another user.")
                    .id("deleteAccount")
            }),
        )
        .api_route(
            "/accounts/{id}/balances",
            get_with(handlers::accounts::list_balances, |op| {
                op.tag("Accounts")
                    .summary("List the balances of an account")
                    .description("Retrieve the balances read on an account, most recent first. Returns 404 if the account does not exist or belongs to another user.")
                    .id("listAccountBalances")
            })
            .post_with(handlers::accounts::add_balance, |op| {
                op.tag("Accounts")
                    .summary("Record a balance of an account")
                    .description("Record the balance shown by the bank at the end of a date, today or earlier (400 otherwise). Operations accounted on that date are considered already included in the amount. The most recent balance is the starting point of an account receiving operations. Returns 409 when the account already has a balance on that date, 404 if it does not exist or belongs to another user.")
                    .id("addAccountBalance")
                    .response::<201, Json<handlers::accounts::BalanceEntryResponse>>()
            }),
        )
        .api_route(
            "/accounts/{id}/balances/{balanceId}",
            put_with(handlers::accounts::update_balance, |op| {
                op.tag("Accounts")
                    .summary("Correct a balance of an account")
                    .description("Replace the amount and date of one balance, with the same rules as recording it. Returns 409 when the account already has another balance on the new date, 404 if the balance is not one of the account's or the account not the user's.")
                    .id("updateAccountBalance")
            })
            .delete_with(handlers::accounts::delete_balance, |op| {
                op.tag("Accounts")
                    .summary("Delete a balance of an account")
                    .description("Remove one balance; the account then starts from its previous one, or from none. Returns 404 if the balance is not one of the account's or the account not the user's.")
                    .id("deleteAccountBalance")
            }),
        )
        // Operations
        .api_route(
            "/operations",
            get_with(handlers::operations::list_operations, |op| {
                op.tag("Operations")
                    .summary("List operations")
                    .description("Retrieve a paginated list of bank operations for the authenticated user, across all dates unless a date range is given. Every filter is optional, a blank `label` included: label search, date range, exact amount, absolute amount bounds (`amountMin`, `amountMax`), `direction` (expenses or income), categories and budgets. `categoryId` and `budgetId` can be repeated and keep the operations counting towards any of them (an unsplit operation through its effective category or budget link, a split one through any of its parts); `uncategorized` adds those without a category. `accountId`, repeatable too, keeps the operations of any of those accounts. `ignored` keeps the operations that are not ignored (`excluded`, the default), the ignored ones alone (`only`) or both (`included`). `totals` aggregates every matching operation, not only the page. Results are ordered by date descending.")
                    .id("listOperations")
            })
            .post_with(handlers::operations::create_operation, |op| {
                op.tag("Operations")
                    .summary("Create an operation")
                    .description("Record a new bank operation (debit or credit) on the authenticated user's imported checking account named by `accountId` (400 when it is not one). The amount should be negative for expenses and positive for income. The first of the user's ignore rules that matches it ignores it.")
                    .id("createOperation")
            }),
        )
        .api_route(
            "/operations/import",
            post_with(handlers::import::import_operations, |op| {
                op.tag("Operations")
                    .summary("Import operations from a file (CSV/XLSX)")
                    .description("Bulk-import bank operations from a CSV or XLSX file uploaded as multipart form data. `accountId` names the imported checking account the operations go to (400 when it is not one); rows matching an operation already on that account by date, amount and label are skipped as duplicates. Returns the number of imported and skipped operations. Each imported operation is ignored by the first of the user's ignore rules that matches it. When `profileId` names one of the user's import profiles, the import is recorded as its last use; the columns, date format and skipped lines still come from the request.")
                    .id("importOperations")
            }),
        )
        .api_route(
            "/operations/import/preview",
            post_with(handlers::import::preview_import, |op| {
                op.tag("Operations")
                    .summary("Preview the first rows of a file to import")
                    .description("Read the first 10 rows of a CSV or XLSX file uploaded as multipart form data, header and skippable lines included, every cell as text, the way an import reads the file. Nothing is stored. Used to pick the columns of an import profile. Returns 400 when the file cannot be read.")
                    .id("previewImport")
            }),
        )
        .api_route(
            "/operations/account",
            put_with(handlers::operations::set_operations_account, |op| {
                op.tag("Operations")
                    .summary("Move several operations to another account")
                    .description("Put each of `operationIds` (1 to 1000) on another of the caller's imported checking accounts, like moving them one by one, in a single request. Identifiers that are not the caller's operations are left out. Returns how many operations changed, 400 if the account is not one of the caller's imported checking accounts or the number of operations is out of bounds.")
                    .id("setOperationsAccount")
            }),
        )
        .api_route(
            "/operations/category",
            put_with(handlers::operations::set_operations_category, |op| {
                op.tag("Operations")
                    .summary("Put several operations in a category")
                    .description("Set the own category of each of `operationIds` (1 to 1000), or clear it when `categoryId` is null, in a single request. Split operations are left out, their parts carry their categories, as are identifiers that are not the caller's operations. Returns how many operations changed, 400 if the category is not one of the caller's or the number of operations is out of bounds.")
                    .id("setOperationsCategory")
            }),
        )
        .api_route(
            "/operations/{id}",
            get_with(handlers::operations::get_operation, |op| {
                op.tag("Operations")
                    .summary("Get an operation")
                    .description("Retrieve a single bank operation by its unique identifier. Returns 404 if the operation does not exist or belongs to another user.")
                    .id("getOperation")
            })
            .put_with(handlers::operations::update_operation, |op| {
                op.tag("Operations")
                    .summary("Update an operation")
                    .description("Update the amount, date, or label of an existing bank operation. All fields in the request body are required and will replace the current values. Returns 409 when the amount of a split operation changes.")
                    .id("updateOperation")
            })
            .delete_with(handlers::operations::delete_operation, |op| {
                op.tag("Operations")
                    .summary("Delete an operation")
                    .description("Permanently delete a bank operation. This also removes any budget link associated with it.")
                    .id("deleteOperation")
            }),
        )
        .api_route(
            "/operations/{id}/budget",
            put_with(handlers::operations::link_budget, |op| {
                op.tag("Operations")
                    .summary("Link an operation to a budget")
                    .description("Associate a bank operation with a budget category. If the operation is already linked to a different budget, the link is updated to the new budget. Returns 409 if the operation is split.")
                    .id("linkBudget")
            })
            .delete_with(handlers::operations::unlink_budget, |op| {
                op.tag("Operations")
                    .summary("Unlink an operation from its budget")
                    .description("Remove the budget association from a bank operation. The operation itself is not deleted. Returns 409 if the operation is split.")
                    .id("unlinkBudget")
            }),
        )
        .api_route(
            "/operations/{id}/category",
            put_with(handlers::operations::set_category, |op| {
                op.tag("Operations")
                    .summary("Put an operation in a category")
                    .description("Set the operation's own category, which takes precedence over its budget's default category. Returns 404 if the operation or the category does not exist or belongs to another user, 409 if the operation is split: its parts carry their categories.")
                    .id("setOperationCategory")
            })
            .delete_with(handlers::operations::clear_category, |op| {
                op.tag("Operations")
                    .summary("Remove an operation's own category")
                    .description("Clear the operation's own category; it then counts towards its budget's default category, if any. Returns 409 if the operation is split.")
                    .id("clearOperationCategory")
            }),
        )
        .api_route(
            "/operations/{id}/account",
            put_with(handlers::operations::set_account, |op| {
                op.tag("Operations")
                    .summary("Move an operation to another account")
                    .description("Put the operation on another of the caller's imported checking accounts. Both accounts' balances follow, unless the operation is dated on or before an account's balance, which already includes it. Returns 400 if the account is not one of the caller's imported checking accounts, 404 if the operation does not exist or belongs to another user.")
                    .id("setOperationAccount")
            }),
        )
        .api_route(
            "/operations/{id}/splits",
            put_with(handlers::operations::replace_splits, |op| {
                op.tag("Operations")
                    .summary("Split an operation")
                    .description("Replace the parts an operation is split into, e.g. a cash withdrawal spread over several budgets. Requires at least 2 parts whose amounts are non-zero, share the operation's sign and sum exactly to the operation amount; each part may reference one of the caller's budgets and one of their categories, or none. The operation's own budget link is reset to unlinked and its own category cleared, and summaries count each part under its own budget and category instead of the operation. Returns 400 on invalid parts, unknown budgets or unknown categories, 404 if the operation does not exist.")
                    .id("replaceOperationSplits")
            })
            .delete_with(handlers::operations::clear_splits, |op| {
                op.tag("Operations")
                    .summary("Remove an operation's splits")
                    .description("Remove all parts of a split operation so that it is accounted as a whole again, unlinked. Idempotent: an operation that is not split is returned unchanged.")
                    .id("clearOperationSplits")
            }),
        )
        .api_route(
            "/operations/{id}/ignore",
            put_with(handlers::operations::ignore_operation, |op| {
                op.tag("Operations")
                    .summary("Ignore an operation")
                    .description("Mark a bank operation as ignored, by hand. Ignored operations are excluded from summaries and budget calculations. An operation an ignore rule ignored no longer records that rule.")
                    .id("ignoreOperation")
            })
            .delete_with(handlers::operations::unignore_operation, |op| {
                op.tag("Operations")
                    .summary("Unignore an operation")
                    .description("Remove the ignored flag from a bank operation, restoring it to normal status, whether it was ignored by hand or by an ignore rule.")
                    .id("unignoreOperation")
            }),
        )
        // Budgets
        .api_route(
            "/budgets",
            get_with(handlers::budgets::list_budgets, |op| {
                op.tag("Budgets")
                    .summary("List budgets")
                    .description("Retrieve all budget categories for the authenticated user. Each budget defines a spending category with an optional amount cap and matching rules for automatic operation classification.")
                    .id("listBudgets")
            })
            .post_with(handlers::budgets::create_budget, |op| {
                op.tag("Budgets")
                    .summary("Create a budget")
                    .description("Create a new budget category. A budget can include matcher rules (keywords or patterns) that are used to automatically link operations when applying budget rules, a default category for the operations linked to it that have none of their own, and, for a savings budget, the savings account its money goes to. Returns 400 when `categoryId` is not one of the caller's categories, or `accountId` is set on a budget that is not a savings one or does not name one of the caller's savings accounts.")
                    .id("createBudget")
            }),
        )
        .api_route(
            "/budgets/{id}",
            get_with(handlers::budgets::get_budget, |op| {
                op.tag("Budgets")
                    .summary("Get a budget")
                    .description("Retrieve a single budget category by its unique identifier. Returns 404 if the budget does not exist or belongs to another user.")
                    .id("getBudget")
            })
            .put_with(handlers::budgets::update_budget, |op| {
                op.tag("Budgets")
                    .summary("Update a budget")
                    .description("Update the name, amount, matcher rules, default category or savings account of an existing budget category. Every field in the request body replaces the current value, an absent `categoryId` clearing the default category and an absent `accountId` the savings account. Returns 400 when `categoryId` is not one of the caller's categories, or `accountId` is set on a budget that is not a savings one or does not name one of the caller's savings accounts.")
                    .id("updateBudget")
            })
            .delete_with(handlers::budgets::delete_budget, |op| {
                op.tag("Budgets")
                    .summary("Delete a budget")
                    .description("Permanently delete a budget category. Operations previously linked to this budget will become unlinked.")
                    .id("deleteBudget")
            }),
        )
        .api_route(
            "/budgets/{id}/apply",
            post_with(handlers::budgets::apply_budget, |op| {
                op.tag("Budgets")
                    .summary("Apply budget rules to operations")
                    .description("Run the matcher rules of a budget against all unlinked operations of the authenticated user. Operations whose label matches the budget's rules are automatically linked to it. Split operations are never touched. Returns the number of newly linked operations.")
                    .id("applyBudget")
            }),
        )
        // Categories
        .api_route(
            "/categories",
            get_with(handlers::categories::list_categories, |op| {
                op.tag("Categories")
                    .summary("List categories")
                    .description("Retrieve all categories of the authenticated user, by name. A user has at most MAX_CATEGORIES_PER_USER categories.")
                    .id("listCategories")
            })
            .post_with(handlers::categories::create_category, |op| {
                op.tag("Categories")
                    .summary("Create a category")
                    .description("Create a named category. The name is trimmed, 1 to 50 characters long (400 otherwise) and unique for the user (409 otherwise). Up to 20 rules, each matching the operation label by prefix, suffix or substring, case-insensitively, give the category to the operations created or imported afterwards that have none of their own; when several categories match, the first by name wins. Returns 409 once the user has MAX_CATEGORIES_PER_USER categories.")
                    .id("createCategory")
                    .response::<201, Json<handlers::categories::CategoryResponse>>()
            }),
        )
        .api_route(
            "/categories/{id}",
            put_with(handlers::categories::update_category, |op| {
                op.tag("Categories")
                    .summary("Update a category")
                    .description("Replace the name, colour, icon and rules of a category, with the same constraints as creation. Returns 404 if the category does not exist or belongs to another user.")
                    .id("updateCategory")
            })
            .delete_with(handlers::categories::delete_category, |op| {
                op.tag("Categories")
                    .summary("Delete a category")
                    .description("Permanently delete a category. The operations, split parts and budgets in it are kept, without a category. Returns 404 if the category does not exist or belongs to another user.")
                    .id("deleteCategory")
            }),
        )
        .api_route(
            "/categories/{id}/apply",
            post_with(handlers::categories::apply_category, |op| {
                op.tag("Categories")
                    .summary("Apply category rules to operations")
                    .description("Run the rules of a category against all operations of the authenticated user and put the matching ones in it, giving them their own category, which takes precedence over their budget's default. Matching operations in another category of their own are skipped unless `force` is true; split operations are never touched. Returns 404 if the category does not exist or belongs to another user.")
                    .id("applyCategory")
            }),
        )
        // Ignore rules
        .api_route(
            "/ignore-rules",
            get_with(handlers::ignore_rules::list_ignore_rules, |op| {
                op.tag("Ignore rules")
                    .summary("List ignore rules")
                    .description("Retrieve all ignore rules of the authenticated user, oldest first: the order they are tried in. A user has at most MAX_IGNORE_RULES_PER_USER rules.")
                    .id("listIgnoreRules")
            })
            .post_with(handlers::ignore_rules::create_ignore_rule, |op| {
                op.tag("Ignore rules")
                    .summary("Create an ignore rule")
                    .description("Create a rule that ignores the operations created from now on whose label, and amount when given, it matches. The pattern value is trimmed and 1 to 200 characters long, the amount positive (400 otherwise). Existing operations are left as they are until the rule is applied. Returns 409 once the user has MAX_IGNORE_RULES_PER_USER rules.")
                    .id("createIgnoreRule")
                    .response::<201, Json<handlers::ignore_rules::IgnoreRuleResponse>>()
            }),
        )
        .api_route(
            "/ignore-rules/{id}",
            put_with(handlers::ignore_rules::update_ignore_rule, |op| {
                op.tag("Ignore rules")
                    .summary("Update an ignore rule")
                    .description("Replace the pattern and amount of a rule, with the same rules as creation. The operations it already ignored stay ignored. Returns 404 if the rule does not exist or belongs to another user.")
                    .id("updateIgnoreRule")
            })
            .delete_with(handlers::ignore_rules::delete_ignore_rule, |op| {
                op.tag("Ignore rules")
                    .summary("Delete an ignore rule")
                    .description("Permanently delete a rule and stop ignoring the operations it ignored; those ignored by hand stay ignored. Returns 404 if the rule does not exist or belongs to another user.")
                    .id("deleteIgnoreRule")
            }),
        )
        .api_route(
            "/ignore-rules/{id}/apply",
            post_with(handlers::ignore_rules::apply_ignore_rule, |op| {
                op.tag("Ignore rules")
                    .summary("Apply an ignore rule to existing operations")
                    .description("Ignore every operation of the authenticated user that the rule matches and that is not ignored yet, split ones included. Returns how many it ignored and how many were already ignored. Returns 404 if the rule does not exist or belongs to another user.")
                    .id("applyIgnoreRule")
            }),
        )
        // Import profiles
        .api_route(
            "/import-profiles",
            get_with(handlers::import_profiles::list_import_profiles, |op| {
                op.tag("Import profiles")
                    .summary("List import profiles")
                    .description("Retrieve all import profiles of the authenticated user, most recently used first, then never-used ones by name. A user has at most MAX_IMPORT_PROFILES_PER_USER profiles.")
                    .id("listImportProfiles")
            })
            .post_with(handlers::import_profiles::create_import_profile, |op| {
                op.tag("Import profiles")
                    .summary("Create an import profile")
                    .description("Create a named import profile. The name is trimmed and must be unique for the user (409 otherwise); `accountId` must name one of the user's imported checking accounts, the label, amount and date columns must be distinct and the date format a valid strftime pattern (400 otherwise). Returns 409 once the user has MAX_IMPORT_PROFILES_PER_USER profiles.")
                    .id("createImportProfile")
                    .response::<201, Json<handlers::import_profiles::ImportProfileResponse>>()
            }),
        )
        .api_route(
            "/import-profiles/{id}",
            put_with(handlers::import_profiles::update_import_profile, |op| {
                op.tag("Import profiles")
                    .summary("Update an import profile")
                    .description("Replace every field of an import profile, with the same rules as creation. Returns 404 if the profile does not exist or belongs to another user.")
                    .id("updateImportProfile")
            })
            .delete_with(handlers::import_profiles::delete_import_profile, |op| {
                op.tag("Import profiles")
                    .summary("Delete an import profile")
                    .description("Permanently delete an import profile. Operations imported with it are kept. Returns 404 if the profile does not exist or belongs to another user.")
                    .id("deleteImportProfile")
            }),
        )
        // Monthly operations
        .api_route(
            "/operations/monthly/{year}/{month}",
            get_with(handlers::monthly_operations::get_monthly_operations, |op| {
                op.tag("Operations")
                    .summary("Get operations for a month")
                    .description("Retrieve all bank operations for the given year and month (unpaginated), together with the monthly budget override amount if one is defined for that month. Ignored operations are excluded unless `includeIgnored` is true.")
                    .id("getMonthlyOperations")
            }),
        )
        // Summary
        .api_route(
            "/summary",
            get_with(handlers::summary::get_summary, |op| {
                op.tag("Summary")
                    .summary("Get financial summary over a month range")
                    .description("Compute monthly expense and income totals for each month in the given range (inclusive). Ignored operations are excluded. A split operation counts through its parts, each under its own budget.")
                    .id("getSummary")
            }),
        )
        .api_route(
            "/summary/categories",
            get_with(handlers::summary::get_category_summary, |op| {
                op.tag("Summary")
                    .summary("Get totals per category over a month range")
                    .description("Sum, for each category, the positive (`income`) and negative (`expense`) amounts accounted in the given range of months (inclusive), most spent first. An operation counts towards its effective category, a split one through each of its parts; the amounts without a category come under a `null` `categoryId`. Ignored operations and amounts linked to a savings budget are excluded. Returns 400 when from is after to.")
                    .id("getCategorySummary")
            }),
        )
        .api_route(
            "/summary/budgets",
            get_with(handlers::summary::get_budget_summary, |op| {
                op.tag("Summary")
                    .summary("Get each budget month by month over a month range")
                    .description("List every budget of the authenticated user with, for each month of the given range (inclusive, at most 24 months), what the budget expects (`expected`, null when nothing) and the net of the amounts linked to it (`actual`), signed like operations. A split operation counts through its parts, each under its own budget; ignored operations are excluded. Returns 400 when from is after to or the range exceeds 24 months.")
                    .id("getBudgetSummary")
            }),
        )
        // Forecast
        .api_route(
            "/forecast",
            get_with(handlers::forecast::get_forecast, |op| {
                op.tag("Forecast")
                    .summary("Forecast monthly balances over a horizon")
                    .description("Project income, expenses, savings, balance and running balance for `months` consecutive months (1 to 24) starting at fromYear/fromMonth. Past months use the operations accounted so far: budget-linked amounts under their budget's type, each unbudgeted operation under income or expenses by its own sign. The current month adds to its operations so far what each budget still expects (`committed`). Future months use the amounts the budgets expect. Unbudgeted spending is forecast at `unbudgetedRate`, the average daily unbudgeted spending of the three complete months before the current one: over the days after today for the current month and over every day of a future month (`unbudgetedForecast`, included in `expenses`). The running balance starts at `startingBalance`: the sum, over the imported checking accounts with a balance, of each one's most recent balance brought to the first day of the horizon by adding its operations accounted after the balance date and before the horizon, or by taking back out those accounted from the horizon start through that date when it is more recent (operations on the balance date are considered included in it); zero when no such account has a balance. Ignored operations are excluded and split operations count through their parts. Status is relative to the server's current date.")
                    .id("getForecast")
            }),
        )
        .api_route(
            "/forecast/{year}/{month}",
            get_with(handlers::forecast::get_forecast_month, |op| {
                op.tag("Forecast")
                    .summary("Break a forecast month down by budget")
                    .description("Detail one month of `GET /forecast` budget by budget. Each budget expecting or receiving something that month lists its expected amount, what is linked to it (`actual`), what is still counted on top (`remaining`) and its weight in the forecast (`projected` = actual + remaining): a past month counts only what was linked, the current month adds what the budget has not reached yet, a future month counts the expected amount. Budgets are sorted by type (income, expense, savings) then by decreasing magnitude of `projected`. The unbudgeted line gives the unbudgeted operations accounted (`actual`) and the spending forecast at the unbudgeted rate (`forecast`). `totals` are the month's figures in `GET /forecast`. Returns 400 for an invalid month.")
                    .id("getForecastMonth")
            }),
        )
        // Data export / import
        .api_route(
            "/data/export",
            get_with(handlers::data::export_data, |op| {
                op.tag("Data")
                    .summary("Export all budgets and operations")
                    .description("Return the authenticated user's full data (accounts and their balances, categories, budgets, ignore rules, operations and import profiles) as a versioned JSON payload. Suitable for backup or migration.")
                    .id("exportData")
            }),
        )
        .api_route(
            "/data/import",
            post_with(handlers::data::import_data, |op| {
                op.tag("Data")
                    .summary("Import budgets and operations from a prior export")
                    .description("Merge budgets and operations from a JSON payload previously obtained via /data/export into the authenticated user's account. Categories are deduplicated by name, budgets by label, ignore rules by pattern and amount, accounts by name, operations by (account, date, amount, label). Category, budget and ignore rule references are remapped to existing or newly-created ones. Returns 409, importing nothing, when the new categories would exceed MAX_CATEGORIES_PER_USER or the new ignore rules MAX_IGNORE_RULES_PER_USER. Accounts the user lacks are created with their balances, those matched by name keep theirs. A savings budget created keeps its account when that maps to a savings account of the user's, and goes without one otherwise. The operations and profiles of an export made before accounts existed go to the user's first imported checking account, or to a new one, which also gets that export's balance when it has none. Returns 400, importing nothing, when an operation or profile would land on an account that does not receive operations, 409 when the new accounts would exceed MAX_ACCOUNTS_PER_USER.")
                    .id("importData")
            }),
        )
        // Documentation
        .route("/docs", get(scalar_docs))
        .finish_api(&mut api)
        .with_state(state);

    // Add Bearer auth security scheme
    let components = api.components.get_or_insert_with(Default::default);
    components.security_schemes.insert(
        "bearerAuth".to_string(),
        ReferenceOr::Item(SecurityScheme::Http {
            scheme: "bearer".to_string(),
            bearer_format: Some("JWT".to_string()),
            description: Some("JWT token obtained from /auth/login".to_string()),
            extensions: Default::default(),
        }),
    );

    let api = Arc::new(api);

    router
        .route("/openapi.json", get(serve_openapi))
        .layer(Extension(api))
}

async fn serve_openapi(Extension(api): Extension<Arc<OpenApi>>) -> Json<OpenApi> {
    Json((*api).clone())
}

async fn health() -> &'static str {
    "ok"
}

async fn scalar_docs() -> Html<&'static str> {
    Html(
        r#"<!DOCTYPE html>
<html>
  <head>
    <title>Radinage API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>"#,
    )
}

/// Shared test utilities available to all `#[cfg(test)]` modules within the crate.
#[cfg(test)]
pub(crate) mod test_util {
    use crate::{
        AppState, auth,
        config::Config,
        domain::{
            account::{Account, AccountFields, AccountKind},
            user::UserRole,
        },
        handlers,
        repositories::{
            MockAccountRepository, MockBudgetRepository, MockCategoryRepository,
            MockIgnoreRuleRepository, MockImportProfileRepository, MockOperationRepository,
            MockUserRepository,
        },
    };
    use axum::{Router, routing};
    use http::Request;
    use serde::de::DeserializeOwned;
    use uuid::Uuid;

    /// Concrete test state using mock repositories.
    pub type TestState = AppState<
        MockUserRepository,
        MockOperationRepository,
        MockBudgetRepository,
        MockImportProfileRepository,
        MockCategoryRepository,
        MockIgnoreRuleRepository,
        MockAccountRepository,
    >;

    pub fn make_test_config() -> Config {
        Config {
            database_url: String::new(),
            listen_addr: "0.0.0.0:3000".to_string(),
            log_filter: "error".to_string(),
            log_json: false,
            jwt_secret: "test-secret-key-at-least-32-bytes!".to_string(),
            jwt_expiration_secs: 3600,
            admin_username: "admin".to_string(),
            admin_password: "admin123".to_string(),
            cors_origins: Vec::new(),
            max_budgets_per_user: 100,
            max_import_profiles_per_user: 20,
            max_categories_per_user: 50,
            max_ignore_rules_per_user: 100,
            max_accounts_per_user: 20,
            root_path: String::new(),
            webapp_url: "http://localhost:5173".to_string(),
        }
    }

    /// Build a test state from mock repositories.
    pub fn make_test_state(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
    ) -> TestState {
        make_test_state_with_profiles(user_repo, op_repo, budget_repo, no_import_profiles())
    }

    /// A profile repository holding none, for tests that only read profiles in passing.
    pub fn no_import_profiles() -> MockImportProfileRepository {
        let mut repo = MockImportProfileRepository::new();
        repo.expect_list()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo
    }

    /// A category repository holding none, for tests that only read categories in passing.
    pub fn no_categories() -> MockCategoryRepository {
        let mut repo = MockCategoryRepository::new();
        repo.expect_list()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo
    }

    /// Build a test state from mock repositories, import profiles included.
    pub fn make_test_state_with_profiles(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        profile_repo: MockImportProfileRepository,
    ) -> TestState {
        make_test_state_with_all(
            user_repo,
            op_repo,
            budget_repo,
            profile_repo,
            no_categories(),
            no_ignore_rules(),
            main_accounts(),
        )
    }

    /// Build a test state from mock repositories, categories included.
    pub fn make_test_state_with_categories(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        category_repo: MockCategoryRepository,
    ) -> TestState {
        make_test_state_with_all(
            user_repo,
            op_repo,
            budget_repo,
            no_import_profiles(),
            category_repo,
            no_ignore_rules(),
            main_accounts(),
        )
    }

    /// An ignore rule repository holding none, for tests that only read rules in passing.
    pub fn no_ignore_rules() -> MockIgnoreRuleRepository {
        let mut repo = MockIgnoreRuleRepository::new();
        repo.expect_list()
            .returning(|_| Box::pin(async { Ok(Vec::new()) }));
        repo
    }

    /// Build a test state from mock repositories, ignore rules included.
    pub fn make_test_state_with_ignore_rules(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        ignore_rule_repo: MockIgnoreRuleRepository,
    ) -> TestState {
        make_test_state_with_all(
            user_repo,
            op_repo,
            budget_repo,
            no_import_profiles(),
            no_categories(),
            ignore_rule_repo,
            main_accounts(),
        )
    }

    /// An imported checking account without balance.
    pub fn main_account(id: Uuid, user_id: Uuid) -> Account {
        Account {
            id,
            user_id,
            fields: AccountFields {
                name: "Main".to_string(),
                kind: AccountKind::Checking,
                imported: true,
            },
            balance: None,
            current_balance: None,
            created_at: chrono::Utc::now(),
        }
    }

    /// An account repository holding a single [`main_account`] of nil id, which it also returns
    /// for any id it is asked to find, for tests that only go through accounts in passing.
    pub fn main_accounts() -> MockAccountRepository {
        let mut repo = MockAccountRepository::new();
        repo.expect_list().returning(|user_id| {
            Box::pin(async move { Ok(vec![main_account(Uuid::nil(), user_id)]) })
        });
        repo.expect_find()
            .returning(|id, user_id| Box::pin(async move { Ok(Some(main_account(id, user_id))) }));
        repo.expect_list_balances()
            .returning(|_, _| Box::pin(async { Ok(Vec::new()) }));
        repo
    }

    /// Build a test state from mock repositories, accounts only.
    pub fn make_test_state_with_accounts(account_repo: MockAccountRepository) -> TestState {
        make_test_state_with_all(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
            no_import_profiles(),
            no_categories(),
            no_ignore_rules(),
            account_repo,
        )
    }

    /// Build a test state from every mock repository.
    pub fn make_test_state_with_all(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        profile_repo: MockImportProfileRepository,
        category_repo: MockCategoryRepository,
        ignore_rule_repo: MockIgnoreRuleRepository,
        account_repo: MockAccountRepository,
    ) -> TestState {
        AppState::new(
            user_repo,
            op_repo,
            budget_repo,
            profile_repo,
            category_repo,
            ignore_rule_repo,
            account_repo,
            make_test_config(),
        )
    }

    /// Build an Axum router wired to mock repositories.
    /// This mirrors `build_router` but avoids `aide` schema generation.
    pub fn build_test_router(state: TestState) -> Router {
        Router::new()
            // Public
            .route("/auth/login", routing::post(handlers::auth::login))
            .route("/auth/activate", routing::post(handlers::auth::activate))
            // Admin
            .route(
                "/users",
                routing::post(handlers::users::create_user).get(handlers::users::search_users),
            )
            .route(
                "/users/me/password",
                routing::put(handlers::users::change_password),
            )
            .route("/users/{id}", routing::delete(handlers::users::delete_user))
            .route(
                "/users/reset-password",
                routing::post(handlers::users::reset_password),
            )
            // Accounts
            .route(
                "/accounts",
                routing::get(handlers::accounts::list_accounts)
                    .post(handlers::accounts::create_account),
            )
            .route(
                "/accounts/{id}",
                routing::put(handlers::accounts::update_account)
                    .delete(handlers::accounts::delete_account),
            )
            .route(
                "/accounts/{id}/balances",
                routing::get(handlers::accounts::list_balances)
                    .post(handlers::accounts::add_balance),
            )
            .route(
                "/accounts/{id}/balances/{balanceId}",
                routing::put(handlers::accounts::update_balance)
                    .delete(handlers::accounts::delete_balance),
            )
            // Operations
            .route(
                "/operations",
                routing::get(handlers::operations::list_operations)
                    .post(handlers::operations::create_operation),
            )
            .route(
                "/operations/import",
                routing::post(handlers::import::import_operations),
            )
            .route(
                "/operations/import/preview",
                routing::post(handlers::import::preview_import),
            )
            .route(
                "/categories",
                routing::get(handlers::categories::list_categories)
                    .post(handlers::categories::create_category),
            )
            .route(
                "/categories/{id}",
                routing::put(handlers::categories::update_category)
                    .delete(handlers::categories::delete_category),
            )
            .route(
                "/categories/{id}/apply",
                routing::post(handlers::categories::apply_category),
            )
            .route(
                "/ignore-rules",
                routing::get(handlers::ignore_rules::list_ignore_rules)
                    .post(handlers::ignore_rules::create_ignore_rule),
            )
            .route(
                "/ignore-rules/{id}",
                routing::put(handlers::ignore_rules::update_ignore_rule)
                    .delete(handlers::ignore_rules::delete_ignore_rule),
            )
            .route(
                "/ignore-rules/{id}/apply",
                routing::post(handlers::ignore_rules::apply_ignore_rule),
            )
            .route(
                "/import-profiles",
                routing::get(handlers::import_profiles::list_import_profiles)
                    .post(handlers::import_profiles::create_import_profile),
            )
            .route(
                "/import-profiles/{id}",
                routing::put(handlers::import_profiles::update_import_profile)
                    .delete(handlers::import_profiles::delete_import_profile),
            )
            .route(
                "/operations/{id}",
                routing::get(handlers::operations::get_operation)
                    .put(handlers::operations::update_operation)
                    .delete(handlers::operations::delete_operation),
            )
            .route(
                "/operations/{id}/budget",
                routing::put(handlers::operations::link_budget)
                    .delete(handlers::operations::unlink_budget),
            )
            .route(
                "/operations/{id}/category",
                routing::put(handlers::operations::set_category)
                    .delete(handlers::operations::clear_category),
            )
            .route(
                "/operations/{id}/account",
                routing::put(handlers::operations::set_account),
            )
            .route(
                "/operations/account",
                routing::put(handlers::operations::set_operations_account),
            )
            .route(
                "/operations/category",
                routing::put(handlers::operations::set_operations_category),
            )
            .route(
                "/operations/{id}/splits",
                routing::put(handlers::operations::replace_splits)
                    .delete(handlers::operations::clear_splits),
            )
            .route(
                "/operations/{id}/ignore",
                routing::put(handlers::operations::ignore_operation)
                    .delete(handlers::operations::unignore_operation),
            )
            // Budgets
            .route(
                "/budgets",
                routing::get(handlers::budgets::list_budgets)
                    .post(handlers::budgets::create_budget),
            )
            .route(
                "/budgets/{id}",
                routing::get(handlers::budgets::get_budget)
                    .put(handlers::budgets::update_budget)
                    .delete(handlers::budgets::delete_budget),
            )
            .route(
                "/budgets/{id}/apply",
                routing::post(handlers::budgets::apply_budget),
            )
            // Monthly operations
            .route(
                "/operations/monthly/{year}/{month}",
                routing::get(handlers::monthly_operations::get_monthly_operations),
            )
            // Summary
            .route("/summary", routing::get(handlers::summary::get_summary))
            .route(
                "/summary/categories",
                routing::get(handlers::summary::get_category_summary),
            )
            .route(
                "/summary/budgets",
                routing::get(handlers::summary::get_budget_summary),
            )
            .route("/forecast", routing::get(handlers::forecast::get_forecast))
            .route(
                "/forecast/{year}/{month}",
                routing::get(handlers::forecast::get_forecast_month),
            )
            // Data export / import
            .route("/data/export", routing::get(handlers::data::export_data))
            .route("/data/import", routing::post(handlers::data::import_data))
            .with_state(state)
    }

    /// Generate a valid `Authorization: Bearer <token>` header value.
    pub fn auth_header(user_id: Uuid, role: UserRole) -> String {
        let config = make_test_config();
        let token = auth::generate_token_from_config(&config, user_id, role).unwrap();
        format!("Bearer {token}")
    }

    /// Build a JSON POST request with optional auth.
    pub fn json_request(
        method: &str,
        uri: &str,
        body: Option<&str>,
        auth: Option<&str>,
    ) -> Request<axum::body::Body> {
        let mut builder = Request::builder().method(method).uri(uri);
        if body.is_some() {
            builder = builder.header("content-type", "application/json");
        }
        if let Some(auth) = auth {
            builder = builder.header("authorization", auth);
        }
        let body = body
            .map(|b| axum::body::Body::from(b.to_string()))
            .unwrap_or_else(axum::body::Body::empty);
        builder.body(body).unwrap()
    }

    /// Extract JSON body from a response.
    pub async fn response_json<T: DeserializeOwned>(response: axum::response::Response) -> T {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        build_router,
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{json_request, make_test_state, response_json},
    };
    use axum::http::StatusCode;
    use tower::ServiceExt;

    #[tokio::test]
    async fn openapi_documents_operation_splits() {
        let app = build_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request("GET", "/openapi.json", None, None))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let doc: serde_json::Value = response_json(resp).await;

        let splits_path = &doc["paths"]["/operations/{id}/splits"];
        assert_eq!(splits_path["put"]["summary"], "Split an operation");
        assert_eq!(
            splits_path["delete"]["summary"],
            "Remove an operation's splits"
        );

        let schemas = &doc["components"]["schemas"];
        assert!(schemas["OperationResponse"]["properties"]["splits"].is_object());
        let split_props = &schemas["OperationSplitResponse"]["properties"];
        for field in ["id", "amount", "budgetId"] {
            assert!(split_props[field].is_object(), "missing {field}");
        }
        assert!(schemas["ReplaceOperationSplitsRequest"]["properties"]["splits"].is_object());
    }

    #[tokio::test]
    async fn openapi_documents_forecast_month() {
        let app = build_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request("GET", "/openapi.json", None, None))
            .await
            .unwrap();
        let doc: serde_json::Value = response_json(resp).await;

        let op = &doc["paths"]["/forecast/{year}/{month}"]["get"];
        assert_eq!(op["operationId"], "getForecastMonth");
        assert_eq!(op["tags"][0], "Forecast");
        let mut params: Vec<&str> = op["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        params.sort_unstable();
        assert_eq!(params, ["month", "year"]);

        let schemas = &doc["components"]["schemas"];
        for field in ["year", "month", "status", "budgets", "unbudgeted", "totals"] {
            assert!(
                schemas["ForecastMonthBreakdownResponse"]["properties"][field].is_object(),
                "missing {field}"
            );
        }
        for field in [
            "budgetId",
            "label",
            "budgetType",
            "expected",
            "actual",
            "remaining",
            "projected",
        ] {
            assert!(
                schemas["BudgetBreakdownResponse"]["properties"][field].is_object(),
                "missing {field}"
            );
        }
    }

    #[tokio::test]
    async fn openapi_documents_forecast() {
        let app = build_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request("GET", "/openapi.json", None, None))
            .await
            .unwrap();
        let doc: serde_json::Value = response_json(resp).await;

        let op = &doc["paths"]["/forecast"]["get"];
        assert_eq!(op["operationId"], "getForecast");
        assert_eq!(op["tags"][0], "Forecast");
        let mut params: Vec<&str> = op["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        params.sort_unstable();
        assert_eq!(params, ["fromMonth", "fromYear", "months"]);

        let schemas = &doc["components"]["schemas"];
        for field in ["months", "totals", "startingBalance", "endBalance"] {
            assert!(
                schemas["ForecastResponse"]["properties"][field].is_object(),
                "missing {field}"
            );
        }
        for field in [
            "year",
            "month",
            "status",
            "income",
            "expenses",
            "savings",
            "balance",
            "cumulative",
        ] {
            assert!(
                schemas["ForecastMonthResponse"]["properties"][field].is_object(),
                "missing {field}"
            );
        }
    }

    #[tokio::test]
    async fn openapi_documents_accounts_and_their_balances() {
        let app = build_router(make_test_state(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
        ));
        let resp = app
            .oneshot(json_request("GET", "/openapi.json", None, None))
            .await
            .unwrap();
        let doc: serde_json::Value = response_json(resp).await;

        let paths = &doc["paths"];
        assert_eq!(paths["/accounts"]["get"]["operationId"], "listAccounts");
        assert_eq!(paths["/accounts"]["post"]["operationId"], "createAccount");
        assert_eq!(
            paths["/accounts/{id}"]["put"]["operationId"],
            "updateAccount"
        );
        assert_eq!(
            paths["/accounts/{id}/balances"]["post"]["operationId"],
            "addAccountBalance"
        );
        assert_eq!(
            paths["/accounts/{id}/balances/{balanceId}"]["delete"]["operationId"],
            "deleteAccountBalance"
        );
        assert!(paths["/users/me/balance"].is_null());
        let schemas = &doc["components"]["schemas"];
        for (schema, fields) in [
            ("AccountBalanceRequest", &["amount", "date"][..]),
            ("BalanceEntryResponse", &["id", "amount", "date"][..]),
            (
                "AccountResponse",
                &["kind", "receivesOperations", "balance", "currentBalance"][..],
            ),
        ] {
            for field in fields {
                assert!(
                    schemas[schema]["properties"][field].is_object(),
                    "missing {schema}.{field}"
                );
            }
        }
    }
}
