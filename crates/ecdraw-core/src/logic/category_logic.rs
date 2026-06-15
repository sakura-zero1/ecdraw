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

    // Delete all components in this category first (cascades: versions, instances, edges)
    sqlx::query("DELETE FROM components WHERE category = $1")
        .bind(&cat.name)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM component_categories WHERE id = $1")
        .bind(uid)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn rename_category(
    pool: &PgPool,
    id: &str,
    new_label: &str,
) -> Result<ComponentCategory, AppError> {
    let uid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "SELECT * FROM component_categories WHERE id = $1"
    )
    .bind(uid)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    // Check for duplicate label (excluding self)
    let dup = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM component_categories WHERE label = $1 AND id != $2"
    )
    .bind(new_label)
    .bind(uid)
    .fetch_one(pool)
    .await?;
    if dup > 0 {
        return Err(AppError::Conflict("类别名称已存在".into()));
    }

    let updated = sqlx::query_as::<_, ComponentCategory>(
        "UPDATE component_categories SET label = $1 WHERE id = $2 RETURNING *"
    )
    .bind(new_label)
    .bind(uid)
    .fetch_one(pool)
    .await?;

    // Also update the `name` column for non-built-in categories
    if !cat.built_in {
        sqlx::query("UPDATE component_categories SET name = $1 WHERE id = $2")
            .bind(new_label)
            .bind(uid)
            .execute(pool)
            .await?;

        // Update all components referencing the old category name
        sqlx::query("UPDATE components SET category = $1 WHERE category = $2")
            .bind(new_label)
            .bind(&cat.name)
            .execute(pool)
            .await?;

        // Re-fetch to get updated name
        let updated = sqlx::query_as::<_, ComponentCategory>(
            "SELECT * FROM component_categories WHERE id = $1"
        )
        .bind(uid)
        .fetch_one(pool)
        .await?;
        return Ok(updated);
    }

    Ok(updated)
}

pub async fn update_category_visibility(
    pool: &PgPool,
    id: &str,
    visible: bool,
) -> Result<ComponentCategory, AppError> {
    let uid: Uuid = id.parse().map_err(|_| AppError::BadRequest("无效的分类ID".into()))?;

    let cat = sqlx::query_as::<_, ComponentCategory>(
        "UPDATE component_categories SET visible = $1 WHERE id = $2 RETURNING *"
    )
    .bind(visible)
    .bind(uid)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("分类不存在".into()))?;

    Ok(cat)
}
