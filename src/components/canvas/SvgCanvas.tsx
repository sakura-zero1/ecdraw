import { useRef, useCallback, useEffect, useState } from 'react';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import type { ShapeElement, ElectricalComponent, Pin } from '../../types';
import { computeLinePath } from '../../utils/geometry';
import { getShapeBounds } from '../../utils/alignment';
import ShapeToolbar from './ShapeToolbar';
import AlignmentToolbar from './AlignmentToolbar';
import './SvgCanvas.css';

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 800;
const SNAP_THRESHOLD = 5;

export default function SvgCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const { activeTool, setActiveTool, selectShape, selectPin } = useCanvasStore();
  const { components, activeComponentId, addShapeElement, updateShapeElement, updatePin, pushUndo } = useComponentStore();
  const matrices = useConnectionStore((s) => s.matrices);

  const [drawing, setDrawing] = useState<{
    startX: number;
    startY: number;
    preview?: ShapeElement;
  } | null>(null);

  const [dragState, setDragState] = useState<{
    type: 'shape' | 'pin' | 'handle';
    id: string;
    handle?: string;
    shapeType?: ShapeElement['type'];
    startCanvasX: number;
    startCanvasY: number;
    origData: Record<string, number>;
    shapeIds?: string[];
    shapeOrigMap?: Record<string, Record<string, number>>;
  } | null>(null);

  const [rubberBand, setRubberBand] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [snapPreview, setSnapPreview] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false);
    };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const activeComp = components.find((c) => c.id === activeComponentId);
  const canvasWidth = activeComp?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = activeComp?.height ?? DEFAULT_CANVAS_HEIGHT;

  const getSvgPos = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!svgRef.current) return { x: 0, y: 0 };
      const svg = svgRef.current;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const local = point.matrixTransform(ctm.inverse());
      const x = Math.round(local.x);
      const y = Math.round(local.y);
      return {
        x: Math.max(0, Math.min(canvasWidth, x)),
        y: Math.max(0, Math.min(canvasHeight, y)),
      };
    },
    [canvasWidth, canvasHeight]
  );

  const isDrawTool = activeTool.startsWith('draw-');
  const effectiveSelect = activeTool === 'select' || altHeld;
  const cursor = isDrawTool ? 'crosshair' : activeTool === 'select' ? 'default' : 'grab';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const { selectedShapeIds } = useCanvasStore.getState();
      const store = useComponentStore.getState();
      const compId = store.activeComponentId;
      const lower = e.key.toLowerCase();
      const hasMod = e.ctrlKey || e.metaKey;
      const matchKey = (code: string, key: string) => e.code === code || lower === key;

      // Tool shortcuts
      if (!hasMod && !e.altKey) {
        if (matchKey('KeyQ', 'q')) { e.preventDefault(); setActiveTool('select'); return; }
        if (matchKey('KeyA', 'a')) { e.preventDefault(); setActiveTool('draw-rect'); return; }
        if (matchKey('KeyS', 's')) { e.preventDefault(); setActiveTool('draw-circle'); return; }
        if (matchKey('KeyD', 'd')) { e.preventDefault(); setActiveTool('draw-ellipse'); return; }
        if (matchKey('KeyF', 'f')) { e.preventDefault(); setActiveTool('draw-line'); return; }
        if (e.key === 'Escape') {
          e.preventDefault();
          useCanvasStore.getState().clearSelection();
          return;
        }
      }

      // Group / ungroup
      if (hasMod && lower === 'g' && compId) {
        e.preventDefault();
        if (e.shiftKey) {
          store.ungroupShapeElements(compId, selectedShapeIds);
        } else {
          store.groupShapeElements(compId, selectedShapeIds);
        }
        return;
      }

      if (hasMod && lower === 'd' && compId) {
        e.preventDefault();
        const nextIds: string[] = [];
        for (const sid of selectedShapeIds) {
          const newId = store.cloneShapeElement(compId, sid);
          if (newId) nextIds.push(newId);
        }
        if (nextIds.length > 0) {
          useCanvasStore.getState().selectShape(null);
          nextIds.forEach((id) => useCanvasStore.getState().selectShape(id, true));
        }
        return;
      }

      if (hasMod && lower === 'c') {
        if (selectedShapeIds.length > 0 && compId) {
          const comp = store.getComponent(compId);
          const el = comp?.shapeElements.find((s) => s.id === selectedShapeIds[0]);
          if (el) {
            e.preventDefault();
            useCanvasStore.getState().setClipboard({ ...el });
          }
        }
        return;
      }

      if (hasMod && lower === 'v') {
        e.preventDefault();
        const clip = useCanvasStore.getState().clipboard;
        if (clip && compId) {
          const newId = store.cloneFromClipboard(compId, clip);
          if (newId) selectShape(newId);
        }
        return;
      }

      if (hasMod && lower === 'z') {
        e.preventDefault();
        store.undo();
        selectShape(null);
        return;
      }

      if ((hasMod && lower === 'x') || e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedShapeIds.length > 0 && compId) {
          for (const sid of selectedShapeIds) {
            store.removeShapeElement(compId, sid);
          }
          selectShape(null);
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [selectShape, setActiveTool]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as SVGElement;
      const hitShapeId = target.getAttribute('data-shape-id');
      const hitPinId = target.getAttribute('data-pin-id');
      const resizeShapeId = target.getAttribute('data-resize-shape-id');
      const resizeHandle = target.getAttribute('data-resize-handle');
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (resizeShapeId && resizeHandle && activeComp) {
        e.stopPropagation();
        e.preventDefault();
        const shape = activeComp.shapeElements.find((s) => s.id === resizeShapeId);
        if (!shape) return;
        const pos = getSvgPos(e);
        pushUndo();
        selectShape(resizeShapeId);
        setDragState({
          type: 'handle',
          id: resizeShapeId,
          shapeType: shape.type,
          handle: resizeHandle,
          startCanvasX: pos.x,
          startCanvasY: pos.y,
          origData: getShapeResizeData(shape),
        });
        return;
      }

      const canRubberBand =
        (activeTool === 'select' && !hitShapeId && !hitPinId) || ((ctrl || shift) && !hitShapeId && !hitPinId && activeComp);
      if (canRubberBand && activeComp) {
        e.preventDefault();
        const pos = getSvgPos(e);
        setRubberBand({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
        return;
      }

      if (hitPinId && activeComp && effectiveSelect) {
        e.stopPropagation();
        e.preventDefault();
        const pin = activeComp.pins.find((p) => p.id === hitPinId);
        if (pin) {
          if (ctrl || shift) {
            selectPin(hitPinId, true);
            return;
          }
          const pos = getSvgPos(e);
          pushUndo();
          selectPin(hitPinId);
          setDragState({
            type: 'pin',
            id: hitPinId,
            startCanvasX: pos.x,
            startCanvasY: pos.y,
            origData: { x: pin.position.x, y: pin.position.y },
          });
        }
        return;
      }

      if (hitShapeId && activeComp && effectiveSelect) {
        e.stopPropagation();
        e.preventDefault();
        const el = activeComp.shapeElements.find((s) => s.id === hitShapeId);
        if (el) {
          if (ctrl || shift) {
            selectShape(hitShapeId, true);
            return;
          }
          pushUndo();
          const groupIds = el.groupId
            ? activeComp.shapeElements.filter((s) => s.groupId === el.groupId).map((s) => s.id)
            : [hitShapeId];
          selectShape(null);
          for (const gid of groupIds) {
            selectShape(gid, true);
          }
          const shapeOrigMap: Record<string, Record<string, number>> = {};
          for (const sid of groupIds) {
            const shape = activeComp.shapeElements.find((s) => s.id === sid);
            if (shape) shapeOrigMap[sid] = getShapePosition(shape);
          }
          const pos = getSvgPos(e);
          setDragState({
            type: 'shape',
            id: hitShapeId,
            startCanvasX: pos.x,
            startCanvasY: pos.y,
            origData: getShapePosition(el),
            shapeIds: groupIds,
            shapeOrigMap,
          });
        }
        return;
      }

      if (isDrawTool && !altHeld && !ctrl && activeComp) {
        const pos = getSvgPos(e);
        setDrawing({ startX: pos.x, startY: pos.y });
      }

      if (effectiveSelect && !hitShapeId && !hitPinId && !ctrl) {
        selectShape(null);
        selectPin(null);
      }
    },
    [activeComp, activeTool, isDrawTool, altHeld, effectiveSelect, getSvgPos, selectShape, selectPin, pushUndo]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (rubberBand) {
        const pos = getSvgPos(e);
        setRubberBand({ ...rubberBand, endX: pos.x, endY: pos.y });
        return;
      }

      if (dragState && activeComp) {
        const pos = getSvgPos(e);
        const dx = pos.x - dragState.startCanvasX;
        const dy = pos.y - dragState.startCanvasY;

        if (dragState.type === 'pin') {
          const rawPos = {
            x: Math.round(dragState.origData.x + dx),
            y: Math.round(dragState.origData.y + dy),
          };
          const snapped = getSnapPosition(rawPos, activeComp.shapeElements);
          setSnapPreview(snapped.snapped ? snapped.position : null);
          updatePin(activeComp.id, dragState.id, {
            position: snapped.position,
          });
        } else if (dragState.type === 'shape') {
          setSnapPreview(null);
          const shapeIds = dragState.shapeIds ?? [dragState.id];
          const shapeOrigMap = dragState.shapeOrigMap ?? { [dragState.id]: dragState.origData };
          for (const sid of shapeIds) {
            const orig = shapeOrigMap[sid];
            if (!orig) continue;
            applyShapeMove(activeComp.id, sid, orig, dx, dy, updateShapeElement);
          }
        } else if (dragState.type === 'handle' && dragState.shapeType && dragState.handle) {
          setSnapPreview(null);
          const resized = computeResizedShape(dragState.shapeType, dragState.handle, dragState.origData, dx, dy);
          updateShapeElement(activeComp.id, dragState.id, resized);
        }
        return;
      }

      if (!drawing || !activeComp) return;

      const pos = getSvgPos(e);
      const { startX, startY } = drawing;
      const { defaultFill, defaultStroke, defaultStrokeWidth } = useCanvasStore.getState();
      const shapeType = activeTool.replace('draw-', '') as ShapeElement['type'];

      let preview: ShapeElement;
      switch (shapeType) {
        case 'rect':
          preview = {
            id: '__preview__',
            type: 'rect',
            fill: defaultFill,
            stroke: defaultStroke,
            strokeWidth: defaultStrokeWidth,
            opacity: 0.6,
            x: Math.min(startX, pos.x),
            y: Math.min(startY, pos.y),
            width: Math.abs(pos.x - startX),
            height: Math.abs(pos.y - startY),
          };
          break;
        case 'circle': {
          const r = Math.round(Math.sqrt((pos.x - startX) ** 2 + (pos.y - startY) ** 2));
          preview = {
            id: '__preview__',
            type: 'circle',
            fill: defaultFill,
            stroke: defaultStroke,
            strokeWidth: defaultStrokeWidth,
            opacity: 0.6,
            cx: startX,
            cy: startY,
            r,
          };
          break;
        }
        case 'ellipse':
          preview = {
            id: '__preview__',
            type: 'ellipse',
            fill: defaultFill,
            stroke: defaultStroke,
            strokeWidth: defaultStrokeWidth,
            opacity: 0.6,
            cx: startX,
            cy: startY,
            rx: Math.abs(pos.x - startX),
            ry: Math.abs(pos.y - startY),
          };
          break;
        case 'line': {
          let ex = pos.x;
          let ey = pos.y;
          const dxy = Math.abs(pos.x - startX);
          const dyx = Math.abs(pos.y - startY);
          if (dxy < SNAP_THRESHOLD && dyx >= SNAP_THRESHOLD) ex = startX;
          else if (dyx < SNAP_THRESHOLD && dxy >= SNAP_THRESHOLD) ey = startY;
          preview = {
            id: '__preview__',
            type: 'line',
            fill: 'none',
            stroke: defaultStroke,
            strokeWidth: defaultStrokeWidth,
            opacity: 0.6,
            x1: startX,
            y1: startY,
            x2: ex,
            y2: ey,
          };
          break;
        }
        default:
          return;
      }

      setDrawing({ startX, startY, preview });
    },
    [rubberBand, dragState, drawing, activeComp, activeTool, getSvgPos, updatePin, updateShapeElement]
  );

  const handleMouseUp = useCallback(() => {
    if (rubberBand && activeComp) {
      const left = Math.min(rubberBand.startX, rubberBand.endX);
      const top = Math.min(rubberBand.startY, rubberBand.endY);
      const right = Math.max(rubberBand.startX, rubberBand.endX);
      const bottom = Math.max(rubberBand.startY, rubberBand.endY);

      selectShape(null);
      selectPin(null);
      if (right - left > 3 || bottom - top > 3) {
        const ids: string[] = [];
        for (const el of activeComp.shapeElements) {
          const b = getShapeBounds(el);
          if (b.cx >= left && b.cx <= right && b.cy >= top && b.cy <= bottom) {
            ids.push(el.id);
          }
        }
        for (const id of ids) {
          selectShape(id, true);
        }
      }
      setRubberBand(null);
      return;
    }

    if (dragState) {
      setSnapPreview(null);
      setDragState(null);
      return;
    }

    if (drawing?.preview && activeComp) {
      const el = drawing.preview;
      const tooSmall =
        (el.type === 'rect' && ((el.width ?? 0) < 3 || (el.height ?? 0) < 3)) ||
        (el.type === 'circle' && (el.r ?? 0) < 3) ||
        (el.type === 'ellipse' && ((el.rx ?? 0) < 3 || (el.ry ?? 0) < 3));

      if (!tooSmall) addShapeElement(activeComp.id, { ...el, opacity: 1 });
    }
    setSnapPreview(null);
    setDrawing(null);
  }, [rubberBand, dragState, drawing, activeComp, addShapeElement, selectShape, selectPin]);

  return (
    <div className="svg-canvas-container">
      <ShapeToolbar />
      <AlignmentToolbar />
      <svg
        ref={svgRef}
        className="svg-canvas"
        width="100%"
        height="100%"
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="transparent" stroke="#b8c9dc" strokeWidth={1} />
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d8e3ef" strokeWidth={0.8} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="url(#grid)" />

        {activeComp && (
          <>
            {activeComp.shapeElements.map((el) => {
              const connState = el.linkedConnectionId
                ? (matrices[activeComp.id]?.connections.find((c) => c.id === el.linkedConnectionId)?.state ?? '')
                : '';
              return <g key={`${el.id}-${connState}`}>{renderShapeElement(el, matrices, activeComp.id)}</g>;
            })}
            {drawing?.preview && renderPreviewElement(drawing.preview)}
            {rubberBand && (
              <rect
                x={Math.min(rubberBand.startX, rubberBand.endX)}
                y={Math.min(rubberBand.startY, rubberBand.endY)}
                width={Math.abs(rubberBand.endX - rubberBand.startX)}
                height={Math.abs(rubberBand.endY - rubberBand.startY)}
                fill="rgba(14,165,233,0.08)"
                stroke="#0ea5e9"
                strokeWidth={1}
                strokeDasharray="4,2"
                pointerEvents="none"
              />
            )}
            <ConnectionLines component={activeComp} />
            {activeComp.pins.map((pin) => (
              <PinPoint key={pin.id} pin={pin} />
            ))}
            {snapPreview && (
              <g pointerEvents="none">
                <circle cx={snapPreview.x} cy={snapPreview.y} r={6} fill="none" stroke="#0ea5e9" strokeWidth={1.2} />
                <line x1={snapPreview.x - 9} y1={snapPreview.y} x2={snapPreview.x + 9} y2={snapPreview.y} stroke="#0ea5e9" strokeWidth={1} />
                <line x1={snapPreview.x} y1={snapPreview.y - 9} x2={snapPreview.x} y2={snapPreview.y + 9} stroke="#0ea5e9" strokeWidth={1} />
              </g>
            )}
          </>
        )}

        {!activeComp && (
          <text x={canvasWidth / 2} y={canvasHeight / 2} textAnchor="middle" dominantBaseline="middle" fill="#9db0c4" fontSize={16}>
            请选择或新建一个元件
          </text>
        )}
      </svg>
    </div>
  );
}

