use crate::auth;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedResult {
    pub success: bool,
    pub message: String,
}

pub async fn seed_admin(pool: &PgPool, username: &str, password: &str) -> Result<SeedResult, AppError> {
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE username = $1"
    )
    .bind(username)
    .fetch_one(pool)
    .await?;

    if existing > 0 {
        return Ok(SeedResult {
            success: true,
            message: format!("管理员用户 '{}' 已存在，跳过创建", username),
        });
    }

    let password_hash = auth::hash_password(password)?;
    let roles = serde_json::to_string(&["ADMIN", "COMPONENT_EDITOR", "DIAGRAM_EDITOR", "REVIEWER", "VIEWER"]).unwrap();

    sqlx::query(
        "INSERT INTO users (username, password_hash, roles, status) VALUES ($1, $2, $3, 'ACTIVE')"
    )
    .bind(username)
    .bind(&password_hash)
    .bind(&roles)
    .execute(pool)
    .await?;

    Ok(SeedResult {
        success: true,
        message: format!("管理员用户 '{}' 创建成功", username),
    })
}

const BUILTIN_COMPONENTS_JSON: &str = include_str!("../../seed/builtin_components.json");
// v2：种子元件归入「国标种子库」分类，语义移入快照 electrical 块。
// 升级标志名使 v1 已种库在下次启动时被 upsert 对齐到 v2。
const BUILTIN_COMPONENTS_FLAG: &str = "builtin_components_seeded_v2";

#[derive(Debug, Deserialize)]
struct SeedComponent {
    id: Uuid,
    name: String,
    category: String,
    description: String,
    snapshot: serde_json::Value,
}

/// 确保基础分类行存在（4 个语义内置分类 + 国标种子库），幂等，每次启动执行。
/// list_categories 只返回 DB 行，缺行会导致前端分类列表不全。
async fn ensure_builtin_categories(pool: &PgPool) -> Result<(), AppError> {
    const CATEGORIES: [(&str, &str, &str); 5] = [
        ("powerPoint", "电源点", "#22c55e"),
        ("switchPoint", "分合点", "#3b82f6"),
        ("junctionPoint", "衔接点", "#6b7280"),
        ("loadPoint", "负荷点", "#f97316"),
        ("gbSeed", "国标种子库", "#0ea5e9"),
    ];
    for (name, label, color) in CATEGORIES {
        sqlx::query(
            "INSERT INTO component_categories (name, label, color, built_in, visible) VALUES ($1, $2, $3, TRUE, TRUE) ON CONFLICT (name) DO NOTHING"
        )
        .bind(name)
        .bind(label)
        .bind(color)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// 种子内置元件库（国标 GB/T 4728 常用一次设备符号，分类＝国标种子库）。
/// 元件的电气语义由快照内 electrical 块声明（role/breakable），不依赖分类。
/// 通过 app_flags 标志保证只执行一次——用户删除内置元件后重启不会复活。
/// 若尚无管理员用户则跳过，等下次启动再种。
pub async fn seed_builtin_components(pool: &PgPool) -> Result<u32, AppError> {
    ensure_builtin_categories(pool).await?;

    let seeded = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM app_flags WHERE key = $1)"
    )
    .bind(BUILTIN_COMPONENTS_FLAG)
    .fetch_one(pool)
    .await?;
    if seeded {
        return Ok(0);
    }

    // owner = 最早的 ADMIN 用户
    let owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM users WHERE roles LIKE '%ADMIN%' ORDER BY created_at ASC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;
    let Some(owner_id) = owner else {
        return Ok(0);
    };

    let items: Vec<SeedComponent> = serde_json::from_str(BUILTIN_COMPONENTS_JSON)
        .map_err(|e| AppError::BadRequest(format!("内置元件种子数据解析失败: {e}")))?;

    let mut tx = pool.begin().await?;
    let mut count = 0u32;
    for item in &items {
        // upsert：新库直接插入；v1 旧种子存在时把分类/描述/快照对齐到 v2
        sqlx::query(
            "INSERT INTO components (id, name, category, description, owner_id) VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, description = EXCLUDED.description, updated_at = NOW()"
        )
        .bind(item.id)
        .bind(&item.name)
        .bind(&item.category)
        .bind(&item.description)
        .bind(owner_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO component_versions (component_id, version_no, snapshot, created_by) VALUES ($1, 1, $2, $3) \
             ON CONFLICT (component_id, version_no) DO UPDATE SET snapshot = EXCLUDED.snapshot"
        )
        .bind(item.id)
        .bind(&item.snapshot)
        .bind(owner_id)
        .execute(&mut *tx)
        .await?;
        count += 1;
    }
    sqlx::query("INSERT INTO app_flags (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING")
        .bind(BUILTIN_COMPONENTS_FLAG)
        .bind(count.to_string())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(count)
}
