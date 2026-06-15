# 已发布图纸修订（线上不中断）— 设计

- 日期：2026-06-15
- 范围：后端（ecdraw-core 业务逻辑 + 双模式薄封装）+ 前端（查看器修正、编辑器修订入口、api）
- 关联：让上一个「图纸审核前后对比」feature 的「改动前 = ONLINE 版本」主场景真正可用

## 1. 背景与现状

当前图纸生命周期：创建→DRAFT→提交审核→PENDING_REVIEW→通过→PUBLISHED（版本 ONLINE）。
**问题：一旦 PUBLISHED 就锁死**——`is_diagram_editable(status)` 仅允许 `DRAFT`/`REJECTED`，已发布图纸无法再修改。于是审核永远只有「新图首次提交」，前后对比用不上。

两个数据层概念（理解本设计的前提）：
- **实时表** `diagram_instances` / `diagram_edges`：编辑器增删改直接作用于此，代表「当前编辑工作区」。
- **版本快照** `diagram_versions.snapshot`：`save_diagram` 把实时表序列化成快照；每个版本有自己的 `status`（DRAFT/REVIEWING/ONLINE/REJECTED/DECOMMISSIONED）。

**现状隐患（必须修正）**：查看器 `DiagramViewerPage`（行 124-129）默认展示「最新版本」——最新是 ONLINE 就读实时表，否则读该版本快照。修订工作流下最新版本会是 DRAFT 草稿，导致查看器显示未审核草稿、**污染线上展示**。

## 2. 目标

1. 已发布图纸可发起「修订」：基于当前 ONLINE 快照创建新 DRAFT 版本，编辑→提交审核→对比 ONLINE vs 新草稿→通过后新版上线、旧版退役。
2. 修订/审核全程**线上不中断**：查看者始终看到旧 ONLINE 版本。
3. 修订被驳回/撤回 → 图纸**保持已发布**（不是已驳回），草稿保留可继续改或放弃。
4. 同一张图同时只允许一个进行中的修订。

## 3. 非目标（YAGNI）

- 不做多分支并行修订 / 修订历史树。
- 不做修订草稿的多人协作锁。
- 不引入新的图纸 status 值（复用现有，靠版本状态驱动）。
- 不改审核对比 UI（已实现，天然契合）。

## 4. 核心机制（两个关键决策）

### 4.1 可编辑性 = 最新版本状态（替代图纸 status 判断）

「最新版本」= 该图 `MAX(version_no)` 的版本。可编辑当且仅当：

| 最新版本 status | 可编辑 | 对应场景 |
|---|---|---|
| `DRAFT` | ✅ | 首发草稿 / 修订草稿 |
| `REJECTED` | ✅ | 首发被拒 / 修订被拒（继续改） |
| `REVIEWING` | ❌ | 审核中 |
| `ONLINE` | ❌ | 已发布且无进行中修订 → 需先「修订」 |
| `DECOMMISSIONED` | ❌ | 已退役（不会是最新） |

这一条统一了首发与修订的全部场景。`is_diagram_editable(&str)` 的语义从「图纸 status」改为「最新版本 status」——实现上新增一个查询最新版本状态的辅助函数，CRUD/save/submit 改用它。

### 4.2 查看器默认展示 ONLINE 版本（与实时表解耦）

`DiagramViewerPage` 默认选中并展示 `status === 'ONLINE'` 的版本，读其快照（`fetchDiagramVersionTopology(onlineVersionId)`），**不再读实时表**。用户仍可在版本时间线手动点其他版本查看。普通查看者（非编辑/审核角色）经 `list_diagram_versions` 权限只看得到 ONLINE 版本，时间线不暴露修订草稿。

> 副作用：`get_diagram_topology`（实时表拓扑）改完后可能不再有调用者。**不删除**（手术级），仅在 spec 标注。

## 5. 状态流转（全场景）

图纸 status 一旦发布即保持 `PUBLISHED`；版本 status 驱动流程。区分「首发 vs 修订」的信号 = **该图是否已存在 ONLINE 版本**。