const PIN_COLORS: Record<string, string> = {
  input: '#3b82f6',
  output: '#f97316',
  bidirectional: '#8b5cf6',
  power: '#eab308',
  ground: '#6b7280',
};

function PinPoint({ pin }: { pin: Pin }) {
  const selectedPinIds = useCanvasStore((s) => s.selectedPinIds);
  const isSelected = selectedPinIds.includes(pin.id);
  const color = PIN_COLORS[pin.pinType] || '#6b7280';

  return (
    <g>
      <circle
        cx={pin.position.x}
        cy={pin.position.y}
        r={isSelected ? 7 : 5}
        fill={color}
        stroke={isSelected ? '#fff' : 'transparent'}
        strokeWidth={2}
        data-pin-id={pin.id}
        style={{ cursor: 'pointer' }}
      />
      <text x={pin.position.x} y={pin.position.y - 10} textAnchor="middle" fill="#6b8095" fontSize={10} pointerEvents="none">
        {pin.label}
      </text>
    </g>
  );
}

function ConnectionLines({ component }: { component: ElectricalComponent }) {
  const matrix = useConnectionStore((s) => s.matrices[component.id]);
  const connections = matrix?.connections ?? [];
  const { selectedConnectionId, selectConnection } = useCanvasStore();

  return (
    <g>
      {connections.map((conn) => {
        if (!conn.visible) return null;
        const pinA = component.pins.find((p) => p.id === conn.pinAId);
        const pinB = component.pins.find((p) => p.id === conn.pinBId);
        if (!pinA || !pinB) return null;
        const d = conn.pathSvg || computeLinePath(pinA.position, pinB.position);
        const isClosed = conn.state === 'closed';
        const color = isClosed ? '#10b981' : '#f97316';
        const isSelected = selectedConnectionId === conn.id;

        return (
          <g key={conn.id}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); selectConnection(conn.id); }} />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 3 : 2}
              strokeDasharray={isClosed ? 'none' : '6,4'}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                selectConnection(conn.id);
              }}
              style={{ cursor: 'pointer' }}
            />
          </g>
        );
      })}
    </g>
  );
}

