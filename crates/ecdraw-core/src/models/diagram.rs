use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Diagram {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub owner_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiagramVersion {
    pub id: Uuid,
    pub diagram_id: Uuid,
    pub version_no: i32,
    pub snapshot: serde_json::Value,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub status: String,
    pub published_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiagramInstance {
    pub id: Uuid,
    pub diagram_id: Uuid,
    pub component_id: Uuid,
    pub label: String,
    pub position_x: f64,
    pub position_y: f64,
    pub instance_data: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiagramEdge {
    pub id: Uuid,
    pub diagram_id: Uuid,
    pub source_instance_id: Uuid,
    pub target_instance_id: Uuid,
    pub source_pin_id: String,
    pub target_pin_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
