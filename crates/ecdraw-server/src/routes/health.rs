use axum::{Json, response::IntoResponse};
use serde_json::json;

pub fn routes() -> axum::Router<ecdraw_core::AppState> {
    axum::Router::new().route("/health", axum::routing::get(health_check))
}

async fn health_check() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "ecdraw-api",
        "version": "2.0"
    }))
}
