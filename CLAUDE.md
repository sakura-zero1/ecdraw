# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ECDraw — 10kV 配电网智能绘图平台。当前阶段为**元件编辑器**，用于绘制电气元件的符号形状、定义引脚位置和内部连通矩阵。项目后续将扩展为包含配网图编辑器、AI 助手、审核流程的完整多人协作系统。

需求规格：`docs/需求规格说明书.md`
技术方案：`.claude/plans/dapper-imagining-turing.md`

## 常用命令

```bash
npm run dev       # Vite 开发服务器
npm run build     # tsc -b && vite build
npm run lint      # ESLint
npm run preview   # 预览构建产物
```

## 技术栈

React 19 + TypeScript 6 + Vite 8 / Zustand 5 + immer / 纯 SVG 画布 / Framer Motion

## 架构

### 三层 Zustand Store

| Store | 持久化 | 职责 |
|---|---|---|
| `useComponentStore` | localStorage (`ecdraw-component-library-v1`) | 元件/引脚/形状 CRUD + undo 快照栈（JSON.stringify，max 50） |
| `useConnectionStore` | localStorage (`ecdraw-connection-library-v1`) | 每个元件独立的连通矩阵，连接状态/可见性切换 |
| `useCanvasStore` | 无 | 画布视口、工具模式、选中状态（shapes/pins/connections）、剪贴板、绘图默认值、闪烁动画 |

所有 store 使用 `zustand` + `immer` 中间件，需要持久化的使用 `persist`。

### 核心数据模型 (`src/types/`)

- **`ElectricalComponent`** — 顶层实体，`shapeElements[]` + `pins[]`，`width`/`height` 定义画布尺寸（默认 1200×800）
- **`ShapeElement`** — SVG 图形（rect/circle/ellipse/line/path），通过 `linkedConnectionId` 关联连接状态，`stateClosed`/`stateOpen`（ShapeStateOverride）控制状态驱动的视觉变化
- **`Pin`** — 自由定位的连接点，有类型（input/output/bidirectional/power/ground）
- **`Connection`** — 元件内两引脚间连接，`state`（closed/open）、`visible`、`animationDuration`
- **`ConnectivityMatrix`** — 一个元件所有 Connection 的集合，key 为 componentId

### Shape-State Connection Linking

核心数据流：`ShapeElement.linkedConnectionId` → 查找对应 `Connection` → 根据连接 state（closed/open）应用 `ShapeStateOverride` → `resolveShapeProps()` 在渲染时合并覆盖属性。`SvgCanvas` 订阅 `useConnectionStore.matrices` 响应连接状态变化。

### 配网分类体系 (`src/constants/categories.ts`)

四类元件：`powerPoint`（电源点）、`switchPoint`（分合点）、`junctionPoint`（衔接点）、`loadPoint`（负荷点）。每个分类有预定义 SVG 形状模板（`src/constants/shapes.ts`）。

### 画布交互模型 (`SvgCanvas.tsx`)

**工具模式**：select / draw-rect / draw-circle / draw-ellipse / draw-line / add-pin
**鼠标事件处理**（优先级从高到低）：
1. 缩放手柄拖拽（resize handle）
2. 框选（rubber band）— 选择模式空白处拖拽 / 其他模式 Ctrl+拖拽
3. 引脚点击/拖拽 — 支持多选（Ctrl/Shift）和拖拽移动（带吸附）
4. 形状点击/拖拽 — 同组元素联动移动
5. 绘图预览（draw tools）
6. 取消选择（空白处点击）

**形状拖拽移动**：`applyShapeMove()` 根据 key 名（x/cx/x1→dx, y/cy/y1→dy）计算偏移。组合形状（同 groupId）联动移动。

**形状缩放**：`computeResizedShape()` 支持 rect（nw/ne/sw/se）、circle/ellipse（e/w/n/s）、line（start/end）手柄。

**引脚吸附**：`getSnapPosition()` 扫描所有形状边界上的 25 个吸附点，10px 阈值内自动吸附，显示十字准星预览。

### 右侧面板

标签页模式（AppLayout.tsx）：
- **元件属性** tab：PropertyPanel（元件名称/分类/描述 + 选中形状参数编辑）
- **引脚管理** tab：PinListPanel + ConnectivityMatrixPanel（连通矩阵 + 连接详情 + 形状状态关联覆盖）

### 连接详情面板 (`ConnectivityMatrixPanel.tsx`)

每个 Connection 可展开查看：
- 状态切换（闭合/断开）
- 可见性切换（👁/🚫）
- 关联的形状列表，每个形状可设置 stateClosed/stateOpen 覆盖（填充/描边/粗细/透明度/几何参数）
- 播放开断动画

## 快捷键

| 键 | 功能 |
|---|---|
| Q/A/S/D/F | 工具切换（选择/矩形/圆形/椭圆/线段） |
| Alt（长按） | 任何工具下临时切换为选择模式 |
| Ctrl+C/V | 复制/粘贴形状 |
| Ctrl+D | 复制选中形状（偏移 20px） |
| Ctrl+G / Shift+Ctrl+G | 组合/解组形状 |
| Ctrl+Z | 撤销 |
| Ctrl+X / Delete / Backspace | 删除选中形状 |
| Escape | 清除选择 |

## 约定

- 界面文字使用中文
- ID 使用 uuid v4
- 线段绘图吸附阈值 5px（水平/垂直）
- 引脚拖拽吸附阈值 10px（吸附到形状边界点）
- 形状最小尺寸 3px（绘图）/ 4px（缩放）
- 对齐工具同时支持形状和引脚
- 引脚默认类型 bidirectional，默认名称自增数字
- 元件复制时完整映射 pinId 并复制连通矩阵

## 项目文件格式

`.ecp.json`：包含 `version`、`components[]`、`matrices[]`、`savedAt`。导入导出逻辑在 `AppLayout.tsx`。
