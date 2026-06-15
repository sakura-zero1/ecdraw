# 已发布图纸修订 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已发布图纸可发起「修订」——基于 ONLINE 快照创建新草稿编辑、提交审核、对比、通过后替换上线，全程线上不中断。

**Architecture:** 可编辑性从「图纸 status」改为「最新版本 status（DRAFT/REJECTED 可编辑）」；查看器默认展示 ONLINE 版本快照（与实时表解耦）；新增 `revise_diagram`/`discard_revision` 两命令；`save/submit/withdraw/reject` 按「有无 ONLINE 版本」区分首发与修订。纯后端 + 前端，无数据库迁移。

**Tech Stack:** Rust + SQLx + axum + Tauri 2 / React 19 + TypeScript + Zustand。

**测试策略：** 后端逻辑依赖 PostgreSQL 且项目无 Rust 单测基建 → 以 `cargo check --workspace` 编译 + 手动验收为准。前端以 `pnpm build` + 手动验收为准。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `crates/ecdraw-core/src/logic/diagram_logic.rs` | 辅助函数 + 改 save/submit/withdraw + 8 CRUD + 新增 revise/discard | 改 |
| `crates/ecdraw-core/src/logic/review_logic.rs` | reject_review 状态条件化 | 改 |
| `src-tauri/src/commands/diagrams.rs` | revise/discard 两个 Tauri 命令 | 改 |
| `crates/ecdraw-server/src/routes/diagrams.rs` | revise/discard 两个 axum handler + 路由 | 改 |
| `src-tauri/src/lib.rs` | 注册两命令 | 改 |
| `src/services/diagramApi.ts` | reviseDiagram/discardRevision + DiagramEditorData 带 latestVersionStatus | 改 |
| `src/stores/useDiagramStore.ts` | 存 latestVersionStatus + revise/discard actions | 改 |
| `src/pages/DiagramEditorPage.tsx` | 卡片「修订」入口 + 工具栏按 latestVersionStatus 控制 + 放弃修订 | 改 |
| `src/pages/DiagramViewerPage.tsx` | 默认展示 ONLINE 版本 | 改 |

---

## Task 1: 后端辅助函数

**Files:**
- Modify: `crates/ecdraw-core/src/logic/diagram_logic.rs`（在 `is_diagram_editable` 之后，约 line 99 后）

- [ ] **Step 1: 新增三个辅助函数**

