use crate::error::AppError;
use crate::models::{Component, Diagram, DiagramEdge, DiagramInstance, DiagramVersion, DistrictData, GisData, LineSegmentData};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentMeta {
    pub id: Uuid,
    pub name: String,
    pub category: String,
    /// Latest version snapshot: contains shapeElements, pins, width/height/displayWidth/displayHeight.
    /// Viewer needs this to render actual component shapes (lines, circles, text) instead of plain rectangles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<serde_json::Value>,
}

/// Fetch the latest version snapshot for a component. Returns None if no version exists.
async fn fetch_latest_component_snapshot(
    pool: &PgPool,
    component_id: Uuid,
) -> Result<Option<serde_json::Value>, AppError> {
    let row = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT snapshot FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(component_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceWithExtras {
    #[serde(flatten)]
    pub instance: DiagramInstance,
    pub component: Option<ComponentMeta>,
    pub district_data: Option<DistrictData>,
    pub gis_data: Option<GisData>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeWithExtras {
    #[serde(flatten)]
    pub edge: DiagramEdge,
    pub line_segment_data: Option<LineSegmentData>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologyResponse {
    pub diagram: Diagram,
    pub instances: Vec<InstanceWithExtras>,
    pub edges: Vec<EdgeWithExtras>,
}

pub fn default_snapshot() -> serde_json::Value {
    json!({
        "schemaVersion": 1,
        "instances": [],
        "connections": [],
        "selection": null,
        "viewport": { "zoom": 1, "panX": 0, "panY": 0 }
    })
}

pub fn normalize_diagram_snapshot(val: &serde_json::Value) -> serde_json::Value {
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

pub fn can_read_diagram(roles: &[String], owner_id: &Uuid, status: &str, user_id: &Uuid) -> bool {
    if roles.contains(&"ADMIN".to_string()) { return true; }
    if owner_id == user_id { return true; }
    if status == "PUBLISHED" { return true; }
    if roles.contains(&"REVIEWER".to_string()) && status == "PENDING_REVIEW" { return true; }
    false
}

pub fn can_write_diagram(roles: &[String], owner_id: &Uuid, user_id: &Uuid) -> bool {
    roles.contains(&"ADMIN".to_string()) || owner_id == user_id
}

/// 仅 DRAFT / REJECTED 状态的图纸可编辑。
/// PENDING_REVIEW（审核中）、PENDING_DELETE（待删除）、PUBLISHED（已发布）均锁定。
pub fn is_diagram_editable(status: &str) -> bool {
    status == "DRAFT" || status == "REJECTED"
}

/// 最新版本（MAX version_no）是否可编辑 = 其 status 为 DRAFT 或 REJECTED。
/// 这取代了基于图纸 status 的可编辑判断，统一首发与修订场景。
pub async fn latest_version_editable(pool: &PgPool, diagram_id: Uuid) -> Result<bool, AppError> {
    let st = sqlx::query_scalar::<_, String>(
        "SELECT status FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(diagram_id).fetch_optional(pool).await?;
    Ok(matches!(st.as_deref(), Some("DRAFT") | Some("REJECTED")))
}

/// 该图是否存在 ONLINE 版本（用于区分首发 vs 修订）。
pub async fn has_online_version(pool: &PgPool, diagram_id: Uuid) -> Result<bool, AppError> {
    let c = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE'"
    ).bind(diagram_id).fetch_one(pool).await?;
    Ok(c > 0)
}

/// 用快照内容重建实时表 diagram_instances/diagram_edges（先清空再插入）。
/// 字段解析与 get_diagram_version_topology 保持一致（兼容 positionX|x、fromInstanceId|sourceInstanceId 等）。
async fn hydrate_realtime_from_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    diagram_id: Uuid,
    snapshot: &serde_json::Value,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM diagram_edges WHERE diagram_id = $1").bind(diagram_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM diagram_instances WHERE diagram_id = $1").bind(diagram_id).execute(&mut **tx).await?;

    let insts = snapshot.get("instances").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for si in &insts {
        let id_str = si.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let iid: Uuid = match id_str.parse() { Ok(u) => u, Err(_) => continue };
        let comp_id: Uuid = si.get("componentId").and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        let label = si.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let x = si.get("positionX").or_else(|| si.get("x")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let y = si.get("positionY").or_else(|| si.get("y")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let idata = si.get("instanceData").cloned().unwrap_or(json!({}));
        sqlx::query(
            "INSERT INTO diagram_instances (id, diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1,$2,$3,$4,$5,$6,$7)"
        )
        .bind(iid).bind(diagram_id).bind(comp_id).bind(&label).bind(x).bind(y).bind(&idata)
        .execute(&mut **tx).await?;
    }

    let conns = snapshot.get("connections").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for sc in &conns {
        let from: Uuid = sc.get("fromInstanceId").or_else(|| sc.get("sourceInstanceId")).and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        let to: Uuid = sc.get("toInstanceId").or_else(|| sc.get("targetInstanceId")).and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        if from.is_nil() || to.is_nil() { continue; }
        let spid = sc.get("sourcePinId").or_else(|| sc.get("fromPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tpid = sc.get("targetPinId").or_else(|| sc.get("toPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let lt = sc.get("lineType").and_then(|v| v.as_str()).unwrap_or("straight").to_string();
        let pmr = sc.get("polylineMidRatio").and_then(|v| v.as_f64());
        sqlx::query(
            "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id, line_type, polyline_mid_ratio) VALUES ($1,$2,$3,$4,$5,$6,$7)"
        )
        .bind(diagram_id).bind(from).bind(to).bind(&spid).bind(&tpid).bind(&lt).bind(pmr)
        .execute(&mut **tx).await?;
    }
    Ok(())
}

/// 从实时表 diagram_instances/diagram_edges 重建快照 JSON（hydrate 的逆操作）。
/// 保留 base 快照的 schemaVersion/selection/viewport，只重建 instances/connections；
/// 字段命名与 get_diagram_version_topology 的读取逻辑对齐（双写 from/source 命名）。
/// 守卫：若实时表无实例（未迁移的遗留快照图 / 从列表提交未打开的图），原样返回 base，避免清空数据。
async fn build_snapshot_from_realtime(
    pool: &PgPool,
    diagram_id: Uuid,
    base: &serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(diagram_id).fetch_all(pool).await?;

    if instances.is_empty() {
        return Ok(base.clone());
    }

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(diagram_id).fetch_all(pool).await?;

    let inst_json: Vec<serde_json::Value> = instances.iter().map(|i| json!({
        "id": i.id,
        "componentId": i.component_id,
        "label": i.label,
        "positionX": i.position_x,
        "positionY": i.position_y,
        "instanceData": i.instance_data,
    })).collect();

    let conn_json: Vec<serde_json::Value> = edges.iter().map(|e| json!({
        "id": e.id,
        "fromInstanceId": e.source_instance_id,
        "toInstanceId": e.target_instance_id,
        "sourceInstanceId": e.source_instance_id,
        "targetInstanceId": e.target_instance_id,
        "fromPinId": e.source_pin_id,
        "toPinId": e.target_pin_id,
        "sourcePinId": e.source_pin_id,
        "targetPinId": e.target_pin_id,
        "lineType": e.line_type,
        "polylineMidRatio": e.polyline_mid_ratio,
    })).collect();

    Ok(json!({
        "schemaVersion": base.get("schemaVersion").cloned().unwrap_or(json!(1)),
        "instances": inst_json,
        "connections": conn_json,
        "selection": base.get("selection").cloned().unwrap_or(json!(null)),
        "viewport": base.get("viewport").cloned().unwrap_or(json!({"zoom":1,"panX":0,"panY":0})),
    }))
}

// ========== Diagram CRUD ==========

pub async fn list_diagrams(pool: &PgPool, roles: &[String], user_id: Uuid) -> Result<Vec<Diagram>, AppError> {
    let diagrams = if roles.contains(&"ADMIN".to_string()) {
        sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams ORDER BY updated_at DESC")
            .fetch_all(pool).await?
    } else if roles.contains(&"REVIEWER".to_string()) {
        sqlx::query_as::<_, Diagram>(
            "SELECT * FROM diagrams WHERE owner_id = $1 OR status IN ('PENDING_REVIEW','PUBLISHED') ORDER BY updated_at DESC"
        ).bind(user_id).fetch_all(pool).await?
    } else {
        sqlx::query_as::<_, Diagram>(
            "SELECT * FROM diagrams WHERE owner_id = $1 OR status = 'PUBLISHED' ORDER BY updated_at DESC"
        ).bind(user_id).fetch_all(pool).await?
    };
    Ok(diagrams)
}

pub async fn get_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }
    Ok(d)
}

pub async fn create_diagram(pool: &PgPool, user_id: Uuid, name: &str, description: Option<&str>, snapshot: Option<serde_json::Value>) -> Result<Diagram, AppError> {
    if name.is_empty() {
        return Err(AppError::BadRequest("图纸名称不能为空".into()));
    }

    let snapshot = snapshot.map(|s| normalize_diagram_snapshot(&s)).unwrap_or_else(default_snapshot);

    let mut tx = pool.begin().await?;
    let diagram = sqlx::query_as::<_, Diagram>(
        "INSERT INTO diagrams (name, description, owner_id, status) VALUES ($1, $2, $3, 'DRAFT') RETURNING *"
    )
    .bind(name).bind(description).bind(user_id)
    .fetch_one(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by, status) VALUES ($1, 1, $2, $3, 'DRAFT')"
    )
    .bind(diagram.id).bind(&snapshot).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(diagram)
}

pub async fn update_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid, name: Option<String>, description: Option<String>) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权修改此图纸".into()));
    }
    if d.status != "DRAFT" && d.status != "REJECTED" {
        return Err(AppError::BadRequest("只能修改草稿或已驳回状态的图纸".into()));
    }

    if name.is_none() && description.is_none() {
        return Err(AppError::BadRequest("无更新内容".into()));
    }

    let name = name.unwrap_or(d.name);
    let description = description.or(d.description);

    let updated = sqlx::query_as::<_, Diagram>(
        "UPDATE diagrams SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *"
    )
    .bind(&name).bind(&description).bind(id)
    .fetch_one(pool).await?;

    Ok(updated)
}

pub async fn delete_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权删除此图纸".into()));
    }
    if d.status != "DRAFT" && d.status != "REJECTED" {
        return Err(AppError::BadRequest("只能删除草稿或已驳回状态的图纸".into()));
    }

    sqlx::query("DELETE FROM diagrams WHERE id = $1").bind(id)
        .execute(pool).await?;
    Ok(())
}

