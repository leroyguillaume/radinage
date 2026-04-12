use rmcp::model::{JsonObject, Tool};
use serde_json::Value;
use std::borrow::Cow;
use std::sync::Arc;

/// An API operation extracted from the OpenAPI spec, ready to be called.
#[derive(Debug, Clone)]
pub struct ApiOperation {
    /// The HTTP method (GET, POST, PUT, DELETE).
    pub method: String,
    /// The path template (e.g. `/operations/{id}`).
    pub path_template: String,
    /// Names of parameters that appear in the path.
    pub path_params: Vec<String>,
    /// Names of parameters that appear in the query string.
    pub query_params: Vec<String>,
    /// Whether this operation accepts a JSON request body.
    pub has_body: bool,
    /// Names of fields in the request body (for separating body from path/query).
    pub body_fields: Vec<String>,
}

/// Resolve a JSON `$ref` pointer (e.g. `#/components/schemas/Foo`) in the spec.
fn resolve_ref<'a>(spec: &'a Value, ref_path: &str) -> &'a Value {
    let path = ref_path.trim_start_matches("#/");
    let mut current = spec;
    for part in path.split('/') {
        current = &current[part];
    }
    current
}

/// Recursively resolve all `$ref` pointers in a JSON Schema value,
/// inlining the referenced definitions from the spec.
fn resolve_schema(spec: &Value, schema: &Value) -> Value {
    if let Some(ref_path) = schema.get("$ref").and_then(|v| v.as_str()) {
        let resolved = resolve_ref(spec, ref_path);
        return resolve_schema(spec, resolved);
    }

    match schema {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, val) in map {
                out.insert(key.clone(), resolve_schema(spec, val));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(|v| resolve_schema(spec, v)).collect()),
        other => other.clone(),
    }
}

/// Endpoints to skip — these are handled internally or are not useful via MCP.
const SKIPPED_OPERATIONS: &[&str] = &["login", "activate", "importOperations"];

