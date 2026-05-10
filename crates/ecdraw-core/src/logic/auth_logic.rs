use crate::auth;
use crate::error::AppError;
use crate::models::{AuthUser, User};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: AuthUser,
}

pub async fn login(
    pool: &PgPool,
    access_secret: &str,
    refresh_secret: &str,
    username: &str,
    password: &str,
) -> Result<LoginResponse, AppError> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Auth("用户名或密码错误".into()))?;

    if user.status != "ACTIVE" {
        return Err(AppError::Auth("账号已被禁用".into()));
    }

    let valid = auth::verify_password(password, &user.password_hash)?;
    if !valid {
        return Err(AppError::Auth("用户名或密码错误".into()));
    }

    let (access_token, refresh_token) =
        auth::generate_tokens(&user, access_secret, refresh_secret)?;

    Ok(LoginResponse {
        access_token,
        refresh_token,
        user: auth::to_auth_user(&user),
    })
}

pub async fn refresh_token(
    pool: &PgPool,
    refresh_secret: &str,
    access_secret: &str,
    token: &str,
) -> Result<LoginResponse, AppError> {
    let claims = auth::verify_refresh_token(token, refresh_secret)?;
    let user = auth::get_user_from_claims(pool, &claims).await?;

    if user.status != "ACTIVE" {
        return Err(AppError::Auth("账号已被禁用".into()));
    }

    let (access_token, refresh_token) =
        auth::generate_tokens(&user, access_secret, refresh_secret)?;

    Ok(LoginResponse {
        access_token,
        refresh_token,
        user: auth::to_auth_user(&user),
    })
}
