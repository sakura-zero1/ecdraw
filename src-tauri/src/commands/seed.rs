use crate::auth;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct SeedResult {
    pub success: bool,
    pub message: String,
}

/// Initialize seed data: create admin user if not exists
#[tauri::command]
pub async fn seed_admin(state: State<'_, AppState>) -> Result<SeedResult, crate::error::AppError> {
    let username = std::env::var("SEED_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
    let password = std::env::var("SEED_ADMIN_PASSWORD").unwrap_or_else(|_| "Admin123456".into());

    // Check if admin already exists
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE username = $1"
    )
    .bind(&username)
    .fetch_one(&state.pool)
    .await?;

    if existing > 0 {
        return Ok(SeedResult {
            success: true,
            message: format!("管理员用户 '{}' 已存在，跳过创建", username),
        });
    }

    let password_hash = auth::hash_password(&password)?;
    let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();

    sqlx::query(
        "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
    )
    .bind(&username)
    .bind(&password_hash)
    .bind(&roles)
    .execute(&state.pool)
    .await?;

    Ok(SeedResult {
        success: true,
        message: format!("管理员用户 '{}' 创建成功", username),
    })
}
