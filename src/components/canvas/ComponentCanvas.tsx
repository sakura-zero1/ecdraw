import { useRef, useCallback, useEffect, useState } from 'react';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import type { ShapeElement } from '../../types';
import { computeLinePath } from '../../utils/geometry';
import { getShapeBounds, getGroupBounds, getGroupResizeHandles, scaleShapeInGroup, moveShapeBy } from '../../utils/alignment';
import type { Bounds } from '../../utils/alignment';
import { drawShapeOnCanvas, drawPin, buildShapePath } from '../../utils/canvasRenderer';
import ShapeToolbar from './ShapeToolbar';
import AlignmentToolbar from './AlignmentToolbar';
import ShortcutHelp from './ShortcutHelp';
import './ComponentCanvas.css';

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 800;
const SNAP_THRESHOLD = 5;
const HANDLE_RADIUS = 5;
const HANDLE_HIT_RADIUS = 10;
const PIN_HIT_RADIUS = 10;

// ─── Pure logic functions (unchanged from SvgCanvas) ───

function getShapePosition(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect': return { x: el.x ?? 0, y: el.y ?? 0 };
    case 'circle': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'ellipse': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'line': return { x1: el.x1 ?? 0, y1: el.y1 ?? 0, x2: el.x2 ?? 0, y2: el.y2 ?? 0 };
    default: return {};
  }
}

function getShapeResizeData(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect': return { x: el.x ?? 0, y: el.y ?? 0, width: el.width ?? 0, height: el.height ?? 0 };
    case 'circle': return { cx: el.cx ?? 0, cy: el.cy ?? 0, r: el.r ?? 0 };
    case 'ellipse': return { cx: el.cx ?? 0, cy: el.cy ?? 0, rx: el.rx ?? 0, ry: el.ry ?? 0 };
    case 'line': return { x1: el.x1 ?? 0, y1: el.y1 ?? 0, x2: el.x2 ?? 0, y2: el.y2 ?? 0 };
    default: return getShapePosition(el);
  }
}

function applyShapeMove(
  compId: string, shapeId: string, orig: Record<string, number>,
  dx: number, dy: number,
  update: (cid: string, sid: string, u: Partial<ShapeElement>) => void,
) {
  const updates: Record<string, number> = {};
  for (const [k, v] of Object.entries(orig)) {
    updates[k] = Math.round(v + (k.includes('x') || k === 'cx' ? dx : k.includes('y') || k === 'cy' ? dy : 0));
  }
  update(compId, shapeId, updates);
}

function computeResizedShape(
  shapeType: ShapeElement['type'], handle: string,
  orig: Record<string, number>, dx: number, dy: number,
): Partial<ShapeElement> {
  if (shapeType === 'rect') {
    let x1 = orig.x ?? 0, y1 = orig.y ?? 0;
    let x2 = x1 + (orig.width ?? 0), y2 = y1 + (orig.height ?? 0);
    if (handle.includes('e')) x2 += dx;
    if (handle.includes('w')) x1 += dx;
    if (handle.includes('s')) y2 += dy;
    if (handle.includes('n')) y1 += dy;
    return { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), width: Math.round(Math.max(4, Math.abs(x2 - x1))), height: Math.round(Math.max(4, Math.abs(y2 - y1))) };
  }
  if (shapeType === 'circle') {
    const r = Math.max(3, Math.abs((orig.r ?? 0) + (handle === 'e' ? dx : handle === 'w' ? -dx : handle === 's' ? dy : -dy)));
    return { cx: Math.round(orig.cx ?? 0), cy: Math.round(orig.cy ?? 0), r: Math.round(r) };
  }
  if (shapeType === 'ellipse') {
    const rx = Math.max(3, Math.abs((orig.rx ?? 0) + (handle === 'e' ? dx : handle === 'w' ? -dx : 0)));
    const ry = Math.max(3, Math.abs((orig.ry ?? 0) + (handle === 's' ? dy : handle === 'n' ? -dy : 0)));
    return { cx: Math.round(orig.cx ?? 0), cy: Math.round(orig.cy ?? 0), rx: Math.round(rx), ry: Math.round(ry) };
  }
  if (shapeType === 'line') {
    if (handle === 'start') return { x1: Math.round((orig.x1 ?? 0) + dx), y1: Math.round((orig.y1 ?? 0) + dy) };
    if (handle === 'end') return { x2: Math.round((orig.x2 ?? 0) + dx), y2: Math.round((orig.y2 ?? 0) + dy) };
  }
  return {};
}

function getShapeSnapPoints(el: ShapeElement): { x: number; y: number }[] {
  switch (el.type) {
    case 'rect': {
      const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
      return [
        { x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h },
        { x: x + w / 2, y }, { x: x + w / 2, y: y + h },
        { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 },
        { x: x + w / 2, y: y + h / 2 },
      ];
    }
    case 'circle': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, r = el.r ?? 0;
      return [
        { x: cx, y: cy },
        { x: cx, y: cy - r }, { x: cx, y: cy + r },
        { x: cx - r, y: cy }, { x: cx + r, y: cy },
      ];
    }
    case 'ellipse': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, rx = el.rx ?? 0, ry = el.ry ?? 0;
      return [
        { x: cx, y: cy },
        { x: cx, y: cy - ry }, { x: cx, y: cy + ry },
        { x: cx - rx, y: cy }, { x: cx + rx, y: cy },
      ];
    }
    case 'line': {
      const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
      return [
        { x: x1, y: y1 }, { x: x2, y: y2 },
        { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      ];
    }
    default: return [];
  }
}

function getSnapPosition(pos: { x: number; y: number }, shapes: ShapeElement[], zoom: number = 1) {
  const SNAP_DISTANCE = 8 / zoom;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const shape of shapes) {
    for (const p of getShapeSnapPoints(shape)) {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d <= SNAP_DISTANCE && d < bestDist) { bestDist = d; best = p; }
    }
  }
  return best ? { position: { x: Math.round(best.x), y: Math.round(best.y) }, snapped: true } : { position: pos, snapped: false };
}

function snapShapeMove(
  shape: ShapeElement,
  dx: number,
  dy: number,
  allShapes: ShapeElement[],
  movingIds: Set<string>,
  zoom: number,
): { dx: number; dy: number; snapped: boolean; snapPoint: { x: number; y: number } | null } {
  const SNAP_DIST = 8 / zoom;
  const origPos = getShapePosition(shape);
  const newPos: Record<string, number> = {};
  for (const [k, v] of Object.entries(origPos)) {
    newPos[k] = v + (k.includes('x') || k === 'cx' ? dx : k.includes('y') || k === 'cy' ? dy : 0);
  }
  const movedShape = { ...shape, ...newPos } as ShapeElement;
  const movedPoints = getShapeSnapPoints(movedShape);

  const targetPoints: { x: number; y: number }[] = [];
  for (const s of allShapes) {
    if (movingIds.has(s.id)) continue;
    targetPoints.push(...getShapeSnapPoints(s));
  }

  let bestDist = Infinity;
  let adjustDx = 0;
  let adjustDy = 0;
  let snapPoint: { x: number; y: number } | null = null;

  for (const mp of movedPoints) {
    for (const tp of targetPoints) {
      const d = Math.hypot(mp.x - tp.x, mp.y - tp.y);
      if (d <= SNAP_DIST && d < bestDist) {
        bestDist = d;
        adjustDx = tp.x - mp.x;
        adjustDy = tp.y - mp.y;
        snapPoint = tp;
      }
    }
  }

  if (bestDist < Infinity) {
    return { dx: Math.round(dx + adjustDx), dy: Math.round(dy + adjustDy), snapped: true, snapPoint };
  }
  return { dx, dy, snapped: false, snapPoint: null };
}

