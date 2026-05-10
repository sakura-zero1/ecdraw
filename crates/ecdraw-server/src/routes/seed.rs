use axum::{Router, routing::post, Json, extract::State};
use ecdraw_core::logic::seed_logic::{self, SeedResult};
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;

async fn seed_admin(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<SeedResult>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN"])?;
    let username = std::env::var("SEED_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
    let password = std::env::var("SEED_ADMIN_PASSWORD").unwrap_or_else(|_| "Admin123456".into());
    let result = seed_logic::seed_admin(&state.pool, &username, &password).await?;
    Ok(Json(result))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(seed_admin))
}
