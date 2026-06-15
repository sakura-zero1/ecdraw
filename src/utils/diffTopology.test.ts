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
