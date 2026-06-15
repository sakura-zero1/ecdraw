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
