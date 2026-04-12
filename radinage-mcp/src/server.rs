use crate::openapi::{ApiOperation, build_request, tools_from_openapi};
use rmcp::{
    ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
};
use serde_json::Value;

/// MCP server that dynamically exposes Radinage API endpoints as tools.
///
/// Tools are generated at startup from the API's OpenAPI specification,
/// so any route added to the API is automatically available via MCP.
///
/// The client must send an `Authorization: Bearer <token>` header with
/// its HTTP requests; the token is forwarded as-is to the Radinage API.
#[derive(Clone)]
pub struct RadinageMcpServer {
    client: reqwest::Client,
    api_url: String,
    tools: Vec<Tool>,
    operations: Vec<ApiOperation>,
}

impl RadinageMcpServer {
    /// Create a new server instance.
    ///
    /// `spec` is the parsed OpenAPI JSON from the API's `/openapi.json` endpoint.
    pub fn new(client: reqwest::Client, api_url: String, spec: &Value) -> Self {
        let pairs = tools_from_openapi(spec);
        let (tools, operations): (Vec<_>, Vec<_>) = pairs.into_iter().unzip();

        Self {
            client,
            api_url,
            tools,
            operations,
        }
    }

    /// Find the tool and its corresponding operation by name.
    fn find_operation(&self, name: &str) -> Option<(&Tool, &ApiOperation)> {
        self.tools
            .iter()
            .zip(self.operations.iter())
            .find(|(tool, _)| tool.name.as_ref() == name)
    }
}

/// Extract the `Authorization` header value from the HTTP request parts
/// injected by the streamable HTTP transport.
fn extract_auth_header(context: &RequestContext<rmcp::RoleServer>) -> Option<String> {
    let parts = context.extensions.get::<http::request::Parts>()?;
    let value = parts.headers.get(http::header::AUTHORIZATION)?;
    value.to_str().ok().map(|s| s.to_string())
}

impl ServerHandler for RadinageMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.instructions = Some(
            "Radinage MCP server — personal bank account tracking. \
             Tools are generated from the Radinage API's OpenAPI specification. \
             Requires an Authorization header with a valid JWT token from the Radinage API."
                .to_string(),
        );
        info.server_info = Implementation::from_build_env();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Ok(ListToolsResult {
            tools: self.tools.clone(),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let tool_name = request.name.as_ref();

        let (_, op) = self.find_operation(tool_name).ok_or_else(|| {
            rmcp::ErrorData::invalid_params(format!("unknown tool: {tool_name}"), None)
        })?;

        let auth_header = extract_auth_header(&context).ok_or_else(|| {
            rmcp::ErrorData::invalid_params(
                "missing Authorization header — send a Bearer token obtained from the Radinage API"
                    .to_string(),
                None,
            )
        })?;

        let arguments = request.arguments.unwrap_or_default();
        let (url, body) = build_request(&self.api_url, op, &arguments);

        let mut req = match op.method.as_str() {
            "GET" => self.client.get(&url),
            "POST" => self.client.post(&url),
            "PUT" => self.client.put(&url),
            "DELETE" => self.client.delete(&url),
            "PATCH" => self.client.patch(&url),
            other => {
                return Err(rmcp::ErrorData::invalid_params(
                    format!("unsupported HTTP method: {other}"),
                    None,
                ));
            }
        };

        req = req
            .header("Authorization", &auth_header)
            .header("Accept", "application/json");

        if let Some(body) = body {
            req = req.header("Content-Type", "application/json").json(&body);
        }

        let response = req.send().await.map_err(|e| {
            rmcp::ErrorData::internal_error(format!("HTTP request failed: {e}"), None)
        })?;

        let status = response.status();
        let response_text = response.text().await.map_err(|e| {
            rmcp::ErrorData::internal_error(format!("failed to read response body: {e}"), None)
        })?;

        if status.is_success() {
            // Pretty-print JSON responses for readability
            let text = match serde_json::from_str::<Value>(&response_text) {
                Ok(json) => serde_json::to_string_pretty(&json).unwrap_or(response_text),
                Err(_) => response_text,
            };
            Ok(CallToolResult::success(vec![Content::text(text)]))
        } else {
            let text = format!("API error {status}: {response_text}");
            Ok(CallToolResult::error(vec![Content::text(text)]))
        }
    }
}