/// Parse the OpenAPI spec and produce a list of `(Tool, ApiOperation)` pairs.
pub fn tools_from_openapi(spec: &Value) -> Vec<(Tool, ApiOperation)> {
    let paths = match spec.get("paths").and_then(|p| p.as_object()) {
        Some(p) => p,
        None => return Vec::new(),
    };

    let mut result = Vec::new();

    for (path, path_item) in paths {
        let methods = match path_item.as_object() {
            Some(m) => m,
            None => continue,
        };

        for (method, operation) in methods {
            // Skip non-HTTP-method keys (e.g. "parameters", "summary")
            if !matches!(method.as_str(), "get" | "post" | "put" | "delete" | "patch") {
                continue;
            }

            let operation_id = match operation.get("operationId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };

            if SKIPPED_OPERATIONS.contains(&operation_id) {
                continue;
            }

            let summary = operation
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let description = operation
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let tool_description = if description.is_empty() {
                summary.to_string()
            } else if summary.is_empty() {
                description.to_string()
            } else {
                format!("{summary}\n\n{description}")
            };

            // Collect parameters (path + query)
            let mut path_params = Vec::new();
            let mut query_params = Vec::new();
            let mut schema_properties = serde_json::Map::new();
            let mut required_fields: Vec<Value> = Vec::new();

            if let Some(params) = operation.get("parameters").and_then(|p| p.as_array()) {
                for param in params {
                    let name = match param.get("name").and_then(|n| n.as_str()) {
                        Some(n) => n.to_string(),
                        None => continue,
                    };
                    let location = param.get("in").and_then(|v| v.as_str()).unwrap_or("");

                    let param_schema = param
                        .get("schema")
                        .map(|s| resolve_schema(spec, s))
                        .unwrap_or_else(|| serde_json::json!({"type": "string"}));

                    // Build a property entry with description if available
                    let mut prop = match param_schema {
                        Value::Object(m) => m,
                        _ => serde_json::Map::new(),
                    };
                    if let Some(desc) = param.get("description").and_then(|d| d.as_str()) {
                        prop.insert("description".to_string(), Value::String(desc.to_string()));
                    }

                    let is_required = param
                        .get("required")
                        .and_then(|r| r.as_bool())
                        .unwrap_or(location == "path");

                    if is_required {
                        required_fields.push(Value::String(name.clone()));
                    }

                    schema_properties.insert(name.clone(), Value::Object(prop));

                    match location {
                        "path" => path_params.push(name),
                        "query" => query_params.push(name),
                        _ => {}
                    }
                }
            }

            // Collect request body fields
            let mut has_body = false;
            let mut body_fields = Vec::new();

            if let Some(body_schema) = operation
                .get("requestBody")
                .and_then(|rb| rb.get("content"))
                .and_then(|c| c.get("application/json"))
                .and_then(|j| j.get("schema"))
            {
                let resolved = resolve_schema(spec, body_schema);
                if let Some(props) = resolved.get("properties").and_then(|p| p.as_object()) {
                    has_body = true;
                    for (key, val) in props {
                        body_fields.push(key.clone());
                        schema_properties.insert(key.clone(), val.clone());
                    }

                    // Merge required fields from the body schema
                    if let Some(req) = resolved.get("required").and_then(|r| r.as_array()) {
                        for r in req {
                            if !required_fields.contains(r) {
                                required_fields.push(r.clone());
                            }
                        }
                    }
                }
            }

            // Build the combined input schema
            let mut input_schema_map = serde_json::Map::new();
            input_schema_map.insert("type".to_string(), Value::String("object".to_string()));
            input_schema_map.insert("properties".to_string(), Value::Object(schema_properties));
            if !required_fields.is_empty() {
                input_schema_map.insert("required".to_string(), Value::Array(required_fields));
            }

            let input_schema: JsonObject = input_schema_map;

            let mut tool = Tool::new(
                Cow::Owned(operation_id.to_string()),
                "",
                Arc::new(input_schema),
            );
            tool.description = Some(Cow::Owned(tool_description));

            let api_op = ApiOperation {
                method: method.to_uppercase(),
                path_template: path.clone(),
                path_params,
                query_params,
                has_body,
                body_fields,
            };

            result.push((tool, api_op));
        }
    }

    result
}

/// Build a full URL and optional JSON body from tool arguments and an `ApiOperation`.
pub fn build_request(
    base_url: &str,
    op: &ApiOperation,
    arguments: &JsonObject,
) -> (String, Option<Value>) {
    // Substitute path parameters
    let mut url_path = op.path_template.clone();
    for param in &op.path_params {
        if let Some(val) = arguments.get(param) {
            let val_str = match val {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            url_path = url_path.replace(&format!("{{{param}}}"), &val_str);
        }
    }

    // Build query string
    let mut query_parts = Vec::new();
    for param in &op.query_params {
        if let Some(val) = arguments.get(param) {
            let val_str = match val {
                Value::String(s) => s.clone(),
                Value::Null => continue,
                other => other.to_string(),
            };
            query_parts.push(format!("{}={}", urlencoding(param), urlencoding(&val_str)));
        }
    }

    let url = if query_parts.is_empty() {
        format!("{base_url}{url_path}")
    } else {
        format!("{base_url}{url_path}?{}", query_parts.join("&"))
    };

    // Build request body
    let body = if op.has_body {
        let mut body_map = serde_json::Map::new();
        for field in &op.body_fields {
            if let Some(val) = arguments.get(field) {
                body_map.insert(field.clone(), val.clone());
            }
        }
        Some(Value::Object(body_map))
    } else {
        None
    };

    (url, body)
}

/// Minimal percent-encoding for query parameter keys and values.
fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => result.push(ch),
            _ => {
                for byte in ch.to_string().as_bytes() {
                    result.push_str(&format!("%{byte:02X}"));
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_spec() -> Value {
        serde_json::json!({
            "openapi": "3.1.0",
            "info": { "title": "Test", "version": "0.1.0" },
            "paths": {
                "/operations": {
                    "get": {
                        "operationId": "listOperations",
                        "summary": "List operations",
                        "description": "Retrieve paginated operations.",
                        "parameters": [
                            {
                                "name": "page",
                                "in": "query",
                                "schema": { "type": "integer" }
                            },
                            {
                                "name": "pageSize",
                                "in": "query",
                                "schema": { "type": "integer" }
                            }
                        ]
                    },
                    "post": {
                        "operationId": "createOperation",
                        "summary": "Create an operation",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/CreateOperationRequest"
                                    }
                                }
                            }
                        }
                    }
                },
                "/operations/{id}": {
                    "get": {
                        "operationId": "getOperation",
                        "summary": "Get an operation",
                        "parameters": [
                            {
                                "name": "id",
                                "in": "path",
                                "required": true,
                                "schema": { "type": "string", "format": "uuid" }
                            }
                        ]
                    }
                },
                "/auth/login": {
                    "post": {
                        "operationId": "login",
                        "summary": "Login"
                    }
                }
            },
            "components": {
                "schemas": {
                    "CreateOperationRequest": {
                        "type": "object",
                        "properties": {
                            "amount": { "type": "string" },
                            "date": { "type": "string", "format": "date" },
                            "label": { "type": "string" }
                        },
                        "required": ["amount", "date", "label"]
                    }
                }
            }
        })
    }

    #[test]
    fn parses_tools_from_spec() {
        let spec = sample_spec();
        let tools = tools_from_openapi(&spec);

        // login is skipped
        assert_eq!(tools.len(), 3);

        let names: Vec<&str> = tools.iter().map(|(t, _)| t.name.as_ref()).collect();
        assert!(names.contains(&"listOperations"));
        assert!(names.contains(&"createOperation"));
        assert!(names.contains(&"getOperation"));
        assert!(!names.contains(&"login"));
    }

    #[test]
    fn resolves_ref_in_body() {
        let spec = sample_spec();
        let tools = tools_from_openapi(&spec);

        let (tool, op) = tools
            .iter()
            .find(|(t, _)| t.name.as_ref() == "createOperation")
            .unwrap();

        assert!(op.has_body);
        assert!(op.body_fields.contains(&"amount".to_string()));
        assert!(op.body_fields.contains(&"date".to_string()));
        assert!(op.body_fields.contains(&"label".to_string()));

        // Input schema should have the body fields
        let props = tool.input_schema.get("properties").unwrap();
        assert!(props.get("amount").is_some());
    }

    #[test]
    fn builds_request_with_path_and_query() {
        let op = ApiOperation {
            method: "GET".to_string(),
            path_template: "/operations/{id}".to_string(),
            path_params: vec!["id".to_string()],
            query_params: vec!["page".to_string()],
            has_body: false,
            body_fields: Vec::new(),
        };

        let mut args = JsonObject::new();
        args.insert("id".to_string(), Value::String("abc-123".to_string()));
        args.insert("page".to_string(), Value::Number(2.into()));

        let (url, body) = build_request("http://localhost:3000", &op, &args);
        assert_eq!(url, "http://localhost:3000/operations/abc-123?page=2");
        assert!(body.is_none());
    }

    #[test]
    fn builds_request_with_body() {
        let op = ApiOperation {
            method: "POST".to_string(),
            path_template: "/operations".to_string(),
            path_params: Vec::new(),
            query_params: Vec::new(),
            has_body: true,
            body_fields: vec![
                "amount".to_string(),
                "date".to_string(),
                "label".to_string(),
            ],
        };

        let mut args = JsonObject::new();
        args.insert("amount".to_string(), Value::String("-42.50".to_string()));
        args.insert("date".to_string(), Value::String("2026-01-15".to_string()));
        args.insert("label".to_string(), Value::String("Groceries".to_string()));

        let (url, body) = build_request("http://localhost:3000", &op, &args);
        assert_eq!(url, "http://localhost:3000/operations");
        let body = body.unwrap();
        assert_eq!(body["amount"], "-42.50");
        assert_eq!(body["label"], "Groceries");
    }
}
