# ECDraw UI Redesign Spec — 极简克制

**Date:** 2026-04-17
**Scope:** 全量改造（视觉 + 布局）
**Style:** 极简克制 (Near-white + Mono + Rose Accent)

## 1. Design Direction

- **Tone:** 极简克制，类似 Notion/Figma 的工具美学
- **Color:** 灰度 9 级 + 玫红点缀 `#e11d48`
- **Typography:** DM Sans (Google Fonts) + PingFang SC / Noto Sans SC
- **Layout:** 顶栏导航 + 统一双栏/三栏编辑器布局
- **Principle:** 不新增组件逻辑，只改 CSS 变量 + 布局结构 + AppShell 组件

## 2. Color System

### 灰度阶梯

| Token | Value | Usage |
|---|---|---|
| `--gray-900` | `#1a1a1a` | 标题、品牌字 |
| `--gray-700` | `#444444` | 正文 |
| `--gray-500` | `#888888` | 次要文字 |
| `--gray-400` | `#aaaaaa` | placeholder、禁用 |
| `--gray-300` | `#cccccc` | 分割线 (浅) |
| `--gray-200` | `#e5e5e5` | 分割线 (主)、边框 |
| `--gray-100` | `#f0f0f0` | 输入框背景、网格线 |
| `--gray-50` | `#f5f5f5` | hover 背景 |
| `--gray-25` | `#fafbfc` | 页面底色 |

### 玫红点缀

| Token | Value | Usage |
|---|---|---|
| `--accent` | `#e11d48` | 主按钮、active 态、链接 |
| `--accent-hover` | `#be123c` | hover 加深 |
| `--accent-soft` | `rgba(225, 29, 72, 0.06)` | active 背景、tag 背景 |
| `--accent-text` | `rgba(225, 29, 72, 0.85)` | 图标、辅助文字 |

### 语义色

| Token | Value | Usage |
|---|---|---|
| `--success` | `#16a34a` | 通过、已发布 |
| `--warning` | `#d97706` | 待审核 |
| `--danger` | `#dc2626` | 拒绝、错误 |
| `--info` | `#0284c7` | 信息提示 |

## 3. Typography

### Font Stack

```css
--font-sans: 'DM Sans', 'PingFang SC', 'Noto Sans SC', sans-serif;
--font-mono: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
```

### Type Scale

| Level | Size | Weight | Letter-spacing | Usage |
|---|---|---|---|---|
| Display | 20px | 800 | -0.5px | 品牌字、登录标题 |
| H1 | 16px | 700 | -0.3px | 页面标题 |
| H2 | 14px | 700 | — | 区块标题 |
| Body | 13px | 400 | — | 正文 |
| Caption | 11px | 500 | 0.3px | 标签、时间戳 |
| Label | 10px | 700 | 0.8px | uppercase 表单标签、panel 标题 |

### 加载方式

在 `index.html` 中添加 Google Fonts 链接：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000&display=swap" rel="stylesheet">
```

## 4. Layout System

### 4.1 AppShell — 顶栏导航

**从左侧导航栏改为顶栏水平导航。**

```
┌─────────────────────────────────────────────────────┐
│ ECDraw   元件  图纸  审核  查看  台区  线路  地理 │ admin ▾│
├─────────────────────────────────────────────────────┤
│                                                     │
│              <Outlet /> 页面内容                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- 顶栏高度 40px，白底，`border-bottom: 1px solid var(--gray-200)`
- 左侧：品牌字 "EC**Draw**"（Draw 玫红色）
- 中部：导航标签，水平排列，间距 2px
  - 默认态：灰色文字 `var(--gray-500)`，无背景
  - Hover：`var(--gray-50)` 背景
  - Active：`var(--accent-soft)` 背景 + `var(--accent)` 文字 + `font-weight: 600`
- 右侧：用户名 + 退出按钮
- 菜单溢出处理：屏幕宽度不足时，超出项收入 "更多 ▾" 下拉菜单
- **角色权限**：仍按 `user.roles` 过滤可见菜单项

### 4.2 编辑器页面 — 统一三栏

适用于 **元件编辑器** (`AppLayout`) 和 **图纸编辑器** (`DiagramEditorPage`)。

```
┌──────────┬───────────────────────┬──────────┐
│ 200px    │       1fr             │  260px   │
│ 元件库/  │      Canvas           │  属性    │
│ 图纸列表 │      画布              │  面板    │
└──────────┴───────────────────────┴──────────┘
```

- 顶栏融入 AppShell 顶栏，不再有独立 topbar
- 左栏 200px：元件库（元件编辑器）或 图纸列表 + 元件库拖放（图纸编辑器）
- 右栏 260px：属性面板
- 栏间距：1px `var(--gray-200)` 分割线，无 gap
- 收缩行为保持：32px 图标态，展开按钮在面板顶部

### 4.3 查看器页面 — 统一三栏

```
┌──────────┬───────────────────────┬──────────┐
│ 200px    │       1fr             │  260px   │
│ 图纸列表 │     Viewer Canvas     │ 模拟统计 │
│ 浅色背景 │                       │ (按需)   │
└──────────┴───────────────────────┴──────────┘
```

- 深色侧栏 `#1e293b` → 白底 `#fff`，与其他页面统一
- 工具栏融入画布区域顶部，不独立占行

### 4.4 数据维护页 — 统一双栏

适用于 台区/线路/地理 维护页。

```
┌──────────┬───────────────────────────────┐
│ 200px    │           1fr                 │
│ 图纸列表 │     数据表格 + 筛选/操作栏     │
└──────────┴───────────────────────────────┘
```

### 4.5 审核页 — 全宽列表