在 `is_diagram_editable`（line 97-99）之后插入：
```rust
/// 最新版本（MAX version_no）是否可编辑 = 其 status 为 DRAFT 或 REJECTED。
/// 这取代了基于图纸 status 的可编辑判断，统一首发与修订场景。
pub async fn latest_version_editable(pool: &PgPool, diagram_id: Uuid) -> Result<bool, AppError> {
    let st = sqlx::query_scalar::<_, String>(
        "SELECT status FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(diagram_id).fetch_optional(pool).await?;
    Ok(matches!(st.as_deref(), Some("DRAFT") | Some("REJECTED")))
}

/// 该图是否存在 ONLINE 版本（用于区分首发 vs 修订）。
pub async fn has_online_version(pool: &PgPool, diagram_id: Uuid) -> Result<bool, AppError> {
    let c = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE'"
    ).bind(diagram_id).fetch_one(pool).await?;
    Ok(c > 0)
}

/// 用快照内容重建实时表 diagram_instances/diagram_edges（先清空再插入）。
/// 字段解析与 get_diagram_version_topology 保持一致（兼容 positionX|x、fromInstanceId|sourceInstanceId 等）。
async fn hydrate_realtime_from_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    diagram_id: Uuid,
    snapshot: &serde_json::Value,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM diagram_edges WHERE diagram_id = $1").bind(diagram_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM diagram_instances WHERE diagram_id = $1").bind(diagram_id).execute(&mut **tx).await?;

    let insts = snapshot.get("instances").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for si in &insts {
        let id_str = si.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let iid: Uuid = match id_str.parse() { Ok(u) => u, Err(_) => continue };
        let comp_id: Uuid = si.get("componentId").and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        let label = si.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let x = si.get("positionX").or_else(|| si.get("x")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let y = si.get("positionY").or_else(|| si.get("y")).and_then(|v| v.as_f64()).unwrap_or(0.0);
        let idata = si.get("instanceData").cloned().unwrap_or(json!({}));
        sqlx::query(
            "INSERT INTO diagram_instances (id, diagram_id, component_id, label, position_x, position_y, instance_data) VALUES ($1,$2,$3,$4,$5,$6,$7)"
        )
        .bind(iid).bind(diagram_id).bind(comp_id).bind(&label).bind(x).bind(y).bind(&idata)
        .execute(&mut **tx).await?;
    }

    let conns = snapshot.get("connections").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for sc in &conns {
        let from: Uuid = sc.get("fromInstanceId").or_else(|| sc.get("sourceInstanceId")).and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        let to: Uuid = sc.get("toInstanceId").or_else(|| sc.get("targetInstanceId")).and_then(|v| v.as_str()).unwrap_or("").parse().unwrap_or(Uuid::nil());
        if from.is_nil() || to.is_nil() { continue; }
        let spid = sc.get("sourcePinId").or_else(|| sc.get("fromPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let tpid = sc.get("targetPinId").or_else(|| sc.get("toPinId")).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let lt = sc.get("lineType").and_then(|v| v.as_str()).unwrap_or("straight").to_string();
        let pmr = sc.get("polylineMidRatio").and_then(|v| v.as_f64());
        sqlx::query(
            "INSERT INTO diagram_edges (diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id, line_type, polyline_mid_ratio) VALUES ($1,$2,$3,$4,$5,$6,$7)"
        )
        .bind(diagram_id).bind(from).bind(to).bind(&spid).bind(&tpid).bind(&lt).bind(pmr)
        .execute(&mut **tx).await?;
    }
    Ok(())
}
```

- [ ] **Step 2: 编译验证**

Run: `cargo check -p ecdraw-core`
Expected: 通过（新函数未被调用会有 `dead_code` 警告，可接受，后续 task 会用到）。

- [ ] **Step 3: 提交**
```bash
git add crates/ecdraw-core/src/logic/diagram_logic.rs
git commit -m "feat(core): 新增修订所需辅助函数（可编辑判断/ONLINE 判断/快照水化）"
```

---

## Task 2: 后端可编辑性改造（save/submit/withdraw + 8 CRUD）

**Files:**
- Modify: `crates/ecdraw-core/src/logic/diagram_logic.rs`

- [ ] **Step 1: 改 save_diagram 的可编辑检查与结尾状态**

把 `save_diagram` 中（line 424-426）：
```rust
    if !is_diagram_editable(&d.status) {
        return Err(AppError::BadRequest("当前状态的图纸不可保存".into()));
    }
```
改为：
```rust
    if !latest_version_editable(pool, id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可保存".into()));
    }
```
并把结尾（line 458-461）：
```rust
    let updated = sqlx::query_as::<_, Diagram>(
        "UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1 RETURNING *"
    )
    .bind(id).fetch_one(&mut *tx).await?;
```
改为（修订场景保持 PUBLISHED，仅刷新 updated_at；首发保持 DRAFT）：
```rust
    let online = has_online_version(pool, id).await?;
    let updated = if online {
        sqlx::query_as::<_, Diagram>("UPDATE diagrams SET updated_at = NOW() WHERE id = $1 RETURNING *")
            .bind(id).fetch_one(&mut *tx).await?
    } else {
        sqlx::query_as::<_, Diagram>("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1 RETURNING *")
            .bind(id).fetch_one(&mut *tx).await?
    };
```

- [ ] **Step 2: 改 submit_diagram_review 的可编辑检查与图纸状态**

