use clap::Parser;

/// Radinage MCP server — exposes the Radinage API as MCP tools.
///
/// Tools are dynamically generated from the API's OpenAPI specification.
#[derive(Parser, Debug, Clone)]
#[command(name = "radinage-mcp")]
pub struct Config {
    /// Base URL of the Radinage API (e.g. http://localhost:3000).
    #[arg(long, env = "RADINAGE_API_URL")]
    pub api_url: String,

    /// Address to listen on for the MCP HTTP server.
    #[arg(long, env = "LISTEN_ADDR", default_value = "0.0.0.0:3001")]
    pub listen_addr: String,

    /// Log level filter (e.g. info, debug, warn).
    #[arg(long, env = "LOG_FILTER", default_value = "info")]
    pub log_filter: String,
}
