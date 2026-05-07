use crate::error::AppError;
use crate::middleware;
use crate::models::{Component, Diagram, DiagramEdge, DiagramInstance, DiagramVersion, DistrictData, GisData, LineSegmentData};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateDiagramInput {
    pub token: String,
    pub name: String,
    pub description: Option<String>,
    pub snapshot: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateDiagramInput {
    pub token: String,
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveDiagramInput {
    pub token: String,
    pub id: String,
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateInstanceInput {
    pub token: String,
    pub diagram_id: String,
    pub component_id: String,
    pub label: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub instance_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInstanceInput {
    pub token: String,
    pub diagram_id: String,
    pub instance_id: String,
    pub label: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub component_id: Option<String>,
    pub instance_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEdgeInput {
    pub token: String,
    pub diagram_id: String,
    pub source_instance_id: String,
    pub target_instance_id: String,
    pub source_pin_id: String,
    pub target_pin_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TopologyResponse {
    pub diagram: Diagram,
    pub instances: Vec<InstanceWithExtras>,
    pub edges: Vec<EdgeWithExtras>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InstanceWithExtras {
    #[serde(flatten)]
    pub instance: DiagramInstance,
    pub component: Option<ComponentMeta>,
    pub district_data: Option<DistrictData>,
    pub gis_data: Option<GisData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComponentMeta {
    pub id: Uuid,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EdgeWithExtras {
    #[serde(flatten)]
    pub edge: DiagramEdge,
    pub line_segment_data: Option<LineSegmentData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub total_pages: i64,
}

fn default_snapshot() -> serde_json::Value {
    json!({
        "schemaVersion": 1,
        "instances": [],
        "connections": [],
        "selection": null,
        "viewport": { "zoom": 1, "panX": 0, "panY": 0 }
    })
}

fn normalize_diagram_snapshot(val: &serde_json::Value) -> serde_json::Value {
    let mut s = val.clone();
    if !s.is_object() { s = json!({}); }
    let obj = s.as_object_mut().unwrap();
    if !obj.contains_key("schemaVersion") { obj.insert("schemaVersion".into(), json!(1)); }
    if !obj.contains_key("instances") { obj.insert("instances".into(), json!([])); }
    if !obj.contains_key("connections") { obj.insert("connections".into(), json!([])); }
    if !obj.contains_key("selection") { obj.insert("selection".into(), json!(null)); }
    if !obj.contains_key("viewport") { obj.insert("viewport".into(), json!({"zoom":1,"panX":0,"panY":0})); }
    s
}

fn can_read_diagram(roles: &[String], owner_id: &Uuid, status: &str, user_id: &Uuid) -> bool {
    if roles.contains(&"ADMIN".to_string()) { return true; }
    if owner_id == user_id { return true; }
    if status == "PUBLISHED" { return true; }
    if roles.contains(&"REVIEWER".to_string()) && status == "PENDING_REVIEW" { return true; }
    false
}

fn can_write_diagram(roles: &[String], owner_id: &Uuid, user_id: &Uuid) -> bool {
    roles.contains(&"ADMIN".to_string()) || owner_id == user_id
}

// ========== Diagram CRUD ==========

/// GET /api/diagrams
#[tauri::command]
pub async fn list_diagrams(
    state: State<'_, AppState>,
    input: AuthInput,
) -> Result<Vec<Diagram>, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    let diagrams = if claims.roles.contains(&"ADMIN".to_string()) {
        sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams ORDER BY updated_at DESC")
            .fetch_all(&state.pool).await?
    } else if claims.roles.contains(&"REVIEWER".to_string()) {
        sqlx::query_as::<_, Diagram>(
            "SELECT * FROM diagrams WHERE owner_id = $1 OR status IN ('PENDING_REVIEW','PUBLISHED') ORDER BY updated_at DESC"
        ).bind(user_id).fetch_all(&state.pool).await?
    } else {
        sqlx::query_as::<_, Diagram>(
            "SELECT * FROM diagrams WHERE owner_id = $1 OR status = 'PUBLISHED' ORDER BY updated_at DESC"
        ).bind(user_id).fetch_all(&state.pool).await?
    };

    Ok(diagrams)
}

/// GET /api/diagrams/:id
#[tauri::command]
pub async fn get_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(&claims.roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    Ok(d)
}

/// POST /api/diagrams
#[tauri::command]
pub async fn create_diagram(
    state: State<'_, AppState>,
    input: CreateDiagramInput,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    if input.name.is_empty() {
        return Err(AppError::BadRequest("图纸名称不能为空".into()));
    }

    let snapshot = input.snapshot.map(|s| normalize_diagram_snapshot(&s)).unwrap_or_else(default_snapshot);

    let mut tx = state.pool.begin().await?;
    let diagram = sqlx::query_as::<_, Diagram>(
        "INSERT INTO diagrams (name, description, owner_id, status) VALUES ($1, $2, $3, 'DRAFT') RETURNING *"
    )
    .bind(&input.name).bind(&input.description).bind(user_id)
    .fetch_one(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
    )
    .bind(diagram.id).bind(&snapshot).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(diagram)
}

/// PATCH /api/diagrams/:id
#[tauri::command]
pub async fn update_diagram(
    state: State<'_, AppState>,
    input: UpdateDiagramInput,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = input.id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权修改此图纸".into()));
    }
    if d.status != "DRAFT" && d.status != "REJECTED" {
        return Err(AppError::BadRequest("只能修改草稿或已驳回状态的图纸".into()));
    }

    if input.name.is_none() && input.description.is_none() {
        return Err(AppError::BadRequest("无更新内容".into()));
    }

    let name = input.name.unwrap_or(d.name);
    let description = input.description.or(d.description);

    let updated = sqlx::query_as::<_, Diagram>(
        "UPDATE diagrams SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *"
    )
    .bind(&name).bind(&description).bind(did)
    .fetch_one(&state.pool).await?;

    Ok(updated)
}

/// DELETE /api/diagrams/:id
#[tauri::command]
pub async fn delete_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权删除此图纸".into()));
    }
    if d.status != "DRAFT" && d.status != "REJECTED" {
        return Err(AppError::BadRequest("只能删除草稿或已驳回状态的图纸".into()));
    }

    // Cascade delete handled by schema
    sqlx::query("DELETE FROM diagrams WHERE id = $1").bind(did)
        .execute(&state.pool).await?;

    Ok(())
}

/// POST /api/diagrams/:id/duplicate
#[tauri::command]
pub async fn duplicate_diagram(
    state: State<'_, AppState>,
    input: AuthInput,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let source = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    // Generate unique name
    let mut new_name = format!("{}副本", source.name);
    let mut suffix = 2;
    loop {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM diagrams WHERE name = $1")
            .bind(&new_name).fetch_one(&state.pool).await?;
        if count == 0 { break; }
        new_name = format!("{}副本{}", source.name, suffix);
        suffix += 1;
        if suffix > 100 { break; }
    }

    let mut tx = state.pool.begin().await?;
    let dup = sqlx::query_as::<_, Diagram>(
        "INSERT INTO diagrams (name, description, owner_id, status) VALUES ($1, $2, $3, 'DRAFT') RETURNING *"
    )
    .bind(&new_name).bind(&source.description).bind(user_id)
    .fetch_one(&mut *tx).await?;

    // Copy latest version snapshot
    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(did).fetch_optional(&mut *tx).await?;

    if let Some(v) = latest_ver {
        sqlx::query(
            "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
        )
        .bind(dup.id).bind(&v.snapshot).bind(user_id)
        .execute(&mut *tx).await?;
    }

    // Deep copy instances + edges
    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(did).fetch_all(&mut *tx).await?;

    let mut id_map: std::collections::HashMap<Uuid, Uuid> = std::collections::HashMap::new();
    for inst in &instances {
        let new_id = Uuid::new_v4();
        id_map.insert(inst.id, new_id);
        sqlx::query(
            "INSERT INTO diagram_instances (id, diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
        .bind(new_id).bind(dup.id).bind(inst.component_id).bind(&inst.label)
        .bind(inst.position_x).bind(inst.position_y).bind(&inst.instance_data)
        .execute(&mut *tx).await?;
    }

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(did).fetch_all(&mut *tx).await?;

    for edge in &edges {
        let new_source = id_map.get(&edge.source_instance_id).copied().unwrap_or(edge.source_instance_id);
        let new_target = id_map.get(&edge.target_instance_id).copied().unwrap_or(edge.target_instance_id);
        sqlx::query(
            "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(dup.id).bind(new_source).bind(new_target).bind(&edge.source_pin_id).bind(&edge.target_pin_id)
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(dup)
}

// ========== Diagram Editor ==========

/// GET /api/diagrams/:id/editor
#[tauri::command]
pub async fn get_diagram_editor(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(&claims.roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(did).fetch_all(&state.pool).await?;

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(did).fetch_all(&state.pool).await?;

    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(did).fetch_optional(&state.pool).await?;

    // Auto-migrate legacy snapshot data if no real instances exist
    let (final_instances, final_edges) = if instances.is_empty() {
        if let Some(ref ver) = latest_ver {
            if let Some(snap_instances) = ver.snapshot.get("instances").and_then(|v| v.as_array()) {
                if !snap_instances.is_empty() {
                    let mut tx = state.pool.begin().await?;
                    let mut new_id_map: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
                    for si in snap_instances {
                        let new_id = Uuid::new_v4();
                        let old_id = si.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let label = si.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let component_id: Uuid = si.get("componentId").and_then(|v| v.as_str())
                            .unwrap_or("").parse().unwrap_or(Uuid::nil());
                        let x = si.get("positionX").or_else(|| si.get("x")).and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let y = si.get("positionY").or_else(|| si.get("y")).and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let idata = si.get("instanceData").cloned().unwrap_or(json!({}));

                        sqlx::query(
                            "INSERT INTO diagram_instances (id, diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1, $2, $3, $4, $5, $6, $7)"
                        )
                        .bind(new_id).bind(did).bind(component_id).bind(&label).bind(x).bind(y).bind(&idata)
                        .execute(&mut *tx).await?;
                        if !old_id.is_empty() { new_id_map.insert(old_id.to_string(), new_id); }
                    }
                    if let Some(snap_conns) = ver.snapshot.get("connections").and_then(|v| v.as_array()) {
                        for sc in snap_conns {
                            let from = sc.get("fromInstanceId").or_else(|| sc.get("sourceInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
                            let to = sc.get("toInstanceId").or_else(|| sc.get("targetInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
                            let s_from = new_id_map.get(from).copied().unwrap_or(Uuid::nil());
                            let s_to = new_id_map.get(to).copied().unwrap_or(Uuid::nil());
                            let spid = sc.get("sourcePinId").and_then(|v| v.as_str()).unwrap_or("");
                            let tpid = sc.get("targetPinId").and_then(|v| v.as_str()).unwrap_or("");
                            sqlx::query(
                                "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id) VALUES ($1, $2, $3, $4, $5)"
                            )
                            .bind(did).bind(s_from).bind(s_to).bind(spid).bind(tpid)
                            .execute(&mut *tx).await?;
                        }
                    }
                    tx.commit().await?;
                    // Re-fetch after migration
                    return Box::pin(get_diagram_editor(state, token, id)).await;
                }
            }
        }
        (instances, edges)
    } else {
        (instances, edges)
    };

    Ok(json!({
        "diagram": {
            "id": d.id,
            "name": d.name,
            "description": d.description,
            "ownerId": d.owner_id,
            "status": d.status,
            "createdAt": d.created_at,
            "updatedAt": d.updated_at,
        },
        "instances": final_instances,
        "edges": final_edges,
        "latestVersion": latest_ver,
    }))
}

/// GET /api/diagrams/:id/topology
#[tauri::command]
pub async fn get_diagram_topology(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<TopologyResponse, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(&claims.roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(did).fetch_all(&state.pool).await?;

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(did).fetch_all(&state.pool).await?;

    let mut instances_with_extras = Vec::new();
    for inst in &instances {
        let comp = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
            .bind(inst.component_id).fetch_optional(&state.pool).await?;
        let dd = sqlx::query_as::<_, DistrictData>(
            "SELECT * FROM district_data WHERE diagram_instance_id = $1"
        ).bind(inst.id).fetch_optional(&state.pool).await?;
        let gd = sqlx::query_as::<_, GisData>(
            "SELECT * FROM gis_data WHERE diagram_instance_id = $1"
        ).bind(inst.id).fetch_optional(&state.pool).await?;
        instances_with_extras.push(InstanceWithExtras {
            instance: inst.clone(),
            component: comp.map(|c| ComponentMeta { id: c.id, name: c.name, category: c.category }),
            district_data: dd,
            gis_data: gd,
        });
    }

    let mut edges_with_extras = Vec::new();
    for edge in &edges {
        let ld = sqlx::query_as::<_, LineSegmentData>(
            "SELECT * FROM line_segment_data WHERE diagram_edge_id = $1"
        ).bind(edge.id).fetch_optional(&state.pool).await?;
        edges_with_extras.push(EdgeWithExtras { edge: edge.clone(), line_segment_data: ld });
    }

    Ok(TopologyResponse {
        diagram: d,
        instances: instances_with_extras,
        edges: edges_with_extras,
    })
}

/// POST /api/diagrams/:id/save
#[tauri::command]
pub async fn save_diagram(
    state: State<'_, AppState>,
    input: SaveDiagramInput,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = input.id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权保存此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可保存".into()));
    }

    if !input.snapshot.is_object() || input.snapshot.is_array() {
        return Err(AppError::BadRequest("快照数据格式无效".into()));
    }

    let snapshot = normalize_diagram_snapshot(&input.snapshot);

    let mut tx = state.pool.begin().await?;
    let latest_no = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(MAX(version_no), 0) FROM diagram_versions WHERE diagram_id = $1"
    ).bind(did).fetch_one(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by) VALUES ($1, $2, $3, $4)"
    )
    .bind(did).bind(latest_no + 1).bind(&snapshot).bind(user_id)
    .execute(&mut *tx).await?;

    // Reset to DRAFT
    let updated = sqlx::query_as::<_, Diagram>(
        "UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1 RETURNING *"
    )
    .bind(did).fetch_one(&mut *tx).await?;

    tx.commit().await?;
    Ok(updated)
}

// ========== Review Flow ==========

/// POST /api/diagrams/:id/submit-review
#[tauri::command]
pub async fn submit_diagram_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" || d.status == "PENDING_REVIEW" {
        return Err(AppError::BadRequest("图纸状态不允许提交审核".into()));
    }

    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::BadRequest("请先保存图纸".into()))?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE diagrams SET status = 'PENDING_REVIEW', updated_at = NOW() WHERE id = $1")
        .bind(did).execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO review_requests (diagram_id, diagram_version_id, submitter_id, status) VALUES ($1, $2, $3, 'PENDING')"
    )
    .bind(did).bind(latest_ver.id).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

/// POST /api/diagrams/:id/withdraw-review
#[tauri::command]
pub async fn withdraw_diagram_review(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status != "PENDING_REVIEW" {
        return Err(AppError::BadRequest("只有审核中的图纸可以撤回".into()));
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1")
        .bind(did).execute(&mut *tx).await?;

    sqlx::query(
        "UPDATE review_requests SET status = 'WITHDRAWN' WHERE diagram_id = $1 AND status = 'PENDING'"
    )
    .bind(did).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

/// POST /api/diagrams/:id/request-delete
#[tauri::command]
pub async fn request_delete_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PENDING_DELETE" || d.status == "PENDING_REVIEW" {
        return Err(AppError::BadRequest("图纸状态不允许申请删除".into()));
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE diagrams SET status = 'PENDING_DELETE', updated_at = NOW() WHERE id = $1")
        .bind(did).execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO review_requests (diagram_id, diagram_version_id, submitter_id, status) SELECT $1, id, $2, 'PENDING' FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(did).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

// ========== Instance CRUD ==========

/// POST /api/diagrams/:id/instances
#[tauri::command]
pub async fn create_diagram_instance(
    state: State<'_, AppState>,
    input: CreateInstanceInput,
) -> Result<DiagramInstance, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = input.diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let cid: Uuid = input.component_id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可编辑".into()));
    }

    // Verify component exists
    let comp = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let label = input.label.unwrap_or_else(|| comp.name.clone());
    let instance = sqlx::query_as::<_, DiagramInstance>(
        "INSERT INTO diagram_instances (diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(did).bind(cid).bind(&label)
    .bind(input.position_x.unwrap_or(0.0)).bind(input.position_y.unwrap_or(0.0))
    .bind(input.instance_data.unwrap_or(json!({})))
    .fetch_one(&state.pool).await?;

    Ok(instance)
}

/// PATCH /api/diagrams/:id/instances/:instanceId
#[tauri::command]
pub async fn update_diagram_instance(
    state: State<'_, AppState>,
    input: UpdateInstanceInput,
) -> Result<DiagramInstance, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = input.diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let iid: Uuid = input.instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可编辑".into()));
    }

    let inst = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    )
    .bind(iid).bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let label = input.label.unwrap_or(inst.label);
    let px = input.position_x.unwrap_or(inst.position_x);
    let py = input.position_y.unwrap_or(inst.position_y);
    let cid_str = input.component_id.unwrap_or_else(|| inst.component_id.to_string());
    let cid: Uuid = cid_str.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;
    let idata = input.instance_data.unwrap_or(inst.instance_data);

    if px.is_nan() || py.is_nan() {
        return Err(AppError::BadRequest("坐标值无效".into()));
    }

    let updated = sqlx::query_as::<_, DiagramInstance>(
        "UPDATE diagram_instances SET label = $1, position_x = $2, position_y = $3, component_id = $4, instance_data = $5, updated_at = NOW() WHERE id = $6 RETURNING *"
    )
    .bind(&label).bind(px).bind(py).bind(cid).bind(&idata).bind(iid)
    .fetch_one(&state.pool).await?;

    Ok(updated)
}

/// DELETE /api/diagrams/:id/instances/:instanceId
#[tauri::command]
pub async fn delete_diagram_instance(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    instance_id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let iid: Uuid = instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可编辑".into()));
    }

    // Cascade delete handles edges, district_data, gis_data, line_segment_data
    sqlx::query("DELETE FROM diagram_instances WHERE id = $1 AND diagram_id = $2")
        .bind(iid).bind(did).execute(&state.pool).await?;

    Ok(())
}

// ========== Edge CRUD ==========

/// POST /api/diagrams/:id/edges
#[tauri::command]
pub async fn create_diagram_edge(
    state: State<'_, AppState>,
    input: CreateEdgeInput,
) -> Result<DiagramEdge, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = input.diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let sid: Uuid = input.source_instance_id.parse().map_err(|_| AppError::BadRequest("无效的源实例ID".into()))?;
    let tid: Uuid = input.target_instance_id.parse().map_err(|_| AppError::BadRequest("无效的目标实例ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可编辑".into()));
    }

    // Verify both instances exist and belong to the diagram
    let _s_inst = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    ).bind(sid).bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("源实例不存在或不属于该图纸".into()))?;
    let _t_inst = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    ).bind(tid).bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("目标实例不存在或不属于该图纸".into()))?;

    let edge = sqlx::query_as::<_, DiagramEdge>(
        "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id) VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(did).bind(sid).bind(tid)
    .bind(&input.source_pin_id).bind(&input.target_pin_id)
    .fetch_one(&state.pool).await?;

    Ok(edge)
}

/// DELETE /api/diagrams/:id/edges/:edgeId
#[tauri::command]
pub async fn delete_diagram_edge(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
    edge_id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let did: Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let eid: Uuid = edge_id.parse().map_err(|_| AppError::BadRequest("无效的边ID".into()))?;

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(did).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(&claims.roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PUBLISHED" {
        return Err(AppError::BadRequest("已发布的图纸不可编辑".into()));
    }

    // Cascade delete handles line_segment_data
    sqlx::query("DELETE FROM diagram_edges WHERE id = $1 AND diagram_id = $2")
        .bind(eid).bind(did).execute(&state.pool).await?;

    Ok(())
}
