use crate::error::AppError;
use crate::models::DistrictData;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_id: Option<Uuid>,
}

pub async fn list_districts_by_diagram(pool: &PgPool, diagram_id: Uuid) -> Result<Vec<DistrictWithInstance>, AppError> {
    let items = sqlx::query_as::<_, DistrictData>(
        r#"SELECT d.* FROM district_data d
           JOIN diagram_instances di ON d.diagram_instance_id = di.id
           WHERE di.diagram_id = $1"#
    )
    .bind(diagram_id)
    .fetch_all(pool)
    .await?;

    let results = items.into_iter().map(|item| DistrictWithInstance {
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
    }).collect();

    Ok(results)
}

pub async fn upsert_district(
    pool: &PgPool,
    user_id: Uuid,
    instance_id: Uuid,
    transformer_capacity: Option<f64>,
    supply_range: Option<String>,
    supply_area: Option<String>,
    household_count: Option<i32>,
) -> Result<DistrictData, AppError> {
    let _inst = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM diagram_instances WHERE id = $1"
    )
    .bind(instance_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let data = sqlx::query_as::<_, DistrictData>(
        r#"INSERT INTO district_data (diagram_instance_id, transformer_capacity, supply_range, supply_area, household_count, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (diagram_instance_id)
           DO UPDATE SET transformer_capacity = $2, supply_range = $3, supply_area = $4, household_count = $5, updated_by = $6, updated_at = NOW()
           RETURNING *"#
    )
    .bind(instance_id)
    .bind(transformer_capacity).bind(&supply_range)
    .bind(&supply_area).bind(household_count)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(data)
}

pub async fn batch_upsert_districts(
    pool: &PgPool,
    user_id: Uuid,
    items: &[(Uuid, Option<f64>, Option<String>, Option<String>, Option<i32>)],
) -> Result<i32, AppError> {
    if items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0i32;
    for (iid, tc, sr, sa, hc) in items {
        let r = sqlx::query(
            r#"INSERT INTO district_data (diagram_instance_id, transformer_capacity, supply_range, supply_area, household_count, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (diagram_instance_id)
               DO UPDATE SET transformer_capacity = $2, supply_range = $3, supply_area = $4, household_count = $5, updated_by = $6, updated_at = NOW()"#
        )
        .bind(iid).bind(tc).bind(sr).bind(sa).bind(hc).bind(user_id)
        .execute(pool).await?;
        count += r.rows_affected() as i32;
    }
    Ok(count)
}
