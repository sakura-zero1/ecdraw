use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::models::LineSegmentData;
use ecdraw_core::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchLineItem {
    pub diagram_edge_id: String,
    pub length: Option<f64>,
    pub wire_model: Option<String>,
    pub wire_ownership: Option<String>,
    pub wire_type: Option<String>,
    pub is_main_display: Option<bool>,
}

/// GET /api/lines/diagram/:diagramId
#[tauri::command]
pub async fn list_lines_by_diagram(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    let _claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let items = sqlx::query_as::<_, LineSegmentData>(
        r#"SELECT l.* FROM line_segment_data l
           JOIN diagram_edges de ON l.diagram_edge_id = de.id
           WHERE de.diagram_id = $1"#
    )
    .bind(did)
    .fetch_all(&state.pool)
    .await?;

    let results: Vec<serde_json::Value> = items.iter().map(|data| {
        json!({
            "id": data.id,
            "diagramEdgeId": data.diagram_edge_id,
            "length": data.length,
            "wireModel": data.wire_model,
            "wireOwnership": data.wire_ownership,
            "wireType": data.wire_type,
            "isMainDisplay": data.is_main_display,
        })
    }).collect();

    Ok(results)
}

/// PUT /api/lines/edge/:edgeId
#[tauri::command]
pub async fn upsert_line(
    state: State<'_, AppState>,
    token: String,
    edge_id: String,
    length: Option<f64>,
    wire_model: Option<String>,
    wire_ownership: Option<String>,
    wire_type: Option<String>,
    is_main_display: Option<bool>,
) -> Result<LineSegmentData, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "LINE_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    let eid: Uuid = edge_id.parse().map_err(|_| AppError::BadRequest("无效的边ID".into()))?;

    let _edge = sqlx::query_scalar::<_, Uuid>("SELECT id FROM diagram_edges WHERE id = $1")
        .bind(eid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("边不存在".into()))?;

    let is_main = is_main_display.unwrap_or(true);

    let data = sqlx::query_as::<_, LineSegmentData>(
        r#"INSERT INTO line_segment_data (diagram_edge_id, length, wire_model, wire_ownership, wire_type, is_main_display, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (diagram_edge_id)
           DO UPDATE SET length = $2, wire_model = $3, wire_ownership = $4, wire_type = $5, is_main_display = $6, updated_by = $7, updated_at = NOW()
           RETURNING *"#
    )
    .bind(eid).bind(length).bind(&wire_model)
    .bind(&wire_ownership).bind(&wire_type)
    .bind(is_main).bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(data)
}

/// POST /api/lines/batch
#[tauri::command]
pub async fn batch_upsert_lines(
    state: State<'_, AppState>,
    token: String,
    items: Vec<BatchLineItem>,
) -> Result<i32, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "LINE_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;

    if items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0;
    for item in &items {
        let eid: Uuid = item.diagram_edge_id.parse().map_err(|_| AppError::BadRequest("无效的边ID".into()))?;
        let is_main = item.is_main_display.unwrap_or(true);
        let r = sqlx::query(
            r#"INSERT INTO line_segment_data (diagram_edge_id, length, wire_model, wire_ownership, wire_type, is_main_display, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (diagram_edge_id)
               DO UPDATE SET length = $2, wire_model = $3, wire_ownership = $4, wire_type = $5, is_main_display = $6, updated_by = $7, updated_at = NOW()"#
        )
        .bind(eid).bind(item.length).bind(&item.wire_model)
        .bind(&item.wire_ownership).bind(&item.wire_type)
        .bind(is_main).bind(user_id)
        .execute(&state.pool).await?;
        count += r.rows_affected() as i32;
    }

    Ok(count)
}
