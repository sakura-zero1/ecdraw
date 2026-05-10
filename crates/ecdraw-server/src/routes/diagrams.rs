use axum::{Router, routing::get, routing::post, routing::patch, routing::delete, Json, extract::{Path, State}};
use ecdraw_core::logic::diagram_logic::{self, TopologyResponse, VersionSummary};
use ecdraw_core::middleware;
use ecdraw_core::models::{Diagram, DiagramEdge, DiagramInstance};
use ecdraw_core::AppState;
use crate::extractors::AuthClaims;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateDiagramBody {
    name: String,
    description: Option<String>,
    snapshot: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct UpdateDiagramBody {
    name: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
pub struct SaveDiagramBody {
    snapshot: serde_json::Value,
}

#[derive(Deserialize)]
pub struct CreateInstanceBody {
    #[serde(alias = "componentId")]
    component_id: String,
    label: Option<String>,
    #[serde(alias = "positionX")]
    position_x: Option<f64>,
    #[serde(alias = "positionY")]
    position_y: Option<f64>,
    #[serde(alias = "instanceData")]
    instance_data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct UpdateInstanceBody {
    label: Option<String>,
    #[serde(alias = "positionX")]
    position_x: Option<f64>,
    #[serde(alias = "positionY")]
    position_y: Option<f64>,
    #[serde(alias = "componentId")]
    component_id: Option<String>,
    #[serde(alias = "instanceData")]
    instance_data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct CreateEdgeBody {
    #[serde(alias = "sourceInstanceId")]
    source_instance_id: String,
    #[serde(alias = "targetInstanceId")]
    target_instance_id: String,
    #[serde(alias = "sourcePinId")]
    source_pin_id: String,
    #[serde(alias = "targetPinId")]
    target_pin_id: String,
}

fn to_uuid(s: &str, label: &str) -> Result<Uuid, ecdraw_core::error::AppError> {
    s.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest(format!("无效的{}", label)))
}

// ========== Diagram CRUD ==========

async fn list_diagrams(State(state): State<AppState>, AuthClaims(claims): AuthClaims) -> Result<Json<Vec<Diagram>>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let diagrams = diagram_logic::list_diagrams(&state.pool, &claims.roles, user_id).await?;
    Ok(Json(diagrams))
}

async fn get_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<Diagram>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let diagram = diagram_logic::get_diagram(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(diagram))
}

async fn create_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Json(body): Json<CreateDiagramBody>) -> Result<Json<Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let diagram = diagram_logic::create_diagram(&state.pool, user_id, &body.name, body.description.as_deref(), body.snapshot).await?;
    Ok(Json(diagram))
}

async fn update_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<UpdateDiagramBody>) -> Result<Json<Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let diagram = diagram_logic::update_diagram(&state.pool, &claims.roles, user_id, did, body.name, body.description).await?;
    Ok(Json(diagram))
}

async fn delete_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::delete_diagram(&state.pool, &claims.roles, user_id, did).await?;
    Ok(())
}

async fn duplicate_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let diagram = diagram_logic::duplicate_diagram(&state.pool, user_id, did).await?;
    Ok(Json(diagram))
}

// ========== Editor ==========

async fn get_diagram_editor(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<serde_json::Value>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let result = diagram_logic::get_diagram_editor(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(result))
}

async fn get_diagram_topology(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<Json<TopologyResponse>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let result = diagram_logic::get_diagram_topology(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(result))
}

async fn save_diagram(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<SaveDiagramBody>) -> Result<Json<Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    let diagram = diagram_logic::save_diagram(&state.pool, &claims.roles, user_id, did, body.snapshot).await?;
    Ok(Json(diagram))
}

// ========== Review Flow ==========

async fn submit_review(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::submit_diagram_review(&state.pool, &claims.roles, user_id, did).await?;
    Ok(())
}

async fn withdraw_review(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::withdraw_diagram_review(&state.pool, &claims.roles, user_id, did).await?;
    Ok(())
}

async fn request_delete(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::request_delete_diagram(&state.pool, &claims.roles, user_id, did).await?;
    Ok(())
}

// ========== Instance CRUD ==========