function getShapePosition(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect':
      return { x: el.x ?? 0, y: el.y ?? 0 };
    case 'circle':
      return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'ellipse':
      return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'line':
      return { x1: el.x1 ?? 0, y1: el.y1 ?? 0, x2: el.x2 ?? 0, y2: el.y2 ?? 0 };
    default:
      return {};
  }
}

function getShapeResizeData(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect':
      return {
        x: el.x ?? 0,
        y: el.y ?? 0,
        width: el.width ?? 0,
        height: el.height ?? 0,
      };
    case 'circle':
      return {
        cx: el.cx ?? 0,
        cy: el.cy ?? 0,
        r: el.r ?? 0,
      };
    case 'ellipse':
      return {
        cx: el.cx ?? 0,
        cy: el.cy ?? 0,
        rx: el.rx ?? 0,
        ry: el.ry ?? 0,
      };
    case 'line':
      return {
        x1: el.x1 ?? 0,
        y1: el.y1 ?? 0,
        x2: el.x2 ?? 0,
        y2: el.y2 ?? 0,
      };
    default:
      return getShapePosition(el);
  }
}

function applyShapeMove(
  compId: string,
  shapeId: string,
  orig: Record<string, number>,
  dx: number,
  dy: number,
  update: (cid: string, sid: string, u: Partial<ShapeElement>) => void
) {
  const updates: Record<string, number> = {};
  for (const [k, v] of Object.entries(orig)) {
    updates[k] = Math.round(v + (k.includes('x') || k === 'cx' ? dx : k.includes('y') || k === 'cy' ? dy : 0));
  }
  update(compId, shapeId, updates);
}