```
┌─────────────────────────────────────────┐
│  筛选栏：状态 ▾  |  刷新                  │
├─────────────────────────────────────────┤
│  审核项 1                                │
│  审核项 2                                │
│  ...                                    │
└─────────────────────────────────────────┘
```

### 4.6 管理后台 — 全宽卡片

Dashboard / 用户管理 / 审计日志：全宽布局，卡片/表格撑满内容区。

## 5. Component Styles

### 5.1 Buttons

| Variant | Background | Border | Text |
|---|---|---|---|
| Primary | `var(--accent)` | — | `#fff` |
| Primary Hover | `var(--accent-hover)` | — | `#fff` |
| Secondary | `transparent` | `var(--gray-200)` | `var(--gray-700)` |
| Secondary Hover | `var(--gray-50)` | `var(--gray-300)` | `var(--gray-900)` |
| Danger | `transparent` | `#fecaca` | `var(--danger)` |
| Danger Hover | `#fef2f2` | `#fca5a5` | `var(--danger)` |
| Ghost | `transparent` | — | `var(--gray-500)` |
| Ghost Hover | `var(--gray-50)` | — | `var(--gray-700)` |

Padding: `6px 12px` (sm), `8px 16px` (default)
Radius: `6px`
Font: `var(--font-sans)`, `font-weight: 600`, `font-size: 12px`

### 5.2 Inputs

- Background: `var(--gray-25)`
- Border: `1px solid var(--gray-200)`
- Focus: `border-color: var(--accent)`, `box-shadow: 0 0 0 3px var(--accent-soft)`
- Radius: `6px`
- Padding: `7px 10px`
- Font: `12px`, `var(--font-sans)`

### 5.3 Cards

- Background: `#fff`
- Border: `1px solid var(--gray-200)`
- Radius: `8px`
- Hover: `border-color: var(--gray-300)`, `box-shadow: 0 2px 8px rgba(0,0,0,0.04)`
- Active/Selected: `border-color: var(--accent)`, `background: var(--accent-soft)`

### 5.4 Tags / Badges

- Font: `10px`, `font-weight: 700`, `letter-spacing: 0.3px`
- Radius: `4px`
- Padding: `2px 8px`
- Variants:
  - Default: `bg: var(--gray-50)`, `color: var(--gray-500)`
  - Accent: `bg: var(--accent-soft)`, `color: var(--accent)`
  - Success: `bg: #f0fdf4`, `color: #16a34a`
  - Warning: `bg: #fffbeb`, `color: #d97706`
  - Danger: `bg: #fef2f2`, `color: #dc2626`

### 5.5 Panels

- 标题：`var(--label)` 样式，uppercase，灰色
- 内容：无额外边框，用分割线 `var(--gray-50)` 分隔行
- 收缩态：32px 宽，居中展开按钮

### 5.6 Tables

- Header: `var(--gray-50)` 背景，`var(--label)` 字体
- Row: 白底，hover `var(--gray-50)`
- Border: `1px solid var(--gray-200)` 外框，行间 `var(--gray-100)` 细线

## 6. Spacing & Radius

| Token | Value |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `24px` |
| `--space-6` | `32px` |
| `--radius-sm` | `4px` |
| `--radius` | `6px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `12px` |

## 7. Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | 卡片、面板 |
| `--shadow` | `0 2px 8px rgba(0,0,0,0.06)` | 弹出层、下拉 |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.08)` | 模态框、toast |

## 8. File Change Map

### 新建/修改文件

| File | Action | Description |
|---|---|---|
| `index.html` | 修改 | 添加 Google Fonts 链接 |
| `src/index.css` | 新建 | 全局 CSS 变量系统 + reset + 基础样式 |
| `src/App.css` | 重写 | AppShell 顶栏导航 + 登录页 + 各页面通用样式 |
| `src/components/layout/AppShell.tsx` | 重写 | 从左侧导航改为顶栏水平导航 |
| `src/components/layout/AppLayout.css` | 重写 | 元件编辑器三栏布局 + 统一视觉 |
| `src/components/layout/AppLayout.tsx` | 修改 | 移除独立 topbar，适配新布局 |
| `src/pages/DiagramEditorPage.css` | 重写 | 图纸编辑器三栏布局 + 统一视觉 |
| `src/pages/DiagramEditorPage.tsx` | 修改 | 移除独立 topbar，适配新布局 |
| `src/pages/DiagramViewerPage.tsx` | 修改 | 浅色侧栏，统一风格 |
| `src/pages/DiagramViewerPage.css` 或对应样式 | 修改 | 浅色侧栏样式 |
| 其他页面 TSX/CSS | 修改 | 复用全局变量，统一卡片/表格/按钮样式 |

### 不变文件

- 所有 Zustand stores、services、后端路由、Prisma schema
- Canvas 绘制逻辑 (`SvgCanvas`, `DiagramCanvas`, `ViewerCanvas`)
- 路由配置和权限守卫逻辑

## 9. Responsive

- `>= 1280px`: 完整三栏布局
- `1024px ~ 1279px`: 侧栏缩窄到 180px，面板缩窄到 220px
- `< 1024px`: 隐藏右侧面板（可展开），侧栏变为抽屉
- 顶栏导航始终可见，溢出项自动收入 "更多" 下拉

## 10. Migration Strategy

全量替换，不分阶段。一次 PR 包含所有视觉和布局变更。

1. 先建立全局 CSS 变量系统 (`src/index.css`)
2. 重写 AppShell 为顶栏导航
3. 逐页面适配新变量和布局
4. 全量回归测试

### 不做的事

- 不新增组件库或 CSS-in-JS
- 不引入 Tailwind 或其他框架
- 不改变任何业务逻辑或数据流
- 不做暗色主题（本次仅浅色极简）
- 不改变 Canvas/SVG 绘制代码