pub async fn duplicate_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let source = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    // 与其它图纸命令一致：复制前校验读权限，防止越权复制他人草稿
    if !can_read_diagram(roles, &source.owner_id, &source.status, &user_id) {
        return Err(AppError::Forbidden("无权复制此图纸".into()));
    }

    let mut new_name = format!("{}副本", source.name);
    let mut suffix = 2;
    loop {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM diagrams WHERE name = $1")
            .bind(&new_name).fetch_one(pool).await?;
        if count == 0 { break; }
        new_name = format!("{}副本{}", source.name, suffix);
        suffix += 1;
        if suffix > 100 { break; }
    }

    let mut tx = pool.begin().await?;
    let dup = sqlx::query_as::<_, Diagram>(
        "INSERT INTO diagrams (name, description, owner_id, status) VALUES ($1, $2, $3, 'DRAFT') RETURNING *"
    )
    .bind(&new_name).bind(&source.description).bind(user_id)
    .fetch_one(&mut *tx).await?;

    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(id).fetch_optional(&mut *tx).await?;

    if let Some(v) = latest_ver {
        sqlx::query(
            "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by, status) VALUES ($1, 1, $2, $3, 'DRAFT')"
        )
        .bind(dup.id).bind(&v.snapshot).bind(user_id)
        .execute(&mut *tx).await?;
    }

    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(id).fetch_all(&mut *tx).await?;

    let mut id_map: HashMap<Uuid, Uuid> = HashMap::new();
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
    ).bind(id).fetch_all(&mut *tx).await?;

    for edge in &edges {
        let new_source = id_map.get(&edge.source_instance_id).copied().unwrap_or(edge.source_instance_id);
        let new_target = id_map.get(&edge.target_instance_id).copied().unwrap_or(edge.target_instance_id);
        sqlx::query(
            "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id, line_type, polyline_mid_ratio) VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
        .bind(dup.id).bind(new_source).bind(new_target).bind(&edge.source_pin_id).bind(&edge.target_pin_id).bind(&edge.line_type).bind(edge.polyline_mid_ratio)
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;
    Ok(dup)
}

// ========== Diagram Editor ==========

pub async fn get_diagram_editor(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<serde_json::Value, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(id).fetch_all(pool).await?;

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(id).fetch_all(pool).await?;

    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?;

    // Auto-migrate legacy snapshot data if no real instances exist
    if instances.is_empty() {
        if let Some(ref ver) = latest_ver {
            if let Some(snap_instances) = ver.snapshot.get("instances").and_then(|v| v.as_array()) {
                if !snap_instances.is_empty() {
                    let mut tx = pool.begin().await?;
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
                        .bind(new_id).bind(id).bind(component_id).bind(&label).bind(x).bind(y).bind(&idata)
                        .execute(&mut *tx).await?;
                        if !old_id.is_empty() { new_id_map.insert(old_id.to_string(), new_id); }
                    }
                    if let Some(snap_conns) = ver.snapshot.get("connections").and_then(|v| v.as_array()) {
                        for sc in snap_conns {
                            let from = sc.get("fromInstanceId").or_else(|| sc.get("sourceInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
                            let to = sc.get("toInstanceId").or_else(|| sc.get("targetInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
                            let s_from = new_id_map.get(from).copied().unwrap_or(Uuid::nil());
                            let s_to = new_id_map.get(to).copied().unwrap_or(Uuid::nil());
                            let spid = sc.get("sourcePinId").or_else(|| sc.get("fromPinId")).and_then(|v| v.as_str()).unwrap_or("");
                            let tpid = sc.get("targetPinId").or_else(|| sc.get("toPinId")).and_then(|v| v.as_str()).unwrap_or("");
                            sqlx::query(
                                "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id) VALUES ($1, $2, $3, $4, $5)"
                            )
                            .bind(id).bind(s_from).bind(s_to).bind(spid).bind(tpid)
                            .execute(&mut *tx).await?;
                        }
                    }
                    tx.commit().await?;
                    // Re-fetch after migration - return recursive call
                    return Box::pin(get_diagram_editor(pool, roles, user_id, id)).await;
                }
            }
        }
    }

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
        "instances": instances,
        "edges": edges,
        "latestVersion": latest_ver,
    }))
}

pub async fn get_diagram_topology(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<TopologyResponse, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let instances = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE diagram_id = $1"
    ).bind(id).fetch_all(pool).await?;

    let edges = sqlx::query_as::<_, DiagramEdge>(
        "SELECT * FROM diagram_edges WHERE diagram_id = $1"
    ).bind(id).fetch_all(pool).await?;

    let mut instances_with_extras = Vec::new();
    for inst in &instances {
        let comp = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
            .bind(inst.component_id).fetch_optional(pool).await?;
        let dd = sqlx::query_as::<_, DistrictData>(
            "SELECT * FROM district_data WHERE diagram_instance_id = $1"
        ).bind(inst.id).fetch_optional(pool).await?;
        let gd = sqlx::query_as::<_, GisData>(
            "SELECT * FROM gis_data WHERE diagram_instance_id = $1"
        ).bind(inst.id).fetch_optional(pool).await?;
        let component_meta = if let Some(c) = comp {
            let snap = fetch_latest_component_snapshot(pool, c.id).await?;
            Some(ComponentMeta { id: c.id, name: c.name, category: c.category, snapshot: snap })
        } else {
            None
        };
        instances_with_extras.push(InstanceWithExtras {
            instance: inst.clone(),
            component: component_meta,
            district_data: dd,
            gis_data: gd,
        });
    }

    let mut edges_with_extras = Vec::new();
    for edge in &edges {
        let ld = sqlx::query_as::<_, LineSegmentData>(
            "SELECT * FROM line_segment_data WHERE diagram_edge_id = $1"
        ).bind(edge.id).fetch_optional(pool).await?;
        edges_with_extras.push(EdgeWithExtras { edge: edge.clone(), line_segment_data: ld });
    }

    Ok(TopologyResponse {
        diagram: d,
        instances: instances_with_extras,
        edges: edges_with_extras,
    })
}

