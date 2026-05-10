use axum::{Router, routing::post, Json, extract::State};
use ecdraw_core::logic::auth_logic::{self, LoginResponse};
use ecdraw_core::AppState;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct LoginBody {
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct RefreshBody {
    #[serde(alias = "refresh_token")]
    refresh_token: String,
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Result<Json<LoginResponse>, ecdraw_core::error::AppError> {
    let resp = auth_logic::login(&state.pool, &state.jwt_access_secret, &state.jwt_refresh_secret, &body.username, &body.password).await?;
    Ok(Json(resp))
}

async fn refresh(State(state): State<AppState>, Json(body): Json<RefreshBody>) -> Result<Json<LoginResponse>, ecdraw_core::error::AppError> {
    let resp = auth_logic::refresh_token(&state.pool, &state.jwt_refresh_secret, &state.jwt_access_secret, &body.refresh_token).await?;
    Ok(Json(resp))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/login", post(login))
        .route("/refresh", post(refresh))
}
