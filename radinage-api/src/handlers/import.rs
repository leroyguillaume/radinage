use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::operation::{BudgetLink, Operation},
    error::{AppError, AppResult},
    handlers::operations::auto_match_operation,
    repositories::{BudgetRepository, OperationRepository},
    services::importer::{ImportParams, RowError, parse_csv, parse_xlsx},
};
use aide::OperationInput;
use aide::openapi;
use axum::extract::{FromRequest, Multipart, Request};
use axum::{Json, extract::State, http::StatusCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Wrapper around `Multipart` that implements `OperationInput` for aide schema generation.
pub struct MultipartBody(pub Multipart);

impl<S: Send + Sync> FromRequest<S> for MultipartBody {
    type Rejection = <Multipart as FromRequest<S>>::Rejection;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        Multipart::from_request(req, state).await.map(MultipartBody)
    }
}

impl OperationInput for MultipartBody {
    fn operation_input(ctx: &mut aide::generate::GenContext, operation: &mut openapi::Operation) {
        let schema = ctx.schema.subschema_for::<ImportMultipartSchema>();
        operation.request_body = Some(aide::openapi::ReferenceOr::Item(openapi::RequestBody {
            content: indexmap::indexmap! {
                "multipart/form-data".to_string() => openapi::MediaType {
                    schema: Some(aide::openapi::SchemaObject { json_schema: schema, external_docs: None, example: None }),
                    ..Default::default()
                }
            },
            required: true,
            ..Default::default()
        }));
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ImportMultipartSchema {
    /// The file to import (CSV or XLSX)
    #[allow(dead_code)]
    file: String,
    /// Column index for the label (0-based)
    #[allow(dead_code)]
    label_col: usize,
    /// Column index for the amount (0-based)
    #[allow(dead_code)]
    amount_col: usize,
    /// Column index for the date (0-based)
    #[allow(dead_code)]
    date_col: usize,
    /// Date format string (e.g. "%d/%m/%Y")
    #[allow(dead_code)]
    date_format: String,
    /// Number of leading rows to skip before the first data row, including the header (default 0)
    #[allow(dead_code)]
    skip_lines: Option<usize>,
}

/// Result of a bulk import operation.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportResponse {
    /// Number of operations successfully imported.
    pub imported: usize,
    /// Number of duplicate operations skipped.
    pub skipped: usize,
    /// Per-row errors encountered during import (row number + message).
    pub errors: Vec<RowError>,
}

pub async fn import_operations<U, O: OperationRepository, B: BudgetRepository>(
    State(state): State<AppState<U, O, B>>,
    auth_user: AuthUser,
    MultipartBody(mut multipart): MultipartBody,
) -> AppResult<(StatusCode, Json<ImportResponse>)> {
    let user_id = auth_user.id;
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut label_col: Option<usize> = None;
    let mut amount_col: Option<usize> = None;
    let mut date_col: Option<usize> = None;
    let mut date_format: Option<String> = None;
    let mut skip_lines: Option<usize> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                file_name = field.file_name().map(|s| s.to_string());
                file_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("file read error: {e}")))?
                        .to_vec(),
                );
            }
            "labelCol" => {
                label_col = Some(parse_usize_field(
                    &field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("labelCol read error: {e}")))?,
                    "labelCol",
                )?);
            }
            "amountCol" => {
                amount_col = Some(parse_usize_field(
                    &field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("amountCol read error: {e}")))?,
                    "amountCol",
                )?);
            }
            "dateCol" => {
                date_col = Some(parse_usize_field(
                    &field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("dateCol read error: {e}")))?,
                    "dateCol",
                )?);
            }
            "dateFormat" => {
                date_format =
                    Some(field.text().await.map_err(|e| {
                        AppError::BadRequest(format!("dateFormat read error: {e}"))
                    })?);
            }
            "skipLines" => {
                skip_lines = Some(parse_usize_field(
                    &field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("skipLines read error: {e}")))?,
                    "skipLines",
                )?);
            }
            _ => {}
        }
    }

    let bytes = file_bytes.ok_or_else(|| AppError::BadRequest("missing file field".to_string()))?;
    let params = ImportParams {
        label_col: label_col
            .ok_or_else(|| AppError::BadRequest("missing labelCol field".to_string()))?,
        amount_col: amount_col
            .ok_or_else(|| AppError::BadRequest("missing amountCol field".to_string()))?,
        date_col: date_col
            .ok_or_else(|| AppError::BadRequest("missing dateCol field".to_string()))?,
        date_format: date_format
            .ok_or_else(|| AppError::BadRequest("missing dateFormat field".to_string()))?,
        skip_lines: skip_lines.unwrap_or(0),
    };
    let name = file_name.unwrap_or_default();

    let is_xlsx = name.ends_with(".xlsx") || name.ends_with(".xls");
    let result = if is_xlsx {
        parse_xlsx(&bytes, &params)
    } else {
        parse_csv(&bytes, &params)
    };

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut errors = result.errors;

    for parsed_row in result.rows {
        match state
            .operation_repo
            .exists_by_fields(
                user_id,
                parsed_row.amount,
                parsed_row.date,
                &parsed_row.label,
            )
            .await
        {
            Ok(true) => {
                skipped += 1;
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                errors.push(RowError {
                    row: 0,
                    reason: format!("duplicate check error: {e}"),
                });
                continue;
            }
        }

        let id = Uuid::new_v4();
        match state
            .operation_repo
            .insert(
                id,
                user_id,
                parsed_row.amount,
                parsed_row.date,
                None,
                &parsed_row.label,
            )
            .await
        {
            Ok(()) => {
                imported += 1;
                let op = Operation {
                    id,
                    user_id,
                    amount: parsed_row.amount,
                    date: parsed_row.date,
                    effective_date: None,
                    label: parsed_row.label,
                    budget_link: BudgetLink::Unlinked,
                    ignored: false,
                };
                // Best-effort auto-match; don't fail the import on match errors.
                let _ = auto_match_operation(&state.operation_repo, &state.budget_repo, &op).await;
            }
            Err(e) => {
                errors.push(RowError {
                    row: 0,
                    reason: format!("insert error: {e}"),
                });
            }
        }
    }

    Ok((
        StatusCode::OK,
        Json(ImportResponse {
            imported,
            skipped,
            errors,
        }),
    ))
}

