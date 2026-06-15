use axum::{Router, routing::get, routing::post, routing::patch, routing::delete, Json, extract::{Path, State}};
use ecdraw_core::logic::component_logic::{self, ComponentWithVersion};
use ecdraw_core::middleware;
use ecdraw_core::models::{Component, ComponentVersion};
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateComponentBody {
    name: String,
    category: String,
    description: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateComponentBody {
    name: Option<String>,
    category: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateVersionBody {
    snapshot: serde_json::Value,
}

async fn list_components(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<Vec<ComponentWithVersion>>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let result = component_logic::list_components(&state.pool, user_id, is_admin).await?;
    Ok(Json(result))
}

async fn get_component(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<ComponentWithVersion>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::get_component(&state.pool, user_id, is_admin, cid).await?;
    Ok(Json(result))
}

async fn create_component(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<CreateComponentBody>) -> Result<Json<Component>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let result = component_logic::create_component(&state.pool, user_id, &body.name, &body.category, body.description.as_deref()).await?;
    Ok(Json(result))
}

async fn update_component(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<UpdateComponentBody>) -> Result<Json<Component>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::update_component(&state.pool, user_id, is_admin, cid, body.name, body.category, body.description).await?;
    Ok(Json(result))
}

async fn delete_component(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    component_logic::delete_component(&state.pool, user_id, is_admin, cid).await?;
    Ok(())
}

async fn duplicate_component(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<Component>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::duplicate_component(&state.pool, user_id, cid).await?;
    Ok(Json(result))
}

async fn list_component_versions(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<Vec<ComponentVersion>>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::list_component_versions(&state.pool, user_id, is_admin, cid).await?;
    Ok(Json(result))
}

async fn get_component_version(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path((id, version_no)): Path<(String, i32)>) -> Result<Json<ComponentVersion>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::get_component_version(&state.pool, user_id, is_admin, cid, version_no).await?;
    Ok(Json(result))
}

async fn create_component_version(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<CreateVersionBody>) -> Result<Json<ComponentVersion>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let is_admin = claims.roles.contains(&"ADMIN".to_string());
    let cid: Uuid = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的元件ID".into()))?;
    let result = component_logic::create_component_version(&state.pool, user_id, is_admin, cid, body.snapshot).await?;
    Ok(Json(result))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_components).post(create_component))
        .route("/{id}", get(get_component).patch(update_component).delete(delete_component))
        .route("/{id}/duplicate", post(duplicate_component))
        .route("/{id}/versions", get(list_component_versions).post(create_component_version))
        .route("/{id}/versions/{versionNo}", get(get_component_version))
}
