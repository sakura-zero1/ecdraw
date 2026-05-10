use crate::error::AppError;
use crate::models::ComponentCategory;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn list_categories(pool: &PgPool) -> Result<Vec<ComponentCategory>, AppError> {
    let categories = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories ORDER BY built_in DESC, created_at ASC"
    )
    .fetch_all(pool)
    .await?;
    Ok(categories)
}

pub async fn create_category(
    pool: &PgPool,
    name: &str,
    label: &str,
    color: &str,
) -> Result<ComponentCategory, AppError> {
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM component_categories WHERE name = $1"
    )
    .bind(name)
    .fetch_one(pool)
    .await?;
    if existing > 0 {
        return Err(AppError::Conflict("分类名已存在".into()));
    }

    let category = sqlx::query_as::<_, ComponentCategory>(
        "INSERT INTO component_categories (name, label, color, built_in) VALUES ($1, $2, $3, false) RETURNING *"
    )
    .bind(name)
    .bind(label)
    .bind(color)
    .fetch_one(pool)
    .await?;

    Ok(category)
}

pub async fn delete_category(pool: &PgPool, id: &str) -> Result<(), AppError> {
    let uid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories WHERE id = $1"
    )
    .bind(uid)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    if cat.built_in {
        return Err(AppError::Forbidden("内置分类不能删除".into()));
    }

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM components WHERE category = $1"
    )
    .bind(&cat.name)
    .fetch_one(pool)
    .await?;
    if count > 0 {
        return Err(AppError::Conflict(format!("该分类下有 {} 个元件，无法删除", count)));
    }

    sqlx::query("DELETE FROM component_categories WHERE id = $1")
        .bind(uid)
        .execute(pool)
        .await?;

    Ok(())
}