```
首发：  DRAFT图 → [save] DRAFT版 → [submit] 图PENDING_REVIEW/版REVIEWING
        → approve: 图PUBLISHED/版ONLINE   |  reject: 图REJECTED/版REJECTED

修订：  PUBLISHED图(v_on=ONLINE) → [revise] 新DRAFT版v_new（snapshot=v_on快照），图仍PUBLISHED
        → [save/CRUD] 编辑v_new → [submit] 图仍PUBLISHED / v_new=REVIEWING（创建review_request）
        → approve: v_new=ONLINE, v_on=DECOMMISSIONED, 图PUBLISHED（现有逻辑已满足）
        → reject:  v_new=REJECTED, 图仍PUBLISHED（线上v_on不动），草稿可继续改
        → withdraw: v_new=REVIEWING→DRAFT, review=WITHDRAWN, 图仍PUBLISHED
        → discard: 删除v_new, 实时表恢复为v_on快照, 回到纯PUBLISHED
```

## 6. 后端改动（ecdraw-core/src/logic）

### 6.1 新增辅助：最新版本可编辑判断

在 `diagram_logic.rs` 新增：
```rust
/// 查询图纸最新版本（MAX version_no）的状态；可编辑 = DRAFT/REJECTED。
async fn latest_version_editable(pool, diagram_id) -> Result<bool, AppError>
/// 该图是否已存在 ONLINE 版本（区分首发 vs 修订）。
async fn has_online_version(pool, diagram_id) -> Result<bool, AppError>
```
（具体 SQL 在实现计划给出。）保留旧 `is_diagram_editable(&str)` 供首发纯草稿路径或删除，视实现简洁度定。

### 6.2 改造函数

| 函数 | 改动 |
|---|---|
| `save_diagram` | 可编辑性改用 `latest_version_editable`；结尾图纸 status 更新条件化：有 ONLINE→保持 `PUBLISHED`，否则 `DRAFT` |
| `submit_diagram_review` | 可编辑性改用最新版本；图纸 status 条件化：有 ONLINE→保持 `PUBLISHED`，否则→`PENDING_REVIEW`；最新版本→`REVIEWING`；创建 review_request |
| `withdraw_diagram_review` | 放行条件改为「最新版本 = REVIEWING」（而非图纸 PENDING_REVIEW）；图纸 status 条件化（有 ONLINE 保持 PUBLISHED，否则 DRAFT）；版本 REVIEWING→DRAFT；review→WITHDRAWN |
| `create/update/delete_diagram_instance`、`create/update_diagram_edge_*`、`delete_diagram_edge`（共 8 处） | 可编辑性检查改用 `latest_version_editable` |
| `review_logic::reject_review` | 图纸 status 条件化：除被拒版本外仍有 ONLINE→保持 `PUBLISHED`，否则→`REJECTED`；版本→`REJECTED` |
| `review_logic::approve_review` | **无需改**（现有：图纸→PUBLISHED、旧 ONLINE→DECOMMISSIONED、被审版本→ONLINE，修订天然适用） |

### 6.3 新增 `revise_diagram(pool, roles, user_id, id)`

1. 取图纸，权限 `can_write_diagram`（owner/ADMIN）。
2. 校验：最新版本 status = `ONLINE`（即已发布且无进行中修订）。否则 `BadRequest`（"已有进行中的修订" 或 "图纸未发布，无需修订"）。
3. 取 ONLINE 版本 `v_on`。
4. 事务：创建新 DRAFT 版本（`version_no = MAX+1`，`snapshot = v_on.snapshot`，`created_by = user_id`，`status='DRAFT'`）。图纸 status 不变（PUBLISHED）。
5. 实时表此时已等于 ONLINE 内容（发布后未被改），无需水化。返回更新后的图纸/编辑器数据。

### 6.4 新增 `discard_revision(pool, roles, user_id, id)`

1. 取图纸，权限校验。
2. 校验：最新版本 status ∈ {`DRAFT`,`REJECTED`} 且存在更早的 ONLINE 版本（确认是修订草稿而非首发草稿）。否则 `BadRequest`。
3. 事务：删除该修订版本（最新的 DRAFT/REJECTED 版本）；**水化实时表 = ONLINE 快照**（清空 `diagram_instances`/`diagram_edges`，按 `v_on.snapshot` 的 instances/connections 重建——参考 `duplicate_diagram` 的重建逻辑）。
4. 结果：图纸 PUBLISHED，最新版本 = ONLINE，实时表 = 线上内容。

