use axum::{Router, routing::post, Json, extract::State};
use ecdraw_core::logic::analysis_logic;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct OutageSimulateBody {
    #[serde(alias = "diagramId")]
    diagram_id: String,
    #[serde(alias = "disconnectInstanceId")]
    disconnect_instance_id: String,
}

async fn outage_simulate(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<OutageSimulateBody>) -> Result<Json<serde_json::Value>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    let did: Uuid = body.diagram_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的图纸ID".into()))?;
    let dc_id: Uuid = body.disconnect_instance_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的实例ID".into()))?;
    let result = analysis_logic::outage_simulate(&state.pool, did, dc_id).await?;
    Ok(Json(result))
}

async fn power_flow(AuthClaims(claims): AuthClaims) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    analysis_logic::power_flow().await
}

async fn fault_analysis(AuthClaims(claims): AuthClaims) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    analysis_logic::fault_analysis().await
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/outage-simulate", post(outage_simulate))
        .route("/power-flow", post(power_flow))
        .route("/fault-analysis", post(fault_analysis))
}