把（line 477-479）：
```rust
    if !is_diagram_editable(&d.status) {
        return Err(AppError::BadRequest("图纸状态不允许提交审核".into()));
    }
```
改为：
```rust
    if !latest_version_editable(pool, id).await? {
        return Err(AppError::BadRequest("图纸状态不允许提交审核".into()));
    }
```
并把（line 487-488）：
```rust
    sqlx::query("UPDATE diagrams SET status = 'PENDING_REVIEW', updated_at = NOW() WHERE id = $1")
        .bind(id).execute(&mut *tx).await?;
```
改为（修订保持 PUBLISHED；首发→PENDING_REVIEW）：
```rust
    let online = has_online_version(pool, id).await?;
    if online {
        sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'PENDING_REVIEW', updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    }
```

- [ ] **Step 3: 改 withdraw_diagram_review 的放行条件与图纸状态**

把（line 511-513）：
```rust
    if d.status != "PENDING_REVIEW" {
        return Err(AppError::BadRequest("只有审核中的图纸可以撤回".into()));
    }
```
改为（放行条件改为「最新版本 = REVIEWING」）：
```rust
    let latest_reviewing = sqlx::query_scalar::<_, String>(
        "SELECT status FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?;
    if latest_reviewing.as_deref() != Some("REVIEWING") {
        return Err(AppError::BadRequest("只有审核中的图纸可以撤回".into()));
    }
```
并把（line 516-517）：
```rust
    sqlx::query("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1")
        .bind(id).execute(&mut *tx).await?;
```
改为（修订保持 PUBLISHED；首发→DRAFT）：
```rust
    let online = has_online_version(pool, id).await?;
    if online {
        sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE diagrams SET status = 'DRAFT', updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    }
```

- [ ] **Step 4: 改 8 个 CRUD 的可编辑检查**

在以下 8 个函数中，把每处：
```rust
    if !is_diagram_editable(&d.status) {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }
```
改为（注意这些函数里图纸 id 变量名是 `diagram_id`）：
```rust
    if !latest_version_editable(pool, diagram_id).await? {
        return Err(AppError::BadRequest("当前状态的图纸不可编辑".into()));
    }
```
函数列表（按 line 锚点定位）：`create_diagram_instance`(571)、`update_diagram_instance`(604)、`delete_diagram_instance`(641)、`create_diagram_edge`(666)、`update_diagram_edge_line_type`(701)、`update_diagram_edge_polyline_mid_ratio`(731)、`delete_diagram_edge`(757)。共 7 处（`save_diagram`/`submit` 已在前面步骤改）。

> 注：`update_diagram`(162) 与 `delete_diagram`(190) 用的是 `d.status != "DRAFT" && d.status != "REJECTED"`（改名/删除元数据），不在本次放开范围，保持不动。

- [ ] **Step 5: 编译验证**

Run: `cargo check -p ecdraw-core`
Expected: 通过。`is_diagram_editable` 若不再被任何调用会有 dead_code 警告——保留该函数不删（其他地方未来可能用），或加 `#[allow(dead_code)]`。

- [ ] **Step 6: 提交**
```bash
git add crates/ecdraw-core/src/logic/diagram_logic.rs
git commit -m "feat(core): 可编辑性改为基于最新版本状态 + 首发/修订状态条件化"
```

---

## Task 3: 后端 reject_review 状态条件化

**Files:**
- Modify: `crates/ecdraw-core/src/logic/review_logic.rs`

- [ ] **Step 1: 改 reject_review 的图纸状态分支**

