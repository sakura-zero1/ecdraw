use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    pub id: Uuid,
    pub diagram_id: Uuid,
    pub diagram_version_id: Uuid,
    pub submitter_id: Uuid,
    pub reviewer_id: Option<Uuid>,
    pub status: String,
    pub comment: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
}
