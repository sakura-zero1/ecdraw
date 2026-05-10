pub mod auth;
pub mod db;
pub mod error;
pub mod logic;
pub mod middleware;
pub mod models;

use sqlx::PgPool;

/// Shared application state used by both Tauri and axum server.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
}
