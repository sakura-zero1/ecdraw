use ecdraw_core::auth;
use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::models::User;
use ecdraw_core::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub roles: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
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
    token: String,
) -> Result<Vec<UserResponse>, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
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
    token: String,
    username: String,
    password: String,
    roles: Option<Vec<String>>,
    status: Option<String>,
) -> Result<UserResponse, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    if username.is_empty() || password.is_empty() {
        return Err(AppError::BadRequest("用户名和密码不能为空".into()));
    }
    if password.len() < 8 {
        return Err(AppError::BadRequest("密码至少需要8位字符".into()));
    }

    let roles = roles.unwrap_or_else(|| vec!["VIEWER".into()]);
    for r in &roles {
        if !VALID_ROLES.contains(&r.as_str()) {
            return Err(AppError::BadRequest(format!("无效角色: {}", r)));
        }
    }
    let status = status.unwrap_or_else(|| "ACTIVE".into());
    if status != "ACTIVE" && status != "DISABLED" {
        return Err(AppError::BadRequest("状态值无效".into()));
    }

    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE username = $1")
        .bind(&username)
        .fetch_one(&state.pool)
        .await?;
    if existing > 0 {
        return Err(AppError::Conflict("用户名已存在".into()));
    }

    let password_hash = auth::hash_password(&password)?;
    let roles_str = serde_json::to_string(&roles).unwrap();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&username)
    .bind(&password_hash)
    .bind(&roles_str)
    .bind(&status)
    .fetch_one(&state.pool)
    .await?;

    let caller_id = claims.sub.parse::<Uuid>().unwrap();
    write_audit(&state.pool, &caller_id, "USER_CREATE", "User", &user.id, Some(json!({
        "username": &username,
        "roles": &roles,
        "status": &status,
    }))).await;

    Ok(to_user_response(&user))
}

/// PATCH /api/users/:id
#[tauri::command]
pub async fn update_user(
    state: State<'_, AppState>,
    token: String,
    id: String,
    roles: Option<Vec<String>>,
    status: Option<String>,
    password: Option<String>,
) -> Result<UserResponse, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    let user_id: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的用户ID".into()))?;

    let mut user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("用户不存在".into()))?;

    if let Some(roles) = &roles {
        for r in roles {
            if !VALID_ROLES.contains(&r.as_str()) {
                return Err(AppError::BadRequest(format!("无效角色: {}", r)));
            }
        }
        user.roles = serde_json::to_string(roles).unwrap();
    }
    if let Some(status) = &status {
        if status != "ACTIVE" && status != "DISABLED" {
            return Err(AppError::BadRequest("状态值无效".into()));
        }
        user.status = status.clone();
    }
    if let Some(password) = &password {
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
