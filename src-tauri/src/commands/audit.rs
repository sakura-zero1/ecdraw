use crate::error::AppError;
use crate::middleware;
use crate::models::AuditLog;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct ListAuditsInput {
    pub token: String,
    pub action: Option<String>,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// GET /api/audits
#[tauri::command]
pub async fn list_audits(
    state: State<'_, AppState>,
    input: ListAuditsInput,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;

    let page = input.page.unwrap_or(1).max(1);
    let page_size = input.page_size.unwrap_or(20).min(100).max(1);
    let offset = (page - 1) * page_size;

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target_type = $2) AND ($3::uuid IS NULL OR target_id = $3::uuid)"
    )
    .bind(&input.action).bind(&input.target_type)
    .bind(input.target_id.as_ref().and_then(|s| s.parse::<Uuid>().ok()))
    .fetch_one(&state.pool).await?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    let logs = sqlx::query_as::<_, AuditLog>(
        "SELECT * FROM audit_logs WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target_type = $2) AND ($3::uuid IS NULL OR target_id = $3::uuid) ORDER BY created_at DESC LIMIT $4 OFFSET $5"
    )
    .bind(&input.action).bind(&input.target_type)
    .bind(input.target_id.as_ref().and_then(|s| s.parse::<Uuid>().ok()))
    .bind(page_size).bind(offset)
    .fetch_all(&state.pool).await?;

    Ok(json!({
        "items": logs,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
    }))
}
