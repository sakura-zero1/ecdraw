use sqlx::postgres::PgPool;
use sqlx::migrate::MigrateDatabase;

pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    // Create database if it doesn't exist
    if !sqlx::Postgres::database_exists(database_url).await? {
        sqlx::Postgres::create_database(database_url).await?;
    }

    let pool = PgPool::connect(database_url).await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
