use axum::{Router, routing::get, routing::put, routing::post, Json, extract::{Path, State}};
use ecdraw_core::logic::gis_logic;
use ecdraw_core::middleware;
use ecdraw_core::models::GisData;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct UpsertGisBody {
    #[serde(alias = "instanceId")]
    instance_id: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Deserialize)]
pub struct BatchItem {
    #[serde(alias = "diagramInstanceId")]
    diagram_instance_id: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Deserialize)]
pub struct BatchBody {
    items: Vec<BatchItem>,
}

async fn list_by_diagram(State(state): State<AppState>, AuthClaims(_claims): AuthClaims, Path(diagram_id): Path<String>) -> Result<Json<Vec<serde_json::Value>>, ecdraw_core::error::AppError> {
    let did: Uuid = diagram_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的图纸ID".into()))?;
    let result = gis_logic::list_gis_by_diagram(&state.pool, did).await?;
    Ok(Json(result))
}

async fn upsert_gis(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<UpsertGisBody>) -> Result<Json<GisData>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "GIS_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let iid: Uuid = body.instance_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的实例ID".into()))?;
    let result = gis_logic::upsert_gis(&state.pool, user_id, iid, body.latitude, body.longitude).await?;
    Ok(Json(result))
}

async fn batch_upsert(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<BatchBody>) -> Result<Json<i32>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "GIS_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| ecdraw_core::error::AppError::Auth("无效的用户标识".into()))?;
    let items: Result<Vec<_>, ecdraw_core::error::AppError> = body.items.iter().map(|item| {
        let iid: Uuid = item.diagram_instance_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的实例ID".into()))?;
        Ok((iid, item.latitude, item.longitude))
    }).collect();
    let count = gis_logic::batch_upsert_gis(&state.pool, user_id, &items?).await?;
    Ok(Json(count))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/by-diagram/{diagramId}", get(list_by_diagram))
        .route("/instance", put(upsert_gis))
        .route("/batch", post(batch_upsert))
}
