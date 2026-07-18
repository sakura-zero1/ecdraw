mod admin;
mod analysis;
mod audit;
mod auth;
mod categories;
mod components;
mod diagrams;
mod districts;
mod gis;
mod health;
mod lines;
mod reviews;
mod seed;
mod users;

use axum::Router;
use ecdraw_core::AppState;

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .nest("/api", health::routes())
        .nest("/api/auth", auth::routes())
        .nest("/api/users", users::routes())
        .nest("/api/components", components::routes())
        .nest("/api/diagrams", diagrams::routes())
        .nest("/api/districts", districts::routes())
        .nest("/api/lines", lines::routes())
        .nest("/api/gis", gis::routes())
        .nest("/api/reviews", reviews::routes())
        .nest("/api/audits", audit::routes())
        .nest("/api/analysis", analysis::routes())
        .nest("/api/admin", admin::routes())
        .nest("/api/categories", categories::routes())
        .nest("/api/seed", seed::routes())
        .with_state(state)
}
