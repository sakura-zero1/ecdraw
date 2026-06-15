use axum::{Router, routing::get, routing::post, Json, extract::{Path, Query, State}};
use ecdraw_core::logic::review_logic;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct ListReviewsQuery {
    status: Option<String>,
    page: Option<i64>,
    #[serde(alias = "pageSize")]
    page_size: Option<i64>,
}

#[derive(Deserialize)]
pub struct ReviewActionBody {
    comment: Option<String>,
}

async fn list_reviews(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Query(q): Query<ListReviewsQuery>) -> Result<Json<serde_json::Value>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).min(100).max(1);
    let result = review_logic::list_reviews(&state.pool, user_id, is_admin, q.status, page, page_size).await?;
    Ok(Json(result))
}

async fn approve_review(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<ReviewActionBody>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let rid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的审核ID".into()))?;
    review_logic::approve_review(&state.pool, user_id, rid, body.comment).await?;
    Ok(())
}

async fn reject_review(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<ReviewActionBody>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let rid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的审核ID".into()))?;
    review_logic::reject_review(&state.pool, user_id, rid, body.comment).await?;
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_reviews))
        .route("/{id}/approve", post(approve_review))
        .route("/{id}/reject", post(reject_review))
}
