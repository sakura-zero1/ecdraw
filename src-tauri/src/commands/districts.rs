use crate::error::AppError;
use crate::middleware;
use crate::models::DistrictData;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpsertDistrictInput {
    pub token: String,
    pub instance_id: String,
    pub transformer_capacity: Option<f64>,
    pub supply_range: Option<String>,
    pub supply_area: Option<String>,
    pub household_count: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchDistrictInput {
    pub token: String,
    pub items: Vec<BatchDistrictItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchDistrictItem {
    pub diagram_instance_id: String,
    pub transformer_capacity: Option<f64>,
    pub supply_range: Option<String>,
    pub supply_area: Option<String>,
    pub household_count: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DistrictWithInstance {
    pub id: Uuid,
    pub diagram_instance_id: Uuid,
    pub transformer_capacity: Option<f64>,
    pub supply_range: Option<String>,
    pub supply_area: Option<String>,
    pub household_count: Option<i32>,
    pub updated_by: Uuid,
    pub created_at: String,
    pub updated_at: String,
    pub instance_label: Option<String>,
    pub component_id: Option<Uuid>,
}

/// GET /api/districts/diagram/:diagramId
#[tauri::command]
pub async fn list_districts_by_diagram(
    state: State<'_, AppState>,
    token: String,
    diagram_id: String,
) -> Result<Vec<DistrictWithInstance>, AppError> {
    let _claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let did: Uuid = diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;

    let items = sqlx::query_as::<_, DistrictData>(
        r#"SELECT d.* FROM district_data d
           JOIN diagram_instances di ON d.diagram_instance_id = di.id
           WHERE di.diagram_id = $1"#
    )
    .bind(did)
    .fetch_all(&state.pool)
    .await?;

    let mut results = Vec::new();
    for item in items {
        results.push(DistrictWithInstance {
            id: item.id,
            diagram_instance_id: item.diagram_instance_id,
            transformer_capacity: item.transformer_capacity,
            supply_range: item.supply_range,
            supply_area: item.supply_area,
            household_count: item.household_count,
            updated_by: item.updated_by,
            created_at: item.created_at.to_rfc3339(),
            updated_at: item.updated_at.to_rfc3339(),
            instance_label: None,
            component_id: None,
        });
    }

    Ok(results)
}

/// PUT /api/districts/instance/:instanceId
#[tauri::command]
pub async fn upsert_district(
    state: State<'_, AppState>,
    input: UpsertDistrictInput,
) -> Result<DistrictData, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "DISTRICT_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();
    let iid: Uuid = input.instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;

    let _inst = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM diagram_instances WHERE id = $1"
    )
    .bind(iid).fetch_optional(&state.pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let data = sqlx::query_as::<_, DistrictData>(
        r#"INSERT INTO district_data (diagram_instance_id, transformer_capacity, supply_range, supply_area, household_count, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (diagram_instance_id)
           DO UPDATE SET transformer_capacity = $2, supply_range = $3, supply_area = $4, household_count = $5, updated_by = $6, updated_at = NOW()
           RETURNING *"#
    )
    .bind(iid)
    .bind(input.transformer_capacity).bind(&input.supply_range)
    .bind(&input.supply_area).bind(input.household_count)
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(data)
}

/// POST /api/districts/batch
#[tauri::command]
pub async fn batch_upsert_districts(
    state: State<'_, AppState>,
    input: BatchDistrictInput,
) -> Result<i32, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "DISTRICT_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse().unwrap();

    if input.items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0;
    for item in &input.items {
        let iid: Uuid = item.diagram_instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;
        let r = sqlx::query(
            r#"INSERT INTO district_data (diagram_instance_id, transformer_capacity, supply_range, supply_area, household_count, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (diagram_instance_id)
               DO UPDATE SET transformer_capacity = $2, supply_range = $3, supply_area = $4, household_count = $5, updated_by = $6, updated_at = NOW()"#
        )
        .bind(iid)
        .bind(item.transformer_capacity).bind(&item.supply_range)
        .bind(&item.supply_area).bind(item.household_count)
        .bind(user_id)
        .execute(&state.pool)
        .await?;
        count += r.rows_affected() as i32;
    }

    Ok(count)
}