function computeAlignmentGuidesFromBounds(
  movedBox: { left: number; right: number; top: number; bottom: number; cx: number; cy: number },
  allShapes: ShapeElement[],
  movingIds: Set<string>,
  zoom: number,
): { axis: 'x' | 'y'; value: number }[] {
  const guides: { axis: 'x' | 'y'; value: number }[] = [];
  const ALIGN_THRESHOLD = 6 / zoom;
  const processedGroups = new Set<string>();
  for (const el of allShapes) {
    if (movingIds.has(el.id)) continue;
    // Grouped shapes: use combined group bounds (process each group only once)
    let b: { left: number; right: number; top: number; bottom: number; cx: number; cy: number };
    if (el.groupId) {
      if (processedGroups.has(el.groupId)) continue;
      processedGroups.add(el.groupId);
      const groupShapes = allShapes.filter((s) => s.groupId === el.groupId && !movingIds.has(s.id));
      const gb = getGroupBounds(groupShapes);
      if (!gb) continue;
      b = gb;
    } else {
      b = getShapeBounds(el);
    }
    let bestXDist = ALIGN_THRESHOLD, xAlign: number | null = null;
    for (const val of [b.left, b.right, b.cx]) {
      for (const mVal of [movedBox.left, movedBox.right, movedBox.cx]) {
        const d = Math.abs(val - mVal);
        if (d < bestXDist) { bestXDist = d; xAlign = val; }
      }
    }
    if (xAlign !== null) guides.push({ axis: 'x', value: xAlign });
    let bestYDist = ALIGN_THRESHOLD, yAlign: number | null = null;
    for (const val of [b.top, b.bottom, b.cy]) {
      for (const mVal of [movedBox.top, movedBox.bottom, movedBox.cy]) {
        const d = Math.abs(val - mVal);
        if (d < bestYDist) { bestYDist = d; yAlign = val; }
      }
    }
    if (yAlign !== null) guides.push({ axis: 'y', value: yAlign });
  }
  const seen = new Set<string>();
  return guides.filter((g) => { const k = `${g.axis}:${Math.round(g.value)}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function resolveShapeProps(el: ShapeElement, matrices: Record<string, import('../../types').ConnectivityMatrix>, compId: string): ShapeElement {
  if (el.linkedConnectionId) {
    const conn = matrices[compId]?.connections.find((c) => c.id === el.linkedConnectionId);
    if (conn && conn.state !== 'none') {
      const override = conn.state === 'closed' ? el.stateClosed : el.stateOpen;
      if (override) return { ...el, ...override };
    }
  }
  return el;
}

function getResizeHandles(el: ShapeElement): Array<{ key: string; x: number; y: number }> {
  const handles: Array<{ key: string; x: number; y: number }> = [];
  if (el.type === 'rect') {
    const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
    handles.push({ key: 'nw', x, y }, { key: 'ne', x: x + w, y }, { key: 'sw', x, y: y + h }, { key: 'se', x: x + w, y: y + h });
  } else if (el.type === 'circle') {
    const cx = el.cx ?? 0, cy = el.cy ?? 0, r = el.r ?? 0;
    handles.push({ key: 'e', x: cx + r, y: cy }, { key: 'w', x: cx - r, y: cy }, { key: 'n', x: cx, y: cy - r }, { key: 's', x: cx, y: cy + r });
  } else if (el.type === 'ellipse') {
    const cx = el.cx ?? 0, cy = el.cy ?? 0, rx = el.rx ?? 0, ry = el.ry ?? 0;
    handles.push({ key: 'e', x: cx + rx, y: cy }, { key: 'w', x: cx - rx, y: cy }, { key: 'n', x: cx, y: cy - ry }, { key: 's', x: cx, y: cy + ry });
  } else if (el.type === 'line') {
    handles.push({ key: 'start', x: el.x1 ?? 0, y: el.y1 ?? 0 }, { key: 'end', x: el.x2 ?? 0, y: el.y2 ?? 0 });
  }
  return handles;
}

/** Draw infinite grid covering the visible viewport area */
function drawInfiniteGrid(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, zoom: number, canvasW: number, canvasH: number, gridSize = 20) {
  // Visible world bounds
  const worldLeft = -offsetX / zoom;
  const worldTop = -offsetY / zoom;
  const worldRight = (canvasW - offsetX) / zoom;
  const worldBottom = (canvasH - offsetY) / zoom;

  // Adapt grid density to zoom level
  let step = gridSize;
  if (zoom < 0.3) step = 100;
  else if (zoom < 0.6) step = 50;
  else if (zoom > 3) step = 10;

  const startX = Math.floor(worldLeft / step) * step;
  const startY = Math.floor(worldTop / step) * step;
  const endX = Math.ceil(worldRight / step) * step;
  const endY = Math.ceil(worldBottom / step) * step;

  ctx.save();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 0.5 / zoom;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ─── Component ───

export default function ComponentCanvas({ onSave }: { onSave?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const { activeTool, setActiveTool, selectShape, selectPin, viewport, setViewport } = useCanvasStore();
  const { components, activeComponentId, addShapeElement, updateShapeElement, updatePin, pushUndo, importSubComponent } = useComponentStore();
  const matrices = useConnectionStore((s) => s.matrices);

  const [dragOver, setDragOver] = useState(false);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; preview?: ShapeElement } | null>(null);
  const [dragState, setDragState] = useState<{
    type: 'shape' | 'pin' | 'handle' | 'pan' | 'group-handle'; id: string; handle?: string; shapeType?: ShapeElement['type'];
    startCanvasX: number; startCanvasY: number; origData: Record<string, number>;
    startOffsetX?: number; startOffsetY?: number;
    shapeIds?: string[]; shapeOrigMap?: Record<string, Record<string, number>>;
    groupId?: string; origGroupBounds?: Bounds; shapeOrigData?: Record<string, Record<string, number>>;
  } | null>(null);
  const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [snapPreview, setSnapPreview] = useState<{ x: number; y: number } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<{ axis: 'x' | 'y'; value: number }[]>([]);
  const preClickSelectionRef = useRef<string[]>([]);

  const activeComp = components.find((c) => c.id === activeComponentId);
  const canvasWidth = activeComp?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = activeComp?.height ?? DEFAULT_CANVAS_HEIGHT;
  const isDrawTool = activeTool.startsWith('draw-');
  const effectiveSelect = activeTool === 'select' || altHeld;

  // ─── Coordinate conversion (screen → world via viewport) ───

  const getCanvasPos = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { offsetX, offsetY, zoom } = viewport;
    const x = Math.round((e.clientX - rect.left - offsetX) / zoom);
    const y = Math.round((e.clientY - rect.top - offsetY) / zoom);
    return { x, y };
  }, [viewport]);

  // ─── Alt key tracking ───

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', onBlur); };
  }, []);

  // ─── Keyboard shortcuts ───

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hasMod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();

      // Ctrl+S 保存 — 提到最前，避免被 input 等提前返回拦截
      if (hasMod && lower === 's') {
        e.preventDefault();
        e.stopPropagation();
        onSaveRef.current?.();
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target?.closest('input, textarea, select')) return;
      if ((e.ctrlKey && e.shiftKey) || (e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey)) return;

      const { selectedShapeIds } = useCanvasStore.getState();
      const store = useComponentStore.getState();
      const compId = store.activeComponentId;
      const matchKey = (code: string, key: string) => e.code === code || lower === key;

      if (!hasMod && !e.altKey) {
        if (matchKey('KeyQ', 'q')) { e.preventDefault(); setActiveTool('select'); return; }
        if (matchKey('KeyA', 'a')) { e.preventDefault(); setActiveTool('draw-rect'); return; }
        if (matchKey('KeyS', 's')) { e.preventDefault(); setActiveTool('draw-circle'); return; }
        if (matchKey('KeyD', 'd')) { e.preventDefault(); setActiveTool('draw-ellipse'); return; }
        if (matchKey('KeyF', 'f')) { e.preventDefault(); setActiveTool('draw-line'); return; }
        if (e.key === 'Escape') {
          e.preventDefault();
          const { groupEditingGroupId } = useCanvasStore.getState();
          if (groupEditingGroupId) {
            // Exit group editing but re-select the group
            const comp = useComponentStore.getState().components.find((c) => c.id === useComponentStore.getState().activeComponentId);
            useCanvasStore.getState().exitGroupEditing();
            if (comp) {
              const groupShapes = comp.shapeElements.filter((s) => s.groupId === groupEditingGroupId);
              for (const s of groupShapes) useCanvasStore.getState().selectShape(s.id, true);
            }
          } else {
            useCanvasStore.getState().clearSelection();
          }
          return;
        }
      }
      if (hasMod && lower === 'g' && compId) {
        e.preventDefault();
        if (e.shiftKey) store.ungroupShapeElements(compId, selectedShapeIds);
        else store.groupShapeElements(compId, selectedShapeIds);
        return;
      }
      if (hasMod && lower === 'd' && compId) {
        e.preventDefault();
        const comp = store.getComponent(compId);
        if (comp && selectedShapeIds.length > 0) {
          const nextIds: string[] = [];
          for (const sid of selectedShapeIds) { const newId = store.cloneShapeElement(compId, sid); if (newId) nextIds.push(newId); }
          if (nextIds.length > 1) {
            const newGroupId = crypto.randomUUID();
            for (const nid of nextIds) store.updateShapeElement(compId, nid, { groupId: newGroupId });
          }
          useCanvasStore.getState().selectShape(null);
          for (const nid of nextIds) useCanvasStore.getState().selectShape(nid, true);
        }
        return;
      }
      if (hasMod && lower === 'c') {
        if (selectedShapeIds.length > 0 && compId) {
          e.preventDefault();
          const comp = store.getComponent(compId);
          if (comp) {
            const els = selectedShapeIds.map((sid) => comp.shapeElements.find((s) => s.id === sid)).filter(Boolean) as ShapeElement[];
            useCanvasStore.getState().setClipboard(els);
          }
        }
        return;
      }
      if (hasMod && lower === 'v') {
        e.preventDefault();
        const clip = useCanvasStore.getState().clipboard;
        if (clip.length > 0 && compId) {
          const newGroupId = clip.length > 1 && clip.every((el) => el.groupId && el.groupId === clip[0].groupId) ? crypto.randomUUID() : undefined;
          const nextIds: string[] = [];
          for (const el of clip) {
            const newId = store.cloneFromClipboard(compId, el, newGroupId);
            if (newId) nextIds.push(newId);
          }
          useCanvasStore.getState().selectShape(null);
          for (const nid of nextIds) useCanvasStore.getState().selectShape(nid, true);
        }
        return;
      }
      if (hasMod && lower === 'z') { e.preventDefault(); store.undo(); selectShape(null); return; }
      if (hasMod && (lower === '=' || lower === '+')) { e.preventDefault(); useCanvasStore.getState().zoomIn(); return; }
      if (hasMod && lower === '-') { e.preventDefault(); useCanvasStore.getState().zoomOut(); return; }
      if (hasMod && lower === '0') { e.preventDefault(); useCanvasStore.getState().resetView(); return; }
      if (hasMod && lower === 'x') {
        e.preventDefault();
        if (selectedShapeIds.length > 0 && compId) {
          const comp = store.getComponent(compId);
          if (comp) {
            const els = selectedShapeIds.map((sid) => comp.shapeElements.find((s) => s.id === sid)).filter(Boolean) as ShapeElement[];
            useCanvasStore.getState().setClipboard(els);
          }
          for (const sid of selectedShapeIds) store.removeShapeElement(compId, sid);
          selectShape(null);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedShapeIds.length > 0 && compId) { for (const sid of selectedShapeIds) store.removeShapeElement(compId, sid); selectShape(null); }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [selectShape, setActiveTool]);

  // ─── Hit testing ───

  const hitTestHandle = useCallback((cx: number, cy: number): { shapeId: string; handle: string } | null => {
    if (!activeComp) return null;
    const { selectedShapeIds, groupEditingGroupId } = useCanvasStore.getState();
    const hitR = HANDLE_HIT_RADIUS / viewport.zoom;
    for (const sid of selectedShapeIds) {
      const el = activeComp.shapeElements.find((s) => s.id === sid);
      if (!el) continue;
      if (el.groupId && groupEditingGroupId !== el.groupId) continue;
      for (const h of getResizeHandles(el)) {
        if (Math.hypot(cx - h.x, cy - h.y) <= hitR) return { shapeId: sid, handle: h.key };
      }
    }
    return null;
  }, [activeComp, viewport.zoom]);

  const hitTestPin = useCallback((cx: number, cy: number): string | null => {
    if (!activeComp) return null;
    const hitR = PIN_HIT_RADIUS / viewport.zoom;
    for (const pin of activeComp.pins) {
      if (Math.hypot(cx - pin.position.x, cy - pin.position.y) <= hitR) return pin.id;
    }
    return null;
  }, [activeComp, viewport.zoom]);

  const hitTestShape = useCallback((cx: number, cy: number): string | null => {
    if (!activeComp) return null;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    const hitMargin = 4 / viewport.zoom;
    // Reset transform so isPointInPath/Stroke uses raw world coordinates
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = activeComp.shapeElements.length - 1; i >= 0; i--) {
      const el = activeComp.shapeElements[i];
      const resolved = resolveShapeProps(el, matrices, activeComp.id);
      const path = buildShapePath(resolved);
      ctx.lineWidth = Math.max(resolved.strokeWidth ?? 2, hitMargin * 2);
      if (ctx.isPointInPath(path, cx, cy) || ctx.isPointInStroke(path, cx, cy)) {
        ctx.restore();
        return el.id;
      }
    }
    ctx.restore();
    return null;
  }, [activeComp, matrices, viewport.zoom]);

  // ─── Mouse events ───

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!effectiveSelect || !activeComp) return;
    const pos = getCanvasPos(e);
    const shapeHit = hitTestShape(pos.x, pos.y);
    if (!shapeHit) return;
    const el = activeComp.shapeElements.find((s) => s.id === shapeHit);
    if (!el || !el.groupId) return;
    // Only enter editing if the shape was already selected before this double-click sequence
    if (!preClickSelectionRef.current.includes(shapeHit)) return;
    const { groupEditingGroupId } = useCanvasStore.getState();
    if (groupEditingGroupId === el.groupId) return;
    useCanvasStore.getState().enterGroupEditing(el.groupId);
    selectShape(shapeHit);
  }, [effectiveSelect, activeComp, getCanvasPos, hitTestShape, selectShape]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Track selection state before this click for double-click guard
    preClickSelectionRef.current = [...useCanvasStore.getState().selectedShapeIds];

    // Right-click or middle-click => pan
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setDragState({
        type: 'pan', id: '', startCanvasX: e.clientX, startCanvasY: e.clientY,
        origData: {}, startOffsetX: viewport.offsetX, startOffsetY: viewport.offsetY,
      });
      return;
    }

    // Left button only from here
    if (e.button !== 0) return;

    const pos = getCanvasPos(e);
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // Ctrl+left => pan
    if (ctrl) {
      e.preventDefault();
      setDragState({
        type: 'pan', id: '', startCanvasX: e.clientX, startCanvasY: e.clientY,
        origData: {}, startOffsetX: viewport.offsetX, startOffsetY: viewport.offsetY,
      });
      return;
    }

    // Check group bounding-box handles first (when a group is selected and not in group-editing mode)
    if (effectiveSelect && activeComp) {
      const { selectedShapeIds: selIds, groupEditingGroupId } = useCanvasStore.getState();
      if (!groupEditingGroupId && selIds.length > 0) {
        const firstShape = activeComp.shapeElements.find((s) => s.id === selIds[0]);
        const commonGroupId = firstShape?.groupId;
        if (commonGroupId && selIds.every((sid) => activeComp.shapeElements.find((el) => el.id === sid)?.groupId === commonGroupId)) {
          const groupShapes = activeComp.shapeElements.filter((s) => s.groupId === commonGroupId);
          const groupBounds = getGroupBounds(groupShapes);
          if (groupBounds) {
            const pad = 6;
            const paddedBounds: Bounds = {
              left: groupBounds.left - pad, top: groupBounds.top - pad,
              right: groupBounds.right + pad, bottom: groupBounds.bottom + pad,
              width: groupBounds.width + pad * 2, height: groupBounds.height + pad * 2,
              cx: groupBounds.cx, cy: groupBounds.cy,
            };
            const handles = getGroupResizeHandles(paddedBounds);
            const hitR = HANDLE_HIT_RADIUS / viewport.zoom;
            for (const h of handles) {
              if (Math.hypot(pos.x - h.x, pos.y - h.y) <= hitR) {
                e.preventDefault();
                pushUndo();
                const shapeOrigData: Record<string, Record<string, number>> = {};
                for (const s of groupShapes) shapeOrigData[s.id] = getShapeResizeData(s);
                setDragState({
                  type: 'group-handle', id: '', handle: h.key,
                  startCanvasX: pos.x, startCanvasY: pos.y,
                  origData: {},
                  groupId: commonGroupId, origGroupBounds: groupBounds, shapeOrigData,
                });
                return;
              }
            }
          }
        }
      }
    }

    // Check individual shape resize handles
    const handleHit = hitTestHandle(pos.x, pos.y);
    if (handleHit && activeComp) {
      e.preventDefault();
      const shape = activeComp.shapeElements.find((s) => s.id === handleHit.shapeId);
      if (!shape) return;
      pushUndo();
      selectShape(handleHit.shapeId);
      setDragState({ type: 'handle', id: handleHit.shapeId, shapeType: shape.type, handle: handleHit.handle, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapeResizeData(shape) });
      return;
    }

    // Line-specific: precise endpoint vs body detection
    if (effectiveSelect && activeComp) {
      const groupEditingId = useCanvasStore.getState().groupEditingGroupId;
      const lineHitMargin = 6 / viewport.zoom;
      const endpointR = HANDLE_HIT_RADIUS / viewport.zoom;
      for (let i = activeComp.shapeElements.length - 1; i >= 0; i--) {
        const el = activeComp.shapeElements[i];
        if (el.type !== 'line') continue;
        const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
        const ldx = x2 - x1, ldy = y2 - y1;
        const lenSq = ldx * ldx + ldy * ldy;
        let t = lenSq > 0 ? Math.max(0, Math.min(1, ((pos.x - x1) * ldx + (pos.y - y1) * ldy) / lenSq)) : 0;
        const projX = x1 + t * ldx, projY = y1 + t * ldy;
        const dist = Math.hypot(pos.x - projX, pos.y - projY);
        if (dist > lineHitMargin) continue;
        e.preventDefault();
        // In group-editing mode, only interact with lines belonging to the edited group
        if (groupEditingId && el.groupId !== groupEditingId) continue;
        const dStart = Math.hypot(pos.x - x1, pos.y - y1);
        const dEnd = Math.hypot(pos.x - x2, pos.y - y2);
        if (dStart <= endpointR && dStart <= dEnd) {
          pushUndo(); selectShape(el.id);
          setDragState({ type: 'handle', id: el.id, shapeType: 'line', handle: 'start', startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapeResizeData(el) });
        } else if (dEnd <= endpointR) {
          pushUndo(); selectShape(el.id);
          setDragState({ type: 'handle', id: el.id, shapeType: 'line', handle: 'end', startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapeResizeData(el) });
        } else {
          // On line body → move
          if (shift) { selectShape(el.id, true); return; }
          pushUndo();
          if (el.groupId && groupEditingId === el.groupId) {
            // In group editing mode — move just this line
            selectShape(el.id);
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el) });
          } else if (el.groupId) {
            const groupIds = activeComp.shapeElements.filter((s) => s.groupId === el.groupId).map((s) => s.id);
            selectShape(null);
            for (const gid of groupIds) selectShape(gid, true);
            const shapeOrigMap: Record<string, Record<string, number>> = {};
            for (const sid of groupIds) { const s = activeComp.shapeElements.find((s2) => s2.id === sid); if (s) shapeOrigMap[sid] = getShapePosition(s); }
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeIds: groupIds, shapeOrigMap });
          } else {
            selectShape(el.id);
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el) });
          }
        }
        return;
      }
    }

    // Pin hit
    const pinHit = hitTestPin(pos.x, pos.y);
    if (pinHit && activeComp && effectiveSelect) {
      e.preventDefault();
      if (shift) { selectPin(pinHit, true); return; }
      const pin = activeComp.pins.find((p) => p.id === pinHit);
      if (pin) {
        pushUndo(); selectPin(pinHit);
        setDragState({ type: 'pin', id: pinHit, startCanvasX: pos.x, startCanvasY: pos.y, origData: { x: pin.position.x, y: pin.position.y } });
      }
      return;
    }

    // Shape hit
    const shapeHit = hitTestShape(pos.x, pos.y);
    if (shapeHit && activeComp && effectiveSelect) {
      e.preventDefault();
      const el = activeComp.shapeElements.find((s) => s.id === shapeHit);
      if (el) {
        const groupEditingId = useCanvasStore.getState().groupEditingGroupId;
        if (shift) { selectShape(shapeHit, true); return; }
        pushUndo();
        if (el.groupId && groupEditingId === el.groupId) {
          // In group editing mode — select and drag individual shape
          selectShape(el.id);
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el) });
        } else if (el.groupId) {
          // Not in group editing — select whole group
          const groupIds = activeComp.shapeElements.filter((s) => s.groupId === el.groupId).map((s) => s.id);
          selectShape(null);
          for (const gid of groupIds) selectShape(gid, true);
          const shapeOrigMap: Record<string, Record<string, number>> = {};
          for (const sid of groupIds) { const s = activeComp.shapeElements.find((s2) => s2.id === sid); if (s) shapeOrigMap[sid] = getShapePosition(s); }
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeIds: groupIds, shapeOrigMap });
          if (groupEditingId) useCanvasStore.getState().exitGroupEditing();
        } else {
          // Ungrouped shape
          selectShape(el.id);
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el) });
          if (groupEditingId) useCanvasStore.getState().exitGroupEditing();
        }
      }
      return;
    }

    // Rubber band
    if (((activeTool === 'select' && !shapeHit && !pinHit) || (shift && !shapeHit && !pinHit)) && activeComp) {
      e.preventDefault();
      const { groupEditingGroupId } = useCanvasStore.getState();
      if (groupEditingGroupId) useCanvasStore.getState().exitGroupEditing();
      setRubberBand({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
      return;
    }

    // Draw tool
    if (isDrawTool && !altHeld && activeComp) {
      setDrawing({ startX: pos.x, startY: pos.y });
      return;
    }

    // Clear selection on blank
    if (effectiveSelect && !shapeHit && !pinHit) {
      const { groupEditingGroupId } = useCanvasStore.getState();
      if (groupEditingGroupId) useCanvasStore.getState().exitGroupEditing();
      selectShape(null); selectPin(null);
    }
  }, [activeComp, activeTool, isDrawTool, altHeld, effectiveSelect, getCanvasPos, viewport, selectShape, selectPin, pushUndo, hitTestHandle, hitTestPin, hitTestShape]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Pan drag
    if (dragState?.type === 'pan') {
      const dx = e.clientX - dragState.startCanvasX;
      const dy = e.clientY - dragState.startCanvasY;
      setViewport({
        offsetX: (dragState.startOffsetX ?? 0) + dx,
        offsetY: (dragState.startOffsetY ?? 0) + dy,
      });
      return;
    }

    const pos = getCanvasPos(e);

    if (rubberBand) { setRubberBand({ ...rubberBand, endX: pos.x, endY: pos.y }); return; }

    if (dragState && activeComp) {
      const dx = pos.x - dragState.startCanvasX;
      const dy = pos.y - dragState.startCanvasY;
      if (dragState.type === 'pin') {
        const rawPos = { x: Math.round(dragState.origData.x + dx), y: Math.round(dragState.origData.y + dy) };
        const snapped = getSnapPosition(rawPos, activeComp.shapeElements, viewport.zoom);
        setSnapPreview(snapped.snapped ? snapped.position : null);
        updatePin(activeComp.id, dragState.id, { position: snapped.position });
      } else if (dragState.type === 'shape') {
        const shapeIds = dragState.shapeIds ?? [dragState.id];
        const shapeOrigMap = dragState.shapeOrigMap ?? { [dragState.id]: dragState.origData };
        const primaryEl = activeComp.shapeElements.find((s) => s.id === dragState.id);
        // 用鼠标按下时的原始位置构造形状，避免 store 中已被移动过的位置导致偏移叠加
        const origShape = primaryEl ? { ...primaryEl, ...dragState.origData } as ShapeElement : null;
        let snappedDx = dx;
        let snappedDy = dy;
        let snapPt: { x: number; y: number } | null = null;
        if (origShape) {
          const movingIds = new Set(shapeIds);
          const snap = snapShapeMove(origShape, dx, dy, activeComp.shapeElements, movingIds, viewport.zoom);
          snappedDx = snap.dx;
          snappedDy = snap.dy;
          snapPt = snap.snapPoint;
        }
        setSnapPreview(snapPt);
        // Alignment guides
        const movingIds = new Set(shapeIds);
        const movedShapes = shapeIds.map((sid) => {
          const orig = shapeOrigMap[sid];
          const cur = activeComp.shapeElements.find((s) => s.id === sid);
          return cur && orig ? { ...cur, ...orig } as ShapeElement : null;
        }).filter(Boolean) as ShapeElement[];
        const movedBounds = movedShapes.map((s) => {
          return getShapeBounds({ ...s, ...moveShapeBy(s, snappedDx, snappedDy) } as ShapeElement);
        });
        const movedLeft = Math.min(...movedBounds.map((b) => b.left));
        const movedRight = Math.max(...movedBounds.map((b) => b.right));
        const movedTop = Math.min(...movedBounds.map((b) => b.top));
        const movedBottom = Math.max(...movedBounds.map((b) => b.bottom));
        setAlignmentGuides(computeAlignmentGuidesFromBounds(
          { left: movedLeft, right: movedRight, top: movedTop, bottom: movedBottom,
            cx: (movedLeft + movedRight) / 2, cy: (movedTop + movedBottom) / 2 },
          activeComp.shapeElements, movingIds, viewport.zoom,
        ));
        for (const sid of shapeIds) { const orig = shapeOrigMap[sid]; if (orig) applyShapeMove(activeComp.id, sid, orig, snappedDx, snappedDy, updateShapeElement); }
      } else if (dragState.type === 'handle' && dragState.shapeType && dragState.handle) {
        const origEl = activeComp.shapeElements.find((s) => s.id === dragState.id);
        if (origEl) {
          const origShape = { ...origEl, ...dragState.origData } as ShapeElement;
          const resized = computeResizedShape(dragState.shapeType, dragState.handle, dragState.origData, dx, dy);
          const resizedShape = { ...origShape, ...resized } as ShapeElement;
          const handlePos = getResizeHandles(resizedShape).find((h) => h.key === dragState.handle);
          let adjDx = dx, adjDy = dy;
          let snapPt: { x: number; y: number } | null = null;
          if (handlePos) {
            const SNAP_DIST = 8 / viewport.zoom;
            const targetPoints: { x: number; y: number }[] = [];
            for (const s of activeComp.shapeElements) {
              if (s.id === dragState.id) continue;
              targetPoints.push(...getShapeSnapPoints(s));
            }
            for (const pin of activeComp.pins) {
              targetPoints.push({ x: pin.position.x, y: pin.position.y });
            }
            let bestDist = Infinity;
            let bestTarget: { x: number; y: number } | null = null;
            for (const tp of targetPoints) {
              const d = Math.hypot(handlePos.x - tp.x, handlePos.y - tp.y);
              if (d <= SNAP_DIST && d < bestDist) { bestDist = d; bestTarget = tp; }
            }
            if (bestTarget) {
              adjDx = dx + Math.round(bestTarget.x - handlePos.x);
              adjDy = dy + Math.round(bestTarget.y - handlePos.y);
              snapPt = bestTarget;
            }
          }
          setSnapPreview(snapPt);
          // Line endpoint H/V snap
          if (dragState.shapeType === 'line' && (dragState.handle === 'start' || dragState.handle === 'end')) {
            const lineSnapThreshold = 5 / viewport.zoom;
            const resizedWithAdj = computeResizedShape('line', dragState.handle, dragState.origData, adjDx, adjDy);
            const dragX = dragState.handle === 'end' ? (resizedWithAdj.x2 ?? 0) : (resizedWithAdj.x1 ?? 0);
            const dragY = dragState.handle === 'end' ? (resizedWithAdj.y2 ?? 0) : (resizedWithAdj.y1 ?? 0);
            const fixedX = dragState.handle === 'end' ? (dragState.origData.x1 ?? 0) : (dragState.origData.x2 ?? 0);
            const fixedY = dragState.handle === 'end' ? (dragState.origData.y1 ?? 0) : (dragState.origData.y2 ?? 0);
            if (Math.abs(dragX - fixedX) < lineSnapThreshold) adjDx += Math.round(fixedX - dragX);
            if (Math.abs(dragY - fixedY) < lineSnapThreshold) adjDy += Math.round(fixedY - dragY);
          }
          const finalResize = computeResizedShape(dragState.shapeType, dragState.handle, dragState.origData, adjDx, adjDy);
          const finalShape = { ...origShape, ...finalResize } as ShapeElement;
          setAlignmentGuides(computeAlignmentGuidesFromBounds(
            getShapeBounds(finalShape), activeComp.shapeElements, new Set([dragState.id]), viewport.zoom,
          ));
          updateShapeElement(activeComp.id, dragState.id, finalResize);
        }
      } else if (dragState.type === 'group-handle' && dragState.handle && dragState.origGroupBounds && dragState.groupId) {
        const handle = dragState.handle;
        const orig = dragState.origGroupBounds;
        let newLeft = orig.left, newTop = orig.top, newRight = orig.right, newBottom = orig.bottom;
        if (handle.includes('w')) newLeft = orig.left + dx;
        if (handle.includes('e')) newRight = orig.right + dx;
        if (handle.includes('n')) newTop = orig.top + dy;
        if (handle.includes('s')) newBottom = orig.bottom + dy;
        const minSize = 10;
        if (newRight - newLeft < minSize) { if (handle.includes('w')) newLeft = newRight - minSize; else newRight = newLeft + minSize; }
        if (newBottom - newTop < minSize) { if (handle.includes('n')) newTop = newBottom - minSize; else newBottom = newTop + minSize; }
        const newBounds: Bounds = {
          left: Math.round(Math.min(newLeft, newRight)), top: Math.round(Math.min(newTop, newBottom)),
          right: Math.round(Math.max(newLeft, newRight)), bottom: Math.round(Math.max(newTop, newBottom)),
          width: Math.round(Math.abs(newRight - newLeft)), height: Math.round(Math.abs(newBottom - newTop)),
          cx: Math.round((newLeft + newRight) / 2), cy: Math.round((newTop + newBottom) / 2),
        };
        const groupShapes = activeComp.shapeElements.filter((s) => s.groupId === dragState.groupId);
        for (const shape of groupShapes) {
          const origData = dragState.shapeOrigData?.[shape.id];
          if (!origData) continue;
          const origShape = { ...shape, ...origData } as ShapeElement;
          const updates = scaleShapeInGroup(origShape, orig, newBounds);
          updateShapeElement(activeComp.id, shape.id, updates);
        }
        setSnapPreview(null);
        setAlignmentGuides(computeAlignmentGuidesFromBounds(
          newBounds, activeComp.shapeElements, new Set(groupShapes.map((s) => s.id)), viewport.zoom,
        ));
      }
      return;
    }

    if (!drawing || !activeComp) return;
    const { startX, startY } = drawing;
    const { defaultFill, defaultStroke, defaultStrokeWidth } = useCanvasStore.getState();
    const shapeType = activeTool.replace('draw-', '') as ShapeElement['type'];
    let preview: ShapeElement;
    switch (shapeType) {
      case 'rect':
        preview = { id: '__preview__', type: 'rect', fill: defaultFill, stroke: defaultStroke, strokeWidth: defaultStrokeWidth, opacity: 0.6, x: Math.min(startX, pos.x), y: Math.min(startY, pos.y), width: Math.abs(pos.x - startX), height: Math.abs(pos.y - startY) };
        break;
      case 'circle': {
        const r = Math.round(Math.hypot(pos.x - startX, pos.y - startY));
        preview = { id: '__preview__', type: 'circle', fill: defaultFill, stroke: defaultStroke, strokeWidth: defaultStrokeWidth, opacity: 0.6, cx: startX, cy: startY, r };
        break;
      }
      case 'ellipse':
        preview = { id: '__preview__', type: 'ellipse', fill: defaultFill, stroke: defaultStroke, strokeWidth: defaultStrokeWidth, opacity: 0.6, cx: startX, cy: startY, rx: Math.abs(pos.x - startX), ry: Math.abs(pos.y - startY) };
        break;
      case 'line': {
        let ex = pos.x, ey = pos.y;
        const lineSnap = 5 / viewport.zoom;
        if (Math.abs(pos.x - startX) < lineSnap) ex = startX;
        if (Math.abs(pos.y - startY) < lineSnap) ey = startY;
        preview = { id: '__preview__', type: 'line', fill: 'none', stroke: defaultStroke, strokeWidth: defaultStrokeWidth, opacity: 0.6, x1: startX, y1: startY, x2: ex, y2: ey };
        break;
      }
      default: return;
    }
    setDrawing({ startX, startY, preview });
  }, [rubberBand, dragState, drawing, activeComp, activeTool, getCanvasPos, setViewport, updatePin, updateShapeElement]);

  const handleMouseUp = useCallback(() => {
    if (rubberBand && activeComp) {
      const left = Math.min(rubberBand.startX, rubberBand.endX);
      const top = Math.min(rubberBand.startY, rubberBand.endY);
      const right = Math.max(rubberBand.startX, rubberBand.endX);
      const bottom = Math.max(rubberBand.startY, rubberBand.endY);
      selectShape(null); selectPin(null);
      if (right - left > 3 || bottom - top > 3) {
        for (const el of activeComp.shapeElements) {
          const b = getShapeBounds(el);
          if (b.cx >= left && b.cx <= right && b.cy >= top && b.cy <= bottom) selectShape(el.id, true);
        }
      }
      setRubberBand(null);
      return;
    }
    if (dragState) { setSnapPreview(null); setAlignmentGuides([]); setDragState(null); return; }
    if (drawing?.preview && activeComp) {
      const el = drawing.preview;
      const tooSmall = (el.type === 'rect' && ((el.width ?? 0) < 3 || (el.height ?? 0) < 3)) || (el.type === 'circle' && (el.r ?? 0) < 3) || (el.type === 'ellipse' && ((el.rx ?? 0) < 3 || (el.ry ?? 0) < 3));
      if (!tooSmall) addShapeElement(activeComp.id, { ...el, opacity: 1 });
    }
    setSnapPreview(null);
    setAlignmentGuides([]);
    setDrawing(null);
  }, [rubberBand, dragState, drawing, activeComp, addShapeElement, selectShape, selectPin]);

  // ─── Drawing (Canvas render loop) ───

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const { offsetX, offsetY, zoom } = viewport;

    // Clear entire canvas (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Apply viewport transform: screen = world * zoom + offset
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offsetX, dpr * offsetY);

    // Infinite grid
    drawInfiniteGrid(ctx, offsetX, offsetY, zoom, rect.width, rect.height);

    if (!activeComp) {
      const cw = canvasWidth / 2;
      const ch = canvasHeight / 2;
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${16 / zoom}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('请选择或新建一个元件', cw, ch);
      return;
    }

    const { selectedShapeIds, selectedPinIds, selectedConnectionId, flashedShapeIds, hoveredShapeIds, groupEditingGroupId } = useCanvasStore.getState();
    const matrix = matrices[activeComp.id];
    const connections = matrix?.connections ?? [];

    // Precompute which groups are selected
    const selectedGroupIds = new Set<string>();
    for (const sid of selectedShapeIds) {
      const s = activeComp.shapeElements.find((el) => el.id === sid);
      if (s?.groupId) selectedGroupIds.add(s.groupId);
    }

    // Connection lines
    for (const conn of connections) {
      if (!conn.visible || conn.state === 'none') continue;
      const pinA = activeComp.pins.find((p) => p.id === conn.pinAId);
      const pinB = activeComp.pins.find((p) => p.id === conn.pinBId);
      if (!pinA || !pinB) continue;
      const isClosed = conn.state === 'closed';
      const isSelected = selectedConnectionId === conn.id;
      ctx.save();
      ctx.strokeStyle = isSelected ? '#0ea5e9' : isClosed ? '#10b981' : '#f97316';
      ctx.lineWidth = (isSelected ? 3 : 2) / zoom;
      if (!isClosed) ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      const d = conn.pathSvg || computeLinePath(pinA.position, pinB.position);
      if (d) {
        const path = new Path2D(d);
        ctx.stroke(path);
      } else {
        ctx.moveTo(pinA.position.x, pinA.position.y);
        ctx.lineTo(pinB.position.x, pinB.position.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Shapes
    for (const el of activeComp.shapeElements) {
      const resolved = resolveShapeProps(el, matrices, activeComp.id);
      drawShapeOnCanvas(ctx, resolved);

      const isSelected = selectedShapeIds.includes(el.id);
      const isFlashed = flashedShapeIds.includes(el.id);

      // Hover highlight
      if (hoveredShapeIds.includes(el.id) && !isFlashed) {
        const b = getShapeBounds(resolved);
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#e11d48';
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 2.5 / zoom;
        ctx.beginPath();
        ctx.roundRect(b.left - 8, b.top - 8, b.width + 16, b.height + 16, 4 / zoom);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Selection box + handles (hide individual UI when shape is in a group that is selected as a whole)
      if (isSelected) {
        const inSelectedGroup = el.groupId && selectedGroupIds.has(el.groupId);
        const inGroupEditing = groupEditingGroupId && el.groupId === groupEditingGroupId;
        if (!inSelectedGroup || !!inGroupEditing) {
          const b = getShapeBounds(resolved);
          ctx.save();
          ctx.strokeStyle = '#0ea5e9';
          ctx.lineWidth = 1.5 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.strokeRect(b.left - 4, b.top - 4, b.width + 8, b.height + 8);
          ctx.setLineDash([]);
          ctx.restore();

          for (const h of getResizeHandles(resolved)) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, HANDLE_RADIUS / zoom, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#0ea5e9';
            ctx.lineWidth = 1.5 / zoom;
            ctx.stroke();
          }
        }
      }

      // Flash
      if (isFlashed) {
        const b = getShapeBounds(resolved);
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#ff9800';
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2.5 / zoom;
        ctx.beginPath();
        ctx.roundRect(b.left - 10, b.top - 10, b.width + 20, b.height + 20, 6 / zoom);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Group bounding boxes
    for (const groupId of selectedGroupIds) {
      const groupShapes = activeComp.shapeElements.filter((s) => s.groupId === groupId);
      const groupBounds = getGroupBounds(groupShapes);
      if (!groupBounds) continue;
      const isEditing = groupEditingGroupId === groupId;
      const pad = 6;
      if (isEditing) {
        ctx.save();
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.3)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.strokeRect(groupBounds.left - pad, groupBounds.top - pad, groupBounds.width + pad * 2, groupBounds.height + pad * 2);
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        ctx.save();
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([6 / zoom, 3 / zoom]);
        ctx.strokeRect(groupBounds.left - pad, groupBounds.top - pad, groupBounds.width + pad * 2, groupBounds.height + pad * 2);
        ctx.setLineDash([]);
        ctx.restore();
        const paddedBounds: Bounds = {
          left: groupBounds.left - pad, top: groupBounds.top - pad,
          right: groupBounds.right + pad, bottom: groupBounds.bottom + pad,
          width: groupBounds.width + pad * 2, height: groupBounds.height + pad * 2,
          cx: groupBounds.cx, cy: groupBounds.cy,
        };
        for (const h of getGroupResizeHandles(paddedBounds)) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, HANDLE_RADIUS / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#0ea5e9';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
        }
      }
    }

    // Drawing preview
    if (drawing?.preview) {
      drawShapeOnCanvas(ctx, drawing.preview);
    }

    // Rubber band
    if (rubberBand) {
      const rx = Math.min(rubberBand.startX, rubberBand.endX);
      const ry = Math.min(rubberBand.startY, rubberBand.endY);
      const rw = Math.abs(rubberBand.endX - rubberBand.startX);
      const rh = Math.abs(rubberBand.endY - rubberBand.startY);
      ctx.save();
      ctx.fillStyle = 'rgba(14,165,233,0.08)';
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 2 / zoom]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Pins
    for (const pin of activeComp.pins) {
      const isSelected = selectedPinIds.includes(pin.id);
      drawPin(ctx, pin.position.x, pin.position.y, pin.pinType, pin.label, isSelected, 5 / zoom);
    }

    // Snap preview
    if (snapPreview) {
      ctx.save();
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.arc(snapPreview.x, snapPreview.y, 6 / zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(snapPreview.x - 9 / zoom, snapPreview.y);
      ctx.lineTo(snapPreview.x + 9 / zoom, snapPreview.y);
      ctx.moveTo(snapPreview.x, snapPreview.y - 9 / zoom);
      ctx.lineTo(snapPreview.x, snapPreview.y + 9 / zoom);
      ctx.stroke();
      ctx.restore();
    }

    // Alignment guides
    if (alignmentGuides.length > 0) {
      const visLeft = -offsetX / zoom;
      const visTop = -offsetY / zoom;
      const visRight = visLeft + rect.width / zoom;
      const visBottom = visTop + rect.height / zoom;
      ctx.save();
      ctx.strokeStyle = '#ff4081';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      for (const g of alignmentGuides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          ctx.moveTo(g.value, visTop);
          ctx.lineTo(g.value, visBottom);
        } else {
          ctx.moveTo(visLeft, g.value);
          ctx.lineTo(visRight, g.value);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }


    // Zoom indicator (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Actual output preview (bottom-left corner, screen space)
    if (activeComp && activeComp.shapeElements.length > 0) {
      const dw = activeComp.displayWidth ?? 140;
      const dh = activeComp.displayHeight ?? 90;

      // Compute bounding box of all shapes + pins
      let sLeft = Infinity, sTop = Infinity, sRight = -Infinity, sBottom = -Infinity;
      for (const el of activeComp.shapeElements) {
        const b = getShapeBounds(resolveShapeProps(el, matrices, activeComp.id));
        if (b.width === 0 && b.height === 0) continue;
        sLeft = Math.min(sLeft, b.left);
        sTop = Math.min(sTop, b.top);
        sRight = Math.max(sRight, b.right);
        sBottom = Math.max(sBottom, b.bottom);
      }
      for (const pin of activeComp.pins) {
        sLeft = Math.min(sLeft, pin.position.x);
        sTop = Math.min(sTop, pin.position.y);
        sRight = Math.max(sRight, pin.position.x);
        sBottom = Math.max(sBottom, pin.position.y);
      }
      if (isFinite(sLeft)) {
        // Preview box = displayWidth × displayHeight pixels directly
        const pw = dw;
        const ph = dh;
        const px = 10;
        const py = rect.height - ph - 26;

        // Background card
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px - 4, py - 18, pw + 8, ph + 26, 4);
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = '#64748b';
        ctx.font = '10px "Microsoft YaHei", "PingFang SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`输出预览 ${dw}×${dh}`, px, py - 14);

        // Content bounding box
        const contentW = sRight - sLeft || 1;
        const contentH = sBottom - sTop || 1;

        // Uniform scale: fit content into output box, preserving aspect ratio
        const s = Math.min(dw / contentW, dh / contentH);
        const offsetX = (dw - contentW * s) / 2;
        const offsetY = (dh - contentH * s) / 2;

        // Clip to preview area
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, pw, ph);
        ctx.clip();

        ctx.translate(px + offsetX, py + offsetY);
        ctx.scale(s, s);
        ctx.translate(-sLeft, -sTop);

        // Draw shapes
        for (const el of activeComp.shapeElements) {
          const resolved = resolveShapeProps(el, matrices, activeComp.id);
          drawShapeOnCanvas(ctx, resolved);
        }

        // Draw connections
        const conns = matrices[activeComp.id]?.connections ?? [];
        for (const conn of conns) {
          if (!conn.visible || conn.state === 'none') continue;
          const pinA = activeComp.pins.find((p) => p.id === conn.pinAId);
          const pinB = activeComp.pins.find((p) => p.id === conn.pinBId);
          if (!pinA || !pinB) continue;
          ctx.save();
          ctx.strokeStyle = conn.state === 'closed' ? '#10b981' : '#f97316';
          ctx.lineWidth = 1.5;
          if (conn.state !== 'closed') ctx.setLineDash([4, 3]);
          ctx.beginPath();
          const d = conn.pathSvg || computeLinePath(pinA.position, pinB.position);
          if (d) { ctx.stroke(new Path2D(d)); }
          else { ctx.moveTo(pinA.position.x, pinA.position.y); ctx.lineTo(pinB.position.x, pinB.position.y); ctx.stroke(); }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Draw pins
        for (const pin of activeComp.pins) {
          drawPin(ctx, pin.position.x, pin.position.y, pin.pinType, '', false, 3);
        }

        ctx.restore(); // clip
        ctx.restore(); // background
      }
    }

    // Zoom percentage
    ctx.save();
    ctx.fillStyle = 'rgba(100,116,139,0.7)';
    ctx.font = '11px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(zoom * 100)}%`, rect.width - 8, rect.height - 6);
    ctx.restore();
  });

  // ─── Resize observer + non-passive wheel ───

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Non-passive wheel listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { offsetX, offsetY, zoom } = useCanvasStore.getState().viewport;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(10, Math.max(0.05, zoom * factor));

      const newOffsetX = mouseX - (mouseX - offsetX) * (newZoom / zoom);
      const newOffsetY = mouseY - (mouseY - offsetY) * (newZoom / zoom);

      useCanvasStore.getState().setViewport({ offsetX: newOffsetX, offsetY: newOffsetY, zoom: newZoom });
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  // ─── Render ───

  const cursor = dragState?.type === 'pan' ? 'grabbing' : isDrawTool ? 'crosshair' : activeTool === 'select' ? 'default' : 'grab';

  return (
    <div ref={containerRef} className={`component-canvas-container${dragOver ? ' drag-over' : ''}`}>
      <ShapeToolbar />
      <AlignmentToolbar />
      <ShortcutHelp />
      <canvas
        ref={canvasRef}
        className="component-canvas"
        style={{ cursor }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const sourceId = e.dataTransfer.getData('text/plain');
          if (!sourceId || !activeComponentId || sourceId === activeComponentId) return;
          const sourceComp = useComponentStore.getState().components.find((c) => c.id === sourceId);
          if (!sourceComp || sourceComp.shapeElements.length === 0) return;
          const pos = getCanvasPos(e);
          const allBounds = sourceComp.shapeElements.map((s) => getShapeBounds(s));
          const cx = (Math.min(...allBounds.map((b) => b.left)) + Math.max(...allBounds.map((b) => b.right))) / 2;
          const cy = (Math.min(...allBounds.map((b) => b.top)) + Math.max(...allBounds.map((b) => b.bottom))) / 2;
          const newIds = importSubComponent(activeComponentId, sourceComp, pos.x - cx, pos.y - cy);
          useCanvasStore.getState().selectShape(null);
          for (const id of newIds) selectShape(id, true);
        }}
      />
    </div>
  );
}
