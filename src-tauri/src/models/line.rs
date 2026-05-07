use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LineSegmentData {
    pub id: Uuid,
    pub diagram_edge_id: Uuid,
    pub length: Option<f64>,
    pub wire_model: Option<String>,
    pub wire_ownership: Option<String>,
    pub wire_type: Option<String>,
    pub is_main_display: bool,
    pub updated_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
