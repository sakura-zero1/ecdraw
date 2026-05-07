use crate::error::AppError;
use crate::middleware;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

/// GET /api/admin/dashboard
#[tauri::command]
pub async fn dashboard_stats(
    state: State<'_, AppState>,
    input: AuthInput,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
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

    // Diagrams by status
    #[derive(Debug, sqlx::FromRow)]
    struct StatusCount { status: String, count: Option<i64> }
    let status_counts = sqlx::query_as::<_, StatusCount>(
        "SELECT status, COUNT(*) as count FROM diagrams GROUP BY status"
    )
    .fetch_all(&state.pool).await?;
    let diagrams_by_status: Vec<serde_json::Value> = status_counts.iter().map(|sc| {
        json!({ "status": sc.status, "count": sc.count.unwrap_or(0) })
    }).collect();

    // Recent audits
    let recent_audits = sqlx::query_as::<_, crate::models::AuditLog>(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10"
    )
    .fetch_all(&state.pool).await?;

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
        "recentAudits": recent_audits,
    }))
}
