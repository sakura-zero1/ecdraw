use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use serde_json::json;
use tauri::State;
use uuid::Uuid;

/// GET /api/admin/dashboard
#[tauri::command]
pub async fn dashboard_stats(
    state: State<'_, AppState>,
    token: String,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN"])?;

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&state.pool).await?;
    let component_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM components").fetch_one(&state.pool).await?;
    let diagram_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM diagrams").fetch_one(&state.pool).await?;
    let published_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM diagrams WHERE status = 'PUBLISHED'").fetch_one(&state.pool).await?;
    let pending_review_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM review_requests WHERE status = 'PENDING'").fetch_one(&state.pool).await?;
    let instance_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM diagram_instances").fetch_one(&state.pool).await?;
    let edge_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM diagram_edges").fetch_one(&state.pool).await?;
    let district_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM district_data").fetch_one(&state.pool).await?;
    let line_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM line_segment_data").fetch_one(&state.pool).await?;
    let gis_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gis_data").fetch_one(&state.pool).await?;

    #[derive(Debug, sqlx::FromRow)]
    struct StatusCount { status: String, count: Option<i64> }
    let status_counts = sqlx::query_as::<_, StatusCount>(
        "SELECT status, COUNT(*) as count FROM diagrams GROUP BY status"
    )
    .fetch_all(&state.pool).await?;
    let diagrams_by_status: Vec<serde_json::Value> = status_counts.iter().map(|sc| {
        json!({ "status": sc.status, "count": sc.count.unwrap_or(0) })
    }).collect();

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
    let recent_audits = sqlx::query_as::<_, AuditWithUser>(
        "SELECT a.*, u.username FROM audit_logs a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 10"
    )
    .fetch_all(&state.pool).await?;

    let recent_audits_json: Vec<serde_json::Value> = recent_audits.iter().map(|a| {
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
        "userCount": user_count,
        "componentCount": component_count,
        "diagramCount": diagram_count,
        "publishedCount": published_count,
        "pendingReviewCount": pending_review_count,
        "instanceCount": instance_count,
        "edgeCount": edge_count,
        "districtDataCount": district_count,
        "lineDataCount": line_count,
        "gisDataCount": gis_count,
        "diagramsByStatus": diagrams_by_status,
        "recentAudits": recent_audits_json,
    }))
}
