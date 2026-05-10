use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::models::GisData;
use ecdraw_core::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchGisItem {
    pub diagram_instance_id: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

/// GET /api/gis/diagram/:diagramId
#[tauri::command]
pub async fn list_gis_by_diagram(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    let _claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let items = sqlx::query_as::<_, GisData>(
        r#"SELECT g.* FROM gis_data g
           JOIN diagram_instances di ON g.diagram_instance_id = di.id
           WHERE di.diagram_id = $1"#
    )
    .bind(did)
    .fetch_all(&state.pool)
    .await?;

    let results: Vec<serde_json::Value> = items.iter().map(|data| {
        json!({
            "id": data.id,
            "diagramInstanceId": data.diagram_instance_id,
            "latitude": data.latitude,
            "longitude": data.longitude,
        })
    }).collect();

    Ok(results)
}

/// PUT /api/gis/instance/:instanceId
#[tauri::command]
pub async fn upsert_gis(
    state: State<'_, AppState>,
    token: String,
    instance_id: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<GisData, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "GIS_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let iid: Uuid = instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;

    let _inst = sqlx::query_scalar::<_, Uuid>("SELECT id FROM diagram_instances WHERE id = $1")
        .bind(iid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let data = sqlx::query_as::<_, GisData>(
        r#"INSERT INTO gis_data (diagram_instance_id, latitude, longitude, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (diagram_instance_id)
           DO UPDATE SET latitude = $2, longitude = $3, updated_by = $4, updated_at = NOW()
           RETURNING *"#
    )
    .bind(iid).bind(latitude).bind(longitude).bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(data)
}

/// POST /api/gis/batch
#[tauri::command]
pub async fn batch_upsert_gis(
    state: State<'_, AppState>,
    token: String,
    items: Vec<BatchGisItem>,
) -> Result<i32, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "GIS_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    if items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0;
    for item in &items {
        let iid: Uuid = item.diagram_instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;
        let r = sqlx::query(
            r#"INSERT INTO gis_data (diagram_instance_id, latitude, longitude, updated_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (diagram_instance_id)
               DO UPDATE SET latitude = $2, longitude = $3, updated_by = $4, updated_at = NOW()"#
        )
        .bind(iid).bind(item.latitude).bind(item.longitude).bind(user_id)
        .execute(&state.pool).await?;
        count += r.rows_affected() as i32;
    }

    Ok(count)
}
