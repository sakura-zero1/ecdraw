use ecdraw_core::error::AppError;
use ecdraw_core::middleware;
use ecdraw_core::models::ComponentCategory;
use ecdraw_core::AppState;
use tauri::State;

/// GET /api/categories
#[tauri::command]
pub async fn list_categories(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<ComponentCategory>, AppError> {
    let _claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;

    let categories = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories ORDER BY built_in DESC, created_at ASC"
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(categories)
}

/// POST /api/categories
#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    token: String,
    name: String,
    label: String,
    color: Option<String>,
) -> Result<ComponentCategory, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let color = color.unwrap_or_else(|| "#6b7280".into());

    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM component_categories WHERE name = $1"
    )
    .bind(&name)
    .fetch_one(&state.pool)
    .await?;
    if existing > 0 {
        return Err(AppError::Conflict("分类名已存在".into()));
    }

    let category = sqlx::query_as::<_, ComponentCategory>(
        "INSERT INTO component_categories (name, label, color, built_in) VALUES ($1, $2, $3, false) RETURNING *"
    )
    .bind(&name)
    .bind(&label)
    .bind(&color)
    .fetch_one(&state.pool)
    .await?;

    Ok(category)
}

/// DELETE /api/categories/:id
#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let uid: uuid::Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories WHERE id = $1"
    )
    .bind(uid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    if cat.built_in {
        return Err(AppError::Forbidden("内置分类不能删除".into()));
    }

    // Delete all components in this category first (cascades: versions, instances, edges)
    sqlx::query("DELETE FROM components WHERE category = $1")
        .bind(&cat.name)
        .execute(&state.pool)
        .await?;

    sqlx::query("DELETE FROM component_categories WHERE id = $1")
        .bind(uid)
        .execute(&state.pool)
        .await?;

    Ok(())
}

/// PATCH /api/categories/:id/rename
#[tauri::command]
pub async fn rename_category(
    state: State<'_, AppState>,
    token: String,
    id: String,
    new_label: String,
) -> Result<ComponentCategory, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let cat = ecdraw_core::logic::category_logic::rename_category(&state.pool, &id, &new_label).await?;
    Ok(cat)
}

/// PATCH /api/categories/:id/visibility
#[tauri::command]
pub async fn update_category_visibility(
    state: State<'_, AppState>,
    token: String,
    id: String,
    visible: bool,
) -> Result<ComponentCategory, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let uid: uuid::Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "UPDATE component_categories SET visible = $1 WHERE id = $2 RETURNING *"
    )
    .bind(visible)
    .bind(uid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    Ok(cat)
}
