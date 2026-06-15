use ecdraw_core::error::AppError;
use ecdraw_core::logic::diagram_logic::{self, TopologyResponse, VersionSummary};
use ecdraw_core::middleware;
use ecdraw_core::models::{Diagram, DiagramEdge, DiagramInstance};
use ecdraw_core::AppState;
use tauri::State;
use uuid::Uuid;

/// 解析 JWT subject 为用户 ID（token 由本服务签发，非法说明 token 被篡改）。
fn parse_uid(sub: &str) -> Result<Uuid, AppError> {
    sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))
}

fn to_uuid(s: &str, label: &str) -> Result<Uuid, AppError> {
    s.parse().map_err(|_| AppError::BadRequest(format!("无效的{}", label)))
}

// ========== Diagram CRUD ==========

#[tauri::command]
pub async fn list_diagrams(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<Diagram>, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    diagram_logic::list_diagrams(&state.pool, &claims.roles, user_id).await
}

#[tauri::command]
pub async fn get_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::get_diagram(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn create_diagram(
    state: State<'_, AppState>,
    token: String,
    name: String,
    description: Option<String>,
    snapshot: Option<serde_json::Value>,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    diagram_logic::create_diagram(&state.pool, user_id, &name, description.as_deref(), snapshot).await
}

#[tauri::command]
pub async fn update_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
    name: Option<String>,
    description: Option<String>,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::update_diagram(&state.pool, &claims.roles, user_id, did, name, description).await
}

#[tauri::command]
pub async fn delete_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::delete_diagram(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn duplicate_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::duplicate_diagram(&state.pool, &claims.roles, user_id, did).await
}

// ========== Diagram Editor ==========

#[tauri::command]
pub async fn get_diagram_editor(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::get_diagram_editor(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn get_diagram_topology(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<TopologyResponse, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::get_diagram_topology(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn save_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
    snapshot: serde_json::Value,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::save_diagram(&state.pool, &claims.roles, user_id, did, snapshot).await
}

// ========== Review Flow ==========

#[tauri::command]
pub async fn submit_diagram_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::submit_diagram_review(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn withdraw_diagram_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::withdraw_diagram_review(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn request_delete_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::request_delete_diagram(&state.pool, &claims.roles, user_id, did).await
}

// ========== Instance CRUD ==========

#[tauri::command]
pub async fn create_diagram_instance(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    component_id: String,
    label: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    instance_data: Option<serde_json::Value>,
) -> Result<DiagramInstance, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let cid = to_uuid(&component_id, "元件ID")?;
    diagram_logic::create_diagram_instance(
        &state.pool, &claims.roles, user_id, did, cid, label, position_x, position_y, instance_data,
    ).await
}

#[tauri::command]
pub async fn update_diagram_instance(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    instance_id: String,
    label: Option<String>,
    position_x: Option<f64>,
    position_y: Option<f64>,
    component_id: Option<String>,
    instance_data: Option<serde_json::Value>,
) -> Result<DiagramInstance, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let iid = to_uuid(&instance_id, "实例ID")?;
    let cid = component_id.as_deref().map(|s| to_uuid(s, "元件ID")).transpose()?;
    diagram_logic::update_diagram_instance(
        &state.pool, &claims.roles, user_id, did, iid, label, position_x, position_y, cid, instance_data,
    ).await
}

#[tauri::command]
pub async fn delete_diagram_instance(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    instance_id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let iid = to_uuid(&instance_id, "实例ID")?;
    diagram_logic::delete_diagram_instance(&state.pool, &claims.roles, user_id, did, iid).await
}

// ========== Edge CRUD ==========

#[tauri::command]
pub async fn create_diagram_edge(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    source_instance_id: String,
    target_instance_id: String,
    source_pin_id: String,
    target_pin_id: String,
    line_type: Option<String>,
    polyline_mid_ratio: Option<f64>,
) -> Result<DiagramEdge, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let sid = to_uuid(&source_instance_id, "源实例ID")?;
    let tid = to_uuid(&target_instance_id, "目标实例ID")?;
    diagram_logic::create_diagram_edge(
        &state.pool, &claims.roles, user_id, did, sid, tid,
        &source_pin_id, &target_pin_id, line_type.as_deref(), polyline_mid_ratio,
    ).await
}

#[tauri::command]
pub async fn update_diagram_edge_line_type(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    edge_id: String,
    line_type: String,
) -> Result<DiagramEdge, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let eid = to_uuid(&edge_id, "边ID")?;
    diagram_logic::update_diagram_edge_line_type(&state.pool, &claims.roles, user_id, did, eid, &line_type).await
}

#[tauri::command]
pub async fn update_diagram_edge_polyline_mid_ratio(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    edge_id: String,
    polyline_mid_ratio: f64,
) -> Result<DiagramEdge, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let eid = to_uuid(&edge_id, "边ID")?;
    diagram_logic::update_diagram_edge_polyline_mid_ratio(&state.pool, &claims.roles, user_id, did, eid, polyline_mid_ratio).await
}

#[tauri::command]
pub async fn delete_diagram_edge(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    edge_id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let eid = to_uuid(&edge_id, "边ID")?;
    diagram_logic::delete_diagram_edge(&state.pool, &claims.roles, user_id, did, eid).await
}

// ========== Version Timeline ==========

#[tauri::command]
pub async fn list_diagram_versions(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Vec<VersionSummary>, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::list_diagram_versions(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn get_diagram_version_topology(
    state: State<'_, AppState>,
    token: String,
    id: String,
    version_id: String,
) -> Result<TopologyResponse, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    let vid = to_uuid(&version_id, "版本ID")?;
    diagram_logic::get_diagram_version_topology(&state.pool, &claims.roles, user_id, did, vid).await
}

#[tauri::command]
pub async fn delete_diagram_version(
    state: State<'_, AppState>,
    token: String,
    id: String,
    version_id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    let vid = to_uuid(&version_id, "版本ID")?;
    diagram_logic::delete_diagram_version(&state.pool, &claims.roles, user_id, did, vid).await
}
