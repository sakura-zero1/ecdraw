use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub id: Uuid,
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ComponentVersion {
    pub id: Uuid,
    pub component_id: Uuid,
    pub version_no: i32,
    pub snapshot: serde_json::Value,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ComponentCategory {
    pub id: Uuid,
    pub name: String,
    pub label: String,
    pub color: String,
    pub built_in: bool,
    pub created_at: DateTime<Utc>,
}