pub async fn save_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid, snapshot: serde_json::Value) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权保存此图纸".into()));
    }
    if !latest_version_editable(pool, id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可保存".into()));
    }

    if !snapshot.is_object() || snapshot.is_array() {
        return Err(AppError::BadRequest("快照数据格式无效".into()));
    }

    let snapshot = normalize_diagram_snapshot(&snapshot);

    let mut tx = pool.begin().await?;

    // Reuse existing DRAFT version instead of creating a new one each save
    let existing_draft_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM diagram_versions WHERE diagram_id = $1 AND status = 'DRAFT' ORDER BY version_no DESC LIMIT 1"
    )
    .bind(id).fetch_optional(&mut *tx).await?;

    if let Some(draft_id) = existing_draft_id {
        sqlx::query("UPDATE diagram_versions SET snapshot = $1 WHERE id = $2")
            .bind(&snapshot).bind(draft_id)
            .execute(&mut *tx).await?;
    } else {
        let latest_no = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(version_no), 0) FROM diagram_versions WHERE diagram_id = $1"
        ).bind(id).fetch_one(&mut *tx).await?;

        sqlx::query(
            "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by, status) VALUES ($1, $2, $3, $4, 'DRAFT')"
        )
        .bind(id).bind(latest_no + 1).bind(&snapshot).bind(user_id)
        .execute(&mut *tx).await?;
    }

    let online = has_online_version(pool, id).await?;
    let updated = if online {
        sqlx::query_as::<_, Diagram>("UPDATE diagrams SET updated_at = NOW() WHERE id = $1 RETURNING *")
            .bind(id).fetch_one(&mut *tx).await?
    } else {
        sqlx::query_as::<_, Diagram>("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1 RETURNING *")
            .bind(id).fetch_one(&mut *tx).await?
    };

    tx.commit().await?;
    Ok(updated)
}

