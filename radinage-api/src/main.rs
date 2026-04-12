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
use repositories::{PgBudgetRepository, PgOperationRepository, PgUserRepository, UserRepository};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

/// Inner application state holding repositories and configuration.
pub struct AppStateInner<U, O, B> {
    pub user_repo: U,
    pub operation_repo: O,
    pub budget_repo: B,
    pub config: Config,
}

/// Shared application state available to all handlers.
///
/// Wrapped in [`Arc`] so that it is cheaply cloneable (required by Axum)
/// without requiring `Clone` on the repository implementations.
pub struct AppState<U, O, B> {
    inner: Arc<AppStateInner<U, O, B>>,
}

impl<U, O, B> Clone for AppState<U, O, B> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<U, O, B> std::ops::Deref for AppState<U, O, B> {
    type Target = AppStateInner<U, O, B>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<U, O, B> AppState<U, O, B> {
    pub fn new(user_repo: U, operation_repo: O, budget_repo: B, config: Config) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                user_repo,
                operation_repo,
                budget_repo,
                config,
            }),
        }
    }
}

impl<U, O, B> axum::extract::FromRef<AppState<U, O, B>> for Config {
    fn from_ref(state: &AppState<U, O, B>) -> Config {
        state.config.clone()
    }
}

/// Concrete application state used in production.
pub type ProdAppState = AppState<PgUserRepository, PgOperationRepository, PgBudgetRepository>;

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
        PgBudgetRepository::new(pool),
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

pub(crate) fn build_router<U, O, B>(state: AppState<U, O, B>) -> Router
where
    U: repositories::UserRepository + 'static,
    O: repositories::OperationRepository + 'static,
    B: repositories::BudgetRepository + 'static,
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
                name: "Summary".to_string(),
                description: Some("Compute monthly financial summaries. Returns the total expected budget, actual spending per budget type, and the amount of unbudgeted expenses for a given month.".to_string()),
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
        // Operations
        .api_route(
            "/operations",
            get_with(handlers::operations::list_operations, |op| {
                op.tag("Operations")
                    .summary("List operations")
                    .description("Retrieve a paginated list of bank operations for the authenticated user. Supports filtering by date range, amount range, label search, and budget linkage status. Results are ordered by date descending.")
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
                    .description("Bulk-import bank operations from a CSV or XLSX file uploaded as multipart form data. Duplicate operations (same date, amount, and label) are automatically skipped. Returns the number of imported and skipped operations.")
                    .id("importOperations")
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
                    .description("Update the amount, date, or label of an existing bank operation. All fields in the request body are required and will replace the current values.")
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
                    .description("Associate a bank operation with a budget category. If the operation is already linked to a different budget, the link is updated to the new budget.")
                    .id("linkBudget")
            })
            .delete_with(handlers::operations::unlink_budget, |op| {
                op.tag("Operations")
                    .summary("Unlink an operation from its budget")
                    .description("Remove the budget association from a bank operation. The operation itself is not deleted.")
                    .id("unlinkBudget")
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
                    .description("Create a new budget category. A budget can include matcher rules (keywords or patterns) that are used to automatically link operations when applying budget rules.")
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
                    .description("Update the name, amount, or matcher rules of an existing budget category. All fields in the request body are required and will replace the current values.")
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
                    .description("Run the matcher rules of a budget against all unlinked operations of the authenticated user. Operations whose label matches the budget's rules are automatically linked to it. Returns the number of newly linked operations.")
                    .id("applyBudget")
            }),
        )
        // Monthly operations
        .api_route(
            "/operations/monthly/{year}/{month}",
            get_with(handlers::monthly_operations::get_monthly_operations, |op| {
                op.tag("Operations")
                    .summary("Get operations for a month")
                    .description("Retrieve all bank operations for the given year and month (unpaginated), together with the monthly budget override amount if one is defined for that month.")
                    .id("getMonthlyOperations")
            }),
        )
        // Summary
        .api_route(
            "/summary",
            get_with(handlers::summary::get_summary, |op| {
                op.tag("Summary")
                    .summary("Get financial summary over a month range")
                    .description("Compute monthly expense and income totals for each month in the given range (inclusive). Ignored operations are excluded.")
                    .id("getSummary")
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
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
    };
    use axum::{Router, routing};
    use http::Request;
    use serde::de::DeserializeOwned;
    use uuid::Uuid;

    /// Concrete test state using mock repositories.
    pub type TestState =
        AppState<MockUserRepository, MockOperationRepository, MockBudgetRepository>;

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
        AppState::new(user_repo, op_repo, budget_repo, make_test_config())
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
