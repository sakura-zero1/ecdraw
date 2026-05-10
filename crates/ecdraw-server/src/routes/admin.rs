use axum::{Router, routing::get, Json, extract::State};
use ecdraw_core::logic::admin_logic;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;

async fn dashboard_stats(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<serde_json::Value>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN"])?;
    let stats = admin_logic::dashboard_stats(&state.pool).await?;
    Ok(Json(stats))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/dashboard", get(dashboard_stats))
}
