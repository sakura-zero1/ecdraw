import type { ElectricalComponent, ShapeElement } from '../../types';
import { useComponentStore } from '../../stores/useComponentStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { CATEGORY_LABELS, CATEGORIES } from '../../constants/categories';
import { useMemo } from 'react';

interface Props {
  component: ElectricalComponent;
}

export default function PropertyPanel({ component }: Props) {
  const updateComponent = useComponentStore((s) => s.updateComponent);
  const updateShapeElement = useComponentStore((s) => s.updateShapeElement);
  const selectedShapeIds = useCanvasStore((s) => s.selectedShapeIds);
  const allComponents = useComponentStore((s) => s.components);

  const categoryOptions = useMemo(() => {
    const set = new Set(CATEGORIES);
    for (const c of allComponents) set.add(c.category);
    return [...set];
  }, [allComponents]);

  const selectedShape = selectedShapeIds.length === 1
    ? component.shapeElements.find((s) => s.id === selectedShapeIds[0])
    : null;

  const updateShape = (updates: Partial<ShapeElement>) => {
    if (!selectedShape) return;
    updateShapeElement(component.id, selectedShape.id, updates);
  };

  const num = (v: string) => {
    if (v === '') return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  return (
    <>
      <label>
        名称
        <input value={component.name} onChange={(e) => updateComponent(component.id, { name: e.target.value })} />
      </label>

      <label>
        分类
        <select
          value={component.category}
          onChange={(e) => updateComponent(component.id, { category: e.target.value as ElectricalComponent['category'] })}
        >
          {categoryOptions.map((cat) => (
            <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>
          ))}
        </select>
      </label>

      <label>
        描述
        <textarea value={component.description} onChange={(e) => updateComponent(component.id, { description: e.target.value })} rows={2} />
      </label>

      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>输出尺寸（配网图显示）</div>
        <div className="form-row">
          <label>
            宽
            <input
              type="number"
              min={40}
              max={1200}
              value={component.displayWidth ?? 140}
              onChange={(e) => updateComponent(component.id, { displayWidth: Number(e.target.value) || 0 })}
              onBlur={() => updateComponent(component.id, { displayWidth: Math.max(40, Math.min(1200, component.displayWidth ?? 140)) })}
            />
          </label>
          <label>
            高
            <input
              type="number"
              min={30}
              max={800}
              value={component.displayHeight ?? 90}
              onChange={(e) => updateComponent(component.id, { displayHeight: Number(e.target.value) || 0 })}
              onBlur={() => updateComponent(component.id, { displayHeight: Math.max(30, Math.min(800, component.displayHeight ?? 90)) })}
            />
          </label>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4 }}>
          画布下方显示 1:1 实际大小预览
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-dim)', marginTop: 4 }}>
        画布: {component.width} x {component.height} | 图形: {component.shapeElements.length} | 引脚: {component.pins.length}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 10, paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>选中图形参数</div>

        {selectedShapeIds.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>未选中图形</div>
        )}

        {selectedShapeIds.length > 1 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>已选中多个图形，请单选后编辑参数</div>
        )}

        {selectedShape && (
          <>
            <div className="form-row">
              <label>
                描边
                <input
                  type="color"
                  value={selectedShape.stroke ?? '#000000'}
                  onInput={(e) => updateShape({ stroke: (e.target as HTMLInputElement).value })}
                  onChange={(e) => updateShape({ stroke: e.target.value })}
                />
              </label>
              <label>
                填充
                <input
                  type="color"
                  value={selectedShape.fill === 'transparent' ? '#ffffff' : (selectedShape.fill ?? '#ffffff')}
                  onInput={(e) => updateShape({ fill: (e.target as HTMLInputElement).value })}
                  onChange={(e) => updateShape({ fill: e.target.value })}
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                粗细
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={selectedShape.strokeWidth ?? 1}
                  onChange={(e) => updateShape({ strokeWidth: Number(e.target.value) })}
                />
              </label>
              <label>
                透明
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={selectedShape.opacity ?? 1}
                  onChange={(e) => updateShape({ opacity: Number(e.target.value) })}
                />
              </label>
            </div>

            {selectedShape.type === 'rect' && (
              <div className="form-row">
                <label>X<input type="number" value={selectedShape.x ?? 0} onChange={(e) => updateShape({ x: num(e.target.value) })} /></label>
                <label>Y<input type="number" value={selectedShape.y ?? 0} onChange={(e) => updateShape({ y: num(e.target.value) })} /></label>
                <label>宽<input type="number" value={selectedShape.width ?? 0} onChange={(e) => updateShape({ width: Math.max(1, Number(e.target.value)) })} /></label>
                <label>高<input type="number" value={selectedShape.height ?? 0} onChange={(e) => updateShape({ height: Math.max(1, Number(e.target.value)) })} /></label>
              </div>
            )}

            {selectedShape.type === 'circle' && (
              <div className="form-row">
                <label>CX<input type="number" value={selectedShape.cx ?? 0} onChange={(e) => updateShape({ cx: num(e.target.value) })} /></label>
                <label>CY<input type="number" value={selectedShape.cy ?? 0} onChange={(e) => updateShape({ cy: num(e.target.value) })} /></label>
                <label>R<input type="number" value={selectedShape.r ?? 1} onChange={(e) => updateShape({ r: Math.max(1, Number(e.target.value)) })} /></label>
              </div>
            )}

            {selectedShape.type === 'ellipse' && (
              <div className="form-row">
                <label>CX<input type="number" value={selectedShape.cx ?? 0} onChange={(e) => updateShape({ cx: num(e.target.value) })} /></label>
                <label>CY<input type="number" value={selectedShape.cy ?? 0} onChange={(e) => updateShape({ cy: num(e.target.value) })} /></label>
                <label>RX<input type="number" value={selectedShape.rx ?? 1} onChange={(e) => updateShape({ rx: Math.max(1, Number(e.target.value)) })} /></label>
                <label>RY<input type="number" value={selectedShape.ry ?? 1} onChange={(e) => updateShape({ ry: Math.max(1, Number(e.target.value)) })} /></label>
              </div>
            )}

            {selectedShape.type === 'line' && (
              <div className="form-row">
                <label>X1<input type="number" value={selectedShape.x1 ?? 0} onChange={(e) => updateShape({ x1: num(e.target.value) })} /></label>
                <label>Y1<input type="number" value={selectedShape.y1 ?? 0} onChange={(e) => updateShape({ y1: num(e.target.value) })} /></label>
                <label>X2<input type="number" value={selectedShape.x2 ?? 0} onChange={(e) => updateShape({ x2: num(e.target.value) })} /></label>
                <label>Y2<input type="number" value={selectedShape.y2 ?? 0} onChange={(e) => updateShape({ y2: num(e.target.value) })} /></label>
              </div>
            )}

            {selectedShape.type === 'text' && (
              <>
                <label>
                  文字内容
                  <textarea
                    value={selectedShape.text ?? ''}
                    onChange={(e) => updateShape({ text: e.target.value })}
                    rows={2}
                    style={{ resize: 'vertical' }}
                  />
                </label>
                <div className="form-row">
                  <label>
                    字号
                    <input
                      type="number"
                      min={8}
                      max={120}
                      value={selectedShape.fontSize ?? 16}
                      onChange={(e) => updateShape({ fontSize: Math.max(8, Number(e.target.value)) })}
                    />
                  </label>
                  <label>
                    粗细
                    <select
                      value={selectedShape.fontWeight ?? 'normal'}
                      onChange={(e) => updateShape({ fontWeight: e.target.value })}
                    >
                      <option value="normal">常规</option>
                      <option value="bold">粗体</option>
                      <option value="lighter">细体</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    对齐
                    <select
                      value={selectedShape.textAlign ?? 'left'}
                      onChange={(e) => updateShape({ textAlign: e.target.value as CanvasTextAlign })}
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>X<input type="number" value={selectedShape.x ?? 0} onChange={(e) => updateShape({ x: num(e.target.value) })} /></label>
                  <label>Y<input type="number" value={selectedShape.y ?? 0} onChange={(e) => updateShape({ y: num(e.target.value) })} /></label>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
