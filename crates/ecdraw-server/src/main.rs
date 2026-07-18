mod extractors;
mod routes;

use ecdraw_core::AppState;
use std::env;
use tower_http::cors::{CorsLayer, Any};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/ecdraw2".to_string());

    let pool = ecdraw_core::db::init_pool(&database_url)
        .await
        .expect("Failed to initialize database");

    let jwt_access_secret = env::var("JWT_ACCESS_SECRET")
        .unwrap_or_else(|_| "dev_access_secret".to_string());
    let jwt_refresh_secret = env::var("JWT_REFRESH_SECRET")
        .unwrap_or_else(|_| "dev_refresh_secret".to_string());

    // Auto-seed admin user on startup
    let seed_pool = pool.clone();
    tokio::spawn(async move {
        let username = env::var("SEED_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
        let password = env::var("SEED_ADMIN_PASSWORD").unwrap_or_else(|_| "Admin123456".into());
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE username = $1"
        )
        .bind(&username)
        .fetch_one(&seed_pool)
        .await;
        if let Ok(0) = existing {
            if let Ok(hash) = ecdraw_core::auth::hash_password(&password) {
                let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();
                let _ = sqlx::query(
                    "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
                )
                .bind(&username).bind(&hash).bind(&roles)
                .execute(&seed_pool).await;
                tracing::info!("管理员用户 '{}' 已自动创建", username);
            }
        }

        // 种子内置元件库（国标符号，仅首次）
        match ecdraw_core::logic::seed_logic::seed_builtin_components(&seed_pool).await {
            Ok(0) => {}
            Ok(n) => tracing::info!("已种子 {} 个内置国标元件", n),
            Err(e) => tracing::warn!("内置元件种子失败: {}", e),
        }
    });

    let state = AppState {
        pool,
        jwt_access_secret,
        jwt_refresh_secret,
    };

    let app = routes::build_router(state)
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any));

    let port = env::var("SERVER_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse::<u16>()
        .unwrap_or(3001);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind");

    tracing::info!("ECDraw Server 启动于 http://0.0.0.0:{}", port);

    axum::serve(listener, app).await.expect("Server error");
}