// ========== Review Flow ==========

pub async fn submit_diagram_review(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, id).await? {
        return Err(AppError::BadRequest("图纸状态不允许提交审核".into()));
    }

    let latest_ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("请先保存图纸".into()))?;

    // 提交前从实时表重建该版本快照，确保送审/审核/转正使用的快照与编辑器当前状态一致。
    // （元件命名、位置等改动只写入实时表 diagram_instances，未必已手动落盘到快照。）
    let rebuilt = build_snapshot_from_realtime(pool, id, &latest_ver.snapshot).await?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE diagram_versions SET snapshot = $1 WHERE id = $2")
        .bind(&rebuilt).bind(latest_ver.id).execute(&mut *tx).await?;

    let online = has_online_version(pool, id).await?;
    if online {
        sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'PENDING_REVIEW', updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    }

    sqlx::query(
        "INSERT INTO review_requests (diagram_id, diagram_version_id, submitter_id, status) VALUES ($1, $2, $3, 'PENDING')"
    )
    .bind(id).bind(latest_ver.id).bind(user_id)
    .execute(&mut *tx).await?;

    sqlx::query("UPDATE diagram_versions SET status = 'REVIEWING' WHERE id = $1")
        .bind(latest_ver.id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

pub async fn withdraw_diagram_review(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    let latest_reviewing = sqlx::query_scalar::<_, String>(
        "SELECT status FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?;
    if latest_reviewing.as_deref() != Some("REVIEWING") {
        return Err(AppError::BadRequest("只有审核中的图纸可以撤回".into()));
    }

    let mut tx = pool.begin().await?;
    let online = has_online_version(pool, id).await?;
    if online {
        sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    }

    sqlx::query(
        "UPDATE review_requests SET status = 'WITHDRAWN' WHERE diagram_id = $1 AND status = 'PENDING'"
    )
    .bind(id).execute(&mut *tx).await?;

    sqlx::query("UPDATE diagram_versions SET status = 'DRAFT' WHERE diagram_id = $1 AND status = 'REVIEWING'")
        .bind(id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

pub async fn request_delete_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if d.status == "PENDING_DELETE" || d.status == "PENDING_REVIEW" {
        return Err(AppError::BadRequest("图纸状态不允许申请删除".into()));
    }

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE diagrams SET status = 'PENDING_DELETE', updated_at = NOW() WHERE id = $1")
        .bind(id).execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO review_requests (diagram_id, diagram_version_id, submitter_id, status) SELECT $1, id, $2, 'PENDING' FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(id).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

/// 发起/进入修订：确保存在一个可编辑的修订草稿，返回图纸。
/// - 最新版本 ONLINE → 基于其快照创建新 DRAFT 版本（图纸保持 PUBLISHED）。
/// - 最新版本 DRAFT/REJECTED（已有修订草稿）→ 直接返回，进入编辑现有草稿。
/// - 最新版本 REVIEWING → 报错（审核中）。
pub async fn revise_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权修订此图纸".into()));
    }

    // 在事务内锁定图纸行，串行化并发修订，防止 check-then-insert 竞态创建多个草稿
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT id FROM diagrams WHERE id = $1 FOR UPDATE").bind(id).execute(&mut *tx).await?;

    let latest = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::BadRequest("图纸无版本".into()))?;

    match latest.status.as_str() {
        "DRAFT" | "REJECTED" => {
            // 已有进行中修订草稿，直接进入编辑
            tx.commit().await?;
            Ok(d)
        }
        "REVIEWING" => Err(AppError::BadRequest("修订正在审核中，请先撤回或等待审核".into())),
        "ONLINE" => {
            // 基于 ONLINE 快照创建新 DRAFT 修订版本，图纸保持 PUBLISHED
            let next_no = sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(MAX(version_no), 0) FROM diagram_versions WHERE diagram_id = $1"
            ).bind(id).fetch_one(&mut *tx).await? + 1;
            sqlx::query(
                "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by, status) VALUES ($1, $2, $3, $4, 'DRAFT')"
            )
            .bind(id).bind(next_no).bind(&latest.snapshot).bind(user_id)
            .execute(&mut *tx).await?;
            sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(d)
        }
        _ => Err(AppError::BadRequest("当前状态不可修订".into())),
    }
}

