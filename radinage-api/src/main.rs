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
    PgBudgetRepository, PgCategoryRepository, PgImportProfileRepository, PgOperationRepository,
    PgUserRepository, UserRepository,
};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

/// Inner application state holding repositories and configuration.
pub struct AppStateInner<U, O, B, P, C> {
    pub user_repo: U,
    pub operation_repo: O,
    pub budget_repo: B,
    pub import_profile_repo: P,
    pub category_repo: C,
    pub config: Config,
}

/// Shared application state available to all handlers.
///
/// Wrapped in [`Arc`] so that it is cheaply cloneable (required by Axum)
/// without requiring `Clone` on the repository implementations.
pub struct AppState<U, O, B, P, C> {
    inner: Arc<AppStateInner<U, O, B, P, C>>,
}

impl<U, O, B, P, C> Clone for AppState<U, O, B, P, C> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<U, O, B, P, C> std::ops::Deref for AppState<U, O, B, P, C> {
    type Target = AppStateInner<U, O, B, P, C>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<U, O, B, P, C> AppState<U, O, B, P, C> {
    pub fn new(
        user_repo: U,
        operation_repo: O,
        budget_repo: B,
        import_profile_repo: P,
        category_repo: C,
        config: Config,
    ) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                user_repo,
                operation_repo,
                budget_repo,
                import_profile_repo,
                category_repo,
                config,
            }),
        }
    }
}

