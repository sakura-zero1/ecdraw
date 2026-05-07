# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## 项目概述

ECDraw 2.0 — 10kV 配电网图纸数据管理和应用平台（Tauri 2 桌面应用版）。
从 Express + React B/S 架构全量迁移到 **Tauri 2 + Rust 后端**。

原项目：`../graph_prj2`（Express + Prisma + PostgreSQL）
新项目：`ecdraw2.0`（Tauri 2 + SQLx + Rust）

## 常用命令

```bash
pnpm install                   # 安装前端依赖
pnpm tauri dev                 # Tauri 开发模式（启动 Rust 后端 + Vite 前端）
pnpm tauri build               # Tauri 生产构建（打包桌面应用）
pnpm build                     # 仅前端构建 (tsc -b && vite build)
pnpm lint                      # ESLint
cargo check                    # 仅检查 Rust 编译（在 src-tauri/ 目录下）
cargo build                    # 编译 Rust（在 src-tauri/ 目录下）
```

## 技术栈

- **前端**：React 19 + TypeScript + Vite 8 / Zustand 5 + immer / HTML5 Canvas / React Router 7
- **后端**：Rust + Tauri 2 + SQLx 0.8 + PostgreSQL / JWT (jsonwebtoken) + bcrypt
- **通信**：前端通过 `invoke()` 调用 Tauri Rust 命令，替代原来的 HTTP fetch
- **序列化**：所有 Rust struct 使用 `#[serde(rename_all = "camelCase")]`，确保 JSON 字段名与前端 TypeScript 接口一致
- **PK 策略**：UUID v4（替代原 Prisma 的 cuid()）

## 架构

### Rust 后端 (`src-tauri/src/`)

| 文件 | 职责 |
|---|---|
| `main.rs` | 桌面入口（Windows 隐藏控制台） |
| `lib.rs` | App 构建器、命令注册（49 个命令）、启动时自动 seed admin |
| `db.rs` | 数据库连接池 + SQLx 迁移 |
| `auth.rs` | JWT 签发/验证 + bcrypt 密码哈希 |
| `error.rs` | AppError 统一错误类型（Auth/NotFound/Forbidden/BadRequest/Conflict/Database/Jwt/Bcrypt） |
| `middleware.rs` | 认证守卫 `verify_auth()` + 角色检查 `require_role()` |

### Rust 命令模块 (`src-tauri/src/commands/`)

| 模块 | 命令名 | 说明 |
|---|---|---|
| `auth.rs` | `login`, `refresh_token` | 登录/刷新令牌 |
| `users.rs` | `list_users`, `create_user`, `update_user` | 用户管理（ADMIN） |
| `components.rs` | `list_components`, `get_component`, `create_component`, `update_component`, `delete_component`, `duplicate_component`, `list_component_versions`, `get_component_version`, `create_component_version` | 元件 CRUD + 版本管理 |
| `diagrams.rs` | `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`, `delete_diagram`, `duplicate_diagram`, `get_diagram_editor`, `get_diagram_topology`, `save_diagram`, `submit_diagram_review`, `withdraw_diagram_review`, `request_delete_diagram`, `create_diagram_instance`, `update_diagram_instance`, `delete_diagram_instance`, `create_diagram_edge`, `delete_diagram_edge` | 图纸 CRUD + 实例/边管理 + 审核流程 |
| `districts.rs` | `list_districts_by_diagram`, `upsert_district`, `batch_upsert_districts` | 台区数据 |
| `lines.rs` | `list_lines_by_diagram`, `upsert_line`, `batch_upsert_lines` | 线路台账 |
| `gis.rs` | `list_gis_by_diagram`, `upsert_gis`, `batch_upsert_gis` | 地理信息 |
| `reviews.rs` | `list_reviews`, `approve_review`, `reject_review` | 审核队列 |
| `audit.rs` | `list_audits` | 审计日志 |
| `analysis.rs` | `outage_simulate`, `power_flow`(stub), `fault_analysis`(stub) | 停电模拟(BFS) + 潮流计算 |
| `admin.rs` | `dashboard_stats` | 管理仪表盘 |
| `categories.rs` | `list_categories`, `create_category`, `delete_category` | 元件分类 |
| `seed.rs` | `seed_admin` | 手动种子管理员 |

### 数据模型 (`src-tauri/src/models/`)

12 个模型（`src-tauri/migrations/20260507000001_initial_schema.sql`）：
User, Component, ComponentVersion, Diagram, DiagramVersion, DiagramInstance, DiagramEdge, DistrictData, LineSegmentData, GisData, ReviewRequest, ComponentCategory, AuditLog

