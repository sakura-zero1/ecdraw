import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import type { ToolMode } from '../../types';
import './ShapeToolbar.css';

const TOOLS: { mode: ToolMode; icon: string; label: string }[] = [
  { mode: 'select', icon: '↖', label: '选择' },
  { mode: 'draw-rect', icon: '▭', label: '矩形' },
  { mode: 'draw-circle', icon: '◯', label: '圆形' },
  { mode: 'draw-ellipse', icon: '⬭', label: '椭圆' },
  { mode: 'draw-line', icon: '╱', label: '线段' },
];

export default function ShapeToolbar() {
  const { activeTool, setActiveTool, defaultFill, defaultStroke, defaultStrokeWidth,
    setDefaultFill, setDefaultStroke, setDefaultStrokeWidth, selectedShapeIds } = useCanvasStore();
  const {
    activeComponentId,
    removeShapeElement,
    getComponent,
    updateShapeElement,
    groupShapeElements,
    ungroupShapeElements,
  } = useComponentStore();

  const selectedShapeId = selectedShapeIds[0] ?? null;
  const selectedShape = activeComponentId && selectedShapeId
    ? getComponent(activeComponentId)?.shapeElements.find(e => e.id === selectedShapeId)
    : null;
  const currentFillColor =
    selectedShape?.fill && selectedShape.fill !== 'transparent' && selectedShape.fill !== 'none'
      ? selectedShape.fill
      : defaultFill !== 'transparent' && defaultFill !== 'none'
        ? defaultFill
        : '#ffffff';

  const applyToSelected = (updates: Record<string, unknown>) => {
    if (!activeComponentId || selectedShapeIds.length === 0) return;
    for (const sid of selectedShapeIds) {
      updateShapeElement(activeComponentId, sid, updates);
    }
  };

  const handleDelete = () => {
    if (activeComponentId && selectedShapeIds.length > 0) {
      for (const sid of [...selectedShapeIds]) {
        removeShapeElement(activeComponentId, sid);
      }
      useCanvasStore.getState().selectShape(null);
    }
  };

  const handleGroup = () => {
    if (!activeComponentId || selectedShapeIds.length < 2) return;
    groupShapeElements(activeComponentId, selectedShapeIds);
  };

  const handleUngroup = () => {
    if (!activeComponentId || selectedShapeIds.length === 0) return;
    ungroupShapeElements(activeComponentId, selectedShapeIds);
  };

  const applyFill = (color: string) => {
    setDefaultFill(color);
    applyToSelected({ fill: color });
  };

  const applyStroke = (color: string) => {
    setDefaultStroke(color);
    applyToSelected({ stroke: color });
  };

  const applyStrokeWidth = (w: number) => {
    setDefaultStrokeWidth(w);
    applyToSelected({ strokeWidth: w });
  };

  const handleFillInput = (value: string) => {
    applyFill(value);
  };

  const handleStrokeInput = (value: string) => {
    applyStroke(value);
  };

  return (
    <div className="shape-toolbar">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.mode}
            className={`tool-btn ${activeTool === t.mode ? 'active' : ''}`}
            onClick={() => setActiveTool(t.mode)}
            title={t.label}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="tool-divider" />

      <div className="tool-group colors">
        <label className="color-field">
          <span className="color-label">填充</span>
          <input
            type="color"
            value={currentFillColor}
            onInput={(e) => handleFillInput((e.target as HTMLInputElement).value)}
            onChange={(e) => handleFillInput(e.target.value)}
          />
          <button className="color-transparent" title="透明" onClick={() => applyFill('transparent')}>Ø</button>
        </label>
        <label className="color-field">
          <span className="color-label">描边</span>
          <input
            type="color"
            value={selectedShape?.stroke ?? defaultStroke}
            onInput={(e) => handleStrokeInput((e.target as HTMLInputElement).value)}
            onChange={(e) => handleStrokeInput(e.target.value)}
          />
        </label>
        <label className="color-field">
          <span className="color-label">粗细</span>
          <input
            type="number"
            min={1} max={20}
            value={selectedShape?.strokeWidth ?? defaultStrokeWidth}
            onChange={(e) => applyStrokeWidth(Number(e.target.value))}
            style={{ width: 48 }}
          />
        </label>
      </div>

      <div className="tool-divider" />
      <div className="tool-group">
        <button className="tool-btn" onClick={handleGroup} disabled={selectedShapeIds.length < 2} title="组合 (Ctrl/Cmd+G)">
          <span className="tool-icon">⊞</span>
          <span className="tool-label">组合</span>
        </button>
        <button className="tool-btn" onClick={handleUngroup} disabled={selectedShapeIds.length === 0} title="解组 (Shift+Ctrl/Cmd+G)">
          <span className="tool-icon">⊟</span>
          <span className="tool-label">解组</span>
        </button>
        <button className="tool-btn btn-danger" onClick={handleDelete} disabled={selectedShapeIds.length === 0} title="删除选中图形">
          <span className="tool-icon">✕</span>
          <span className="tool-label">删除</span>
        </button>
      </div>
    </div>
  );
}