impl<U, O, B, P, C> axum::extract::FromRef<AppState<U, O, B, P, C>> for Config {
    fn from_ref(state: &AppState<U, O, B, P, C>) -> Config {
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
        PgCategoryRepository::new(pool),
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

pub(crate) fn build_router<U, O, B, P, C>(state: AppState<U, O, B, P, C>) -> Router
where
    U: repositories::UserRepository + 'static,
    O: repositories::OperationRepository + 'static,
    B: repositories::BudgetRepository + 'static,
    P: repositories::ImportProfileRepository + 'static,
    C: repositories::CategoryRepository + 'static,
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
                description: Some("Manage the categories a user sorts operations into, each with a name and a colour. An operation, or each part of a split one, counts towards its own category, else towards the default category of the budget it is linked to. Categories are independent of budget types and listed by name.".to_string()),
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
                description: Some("Export and re-import a user's full data (account balance, categories, budgets, operations and import profiles) as JSON. Intended for backup and account migration.".to_string()),
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
            "/users/me/balance",
            get_with(handlers::users::get_balance, |op| {
                op.tag("Users")
                    .summary("Get own account balance")
                    .description("Return the account balance the authenticated user recorded and the date it was read. Returns 404 when no balance is recorded.")
                    .id("getAccountBalance")
            })
            .put_with(handlers::users::update_balance, |op| {
                op.tag("Users")
                    .summary("Record own account balance")
                    .description("Record the account balance read at a date (today or earlier), replacing any previous one. Operations accounted on that date are considered already included in the amount. Forecasts then start from this balance instead of zero. Returns 400 when the date is in the future.")
                    .id("updateAccountBalance")
            })
            .delete_with(handlers::users::delete_balance, |op| {
                op.tag("Users")
                    .summary("Forget own account balance")
                    .description("Remove the recorded account balance; forecasts start from zero again. Idempotent: returns 204 whether or not a balance was recorded.")
                    .id("deleteAccountBalance")
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
        // Operations
        .api_route(
            "/operations",
            get_with(handlers::operations::list_operations, |op| {
                op.tag("Operations")
                    .summary("List operations")
                    .description("Retrieve a paginated list of bank operations for the authenticated user. Supports filtering by date range, exact amount, label search and category: `categoryId` keeps the operations counting towards that category (an unsplit operation through its effective category, a split one through any of its parts), `uncategorized` those without one; combining both is a 400. Results are ordered by date descending.")
                    .id("listOperations")
            })
            .post_with(handlers::operations::create_operation, |op| {
                op.tag("Operations")
                    .summary("Create an operation")
                    .description("Record a new bank operation (debit or credit) for the authenticated user. The amount should be negative for expenses and positive for income.")
                    .id("createOperation")
            }),
        )
        .api_route(
            "/operations/import",
            post_with(handlers::import::import_operations, |op| {
                op.tag("Operations")
                    .summary("Import operations from a file (CSV/XLSX)")
                    .description("Bulk-import bank operations from a CSV or XLSX file uploaded as multipart form data. Duplicate operations (same date, amount, and label) are automatically skipped. Returns the number of imported and skipped operations. When `profileId` names one of the user's import profiles, the import is recorded as its last use; the columns, date format and skipped lines still come from the request.")
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
                    .description("Mark a bank operation as ignored. Ignored operations are excluded from summaries and budget calculations.")
                    .id("ignoreOperation")
            })
            .delete_with(handlers::operations::unignore_operation, |op| {
                op.tag("Operations")
                    .summary("Unignore an operation")
                    .description("Remove the ignored flag from a bank operation, restoring it to normal status.")
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
                    .description("Create a new budget category. A budget can include matcher rules (keywords or patterns) that are used to automatically link operations when applying budget rules, and a default category for the operations linked to it that have none of their own. Returns 400 when `categoryId` is not one of the caller's categories.")
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
                    .description("Update the name, amount, matcher rules or default category of an existing budget category. Every field in the request body replaces the current value, an absent `categoryId` clearing the default category. Returns 400 when `categoryId` is not one of the caller's categories.")
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
                    .description("Create a named category. The name is trimmed, 1 to 50 characters long (400 otherwise) and unique for the user (409 otherwise). Returns 409 once the user has MAX_CATEGORIES_PER_USER categories.")
                    .id("createCategory")
                    .response::<201, Json<handlers::categories::CategoryResponse>>()
            }),
        )
        .api_route(
            "/categories/{id}",
            put_with(handlers::categories::update_category, |op| {
                op.tag("Categories")
                    .summary("Update a category")
                    .description("Replace the name and colour of a category, with the same rules as creation. Returns 404 if the category does not exist or belongs to another user.")
                    .id("updateCategory")
            })
            .delete_with(handlers::categories::delete_category, |op| {
                op.tag("Categories")
                    .summary("Delete a category")
                    .description("Permanently delete a category. The operations, split parts and budgets in it are kept, without a category. Returns 404 if the category does not exist or belongs to another user.")
                    .id("deleteCategory")
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
                    .description("Create a named import profile. The name is trimmed and must be unique for the user (409 otherwise); the label, amount and date columns must be distinct and the date format a valid strftime pattern (400 otherwise). Returns 409 once the user has MAX_IMPORT_PROFILES_PER_USER profiles.")
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
                    .description("Sum, for each category, the positive (`income`) and negative (`expense`) amounts accounted in the given range of months (inclusive), most spent first. An operation counts towards its effective category, a split one through each of its parts; the amounts without a category come under a `null` `categoryId`. Ignored operations are excluded. Returns 400 when from is after to.")
                    .id("getCategorySummary")
            }),
        )
        // Forecast
        .api_route(
            "/forecast",
            get_with(handlers::forecast::get_forecast, |op| {
                op.tag("Forecast")
                    .summary("Forecast monthly balances over a horizon")
                    .description("Project income, expenses, savings, balance and running balance for `months` consecutive months (1 to 24) starting at fromYear/fromMonth. Past months use the operations accounted so far: budget-linked amounts under their budget's type, each unbudgeted operation under income or expenses by its own sign. The current month adds to its operations so far what each budget still expects (`committed`). Future months use the amounts the budgets expect. Unbudgeted spending is forecast at `unbudgetedRate`, the average daily unbudgeted spending of the three complete months before the current one: over the days after today for the current month and over every day of a future month (`unbudgetedForecast`, included in `expenses`). The running balance starts at `startingBalance`: the balance recorded with PUT /users/me/balance, brought to the first day of the horizon by adding the operations accounted after its date and before the horizon, or by taking back out those accounted from the horizon start through its date when it is more recent (operations on the balance date are considered included in it); zero when no balance is recorded. Ignored operations are excluded and split operations count through their parts. Status is relative to the server's current date.")
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
                    .description("Return the authenticated user's full data (recorded account balance, categories, budgets, operations and import profiles) as a versioned JSON payload. Suitable for backup or migration.")
                    .id("exportData")
            }),
        )
        .api_route(
            "/data/import",
            post_with(handlers::data::import_data, |op| {
                op.tag("Data")
                    .summary("Import budgets and operations from a prior export")
                    .description("Merge budgets and operations from a JSON payload previously obtained via /data/export into the authenticated user's account. Categories are deduplicated by name, budgets by label, operations by (date, amount, label). Category and budget references are remapped to existing or newly-created ones. Returns 409, importing nothing, when the new categories would exceed MAX_CATEGORIES_PER_USER. The payload's account balance, optional, is recorded only when the account has none.")
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
        domain::user::UserRole,
        handlers,
        repositories::{
            MockBudgetRepository, MockCategoryRepository, MockImportProfileRepository,
            MockOperationRepository, MockUserRepository,
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
        )
    }

    /// Build a test state from every mock repository.
    pub fn make_test_state_with_all(
        user_repo: MockUserRepository,
        op_repo: MockOperationRepository,
        budget_repo: MockBudgetRepository,
        profile_repo: MockImportProfileRepository,
        category_repo: MockCategoryRepository,
    ) -> TestState {
        AppState::new(
            user_repo,
            op_repo,
            budget_repo,
            profile_repo,
            category_repo,
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
            .route(
                "/users/me/balance",
                routing::get(handlers::users::get_balance)
                    .put(handlers::users::update_balance)
                    .delete(handlers::users::delete_balance),
            )
            .route("/users/{id}", routing::delete(handlers::users::delete_user))
            .route(
                "/users/reset-password",
                routing::post(handlers::users::reset_password),
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
    async fn openapi_documents_account_balance() {
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

        let path = &doc["paths"]["/users/me/balance"];
        assert_eq!(path["get"]["operationId"], "getAccountBalance");
        assert_eq!(path["put"]["operationId"], "updateAccountBalance");
        assert_eq!(path["delete"]["operationId"], "deleteAccountBalance");
        let schemas = &doc["components"]["schemas"];
        for schema in ["UpdateAccountBalanceRequest", "AccountBalanceResponse"] {
            for field in ["amount", "date"] {
                assert!(
                    schemas[schema]["properties"][field].is_object(),
                    "missing {schema}.{field}"
                );
            }
        }
    }
}
