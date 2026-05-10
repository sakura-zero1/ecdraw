use crate::error::AppError;
use crate::models::GisData;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_gis_by_diagram(pool: &PgPool, diagram_id: Uuid) -> Result<Vec<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, GisData>(
        r#"SELECT g.* FROM gis_data g
           JOIN diagram_instances di ON g.diagram_instance_id = di.id
           WHERE di.diagram_id = $1"#
    )
    .bind(diagram_id)
    .fetch_all(pool)
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

pub async fn upsert_gis(
    pool: &PgPool,
    user_id: Uuid,
    instance_id: Uuid,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<GisData, AppError> {
    let _inst = sqlx::query_scalar::<_, Uuid>("SELECT id FROM diagram_instances WHERE id = $1")
        .bind(instance_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("实例不存在".into()))?;

    let data = sqlx::query_as::<_, GisData>(
        r#"INSERT INTO gis_data (diagram_instance_id, latitude, longitude, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (diagram_instance_id)
           DO UPDATE SET latitude = $2, longitude = $3, updated_by = $4, updated_at = NOW()
           RETURNING *"#
    )
    .bind(instance_id).bind(latitude).bind(longitude).bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(data)
}

pub async fn batch_upsert_gis(
    pool: &PgPool,
    user_id: Uuid,
    items: &[(Uuid, Option<f64>, Option<f64>)],
) -> Result<i32, AppError> {
    if items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0i32;
    for (iid, lat, lng) in items {
        let r = sqlx::query(
            r#"INSERT INTO gis_data (diagram_instance_id, latitude, longitude, updated_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (diagram_instance_id)
               DO UPDATE SET latitude = $2, longitude = $3, updated_by = $4, updated_at = NOW()"#
        )
        .bind(iid).bind(lat).bind(lng).bind(user_id)
        .execute(pool).await?;
        count += r.rows_affected() as i32;
    }
    Ok(count)
}
