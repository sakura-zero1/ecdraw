use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::AppState;
use tauri::State;

/// POST /api/analysis/outage-simulate
#[tauri::command]
pub async fn outage_simulate(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    disconnect_instance_id: String,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    let did: uuid::Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let dc_id: uuid::Uuid = disconnect_instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;
    ecdraw_core::logic::analysis_logic::outage_simulate(&state.pool, did, dc_id).await
}

/// POST /api/analysis/power-flow (stub)
#[tauri::command]
pub async fn power_flow(
    _state: State<'_, AppState>,
    token: String,
) -> Result<(), AppError> {
    let _claims = middleware::verify_auth(&token, &_state.jwt_access_secret)?;
    middleware::require_role(&_claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    Err(AppError::BadRequest("潮流计算功能暂未实现".into()))
}

/// POST /api/analysis/fault-analysis (stub)
#[tauri::command]
pub async fn fault_analysis(
    _state: State<'_, AppState>,
    token: String,
) -> Result<(), AppError> {
    let _claims = middleware::verify_auth(&token, &_state.jwt_access_secret)?;
    middleware::require_role(&_claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    Err(AppError::BadRequest("故障分析功能暂未实现".into()))
}