function computeResizedShape(
  shapeType: ShapeElement['type'],
  handle: string,
  orig: Record<string, number>,
  dx: number,
  dy: number
): Partial<ShapeElement> {
  if (shapeType === 'rect') {
    let x1 = orig.x ?? 0;
    let y1 = orig.y ?? 0;
    let x2 = (orig.x ?? 0) + (orig.width ?? 0);
    let y2 = (orig.y ?? 0) + (orig.height ?? 0);
    if (handle.includes('e')) x2 += dx;
    if (handle.includes('w')) x1 += dx;
    if (handle.includes('s')) y2 += dy;
    if (handle.includes('n')) y1 += dy;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.max(4, Math.abs(x2 - x1));
    const height = Math.max(4, Math.abs(y2 - y1));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  if (shapeType === 'circle') {
    const cx = orig.cx ?? 0;
    const cy = orig.cy ?? 0;
    const byHandle = handle === 'e' || handle === 'w' ? Math.abs((orig.r ?? 0) + (handle === 'e' ? dx : -dx)) : Math.abs((orig.r ?? 0) + (handle === 's' ? dy : -dy));
    const r = Math.max(3, byHandle);
    return { cx: Math.round(cx), cy: Math.round(cy), r: Math.round(r) };
  }

  if (shapeType === 'ellipse') {
    const cx = orig.cx ?? 0;
    const cy = orig.cy ?? 0;
    const rx = Math.max(3, Math.abs((orig.rx ?? 0) + (handle === 'e' ? dx : handle === 'w' ? -dx : 0)));
    const ry = Math.max(3, Math.abs((orig.ry ?? 0) + (handle === 's' ? dy : handle === 'n' ? -dy : 0)));
    return { cx: Math.round(cx), cy: Math.round(cy), rx: Math.round(rx), ry: Math.round(ry) };
  }

  if (shapeType === 'line') {
    if (handle === 'start') {
      return { x1: Math.round((orig.x1 ?? 0) + dx), y1: Math.round((orig.y1 ?? 0) + dy) };
    }
    if (handle === 'end') {
      return { x2: Math.round((orig.x2 ?? 0) + dx), y2: Math.round((orig.y2 ?? 0) + dy) };
    }
  }

  return {};
}

function getSnapPosition(
  pos: { x: number; y: number },
  shapes: ShapeElement[]
): { position: { x: number; y: number }; snapped: boolean } {
  const SNAP_DISTANCE = 10;
  let best: { x: number; y: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const shape of shapes) {
    const points = getShapeSnapPoints(shape);
    for (const p of points) {
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= SNAP_DISTANCE && dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
  }

  if (!best) {
    return { position: pos, snapped: false };
  }
  return { position: { x: Math.round(best.x), y: Math.round(best.y) }, snapped: true };
}

function getShapeSnapPoints(shape: ShapeElement): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const b = getShapeBounds(shape);
  if (b.width === 0 && b.height === 0) return points;

  const xs = [b.left, b.left + b.width * 0.25, b.left + b.width * 0.5, b.left + b.width * 0.75, b.right];
  const ys = [b.top, b.top + b.height * 0.25, b.top + b.height * 0.5, b.top + b.height * 0.75, b.bottom];

  // Top / bottom edge quarter & half points
  xs.forEach((x) => {
    points.push({ x, y: b.top });
    points.push({ x, y: b.bottom });
  });

  // Left / right edge quarter & half points
  ys.forEach((y) => {
    points.push({ x: b.left, y });
    points.push({ x: b.right, y });
  });

  // Extremes + center
  points.push({ x: b.left, y: b.cy });
  points.push({ x: b.right, y: b.cy });
  points.push({ x: b.cx, y: b.top });
  points.push({ x: b.cx, y: b.bottom });
  points.push({ x: b.cx, y: b.cy });

  return points;
}

function resolveShapeProps(el: ShapeElement, matrices: Record<string, import('../../types').ConnectivityMatrix>, compId: string): ShapeElement {
  if (el.linkedConnectionId) {
    const matrix = matrices[compId];
    if (matrix) {
      const conn = matrix.connections.find((c) => c.id === el.linkedConnectionId);
      if (conn) {
        const override = conn.state === 'closed' ? el.stateClosed : el.stateOpen;
        if (override) return { ...el, ...override };
        return el;
      }
    }
  }
  return el;
}

function renderShapeElement(el: ShapeElement, matrices: Record<string, import('../../types').ConnectivityMatrix>, compId: string) {
  const { selectedShapeIds, flashedShapeIds } = useCanvasStore.getState();
  const isSelected = selectedShapeIds.includes(el.id);
  const isFlashed = flashedShapeIds.includes(el.id);
  const resolved = resolveShapeProps(el, matrices, compId);
  const base = {
    fill: resolved.fill || 'transparent',
    stroke: resolved.stroke || '#334155',
    strokeWidth: resolved.strokeWidth ?? 2,
    opacity: resolved.opacity ?? 1,
  };

  let shape: React.ReactNode;
  switch (resolved.type) {
    case 'rect':
      shape = <rect data-shape-id={el.id} x={resolved.x} y={resolved.y} width={resolved.width} height={resolved.height} rx={resolved.rx ?? 0} style={{ cursor: 'pointer' }} {...base} />;
      break;
    case 'circle':
      shape = <circle data-shape-id={el.id} cx={resolved.cx} cy={resolved.cy} r={resolved.r} style={{ cursor: 'pointer' }} {...base} />;
      break;
    case 'ellipse':
      shape = <ellipse data-shape-id={el.id} cx={resolved.cx} cy={resolved.cy} rx={resolved.rx} ry={resolved.ry} style={{ cursor: 'pointer' }} {...base} />;
      break;
    case 'line':
      shape = <line data-shape-id={el.id} x1={resolved.x1} y1={resolved.y1} x2={resolved.x2} y2={resolved.y2} stroke={base.stroke} strokeWidth={base.strokeWidth} opacity={base.opacity} style={{ cursor: 'pointer' }} />;
      break;
    case 'path':
      shape = <path data-shape-id={el.id} d={resolved.d} style={{ cursor: 'pointer' }} {...base} />;
      break;
    default:
      return null;
  }

  return (
    <>
      {shape}
      {isSelected && renderSelectionBox(resolved)}
      {isSelected && renderResizeHandles(resolved)}
      {isFlashed && renderFlashBox(resolved)}
    </>
  );
}

function renderSelectionBox(el: ShapeElement) {
  let x: number;
  let y: number;
  let w: number;
  let h: number;

  switch (el.type) {
    case 'rect':
      x = (el.x ?? 0) - 3;
      y = (el.y ?? 0) - 3;
      w = (el.width ?? 0) + 6;
      h = (el.height ?? 0) + 6;
      break;
    case 'circle':
      x = (el.cx ?? 0) - (el.r ?? 0) - 3;
      y = (el.cy ?? 0) - (el.r ?? 0) - 3;
      w = (el.r ?? 0) * 2 + 6;
      h = w;
      break;
    case 'ellipse':
      x = (el.cx ?? 0) - (el.rx ?? 0) - 3;
      y = (el.cy ?? 0) - (el.ry ?? 0) - 3;
      w = (el.rx ?? 0) * 2 + 6;
      h = (el.ry ?? 0) * 2 + 6;
      break;
    case 'line': {
      const minX = Math.min(el.x1 ?? 0, el.x2 ?? 0);
      const minY = Math.min(el.y1 ?? 0, el.y2 ?? 0);
      x = minX - 3;
      y = minY - 3;
      w = Math.abs((el.x2 ?? 0) - (el.x1 ?? 0)) + 6;
      h = Math.abs((el.y2 ?? 0) - (el.y1 ?? 0)) + 6;
      break;
    }
    default:
      return null;
  }

  return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#0ea5e9" strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />;
}

function renderPreviewElement(el: ShapeElement) {
  const base = { fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, opacity: el.opacity ?? 0.6 };
  switch (el.type) {
    case 'rect':
      return <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} {...base} />;
    case 'circle':
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...base} />;
    case 'ellipse':
      return <ellipse cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...base} />;
    case 'line':
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.stroke} strokeWidth={el.strokeWidth} opacity={el.opacity} />;
    default:
      return null;
  }
}

