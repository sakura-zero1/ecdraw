use crate::error::AppError;
use crate::models::{Component, ComponentVersion};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentWithVersion {
    #[serde(flatten)]
    pub component: Component,
    pub latest_version: Option<ComponentVersion>,
}

pub async fn list_components(pool: &PgPool, user_id: Uuid, is_admin: bool) -> Result<Vec<ComponentWithVersion>, AppError> {
    let components = if is_admin {
        sqlx::query_as::<_, Component>("SELECT * FROM components ORDER BY updated_at DESC")
            .fetch_all(pool).await?
    } else {
        sqlx::query_as::<_, Component>("SELECT * FROM components WHERE owner_id = $1 ORDER BY updated_at DESC")
            .bind(user_id).fetch_all(pool).await?
    };

    let mut results = Vec::new();
    for c in components {
        let ver = sqlx::query_as::<_, ComponentVersion>(
            "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
        )
        .bind(c.id).fetch_optional(pool).await?;
        results.push(ComponentWithVersion { component: c, latest_version: ver });
    }
    Ok(results)
}

pub async fn get_component(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid) -> Result<ComponentWithVersion, AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    let ver = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(c.id).fetch_optional(pool).await?;

    Ok(ComponentWithVersion { component: c, latest_version: ver })
}

pub async fn create_component(pool: &PgPool, user_id: Uuid, name: &str, category: &str, description: Option<&str>) -> Result<Component, AppError> {
    if name.is_empty() || category.is_empty() {
        return Err(AppError::BadRequest("名称和分类不能为空".into()));
    }

    let component = sqlx::query_as::<_, Component>(
        "INSERT INTO components (name, category, description, owner_id) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(name).bind(category).bind(description).bind(user_id)
    .fetch_one(pool).await?;

    let default_snapshot = json!({
        "schemaVersion": 1,
        "shapeElements": [],
        "pins": [],
        "matrix": { "connections": [] }
    });
    sqlx::query(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
    )
    .bind(component.id).bind(&default_snapshot).bind(user_id)
    .execute(pool).await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_CREATE', 'Component', $2, $3)"
    )
    .bind(user_id).bind(component.id).bind(json!({"name": name, "category": category}))
    .execute(pool).await?;

    Ok(component)
}

pub async fn update_component(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid, name: Option<String>, category: Option<String>, description: Option<String>) -> Result<Component, AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权修改此元件".into()));
    }

    if name.is_none() && category.is_none() && description.is_none() {
        return Err(AppError::BadRequest("无更新内容".into()));
    }

    let name = name.unwrap_or(c.name);
    let category = category.unwrap_or(c.category);
    let description = description.or(c.description);

    let updated = sqlx::query_as::<_, Component>(
        "UPDATE components SET name = $1, category = $2, description = $3, updated_at = NOW() WHERE id = $4 RETURNING *"
    )
    .bind(&name).bind(&category).bind(&description).bind(id)
    .fetch_one(pool).await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_UPDATE', 'Component', $2, $3)"
    )
    .bind(user_id).bind(id).bind(json!({"name": &name, "category": &category}))
    .execute(pool).await?;

    Ok(updated)
}

pub async fn delete_component(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid) -> Result<(), AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权删除此元件".into()));
    }

    sqlx::query("DELETE FROM diagram_instances WHERE component_id = $1")
        .bind(id).execute(pool).await?;

    sqlx::query("DELETE FROM components WHERE id = $1")
        .bind(id).execute(pool).await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'COMPONENT_DELETE', 'Component', $2)"
    )
    .bind(user_id).bind(id).execute(pool).await?;

    Ok(())
}

pub async fn duplicate_component(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<Component, AppError> {
    let source = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let latest_ver = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(id).fetch_optional(pool).await?;

    let mut new_name = format!("{}副本", source.name);
    let mut suffix = 2;
    loop {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM components WHERE name = $1")
            .bind(&new_name).fetch_one(pool).await?;
        if count == 0 { break; }
        new_name = format!("{}副本{}", source.name, suffix);
        suffix += 1;
        if suffix > 100 {
            new_name = format!("{}副本{}", source.name, Uuid::new_v4().to_string().split('-').next().unwrap());
            break;
        }
    }

    let mut tx = pool.begin().await?;
    let dup = sqlx::query_as::<_, Component>(
        "INSERT INTO components (name, category, description, owner_id) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&new_name).bind(&source.category).bind(&source.description).bind(user_id)
    .fetch_one(&mut *tx).await?;

    let snapshot = latest_ver.map(|v| v.snapshot).unwrap_or_else(|| json!({
        "schemaVersion": 1, "shapeElements": [], "pins": [], "matrix": { "connections": [] }
    }));
    sqlx::query(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
    )
    .bind(dup.id).bind(&snapshot).bind(user_id)
    .execute(&mut *tx).await?;

    tx.commit().await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_DUPLICATE', 'Component', $2, $3)"
    )
    .bind(user_id).bind(dup.id).bind(json!({"source_id": id, "name": &new_name}))
    .execute(pool).await?;

    Ok(dup)
}

pub async fn list_component_versions(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid) -> Result<Vec<ComponentVersion>, AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    let versions = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC"
    )
    .bind(id).fetch_all(pool).await?;

    Ok(versions)
}

pub async fn get_component_version(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid, version_no: i32) -> Result<ComponentVersion, AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    if version_no < 1 {
        return Err(AppError::BadRequest("版本号必须为正整数".into()));
    }

    let version = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 AND version_no = $2"
    )
    .bind(id).bind(version_no).fetch_optional(pool).await?
    .ok_or_else(|| AppError::NotFound("版本不存在".into()))?;

    Ok(version)
}

pub async fn create_component_version(pool: &PgPool, user_id: Uuid, is_admin: bool, id: Uuid, snapshot: serde_json::Value) -> Result<ComponentVersion, AppError> {
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    if !is_admin && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权修改此元件".into()));
    }

    if !snapshot.is_object() || snapshot.is_array() {
        return Err(AppError::BadRequest("快照数据格式无效".into()));
    }

    let mut tx = pool.begin().await?;
    let latest_no = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(MAX(version_no), 0) FROM component_versions WHERE component_id = $1"
    )
    .bind(id).fetch_one(&mut *tx).await?;

    let version = sqlx::query_as::<_, ComponentVersion>(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(id).bind(latest_no + 1).bind(&snapshot).bind(user_id)
    .fetch_one(&mut *tx).await?;

    tx.commit().await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_VERSION_CREATE', 'Component', $2, $3)"
    )
    .bind(user_id).bind(id).bind(json!({"version_no": version.version_no}))
    .execute(pool).await?;

    Ok(version)
}
