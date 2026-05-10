use serde::Serialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Auth(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("权限不足: {0}")]
    Forbidden(String),

    #[error("请求参数错误: {0}")]
    BadRequest(String),

    #[error("冲突: {0}")]
    Conflict(String),

    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("JWT 错误: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("密码哈希错误: {0}")]
    Bcrypt(#[from] bcrypt::BcryptError),
}

// Implement Serialize so Tauri can return structured errors to frontend
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("message", &self.to_string())?;
        let kind = match self {
            AppError::Auth(_) => "AUTH",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Forbidden(_) => "FORBIDDEN",
            AppError::BadRequest(_) => "BAD_REQUEST",
            AppError::Conflict(_) => "CONFLICT",
            AppError::Database(_) => "DATABASE",
            AppError::Jwt(_) => "JWT",
            AppError::Bcrypt(_) => "BCRYPT",
        };
        state.serialize_field("kind", kind)?;
        state.end()
    }
}

// Implement IntoResponse for axum HTTP server
#[cfg(feature = "axum")]
impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        use axum::Json;

        let (status, kind) = match &self {
            AppError::Auth(_) => (StatusCode::UNAUTHORIZED, "AUTH"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            AppError::Forbidden(_) => (StatusCode::FORBIDDEN, "FORBIDDEN"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST"),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT"),
            AppError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE"),
            AppError::Jwt(_) => (StatusCode::UNAUTHORIZED, "JWT"),
            AppError::Bcrypt(_) => (StatusCode::INTERNAL_SERVER_ERROR, "BCRYPT"),
        };

        let body = json!({
            "message": self.to_string(),
            "kind": kind,
        });

        (status, Json(body)).into_response()
    }
}
