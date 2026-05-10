use axum::{Router, routing::get, routing::put, routing::post, Json, extract::{Path, State}};
use ecdraw_core::logic::line_logic;
use ecdraw_core::middleware;
use ecdraw_core::models::LineSegmentData;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct UpsertLineBody {
    #[serde(alias = "edgeId")]
    edge_id: String,
    length: Option<f64>,
    #[serde(alias = "wireModel")]
    wire_model: Option<String>,
    #[serde(alias = "wireOwnership")]
    wire_ownership: Option<String>,
    #[serde(alias = "wireType")]
    wire_type: Option<String>,
    #[serde(alias = "isMainDisplay")]
    is_main_display: Option<bool>,
}

#[derive(Deserialize)]
pub struct BatchItem {
    #[serde(alias = "diagramEdgeId")]
    diagram_edge_id: String,
    length: Option<f64>,
    #[serde(alias = "wireModel")]
    wire_model: Option<String>,
    #[serde(alias = "wireOwnership")]
    wire_ownership: Option<String>,
    #[serde(alias = "wireType")]
    wire_type: Option<String>,
    #[serde(alias = "isMainDisplay")]
    is_main_display: Option<bool>,
}

#[derive(Deserialize)]
pub struct BatchBody {
    items: Vec<BatchItem>,
}

async fn list_by_diagram(State(state): State<AppState>, AuthClaims(_claims): AuthClaims, Path(diagram_id): Path<String>) -> Result<Json<Vec<serde_json::Value>>, ecdraw_core::error::AppError> {
    let did: Uuid = diagram_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的图纸ID".into()))?;
    let result = line_logic::list_lines_by_diagram(&state.pool, did).await?;
    Ok(Json(result))
}

async fn upsert_line(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<UpsertLineBody>) -> Result<Json<LineSegmentData>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "LINE_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let eid: Uuid = body.edge_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的边ID".into()))?;
    let is_main = body.is_main_display.unwrap_or(true);
    let result = line_logic::upsert_line(&state.pool, user_id, eid, body.length, body.wire_model, body.wire_ownership, body.wire_type, is_main).await?;
    Ok(Json(result))
}

async fn batch_upsert(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<BatchBody>) -> Result<Json<i32>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "LINE_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let items: Result<Vec<_>, ecdraw_core::error::AppError> = body.items.iter().map(|item| {
        let eid: Uuid = item.diagram_edge_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的边ID".into()))?;
        let is_main = item.is_main_display.unwrap_or(true);
        Ok((eid, item.length, item.wire_model.clone(), item.wire_ownership.clone(), item.wire_type.clone(), is_main))
    }).collect();
    let count = line_logic::batch_upsert_lines(&state.pool, user_id, &items?).await?;
    Ok(Json(count))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/by-diagram/{diagramId}", get(list_by_diagram))
        .route("/edge", put(upsert_line))
        .route("/batch", post(batch_upsert))
}