async fn create_instance(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<CreateInstanceBody>) -> Result<Json<DiagramInstance>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let diagram_id = to_uuid(&id, "图纸ID")?;
    let component_id = to_uuid(&body.component_id, "元件ID")?;
    let result = diagram_logic::create_diagram_instance(&state.pool, &claims.roles, user_id, diagram_id, component_id, body.label, body.position_x, body.position_y, body.instance_data).await?;
    Ok(Json(result))
}

async fn update_instance(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path((diagram_id, instance_id)): Path<(String, String)>, Json(body): Json<UpdateInstanceBody>) -> Result<Json<DiagramInstance>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let iid = to_uuid(&instance_id, "实例ID")?;
    let cid = body.component_id.as_ref().map(|s| to_uuid(s, "元件ID")).transpose()?;
    let result = diagram_logic::update_diagram_instance(&state.pool, &claims.roles, user_id, did, iid, body.label, body.position_x, body.position_y, cid, body.instance_data).await?;
    Ok(Json(result))
}

async fn delete_instance(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path((diagram_id, instance_id)): Path<(String, String)>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let iid = to_uuid(&instance_id, "实例ID")?;
    diagram_logic::delete_diagram_instance(&state.pool, &claims.roles, user_id, did, iid).await?;
    Ok(())
}

// ========== Edge CRUD ==========

async fn create_edge(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path(id): Path<String>, Json(body): Json<CreateEdgeBody>) -> Result<Json<DiagramEdge>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let diagram_id = to_uuid(&id, "图纸ID")?;
    let source_id = to_uuid(&body.source_instance_id, "源实例ID")?;
    let target_id = to_uuid(&body.target_instance_id, "目标实例ID")?;
    let result = diagram_logic::create_diagram_edge(&state.pool, &claims.roles, user_id, diagram_id, source_id, target_id, &body.source_pin_id, &body.target_pin_id).await?;
    Ok(Json(result))
}

async fn delete_edge(State(state): State<AppState>, AuthClaims(claims): AuthClaims, Path((diagram_id, edge_id)): Path<(String, String)>) -> Result<(), ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = to_uuid(&diagram_id, "图纸ID")?;
    let eid = to_uuid(&edge_id, "边ID")?;
    diagram_logic::delete_diagram_edge(&state.pool, &claims.roles, user_id, did, eid).await?;
    Ok(())
}

async fn list_versions(
    State(state): State<AppState>,
    AuthClaims(claims): AuthClaims,
    Path(id): Path<String>,
) -> Result<Json<Vec<VersionSummary>>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的图纸ID".into()))?;
    let result = diagram_logic::list_diagram_versions(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(result))
}

async fn get_version_topology(
    State(state): State<AppState>,
    AuthClaims(claims): AuthClaims,
    Path((id, version_id)): Path<(String, String)>,
) -> Result<Json<TopologyResponse>, ecdraw_core::error::AppError> {
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did = id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的图纸ID".into()))?;
    let vid = version_id.parse().map_err(|_| ecdraw_core::error::AppError::BadRequest("无效的版本ID".into()))?;
    let result = diagram_logic::get_diagram_version_topology(&state.pool, &claims.roles, user_id, did, vid).await?;
    Ok(Json(result))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_diagrams).post(create_diagram))
        .route("/{id}", get(get_diagram).patch(update_diagram).delete(delete_diagram))
        .route("/{id}/duplicate", post(duplicate_diagram))
        .route("/{id}/editor", get(get_diagram_editor))
        .route("/{id}/topology", get(get_diagram_topology))
        .route("/{id}/save", post(save_diagram))
        .route("/{id}/submit-review", post(submit_review))
        .route("/{id}/withdraw-review", post(withdraw_review))
        .route("/{id}/request-delete", post(request_delete))
        .route("/{id}/instances", post(create_instance))
        .route("/{id}/instances/{instanceId}", patch(update_instance).delete(delete_instance))
        .route("/{id}/edges", post(create_edge))
        .route("/{id}/edges/{edgeId}", delete(delete_edge))
        .route("/{id}/versions", get(list_versions))
        .route("/{id}/versions/{versionId}/topology", get(get_version_topology))
}
