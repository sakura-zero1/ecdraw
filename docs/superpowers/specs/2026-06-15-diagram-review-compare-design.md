# 图纸审核模块重做 — 前后版本对比

- 日期：2026-06-15
- 范围：**纯前端改造，不新增/修改任何 Rust 命令**（不涉及 Tauri/HTTP 双端同步）
- 关联模块：`/reviews` 路由（DiagramReviewPage）

## 1. 背景与现状

当前审核页（`src/pages/DiagramReviewPage.tsx`）问题：

- 卡片式列表，每个审核项内联展开一个**只读预览**。
- 预览数据来自 `get_diagram_topology(diagramId)`，查的是**当前实时拓扑**（`diagram_instances`/`diagram_edges` 实时表），而非审核请求记录的版本快照。提交审核后图纸若被改动，审核员看到的可能不是被审版本。
- 没有"改动前/改动后"对比，审核员无法直观看出画图员到底改了什么。

数据层已具备对比能力（无需改后端）：

- `diagram_versions.snapshot`（JSONB）存了每个版本的完整拓扑：`{ instances:[...], connections:[...] }`。
- `ReviewRequest.diagramVersionId` = 被审核的版本（**改动后**）。
- `get_diagram_version_topology(diagramId, versionId)` 可取任意版本拓扑。
- `list_diagram_versions(diagramId)` 返回版本列表（含 `status`），可筛出 `ONLINE` 版本（**改动前**）。

## 2. 目标

1. 审核列表：每个待审图纸**只占一行**（图纸名 · 提交人 · 提交时间 · 状态），点击进入对比视图。
2. **全屏对比视图**：左右分屏，左=改动前、右=改动后，两个画布并排。
3. **差异高亮**：新增、删除、改动用颜色直接标在画布上。
4. **变更清单**：文字列出新增/删除/改动项，点击可定位到画布对应元件。
5. **新图**（首次提交，无 ONLINE 版本）：左侧空态，只看右侧。

## 3. 非目标（YAGNI）

- 不做两个画布缩放/平移联动锁定（各自独立缩放）。
- 不做"按当时 component 定义"还原历史视觉——沿用现状：component 形状始终用最新定义渲染。
- 不改审核通过/驳回的后端逻辑。
- 不做逐字段参数 diff 的可视化弹窗，变更清单到"某元件改了位置/参数"粒度即可。

## 4. 架构

审核页拆成两层组件：

```
DiagramReviewPage（列表层，改造）
┌─ 过滤: 待审 / 已通过 / 已驳回 / 全部
├─ 每行一个图纸: 图纸名 · 提交人 · 提交时间 · 状态  [查看对比 →]
└─ ...
                                │ 点击行
                                ▼
ReviewCompareView（全屏对比层，新增）
┌─ 顶部: 图纸名 | 提交人 | 提交时间 | [← 返回列表]
├─ 左右分屏:
│    [改动前 ViewerCanvas]   |   [改动后 ViewerCanvas]
│     (删除项标红)               (新增项标绿，两侧改动项标黄)
├─ 变更清单（可点击定位）:
│    + 新增 ...   − 删除 ...   ~ 改动 ...
└─ 底部: 意见输入框 + [通过] [驳回]
```

所有数据走**现有命令**：`list_reviews` / `list_diagram_versions` / `get_diagram_version_topology` / `approve_review` / `reject_review`。

## 5. 数据流（进入对比视图时）

| 步骤 | 调用 | 结果 |
|---|---|---|
| 1 | 从列表行拿到 `review`（含 `diagramId`、`diagramVersionId`、提交人、提交时间） | — |
| 2 | `get_diagram_version_topology(diagramId, review.diagramVersionId)` | **改动后**拓扑（右） |
| 3 | `list_diagram_versions(diagramId)`，筛 `status === 'ONLINE'` 的版本 | 找到→步骤4；找不到→新图，左侧空态 |
| 4 | `get_diagram_version_topology(diagramId, onlineVersion.id)` | **改动前**拓扑（左） |
| 5 | 前端 `diffTopology(before, after)` | 高亮集合 + 变更清单 |

> 边界：若提交审核的图纸此前从未发布过，则 `list_diagram_versions` 中没有 `ONLINE` 版本 → 判定为新图。

## 6. 差异算法 `diffTopology(before, after)`（前端纯函数）

输入两个拓扑（instances + edges，来自版本快照重建）。

**实例（instance）**——以 `instance.id` 为稳定 key：

- 只在 after：**新增** → 右图标绿
- 只在 before：**删除** → 左图标红
- 两边都有，但 `positionX` / `positionY` / `label` / `instanceData` 任一不同：**改动** → 两图标黄

**连线（edge）**——以 `(sourceInstanceId, targetInstanceId, sourcePinId, targetPinId)` 组合为 key：