所有 struct 均有 `#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]` 和 `#[serde(rename_all = "camelCase")]`。

### 前端通信层

- **`src/services/tauriClient.ts`** — 新的通信层，替代 `apiClient.ts`
  - `tauriRequest<T>(command, args)` — 通用 invoke 封装
  - 自动附加 token、401 自动刷新
  - `ensureTauriAuth()` — 支持 `VITE_API_AUTO_LOGIN` 开发模式
- **`src/services/apiClient.ts`** — 旧版 HTTP 通信层（已废弃，保留作参考）
- 10 个 service 文件已全部适配 Tauri invoke

### 角色体系

| 角色 | 常量 | 职责 |
|---|---|---|
| ADMIN | `ROLE_ADMIN` | 全部权限，用户管理，审计日志 |
| COMPONENT_EDITOR | `ROLE_COMPONENT_EDITOR` | 元件库 CRUD |
| DIAGRAM_EDITOR | `ROLE_DIAGRAM_EDITOR` | 配网图绘制 + 可创建元件 |
| REVIEWER | `ROLE_REVIEWER` | 审核图纸拓扑 |
| DISTRICT_EDITOR | `ROLE_DISTRICT_EDITOR` | 台区数据维护 |
| LINE_EDITOR | `ROLE_LINE_EDITOR` | 线路台账维护 |
| GIS_EDITOR | `ROLE_GIS_EDITOR` | 地理信息维护 |
| VIEWER | `ROLE_VIEWER` | 查询浏览 |

### AppState 结构（Rust side）

```rust
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jwt_access_secret: String,
    pub jwt_refresh_secret: String,
}
```

## 关键实现细节

### 命令调用约定
- 前端通过 `tauriRequest<T>('command_name', { ...args })` 调用
- 每个命令的第一个参数通常是 `token: String`（JWT access token）
- 命令内部调用 `middleware::verify_auth()` 和 `middleware::require_role()` 做鉴权
- 返回 `Result<T, AppError>`，AppError 实现 Serialize 可被 Tauri 序列化到前端

### 数据库
- 通过 `.env` 中的 `DATABASE_URL` 配置
- 应用启动时自动执行 SQLx migration（`sqlx::migrate!()`）
- 自动创建管理员用户（`SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`）
- 默认数据库：`ecdraw2`

### 前端页面路由

| 路由 | 页面 | 角色 |
|---|---|---|
| `/login` | LoginPage | 公开 |
| `/` | redirect to `/viewer` | 认证用户 |
| `/components` | ComponentEditor | ADMIN, COMPONENT_EDITOR, DIAGRAM_EDITOR |
| `/diagrams` | DiagramEditorPage | ADMIN, DIAGRAM_EDITOR |
| `/reviews` | DiagramReviewPage | ADMIN, REVIEWER |
| `/viewer` | DiagramViewerPage | 所有 |
| `/districts` | DistrictPage | ADMIN, DIAGRAM_EDITOR, DISTRICT_EDITOR |
| `/lines` | LinePage | ADMIN, DIAGRAM_EDITOR, LINE_EDITOR |
| `/gis` | GisPage | ADMIN, DIAGRAM_EDITOR, GIS_EDITOR |
| `/admin/dashboard` | DashboardPage | ADMIN |
| `/admin/users` | UserManagementPage | ADMIN |
| `/admin/audits` | AuditPage | ADMIN |

## 迁移状态

- [x] Phase 1: 项目脚手架
- [x] Phase 2: 数据层（SQLx 迁移 + 模型）
- [x] Phase 3: 认证系统（JWT + bcrypt + 守卫）
- [x] Phase 4: Rust 命令处理器（~49 个命令）
- [x] Phase 5: 前端适配（fetch → invoke）
- [x] Phase 6: Tauri 集成配置
- [x] 序列化对齐（camelCase）
- [x] 种子数据 + auto-login
- [ ] 全面功能测试
- [ ] 打包分发配置（代码签名等）

## 约定

- 界面文字使用中文
- 元件编辑器用 SVG 画布，配网图编辑器用 Canvas
- 角色权限取并集（OR 逻辑）
- 停电模拟：BFS 从电源点遍历，断开分合点后计算不可达区域
- `User.roles` 存储为 JSON 字符串（兼容原 Prisma 格式）
- 所有 Rust 命令参数中 `token` 字段自动附加（tauriRequest 封装）