## 7. 双模式薄封装

- **Tauri** `src-tauri/src/commands/diagrams.rs`：新增 `revise_diagram`、`discard_revision` 两个 `#[tauri::command]`，样式同现有（verify_auth → require_role `["ADMIN","DIAGRAM_EDITOR"]` → 调 logic）。
- **Axum** `crates/ecdraw-server/src/routes/diagrams.rs`：新增 `POST /{id}/revise`、`POST /{id}/discard-revision` handler + 路由注册。
- **注册** `src-tauri/src/lib.rs`：`invoke_handler` 加这两个命令。

## 8. 前端改动

### 8.1 查看器修正（DiagramViewerPage）

默认展示逻辑改为：从版本列表找 `status==='ONLINE'` 者作为默认选中与展示，读其快照；无 ONLINE（理论上不会出现在查看器，因权限过滤）则空态。移除「最新是 ONLINE 就读实时表」的旧分支。

### 8.2 编辑器（DiagramEditorPage）

- **图纸列表卡片**：对 `status==='PUBLISHED'` 且最新版本为 ONLINE（无进行中修订）显示「修订」按钮 → 调 `reviseDiagram` 后进入编辑器。
- **可编辑/按钮显示**：由「图纸 status」改为「最新版本 status」驱动（`get_diagram_editor` 已返回 `latestVersion`，用其 `status`）：
  - 最新版本 DRAFT/REJECTED → 显示「保存草稿」「提交审核」；若是修订草稿（图纸 PUBLISHED）额外显示「放弃修订」→ `discardRevision`。
  - 最新版本 REVIEWING → 显示「撤回审核」。
  - 最新版本 ONLINE → 只读 + 显示「修订」。
- **状态提示**：修订中（图纸 PUBLISHED + 最新版本 DRAFT/REVIEWING/REJECTED）显示「修订中」标识，区别于纯已发布。

### 8.3 api（diagramApi.ts）

新增：
```ts
export async function reviseDiagram(diagramId: string): Promise<...>   // 'revise_diagram'
export async function discardRevision(diagramId: string): Promise<...> // 'discard_revision'
```

## 9. 边界与错误

- `revise` 时已有进行中修订 → 报错（单一修订约束 #4）。
- `discard`/`withdraw` 仅作者或 ADMIN；审核中（REVIEWING）不能直接 discard，需先 withdraw。
- 修订草稿被审核**通过**后实时表 = 新 ONLINE 内容；**驳回**后实时表 = 被拒草稿内容（最新版本 REJECTED 可继续编辑），ONLINE 快照不受影响，查看器仍展示旧线上。
- 「放弃修订」会丢弃草稿改动，前端需二次确认。

## 10. 测试策略

后端 logic 是改动核心，但依赖 PgPool（集成测试需数据库）。本项目无 Rust 单测基建。**验证以 `cargo check --workspace` 编译 + 手动验收为主**：
- `cargo check -p ecdraw` 与 `cargo check -p ecdraw-server` 均通过（双端薄封装齐全）。
- 前端 `pnpm build` 通过。
- 手动验收（见下）。

手动验收（`pnpm tauri dev`）：
1. 发布一张图 → 列表显示「修订」按钮 → 点修订 → 编辑器可编辑、显示「修订中」+「放弃修订」。
2. 修订期间打开 `/viewer` → 仍显示旧线上版本（不受草稿影响）。
3. 修订提交审核 → 审核页对比 ONLINE(前) vs 修订草稿(后)，高亮正确。
4. 审核通过 → 新版上线、查看器更新；旧版退役。
5. 另一轮修订提交后**驳回** → 图纸仍「已发布」、线上不变、草稿可继续改。
6. 「放弃修订」→ 回到纯已发布，实时表恢复线上内容。

## 11. 与审核对比 feature 的衔接

修订提交审核时：ONLINE 版本（v_on）仍在 → `ReviewCompareView` 的 `fetchDiagramVersions().find(ONLINE)` 命中 v_on 作为「改动前」，`review.diagramVersionId` = 修订草稿 v_new 作为「改动后」。无需改对比代码，主场景自动生效。
