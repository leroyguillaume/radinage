use crate::{
    AppState,
    auth::middleware::AuthUser,
    domain::import_profile::{CsvDelimiter, ImportProfile, ImportProfileFields},
    error::{AppError, AppResult},
    repositories::ImportProfileRepository,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{
    DateTime, Utc,
    format::{Item, StrftimeItems},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_NAME_LEN: usize = 100;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/// Body of a create or update: the whole profile, every field replaced on update.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(extend("example" = serde_json::json!({
    "name": "Crédit Agricole — CSV",
    "labelCol": 1,
    "amountCol": 3,
    "dateCol": 0,
    "dateFormat": "%d/%m/%Y",
    "skipLines": 1,
    "csvDelimiter": "semicolon"
})))]
pub struct ImportProfileRequest {
    /// Name shown when picking a profile, unique per user (1 to 100 characters).
    pub name: String,
    /// Column index of the label (0-based).
    pub label_col: usize,
    /// Column index of the amount (0-based).
    pub amount_col: usize,
    /// Column index of the date (0-based).
    pub date_col: usize,
    /// `strftime`-style date format (e.g. "%d/%m/%Y").
    pub date_format: String,
    /// Number of leading rows to skip before the first data row, header included.
    pub skip_lines: usize,
    /// Field separator of CSV files (default `comma`); spreadsheets ignore it.
    #[serde(default)]
    pub csv_delimiter: CsvDelimiter,
}

/// An import profile (omits `userId`).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportProfileResponse {
    pub id: Uuid,
    pub name: String,
    pub label_col: usize,
    pub amount_col: usize,
    pub date_col: usize,
    pub date_format: String,
    pub skip_lines: usize,
    pub csv_delimiter: CsvDelimiter,
    /// When an import last used this profile, null if never.
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<ImportProfile> for ImportProfileResponse {
    fn from(p: ImportProfile) -> Self {
        Self {
            id: p.id,
            name: p.fields.name,
            label_col: p.fields.label_col,
            amount_col: p.fields.amount_col,
            date_col: p.fields.date_col,
            date_format: p.fields.date_format,
            skip_lines: p.fields.skip_lines,
            csv_delimiter: p.fields.csv_delimiter,
            last_used_at: p.last_used_at,
            created_at: p.created_at,
        }
    }
}

impl TryFrom<ImportProfileRequest> for ImportProfileFields {
    type Error = AppError;

    fn try_from(body: ImportProfileRequest) -> AppResult<Self> {
        let name = body.name.trim().to_string();
        if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
            return Err(AppError::BadRequest(format!(
                "name must be 1 to {MAX_NAME_LEN} characters"
            )));
        }
        if body.label_col == body.amount_col
            || body.label_col == body.date_col
            || body.amount_col == body.date_col
        {
            return Err(AppError::BadRequest(
                "labelCol, amountCol and dateCol must be different columns".to_string(),
            ));
        }
        if body.date_format.trim().is_empty()
            || StrftimeItems::new(&body.date_format).any(|item| item == Item::Error)
        {
            return Err(AppError::BadRequest(format!(
                "invalid dateFormat '{}'",
                body.date_format
            )));
        }
        Ok(Self {
            name,
            label_col: body.label_col,
            amount_col: body.amount_col,
            date_col: body.date_col,
            date_format: body.date_format,
            skip_lines: body.skip_lines,
            csv_delimiter: body.csv_delimiter,
        })
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_import_profiles<U, O, B, P: ImportProfileRepository, C>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
) -> AppResult<Json<Vec<ImportProfileResponse>>> {
    let profiles = state.import_profile_repo.list(auth_user.id).await?;
    Ok(Json(
        profiles
            .into_iter()
            .map(ImportProfileResponse::from)
            .collect(),
    ))
}

