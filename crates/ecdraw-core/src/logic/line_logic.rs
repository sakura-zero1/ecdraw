use crate::error::AppError;
use crate::models::LineSegmentData;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_lines_by_diagram(pool: &PgPool, diagram_id: Uuid) -> Result<Vec<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, LineSegmentData>(
        r#"SELECT l.* FROM line_segment_data l
           JOIN diagram_edges de ON l.diagram_edge_id = de.id
           WHERE de.diagram_id = $1"#
    )
    .bind(diagram_id)
    .fetch_all(pool)
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

pub async fn upsert_line(
    pool: &PgPool,
    user_id: Uuid,
    edge_id: Uuid,
    length: Option<f64>,
    wire_model: Option<String>,
    wire_ownership: Option<String>,
    wire_type: Option<String>,
    is_main_display: bool,
) -> Result<LineSegmentData, AppError> {
    let _edge = sqlx::query_scalar::<_, Uuid>("SELECT id FROM diagram_edges WHERE id = $1")
        .bind(edge_id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("边不存在".into()))?;

    let data = sqlx::query_as::<_, LineSegmentData>(
        r#"INSERT INTO line_segment_data (diagram_edge_id, length, wire_model, wire_ownership, wire_type, is_main_display, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (diagram_edge_id)
           DO UPDATE SET length = $2, wire_model = $3, wire_ownership = $4, wire_type = $5, is_main_display = $6, updated_by = $7, updated_at = NOW()
           RETURNING *"#
    )
    .bind(edge_id).bind(length).bind(&wire_model)
    .bind(&wire_ownership).bind(&wire_type)
    .bind(is_main_display).bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(data)
}

pub async fn batch_upsert_lines(
    pool: &PgPool,
    user_id: Uuid,
    items: &[(Uuid, Option<f64>, Option<String>, Option<String>, Option<String>, bool)],
) -> Result<i32, AppError> {
    if items.len() > 500 {
        return Err(AppError::BadRequest("单次最多导入500条".into()));
    }

    let mut count = 0i32;
    for (eid, len, wm, wo, wt, is_main) in items {
        let r = sqlx::query(
            r#"INSERT INTO line_segment_data (diagram_edge_id, length, wire_model, wire_ownership, wire_type, is_main_display, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (diagram_edge_id)
               DO UPDATE SET length = $2, wire_model = $3, wire_ownership = $4, wire_type = $5, is_main_display = $6, updated_by = $7, updated_at = NOW()"#
        )
        .bind(eid).bind(len).bind(wm).bind(wo).bind(wt).bind(is_main).bind(user_id)
        .execute(pool).await?;
        count += r.rows_affected() as i32;
    }
    Ok(count)
}
