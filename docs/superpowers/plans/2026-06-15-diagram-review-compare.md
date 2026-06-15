# 图纸审核模块前后版本对比 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把图纸审核页改成"列表每图一行 → 点击进全屏对比视图"，左右分屏展示改动前/后版本，画布按新增(绿)/删除(红)/改动(黄)高亮，并列出可点击定位的变更清单。

**Architecture:** 纯前端改造，不新增/修改任何 Rust 命令。改动后版本取自审核请求记录的 `diagramVersionId`，改动前版本取该图当前 `ONLINE` 版本快照（新图则无）。前端纯函数 `diffTopology` 对两个版本拓扑算差异，结果驱动 `ViewerCanvas` 着色与变更清单。

**Tech Stack:** React 19 + TypeScript + Vite 8 + HTML5 Canvas；新增 vitest 做纯函数单测。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `vitest.config.ts` | vitest 配置（node 环境，仅 src 下 `*.test.ts`） | 新建 |
| `package.json` | 加 `vitest` devDependency + `test` 脚本 | 改 |
| `src/utils/diffTopology.ts` | 纯函数 diff，输出高亮 Map + 变更清单 | 新建 |
| `src/utils/diffTopology.test.ts` | diff 单测（增/删/改/新图） | 新建 |
| `src/services/diagramApi.ts` | `TopologyResponse.edges` 补 `lineType`/`polylineMidRatio` 类型 | 改 |
| `src/components/diagram/ViewerCanvas.tsx` | 加 `diffHighlights` prop + 节点/边着色 | 改 |
| `src/components/review/ReviewCompareView.tsx` | 全屏对比容器：取数+diff+双画布+清单+审核操作 | 新建 |
| `src/pages/DiagramReviewPage.tsx` | 列表每图一行 + 切换到对比视图，移除旧内联预览 | 改 |
| `src/App.css` | 追加对比视图样式 | 改 |

---

## Task 1: 引入 vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Test: `src/utils/__smoke__.test.ts`（临时，验证后删除）

- [ ] **Step 1: 安装 vitest**

Run:
```bash
pnpm add -D vitest
```
Expected: `package.json` 的 `devDependencies` 出现 `vitest`，安装成功无报错。

- [ ] **Step 2: 创建 vitest 配置**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: 加 test 脚本**

Modify `package.json` 的 `scripts`，在 `"preview": "vite preview",` 后追加一行：
```json
    "test": "vitest run",
```

- [ ] **Step 4: 写 smoke 测试验证 vitest 跑通**

Create `src/utils/__smoke__.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test`
Expected: PASS，1 个测试通过。

- [ ] **Step 6: 删除 smoke 测试并提交**

Run:
```bash
rm src/utils/__smoke__.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: 引入 vitest 单测框架"
```

---

## Task 2: diffTopology 纯函数（TDD）

**Files:**
- Create: `src/utils/diffTopology.ts`
- Test: `src/utils/diffTopology.test.ts`

- [ ] **Step 1: 写失败的测试**