- 只在 after：**新增** → 右图标绿
- 只在 before：**删除** → 左图标红
- 两边都有，但 `lineType` / `polylineMidRatio` 不同：**改动** → 两图标黄

> 删除项只存在于"改动前"快照（含其自身 `id`），故红色高亮渲染在**左图**；新增项的 `id` 在"改动后"快照，绿色渲染在**右图**；改动项两边各有 `id`，两图各自标黄。

**输出结构**（供画布高亮与清单渲染）：

```ts
interface DiffResult {
  before: { highlights: Map<string, 'removed' | 'changed'> }; // instanceId|edgeId -> color
  after:  { highlights: Map<string, 'added'   | 'changed'> };
  changes: Array<{
    kind: 'added' | 'removed' | 'changed';
    target: 'instance' | 'edge';
    id: string;          // 用于点击定位（边用 edge.id，定位到其端点实例）
    label: string;       // 清单展示文案，如 "新增 开关 K3"
  }>;
}
```

`instanceData` 比较用稳定序列化（键排序后 `JSON.stringify`）避免键顺序误判。位置比较可加微小阈值（如 < 0.5px 不算改动），防止浮点抖动误报。

## 7. 文件改动清单

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/pages/DiagramReviewPage.tsx` | 改 | 列表行改为每图一行；移除旧内联预览（`get_diagram_topology` 预览、`expandedReviewId`/`previewData` 相关逻辑）；点击行进入 `ReviewCompareView` |
| `src/components/review/ReviewCompareView.tsx` | 新增 | 全屏对比容器：按第 5 节取数 → diff → 双 `ViewerCanvas` + 变更清单 + 审核操作（通过/驳回 + 意见） |
| `src/utils/diffTopology.ts` | 新增 | 第 6 节纯函数 |
| `src/utils/diffTopology.test.ts` | 新增 | vitest 单测：增/删/改/新图四种场景 |
| `src/components/diagram/ViewerCanvas.tsx` | 改 | 见第 8 节，新增 diff 高亮入参 |
| `src/services/reviewApi.ts` / `src/services/diagramApi.ts` | 改 | 复用现有方法；必要时补类型导出（如版本拓扑、版本列表类型） |

> 删除 `DiagramReviewPage` 中因改造而孤立的导入/状态/函数（仅限本次改动造成的）。

## 8. ViewerCanvas 扩展

ViewerCanvas 已有 `highlightedInstanceId`（单点聚焦）与 `outageResult`（按 id 列表着色）两套先例，按同样模式扩展：

- 新增 prop `diffHighlights?: { instances: Map<string,'added'|'removed'|'changed'>; edges: Map<string,'added'|'removed'|'changed'> }`
  - 实例：按颜色描边/底色（绿/红/黄）。
  - 边：按颜色加粗描边。
- 复用现有 `highlightedInstanceId` 实现"点击变更清单项 → 该元件高亮闪烁"；配合受控 `zoom/panX/panY` + `onSetPan` 将其居中。
- 颜色常量集中定义，绿=新增、红=删除、黄=改动。

## 9. 边界与错误处理

- 某一侧版本拓扑取数失败 → 该侧画布显示错误态，不阻塞另一侧与审核操作。
- 新图无 ONLINE 版本 → 左侧空态："🆕 新建图纸，无历史版本可对比"。
- 审核操作沿用现有后端逻辑：通过→被审版本 `ONLINE`、旧 `ONLINE` 转 `DECOMMISSIONED`、图纸 `PUBLISHED`；驳回→版本 `REJECTED`、图纸 `REJECTED`。
- 实例引用的 component 已被删/改 → 沿用 ViewerCanvas 现有兜底渲染行为。

## 10. 测试与验收

**单元测试（vitest）** `diffTopology.test.ts`：

- 新增一个实例 + 一条边 → 出现在 `after.highlights='added'` 与清单。
- 删除一个实例 + 一条边 → 出现在 `before.highlights='removed'` 与清单。
- 移动实例 / 改线型 → `changed`，两侧高亮。
- 新图（before 为空）→ 全部 `added`，无 `removed`。

引入 vitest：加 `vitest` devDependency，`package.json` 增 `"test": "vitest run"` 脚本，必要时加最小 `vitest` 配置（复用 vite 配置即可）。

**手动验收**（`pnpm tauri dev`）：

1. 已发布图纸改几处后提交审核 → 审核页对比视图左右分屏、删除标左红/新增标右绿/改动两黄、清单条目正确、点击清单项定位高亮。
2. 全新图纸首次提交 → 左侧显示新图空态，右侧正常。
3. 通过/驳回后状态流转与现状一致。

**编译验证**：`pnpm build`（tsc + vite）、`pnpm lint`、`pnpm test`。
