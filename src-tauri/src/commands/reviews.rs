use crate::error::AppError;
use crate::middleware;
use crate::models::{Diagram, ReviewRequest};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListReviewsInput {
    pub token: String,
    pub status: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewResponse {
    #[serde(flatten)]
    pub review: ReviewRequest,
    pub diagram_name: Option<String>,
    pub diagram_status: Option<String>,
    pub version_no: Option<i32>,
}

/// GET /api/reviews
#[tauri::command]
pub async fn list_reviews(
    state: State<'_, AppState>,
    input: ListReviewsInput,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    let page = input.page.unwrap_or(1).max(1);
    let page_size = input.page_size.unwrap_or(20).min(100).max(1);
    let offset = (page - 1) * page_size;

    let (reviews, total): (Vec<ReviewRequest>, i64) = if claims.roles.contains(&"ADMIN".to_string()) {
        let total = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM review_requests WHERE ($1::text IS NULL OR status = $1)"
        )
        .bind(&input.status).fetch_one(&state.pool).await?;

        let reviews = sqlx::query_as::<_, ReviewRequest>(
            "SELECT * FROM review_requests WHERE ($1::text IS NULL OR status = $1) ORDER BY submitted_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(&input.status).bind(page_size).bind(offset)
        .fetch_all(&state.pool).await?;

        (reviews, total)
    } else {
        let total = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM review_requests WHERE (status = 'PENDING' OR reviewer_id = $1) AND ($2::text IS NULL OR status = $2)"
        )
        .bind(user_id).bind(&input.status).fetch_one(&state.pool).await?;

        let reviews = sqlx::query_as::<_, ReviewRequest>(
            "SELECT * FROM review_requests WHERE (status = 'PENDING' OR reviewer_id = $1) AND ($2::text IS NULL OR status = $2) ORDER BY submitted_at DESC LIMIT $3 OFFSET $4"
        )
        .bind(user_id).bind(&input.status).bind(page_size).bind(offset)
        .fetch_all(&state.pool).await?;

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

/// POST /api/reviews/:id/approve
#[tauri::command]
pub async fn approve_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
    comment: Option<String>,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let rid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的审核ID".into()))?;

    let review = sqlx::query_as::<_, ReviewRequest>("SELECT * FROM review_requests WHERE id = $1")
        .bind(rid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("审核请求不存在".into()))?;

    if review.status != "PENDING" {
        return Err(AppError::BadRequest("该审核已处理".into()));
    }

    let diagram = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(review.diagram_id).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    let mut tx = state.pool.begin().await?;

    if diagram.status == "PENDING_DELETE" {
        // Approve deletion -> delete the diagram
        sqlx::query("DELETE FROM diagrams WHERE id = $1").bind(review.diagram_id)
            .execute(&mut *tx).await?;
        // Audit
        sqlx::query(
            "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'REVIEW_APPROVE_DELETE', 'Diagram', $2)"
        )
        .bind(user_id).bind(review.diagram_id)
        .execute(&mut *tx).await?;
    } else {
        // Approve publish
        sqlx::query("UPDATE diagrams SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1")
            .bind(review.diagram_id).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'REVIEW_APPROVE', 'Diagram', $2)"
        )
        .bind(user_id).bind(review.diagram_id)
        .execute(&mut *tx).await?;
    }

    sqlx::query(
        "UPDATE review_requests SET status = 'APPROVED', reviewer_id = $1, comment = $2, reviewed_at = NOW() WHERE id = $3"
    )
    .bind(user_id).bind(&comment).bind(rid)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

/// POST /api/reviews/:id/reject
#[tauri::command]
pub async fn reject_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
    comment: Option<String>,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let rid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的审核ID".into()))?;

    let review = sqlx::query_as::<_, ReviewRequest>("SELECT * FROM review_requests WHERE id = $1")
        .bind(rid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("审核请求不存在".into()))?;

    if review.status != "PENDING" {
        return Err(AppError::BadRequest("该审核已处理".into()));
    }

    let diagram = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(review.diagram_id).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    let mut tx = state.pool.begin().await?;

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
    .bind(user_id).bind(&comment).bind(rid)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}
