use crate::error::AppError;
use crate::models::{Diagram, ReviewRequest};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_reviews(
    pool: &PgPool,
    user_id: Uuid,
    is_admin: bool,
    status: Option<String>,
    page: i64,
    page_size: i64,
) -> Result<serde_json::Value, AppError> {
    let offset = (page - 1) * page_size;

    let (reviews, total): (Vec<ReviewRequest>, i64) = if is_admin {
        let total = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM review_requests WHERE ($1::text IS NULL OR status = $1)"
        )
        .bind(&status).fetch_one(pool).await?;

        let reviews = sqlx::query_as::<_, ReviewRequest>(
            "SELECT * FROM review_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY submitted_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(&status).bind(page_size).bind(offset)
        .fetch_all(pool).await?;

        (reviews, total)
    } else {
        let total = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM review_requests WHERE (status = 'PENDING' OR reviewer_id = $1) AND ($2::text IS NULL OR status = $2)"
        )
        .bind(user_id).bind(&status).fetch_one(pool).await?;

        let reviews = sqlx::query_as::<_, ReviewRequest>(
            "SELECT * FROM review_requests WHERE (status = 'PENDING' OR reviewer_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY submitted_at DESC LIMIT $3 OFFSET $4"
        )
        .bind(user_id).bind(&status).bind(page_size).bind(offset)
        .fetch_all(pool).await?;

        (reviews, total)
    };

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    let items: Vec<serde_json::Value> = reviews.iter().map(|r| {
        json!({
            "id": r.id,
            "diagramId": r.diagram_id,
            "diagramVersionId": r.diagram_version_id,
            "submitterId": r.submitter_id,
            "reviewerId": r.reviewer_id,
            "status": r.status,
            "comment": r.comment,
            "submittedAt": r.submitted_at,
            "reviewedAt": r.reviewed_at,
        })
    }).collect();

    Ok(json!({
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": total_pages,
    }))
}

pub async fn approve_review(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    comment: Option<String>,
) -> Result<(), AppError> {
    let review = sqlx::query_as::<_, ReviewRequest>("SELECT * FROM review_requests WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("审核请求不存在".into()))?;

    if review.status != "PENDING" {
        return Err(AppError::BadRequest("该审核已处理".into()));
    }

    let diagram = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(review.diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    let mut tx = pool.begin().await?;

    if diagram.status == "PENDING_DELETE" {
        sqlx::query("DELETE FROM diagrams WHERE id = $1").bind(review.diagram_id)
            .execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'REVIEW_APPROVE_DELETE', 'Diagram', $2)"
        )
        .bind(user_id).bind(review.diagram_id)
        .execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1")
            .bind(review.diagram_id).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'REVIEW_APPROVE', 'Diagram', $2)"
        )
        .bind(user_id).bind(review.diagram_id)
        .execute(&mut *tx).await?;

        // Decommission previous ONLINE version, set approved version to ONLINE
        sqlx::query("UPDATE diagram_versions SET status = 'DECOMMISSIONED' WHERE diagram_id = $1 AND status = 'ONLINE'")
            .bind(review.diagram_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE diagram_versions SET status = 'ONLINE', published_at = NOW() WHERE id = $1")
            .bind(review.diagram_version_id).execute(&mut *tx).await?;
    }

    sqlx::query(
        "UPDATE review_requests SET status = 'APPROVED', reviewer_id = $1, comment = $2, reviewed_at = NOW() WHERE id = $3"
    )
    .bind(user_id).bind(&comment).bind(id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

pub async fn reject_review(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    comment: Option<String>,
) -> Result<(), AppError> {
    let review = sqlx::query_as::<_, ReviewRequest>("SELECT * FROM review_requests WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("审核请求不存在".into()))?;

    if review.status != "PENDING" {
        return Err(AppError::BadRequest("该审核已处理".into()));
    }

    let diagram = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(review.diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    let mut tx = pool.begin().await?;

    if diagram.status == "PENDING_DELETE" {
        sqlx::query("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1")
            .bind(review.diagram_id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'REJECTED', updated_at = NOW() WHERE id = $1")
            .bind(review.diagram_id).execute(&mut *tx).await?;
    }

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'REVIEW_REJECT', 'Diagram', $2)"
    )
    .bind(user_id).bind(review.diagram_id)
    .execute(&mut *tx).await?;

    sqlx::query(
        "UPDATE review_requests SET status = 'REJECTED', reviewer_id = $1, comment = $2, reviewed_at = NOW() WHERE id = $3"
    )
    .bind(user_id).bind(&comment).bind(id)
    .execute(&mut *tx).await?;

    sqlx::query("UPDATE diagram_versions SET status = 'REJECTED' WHERE id = $1")
        .bind(review.diagram_version_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}
