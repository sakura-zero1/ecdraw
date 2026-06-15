# ECDraw 2.0 — ROADMAP

> **核心原则**：当前版本未完成前，下一版本所列功能一律不动。
> 不在 ROADMAP 中的"好点子"，先记到 `IDEAS.md`，不在工作时间里碰。

---

## 当前阶段：v1.0 MVP

**目标**：完成"画图 → 存图 → 看图"最小闭环。

### MVP 完成判定（验收标准）

让一个完全没见过这软件的人，**30 分钟内**完成以下流程，全部通过即视为 MVP 完成：

- [ ] 用 admin 账户登录
- [ ] 在元件库中新建 1 个元件（任意分类）
- [ ] 创建一张新图纸
- [ ] 在画布上拖入 5 个元件（包含刚新建的那一个）
- [ ] 画 3 条连线
- [ ] 保存草稿
- [ ] 关闭软件
- [ ] 重新打开软件并登录
- [ ] 打开刚才那张图，**看到 5 个元件 + 3 条连线，位置和连接关系不变**
- [ ] 用查看器（DiagramViewerPage）只读打开同一张图

### MVP 范围（只做这 4 块）

| # | 模块 | 涉及代码 | 状态 |
|---|---|---|---|
| 1 | 登录 | `LoginPage`, `commands/auth.rs`, `commands/seed.rs` | ☐ 待验收 |
| 2 | 元件库（CRUD + 拖入） | `ComponentEditor`, `commands/components.rs`, `commands/categories.rs` | ☐ 待验收 |
| 3 | 图纸编辑器（拖/连/移动/删除/保存） | `DiagramEditorPage`, `DiagramCanvas`, `commands/diagrams.rs` | ☐ 待验收 |
| 4 | 图纸查看器（只读） | `DiagramViewerPage` | ☐ 待验收 |

### MVP 阶段的纪律

- **只在以上 4 块代码里改东西**。
- 修 bug 优先于加功能。**任何加新功能的冲动 → 写进 `IDEAS.md`，不动键盘。**
- 角色只用 ADMIN 一种，不要碰其他 7 种角色。
- 不再做"标签字号、自定义标题栏、版本时间线"这种打磨工作。
- 每发现一个 MVP 流程里卡顿的地方，写进下方"MVP Bug 清单"。

### MVP Bug 清单

> 走 30 分钟验收流程时记录的所有问题。清空此清单 = MVP 完成。

- _（填写）_

---

## 冷藏区：已实现但**暂不开发**

以下功能代码保留、入口可见，**但 MVP 阶段不投入任何新开发时间**。
MVP 完成前发现这些模块的 bug，记下来，不修。

- [ ] 审核流程（`DiagramReviewPage`, `commands/reviews.rs`，提交/撤回/驳回）
- [ ] 台区数据（`DistrictPage`, `commands/districts.rs`, `DistrictDataPanel`）
- [ ] 线路台账（`LinePage`, `commands/lines.rs`, `LineDataPanel`）
- [ ] GIS 地理信息（`GisPage`, `commands/gis.rs`, `GisDataPanel`）
- [ ] 停电模拟 / 潮流计算 / 故障分析（`commands/analysis.rs`）
- [ ] 用户管理（`UserManagementPage`, `commands/users.rs`）
- [ ] 审计日志（`AuditPage`, `commands/audit.rs`）
- [ ] 管理仪表盘（`DashboardPage`, `commands/admin.rs`）
- [ ] 元件版本管理 / 图纸版本时间线
- [ ] 8 种细粒度角色

---

## 下一阶段：v1.5（**MVP 完成后**才解锁）

**目标**：从单用户走向团队基础协作。

- [ ] 用户管理（新建/禁用用户）
- [ ] 简化角色：仅保留 `ADMIN` / `EDITOR` / `VIEWER` 三种
- [ ] 权限边界基础测试

---

## v2.0：审核与协作

**目标**：支持图纸审核工作流（仅在真有业务场景需求时才做）。

- [ ] 提交审核 / 撤回审核 / 审核驳回
- [ ] 图纸状态机：DRAFT / PENDING_REVIEW / PUBLISHED / REJECTED
- [ ] 审计日志查阅

---

## v3.0：业务数据扩展

**目标**：图纸不仅是图，而是带有业务属性的资产。

- [ ] 台区数据（变压器容量、供电户数等）
- [ ] 线路台账（导线型号、长度、产权等）
- [ ] GIS 地理信息（经纬度）

---

## v4.0：分析能力

**目标**：从绘图工具升级为分析平台。

- [ ] 停电模拟（BFS 实现已有，需打磨）
- [ ] 潮流计算
- [ ] 故障分析
- [ ] 管理仪表盘统计

---

## 规则

1. **当前阶段没有完成时，禁止开始下一阶段。** 哪怕你已经"忍不住想试试"。
2. **bug 优先级始终高于新功能**，但**仅限当前阶段的 bug**。冷藏区的 bug 不修。
3. **每周回看一次 ROADMAP**，问自己："这周写的代码，是在当前阶段范围内吗？"
4. **完成一个阶段 = 在本文档对应 checkbox 全部勾选 + 写一行总结**。
5. 任何"额外的好点子"全部写进 `IDEAS.md`，**不写进代码**。

---

_最后更新：2026-05-11_
