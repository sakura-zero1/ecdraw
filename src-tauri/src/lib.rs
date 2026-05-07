mod auth;
mod commands;
mod db;
mod error;
mod middleware;
mod models;

use std::env;
use tauri::Manager;

pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let database_url = env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/ecdraw2".to_string());

            let pool = tauri::async_runtime::block_on(async {
                db::init_pool(&database_url).await.expect("Failed to initialize database")
            });

            let jwt_access_secret = env::var("JWT_ACCESS_SECRET")
                .unwrap_or_else(|_| "dev_access_secret".to_string());
            let jwt_refresh_secret = env::var("JWT_REFRESH_SECRET")
                .unwrap_or_else(|_| "dev_refresh_secret".to_string());

            let state = AppState {
                pool: pool.clone(),
                jwt_access_secret,
                jwt_refresh_secret,
            };
            app.manage(state);

            // Auto-seed admin user on startup
            let pool_for_seed = pool.clone();
            tauri::async_runtime::spawn(async move {
                let username = env::var("SEED_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
                let password = env::var("SEED_ADMIN_PASSWORD").unwrap_or_else(|_| "Admin123456".into());
                let existing = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM users WHERE username = $1"
                )
                .bind(&username)
                .fetch_one(&pool_for_seed)
                .await;
                if let Ok(0) = existing {
                    use crate::auth;
                    if let Ok(hash) = auth::hash_password(&password) {
                        let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();
                        let _ = sqlx::query(
                            "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
                        )
                        .bind(&username).bind(&hash).bind(&roles)
                        .execute(&pool_for_seed).await;
                        log::info!("管理员用户 '{}' 已自动创建", username);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::login,
            commands::auth::refresh_token,
            // Users
            commands::users::list_users,
            commands::users::create_user,
            commands::users::update_user,
            // Components
            commands::components::list_components,
            commands::components::get_component,
            commands::components::create_component,
            commands::components::update_component,
            commands::components::delete_component,
            commands::components::duplicate_component,
            commands::components::list_component_versions,
            commands::components::get_component_version,
            commands::components::create_component_version,
            // Diagrams
            commands::diagrams::list_diagrams,
            commands::diagrams::get_diagram,
            commands::diagrams::create_diagram,
            commands::diagrams::update_diagram,
            commands::diagrams::delete_diagram,
            commands::diagrams::duplicate_diagram,
            commands::diagrams::get_diagram_editor,
            commands::diagrams::get_diagram_topology,
            commands::diagrams::save_diagram,
            commands::diagrams::submit_diagram_review,
            commands::diagrams::withdraw_diagram_review,
            commands::diagrams::request_delete_diagram,
            commands::diagrams::create_diagram_instance,
            commands::diagrams::update_diagram_instance,
            commands::diagrams::delete_diagram_instance,
            commands::diagrams::create_diagram_edge,
            commands::diagrams::delete_diagram_edge,
            // Districts
            commands::districts::list_districts_by_diagram,
            commands::districts::upsert_district,
            commands::districts::batch_upsert_districts,
            // Lines
            commands::lines::list_lines_by_diagram,
            commands::lines::upsert_line,
            commands::lines::batch_upsert_lines,
            // GIS
            commands::gis::list_gis_by_diagram,
            commands::gis::upsert_gis,
            commands::gis::batch_upsert_gis,
            // Reviews
            commands::reviews::list_reviews,
            commands::reviews::approve_review,
            commands::reviews::reject_review,
            // Audits
            commands::audit::list_audits,
            // Analysis
            commands::analysis::outage_simulate,
            commands::analysis::power_flow,
            commands::analysis::fault_analysis,
            // Admin
            commands::admin::dashboard_stats,
            // Categories
            commands::categories::list_categories,
            commands::categories::create_category,
            commands::categories::delete_category,
            // Seed
            commands::seed::seed_admin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
