import { useState, useEffect, useRef } from 'react';
import type { ElectricalComponent, ShapeElement, Connection } from '../../types';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import CollapsibleSection from './CollapsibleSection';

interface Props {
  component: ElectricalComponent;
}

export default function ConnectivityMatrixPanel({ component: comp }: Props) {
  const { matrices, cycleCellState, toggleConnectionState, toggleConnectionVisible } = useConnectionStore();
  const matrix = matrices[comp.id];
  const connections = matrix?.connections ?? [];
  const pins = comp.pins;
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, []);

  const getConnection = (pinAId: string, pinBId: string) => {
    return connections.find(
      (c) =>
        (c.pinAId === pinAId && c.pinBId === pinBId) ||
        (c.pinAId === pinBId && c.pinBId === pinAId)
    );
  };

  const handleAnimateAll = () => {
    for (const conn of connections) {
      toggleConnectionState(comp.id, conn.id);
      const t = setTimeout(() => {
        toggleConnectionState(comp.id, conn.id);
      }, conn.animationDuration + 200);
      timeoutsRef.current.push(t);
    }
  };

  return (
    <CollapsibleSection title="连通矩阵">
      {pins.length < 2 ? (
        <div style={{ color: 'var(--color-text-dim)', fontSize: 12, textAlign: 'center', padding: 10 }}>
          至少需要 2 个引脚才能定义连通关系
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="matrix-table">
              <thead>
                <tr>
                  <th></th>
                  {pins.map((p) => (
                    <th key={p.id}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pins.map((rowPin) => (
                  <tr key={rowPin.id}>
                    <th>{rowPin.label}</th>
                    {pins.map((colPin) => {
                      const isSelf = rowPin.id === colPin.id;
                      const conn = isSelf ? undefined : getConnection(rowPin.id, colPin.id);

                      let cellClass = 'matrix-cell none';
                      let cellText = '-';

                      if (isSelf) {
                        cellClass = 'matrix-cell';
                        cellText = '';
                      } else if (conn && conn.state !== 'none') {
                        cellClass = `matrix-cell ${conn.state}`;
                        cellText = conn.state === 'closed' ? '通' : '断';
                      }

                      return (
                        <td
                          key={colPin.id}
                          className={cellClass}
                          onClick={() => !isSelf && cycleCellState(comp.id, rowPin.id, colPin.id)}
                        >
                          {cellText}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="matrix-legend">
            <div className="legend-item">
              <div className="legend-dot" style={{ background: 'var(--color-closed)' }} />
              闭合
            </div>
            <div className="legend-item">
              <div className="legend-dot" style={{ background: 'var(--color-open)' }} />
              断开
            </div>
            <div className="legend-item">
              <div className="legend-dot" style={{ background: 'var(--color-border)' }} />
              无连接
            </div>
          </div>

          {connections.some((c) => c.state !== 'none') && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-dim)', marginBottom: 6 }}>
                连接详情
              </div>
              {connections.filter((c) => c.state !== 'none').map((conn) => (
                <ConnectionDetail
                  key={conn.id}
                  comp={comp}
                  conn={conn}
                  pins={pins}
                  onToggleState={() => {
                    const nextState = conn.state === 'closed' ? 'open' as const : 'closed' as const;
                    useConnectionStore.getState().setConnectionState(comp.id, conn.id, nextState);
                  }}
                  onToggleVisible={() => toggleConnectionVisible(comp.id, conn.id)}
                />
              ))}
            </div>
          )}

          {connections.some((c) => c.state !== 'none') && (
            <div className="animation-controls">
              <button className="btn btn-sm" onClick={handleAnimateAll}>
                播放开断动画
              </button>
            </div>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

function ConnectionDetail({
  comp,
  conn,
  pins,
  onToggleState,
  onToggleVisible,
}: {
  comp: ElectricalComponent;
  conn: Connection;
  pins: { id: string; label: string }[];
  onToggleState: () => void;
  onToggleVisible: () => void;
}) {
  const [showShapes, setShowShapes] = useState(false);
  const updateShapeElement = useComponentStore((s) => s.updateShapeElement);

  const pinA = pins.find((p) => p.id === conn.pinAId);
  const pinB = pins.find((p) => p.id === conn.pinBId);

  const linkedShapes = comp.shapeElements.filter((s) => s.linkedConnectionId === conn.id);

  return (
    <div className="conn-detail-item">
      <div className="conn-detail-row">
        <span className="pin-label">{pinA?.label}</span>
        <span style={{ color: 'var(--color-text-dim)' }}>→</span>
        <span className="pin-label">{pinB?.label}</span>

        <div className="toggle-wrap" onClick={onToggleState}>
          <div className={`toggle ${conn.state === 'closed' ? 'active' : ''}`} />
          <span style={{ fontSize: 11 }}>{conn.state === 'closed' ? '闭合' : '断开'}</span>
        </div>

        <div className="toggle-wrap" onClick={onToggleVisible} title={conn.visible ? '隐藏连线' : '显示连线'}>
          <span style={{ fontSize: 14, cursor: 'pointer' }}>{conn.visible ? '👁' : '🚫'}</span>
        </div>

        <button
          className="btn btn-sm"
          style={{ marginLeft: 'auto', fontSize: 10, padding: '1px 6px' }}
          onClick={() => setShowShapes(!showShapes)}
          title="关联图形"
        >
          图形 {linkedShapes.length > 0 ? `(${linkedShapes.length})` : ''}
        </button>
      </div>

      {showShapes && (
        <div style={{ marginTop: 6 }}>
          <ShapeLinkSection comp={comp} connId={conn.id} shapes={comp.shapeElements} onUpdate={updateShapeElement} />
        </div>
      )}
    </div>
  );
}

function ShapeLinkSection({
  comp,
  connId,
  shapes,
  onUpdate,
}: {
  comp: ElectricalComponent;
  connId: string;
  shapes: ShapeElement[];
  onUpdate: (cid: string, sid: string, u: Partial<ShapeElement>) => void;
}) {
  const shapeLabelMap = buildShapeLabelMap(shapes);
  const flashShapes = useCanvasStore((s) => s.flashShapes);
  const selectShape = useCanvasStore((s) => s.selectShape);
  const setHoveredShapes = useCanvasStore((s) => s.setHoveredShapes);
  const clearHoveredShapes = useCanvasStore((s) => s.clearHoveredShapes);
  const linked = shapes.filter((s) => s.linkedConnectionId === connId);
  const unlinked = shapes.filter((s) => s.linkedConnectionId !== connId);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const linkShape = (shapeId: string) => {
    onUpdate(comp.id, shapeId, { linkedConnectionId: connId });
  };

  const unlinkShape = (shapeId: string) => {
    onUpdate(comp.id, shapeId, {
      linkedConnectionId: undefined,
      stateClosed: undefined,
      stateOpen: undefined,
    });
  };

  return (
    <div style={{ paddingLeft: 8, borderLeft: '2px solid var(--color-border)' }}>
      {linked.map((shape) => (
        <div key={shape.id} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span
              style={{ fontSize: 10, color: 'var(--color-text-dim)', cursor: 'pointer' }}
              title="在画布中高亮"
              onMouseEnter={() => setHoveredShapes([shape.id])}
              onMouseLeave={clearHoveredShapes}
              onClick={() => {
                selectShape(shape.id);
                flashShapes([shape.id], 1600);
              }}
            >
              {shapeLabelMap.get(shape.id) ?? shape.type}
            </span>
            <button className="btn btn-sm" style={{ fontSize: 9, padding: '0 4px' }} onClick={() => unlinkShape(shape.id)}>
              取消关联
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <OverrideEditor
              label="闭合"
              color="#22c55e"
              overrideKey="stateClosed"
              shape={shape}
              compId={comp.id}
              onUpdate={onUpdate}
            />
            <OverrideEditor
              label="断开"
              color="#f97316"
              overrideKey="stateOpen"
              shape={shape}
              compId={comp.id}
              onUpdate={onUpdate}
            />
          </div>
        </div>
      ))}

      {unlinked.length > 0 && (
        <div ref={dropdownRef} style={{ marginTop: 4, position: 'relative' }}>
          <button
            className="btn btn-sm"
            onClick={() => setIsOpen(!isOpen)}
            style={{ fontSize: 10, width: '100%', textAlign: 'left' }}
          >
            + 关联图形 {isOpen ? '▲' : '▼'}
          </button>
          {isOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 100,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-border, #d0d0d0)',
                borderRadius: 4,
                maxHeight: 160,
                overflowY: 'auto',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
            >
              {unlinked.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: '3px 8px',
                    fontSize: 10,
                    cursor: 'pointer',
                    color: 'var(--color-text, #333)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--color-active-bg, #eef2ff)';
                    setHoveredShapes([s.id]);
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    clearHoveredShapes();
                  }}
                  onClick={() => {
                    selectShape(s.id);
                    flashShapes([s.id], 1600);
                    linkShape(s.id);
                    setIsOpen(false);
                  }}
                >
                  {shapeLabelMap.get(s.id) ?? s.type}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildShapeLabelMap(shapes: ShapeElement[]): Map<string, string> {
  const counters: Record<string, number> = {};
  const map = new Map<string, string>();

  shapes.forEach((shape) => {
    counters[shape.type] = (counters[shape.type] ?? 0) + 1;
    const idx = counters[shape.type];
    const typeName = getShapeTypeName(shape.type);
    map.set(shape.id, `${typeName}${idx}`);
  });

  return map;
}

function getShapeTypeName(type: ShapeElement['type']): string {
  switch (type) {
    case 'rect':
      return '矩形';
    case 'circle':
      return '圆形';
    case 'ellipse':
      return '椭圆';
    case 'line':
      return '线段';
    case 'path':
      return '路径';
    default:
      return '图形';
  }
}

type OverrideKey = 'stateClosed' | 'stateOpen';
type ShapeOverride = Partial<ShapeElement>;

function updateOverride(
  compId: string,
  shapeId: string,
  key: OverrideKey,
  field: string,
  value: string | number | undefined,
  shape: ShapeElement,
  onUpdate: (cid: string, sid: string, u: Partial<ShapeElement>) => void
) {
  const prev = (shape[key] ?? {}) as ShapeOverride;
  const next = { ...prev } as Record<string, unknown>;

  if (value === undefined || value === '') {
    delete next[field];
  } else {
    next[field] = value;
  }

  const cleaned = Object.keys(next).length > 0 ? next : undefined;
  onUpdate(compId, shapeId, { [key]: cleaned as ShapeOverride });
}

function OverrideEditor({
  label,
  color,
  overrideKey,
  shape,
  compId,
  onUpdate,
}: {
  label: string;
  color: string;
  overrideKey: OverrideKey;
  shape: ShapeElement;
  compId: string;
  onUpdate: (cid: string, sid: string, u: Partial<ShapeElement>) => void;
}) {
  const ov = (shape[overrideKey] ?? {}) as ShapeOverride;
  const set = (field: string, value: string | number | undefined) =>
    updateOverride(compId, shape.id, overrideKey, field, value, shape, onUpdate);
  const isFillTransparent = ov.fill === 'transparent';
  const fillColorForInput =
    (typeof ov.fill === 'string' && ov.fill !== 'transparent' ? ov.fill : undefined) ??
    (shape.fill !== 'transparent' ? shape.fill : '#ffffff');

  return (
    <div className="state-override-panel" style={{ borderLeftColor: color, flex: 1 }}>
      <div className="state-override-title" style={{ color }}>{label}</div>
      <div className="state-row">
        <label className="state-field">
          <span>填充</span>
          <input type="color" value={fillColorForInput} onChange={(e) => set('fill', e.target.value)} disabled={isFillTransparent} style={isFillTransparent ? { opacity: 0.4 } : undefined} />
          <button
            className="btn btn-sm"
            type="button"
            title={isFillTransparent ? '取消透明' : '填充透明'}
            style={{
              padding: '0 6px', lineHeight: 1.4,
              background: isFillTransparent ? 'var(--color-active)' : undefined,
              color: isFillTransparent ? '#fff' : undefined,
            }}
            onClick={() => set('fill', isFillTransparent ? undefined : 'transparent')}
          >
            {isFillTransparent ? '已透明' : '透明'}
          </button>
        </label>
        <label className="state-field">
          <span>描边</span>
          <input type="color" value={(ov.stroke as string) ?? shape.stroke ?? '#e0e0e0'} onChange={(e) => set('stroke', e.target.value)} />
        </label>
        <label className="state-field">
          <span>粗细</span>
          <input
            type="number"
            min={1}
            max={20}
            value={(ov.strokeWidth as number) ?? shape.strokeWidth ?? ''}
            onChange={(e) => set('strokeWidth', e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
        <label className="state-field">
          <span>透明</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={(ov.opacity as number) ?? shape.opacity ?? ''}
            onChange={(e) => set('opacity', e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
      </div>
      {shape.type === 'line' ? (
        <>
          <div className="state-row">
            <label className="state-field">
              <span>X1</span>
              <input
                type="number"
                value={(ov.x1 as number) ?? shape.x1 ?? ''}
                onChange={(e) => set('x1', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
            <label className="state-field">
              <span>X2</span>
              <input
                type="number"
                value={(ov.x2 as number) ?? shape.x2 ?? ''}
                onChange={(e) => set('x2', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
          </div>
          <div className="state-row">
            <label className="state-field">
              <span>Y1</span>
              <input
                type="number"
                value={(ov.y1 as number) ?? shape.y1 ?? ''}
                onChange={(e) => set('y1', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
            <label className="state-field">
              <span>Y2</span>
              <input
                type="number"
                value={(ov.y2 as number) ?? shape.y2 ?? ''}
                onChange={(e) => set('y2', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
          </div>
        </>
      ) : shape.type === 'rect' ? (
        <div className="state-row">
          <label className="state-field">
            <span>宽</span>
            <input
              type="number"
              value={(ov.width as number) ?? shape.width ?? ''}
              onChange={(e) => set('width', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </label>
          <label className="state-field">
            <span>高</span>
            <input
              type="number"
              value={(ov.height as number) ?? shape.height ?? ''}
              onChange={(e) => set('height', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
