# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ECDraw — 10kV 配电网图纸数据管理和应用平台。支持多角色协作，包含元件编辑器、配网图编辑器（Canvas）、拓扑查询（3 种视图）、停电模拟、数据维护（台区/线路/地理）、审核流程、管理后台。

设计规格：`docs/superpowers/specs/2026-04-13-ecdraw-redesign.md`
实施计划：`docs/superpowers/plans/2026-04-13-ecdraw-phase1.md`
执行清单：`计划清单.md`

## 常用命令

```bash
npm run dev          # Vite 前端开发服务器
npm run build        # 前端构建 (tsc -b && vite build)
npm run lint         # ESLint
npm run api:dev      # 后端开发服务器 (tsx watch server/index.ts)
npm run db:migrate   # Prisma 迁移
npm run db:seed      # 管理员种子数据
npm run db:studio    # Prisma Studio
```

## 技术栈

- **前端**：React 19 + TypeScript + Vite 8 / Zustand 5 + immer / HTML5 Canvas / React Router 7
- **后端**：Express 5 + TypeScript (tsx) / Prisma 6 + PostgreSQL / JWT + bcryptjs
- **数据导入导出**：SheetJS (xlsx)

## 角色体系（8 角色，可多选叠加）

| 角色 | 职责 |
|---|---|
| ADMIN | 全部权限，用户管理，审计日志 |
| COMPONENT_EDITOR | 元件库 CRUD |
| DIAGRAM_EDITOR | 配网图绘制 + 可创建元件 + 可编辑台区/线路/地理数据 |
| REVIEWER | 审核图纸拓扑 |
| DISTRICT_EDITOR | 台区数据维护 |
| LINE_EDITOR | 线路台账维护 |
| GIS_EDITOR | 地理信息维护 |
| VIEWER | 查询浏览 |

权限取并集：账号可同时拥有多个角色。

## 架构

### 后端路由模块 (`server/routes/`)

| 模块 | 路径 | 职责 |
|---|---|---|
| auth.ts | /api/auth | 登录/刷新 token |
| users.ts | /api/users | 用户 CRUD（多角色） |
| components.ts | /api/components | 元件 CRUD + 版本 |
| diagrams.ts | /api/diagrams | 图纸 CRUD + 实例/边 + 拓扑查询 |
| districts.ts | /api/districts | 台区数据 CRUD + 批量导入 |
| lines.ts | /api/lines | 线路台账 CRUD + 批量导入 |
| gis.ts | /api/gis | 地理信息 CRUD + 批量导入 |
| reviews.ts | /api/reviews | 审核队列 |
| audits.ts | /api/audits | 审计日志查询 |
| analysis.ts | /api/analysis | 停电模拟 + 潮流计算（占位） |
| admin.ts | /api/admin | 管理仪表盘统计 |

### 数据模型 (`prisma/schema.prisma`)

- **User** — roles 为 JSON 字符串数组（`'["ADMIN","VIEWER"]'`），解析时用 `JSON.parse`
- **Component / ComponentVersion** — 元件库，4 类：powerPoint / switchPoint / junctionPoint / loadPoint
- **Diagram / DiagramVersion** — 图纸，状态：DRAFT → PENDING_REVIEW → PUBLISHED / REJECTED
- **DiagramInstance** — 图纸中的元件实例，label 必填，positionX/Y + instanceData
- **DiagramEdge** — 实例间连线，sourceInstanceId + targetInstanceId + pinId
- **DistrictData** — 台区数据（一对一 → DiagramInstance）
- **LineSegmentData** — 线路台账（一对一 → DiagramEdge）
- **GisData** — 地理信息（一对一 → DiagramInstance）
- **ReviewRequest** — 审核请求，仅拓扑数据需审核
- **AuditLog** — 全操作审计日志

### 前端页面 (`src/pages/`)

