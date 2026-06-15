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
    ecdraw_core::logic::category_logic::create_category(&state.pool, &name, &label, &color).await
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

    ecdraw_core::logic::category_logic::delete_category(&state.pool, &id).await
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

    ecdraw_core::logic::category_logic::update_category_visibility(&state.pool, &id, visible).await
}