/// 放弃修订：删除进行中的修订草稿版本，并把实时表恢复为 ONLINE 快照。
pub async fn discard_revision(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }

    let latest = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("图纸无版本".into()))?;

    // 必须是修订草稿（DRAFT/REJECTED）且存在 ONLINE 版本
    if !matches!(latest.status.as_str(), "DRAFT" | "REJECTED") {
        return Err(AppError::BadRequest("当前没有可放弃的修订草稿".into()));
    }
    let online = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE' ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("图纸未发布，无修订可放弃".into()))?;

    let mut tx = pool.begin().await?;
    // 删除整条修订链（version_no 高于 ONLINE 的所有草稿/驳回版本），避免「驳回后再 save 生成新 DRAFT」造成残留
    sqlx::query("DELETE FROM diagram_versions WHERE diagram_id = $1 AND version_no > $2")
        .bind(id).bind(online.version_no).execute(&mut *tx).await?;
    hydrate_realtime_from_snapshot(&mut tx, id, &online.snapshot).await?;
    sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(d)
}

// ========== Instance CRUD ==========

pub async fn create_diagram_instance(
    pool: &PgPool, roles: &[String], user_id: Uuid,
    diagram_id: Uuid, component_id: Uuid, label: Option<String>,
    position_x: Option<f64>, position_y: Option<f64>, instance_data: Option<serde_json::Value>,
) -> Result<DiagramInstance, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    let comp = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(component_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let label = label.unwrap_or_else(|| comp.name.clone());
    let instance = sqlx::query_as::<_, DiagramInstance>(
        "INSERT INTO diagram_instances (diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(diagram_id).bind(component_id).bind(&label)
    .bind(position_x.unwrap_or(0.0)).bind(position_y.unwrap_or(0.0))
    .bind(instance_data.unwrap_or(json!({})))
    .fetch_one(pool).await?;

    Ok(instance)
}

pub async fn update_diagram_instance(
    pool: &PgPool, roles: &[String], user_id: Uuid,
    diagram_id: Uuid, instance_id: Uuid, label: Option<String>,
    position_x: Option<f64>, position_y: Option<f64>, component_id: Option<Uuid>,
    instance_data: Option<serde_json::Value>,
) -> Result<DiagramInstance, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    let inst = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    )
    .bind(instance_id).bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let label = label.unwrap_or(inst.label);
    let px = position_x.unwrap_or(inst.position_x);
    let py = position_y.unwrap_or(inst.position_y);
    let cid = component_id.unwrap_or(inst.component_id);
    let idata = instance_data.unwrap_or(inst.instance_data);

    if px.is_nan() || py.is_nan() {
        return Err(AppError::BadRequest("坐标值无效".into()));
    }

    let updated = sqlx::query_as::<_, DiagramInstance>(
        "UPDATE diagram_instances SET label = $1, position_x = $2, position_y = $3, component_id = $4, instance_data = $5, updated_at = NOW() WHERE id = $6 RETURNING *"
    )
    .bind(&label).bind(px).bind(py).bind(cid).bind(&idata).bind(instance_id)
    .fetch_one(pool).await?;

    Ok(updated)
}