| 页面 | 路由 | 角色 |
|---|---|---|
| LoginPage | /login | 公开 |
| DashboardPage | /admin/dashboard | ADMIN |
| UserManagementPage | /admin/users | ADMIN |
| AuditPage | /admin/audits | ADMIN |
| ComponentEditor | /components | ADMIN, COMPONENT_EDITOR, DIAGRAM_EDITOR |
| DiagramEditorPage | /diagrams | ADMIN, DIAGRAM_EDITOR |
| DiagramReviewPage | /reviews | ADMIN, REVIEWER |
| DiagramViewerPage | /viewer | 所有角色 |
| DistrictPage | /districts | ADMIN, DIAGRAM_EDITOR, DISTRICT_EDITOR |
| LinePage | /lines | ADMIN, DIAGRAM_EDITOR, LINE_EDITOR |
| GisPage | /gis | ADMIN, DIAGRAM_EDITOR, GIS_EDITOR |

### 前端核心组件

- **DiagramCanvas** (`src/components/diagram/DiagramCanvas.tsx`) — 配网图编辑器 Canvas（拖放、连线、引脚交互、缩放平移、实例标签拖动/双击编辑、连接标签、线路台账渲染）
- **ViewerCanvas** (`src/components/diagram/ViewerCanvas.tsx`) — 只读查询 Canvas（3 种视图 + 停电模拟叠加层）
- **ComponentLibraryPanel** (`src/components/diagram/ComponentLibraryPanel.tsx`) — 元件库拖放面板
- **AppShell** (`src/components/layout/AppShell.tsx`) — 认证后布局（侧边栏 + 顶栏 + Outlet）
- **RoleGuard** (`src/components/guards/RoleGuard.tsx`) — 角色权限守卫

### Zustand Store

| Store | 职责 |
|---|---|
| `useComponentStore` | 元件编辑器状态（SVG 画布） |
| `useConnectionStore` | 元件连通矩阵 |
| `useCanvasStore` | 元件画布视口/工具/选择 |
| `useDiagramStore` | 配网图编辑器状态（实例/边/视口/撤销栈/componentConnections/实例标签位置） |

## 关键实现细节

### DiagramInstance.instanceData 结构

`instanceData` 是 JSON 字段，存储实例级可变数据：

```ts
{
  rotation?: number;        // 旋转角度
  flipH?: boolean;          // 水平翻转
  flipV?: boolean;          // 垂直翻转
  labelOffsetX?: number;   // 名称标签 X 偏移（世界坐标）
  labelOffsetY?: number;   // 名称标签 Y 偏移（世界坐标）
  connectionLabels?: {     // 内部连接标签
    [connId: string]: { name: string; visible: boolean; offsetX: number; offsetY: number }
  }
}
```

### Canvas 渲染坐标系

- Canvas 使用 `ctx.translate(panX, panY); ctx.scale(zoom, zoom)` 世界坐标变换
- 默认初始缩放 50%（zoom=0.5），所有文字在世界坐标下渲染（跟随缩放）
- 标签文字基准大小 40px（50% 缩放下显示为 20px）
- 连线颜色：默认灰色，用户产权紫色(`rgb(85,48,217)`)，公用黑色，电缆虚线
- `getDominantShapeColor(shapes)` 取元件形状填充面积最大/边框最长的颜色用于标签文字色

### 图纸编辑器交互优先级（hit test）

鼠标事件命中检测顺序：边缘删除按钮 → 连接模式引脚 → 引脚 → 实例名称标签 → 内部连接标签 → 节点 → 边 → 空白

### 数据完整度 → 可用功能

| 数据层 | 精简/完整视图 | 地理视图 | 停电模拟 | 潮流计算 |
|---|---|---|---|---|
| 仅拓扑 | ✓ | - | - | - |
| + 台区 | ✓ | - | ✓ | - |
| + 地理 | ✓ | ✓ | ✓ | - |
| + 线路 | ✓ | ✓ | ✓ | ✓ |

## 约定

- 界面文字使用中文
- 元件编辑器用 SVG 画布，配网图编辑器用 Canvas
- User.roles 存储为 JSON 字符串，API 层解析为 string[]
- 停电模拟：BFS 从电源点遍历，断开分合点后计算不可达区域
- 数据导入使用 SheetJS (xlsx) 前端解析，批量 upsert 后端端点（上限 500 条）
- 台区/线路/地理数据免审，仅拓扑数据需审核
- 审计日志记录所有数据变更
- 删除元件时需先删除引用它的 DiagramInstance（外键约束）
- `fetchComponentLibrary()` 返回 `{ components, matrices }`，matrices 是 ConnectivityMatrix 数组
