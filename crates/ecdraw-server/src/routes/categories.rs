use axum::{Router, routing::get, routing::post, routing::delete, routing::patch, Json, extract::{Path, State}};
use ecdraw_core::logic::category_logic;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use ecdraw_core::models::ComponentCategory;
use crate::extractors::AuthClaims;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CreateCategoryBody {
    name: String,
    label: String,
    color: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateVisibilityBody {
    visible: bool,
}

#[derive(Deserialize)]
pub struct RenameCategoryBody {
    new_label: String,
}

async fn list_categories(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<Vec<ComponentCategory>>, ecdraw_core::error::AppError> {
    let _ = middleware::verify_auth("", &state.jwt_access_secret); // just use claims from extractor
    let _ = claims;
    let cats = category_logic::list_categories(&state.pool).await?;
    Ok(Json(cats))
}

async fn create_category(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<CreateCategoryBody>) -> Result<Json<ComponentCategory>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let color = body.color.unwrap_or_else(|| "#6b7280".into());
    let cat = category_logic::create_category(&state.pool, &body.name, &body.label, &color).await?;
    Ok(Json(cat))
}

async fn delete_category(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    category_logic::delete_category(&state.pool, &id).await?;
    Ok(())
}

async fn update_visibility(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<UpdateVisibilityBody>) -> Result<Json<ComponentCategory>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let cat = category_logic::update_category_visibility(&state.pool, &id, body.visible).await?;
    Ok(Json(cat))
}

async fn rename_category(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<RenameCategoryBody>) -> Result<Json<ComponentCategory>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;
    let cat = category_logic::rename_category(&state.pool, &id, &body.new_label).await?;
    Ok(Json(cat))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_categories).post(create_category))
        .route("/{id}", delete(delete_category))
        .route("/{id}/visibility", patch(update_visibility))
        .route("/{id}/rename", patch(rename_category))
}