pub async fn delete_diagram_instance(pool: &PgPool, roles: &[String], user_id: Uuid, diagram_id: Uuid, instance_id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    sqlx::query("DELETE FROM diagram_instances WHERE id = $1 AND diagram_id = $2")
        .bind(instance_id).bind(diagram_id).execute(pool).await?;

    Ok(())
}

// ========== Edge CRUD ==========

pub async fn create_diagram_edge(
    pool: &PgPool, roles: &[String], user_id: Uuid,
    diagram_id: Uuid, source_instance_id: Uuid, target_instance_id: Uuid,
    source_pin_id: &str, target_pin_id: &str, line_type: Option<&str>,
    polyline_mid_ratio: Option<f64>,
) -> Result<DiagramEdge, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    let _s = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    ).bind(source_instance_id).bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("源实例不存在或不属于该图纸".into()))?;
    let _t = sqlx::query_as::<_, DiagramInstance>(
        "SELECT * FROM diagram_instances WHERE id = $1 AND diagram_id = $2"
    ).bind(target_instance_id).bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("目标实例不存在或不属于该图纸".into()))?;

    let lt = line_type.unwrap_or("straight");
    let edge = sqlx::query_as::<_, DiagramEdge>(
        "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id, line_type, polyline_mid_ratio) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *"
    )
    .bind(diagram_id).bind(source_instance_id).bind(target_instance_id)
    .bind(source_pin_id).bind(target_pin_id).bind(lt).bind(polyline_mid_ratio)
    .fetch_one(pool).await?;

    Ok(edge)
}