在 `reject_review` 中，把普通驳回分支（图纸 status 非 PENDING_DELETE 的 else 分支）：
```rust
        // 普通审核驳回 → REJECTED
        sqlx::query("UPDATE diagrams SET status = 'REJECTED', updated_at = NOW() WHERE id = $1")
            .bind(review.diagram_id).execute(&mut *tx).await?;
```
改为（有 ONLINE 版本=修订驳回→保持 PUBLISHED；无 ONLINE=首发驳回→REJECTED）：
```rust
        // 修订驳回（仍有 ONLINE 版本）→ 保持 PUBLISHED，线上不中断；首发驳回 → REJECTED
        let online_cnt = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE'"
        ).bind(review.diagram_id).fetch_one(&mut *tx).await?;
        if online_cnt > 0 {
            sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1")
                .bind(review.diagram_id).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE diagrams SET status = 'REJECTED', updated_at = NOW() WHERE id = $1")
                .bind(review.diagram_id).execute(&mut *tx).await?;
        }
```
（被驳回版本→REJECTED 与审核记录更新保持不动。`approve_review` 不改。）

- [ ] **Step 2: 编译验证**

Run: `cargo check -p ecdraw-core`
Expected: 通过。

- [ ] **Step 3: 提交**
```bash
git add crates/ecdraw-core/src/logic/review_logic.rs
git commit -m "feat(core): 修订被驳回时图纸保持已发布（线上不中断）"
```

---

## Task 4: 后端 revise_diagram + discard_revision

**Files:**
- Modify: `crates/ecdraw-core/src/logic/diagram_logic.rs`（在 `request_delete_diagram` 之后，约 line 555 后）

- [ ] **Step 1: 新增两个 logic 函数**

在 `request_delete_diagram`（结束于 line 555）之后插入：
```rust
/// 发起/进入修订：确保存在一个可编辑的修订草稿，返回图纸。
/// - 最新版本 ONLINE → 基于其快照创建新 DRAFT 版本（图纸保持 PUBLISHED）。
/// - 最新版本 DRAFT/REJECTED（已有修订草稿）→ 直接返回，进入编辑现有草稿。
/// - 最新版本 REVIEWING → 报错（审核中）。
pub async fn revise_diagram(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权修订此图纸".into()));
    }

    let latest = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("图纸无版本".into()))?;

    match latest.status.as_str() {
        "DRAFT" | "REJECTED" => {
            // 已有进行中修订草稿，直接进入编辑
            Ok(d)
        }
        "REVIEWING" => Err(AppError::BadRequest("修订正在审核中，请先撤回或等待审核".into())),
        "ONLINE" => {
            // 基于 ONLINE 快照创建新 DRAFT 修订版本，图纸保持 PUBLISHED
            let mut tx = pool.begin().await?;
            let next_no = sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(MAX(version_no), 0) FROM diagram_versions WHERE diagram_id = $1"
            ).bind(id).fetch_one(&mut *tx).await? + 1;
            sqlx::query(
                "INSERT INTO diagram_versions (diagram_id, version_no, snapshot, created_by, status) VALUES ($1, $2, $3, $4, 'DRAFT')"
            )
            .bind(id).bind(next_no).bind(&latest.snapshot).bind(user_id)
            .execute(&mut *tx).await?;
            sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(d)
        }
        _ => Err(AppError::BadRequest("当前状态不可修订".into())),
    }
}

/// 放弃修订：删除进行中的修订草稿版本，并把实时表恢复为 ONLINE 快照。
pub async fn discard_revision(pool: &PgPool, roles: &[String], user_id: Uuid, id: Uuid) -> Result<Diagram, AppError> {
    let d = sqlx::query_as::<_, Diagram>("SELECT * FROM diagrams WHERE id = $1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("图纸不存在".into()))?;

    if !can_write_diagram(roles, &d.owner_id, &user_id) {
        return Err(AppError::Forbidden("无权操作此图纸".into()));
    }

    let latest = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("图纸无版本".into()))?;

    // 必须是修订草稿（DRAFT/REJECTED）且存在 ONLINE 版本
    if !matches!(latest.status.as_str(), "DRAFT" | "REJECTED") {
        return Err(AppError::BadRequest("当前没有可放弃的修订草稿".into()));
    }
    let online = sqlx::query_as::<_, DiagramVersion>(
        "SELECT * FROM diagram_versions WHERE diagram_id = $1 AND status = 'ONLINE' ORDER BY version_no DESC LIMIT 1"
    ).bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::BadRequest("图纸未发布，无修订可放弃".into()))?;

    let mut tx = pool.begin().await?;
    // 删除整条修订链（version_no 高于 ONLINE 的所有草稿/驳回版本），避免「驳回后再 save 生成新 DRAFT」造成残留
    sqlx::query("DELETE FROM diagram_versions WHERE diagram_id = $1 AND version_no > $2")
        .bind(id).bind(online.version_no).execute(&mut *tx).await?;
    hydrate_realtime_from_snapshot(&mut tx, id, &online.snapshot).await?;
    sqlx::query("UPDATE diagrams SET updated_at = NOW() WHERE id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(d)
}
```

