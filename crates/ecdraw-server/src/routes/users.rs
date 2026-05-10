use axum::{Router, routing::get, routing::post, routing::patch, Json, extract::{Path, State}};
use ecdraw_core::logic::user_logic::{self, UserResponse};
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CreateUserBody {
    username: String,
    password: String,
    roles: Option<Vec<String>>,
    status: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateUserBody {
    roles: Option<Vec<String>>,
    status: Option<String>,
    password: Option<String>,
}

async fn list_users(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<Vec<UserResponse>>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN"])?;
    let users = user_logic::list_users(&state.pool).await?;
    Ok(Json(users))
}

async fn create_user(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<CreateUserBody>) -> Result<Json<UserResponse>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN"])?;
    let caller_id: uuid::Uuid = claims.sub.parse().unwrap();
    let user = user_logic::create_user(&state.pool, caller_id, &body.username, &body.password, body.roles, body.status).await?;
    Ok(Json(user))
}

async fn update_user(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<UpdateUserBody>) -> Result<Json<UserResponse>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN"])?;
    let caller_id: uuid::Uuid = claims.sub.parse().unwrap();
    let user = user_logic::update_user(&state.pool, caller_id, &id, body.roles, body.status, body.password).await?;
    Ok(Json(user))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_users).post(create_user))
        .route("/{id}", patch(update_user))
}