pub async fn update_diagram_edge_line_type(
    pool: &PgPool, roles: &[String], user_id: Uuid,
    diagram_id: Uuid, edge_id: Uuid, line_type: &str,
) -> Result<DiagramEdge, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    let valid_types = ["straight", "curve", "polyline", "polyline-hvh", "polyline-vhv"];
    if !valid_types.contains(&line_type) {
        return Err(AppError::BadRequest("无效的线型".into()));
    }

    let edge = sqlx::query_as::<_, DiagramEdge>(
        "UPDATE diagram_edges SET line_type = $1, updated_at = NOW() WHERE id = $2 AND diagram_id = $3 RETURNING *"
    )
    .bind(line_type).bind(edge_id).bind(diagram_id)
    .fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("连线不存在".into()))?;

    Ok(edge)
}

pub async fn update_diagram_edge_polyline_mid_ratio(
    pool: &PgPool, roles: &[String], user_id: Uuid,
    diagram_id: Uuid, edge_id: Uuid, polyline_mid_ratio: f64,
) -> Result<DiagramEdge, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    if polyline_mid_ratio < 0.05 || polyline_mid_ratio > 0.95 {
        return Err(AppError::BadRequest("折线比率需在 0.05~0.95 之间".into()));
    }

    let edge = sqlx::query_as::<_, DiagramEdge>(
        "UPDATE diagram_edges SET polyline_mid_ratio = $1, updated_at = NOW() WHERE id = $2 AND diagram_id = $3 RETURNING *"
    )
    .bind(polyline_mid_ratio).bind(edge_id).bind(diagram_id)
    .fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("连线不存在".into()))?;

    Ok(edge)
}

pub async fn delete_diagram_edge(pool: &PgPool, roles: &[String], user_id: Uuid, diagram_id: Uuid, edge_id: Uuid) -> Result<(), AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }

    sqlx::query("DELETE FROM diagram_edges WHERE id = $1 AND diagram_id = $2")
        .bind(edge_id).bind(diagram_id).execute(pool).await?;

    Ok(())
}

// ========== Version Timeline ==========

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: Uuid,
    pub version_no: i32,
    pub status: String,
    pub created_by: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub published_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn list_diagram_versions(
    pool: &PgPool,
    roles: &[String],
    user_id: Uuid,
    diagram_id: Uuid,
) -> Result<Vec<VersionSummary>, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let can_see_all = roles.contains(&"ADMIN".to_string())
        || roles.contains(&"DIAGRAM_EDITOR".to_string())
        || roles.contains(&"REVIEWER".to_string());

    let versions = if can_see_all {
        sqlx::query_as::<_, VersionSummary>(
            "SELECT id, version_no, status, created_by, created_at, published_at FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC"
        )
        .bind(diagram_id).fetch_all(pool).await?
    } else {
        sqlx::query_as::<_, VersionSummary>(
            "SELECT id, version_no, status, created_by, created_at, published_at FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE' ORDER BY version_no DESC"
        )
        .bind(diagram_id).fetch_all(pool).await?
    };

    Ok(versions)
}