pub async fn create_import_profile<U, O, B, P: ImportProfileRepository, C>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
    Json(body): Json<ImportProfileRequest>,
) -> AppResult<(StatusCode, Json<ImportProfileResponse>)> {
    let fields = ImportProfileFields::try_from(body)?;
    let max = state.config.max_import_profiles_per_user;
    if state.import_profile_repo.count(auth_user.id).await? >= i64::from(max) {
        return Err(AppError::Conflict(format!(
            "import profile limit reached ({max})"
        )));
    }
    let profile = state
        .import_profile_repo
        .create(auth_user.id, &fields)
        .await?;
    Ok((StatusCode::CREATED, Json(profile.into())))
}

pub async fn update_import_profile<U, O, B, P: ImportProfileRepository, C>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ImportProfileRequest>,
) -> AppResult<Json<ImportProfileResponse>> {
    let fields = ImportProfileFields::try_from(body)?;
    let profile = state
        .import_profile_repo
        .update(id, auth_user.id, &fields)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(profile.into()))
}

pub async fn delete_import_profile<U, O, B, P: ImportProfileRepository, C>(
    State(state): State<AppState<U, O, B, P, C>>,
    auth_user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    if !state.import_profile_repo.delete(id, auth_user.id).await? {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::user::UserRole,
        repositories::{
            MockBudgetRepository, MockImportProfileRepository, MockOperationRepository,
            MockUserRepository,
        },
        test_util::{
            auth_header, build_test_router, json_request, make_test_state_with_profiles,
            response_json,
        },
    };
    use tower::ServiceExt;

    fn request() -> ImportProfileRequest {
        ImportProfileRequest {
            name: "  Bank  ".to_string(),
            label_col: 1,
            amount_col: 3,
            date_col: 0,
            date_format: "%d/%m/%Y".to_string(),
            skip_lines: 1,
            csv_delimiter: CsvDelimiter::Semicolon,
        }
    }

    fn profile(user_id: Uuid, fields: ImportProfileFields) -> ImportProfile {
        ImportProfile {
            id: Uuid::new_v4(),
            user_id,
            fields,
            last_used_at: None,
            created_at: Utc::now(),
        }
    }

    fn app(profile_repo: MockImportProfileRepository) -> axum::Router {
        build_test_router(make_test_state_with_profiles(
            MockUserRepository::new(),
            MockOperationRepository::new(),
            MockBudgetRepository::new(),
            profile_repo,
        ))
    }

    fn body(req: &ImportProfileRequest) -> String {
        serde_json::to_string(req).unwrap()
    }

    #[test]
    fn request_is_trimmed_into_fields() {
        let fields = ImportProfileFields::try_from(request()).unwrap();
        assert_eq!(fields.name, "Bank");
        assert_eq!(fields.skip_lines, 1);
    }

    #[test]
    fn missing_delimiter_defaults_to_comma() {
        let req: ImportProfileRequest = serde_json::from_value(serde_json::json!({
            "name": "Bank",
            "labelCol": 1,
            "amountCol": 3,
            "dateCol": 0,
            "dateFormat": "%d/%m/%Y",
            "skipLines": 1
        }))
        .unwrap();
        assert_eq!(req.csv_delimiter, CsvDelimiter::Comma);
    }

    #[test]
    fn blank_or_overlong_name_is_rejected() {
        for name in ["   ", &"x".repeat(MAX_NAME_LEN + 1)] {
            let req = ImportProfileRequest {
                name: name.to_string(),
                ..request()
            };
            assert!(matches!(
                ImportProfileFields::try_from(req),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[test]
    fn shared_column_is_rejected() {
        let req = ImportProfileRequest {
            amount_col: 1,
            ..request()
        };
        assert!(matches!(
            ImportProfileFields::try_from(req),
            Err(AppError::BadRequest(_))
        ));
    }

    #[test]
    fn invalid_date_format_is_rejected() {
        for date_format in ["", "%d/%Q/%Y"] {
            let req = ImportProfileRequest {
                date_format: date_format.to_string(),
                ..request()
            };
            assert!(matches!(
                ImportProfileFields::try_from(req),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[tokio::test]
    async fn list_returns_profiles_without_user_id() {
        let user_id = Uuid::new_v4();
        let existing = profile(user_id, ImportProfileFields::try_from(request()).unwrap());
        let mut repo = MockImportProfileRepository::new();
        repo.expect_list()
            .withf(move |id| *id == user_id)
            .returning(move |_| {
                let existing = existing.clone();
                Box::pin(async move { Ok(vec![existing]) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let resp = app(repo)
            .oneshot(json_request("GET", "/import-profiles", None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: serde_json::Value = response_json(resp).await;
        assert_eq!(json[0]["name"], "Bank");
        assert_eq!(json[0]["dateFormat"], "%d/%m/%Y");
        assert_eq!(json[0]["csvDelimiter"], "semicolon");
        assert!(json[0].get("userId").is_none());
    }

    #[tokio::test]
    async fn create_stores_validated_fields() {
        let user_id = Uuid::new_v4();
        let mut repo = MockImportProfileRepository::new();
        repo.expect_count().returning(|_| Box::pin(async { Ok(0) }));
        repo.expect_create()
            .withf(|_, fields| fields.name == "Bank")
            .returning(move |user_id, fields| {
                let created = profile(user_id, fields.clone());
                Box::pin(async move { Ok(created) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/import-profiles",
                Some(&body(&request())),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let json: ImportProfileResponse = response_json(resp).await;
        assert_eq!(json.name, "Bank");
    }

    #[tokio::test]
    async fn create_beyond_limit_is_a_conflict() {
        let mut repo = MockImportProfileRepository::new();
        repo.expect_count()
            .returning(|_| Box::pin(async { Ok(20) }));
        repo.expect_create().never();

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/import-profiles",
                Some(&body(&request())),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn create_invalid_body_is_a_bad_request() {
        let mut repo = MockImportProfileRepository::new();
        repo.expect_create().never();
        let req = ImportProfileRequest {
            date_col: 1,
            ..request()
        };

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "POST",
                "/import-profiles",
                Some(&body(&req)),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn update_unknown_profile_is_not_found() {
        let mut repo = MockImportProfileRepository::new();
        repo.expect_update()
            .returning(|_, _, _| Box::pin(async { Ok(None) }));

        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let resp = app(repo)
            .oneshot(json_request(
                "PUT",
                &format!("/import-profiles/{}", Uuid::new_v4()),
                Some(&body(&request())),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn update_returns_new_fields() {
        let user_id = Uuid::new_v4();
        let id = Uuid::new_v4();
        let mut repo = MockImportProfileRepository::new();
        repo.expect_update()
            .withf(move |pid, uid, _| *pid == id && *uid == user_id)
            .returning(|id, user_id, fields| {
                let updated = ImportProfile {
                    id,
                    ..profile(user_id, fields.clone())
                };
                Box::pin(async move { Ok(Some(updated)) })
            });

        let auth = auth_header(user_id, UserRole::User);
        let req = ImportProfileRequest {
            skip_lines: 3,
            ..request()
        };
        let resp = app(repo)
            .oneshot(json_request(
                "PUT",
                &format!("/import-profiles/{id}"),
                Some(&body(&req)),
                Some(&auth),
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json: ImportProfileResponse = response_json(resp).await;
        assert_eq!(json.id, id);
        assert_eq!(json.skip_lines, 3);
    }

    #[tokio::test]
    async fn delete_returns_no_content_then_not_found() {
        let mut repo = MockImportProfileRepository::new();
        let mut calls = 0;
        repo.expect_delete().times(2).returning(move |_, _| {
            calls += 1;
            let found = calls == 1;
            Box::pin(async move { Ok(found) })
        });
        let app = app(repo);
        let auth = auth_header(Uuid::new_v4(), UserRole::User);
        let uri = format!("/import-profiles/{}", Uuid::new_v4());

        let first = app
            .clone()
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();
        let second = app
            .oneshot(json_request("DELETE", &uri, None, Some(&auth)))
            .await
            .unwrap();

        assert_eq!(first.status(), StatusCode::NO_CONTENT);
        assert_eq!(second.status(), StatusCode::NOT_FOUND);
    }
}
