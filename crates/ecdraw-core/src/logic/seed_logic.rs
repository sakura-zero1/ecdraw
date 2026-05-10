use crate::auth;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedResult {
    pub success: bool,
    pub message: String,
}

pub async fn seed_admin(pool: &PgPool, username: &str, password: &str) -> Result<SeedResult, AppError> {
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE username = $1"
    )
    .bind(username)
    .fetch_one(pool)
    .await?;

    if existing > 0 {
        return Ok(SeedResult {
            success: true,
            message: format!("管理员用户 '{}' 已存在，跳过创建", username),
        });
    }

    let password_hash = auth::hash_password(password)?;
    let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();

    sqlx::query(
        "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
    )
    .bind(username)
    .bind(&password_hash)
    .bind(&roles)
    .execute(pool)
    .await?;

    Ok(SeedResult {
        success: true,
        message: format!("管理员用户 '{}' 创建成功", username),
    })
}
