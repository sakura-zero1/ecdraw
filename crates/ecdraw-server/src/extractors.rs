use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    Json,
};
use ecdraw_core::middleware::verify_auth;
use ecdraw_core::AppState;
use serde_json::json;

/// JWT claims extracted from the Authorization header.
pub struct AuthClaims(pub ecdraw_core::auth::JwtClaims);

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthClaims {
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| {
                (StatusCode::UNAUTHORIZED, Json(json!({"message": "未提供认证令牌", "kind": "AUTH"})))
            })?;
        let claims = verify_auth(token, &state.jwt_access_secret).map_err(|e| {
            (StatusCode::UNAUTHORIZED, Json(json!({"message": e.to_string(), "kind": "AUTH"})))
        })?;
        Ok(AuthClaims(claims))
    }
}
