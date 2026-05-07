use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    /// JSON-serialized string array, e.g. '["ADMIN","VIEWER"]'
    pub roles: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl User {
    pub fn parse_roles(&self) -> Vec<String> {
        serde_json::from_str(&self.roles).unwrap_or_else(|_| {
            // fallback: treat as single role
            vec![self.roles.clone()]
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
    pub roles: Vec<String>,
}
