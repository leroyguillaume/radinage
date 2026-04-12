use clap::Parser;
use std::time::Duration;

#[derive(Parser, Clone, Debug)]
#[command(name = "radinage-api", about = "Radinage bank tracking API")]
pub struct Config {
    /// PostgreSQL connection URL.
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: String,

    /// HTTP listen address.
    #[arg(long, env = "LISTEN_ADDR", default_value = "0.0.0.0:3000")]
    pub listen_addr: String,

    /// Tracing filter directive (e.g. "info", "radinage_api=debug,tower_http=trace").
    #[arg(long, env = "LOG_FILTER", default_value = "info")]
    pub log_filter: String,

    /// Emit logs in JSON format.
    #[arg(long, env = "LOG_JSON", default_value_t = false)]
    pub log_json: bool,

    /// JWT signing secret.
    #[arg(long, env = "JWT_SECRET")]
    pub jwt_secret: String,

    /// JWT token expiration in seconds.
    #[arg(long, env = "JWT_EXPIRATION_SECS", default_value_t = 86400)]
    pub jwt_expiration_secs: u64,

    /// Admin account username (used for initial seeding).
    #[arg(long, env = "ADMIN_USERNAME", default_value = "admin")]
    pub admin_username: String,

    /// Admin account password (used for initial seeding).
    #[arg(long, env = "ADMIN_PASSWORD")]
    pub admin_password: String,

    /// Allowed CORS origins (comma-separated). If empty, all origins are allowed.
    #[arg(long, env = "CORS_ORIGINS", value_delimiter = ',')]
    pub cors_origins: Vec<String>,

    /// Maximum number of budgets a single user can create.
    #[arg(long, env = "MAX_BUDGETS_PER_USER", default_value_t = 100)]
    pub max_budgets_per_user: u32,

    /// Root path prefix for all API routes (e.g. "api/v1"). Empty by default.
    /// A leading "/" is stripped automatically.
    #[arg(long, env = "ROOT_PATH", default_value = "")]
    pub root_path: String,

    /// Base URL of the web application, used to generate invitation links.
    /// Example: "https://radinage.example.com"
    #[arg(long, env = "WEBAPP_URL")]
    pub webapp_url: String,
}

impl Config {
    pub fn jwt_expiration(&self) -> Duration {
        Duration::from_secs(self.jwt_expiration_secs)
    }

    /// Returns the normalized root path with a leading "/" suitable for nesting.
    /// Returns `None` when the root path is empty (no nesting needed).
    pub fn normalized_root_path(&self) -> Option<String> {
        let trimmed = self.root_path.trim_start_matches('/');
        if trimmed.is_empty() {
            None
        } else {
            Some(format!("/{trimmed}"))
        }
    }
}
