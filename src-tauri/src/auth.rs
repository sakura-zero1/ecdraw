use crate::models::{AuthUser, User};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// JWT claims structure — matches the express backend's TokenUser
#[derive(Debug, Serialize, Deserialize)]
pub struct JwtClaims {
    pub sub: String, // user ID (UUID)
    pub username: String,
    pub roles: Vec<String>,
    pub exp: usize,
}

/// Generate access + refresh token pair
pub fn generate_tokens(user: &User, access_secret: &str, refresh_secret: &str) -> Result<(String, String), crate::error::AppError> {
    let roles = user.parse_roles();
    let now = chrono::Utc::now();
    let access_exp = (now + chrono::Duration::hours(1)).timestamp() as usize;
    let refresh_exp = (now + chrono::Duration::days(7)).timestamp() as usize;

    let access_claims = JwtClaims {
        sub: user.id.to_string(),
        username: user.username.clone(),
        roles: roles.clone(),
        exp: access_exp,
    };
    let refresh_claims = JwtClaims {
        sub: user.id.to_string(),
        username: user.username.clone(),
        roles,
        exp: refresh_exp,
    };

    let access_token = encode(
        &Header::default(),
        &access_claims,
        &EncodingKey::from_secret(access_secret.as_bytes()),
    )?;
    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(refresh_secret.as_bytes()),
    )?;

    Ok((access_token, refresh_token))
}

/// Verify access token and return claims
pub fn verify_access_token(token: &str, secret: &str) -> Result<JwtClaims, crate::error::AppError> {
    let token_data = decode::<JwtClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}

/// Verify refresh token and return claims
pub fn verify_refresh_token(token: &str, secret: &str) -> Result<JwtClaims, crate::error::AppError> {
    verify_access_token(token, secret) // Same logic, different secret
}

/// Hash password with bcrypt (cost 10)
pub fn hash_password(plain: &str) -> Result<String, crate::error::AppError> {
    Ok(bcrypt::hash(plain, 10)?)
}

/// Verify password against bcrypt hash
pub fn verify_password(plain: &str, hash: &str) -> Result<bool, crate::error::AppError> {
    Ok(bcrypt::verify(plain, hash)?)
}

/// Fetch user from database using claims
pub async fn get_user_from_claims(pool: &PgPool, claims: &JwtClaims) -> Result<User, crate::error::AppError> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| crate::error::AppError::Auth("无效的用户ID".into()))?;
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| crate::error::AppError::Auth("用户不存在".into()))?;
    Ok(user)
}

/// Convert User to frontend-friendly AuthUser
pub fn to_auth_user(user: &User) -> AuthUser {
    AuthUser {
        id: user.id,
        username: user.username.clone(),
        roles: user.parse_roles(),
    }
}
