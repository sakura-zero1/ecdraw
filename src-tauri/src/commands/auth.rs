use crate::auth;
use crate::error::AppError;
use crate::models::{AuthUser, User};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: AuthUser,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshInput {
    pub refresh_token: String,
}

/// POST /api/auth/login
#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    input: LoginInput,
) -> Result<LoginResponse, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(&input.username)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Auth("用户名或密码错误".into()))?;

    if user.status != "ACTIVE" {
        return Err(AppError::Auth("账号已被禁用".into()));
    }

    let valid = auth::verify_password(&input.password, &user.password_hash)?;
    if !valid {
        return Err(AppError::Auth("用户名或密码错误".into()));
    }

    let (access_token, refresh_token) = auth::generate_tokens(
        &user,
        &state.jwt_access_secret,
        &state.jwt_refresh_secret,
    )?;

    Ok(LoginResponse {
        access_token,
        refresh_token,
        user: auth::to_auth_user(&user),
    })
}

/// POST /api/auth/refresh
#[tauri::command]
pub async fn refresh_token(
    state: State<'_, AppState>,
    input: RefreshInput,
) -> Result<LoginResponse, AppError> {
    let claims = auth::verify_refresh_token(&input.refresh_token, &state.jwt_refresh_secret)?;
    let user = auth::get_user_from_claims(&state.pool, &claims).await?;

    if user.status != "ACTIVE" {
        return Err(AppError::Auth("账号已被禁用".into()));
    }

    let (access_token, refresh_token) = auth::generate_tokens(
        &user,
        &state.jwt_access_secret,
        &state.jwt_refresh_secret,
    )?;

    Ok(LoginResponse {
        access_token,
        refresh_token,
        user: auth::to_auth_user(&user),
    })
}