- [ ] **Step 2: 编译验证**

Run: `cargo check -p ecdraw-core`
Expected: 通过（`hydrate_realtime_from_snapshot` 现在有调用者，dead_code 警告消失）。

- [ ] **Step 3: 提交**
```bash
git add crates/ecdraw-core/src/logic/diagram_logic.rs
git commit -m "feat(core): 新增 revise_diagram 与 discard_revision"
```

---

## Task 5: 双模式薄封装（Tauri 命令 + axum 路由 + 注册）

**Files:**
- Modify: `src-tauri/src/commands/diagrams.rs`
- Modify: `crates/ecdraw-server/src/routes/diagrams.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Tauri 命令**

在 `src-tauri/src/commands/diagrams.rs` 中，仿照 `submit_diagram_review`（line 140-150）追加两个命令：
```rust
#[tauri::command]
pub async fn revise_diagram(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::revise_diagram(&state.pool, &claims.roles, user_id, did).await
}

#[tauri::command]
pub async fn discard_revision(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<Diagram, AppError> {
    let claims = middleware::verify_auth(&token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id = parse_uid(&claims.sub)?;
    let did = to_uuid(&id, "图纸ID")?;
    diagram_logic::discard_revision(&state.pool, &claims.roles, user_id, did).await
}
```

- [ ] **Step 2: axum handler + 路由**

在 `crates/ecdraw-server/src/routes/diagrams.rs` 中，仿照 `submit_review`（line 158-164）追加两个 handler：
```rust
async fn revise(
    State(state): State<AppState>,
    AuthClaims(claims): AuthClaims,
    Path(id): Path<String>,
) -> Result<Json<ecdraw_core::models::Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse()?;
    let did = to_uuid(&id, "图纸ID")?;
    let d = diagram_logic::revise_diagram(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(d))
}

async fn discard_revision(
    State(state): State<AppState>,
    AuthClaims(claims): AuthClaims,
    Path(id): Path<String>,
) -> Result<Json<ecdraw_core::models::Diagram>, ecdraw_core::error::AppError> {
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    let user_id: Uuid = claims.sub.parse()?;
    let did = to_uuid(&id, "图纸ID")?;
    let d = diagram_logic::discard_revision(&state.pool, &claims.roles, user_id, did).await?;
    Ok(Json(d))
}
```
并在 `routes()`（line 286 起）的 Router 链中追加：
```rust
        .route("/{id}/revise", post(revise))
        .route("/{id}/discard-revision", post(discard_revision))
```
> 注：`Diagram` 的引用路径以本文件现有 import 为准（其他 handler 如何引用 `Diagram` 就照搬；若本文件已 `use ecdraw_core::models::Diagram` 则用 `Diagram`，否则用全路径如上）。

- [ ] **Step 3: 注册 Tauri 命令**

在 `src-tauri/src/lib.rs` 的 `invoke_handler` 列表（约 line 156，`delete_diagram_version` 之后）追加：
```rust
            commands::diagrams::revise_diagram,
            commands::diagrams::discard_revision,
```

- [ ] **Step 4: 编译验证（双端）**

Run: `cargo check -p ecdraw && cargo check -p ecdraw-server`
Expected: 两端均通过。

- [ ] **Step 5: 提交**
```bash
git add src-tauri/src/commands/diagrams.rs crates/ecdraw-server/src/routes/diagrams.rs src-tauri/src/lib.rs
git commit -m "feat: revise/discard 命令双模式封装 + 注册"
```

---

## Task 6: 前端 api + store

**Files:**
- Modify: `src/services/diagramApi.ts`
- Modify: `src/stores/useDiagramStore.ts`

- [ ] **Step 1: api 方法**

在 `src/services/diagramApi.ts` 的 `withdrawDiagramReview`（line 110-113）附近追加：
```ts
export async function reviseDiagram(diagramId: string) {
  await requireAuth();
  return request<DiagramListItem>('revise_diagram', { id: diagramId });
}

export async function discardRevision(diagramId: string) {
  await requireAuth();
  return request<DiagramListItem>('discard_revision', { id: diagramId });
}
```

- [ ] **Step 2: DiagramEditorData 带 latestVersionStatus**

把 `DiagramEditorData`（line 260-264）：
```ts
export interface DiagramEditorData {
  diagram: DiagramListItem;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
}
```
改为：
```ts
export interface DiagramEditorData {
  diagram: DiagramListItem;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
  latestVersionStatus: VersionStatus | null;
}
```
在 `fetchDiagramForEditor`（line 266-302）里，先把内联响应类型（line 273）：
```ts
    latestVersion: { id: string; versionNo: number; snapshot: DiagramSnapshot } | null;
```
改为（补 `status`，后端返回的是完整 `DiagramVersion`，本就含 status）：
```ts
    latestVersion: { id: string; versionNo: number; status: VersionStatus; snapshot: DiagramSnapshot } | null;
```
再把函数结尾 `return { diagram: response.diagram, instances, edges };` 改为：
```ts
  return {
    diagram: response.diagram,
    instances,
    edges,
    latestVersionStatus: response.latestVersion?.status ?? null,
  };
```
（`VersionStatus` 已在本文件 line 338 定义，无需新增 import。）

- [ ] **Step 3: store 存 latestVersionStatus + revise/discard actions**

在 `src/stores/useDiagramStore.ts`：
1. 在 state 接口（含 `diagramInfo` 的那段）增加字段 `latestVersionStatus: VersionStatus | null;`，并在 actions 接口增加：
```ts
  reviseDiagram: (diagramId: string) => Promise<void>;
  discardRevision: () => Promise<void>;
```
2. 初始 state 与 reset 处（line 447 附近 `state.diagramInfo = null;`）补 `state.latestVersionStatus = null;`。
3. `loadDiagram`（line 139-）在 `state.diagramInfo = data.diagram;`（line 170）之后补 `state.latestVersionStatus = data.latestVersionStatus;`。
4. 仿照 `withdrawReview`（line 659）追加两个 action（`reviseDiagram` 调 `reviseDiagram(diagramId)` 后 `loadDiagram(diagramId)` 重新加载；`discardRevision` 调 `discardRevision(diagramId)` 后重载或清空）：
```ts
    reviseDiagram: async (diagramId: string) => {
      await reviseDiagramApi(diagramId);
      await get().loadDiagram(diagramId);
    },
    discardRevision: async () => {
      const id = get().diagramInfo?.id;
      if (!id) return;
      await discardRevisionApi(id);
      await get().loadDiagram(id);
    },
```
并在文件顶部从 `diagramApi` import 中加入 `reviseDiagram as reviseDiagramApi, discardRevision as discardRevisionApi, type VersionStatus`（按现有 import 写法对齐别名，避免与 action 重名）。

- [ ] **Step 4: 编译验证**

Run: `pnpm build`
Expected: 通过（store/api 类型对齐）。

- [ ] **Step 5: 提交**
```bash
git add src/services/diagramApi.ts src/stores/useDiagramStore.ts
git commit -m "feat(web): revise/discard api + store 记录最新版本状态"
```

---

## Task 7: 前端查看器修正（默认展示 ONLINE）

**Files:**
- Modify: `src/pages/DiagramViewerPage.tsx`

- [ ] **Step 1: 默认选中并展示 ONLINE 版本**

把加载逻辑（line 113-131）：
```ts
        // Default: load latest version's topology
        const latest = verList[0];
        if (!latest) {
          setTopologyData(null);
          setLoading(false);
          return;
        }
        setSelectedVersionId(latest.id);

        // If latest is the current online version, use the live topology endpoint
        // Otherwise use version-specific endpoint
        let data: TopologyResponse;
        if (latest.status === 'ONLINE') {
          data = await fetchDiagramTopology(selectedDiagramId);
        } else {
          data = await fetchDiagramVersionTopology(selectedDiagramId, latest.id);
        }
        if (cancelled) return;
        setTopologyData(data);
```
改为（默认展示 ONLINE 版本快照；无 ONLINE 时回退到最新可见版本）：
```ts
        // Default: show the ONLINE (published) version so in-progress revisions never leak to viewers
        const online = verList.find((v) => v.status === 'ONLINE');
        const target = online ?? verList[0];
        if (!target) {
          setTopologyData(null);
          setLoading(false);
          return;
        }
        setSelectedVersionId(target.id);
        const data = await fetchDiagramVersionTopology(selectedDiagramId, target.id);
        if (cancelled) return;
        setTopologyData(data);
```

- [ ] **Step 2: 清理可能未使用的 import**

若 `fetchDiagramTopology` 在本文件已无其他用处，从 import 中移除它（line 7 附近），避免 lint 未使用告警。先全局确认本文件无其它 `fetchDiagramTopology(` 调用再删。

- [ ] **Step 3: 编译验证**

Run: `pnpm build`
Expected: 通过。

- [ ] **Step 4: 提交**
```bash
git add src/pages/DiagramViewerPage.tsx
git commit -m "feat(web): 查看器默认展示 ONLINE 版本，修订草稿不污染线上"
```

---

## Task 8: 前端编辑器修订入口与按钮控制

**Files:**
- Modify: `src/pages/DiagramEditorPage.tsx`

本任务把列表卡片「修订」入口、编辑器工具栏按钮改为基于最新版本状态，并加「放弃修订」。

- [ ] **Step 1: 列表卡片加「修订」入口**

在 `DiagramCard`（line 770-909）中：
- props 类型（line 770-790 区）增加 `onRevise: (id: string) => void;`。
- 计算区（line 812-816）增加：
```ts
  const canRevise = item.status === 'PUBLISHED';
```
- 在卡片底部 footer（line 886-906），在「提交审核」按钮附近增加（仅 PUBLISHED 显示）：
```tsx
        {canRevise && (
          <button
            className="dg-card-review-btn"
            onClick={() => onRevise(item.id)}
          >
            修订
          </button>
        )}
```
- 在 `DiagramList`（line 913-）的 `DiagramCard` 渲染处（line 1014 附近 `onSubmitReview={onSubmitReview}`）把 `onRevise` 透传下去；`DiagramList` 自身 props 也加 `onRevise` 并从父组件接收。

- [ ] **Step 2: 父组件接线 onRevise**

在页面主组件中（`onSubmitReview={handleSubmitReview}` 所在处，line 1666 附近）增加 `onRevise={handleRevise}`，并新增 handler（仿 `handleSubmitReview` line 1256 写法）：
```tsx
  const handleRevise = async (id: string) => {
    try {
      await reviseDiagram(id);   // from diagramApi
      onOpen(id);                // 进入编辑器（与卡片「编辑」相同的打开逻辑）
      await refreshList();       // 刷新列表（用本文件现有的列表刷新函数名替换）
    } catch (e) {
      // 用本文件现有错误提示方式（与 handleSubmitReview 一致）
    }
  };
```
> 注：`onOpen`/刷新列表/错误提示请采用本文件 `handleSubmitReview` 同款写法与变量名（打开编辑器、`setError`/toast）。从 `../services/diagramApi` import `reviseDiagram`、`discardRevision`。

- [ ] **Step 3: 编辑器工具栏按钮改为基于最新版本状态**

工具栏（line 1441-1463）当前用 `diagramInfo?.status`。改为用 store 的 `latestVersionStatus`（从 `useDiagramStore` 取）：
- 「保存草稿」「提交审核」显示条件：`latestVersionStatus === 'DRAFT' || latestVersionStatus === 'REJECTED'`。
- 「撤回审核」显示条件：`latestVersionStatus === 'REVIEWING'`。
- 新增「放弃修订」：显示条件 `(latestVersionStatus === 'DRAFT' || latestVersionStatus === 'REJECTED') && diagramInfo?.status === 'PUBLISHED'`（即修订草稿），点击调 store `discardRevision()` 后离开编辑器/刷新；需二次确认（`window.confirm('放弃本次修订将丢弃草稿改动，确定？')`）。

具体：从 `useDiagramStore` 解构出 `latestVersionStatus`、`discardRevision`；把三处 `diagramInfo?.status === 'DRAFT' || diagramInfo?.status === 'REJECTED'` 与 `diagramInfo?.status === 'PENDING_REVIEW'` 判断替换为上述基于 `latestVersionStatus` 的判断；在「撤回审核」旁加「放弃修订」按钮：
```tsx
{(latestVersionStatus === 'DRAFT' || latestVersionStatus === 'REJECTED') && diagramInfo?.status === 'PUBLISHED' && (
  <button className="btn btn-sm btn-danger" onClick={() => {
    if (window.confirm('放弃本次修订将丢弃草稿改动，确定？')) void discardRevision();
  }}>
    放弃修订
  </button>
)}
```

- [ ] **Step 4: 编译验证**

Run: `pnpm build`
Expected: 通过。

- [ ] **Step 5: 提交**
```bash
git add src/pages/DiagramEditorPage.tsx
git commit -m "feat(web): 编辑器修订入口与放弃修订 + 按钮按最新版本状态控制"
```

---

## Task 9: 全量验证与手动验收

- [ ] **Step 1: 全量编译**

Run: `cargo check --workspace && pnpm build`
Expected: 全部通过。

- [ ] **Step 2: 手动验收（`pnpm tauri dev`）**

1. 发布一张图 → 编辑器列表该图显示「修订」按钮。
2. 点「修订」→ 进入编辑器、可编辑，工具栏显示「保存草稿」「提交审核」「放弃修订」。
3. 修订期间打开 `/viewer` → 仍显示旧线上版本（不受草稿影响）。
4. 修订 → 提交审核 → 审核页对比左(ONLINE/前) 右(草稿/后)，高亮正确。
5. 审核通过 → `/viewer` 更新为新版；版本时间线旧版退役。
6. 再发起一轮修订并提交 → **驳回** → 图纸仍「已发布」、`/viewer` 线上不变、草稿可继续编辑（最新版本 REJECTED）。
7. 编辑器点「放弃修订」→ 回到纯已发布，再开 `/viewer` 内容仍为线上版本。
8. 修订审核中（REVIEWING）时再点列表「修订」→ 提示「修订正在审核中」。

- [ ] **Step 3: 最终提交（若验收中有微调）**

按需提交修正。

---

## 验收标准（整体）

- `cargo check --workspace` 与 `pnpm build` 均通过。
- 手动验收 8 项符合预期。
- 修订/审核全程查看器展示旧 ONLINE 版本，线上不中断。
- 与审核对比 feature 衔接：提交修订审核后对比页正确显示 ONLINE(前) vs 草稿(后)。
