use aide::OperationOutput;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Database(e) => {
                tracing::error!("database error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
            AppError::Internal(msg) => {
                tracing::error!("internal error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, msg.clone())
            }
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

impl OperationOutput for AppError {
    type Inner = Self;
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    fn status_of(err: AppError) -> StatusCode {
        err.into_response().status()
    }

    #[test]
    fn not_found_is_404() {
        assert_eq!(status_of(AppError::NotFound), StatusCode::NOT_FOUND);
    }

    #[test]
    fn unauthorized_is_401() {
        assert_eq!(status_of(AppError::Unauthorized), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn forbidden_is_403() {
        assert_eq!(status_of(AppError::Forbidden), StatusCode::FORBIDDEN);
    }

    #[test]
    fn bad_request_is_400() {
        assert_eq!(
            status_of(AppError::BadRequest("oops".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn conflict_is_409() {
        assert_eq!(
            status_of(AppError::Conflict("duplicate".to_string())),
            StatusCode::CONFLICT
        );
    }

    #[test]
    fn internal_is_500() {
        assert_eq!(
            status_of(AppError::Internal("boom".to_string())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
