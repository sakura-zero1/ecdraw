use crate::auth;
use crate::error::AppError;
use crate::middleware;
use crate::models::User;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub roles: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateUserInput {
    pub token: String,
    pub username: String,
    pub password: String,
    pub roles: Option<Vec<String>>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateUserInput {
    pub token: String,
    pub id: String,
    pub roles: Option<Vec<String>>,
    pub status: Option<String>,
    pub password: Option<String>,
}

const VALID_ROLES: &[&str] = &[
    "ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER",
    "VIEWER", "DISTRICT_EDITOR", "LINE_EDITOR", "GIS_EDITOR",
];

fn to_user_response(user: &User) -> UserResponse {
    UserResponse {
        id: user.id,
        username: user.username.clone(),
        roles: user.parse_roles(),
        status: user.status.clone(),
        created_at: user.created_at.to_rfc3339(),
        updated_at: user.updated_at.to_rfc3339(),
    }
}

async fn write_audit(pool: &sqlx::PgPool, user_id: &Uuid, action: &str, target_type: &str, target_id: &Uuid, payload: Option<serde_json::Value>) {
    let _ = sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(user_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(payload)
    .execute(pool)
    .await;
}

/// GET /api/users
#[tauri::command]
pub async fn list_users(
    state: State<'_, AppState>,
    input: AuthInput,
) -> Result<Vec<UserResponse>, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    let users = sqlx::query_as::<_, User>(
        "SELECT * FROM users ORDER BY created_at DESC"
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(users.iter().map(to_user_response).collect())
}

/// POST /api/users
#[tauri::command]
pub async fn create_user(
    state: State<'_, AppState>,
    input: CreateUserInput,
) -> Result<UserResponse, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    if input.username.is_empty() || input.password.is_empty() {
        return Err(AppError::BadRequest("用户名和密码不能为空".into()));
    }
    if input.password.len() < 8 {
        return Err(AppError::BadRequest("密码至少需要8位字符".into()));
    }

    let roles = input.roles.unwrap_or_else(|| vec!["VIEWER".into()]);
    for r in &roles {
        if !VALID_ROLES.contains(&r.as_str()) {
            return Err(AppError::BadRequest(format!("无效角色: {}", r)));
        }
    }
    let status = input.status.unwrap_or_else(|| "ACTIVE".into());
    if status != "ACTIVE" && status != "DISABLED" {
        return Err(AppError::BadRequest("状态值无效".into()));
    }

    // Check uniqueness
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE username = $1")
        .bind(&input.username)
        .fetch_one(&state.pool)
        .await?;
    if existing > 0 {
        return Err(AppError::Conflict("用户名已存在".into()));
    }

    let password_hash = auth::hash_password(&input.password)?;
    let roles_str = serde_json::to_string(&roles).unwrap();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&input.username)
    .bind(&password_hash)
    .bind(&roles_str)
    .bind(&status)
    .fetch_one(&state.pool)
    .await?;

    let user_id = claims.sub.parse::<Uuid>().unwrap();
    write_audit(&state.pool, &user_id, "USER_CREATE", "User", &user.id, Some(json!({
        "username": &input.username,
        "roles": &roles,
        "status": &status,
    }))).await;

    Ok(to_user_response(&user))
}

/// PATCH /api/users/:id
#[tauri::command]
pub async fn update_user(
    state: State<'_, AppState>,
    input: UpdateUserInput,
) -> Result<UserResponse, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    let user_id: Uuid = input.id.parse().map_err(|_| AppError::BadRequest("无效的用户ID".into()))?;

    let mut user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("用户不存在".into()))?;

    if let Some(roles) = &input.roles {
        for r in roles {
            if !VALID_ROLES.contains(&r.as_str()) {
                return Err(AppError::BadRequest(format!("无效角色: {}", r)));
            }
        }
        user.roles = serde_json::to_string(roles).unwrap();
    }
    if let Some(status) = &input.status {
        if status != "ACTIVE" && status != "DISABLED" {
            return Err(AppError::BadRequest("状态值无效".into()));
        }
        user.status = status.clone();
    }
    if let Some(password) = &input.password {
        if password.len() < 8 {
            return Err(AppError::BadRequest("密码至少需要8位字符".into()));
        }
        user.password_hash = auth::hash_password(password)?;
    }

    let updated = sqlx::query_as::<_, User>(
        "UPDATE users SET roles = $1, status = $2, password_hash = $3, updated_at = NOW() WHERE id = $4 RETURNING *"
    )
    .bind(&user.roles)
    .bind(&user.status)
    .bind(&user.password_hash)
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    let caller_id = claims.sub.parse::<Uuid>().unwrap();
    write_audit(&state.pool, &caller_id, "USER_UPDATE", "User", &updated.id, Some(json!({
        "roles": user.parse_roles(),
        "status": &updated.status,
    }))).await;

    Ok(to_user_response(&updated))
}