fn parse_usize_field(value: &str, field_name: &str) -> Result<usize, AppError> {
    value.trim().parse::<usize>().map_err(|_| {
        AppError::BadRequest(format!(
            "invalid {field_name}: expected a non-negative integer"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            budget::{Budget, BudgetKind, BudgetType},
            user::UserRole,
        },
        repositories::{MockBudgetRepository, MockOperationRepository, MockUserRepository},
        test_util::{auth_header, build_test_router, make_test_state, response_json},
    };
    use axum::body::Body;
    use chrono::Utc;
    use http::Request;
    use rust_decimal::Decimal;
    use tower::ServiceExt;
    use uuid::Uuid;

    fn make_budget(user_id: Uuid) -> Budget {
        Budget {
            id: Uuid::new_v4(),
            user_id,
            label: "B".to_string(),
            budget_type: BudgetType::Expense,
            kind: BudgetKind::Occasional {
                month: 1,
                year: 2024,
                amount: Decimal::ZERO,
            },
            rules: vec![],
            created_at: Utc::now(),
        }
    }

    fn add_text_field(body: &mut Vec<u8>, boundary: &[u8], name: &str, value: &str) {
        body.extend_from_slice(b"--");
        body.extend_from_slice(boundary);
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    fn multipart_body(
        boundary: &str,
        file_name: &str,
        file_bytes: &[u8],
        params: &ImportParams,
    ) -> Vec<u8> {
        let mut body = Vec::new();
        let b = boundary.as_bytes();

        // file field
        body.extend_from_slice(b"--");
        body.extend_from_slice(b);
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n\
                 Content-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(file_bytes);
        body.extend_from_slice(b"\r\n");

        // parameter fields
        add_text_field(&mut body, b, "labelCol", &params.label_col.to_string());
        add_text_field(&mut body, b, "amountCol", &params.amount_col.to_string());
        add_text_field(&mut body, b, "dateCol", &params.date_col.to_string());
        add_text_field(&mut body, b, "dateFormat", &params.date_format);
        if params.skip_lines > 0 {
            add_text_field(&mut body, b, "skipLines", &params.skip_lines.to_string());
        }

        body.extend_from_slice(b"--");
        body.extend_from_slice(b);
        body.extend_from_slice(b"--\r\n");

        body
    }

    fn import_request(
        boundary: &str,
        file_name: &str,
        file_bytes: &[u8],
        params: &ImportParams,
        auth: &str,
    ) -> Request<Body> {
        let body_bytes = multipart_body(boundary, file_name, file_bytes, params);
        Request::builder()
            .method("POST")
            .uri("/operations/import")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .header("authorization", auth)
            .body(Body::from(body_bytes))
            .unwrap()
    }

    fn default_import_params() -> ImportParams {
        ImportParams {
            label_col: 0,
            amount_col: 1,
            date_col: 2,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1, // skip header row
        }
    }

    #[tokio::test]
    async fn import_csv_success_calls_insert_per_row() {
        let user_id = Uuid::new_v4();
        let budget = make_budget(user_id);

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        op_repo
            .expect_exists_by_fields()
            .times(2)
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(2)
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        budget_repo
            .expect_list_all_for_user()
            .times(2)
            .returning(move |_| {
                let budget = budget.clone();
                Box::pin(async { Ok(vec![budget]) })
            });

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let csv = b"label,amount,date\nGroceries,-50.00,15/01/2024\nTransport,-12.50,20/01/2024\n";
        let req = import_request(
            "testboundary",
            "ops.csv",
            csv,
            &default_import_params(),
            &auth,
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportResponse = response_json(resp).await;
        assert_eq!(json.imported, 2);
        assert_eq!(json.skipped, 0);
        assert!(json.errors.is_empty());
    }

    #[tokio::test]
    async fn import_csv_partial_errors_reported() {
        let user_id = Uuid::new_v4();

        let mut op_repo = MockOperationRepository::new();
        let mut budget_repo = MockBudgetRepository::new();

        op_repo
            .expect_exists_by_fields()
            .times(2)
            .returning(|_, _, _, _| Box::pin(async { Ok(false) }));
        op_repo
            .expect_insert()
            .times(2)
            .returning(|_, _, _, _, _, _| Box::pin(async { Ok(()) }));
        budget_repo
            .expect_list_all_for_user()
            .times(2)
            .returning(|_| Box::pin(async { Ok(vec![]) }));

        let app = build_test_router(make_test_state(
            MockUserRepository::new(),
            op_repo,
            budget_repo,
        ));

        let auth = auth_header(user_id, UserRole::User);
        let csv =
            b"label,amount,date\nGroceries,-50.00,15/01/2024\nBadRow,not_a_number,20/01/2024\nTransport,-12.50,21/01/2024\n";
        let req = import_request(
            "testboundary",
            "ops.csv",
            csv,
            &default_import_params(),
            &auth,
        );
        let resp = app.oneshot(req).await.unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportResponse = response_json(resp).await;
        assert_eq!(json.imported, 2);
        assert_eq!(json.errors.len(), 1);
    }
}
