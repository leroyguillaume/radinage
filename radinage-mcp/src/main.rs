mod config;
mod openapi;
mod server;

use clap::Parser;
use config::Config;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use serde_json::Value;
use server::RadinageMcpServer;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_new(&config.log_filter).unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let client = reqwest::Client::new();

    // Fetch the OpenAPI specification (public endpoint, no auth needed)
    tracing::info!("Fetching OpenAPI spec from {}", config.api_url);
    let spec = fetch_openapi(&client, &config.api_url).await?;
    tracing::info!("OpenAPI spec loaded");

    let mcp_config = StreamableHttpServerConfig::default().with_stateful_mode(true);

    let server = RadinageMcpServer::new(client, config.api_url, &spec);
    let session_manager = Arc::new(LocalSessionManager::default());

    let service =
        StreamableHttpService::new(move || Ok(server.clone()), session_manager, mcp_config);

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("MCP server listening on {}", config.listen_addr);

    let service = Arc::new(service);
    loop {
        let (stream, _addr) = listener.accept().await?;
        let svc = Arc::clone(&service);
        tokio::spawn(async move {
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(
                    hyper_util::rt::TokioIo::new(stream),
                    hyper::service::service_fn(
                        move |req: hyper::Request<hyper::body::Incoming>| {
                            let svc = Arc::clone(&svc);
                            async move {
                                if req.uri().path() == "/health" {
                                    let body = Full::new(Bytes::from("ok"))
                                        .map_err(|e| match e {})
                                        .boxed();
                                    return Ok::<_, std::convert::Infallible>(
                                        hyper::Response::new(body),
                                    );
                                }
                                Ok::<_, std::convert::Infallible>(svc.handle(req).await)
                            }
                        },
                    ),
                )
                .await
            {
                tracing::error!("connection error: {e}");
            }
        });
    }
}

/// Fetch the OpenAPI specification from the running API (public endpoint).
async fn fetch_openapi(client: &reqwest::Client, api_url: &str) -> anyhow::Result<Value> {
    let url = format!("{api_url}/openapi.json");
    let response = client.get(&url).send().await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("failed to fetch OpenAPI spec (HTTP {status}): {text}");
    }

    let spec: Value = response.json().await?;
    Ok(spec)
}
