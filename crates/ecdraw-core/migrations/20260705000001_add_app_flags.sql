-- 应用级标志位（如内置元件已种子），保证种子只执行一次，
-- 用户删除内置元件后重启不会复活。
CREATE TABLE IF NOT EXISTS app_flags (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
