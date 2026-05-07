use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DistrictData {
    pub id: Uuid,
    pub diagram_instance_id: Uuid,
    pub transformer_capacity: Option<f64>,
    pub supply_range: Option<String>,
    pub supply_area: Option<String>,
    pub household_count: Option<i32>,
    pub updated_by: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
