use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct AuditWithUser {
    id: Uuid,
    user_id: Uuid,
    action: String,
    target_type: String,
    target_id: Uuid,
    payload: Option<serde_json::Value>,
    created_at: chrono::DateTime<chrono::Utc>,
    username: String,
}

/// GET /api/audits
#[tauri::command]
pub async fn list_audits(
    state: State<'_, AppState>,
    token: String,
    action: Option<String>,
    target_type: Option<String>,
    target_id: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;

    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(20).min(100).max(1);
    let offset = (page - 1) * page_size;

    let tid = target_id.as_ref().and_then(|s| s.parse::<Uuid>().ok());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target_type = $2) AND ($3::uuid IS NULL OR target_id = $3::uuid)"
    )
    .bind(&action).bind(&target_type).bind(tid)
    .fetch_one(&state.pool).await?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    let logs = sqlx::query_as::<_, AuditWithUser>(
        "SELECT a.*, u.username FROM audit_logs a JOIN users u ON u.id = a.user_id WHERE ($1::text IS NULL OR a.action = $1) AND ($2::text IS NULL OR a.target_type = $2) AND ($3::uuid IS NULL OR a.target_id = $3::uuid) ORDER BY a.created_at DESC LIMIT $4 OFFSET $5"
    )
    .bind(&action).bind(&target_type).bind(tid)
    .bind(page_size).bind(offset)
    .fetch_all(&state.pool).await?;

    let items_json: Vec<serde_json::Value> = logs.iter().map(|a| {
        json!({
            "id": a.id,
            "userId": a.user_id,
            "action": a.action,
            "targetType": a.target_type,
            "targetId": a.target_id,
            "payload": a.payload,
            "createdAt": a.created_at,
            "user": { "id": a.user_id, "username": a.username }
        })
    }).collect();

    Ok(json!({
        "items": items_json,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
    }))
}