Create `src/utils/diffTopology.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { diffTopology, type DiffSide } from './diffTopology';

const inst = (id: string, over: Partial<DiffSide['instances'][number]> = {}) => ({
  id, label: id, positionX: 0, positionY: 0, instanceData: {} as Record<string, unknown>, ...over,
});
const link = (id: string, s: string, t: string, over: Partial<DiffSide['edges'][number]> = {}) => ({
  id, sourceInstanceId: s, targetInstanceId: t, sourcePinId: 'p1', targetPinId: 'p2', lineType: 'straight', ...over,
});
const side = (instances: DiffSide['instances'], edges: DiffSide['edges'] = []): DiffSide => ({ instances, edges });

describe('diffTopology', () => {
  it('新增元件与连线 → after 标 added', () => {
    const before = side([inst('A')]);
    const after = side([inst('A'), inst('B')], [link('e1', 'A', 'B')]);
    const d = diffTopology(before, after);
    expect(d.afterInstances.get('B')).toBe('added');
    expect(d.afterEdges.get('e1')).toBe('added');
    expect(d.changes.filter((c) => c.kind === 'added')).toHaveLength(2);
  });

  it('删除元件与连线 → before 标 removed', () => {
    const before = side([inst('A'), inst('B')], [link('e1', 'A', 'B')]);
    const after = side([inst('A')]);
    const d = diffTopology(before, after);
    expect(d.beforeInstances.get('B')).toBe('removed');
    expect(d.beforeEdges.get('e1')).toBe('removed');
    expect(d.changes.filter((c) => c.kind === 'removed')).toHaveLength(2);
  });

  it('移动元件 / 改线型 → 标 changed（两侧）', () => {
    const before = side([inst('A'), inst('B', { positionX: 0 })], [link('e1', 'A', 'B', { lineType: 'straight' })]);
    const after = side([inst('A'), inst('B', { positionX: 100 })], [link('e1', 'A', 'B', { lineType: 'curve' })]);
    const d = diffTopology(before, after);
    expect(d.afterInstances.get('B')).toBe('changed');
    expect(d.beforeInstances.get('B')).toBe('changed');
    expect(d.afterEdges.get('e1')).toBe('changed');
    expect(d.beforeEdges.get('e1')).toBe('changed');
  });

  it('新图（before 为 null）→ 全部 added，无 removed', () => {
    const after = side([inst('A'), inst('B')], [link('e1', 'A', 'B')]);
    const d = diffTopology(null, after);
    expect(d.afterInstances.get('A')).toBe('added');
    expect(d.afterInstances.get('B')).toBe('added');
    expect(d.afterEdges.get('e1')).toBe('added');
    expect(d.changes.every((c) => c.kind === 'added')).toBe(true);
  });

  it('位置抖动小于阈值不算改动', () => {
    const before = side([inst('A', { positionX: 0 })]);
    const after = side([inst('A', { positionX: 0.3 })]);
    const d = diffTopology(before, after);
    expect(d.afterInstances.has('A')).toBe(false);
    expect(d.changes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test`
Expected: FAIL，报 `diffTopology` / `DiffSide` 无法解析（模块不存在）。

- [ ] **Step 3: 实现 diffTopology**

Create `src/utils/diffTopology.ts`:
```ts
export type DiffStatus = 'added' | 'removed' | 'changed';

export interface DiffNode {
  id: string;
  label: string;
  positionX: number;
  positionY: number;
  instanceData: Record<string, unknown>;
}

export interface DiffLink {
  id: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePinId: string;
  targetPinId: string;
  lineType?: string;
  polylineMidRatio?: number | null;
}

export interface DiffSide {
  instances: DiffNode[];
  edges: DiffLink[];
}

export interface ChangeEntry {
  kind: DiffStatus;
  target: 'instance' | 'edge';
  id: string;              // instance.id 或 edge.id
  focusInstanceId: string; // 点击定位时居中的实例（instance→自身；edge→源实例）
  label: string;           // 清单文案
}

export interface DiffResult {
  beforeInstances: Map<string, DiffStatus>; // 'removed' | 'changed'
  afterInstances: Map<string, DiffStatus>;  // 'added'   | 'changed'
  beforeEdges: Map<string, DiffStatus>;
  afterEdges: Map<string, DiffStatus>;
  changes: ChangeEntry[];
}

const POS_EPS = 0.5;

/** 键排序后序列化，避免对象键顺序导致误判 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function edgeKey(e: DiffLink): string {
  return `${e.sourceInstanceId}|${e.targetInstanceId}|${e.sourcePinId}|${e.targetPinId}`;
}

function instanceChanged(a: DiffNode, b: DiffNode): boolean {
  if (a.label !== b.label) return true;
  if (Math.abs(a.positionX - b.positionX) > POS_EPS) return true;
  if (Math.abs(a.positionY - b.positionY) > POS_EPS) return true;
  return stableStringify(a.instanceData) !== stableStringify(b.instanceData);
}

function edgeChanged(a: DiffLink, b: DiffLink): boolean {
  if ((a.lineType ?? 'straight') !== (b.lineType ?? 'straight')) return true;
  return (a.polylineMidRatio ?? null) !== (b.polylineMidRatio ?? null);
}

function shortId(id: string): string {
  return `#${id.slice(0, 6)}`;
}