function renderFlashBox(el: ShapeElement) {
  const b = getShapeBounds(el);
  return (
    <g pointerEvents="none">
      <rect
        x={b.left - 10}
        y={b.top - 10}
        width={b.width + 20}
        height={b.height + 20}
        fill="rgba(255,193,7,0.22)"
        stroke="#ff9800"
        strokeWidth={2.5}
        rx={6}
      >
        <animate attributeName="opacity" values="0.15;1;0.15" dur="0.45s" repeatCount="4" />
      </rect>
    </g>
  );
}

function renderResizeHandles(el: ShapeElement) {
  const handles: Array<{ key: string; x: number; y: number }> = [];
  if (el.type === 'rect') {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.width ?? 0;
    const h = el.height ?? 0;
    handles.push({ key: 'nw', x, y });
    handles.push({ key: 'ne', x: x + w, y });
    handles.push({ key: 'sw', x, y: y + h });
    handles.push({ key: 'se', x: x + w, y: y + h });
  } else if (el.type === 'circle') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const r = el.r ?? 0;
    handles.push({ key: 'e', x: cx + r, y: cy });
    handles.push({ key: 'w', x: cx - r, y: cy });
    handles.push({ key: 'n', x: cx, y: cy - r });
    handles.push({ key: 's', x: cx, y: cy + r });
  } else if (el.type === 'ellipse') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const rx = el.rx ?? 0;
    const ry = el.ry ?? 0;
    handles.push({ key: 'e', x: cx + rx, y: cy });
    handles.push({ key: 'w', x: cx - rx, y: cy });
    handles.push({ key: 'n', x: cx, y: cy - ry });
    handles.push({ key: 's', x: cx, y: cy + ry });
  } else if (el.type === 'line') {
    handles.push({ key: 'start', x: el.x1 ?? 0, y: el.y1 ?? 0 });
    handles.push({ key: 'end', x: el.x2 ?? 0, y: el.y2 ?? 0 });
  }

  if (handles.length === 0) return null;
  return (
    <g>
      {handles.map((h) => (
        <circle
          key={h.key}
          cx={h.x}
          cy={h.y}
          r={4.5}
          fill="#ffffff"
          stroke="#0ea5e9"
          strokeWidth={1.5}
          data-resize-shape-id={el.id}
          data-resize-handle={h.key}
          style={{ cursor: getResizeCursor(el.type, h.key) }}
        />
      ))}
    </g>
  );
}

function getResizeCursor(type: ShapeElement['type'], handle: string): string {
  if (type === 'line') return 'crosshair';
  if (type === 'circle' || type === 'ellipse') {
    if (handle === 'e' || handle === 'w') return 'ew-resize';
    if (handle === 'n' || handle === 's') return 'ns-resize';
    return 'move';
  }
  if (type === 'rect') {
    if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
    if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  }
  return 'move';
}