pub async fn get_diagram_version_topology(
    pool: &PgPool,
    roles: &[String],
    user_id: Uuid,
    diagram_id: Uuid,
    version_id: Uuid,
) -> Result<TopologyResponse, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_read_diagram(roles, &d.owner_id, &d.status, &user_id) {
        return Err(AppError::Forbidden("无权访问此图纸".into()));
    }

    let ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE id = $1 AND diagram_id = $2"
    )
    .bind(version_id).bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("版本不存在".into()))?;

    let can_see_all = roles.contains(&"ADMIN".to_string())
        || roles.contains(&"DIAGRAM_EDITOR".to_string())
        || roles.contains(&"REVIEWER".to_string());

    if !can_see_all && ver.status != "ONLINE" {
        return Err(AppError::Forbidden("无权查看此版本".into()));
    }

    // Reconstruct topology from snapshot JSONB
    let snap_instances = ver.snapshot.get("instances")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let snap_connections = ver.snapshot.get("connections")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut instances_with_extras = Vec::new();
    for si in &snap_instances {
        let old_id = si.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let comp_id_str = si.get("componentId").and_then(|v| v.as_str()).unwrap_or("");
        let comp_id: Uuid = comp_id_str.parse().unwrap_or(Uuid::nil());
        let label = si.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let x = si.get("positionX").or_else(|| si.get("x")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let y = si.get("positionY").or_else(|| si.get("y")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let idata = si.get("instanceData").cloned().unwrap_or(json!({}));
        let iid: Uuid = old_id.parse().unwrap_or(Uuid::new_v4());

        let comp = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
            .bind(comp_id).fetch_optional(pool).await.ok().flatten();

        let component_meta = if let Some(c) = comp {
            let snap = fetch_latest_component_snapshot(pool, c.id).await.ok().flatten();
            Some(ComponentMeta { id: c.id, name: c.name, category: c.category, snapshot: snap })
        } else {
            None
        };

        instances_with_extras.push(InstanceWithExtras {
            instance: DiagramInstance {
                id: iid,
                diagram_id,
                component_id: comp_id,
                label,
                position_x: x,
                position_y: y,
                instance_data: idata,
                created_at: ver.created_at,
                updated_at: ver.created_at,
            },
            component: component_meta,
            district_data: None,
            gis_data: None,
        });
    }

    let mut edges_with_extras = Vec::new();
    for sc in &snap_connections {
        let from_str = sc.get("fromInstanceId").or_else(|| sc.get("sourceInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
        let to_str = sc.get("toInstanceId").or_else(|| sc.get("targetInstanceId")).and_then(|v| v.as_str()).unwrap_or("");
        let spid = sc.get("sourcePinId").or_else(|| sc.get("fromPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tpid = sc.get("targetPinId").or_else(|| sc.get("toPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let lt = sc.get("lineType").and_then(|v| v.as_str()).unwrap_or("straight").to_string();
        let pmr = sc.get("polylineMidRatio").and_then(|v| v.as_f64());
        let s_from: Uuid = from_str.parse().unwrap_or(Uuid::nil());
        let s_to: Uuid = to_str.parse().unwrap_or(Uuid::nil());
        let eid = Uuid::new_v4();

        edges_with_extras.push(EdgeWithExtras {
            edge: DiagramEdge {
                id: eid,
                diagram_id,
                source_instance_id: s_from,
                target_instance_id: s_to,
                source_pin_id: spid,
                target_pin_id: tpid,
                line_type: lt,
                polyline_mid_ratio: pmr,
                created_at: ver.created_at,
                updated_at: ver.created_at,
            },
            line_segment_data: None,
        });
    }

    Ok(TopologyResponse {
        diagram: d,
        instances: instances_with_extras,
        edges: edges_with_extras,
    })
}

pub async fn delete_diagram_version(
    pool: &PgPool,
    roles: &[String],
    user_id: Uuid,
    diagram_id: Uuid,
    version_id: Uuid,
) -> Result<(), AppError> {
    if !roles.contains(&"ADMIN".to_string()) && !roles.contains(&"DIAGRAM_EDITOR".to_string()) {
        return Err(AppError::Forbidden("无权删除版本".into()));
    }

    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }

    let ver = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE id = $1 AND diagram_id = $2"
    )
    .bind(version_id).bind(diagram_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("版本不存在".into()))?;

    if ver.status == "ONLINE" {
        return Err(AppError::BadRequest("不能删除当前在线版本".into()));
    }
    if ver.status == "REVIEWING" {
        return Err(AppError::BadRequest("不能删除审核中的版本".into()));
    }
    if ver.status == "DRAFT" {
        return Err(AppError::BadRequest("修订草稿请通过\"放弃修订\"撤销，不在此删除".into()));
    }

    let version_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM diagram_versions WHERE diagram_id = $1"
    )
    .bind(diagram_id).fetch_one(pool).await?;

    if version_count <= 1 {
        return Err(AppError::BadRequest("不能删除唯一的版本".into()));
    }

    sqlx::query("DELETE FROM diagram_versions WHERE id = $1")
        .bind(version_id).execute(pool).await?;

    Ok(())
}
