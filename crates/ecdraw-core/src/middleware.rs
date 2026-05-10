use crate::auth::{verify_access_token, JwtClaims};
use crate::error::AppError;

/// Verify JWT token and return claims. Called at the top of each protected command.
pub fn verify_auth(token: &str, access_secret: &str) -> Result<JwtClaims, AppError> {
    verify_access_token(token, access_secret)
}

/// Check if claims contain at least one of the required roles.
/// Uses OR logic: user has access if they possess ANY of the required roles.
pub fn require_role(claims: &JwtClaims, roles: &[&str]) -> Result<(), AppError> {
    if claims.roles.iter().any(|r| roles.contains(&r.as_str())) {
        Ok(())
    } else {
        Err(AppError::Forbidden("权限不足".into()))
    }
}

/// All role constants — matching the Express backend's VALID_ROLES
pub const ROLE_ADMIN: &str = "ADMIN";
pub const ROLE_COMPONENT_EDITOR: &str = "COMPONENT_EDITOR";
pub const ROLE_DIAGRAM_EDITOR: &str = "DIAGRAM_EDITOR";
pub const ROLE_REVIEWER: &str = "REVIEWER";
pub const ROLE_DISTRICT_EDITOR: &str = "DISTRICT_EDITOR";
pub const ROLE_LINE_EDITOR: &str = "LINE_EDITOR";
pub const ROLE_GIS_EDITOR: &str = "GIS_EDITOR";
pub const ROLE_VIEWER: &str = "VIEWER";
