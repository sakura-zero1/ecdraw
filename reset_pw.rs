use std::env;
fn main() {
    let database_url = env::var("DATABASE_URL").unwrap_or("postgresql://postgres:postgres@localhost:5432/ecdraw2".into());
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        let hash = bcrypt::hash("1", 10).unwrap();
        sqlx::query("UPDATE users SET password_hash = $1 WHERE username = 'admin'")
            .bind(&hash).execute(&pool).await.unwrap();
        println!("admin password reset to '1'");
    });
}
