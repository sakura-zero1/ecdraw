use crate::error::AppError;
use crate::middleware;
use crate::models::ComponentCategory;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthInput {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCategoryInput {
    pub token: String,
    pub name: String,
    pub label: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteCategoryInput {
    pub token: String,
    pub id: String,
}

/// GET /api/categories
#[tauri::command]
pub async fn list_categories(
    state: State<'_, AppState>,
    input: AuthInput,
) -> Result<Vec<ComponentCategory>, AppError> {
    let _claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;

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
    input: CreateCategoryInput,
) -> Result<ComponentCategory, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let color = input.color.unwrap_or_else(|| "#6b7280".into());

    // Check uniqueness
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM component_categories WHERE name = $1"
    )
    .bind(&input.name)
    .fetch_one(&state.pool)
    .await?;
    if existing > 0 {
        return Err(AppError::Conflict("分类名已存在".into()));
    }

    let category = sqlx::query_as::<_, ComponentCategory>(
        "INSERT INTO component_categories (name, label, color, built_in) VALUES ($1, $2, $3, false) RETURNING *"
    )
    .bind(&input.name)
    .bind(&input.label)
    .bind(&color)
    .fetch_one(&state.pool)
    .await?;

    Ok(category)
}

/// DELETE /api/categories/:id
#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    input: DeleteCategoryInput,
) -> Result<(), AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR"])?;

    let id: uuid::Uuid = input.id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    if cat.built_in {
        return Err(AppError::Forbidden("内置分类不能删除".into()));
    }

    // Check if any component references this category by name
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM components WHERE category = $1"
    )
    .bind(&cat.name)
    .fetch_one(&state.pool)
    .await?;
    if count > 0 {
        return Err(AppError::Conflict(format!("该分类下有 {} 个元件，无法删除", count)));
    }

    sqlx::query("DELETE FROM component_categories WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(())
}