export function diffTopology(before: DiffSide | null, after: DiffSide): DiffResult {
  const result: DiffResult = {
    beforeInstances: new Map(),
    afterInstances: new Map(),
    beforeEdges: new Map(),
    afterEdges: new Map(),
    changes: [],
  };

  const beforeInst = new Map((before?.instances ?? []).map((i) => [i.id, i]));
  const afterInst = new Map(after.instances.map((i) => [i.id, i]));

  const labelOf = (id: string): string =>
    afterInst.get(id)?.label || beforeInst.get(id)?.label || shortId(id);

  // ---- instances ----
  for (const [id, a] of afterInst) {
    const b = beforeInst.get(id);
    const name = a.label || shortId(id);
    if (!b) {
      result.afterInstances.set(id, 'added');
      result.changes.push({ kind: 'added', target: 'instance', id, focusInstanceId: id, label: `新增元件 ${name}` });
    } else if (instanceChanged(b, a)) {
      result.afterInstances.set(id, 'changed');
      result.beforeInstances.set(id, 'changed');
      result.changes.push({ kind: 'changed', target: 'instance', id, focusInstanceId: id, label: `改动元件 ${name}` });
    }
  }
  for (const [id, b] of beforeInst) {
    if (!afterInst.has(id)) {
      result.beforeInstances.set(id, 'removed');
      result.changes.push({ kind: 'removed', target: 'instance', id, focusInstanceId: id, label: `删除元件 ${b.label || shortId(id)}` });
    }
  }

  // ---- edges ----
  const beforeEdge = new Map((before?.edges ?? []).map((e) => [edgeKey(e), e]));
  const afterEdge = new Map(after.edges.map((e) => [edgeKey(e), e]));
  for (const [key, a] of afterEdge) {
    const b = beforeEdge.get(key);
    const text = `连线 ${labelOf(a.sourceInstanceId)}→${labelOf(a.targetInstanceId)}`;
    if (!b) {
      result.afterEdges.set(a.id, 'added');
      result.changes.push({ kind: 'added', target: 'edge', id: a.id, focusInstanceId: a.sourceInstanceId, label: `新增${text}` });
    } else if (edgeChanged(b, a)) {
      result.afterEdges.set(a.id, 'changed');
      result.beforeEdges.set(b.id, 'changed');
      result.changes.push({ kind: 'changed', target: 'edge', id: a.id, focusInstanceId: a.sourceInstanceId, label: `改动${text}` });
    }
  }
  for (const [key, b] of beforeEdge) {
    if (!afterEdge.has(key)) {
      result.beforeEdges.set(b.id, 'removed');
      const text = `连线 ${labelOf(b.sourceInstanceId)}→${labelOf(b.targetInstanceId)}`;
      result.changes.push({ kind: 'removed', target: 'edge', id: b.id, focusInstanceId: b.sourceInstanceId, label: `删除${text}` });
    }
  }

  return result;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test`
Expected: PASS，5 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/utils/diffTopology.ts src/utils/diffTopology.test.ts
git commit -m "feat: 新增 diffTopology 拓扑差异纯函数 + 单测"
```

---

## Task 3: 扩展 ViewerCanvas 支持 diff 高亮

**Files:**
- Modify: `src/services/diagramApi.ts`（`TopologyResponse.edges` 类型）
- Modify: `src/components/diagram/ViewerCanvas.tsx`

- [ ] **Step 1: 补 TopologyResponse edge 类型**

Modify `src/services/diagramApi.ts`，在 `TopologyResponse` 的 `edges` 数组元素类型里，把：
```ts
    sourcePinId: string;
    targetPinId: string;
    lineSegmentData: { id: string; length: number | null; wireModel: string | null; wireOwnership: string | null; wireType: string | null; isMainDisplay: boolean | null } | null;
```
改为（在 `targetPinId` 后新增两行）：
```ts
    sourcePinId: string;
    targetPinId: string;
    lineType?: LineType;
    polylineMidRatio?: number | null;
    lineSegmentData: { id: string; length: number | null; wireModel: string | null; wireOwnership: string | null; wireType: string | null; isMainDisplay: boolean | null } | null;
```
（`LineType` 已在本文件上方定义，无需新增导入。）

- [ ] **Step 2: ViewerCanvas 加 diffHighlights prop 类型**

Modify `src/components/diagram/ViewerCanvas.tsx`，在 `ViewerCanvasProps` 接口里 `highlightedInstanceId?: string | null;` 这一行**之后**新增：
```ts
  diffHighlights?: {
    instances: Map<string, 'added' | 'removed' | 'changed'>;
    edges: Map<string, 'added' | 'removed' | 'changed'>;
  } | null;
```

- [ ] **Step 3: 加 diff 颜色常量与辅助函数**

在 `const HIGHLIGHT_COLOR = '#eab308';` 这一行**之后**新增：
```ts
// Diff overlay colors
const DIFF_ADDED_COLOR = '#22c55e';    // green
const DIFF_REMOVED_COLOR = '#ef4444';  // red
const DIFF_CHANGED_COLOR = '#eab308';  // yellow

function diffColor(s?: 'added' | 'removed' | 'changed'): string | null {
  if (s === 'added') return DIFF_ADDED_COLOR;
  if (s === 'removed') return DIFF_REMOVED_COLOR;
  if (s === 'changed') return DIFF_CHANGED_COLOR;
  return null;
}
```

- [ ] **Step 4: 解构新增 diffHighlights**

在组件参数解构里，把 `highlightedInstanceId,` 这一行（约 line 142）改为：
```ts
  highlightedInstanceId,
  diffHighlights,
```

- [ ] **Step 5: 边着色覆盖**

在边绘制循环里，把（约 line 424-426）：
```ts
      ctx.globalAlpha = g.edgeAlpha;
      ctx.strokeStyle = g.edgeColor;
      ctx.lineWidth = 2 / zoom;
```
改为：
```ts
      ctx.globalAlpha = g.edgeAlpha;
      ctx.strokeStyle = g.edgeColor;
      ctx.lineWidth = 2 / zoom;
      const edgeDiffColor = diffColor(diffHighlights?.edges.get(g.edge.id));
      if (edgeDiffColor) {
        ctx.strokeStyle = edgeDiffColor;
        ctx.lineWidth = 4 / zoom;
      }
```

- [ ] **Step 6: 节点 diff 边框**

在节点绘制循环里，`isDisconnectPoint` 的 `if` 块结束（约 line 620 的 `}`）**之后**、`ctx.restore(); // end shape transform`（约 line 622）**之前**，新增：
```ts
      const nodeDiffColor = diffColor(diffHighlights?.instances.get(inst.id));
      if (nodeDiffColor) {
        ctx.strokeStyle = nodeDiffColor;
        ctx.lineWidth = 3 / zoom;
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.stroke();
      }
```

- [ ] **Step 7: draw 依赖数组加 diffHighlights**

把 `draw` 的依赖数组（约 line 663）：
```ts
  }, [instances, edges, viewMode, zoom, panX, panY, selectedInstanceId, outageResult, highlightedInstanceId, getVisibleData, getInstancePosition]);
```
改为：
```ts
  }, [instances, edges, viewMode, zoom, panX, panY, selectedInstanceId, outageResult, highlightedInstanceId, diffHighlights, getVisibleData, getInstancePosition]);
```

- [ ] **Step 8: 编译验证**

Run: `pnpm build`
Expected: tsc + vite 构建通过，无类型错误。

- [ ] **Step 9: 提交**

```bash
git add src/services/diagramApi.ts src/components/diagram/ViewerCanvas.tsx
git commit -m "feat: ViewerCanvas 支持 diff 高亮（增绿/删红/改黄）"
```

---

## Task 4: ReviewCompareView 全屏对比组件

**Files:**
- Create: `src/components/review/ReviewCompareView.tsx`

- [ ] **Step 1: 创建组件**

Create `src/components/review/ReviewCompareView.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import ViewerCanvas from '../diagram/ViewerCanvas';
import {
  fetchDiagramVersions,
  fetchDiagramVersionTopology,
  type TopologyResponse,
} from '../../services/diagramApi';
import {
  approveReviewByApi,
  rejectReviewByApi,
  type ReviewQueueItem,
} from '../../services/reviewApi';
import { diffTopology, type ChangeEntry, type DiffResult } from '../../utils/diffTopology';
import { parseError } from '../../utils/parseError';

interface Props {
  review: ReviewQueueItem;
  onBack: () => void;
  onActionDone: () => void;
}

export default function ReviewCompareView({ review, onBack, onActionDone }: Props) {
  const [before, setBefore] = useState<TopologyResponse | null>(null);
  const [after, setAfter] = useState<TopologyResponse | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [isNewDiagram, setIsNewDiagram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  // 两侧画布视口（独立）
  const [beforeZoom, setBeforeZoom] = useState(0.6);
  const [beforePan, setBeforePan] = useState({ x: 0, y: 0 });
  const [afterZoom, setAfterZoom] = useState(0.6);
  const [afterPan, setAfterPan] = useState({ x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const afterTopo = await fetchDiagramVersionTopology(review.diagramId, review.diagramVersionId);
        const versions = await fetchDiagramVersions(review.diagramId);
        const online = versions.find((v) => v.status === 'ONLINE');
        const beforeTopo = online
          ? await fetchDiagramVersionTopology(review.diagramId, online.id)
          : null;
        if (!alive) return;
        setAfter(afterTopo);
        setBefore(beforeTopo);
        setIsNewDiagram(!online);
        setDiff(diffTopology(beforeTopo, afterTopo));
      } catch (e) {
        if (alive) setError(parseError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [review.diagramId, review.diagramVersionId]);

  const handleAction = async (action: 'approve' | 'reject') => {
    setActing(true);
    setError('');
    try {
      const c = comment.trim() || undefined;
      if (action === 'approve') await approveReviewByApi(review.id, c);
      else await rejectReviewByApi(review.id, c);
      onActionDone();
    } catch (e) {
      setError(parseError(e));
      setActing(false);
    }
  };

  const handleLocate = useCallback((entry: ChangeEntry) => {
    // 复用 ViewerCanvas 的 highlightedInstanceId 做脉冲+居中定位
    setFocusId(null);
    setTimeout(() => setFocusId(entry.focusInstanceId), 0);
  }, []);

  const badge = (kind: ChangeEntry['kind']) => (kind === 'added' ? '+' : kind === 'removed' ? '−' : '~');

  return (
    <div className="review-compare">
      <div className="review-compare-head">
        <button className="btn btn-sm" onClick={onBack}>← 返回列表</button>
        <strong>图纸 #{review.diagramId.slice(0, 8)}</strong>
        <span>提交人 {review.submitterId.slice(0, 8)}</span>
        <span>提交于 {new Date(review.submittedAt).toLocaleString()}</span>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {loading ? (
        <div className="review-compare-loading">加载对比数据...</div>
      ) : (
        <>
          <div className="review-compare-panes">
            <div className="review-compare-pane">
              <div className="review-compare-pane-title">改动前</div>
              {isNewDiagram ? (
                <div className="review-compare-empty">🆕 新建图纸，无历史版本可对比</div>
              ) : before ? (
                <div className="review-compare-canvas">
                  <ViewerCanvas
                    instances={before.instances}
                    edges={before.edges}
                    viewMode="complete"
                    zoom={beforeZoom}
                    panX={beforePan.x}
                    panY={beforePan.y}
                    onSetZoom={setBeforeZoom}
                    onSetPan={(x, y) => setBeforePan({ x, y })}
                    selectedInstanceId={null}
                    onSelectInstance={() => {}}
                    diffHighlights={diff ? { instances: diff.beforeInstances, edges: diff.beforeEdges } : null}
                    highlightedInstanceId={focusId}
                  />
                </div>
              ) : (
                <div className="review-compare-empty">无法加载改动前数据</div>
              )}
            </div>
            <div className="review-compare-pane">
              <div className="review-compare-pane-title">改动后</div>
              {after ? (
                <div className="review-compare-canvas">
                  <ViewerCanvas
                    instances={after.instances}
                    edges={after.edges}
                    viewMode="complete"
                    zoom={afterZoom}
                    panX={afterPan.x}
                    panY={afterPan.y}
                    onSetZoom={setAfterZoom}
                    onSetPan={(x, y) => setAfterPan({ x, y })}
                    selectedInstanceId={null}
                    onSelectInstance={() => {}}
                    diffHighlights={diff ? { instances: diff.afterInstances, edges: diff.afterEdges } : null}
                    highlightedInstanceId={focusId}
                  />
                </div>
              ) : (
                <div className="review-compare-empty">无法加载改动后数据</div>
              )}
            </div>
          </div>

          <div className="review-compare-changes">
            <div className="review-compare-changes-title">变更清单（{diff?.changes.length ?? 0}）</div>
            {diff && diff.changes.length > 0 ? (
              <ul>
                {diff.changes.map((c) => (
                  <li
                    key={`${c.target}-${c.id}`}
                    className={`change-${c.kind}`}
                    onClick={() => handleLocate(c)}
                  >
                    <span className="change-badge">{badge(c.kind)}</span>
                    {c.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="review-compare-empty-sm">无拓扑变更</div>
            )}
          </div>

          {review.status === 'PENDING' && (
            <div className="review-compare-actions">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="审核意见（可选）"
              />
              <button className="btn btn-primary" disabled={acting} onClick={() => void handleAction('approve')}>
                通过
              </button>
              <button className="btn btn-danger" disabled={acting} onClick={() => void handleAction('reject')}>
                驳回
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 编译验证**

Run: `pnpm build`
Expected: 构建通过（此组件尚未被引用，仅验证类型正确）。

- [ ] **Step 3: 提交**

```bash
git add src/components/review/ReviewCompareView.tsx
git commit -m "feat: 新增 ReviewCompareView 全屏前后对比组件"
```

---

## Task 5: 改造 DiagramReviewPage

**Files:**
- Modify: `src/pages/DiagramReviewPage.tsx`（整体重写）

- [ ] **Step 1: 重写页面**

把 `src/pages/DiagramReviewPage.tsx` 全部内容替换为：
```tsx
import { useEffect, useState } from 'react';
import {
  fetchReviewQueue,
  type ReviewFilterStatus,
  type ReviewQueueItem,
  type ReviewStatus,
} from '../services/reviewApi';
import ReviewCompareView from '../components/review/ReviewCompareView';
import { parseError } from '../utils/parseError';

export default function DiagramReviewPage() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [status, setStatus] = useState<ReviewFilterStatus>('PENDING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const s = status === 'ALL' ? undefined : (status as ReviewStatus);
      const result = await fetchReviewQueue({ status: s, page: 1, pageSize: 50 });
      setItems(result.items);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  if (selected) {
    return (
      <div className="workspace-page">
        <ReviewCompareView
          review={selected}
          onBack={() => setSelected(null)}
          onActionDone={() => {
            setSelected(null);
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸审核</h3>
        <div className="page-actions">
          <select value={status} onChange={(e) => setStatus(e.target.value as ReviewFilterStatus)}>
            <option value="PENDING">待审核</option>
            <option value="APPROVED">已通过</option>
            <option value="REJECTED">已驳回</option>
            <option value="ALL">全部</option>
          </select>
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="review-list">
        {items.map((item) => (
          <div key={item.id} className="review-row">
            <div className="review-row-main">
              <strong>图纸 #{item.diagramId.slice(0, 8)}</strong>
              <span className={`review-status ${item.status.toLowerCase()}`}>{item.status}</span>
            </div>
            <div className="review-row-meta">
              <span>提交人 {item.submitterId.slice(0, 8)}</span>
              <span>提交 {new Date(item.submittedAt).toLocaleString()}</span>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setSelected(item)}>
              查看对比 →
            </button>
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="empty-hint">暂无审核数据</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 编译 + lint 验证**

Run: `pnpm build && pnpm lint`
Expected: 构建通过、无 ESLint 错误（旧的 `ViewerCanvas`/`fetchDiagramTopology`/`approveReviewByApi`/`rejectReviewByApi` 导入已不在本文件，无未使用变量告警）。

- [ ] **Step 3: 提交**

```bash
git add src/pages/DiagramReviewPage.tsx
git commit -m "feat: 审核页改为列表每图一行 + 全屏对比入口"
```

---

## Task 6: 对比视图样式 + 全量验证

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: 追加样式**

在 `src/App.css` 文件**末尾**追加：
```css
/* ===== 审核列表行 ===== */
.review-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  padding: 10px 12px;
}
.review-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.review-row-meta {
  display: flex;
  gap: 14px;
  color: var(--gray-500);
  font-size: 12px;
}

/* ===== 审核对比视图 ===== */
.review-compare {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}
.review-compare-head {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  color: var(--gray-600);
}
.review-compare-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--gray-500);
}
.review-compare-panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex: 1;
  min-height: 360px;
}
.review-compare-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  overflow: hidden;
}
.review-compare-pane-title {
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 600;
  background: var(--gray-25);
  border-bottom: 1px solid var(--gray-200);
}
.review-compare-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}
.review-compare-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--gray-400);
  font-size: 13px;
}
.review-compare-changes {
  max-height: 200px;
  overflow: auto;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius);
  padding: 8px 10px;
}
.review-compare-changes-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.review-compare-changes ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.review-compare-changes li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
}
.review-compare-changes li:hover {
  background: var(--gray-50);
}
.review-compare-changes .change-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-weight: 700;
  color: #fff;
}
.change-added .change-badge { background: #22c55e; }
.change-removed .change-badge { background: #ef4444; }
.change-changed .change-badge { background: #eab308; }
.review-compare-empty-sm {
  color: var(--gray-400);
  font-size: 13px;
}
.review-compare-actions {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
}
```

- [ ] **Step 2: 全量验证**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: 测试 5 通过、构建通过、lint 无错误。

- [ ] **Step 3: 手动验收（`pnpm tauri dev`）**

逐项确认：
1. 用一张已发布图纸，编辑（新增/删除/移动元件、改一条连线线型）后提交审核 → 审核页待审列表每图一行；点"查看对比 →"进全屏：左=改动前、右=改动后，删除标左红、新增标右绿、改动两侧黄；下方变更清单条目正确；点清单项时对应画布元件脉冲高亮并居中。
2. 新建一张全新图纸首次提交审核 → 左侧显示"🆕 新建图纸，无历史版本可对比"，右侧正常展示。
3. 在对比视图点"通过"/"驳回" → 返回列表且状态流转与现状一致（通过后图纸 PUBLISHED、被审版本 ONLINE）。
4. 切到"已通过/已驳回"过滤 → 仍可点击查看对比，且不显示通过/驳回按钮（仅 PENDING 显示）。

- [ ] **Step 4: 提交**

```bash
git add src/App.css
git commit -m "style: 审核对比视图样式"
```

---

## 验收标准（整体）

- `pnpm test` 5 个 diff 单测通过。
- `pnpm build` 与 `pnpm lint` 无错误。
- 手动验收 4 项全部符合预期。
- 全程未新增/修改任何 Rust 命令（仅前端 + 一处前端类型补全）。
