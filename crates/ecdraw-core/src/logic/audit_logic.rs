use crate::error::AppError;
use crate::models::AuditLog;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_audits(
    pool: &PgPool,
    action: Option<String>,
    target_type: Option<String>,
    target_id: Option<String>,
    page: i64,
    page_size: i64,
) -> Result<serde_json::Value, AppError> {
    let offset = (page - 1) * page_size;
    let target_uuid = target_id.as_ref().and_then(|s| s.parse::<Uuid>().ok());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target_type = $2) AND ($3::uuid IS NULL OR target_id = $3::uuid)"
    )
    .bind(&action).bind(&target_type)
    .bind(target_uuid)
    .fetch_one(pool).await?;

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    let logs = sqlx::query_as::<_, AuditLog>(
        "SELECT * FROM audit_logs WHERE ($1::text IS NULL OR action = $1) AND ($2::text IS NULL OR target_type = $2) AND ($3::uuid IS NULL OR target_id = $3::uuid) ORDER BY created_at DESC LIMIT $4 OFFSET $5"
    )
    .bind(&action).bind(&target_type)
    .bind(target_uuid)
    .bind(page_size).bind(offset)
    .fetch_all(pool).await?;

    Ok(json!({
        "items": logs,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
    }))
}
