use axum::{Router, routing::get, Json, extract::{Query, State}};
use ecdraw_core::logic::audit_logic;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ListAuditsQuery {
    action: Option<String>,
    #[serde(alias = "targetType")]
    target_type: Option<String>,
    #[serde(alias = "targetId")]
    target_id: Option<String>,
    page: Option<i64>,
    #[serde(alias = "pageSize")]
    page_size: Option<i64>,
}

async fn list_audits(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Query(q): Query<ListAuditsQuery>) -> Result<Json<serde_json::Value>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "REVIEWER"])?;
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).min(100).max(1);
    let result = audit_logic::list_audits(&state.pool, q.action, q.target_type, q.target_id, page, page_size).await?;
    Ok(Json(result))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(list_audits))
}
