use ecdraw_core::error::AppError;
use ecdraw_core::AppState;
use ecdraw_core::logic::auth_logic::LoginResponse;
use tauri::State;

/// POST /api/auth/login
#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<LoginResponse, AppError> {
    ecdraw_core::logic::auth_logic::login(
        &state.pool,
        &state.jwt_access_secret,
        &state.jwt_refresh_secret,
        &username,
        &password,
    )
    .await
}

/// POST /api/auth/refresh
#[tauri::command]
pub async fn refresh_token(
    state: State<'_, AppState>,
    refresh_token: String,
) -> Result<LoginResponse, AppError> {
    ecdraw_core::logic::auth_logic::refresh_token(
        &state.pool,
        &state.jwt_refresh_secret,
        &state.jwt_access_secret,
        &refresh_token,
    )
    .await
}
