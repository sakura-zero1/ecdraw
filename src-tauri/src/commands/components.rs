use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::models::{Component, ComponentVersion};
use ecdraw_core::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentWithVersion {
    #[serde(flatten)]
    pub component: Component,
    pub latest_version: Option<ComponentVersion>,
}

/// GET /api/components
#[tauri::command]
pub async fn list_components(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<ComponentWithVersion>, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;

    let components = if claims.roles.contains(&"ADMIN".to_string()) {
        sqlx::query_as::<_, Component>(
            "SELECT * FROM components ORDER BY updated_at DESC"
        )
        .fetch_all(&state.pool)
        .await?
    } else {
        let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
        sqlx::query_as::<_, Component>(
            "SELECT * FROM components WHERE owner_id = $1 ORDER BY updated_at DESC"
        )
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?
    };

    let mut results = Vec::new();
    for c in components {
        let ver = sqlx::query_as::<_, ComponentVersion>(
            "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
        )
        .bind(c.id)
        .fetch_optional(&state.pool)
        .await?;
        results.push(ComponentWithVersion { component: c, latest_version: ver });
    }

    Ok(results)
}

/// GET /api/components/:id
#[tauri::command]
pub async fn get_component(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<ComponentWithVersion, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;

    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    let ver = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(c.id)
    .fetch_optional(&state.pool)
    .await?;

    Ok(ComponentWithVersion { component: c, latest_version: ver })
}

/// POST /api/components
#[tauri::command]
pub async fn create_component(
    state: State<'_, AppState>,
    token: String,
    name: String,
    category: String,
    description: Option<String>,
) -> Result<Component, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    if name.is_empty() || category.is_empty() {
        return Err(AppError::BadRequest("名称和分类不能为空".into()));
    }

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    let component = sqlx::query_as::<_, Component>(
        "INSERT INTO components (name, category, description, owner_id) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&name)
    .bind(&category)
    .bind(&description)
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;

    let default_snapshot = json!({
        "schemaVersion": 1,
        "shapeElements": [],
        "pins": [],
        "matrix": { "connections": [] }
    });
    sqlx::query(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
    )
    .bind(component.id)
    .bind(&default_snapshot)
    .bind(user_id)
    .execute(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_CREATE', 'Component', $2, $3)"
    )
    .bind(user_id)
    .bind(component.id)
    .bind(json!({"name": &name, "category": &category}))
    .execute(&state.pool)
    .await?;

    Ok(component)
}

/// PATCH /api/components/:id
#[tauri::command]
pub async fn update_component(
    state: State<'_, AppState>,
    token: String,
    id: String,
    name: Option<String>,
    category: Option<String>,
    description: Option<String>,
) -> Result<Component, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
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
    .bind(&name)
    .bind(&category)
    .bind(&description)
    .bind(cid)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_UPDATE', 'Component', $2, $3)"
    )
    .bind(user_id)
    .bind(cid)
    .bind(json!({"name": &name, "category": &category}))
    .execute(&state.pool)
    .await?;

    Ok(updated)
}

/// DELETE /api/components/:id
#[tauri::command]
pub async fn delete_component(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权删除此元件".into()));
    }

    sqlx::query("DELETE FROM diagram_instances WHERE component_id = $1")
        .bind(cid)
        .execute(&state.pool)
        .await?;

    sqlx::query("DELETE FROM components WHERE id = $1")
        .bind(cid)
        .execute(&state.pool)
        .await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id) VALUES ($1, 'COMPONENT_DELETE', 'Component', $2)"
    )
    .bind(user_id)
    .bind(cid)
    .execute(&state.pool)
    .await?;

    Ok(())
}

/// POST /api/components/:id/duplicate
#[tauri::command]
pub async fn duplicate_component(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Component, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;
    let source = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;

    let latest_ver = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC LIMIT 1"
    )
    .bind(cid)
    .fetch_optional(&state.pool)
    .await?;

    let mut new_name = format!("{}副本", source.name);
    let mut suffix = 2;
    loop {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM components WHERE name = $1"
        )
        .bind(&new_name)
        .fetch_one(&state.pool)
        .await?;
        if count == 0 { break; }
        new_name = format!("{}副本{}", source.name, suffix);
        suffix += 1;
        if suffix > 100 {
            new_name = format!("{}副本{}", source.name, Uuid::new_v4().to_string().split('-').next().unwrap());
            break;
        }
    }

    let mut tx = state.pool.begin().await?;
    let dup = sqlx::query_as::<_, Component>(
        "INSERT INTO components (name, category, description, owner_id) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&new_name)
    .bind(&source.category)
    .bind(&source.description)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    let snapshot = latest_ver.map(|v| v.snapshot).unwrap_or_else(|| json!({
        "schemaVersion": 1, "shapeElements": [], "pins": [], "matrix": { "connections": [] }
    }));
    sqlx::query(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3)"
    )
    .bind(dup.id)
    .bind(&snapshot)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_DUPLICATE', 'Component', $2, $3)"
    )
    .bind(user_id)
    .bind(dup.id)
    .bind(json!({"source_id": cid, "name": &new_name}))
    .execute(&state.pool)
    .await?;

    Ok(dup)
}

/// GET /api/components/:id/versions
#[tauri::command]
pub async fn list_component_versions(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Vec<ComponentVersion>, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;

    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    let versions = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 ORDER BY version_no DESC"
    )
    .bind(cid)
    .fetch_all(&state.pool)
    .await?;

    Ok(versions)
}

/// GET /api/components/:id/versions/:versionNo
#[tauri::command]
pub async fn get_component_version(
    state: State<'_, AppState>,
    token: String,
    id: String,
    version_no: i32,
) -> Result<ComponentVersion, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;

    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权访问此元件".into()));
    }

    if version_no < 1 {
        return Err(AppError::BadRequest("版本号必须为正整数".into()));
    }

    let version = sqlx::query_as::<_, ComponentVersion>(
        "SELECT * FROM component_versions WHERE component_id = $1 AND version_no = $2"
    )
    .bind(cid)
    .bind(version_no)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("版本不存在".into()))?;

    Ok(version)
}

/// POST /api/components/:id/versions
#[tauri::command]
pub async fn create_component_version(
    state: State<'_, AppState>,
    token: String,
    id: String,
    snapshot: serde_json::Value,
) -> Result<ComponentVersion, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let cid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的元件ID".into()))?;
    let c = sqlx::query_as::<_, Component>("SELECT * FROM components WHERE id = $1")
        .bind(cid)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("元件不存在".into()))?;

    let user_id: Uuid = claims.sub.parse().map_err(|_| AppError::Auth("无效的用户标识".into()))?;
    if !claims.roles.contains(&"ADMIN".to_string()) && c.owner_id != user_id {
        return Err(AppError::Forbidden("无权修改此元件".into()));
    }

    if !snapshot.is_object() || snapshot.is_array() {
        return Err(AppError::BadRequest("快照数据格式无效".into()));
    }

    let mut tx = state.pool.begin().await?;
    let latest_no = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(MAX(version_no), 0) FROM component_versions WHERE component_id = $1"
    )
    .bind(cid)
    .fetch_one(&mut *tx)
    .await?;

    let version = sqlx::query_as::<_, ComponentVersion>(
        "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(cid)
    .bind(latest_no + 1)
    .bind(&snapshot)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    sqlx::query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, payload) VALUES ($1, 'COMPONENT_VERSION_CREATE', 'Component', $2, $3)"
    )
    .bind(user_id)
    .bind(cid)
    .bind(json!({"version_no": version.version_no}))
    .execute(&state.pool)
    .await?;

    Ok(version)
}
