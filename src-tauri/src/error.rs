use serde::Serialize;

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
