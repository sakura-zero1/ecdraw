mod commands;

use std::env;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use ecdraw_core::AppState;

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
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
                ecdraw_core::db::init_pool(&database_url).await.expect("Failed to initialize database")
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
                    use ecdraw_core::auth;
                    if let Ok(hash) = auth::hash_password(&password) {
                        let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();
                        let _ = sqlx::query(
                            "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
                        )
                        .bind(&username).bind(&hash).bind(&roles)
                        .execute(&pool_for_seed).await;
                        log::info!("管理员用户 '{}' 已自动创建", username);
                    }
                } else {
                    use ecdraw_core::auth;
                    if let Ok(hash) = auth::hash_password(&password) {
                        let _ = sqlx::query(
                            "UPDATE users SET password_hash = $1 WHERE username = $2"
                        )
                        .bind(&hash).bind(&username)
                        .execute(&pool_for_seed).await;
                        log::info!("管理员用户 '{}' 密码已同步", username);
                    }
                }
            });

            // Create system tray icon
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出程序").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
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
            commands::diagrams::update_diagram_edge_line_type,
            commands::diagrams::update_diagram_edge_polyline_mid_ratio,
            commands::diagrams::delete_diagram_edge,
            commands::diagrams::list_diagram_versions,
            commands::diagrams::get_diagram_version_topology,
            commands::diagrams::delete_diagram_version,
            commands::diagrams::revise_diagram,
            commands::diagrams::discard_revision,
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
            commands::categories::rename_category,
            commands::categories::delete_category,
            commands::categories::update_category_visibility,
            // Seed
            commands::seed::seed_admin,
            // App exit
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
