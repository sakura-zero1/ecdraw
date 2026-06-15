import { useRef, useCallback, useEffect, useState } from 'react';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useDragStore } from '../../stores/useDragStore';
import type { ShapeElement, Pin, ShapeStateOverride } from '../../types';
import { computeLinePath } from '../../utils/geometry';
import { getShapeBounds, getGroupBounds, getGroupResizeHandles, scaleShapeInGroup, moveShapeBy } from '../../utils/alignment';
import type { Bounds } from '../../utils/alignment';
import { drawShapeOnCanvas, drawPin, buildShapePath, getTextBounds } from '../../utils/canvasRenderer';
import ShapeToolbar from './ShapeToolbar';
import AlignmentToolbar from './AlignmentToolbar';
import ShortcutHelp from './ShortcutHelp';
import './ComponentCanvas.css';

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_CANVAS_HEIGHT = 800;
const HANDLE_RADIUS = 5;
const HANDLE_HIT_RADIUS = 10;
const PIN_HIT_RADIUS = 20;

// ─── Pure logic functions (unchanged from SvgCanvas) ───

function getShapePosition(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect': return { x: el.x ?? 0, y: el.y ?? 0 };
    case 'circle': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'ellipse': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'line': return { x1: el.x1 ?? 0, y1: el.y1 ?? 0, x2: el.x2 ?? 0, y2: el.y2 ?? 0 };
    case 'text': return { x: el.x ?? 0, y: el.y ?? 0 };
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
  origOverrides?: Record<string, Record<string, unknown>>,
) {
  const updates: Record<string, number | object> = {};
  for (const [k, v] of Object.entries(orig)) {
    const isX = k.includes('x') || k === 'cx';
    const isY = k.includes('y') || k === 'cy';
    updates[k] = Math.round(v + (isX ? dx : isY ? dy : 0));
  }
  // Also move override position keys so stateClosed/stateOpen follow the shape.
  // Use ORIGINAL override values captured at drag start to avoid drift.
  if (origOverrides) {
    for (const [ovKey, ovOrig] of Object.entries(origOverrides)) {
      const ovUpdates: Record<string, number> = {};
      for (const [k, v] of Object.entries(ovOrig)) {
        if (typeof v !== 'number') continue;
        const isX = k.includes('x') || k === 'cx';
        const isY = k.includes('y') || k === 'cy';
        if (isX || isY) ovUpdates[k] = Math.round(v + (isX ? dx : isY ? dy : 0));
      }
      if (Object.keys(ovUpdates).length > 0) {
        updates[ovKey] = { ...ovOrig, ...ovUpdates };
      }
    }
  }
  update(compId, shapeId, updates as Partial<ShapeElement>);
}

/** Snapshot full override objects for shapes that have stateClosed/stateOpen */
function getShapeOverrideOrigins(shape: ShapeElement): Record<string, Record<string, unknown>> | undefined {
  const result: Record<string, Record<string, unknown>> = {};
  for (const ovKey of ['stateClosed', 'stateOpen'] as const) {
    const ov = shape[ovKey];
    if (ov && typeof ov === 'object') result[ovKey] = { ...ov as Record<string, unknown> };
  }
  return Object.keys(result).length > 0 ? result : undefined;
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
    case 'text': {
      const b = getTextBounds(el);
      return [
        { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height },
        { x: b.x + b.width / 2, y: b.y + b.height / 2 },
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

function resolveShapeProps(
  el: ShapeElement,
  matrices: Record<string, import('../../types').ConnectivityMatrix>,
  compId: string,
  previewState?: { connectionId: string; state: 'closed' | 'open' } | null,
): ShapeElement {
  if (el.linkedConnectionId) {
    const conn = matrices[compId]?.connections.find((c) => c.id === el.linkedConnectionId);
    if (!conn || conn.state === 'none') return el;
    // 态编辑预览模式：使用预览态而非连线实际态
    const activeState = (previewState && previewState.connectionId === el.linkedConnectionId)
      ? previewState.state
      : conn.state;
    const override = activeState === 'closed' ? el.stateClosed : el.stateOpen;
    if (override) return { ...el, ...override };
  }
  return el;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

const COLOR_PALETTE = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#92400e', 'transparent',
];

const SHAPE_TYPE_LABELS: Record<string, string> = {
  rect: '矩形', circle: '圆形', ellipse: '椭圆',
  line: '直线', polyline: '折线', path: '路径',
  arc: '弧形', text: '文字', image: '图片',
};

function hitTestPropertyEditor(
  cx: number, cy: number,
  shapeBounds: { left: number; top: number; width: number; height: number; right: number; bottom: number },
  zoom: number,
  shape: ShapeElement,
  editState: 'closed' | 'open',
  compId: string,
): boolean {
  const key = editState === 'closed' ? 'stateClosed' : 'stateOpen';
  const override = (shape as any)[key] as ShapeStateOverride | undefined;
  const pad = 8 / zoom;
  const gap = 4 / zoom;
  const swatchSize = 18 / zoom;
  const cols = 6;
  const fontSize = 9 / zoom;
  const numRowH = 18 / zoom;
  const numBtnR = 7 / zoom;
  const numValueW = 36 / zoom;
  const panelW = 160 / zoom;

  let px = shapeBounds.right + 10 / zoom;
  let py = shapeBounds.top;
  if (px + panelW > 800) px = shapeBounds.left - panelW - 10 / zoom;

  // Calculate panel height
  let panelH = pad;
  panelH += fontSize + gap + Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;
  panelH += fontSize + gap + Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;
  panelH += fontSize + gap + numRowH + gap;
  if (shape.type === 'rect' || shape.type === 'circle' || shape.type === 'ellipse') panelH += numRowH * 2 + gap;
  else if (shape.type === 'line') panelH += numRowH + gap;
  else panelH += numRowH + gap;
  panelH += pad;

  if (cx < px || cx > px + panelW || cy < py || cy > py + panelH) return false;

  const { updateShapeElement } = useComponentStore.getState();
  let curY = py + pad;

  // Fill swatches
  curY += fontSize + gap;
  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const sx = px + pad + col * (swatchSize + gap);
    const sy = curY + row * (swatchSize + gap);
    if (cx >= sx && cx <= sx + swatchSize && cy >= sy && cy <= sy + swatchSize) {
      updateShapeElement(compId, shape.id, { [key]: { ...override, fill: COLOR_PALETTE[i] } } as any);
      return true;
    }
  }
  curY += Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;

  // Stroke swatches
  curY += fontSize + gap;
  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const sx = px + pad + col * (swatchSize + gap);
    const sy = curY + row * (swatchSize + gap);
    if (cx >= sx && cx <= sx + swatchSize && cy >= sy && cy <= sy + swatchSize) {
      updateShapeElement(compId, shape.id, { [key]: { ...override, stroke: COLOR_PALETTE[i] } } as any);
      return true;
    }
  }
  curY += Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;

  // Helper: hit test a numeric +/- field
  const hitNumField = (fieldX: number, fieldY: number, _fieldW: number, label: string, fieldKey: string, val: number, step: number): boolean => {
    const midY = fieldY + numRowH / 2;
    const labelW = label.length * fontSize * 0.6 + gap;
    const minusCX = fieldX + labelW + numBtnR;
    const plusCX = minusCX + numBtnR * 2 + gap + numValueW + gap + numBtnR;
    if (Math.hypot(cx - minusCX, cy - midY) <= numBtnR) {
      updateShapeElement(compId, shape.id, { [key]: { ...override, [fieldKey]: Math.round((val - step) * 100) / 100 } } as any);
      return true;
    }
    if (Math.hypot(cx - plusCX, cy - midY) <= numBtnR) {
      updateShapeElement(compId, shape.id, { [key]: { ...override, [fieldKey]: Math.round((val + step) * 100) / 100 } } as any);
      return true;
    }
    return false;
  };

  const halfW = (panelW - pad * 2 - gap) / 2;
  const hitNumPair = (y: number, l1: string, k1: string, v1: number, s1: number, l2: string, k2: string, v2: number, s2: number): boolean => {
    if (hitNumField(px + pad, y, halfW, l1, k1, v1, s1)) return true;
    if (l2 && hitNumField(px + pad + halfW + gap, y, halfW, l2, k2, v2, s2)) return true;
    return false;
  };

  // Stroke width + Opacity
  curY += fontSize + gap;
  const sw = override?.strokeWidth ?? shape.strokeWidth ?? 1;
  const op = override?.opacity ?? shape.opacity ?? 1;
  if (hitNumPair(curY, '线宽', 'strokeWidth', sw, 0.5, '透明', 'opacity', op, 0.1)) return true;
  curY += numRowH + gap;

  if (shape.type === 'rect') {
    if (hitNumPair(curY, 'X', 'x', override?.x ?? shape.x ?? 0, 1, 'Y', 'y', override?.y ?? shape.y ?? 0, 1)) return true;
    curY += numRowH + gap;
    if (hitNumPair(curY, '宽', 'width', override?.width ?? shape.width ?? 0, 1, '高', 'height', override?.height ?? shape.height ?? 0, 1)) return true;
  } else if (shape.type === 'circle') {
    if (hitNumPair(curY, 'CX', 'cx', override?.cx ?? shape.cx ?? 0, 1, 'CY', 'cy', override?.cy ?? shape.cy ?? 0, 1)) return true;
    curY += numRowH + gap;
    if (hitNumPair(curY, 'R', 'r', override?.r ?? shape.r ?? 0, 1, '', '', 0, 0)) return true;
  } else if (shape.type === 'ellipse') {
    if (hitNumPair(curY, 'CX', 'cx', override?.cx ?? shape.cx ?? 0, 1, 'CY', 'cy', override?.cy ?? shape.cy ?? 0, 1)) return true;
    curY += numRowH + gap;
    if (hitNumPair(curY, 'RX', 'rx', override?.rx ?? shape.rx ?? 0, 1, 'RY', 'ry', override?.ry ?? shape.ry ?? 0, 1)) return true;
  } else if (shape.type === 'line') {
    if (hitNumPair(curY, 'X1', 'x1', override?.x1 ?? shape.x1 ?? 0, 1, 'Y1', 'y1', override?.y1 ?? shape.y1 ?? 0, 1)) return true;
  } else {
    if (hitNumPair(curY, 'X', 'x', override?.x ?? shape.x ?? 0, 1, 'Y', 'y', override?.y ?? shape.y ?? 0, 1)) return true;
  }
  return false;
}

function drawNumField(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, _w: number, h: number,
  zoom: number,
  label: string, value: number,
) {
  const fontSize = 9 / zoom;
  const btnR = 7 / zoom;
  const numValueW = 36 / zoom;
  const gap2 = 4 / zoom;
  const midY = y + h / 2;

  ctx.fillStyle = '#6b7280';
  ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, midY);
  const labelW = ctx.measureText(label).width + gap2;

  const minusCX = x + labelW + btnR;
  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath(); ctx.arc(minusCX, midY, btnR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.8 / zoom;
  ctx.beginPath(); ctx.arc(minusCX, midY, btnR, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.font = `bold ${10 / zoom}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('−', minusCX, midY);

  const valX = minusCX + btnR + gap2;
  ctx.fillStyle = '#374151'; ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(value * 100) / 100), valX + numValueW / 2, midY);

  const plusCX = valX + numValueW + gap2 + btnR;
  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath(); ctx.arc(plusCX, midY, btnR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.8 / zoom;
  ctx.beginPath(); ctx.arc(plusCX, midY, btnR, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.font = `bold ${10 / zoom}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('+', plusCX, midY);
}

function drawPropertyEditor(
  ctx: CanvasRenderingContext2D,
  shape: ShapeElement,
  editState: 'closed' | 'open',
  shapeBounds: { left: number; top: number; width: number; height: number; right: number; bottom: number },
  zoom: number,
) {
  const key = editState === 'closed' ? 'stateClosed' : 'stateOpen';
  const override = (shape as any)[key] as ShapeStateOverride | undefined;
  const currentFill = override?.fill ?? shape.fill;
  const currentStroke = override?.stroke ?? shape.stroke;

  const pad = 8 / zoom;
  const gap = 4 / zoom;
  const swatchSize = 18 / zoom;
  const cols = 6;
  const fontSize = 9 / zoom;
  const numRowH = 18 / zoom;
  const panelW = 160 / zoom;

  let px = shapeBounds.right + 10 / zoom;
  let py = shapeBounds.top;
  if (px + panelW > 800) px = shapeBounds.left - panelW - 10 / zoom;

  let panelH = pad;
  panelH += fontSize + gap + Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;
  panelH += fontSize + gap + Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;
  panelH += fontSize + gap + numRowH + gap;
  if (shape.type === 'rect' || shape.type === 'circle' || shape.type === 'ellipse') panelH += numRowH * 2 + gap;
  else if (shape.type === 'line') panelH += numRowH + gap;
  else panelH += numRowH + gap;
  panelH += pad;

  ctx.save();
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 6 / zoom;
  roundRect(ctx, px, py, panelW, panelH, 6 / zoom); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1 / zoom; ctx.stroke();
  ctx.restore();

  const textColor = '#374151';
  const halfW = (panelW - pad * 2 - gap) / 2;

  // Fill swatches
  let curY = py + pad;
  ctx.save(); ctx.fillStyle = textColor; ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('填充色', px + pad, curY); ctx.restore();
  curY += fontSize + gap;
  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const sx = px + pad + col * (swatchSize + gap), sy = curY + row * (swatchSize + gap);
    ctx.save();
    if (COLOR_PALETTE[i] === 'transparent') {
      ctx.fillStyle = '#f3f4f6'; ctx.fillRect(sx, sy, swatchSize, swatchSize);
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.5 / zoom; ctx.strokeRect(sx, sy, swatchSize, swatchSize);
      ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1 / zoom;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + swatchSize, sy + swatchSize); ctx.stroke();
    } else { ctx.fillStyle = COLOR_PALETTE[i]; ctx.fillRect(sx, sy, swatchSize, swatchSize); }
    if (currentFill === COLOR_PALETTE[i]) {
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(sx - 1 / zoom, sy - 1 / zoom, swatchSize + 2 / zoom, swatchSize + 2 / zoom);
    }
    ctx.restore();
  }
  curY += Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;

  // Stroke swatches
  ctx.save(); ctx.fillStyle = textColor; ctx.font = `${fontSize}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('描边色', px + pad, curY); ctx.restore();
  curY += fontSize + gap;
  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const sx = px + pad + col * (swatchSize + gap), sy = curY + row * (swatchSize + gap);
    ctx.save();
    if (COLOR_PALETTE[i] === 'transparent') {
      ctx.fillStyle = '#f3f4f6'; ctx.fillRect(sx, sy, swatchSize, swatchSize);
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 0.5 / zoom; ctx.strokeRect(sx, sy, swatchSize, swatchSize);
      ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1 / zoom;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + swatchSize, sy + swatchSize); ctx.stroke();
    } else { ctx.fillStyle = COLOR_PALETTE[i]; ctx.fillRect(sx, sy, swatchSize, swatchSize); }
    if (currentStroke === COLOR_PALETTE[i]) {
      ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(sx - 1 / zoom, sy - 1 / zoom, swatchSize + 2 / zoom, swatchSize + 2 / zoom);
    }
    ctx.restore();
  }
  curY += Math.ceil(COLOR_PALETTE.length / cols) * (swatchSize + gap) + gap;

  // Separator
  ctx.save(); ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1 / zoom;
  ctx.beginPath(); ctx.moveTo(px + pad, curY); ctx.lineTo(px + panelW - pad, curY); ctx.stroke(); ctx.restore();
  curY += gap;

  // StrokeWidth + Opacity
  ctx.save();
  drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, '线宽', override?.strokeWidth ?? shape.strokeWidth ?? 1);
  drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, '透明', override?.opacity ?? shape.opacity ?? 1);
  ctx.restore();
  curY += numRowH + gap;

  // Shape-specific
  if (shape.type === 'rect') {
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'X', override?.x ?? shape.x ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'Y', override?.y ?? shape.y ?? 0);
    ctx.restore(); curY += numRowH + gap;
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, '宽', override?.width ?? shape.width ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, '高', override?.height ?? shape.height ?? 0);
    ctx.restore();
  } else if (shape.type === 'circle') {
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'CX', override?.cx ?? shape.cx ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'CY', override?.cy ?? shape.cy ?? 0);
    ctx.restore(); curY += numRowH + gap;
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'R', override?.r ?? shape.r ?? 0);
    ctx.restore();
  } else if (shape.type === 'ellipse') {
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'CX', override?.cx ?? shape.cx ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'CY', override?.cy ?? shape.cy ?? 0);
    ctx.restore(); curY += numRowH + gap;
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'RX', override?.rx ?? shape.rx ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'RY', override?.ry ?? shape.ry ?? 0);
    ctx.restore();
  } else if (shape.type === 'line') {
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'X1', override?.x1 ?? shape.x1 ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'Y1', override?.y1 ?? shape.y1 ?? 0);
    ctx.restore();
  } else {
    ctx.save();
    drawNumField(ctx, px + pad, curY, halfW, numRowH, zoom, 'X', override?.x ?? shape.x ?? 0);
    drawNumField(ctx, px + pad + halfW + gap, curY, halfW, numRowH, zoom, 'Y', override?.y ?? shape.y ?? 0);
    ctx.restore();
  }
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
  const { activeTool, selectShape, selectPin, viewport, setViewport } = useCanvasStore();
  const { components, activeComponentId, addShapeElement, updateShapeElement, updatePin, pushUndo, importSubComponentScaled } = useComponentStore();
  const matrices = useConnectionStore((s) => s.matrices);

  const [dragOver, setDragOver] = useState(false);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; preview?: ShapeElement } | null>(null);
  const [dragState, setDragState] = useState<{
    type: 'shape' | 'pin' | 'handle' | 'pan' | 'group-handle'; id: string; handle?: string; shapeType?: ShapeElement['type'];
    startCanvasX: number; startCanvasY: number; origData: Record<string, number>;
    startOffsetX?: number; startOffsetY?: number;
    shapeIds?: string[]; shapeOrigMap?: Record<string, Record<string, number>>;
    shapeOvOrigMap?: Record<string, Record<string, Record<string, unknown>>>;
    pinOrigMap?: Record<string, { x: number; y: number }>;
    groupId?: string; origGroupBounds?: Bounds; shapeOrigData?: Record<string, Record<string, number>>;
    shapeOvOrigData?: Record<string, Record<string, Record<string, unknown>>>;
  } | null>(null);
  const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [snapPreview, setSnapPreview] = useState<{ x: number; y: number } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<{ axis: 'x' | 'y'; value: number }[]>([]);
  const preClickSelectionRef = useRef<string[]>([]);
  const wireFromRef = useRef<{ pinId: string; x: number; y: number } | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [wireDragNonce, setWireDragNonce] = useState(0);
  const wireHoverShapeRef = useRef<string | null>(null);
  const wireTagRectsRef = useRef<{ shapeId: string; x: number; y: number; w: number; h: number; closeX: number; closeY: number; closeR: number }[]>([]);
  const wireToolbarRectsRef = useRef<{
    closedBtn: { x: number; y: number; w: number; h: number };
    openBtn: { x: number; y: number; w: number; h: number };
    saveBtn: { x: number; y: number; w: number; h: number };
    closeBtn: { cx: number; cy: number; r: number };
    fullRect: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const wireShapeUnlinkRectsRef = useRef<{ shapeId: string; cx: number; cy: number; r: number }[]>([]);
  const wireToolbarOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [wireSaveFlash, setWireSaveFlash] = useState(0);

  const activeComp = components.find((c) => c.id === activeComponentId);
  const canvasWidth = activeComp?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = activeComp?.height ?? DEFAULT_CANVAS_HEIGHT;
  const isDrawTool = activeTool.startsWith('draw-');
  const isWireMode = activeTool === 'wire';
  const effectiveSelect = activeTool === 'select' || altHeld;

  // Clear wire state when leaving wire mode
  if (!isWireMode && wireFromRef.current) { wireFromRef.current = null; setWireDragNonce(0); }

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

  // ─── Center viewport on component shapes when switching components ───

  useEffect(() => {
    if (!activeComp || activeComp.shapeElements.length === 0) {
      setViewport({ offsetX: 0, offsetY: 0, zoom: 1 });
      return;
    }
    const bounds = getGroupBounds(activeComp.shapeElements);
    if (!bounds) {
      setViewport({ offsetX: 0, offsetY: 0, zoom: 1 });
      return;
    }
    const pad = 60;
    const fitZoomW = (canvasWidth - 2 * pad) / (bounds.width || 1);
    const fitZoomH = (canvasHeight - 2 * pad) / (bounds.height || 1);
    const fitZoom = Math.round(Math.min(fitZoomW, fitZoomH, 1.5) * 100) / 100;
    const centerX = Math.round(bounds.cx * fitZoom);
    const centerY = Math.round(bounds.cy * fitZoom);
    setViewport({
      offsetX: Math.round(canvasWidth / 2 - centerX),
      offsetY: Math.round(canvasHeight / 2 - centerY),
      zoom: fitZoom,
    });
  }, [activeComponentId]);

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
      if (target?.closest('input, textarea, select')) {
        // Allow global shape shortcuts even when an input is focused
        if (!hasMod) return;
        const clipboardKeys = ['c', 'v', 'd', 'x', 'z'];
        if (!clipboardKeys.includes(lower)) return;
      }
      if ((e.ctrlKey && e.shiftKey) || (e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey)) return;

      // Always read fresh state to avoid stale closures
      const cvs = useCanvasStore.getState();
      const { selectedShapeIds } = cvs;
      const store = useComponentStore.getState();
      const compId = store.activeComponentId;
      const matchKey = (code: string, key: string) => e.code === code || lower === key;

      if (!hasMod && !e.altKey) {
        if (matchKey('KeyQ', 'q')) { e.preventDefault(); cvs.setActiveTool('select'); return; }
        if (matchKey('KeyW', 'w')) { e.preventDefault(); cvs.setActiveTool('wire'); return; }
        if (matchKey('KeyA', 'a')) { e.preventDefault(); cvs.setActiveTool('draw-rect'); return; }
        if (matchKey('KeyS', 's')) { e.preventDefault(); cvs.setActiveTool('draw-circle'); return; }
        if (matchKey('KeyD', 'd')) { e.preventDefault(); cvs.setActiveTool('draw-ellipse'); return; }
        if (matchKey('KeyF', 'f')) { e.preventDefault(); cvs.setActiveTool('draw-line'); return; }
        if (matchKey('KeyT', 't')) { e.preventDefault(); cvs.setActiveTool('draw-text'); return; }
        if (e.key === 'Escape') {
          e.preventDefault();
          if (wireFromRef.current) {
            wireFromRef.current = null;
            setWireDragNonce(0);
            cvs.selectPin(null);
            return;
          }
          if (cvs.groupEditingGroupId) {
            const comp = store.components.find((c) => c.id === store.activeComponentId);
            cvs.exitGroupEditing();
            if (comp) {
              const groupShapes = comp.shapeElements.filter((s) => s.groupId === cvs.groupEditingGroupId);
              for (const s of groupShapes) cvs.selectShape(s.id, true);
            }
          } else {
            cvs.clearSelection();
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
        if (comp && (selectedShapeIds.length > 0 || cvs.selectedPinIds.length > 0)) {
          const nextIds: string[] = [];
          for (const sid of selectedShapeIds) { const newId = store.cloneShapeElement(compId, sid); if (newId) nextIds.push(newId); }
          const nextPinIds: string[] = [];
          for (const pid of cvs.selectedPinIds) {
            const pin = comp.pins.find((p) => p.id === pid);
            if (!pin) continue;
            const newPinId = store.addPin(compId, pin.label, pin.pinType);
            store.updatePin(compId, newPinId, { position: { x: pin.position.x + 20, y: pin.position.y + 20 }, visible: pin.visible });
            nextPinIds.push(newPinId);
          }
          const allNextIds = [...nextIds, ...nextPinIds];
          if (allNextIds.length > 1) {
            const newGroupId = crypto.randomUUID();
            for (const nid of nextIds) store.updateShapeElement(compId, nid, { groupId: newGroupId });
            for (const npid of nextPinIds) store.updatePin(compId, npid, { groupId: newGroupId });
          }
          cvs.selectShape(null);
          cvs.selectPin(null);
          for (const nid of nextIds) cvs.selectShape(nid, true);
          for (const npid of nextPinIds) cvs.selectPin(npid, true);
        }
        return;
      }
      if (hasMod && lower === 'c') {
        e.preventDefault();
        if ((selectedShapeIds.length > 0 || cvs.selectedPinIds.length > 0) && compId) {
          const comp = store.getComponent(compId);
          if (comp) {
            const els = selectedShapeIds.map((sid) => comp.shapeElements.find((s) => s.id === sid)).filter(Boolean) as ShapeElement[];
            const pins = cvs.selectedPinIds.map((pid) => comp.pins.find((p) => p.id === pid)).filter(Boolean) as Pin[];
            cvs.setClipboard({ shapes: els, pins, connections: [] });
          }
        }
        return;
      }
      if (hasMod && lower === 'v') {
        e.preventDefault();
        const clip = cvs.clipboard;
        const clipShapes = clip.shapes ?? [];
        const clipPins = clip.pins ?? [];
        if ((clipShapes.length > 0 || clipPins.length > 0) && compId) {
          const newGroupId = clipShapes.length > 1 && clipShapes.every((el) => el.groupId && el.groupId === clipShapes[0].groupId) ? crypto.randomUUID() : undefined;
          const nextIds: string[] = [];
          for (const el of clipShapes) {
            const newId = store.cloneFromClipboard(compId, el, newGroupId);
            if (newId) nextIds.push(newId);
          }
          const nextPinIds: string[] = [];
          const newPinGroupId = clipPins.length > 1 ? crypto.randomUUID() : undefined;
          for (const pin of clipPins) {
            const newPinId = store.addPin(compId, pin.label, pin.pinType);
            store.updatePin(compId, newPinId, {
              position: { x: pin.position.x + 20, y: pin.position.y + 20 },
              visible: pin.visible,
              groupId: newPinGroupId,
            });
            nextPinIds.push(newPinId);
          }
          cvs.selectShape(null);
          cvs.selectPin(null);
          for (const nid of nextIds) cvs.selectShape(nid, true);
          for (const npid of nextPinIds) cvs.selectPin(npid, true);
        }
        return;
      }
      if (hasMod && lower === 'z') { e.preventDefault(); store.undo(); cvs.clearSelection(); return; }
      if (hasMod && (lower === '=' || lower === '+')) { e.preventDefault(); cvs.zoomIn(); return; }
      if (hasMod && lower === '-') { e.preventDefault(); cvs.zoomOut(); return; }
      if (hasMod && lower === '0') { e.preventDefault(); cvs.resetView(); return; }
      if (hasMod && lower === 'x') {
        e.preventDefault();
        if ((selectedShapeIds.length > 0 || cvs.selectedPinIds.length > 0) && compId) {
          const comp = store.getComponent(compId);
          if (comp) {
            const els = selectedShapeIds.map((sid) => comp.shapeElements.find((s) => s.id === sid)).filter(Boolean) as ShapeElement[];
            const pins = cvs.selectedPinIds.map((pid) => comp.pins.find((p) => p.id === pid)).filter(Boolean) as Pin[];
            cvs.setClipboard({ shapes: els, pins, connections: [] });
          }
          store.removeMany(compId, selectedShapeIds, cvs.selectedPinIds);
          cvs.clearSelection();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if ((selectedShapeIds.length > 0 || cvs.selectedPinIds.length > 0) && compId) {
          store.removeMany(compId, selectedShapeIds, cvs.selectedPinIds);
          cvs.clearSelection();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

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

  const hitTestConnection = useCallback((cx: number, cy: number): string | null => {
    if (!activeComp) return null;
    const matrix = matrices[activeComp.id];
    if (!matrix) return null;
    const threshold = 8 / viewport.zoom;
    for (const conn of matrix.connections) {
      if (!conn.visible || conn.state === 'none') continue;
      const pinA = activeComp.pins.find((p) => p.id === conn.pinAId);
      const pinB = activeComp.pins.find((p) => p.id === conn.pinBId);
      if (!pinA || !pinB) continue;
      // Distance from point to line segment
      const dx = pinB.position.x - pinA.position.x;
      const dy = pinB.position.y - pinA.position.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      const t = Math.max(0, Math.min(1, ((cx - pinA.position.x) * dx + (cy - pinA.position.y) * dy) / lenSq));
      const projX = pinA.position.x + t * dx;
      const projY = pinA.position.y + t * dy;
      if (Math.hypot(cx - projX, cy - projY) <= threshold) return conn.id;
    }
    return null;
  }, [activeComp, matrices, viewport.zoom]);

  const hitTestShape = useCallback((cx: number, cy: number, previewStateParam?: { connectionId: string; state: 'closed' | 'open' } | null): string | null => {
    if (!activeComp) return null;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    const hitMargin = 4 / viewport.zoom;
    // Reset transform so isPointInPath/Stroke uses raw world coordinates
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = activeComp.shapeElements.length - 1; i >= 0; i--) {
      const el = activeComp.shapeElements[i];
      const resolved = resolveShapeProps(el, matrices, activeComp.id, previewStateParam);
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
                const shapeOvOrigData: Record<string, Record<string, Record<string, unknown>>> = {};
                for (const s of groupShapes) { shapeOrigData[s.id] = getShapeResizeData(s); const sOv = getShapeOverrideOrigins(s); if (sOv) shapeOvOrigData[s.id] = sOv; }
                const pinOrigMap: Record<string, { x: number; y: number }> = {};
                for (const pin of activeComp.pins) { if (pin.groupId === commonGroupId) pinOrigMap[pin.id] = { ...pin.position }; }
                setDragState({
                  type: 'group-handle', id: '', handle: h.key,
                  startCanvasX: pos.x, startCanvasY: pos.y,
                  origData: {},
                  groupId: commonGroupId, origGroupBounds: groupBounds, shapeOrigData, shapeOvOrigData, pinOrigMap,
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
        // Endpoints are editable only when the line is ungrouped, or we are inside the
        // matching group-editing mode. Otherwise treat any hit (including endpoints) as
        // a body hit so the whole group gets selected — matches the "double-click to
        // edit inside" requirement.
        const endpointEditable = !el.groupId || groupEditingId === el.groupId;
        if (endpointEditable && dStart <= endpointR && dStart <= dEnd) {
          pushUndo(); selectShape(el.id);
          setDragState({ type: 'handle', id: el.id, shapeType: 'line', handle: 'start', startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapeResizeData(el) });
        } else if (endpointEditable && dEnd <= endpointR) {
          pushUndo(); selectShape(el.id);
          setDragState({ type: 'handle', id: el.id, shapeType: 'line', handle: 'end', startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapeResizeData(el) });
        } else {
          // On line body → move
          if (shift) { selectShape(el.id, true); return; }
          pushUndo();
          if (el.groupId && groupEditingId === el.groupId) {
            // In group editing mode — move just this line
            selectShape(el.id);
            const sOvLine = getShapeOverrideOrigins(el);
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeOvOrigMap: sOvLine ? { [el.id]: sOvLine } : undefined });
          } else if (el.groupId) {
            const groupIds = activeComp.shapeElements.filter((s) => s.groupId === el.groupId).map((s) => s.id);
            selectShape(null);
            for (const gid of groupIds) selectShape(gid, true);
            for (const pin of activeComp.pins) { if (pin.groupId === el.groupId) selectPin(pin.id, true); }
            const shapeOrigMap: Record<string, Record<string, number>> = {};
            const shapeOvOrigMap: Record<string, Record<string, Record<string, unknown>>> = {};
            for (const sid of groupIds) { const s = activeComp.shapeElements.find((s2) => s2.id === sid); if (s) { shapeOrigMap[sid] = getShapePosition(s); const sOv = getShapeOverrideOrigins(s); if (sOv) shapeOvOrigMap[sid] = sOv; } }
            const pinOrigMap: Record<string, { x: number; y: number }> = {};
            for (const pin of activeComp.pins) { if (pin.groupId === el.groupId) pinOrigMap[pin.id] = { ...pin.position }; }
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeIds: groupIds, shapeOrigMap, shapeOvOrigMap, pinOrigMap });
          } else {
            // Ungrouped line
            selectShape(el.id);
            const sOvLineUngrouped = getShapeOverrideOrigins(el);
            setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeOvOrigMap: sOvLineUngrouped ? { [el.id]: sOvLineUngrouped } : undefined });
          }
        }
        return;
      }
    }

    // Wire mode: drag from pin to pin, click connection to enter state editing
    if (isWireMode && activeComp) {
      const cvs = useCanvasStore.getState();
      const { wireStateEditing: wse, selectedConnectionId: selConnId, wireEditState: wEditState } = cvs;

      // ─── 态编辑模式 ───
      if (wse && selConnId) {
        // 1. 检查工具栏按钮点击
        const tbRects = wireToolbarRectsRef.current;
        if (tbRects) {
          const { closedBtn, openBtn, saveBtn, closeBtn } = tbRects;
          // 闭合态按钮
          if (pos.x >= closedBtn.x && pos.x <= closedBtn.x + closedBtn.w && pos.y >= closedBtn.y && pos.y <= closedBtn.y + closedBtn.h) {
            e.preventDefault();
            cvs.setWireEditState('closed');
            selectPin(null);
            return;
          }
          // 断开态按钮
          if (pos.x >= openBtn.x && pos.x <= openBtn.x + openBtn.w && pos.y >= openBtn.y && pos.y <= openBtn.y + openBtn.h) {
            e.preventDefault();
            cvs.setWireEditState('open');
            selectPin(null);
            return;
          }
          // 保存按钮（仅确认标记，修改已实时生效）
          if (pos.x >= saveBtn.x && pos.x <= saveBtn.x + saveBtn.w && pos.y >= saveBtn.y && pos.y <= saveBtn.y + saveBtn.h) {
            e.preventDefault();
            setWireSaveFlash(Date.now());
            selectPin(null);
            return;
          }
          // 关闭按钮
          if (Math.hypot(pos.x - closeBtn.cx, pos.y - closeBtn.cy) <= closeBtn.r) {
            e.preventDefault();
            cvs.exitWireStateEditing();
            selectPin(null);
            return;
          }
          // 拖拽工具栏（点击工具栏空白区域）
          if (pos.x >= tbRects.fullRect.x && pos.x <= tbRects.fullRect.x + tbRects.fullRect.w &&
              pos.y >= tbRects.fullRect.y && pos.y <= tbRects.fullRect.y + tbRects.fullRect.h) {
            e.preventDefault();
            setDragState({
              type: 'pan' as const, id: '__toolbar__', startCanvasX: e.clientX, startCanvasY: e.clientY,
              origData: {},
              startOffsetX: wireToolbarOffsetRef.current.x, startOffsetY: wireToolbarOffsetRef.current.y,
            });
            return;
          }
        }

        // 2. 计算当前 previewState 用于碰撞检测
        const currentPreviewState = { connectionId: selConnId, state: wEditState };

        // 3. 检查选中形状的 resize 手柄
        const handleHit = hitTestHandle(pos.x, pos.y);
        if (handleHit) {
          const el = activeComp.shapeElements.find((s) => s.id === handleHit.shapeId);
          if (el && el.linkedConnectionId === selConnId) {
            e.preventDefault();
            pushUndo();
            selectShape(handleHit.shapeId);
            // 态编辑模式下：origData 需要记录覆盖属性的原始值
            const ovKey = wEditState === 'closed' ? 'stateClosed' : 'stateOpen';
            const override = (el as any)[ovKey] as ShapeStateOverride | undefined;
            const origData = getShapeResizeData(override ? { ...el, ...override } as ShapeElement : el);
            setDragState({
              type: 'handle', id: handleHit.shapeId, shapeType: el.type,
              handle: handleHit.handle, startCanvasX: pos.x, startCanvasY: pos.y,
              origData,
            });
            selectPin(null);
            return;
          }
        }

        // 4. 检查关联形状的 × 取消按钮
        const unlinkBtns = wireShapeUnlinkRectsRef.current;
        for (const btn of unlinkBtns) {
          if (Math.hypot(pos.x - btn.cx, pos.y - btn.cy) <= btn.r + 4 / viewport.zoom) {
            e.preventDefault();
            useComponentStore.getState().updateShapeElement(activeComp.id, btn.shapeId, { linkedConnectionId: undefined } as any);
            selectShape(null);
            selectPin(null);
            return;
          }
        }

        // 5. 检查形状点击
        const shapeHit = hitTestShape(pos.x, pos.y, currentPreviewState);
        if (shapeHit) {
          e.preventDefault();
          const shape = activeComp.shapeElements.find(s => s.id === shapeHit);
          if (shape) {
            if (shape.linkedConnectionId === selConnId) {
              // 点击关联形状 → 选中并准备拖动
              pushUndo();
              selectShape(shapeHit);
              const ovKey = wEditState === 'closed' ? 'stateClosed' : 'stateOpen';
              const override = (shape as any)[ovKey] as ShapeStateOverride | undefined;
              const resolvedPos = override ? { ...shape, ...override } as ShapeElement : shape;
              setDragState({
                type: 'shape', id: shapeHit,
                startCanvasX: pos.x, startCanvasY: pos.y,
                origData: getShapePosition(resolvedPos),
              });
            } else {
              // 非关联形状 → 关联到当前连线
              useComponentStore.getState().updateShapeElement(activeComp.id, shapeHit, { linkedConnectionId: selConnId } as any);
              selectShape(shapeHit);
            }
          }
          selectPin(null);
          return;
        }

        // 6. 点击空白 → 取消形状选择（保持态编辑模式）
        selectShape(null);
        selectPin(null);
        return;
      }

      // ─── 非态编辑模式（原有拖线 + 选连线逻辑） ───
      const pinHit = hitTestPin(pos.x, pos.y);
      if (pinHit) {
        e.preventDefault();
        const pin = activeComp.pins.find((p) => p.id === pinHit)!;
        wireFromRef.current = { pinId: pinHit, x: pin.position.x, y: pin.position.y };
        mouseWorldPosRef.current = pos;
        setWireDragNonce(1);
        selectPin(pinHit);
        return;
      }

      // 点击连线 → 中点×删除连线，否则进入态编辑模式
      const connHit = hitTestConnection(pos.x, pos.y);
      if (connHit) {
        e.preventDefault();
        // Check if clicking near the × mark at midpoint → delete
        const connMatrix = useConnectionStore.getState().matrices[activeComp.id];
        const conn = connMatrix?.connections.find((c) => c.id === connHit);
        if (conn) {
          const pinA = activeComp.pins.find((p) => p.id === conn.pinAId);
          const pinB = activeComp.pins.find((p) => p.id === conn.pinBId);
          if (pinA && pinB) {
            const mx = (pinA.position.x + pinB.position.x) / 2;
            const my = (pinA.position.y + pinB.position.y) / 2;
            if (Math.hypot(pos.x - mx, pos.y - my) <= 14 / viewport.zoom) {
              useConnectionStore.getState().removeConnection(activeComp.id, connHit);
              selectPin(null);
              return;
            }
          }
        }
        cvs.selectConnection(connHit);
        wireToolbarOffsetRef.current = { x: 0, y: 0 };
        cvs.enterWireStateEditing();
        selectPin(null);
        return;
      }

      selectPin(null);
      return;
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
          const sOvGroupEdit = getShapeOverrideOrigins(el);
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeOvOrigMap: sOvGroupEdit ? { [el.id]: sOvGroupEdit } : undefined });
        } else if (el.groupId) {
          // Not in group editing — select whole group
          const groupIds = activeComp.shapeElements.filter((s) => s.groupId === el.groupId).map((s) => s.id);
          selectShape(null);
          for (const gid of groupIds) selectShape(gid, true);
          for (const pin of activeComp.pins) { if (pin.groupId === el.groupId) selectPin(pin.id, true); }
          const shapeOrigMap: Record<string, Record<string, number>> = {};
          const shapeOvOrigMap: Record<string, Record<string, Record<string, unknown>>> = {};
          for (const sid of groupIds) { const s = activeComp.shapeElements.find((s2) => s2.id === sid); if (s) { shapeOrigMap[sid] = getShapePosition(s); const sOv = getShapeOverrideOrigins(s); if (sOv) shapeOvOrigMap[sid] = sOv; } }
          const pinOrigMap: Record<string, { x: number; y: number }> = {};
          for (const pin of activeComp.pins) { if (pin.groupId === el.groupId) pinOrigMap[pin.id] = { ...pin.position }; }
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeIds: groupIds, shapeOrigMap, shapeOvOrigMap, pinOrigMap });
          if (groupEditingId) useCanvasStore.getState().exitGroupEditing();
        } else {
          // Ungrouped shape
          selectShape(el.id);
          const sOvUngrouped = getShapeOverrideOrigins(el);
          setDragState({ type: 'shape', id: el.id, startCanvasX: pos.x, startCanvasY: pos.y, origData: getShapePosition(el), shapeOvOrigMap: sOvUngrouped ? { [el.id]: sOvUngrouped } : undefined });
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
      if (activeTool === 'draw-text') {
        // Text tool: click to place immediately
        const { defaultStroke } = useCanvasStore.getState();
        const textShape: Omit<ShapeElement, 'id'> = {
          type: 'text',
          fill: defaultStroke,
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 1,
          x: pos.x,
          y: pos.y,
          text: '文字',
          fontSize: 16,
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        };
        const newId = addShapeElement(activeComp.id, textShape);
        if (newId) {
          const cvs = useCanvasStore.getState();
          cvs.selectShape(null);
          cvs.selectShape(newId);
        }
        return;
      }
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
    // Pan drag (viewport or toolbar)
    if (dragState?.type === 'pan') {
      const dx = e.clientX - dragState.startCanvasX;
      const dy = e.clientY - dragState.startCanvasY;
      if (dragState.id === '__toolbar__') {
        const zoom = useCanvasStore.getState().viewport.zoom;
        wireToolbarOffsetRef.current = {
          x: (dragState.startOffsetX ?? 0) + dx / zoom,
          y: (dragState.startOffsetY ?? 0) + dy / zoom,
        };
        setWireDragNonce((n) => n + 1); // trigger re-render
      } else {
        setViewport({
          offsetX: (dragState.startOffsetX ?? 0) + dx,
          offsetY: (dragState.startOffsetY ?? 0) + dy,
        });
      }
      return;
    }

    const pos = getCanvasPos(e);

    // Wire mode: always track mouse and re-render for hover / drag feedback
    if (isWireMode) {
      mouseWorldPosRef.current = pos;
      setWireDragNonce((n) => n + 1);
      if (wireFromRef.current) return;
    }

    if (wireFromRef.current) {
      return;
    }

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
        for (const sid of shapeIds) {
          const orig = shapeOrigMap[sid];
          if (!orig) continue;
          // 态编辑模式：写入覆盖属性而非基础属性
          const cvsState = useCanvasStore.getState();
          if (cvsState.wireStateEditing && cvsState.selectedConnectionId) {
            const el = activeComp.shapeElements.find(s => s.id === sid);
            if (el && el.linkedConnectionId === cvsState.selectedConnectionId) {
              const ovKey = cvsState.wireEditState === 'closed' ? 'stateClosed' : 'stateOpen';
              const existingOv = ((el as any)[ovKey] ?? {}) as Record<string, unknown>;
              const newOv: Record<string, unknown> = { ...existingOv };
              for (const [k, v] of Object.entries(orig)) {
                const isX = k.includes('x') || k === 'cx';
                const isY = k.includes('y') || k === 'cy';
                newOv[k] = Math.round((v as number) + (isX ? snappedDx : isY ? snappedDy : 0));
              }
              updateShapeElement(activeComp.id, sid, { [ovKey]: newOv } as any);
              continue;
            }
          }
          applyShapeMove(activeComp.id, sid, orig, snappedDx, snappedDy, updateShapeElement, dragState.shapeOvOrigMap?.[sid]);
        }
        // Move pins in the same group
        if (dragState.pinOrigMap) {
          for (const [pinId, origPos] of Object.entries(dragState.pinOrigMap)) {
            updatePin(activeComp.id, pinId, { position: { x: Math.round(origPos.x + snappedDx), y: Math.round(origPos.y + snappedDy) } });
          }
        }
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
          // 态编辑模式：写入覆盖属性而非基础属性
          const cvsState = useCanvasStore.getState();
          if (cvsState.wireStateEditing && cvsState.selectedConnectionId) {
            const el = activeComp.shapeElements.find(s => s.id === dragState.id);
            if (el && el.linkedConnectionId === cvsState.selectedConnectionId) {
              const ovKey = cvsState.wireEditState === 'closed' ? 'stateClosed' : 'stateOpen';
              const existingOv = (el as any)[ovKey] as ShapeStateOverride | undefined;
              updateShapeElement(activeComp.id, dragState.id, { [ovKey]: { ...(existingOv ?? {}), ...finalResize } } as any);
            } else {
              updateShapeElement(activeComp.id, dragState.id, finalResize);
            }
          } else {
            updateShapeElement(activeComp.id, dragState.id, finalResize);
          }
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
        // Scale pins in the same group
        const scaleX = newBounds.width / (orig.width || 1);
        const scaleY = newBounds.height / (orig.height || 1);
        for (const pin of activeComp.pins) {
          if (pin.groupId !== dragState.groupId) continue;
          const pinOrig = dragState.pinOrigMap?.[pin.id];
          if (!pinOrig) continue;
          const relX = pinOrig.x - orig.left;
          const relY = pinOrig.y - orig.top;
          updatePin(activeComp.id, pin.id, {
            position: {
              x: Math.round(newBounds.left + relX * scaleX),
              y: Math.round(newBounds.top + relY * scaleY),
            },
          });
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
  }, [rubberBand, dragState, drawing, activeComp, activeTool, wireDragNonce, getCanvasPos, setViewport, updatePin, updateShapeElement]);

  const handleMouseUp = useCallback(() => {
    // Wire mode: complete connection on release
    if (wireFromRef.current && activeComp && wireDragNonce > 0) {
      const from = wireFromRef.current;
      const mousePos = mouseWorldPosRef.current;
      const hitPin = hitTestPin(mousePos.x, mousePos.y);
      if (hitPin && hitPin !== from.pinId) {
        useConnectionStore.getState().cycleCellState(activeComp.id, from.pinId, hitPin);
      }
      wireFromRef.current = null;
      setWireDragNonce(0);
      selectPin(null);
      return;
    }

    if (rubberBand && activeComp) {
      const left = Math.min(rubberBand.startX, rubberBand.endX);
      const top = Math.min(rubberBand.startY, rubberBand.endY);
      const right = Math.max(rubberBand.startX, rubberBand.endX);
      const bottom = Math.max(rubberBand.startY, rubberBand.endY);
      if (right - left > 3 || bottom - top > 3) {
        const shapeIds: string[] = [];
        for (const el of activeComp.shapeElements) {
          const b = getShapeBounds(el);
          if (b.cx >= left && b.cx <= right && b.cy >= top && b.cy <= bottom) shapeIds.push(el.id);
        }
        const pinIds: string[] = [];
        for (const pin of activeComp.pins) {
          if (pin.position.x >= left && pin.position.x <= right && pin.position.y >= top && pin.position.y <= bottom) pinIds.push(pin.id);
        }
        useCanvasStore.getState().selectMany(shapeIds, pinIds);
      } else {
        useCanvasStore.getState().clearSelection();
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
  }, [rubberBand, dragState, drawing, activeComp, addShapeElement, wireDragNonce, hitTestPin]);

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

    const { selectedShapeIds, selectedPinIds, selectedConnectionId, flashedShapeIds, hoveredShapeIds, groupEditingGroupId, wireStateEditing, wireEditState } = useCanvasStore.getState();
    const matrix = matrices[activeComp.id];
    const connections = matrix?.connections ?? [];

    // 态编辑预览：当处于态编辑模式时，关联形状使用 wireEditState 决定覆盖
    const previewState = wireStateEditing && selectedConnectionId
      ? { connectionId: selectedConnectionId, state: wireEditState }
      : null;

    // Precompute which groups are selected
    const selectedGroupIds = new Set<string>();
    for (const sid of selectedShapeIds) {
      const s = activeComp.shapeElements.find((el) => el.id === sid);
      if (s?.groupId) selectedGroupIds.add(s.groupId);
    }

    // Shapes
    for (const el of activeComp.shapeElements) {
      const resolved = resolveShapeProps(el, matrices, activeComp.id, previewState);
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

    // Pins — 态编辑模式下仅显示选中连线关联的引脚
    // Compute the set of pin IDs that belong to the selected connection (when in wire state editing)
    const selConnPinIds = (() => {
      if (!wireStateEditing || !selectedConnectionId) return null; // null = no filtering needed
      const selConn = connections.find((c) => c.id === selectedConnectionId);
      if (!selConn) return new Set<string>();
      return new Set([selConn.pinAId, selConn.pinBId]);
    })();
    {
      const pinRadius = isWireMode ? 7 / zoom : 5 / zoom;
      for (const pin of activeComp.pins) {
        if (selConnPinIds && !selConnPinIds.has(pin.id)) continue; // 态编辑模式下隐藏不相关的引脚
        const isSelected = selectedPinIds.includes(pin.id);
        drawPin(ctx, pin.position.x, pin.position.y, pin.pinType, pin.label, isSelected, pinRadius);
      }
    }

    // Connection lines — 态编辑模式下仅显示选中连线
    for (const conn of connections) {
      if (!conn.visible || conn.state === 'none') continue;
      if (wireStateEditing && selectedConnectionId && conn.id !== selectedConnectionId) continue; // 态编辑模式下隐藏不相关的连线
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

    // Wire mode overlay (drawn on top of everything)
    if (isWireMode) {
      // Rubber-band line while dragging from a pin
      if (wireFromRef.current && wireDragNonce > 0) {
        const from = wireFromRef.current;
        const mousePos = mouseWorldPosRef.current;
        const snapTarget = hitTestPin(mousePos.x, mousePos.y);
        const snapPin = snapTarget && snapTarget !== from.pinId
          ? activeComp.pins.find((p) => p.id === snapTarget) ?? null : null;

        const targetX = snapPin?.position.x ?? mousePos.x;
        const targetY = snapPin?.position.y ?? mousePos.y;

        // Target pin: big green glow + snap ring (drawn first so line overlaps)
        if (snapPin) {
          ctx.save();
          // Outer glow
          ctx.fillStyle = 'rgba(34,197,94,0.25)';
          ctx.beginPath();
          ctx.arc(snapPin.position.x, snapPin.position.y, 20 / zoom, 0, Math.PI * 2);
          ctx.fill();
          // Solid ring
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 3 / zoom;
          ctx.beginPath();
          ctx.arc(snapPin.position.x, snapPin.position.y, 12 / zoom, 0, Math.PI * 2);
          ctx.stroke();
          // Inner filled dot
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(snapPin.position.x, snapPin.position.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Rubber-band line: solid + thick when snapped, dashed when free
        ctx.save();
        ctx.strokeStyle = snapPin ? '#16a34a' : '#3b82f6';
        ctx.lineWidth = (snapPin ? 3.5 : 2) / zoom;
        if (!snapPin) ctx.setLineDash([8 / zoom, 4 / zoom]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Source pin: pulsing blue ring
        const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
        ctx.save();
        ctx.strokeStyle = `rgba(59,130,246,${pulse})`;
        ctx.lineWidth = 2.5 / zoom;
        ctx.beginPath();
        ctx.arc(from.x, from.y, 12 / zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(59,130,246,0.12)';
        ctx.beginPath();
        ctx.arc(from.x, from.y, 14 / zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (!wireStateEditing) {
        // Hover highlight on pin or connection under cursor (only in non-state-editing wire mode)
        const mousePos = mouseWorldPosRef.current;
        const hoverPin = hitTestPin(mousePos.x, mousePos.y);
        if (hoverPin) {
          const pin = activeComp.pins.find((p) => p.id === hoverPin)!;
          ctx.save();
          ctx.fillStyle = 'rgba(59,130,246,0.12)';
          ctx.beginPath();
          ctx.arc(pin.position.x, pin.position.y, 12 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2 / zoom;
          ctx.beginPath();
          ctx.arc(pin.position.x, pin.position.y, 9 / zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else {
          // Hover on connection → red highlight + × badge to delete
          const hoverConn = hitTestConnection(mousePos.x, mousePos.y);
          if (hoverConn) {
            const conn = connections.find((c) => c.id === hoverConn);
            if (conn) {
              const pinA = activeComp.pins.find((p) => p.id === conn.pinAId);
              const pinB = activeComp.pins.find((p) => p.id === conn.pinBId);
              if (pinA && pinB) {
                ctx.save();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 4 / zoom;
                ctx.beginPath();
                ctx.moveTo(pinA.position.x, pinA.position.y);
                ctx.lineTo(pinB.position.x, pinB.position.y);
                ctx.stroke();
                // × badge at midpoint
                const mx = (pinA.position.x + pinB.position.x) / 2;
                const my = (pinA.position.y + pinB.position.y) / 2;
                const btnW = 22 / zoom;
                const btnH = 22 / zoom;
                const btnR = 6 / zoom;
                const btnX = mx - btnW / 2;
                const btnY = my - btnH / 2;
                // White rounded badge with shadow
                ctx.shadowColor = 'rgba(0,0,0,0.18)';
                ctx.shadowBlur = 6 / zoom;
                ctx.shadowOffsetY = 1.5 / zoom;
                ctx.fillStyle = '#ffffff';
                roundRect(ctx, btnX, btnY, btnW, btnH, btnR);
                ctx.fill();
                ctx.shadowColor = 'transparent';
                ctx.strokeStyle = '#fecaca';
                ctx.lineWidth = 1.2 / zoom;
                roundRect(ctx, btnX, btnY, btnW, btnH, btnR);
                ctx.stroke();
                // Red × icon
                const cx = btnX + btnW / 2;
                const cy = btnY + btnH / 2;
                const xs = 5 / zoom;
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 2.2 / zoom;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(cx - xs, cy - xs); ctx.lineTo(cx + xs, cy + xs);
                ctx.moveTo(cx + xs, cy - xs); ctx.lineTo(cx - xs, cy + xs);
                ctx.stroke();
                ctx.lineCap = 'butt';
                ctx.restore();
              }
            }
          }
        }
      }
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

    // ---- Wire mode: selected connection toolbar (态编辑工具栏) ----
    // Re-apply viewport transform (preview section resets to screen space)
    if (isWireMode && activeComp && wireStateEditing && selectedConnectionId) {
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * offsetX, dpr * offsetY);
      const connections = useConnectionStore.getState().matrices[activeComp.id]?.connections ?? [];
      const selConn = connections.find((c) => c.id === selectedConnectionId);
      if (selConn) {
        const pinA = activeComp.pins.find((p) => p.id === selConn.pinAId);
        const pinB = activeComp.pins.find((p) => p.id === selConn.pinBId);
        if (pinA && pinB) {
          const mx = (pinA.position.x + pinB.position.x) / 2;
          const my = (pinA.position.y + pinB.position.y) / 2;

          // ─── 关联形状选中框 + 手柄 ───
          for (const shape of activeComp.shapeElements) {
            if (shape.linkedConnectionId !== selectedConnectionId) continue;
            const resolved = resolveShapeProps(shape, matrices, activeComp.id, previewState);
            const isSelected = selectedShapeIds.includes(shape.id);
            if (isSelected) {
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
            } else {
              // 未选中的关联形状显示淡色边框
              const b = getShapeBounds(resolved);
              ctx.save();
              ctx.strokeStyle = '#3b82f6';
              ctx.lineWidth = 1.5 / zoom;
              ctx.setLineDash([4 / zoom, 3 / zoom]);
              ctx.strokeRect(b.left - 3 / zoom, b.top - 3 / zoom, b.width + 6 / zoom, b.height + 6 / zoom);
              ctx.setLineDash([]);
              ctx.restore();
            }
          }

          // ─── 关联形状 × 取消关联按钮 ───
          wireShapeUnlinkRectsRef.current = [];
          for (const shape of activeComp.shapeElements) {
            if (shape.linkedConnectionId !== selectedConnectionId) continue;
            const resolved = resolveShapeProps(shape, matrices, activeComp.id, previewState);
            const b = getShapeBounds(resolved);
            const btnW = 22 / zoom;
            const btnH = 22 / zoom;
            const btnR = 6 / zoom;
            const btnX = b.right - 2 / zoom;
            const btnY = b.top - btnH + 2 / zoom;

            // Hit area: slightly larger than visual
            const hitR = 14 / zoom;
            const hitCX = btnX + btnW / 2;
            const hitCY = btnY + btnH / 2;
            wireShapeUnlinkRectsRef.current.push({ shapeId: shape.id, cx: hitCX, cy: hitCY, r: hitR });

            // White rounded badge with shadow
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.18)';
            ctx.shadowBlur = 6 / zoom;
            ctx.shadowOffsetY = 1.5 / zoom;
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, btnX, btnY, btnW, btnH, btnR);
            ctx.fill();
            // Shadow off for the rest
            ctx.shadowColor = 'transparent';
            // Subtle border
            ctx.strokeStyle = '#fecaca';
            ctx.lineWidth = 1.2 / zoom;
            roundRect(ctx, btnX, btnY, btnW, btnH, btnR);
            ctx.stroke();

            // Red × icon
            const cx = btnX + btnW / 2;
            const cy = btnY + btnH / 2;
            const s = 5 / zoom;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2.2 / zoom;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
            ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
            ctx.stroke();
            ctx.lineCap = 'butt';
            ctx.restore();
          }

          // ─── 非关联形状的 hover 高亮（可点击关联） ───
          const mousePos = mouseWorldPosRef.current;
          const hoverShapeId = hitTestShape(mousePos.x, mousePos.y);
          if (hoverShapeId) {
            const hoverShape = activeComp.shapeElements.find(s => s.id === hoverShapeId);
            if (hoverShape && hoverShape.linkedConnectionId !== selectedConnectionId) {
              const bounds = getShapeBounds(hoverShape);
              if (bounds) {
                ctx.save();
                ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([6 / zoom, 3 / zoom]);
                const pad2 = 4 / zoom;
                ctx.strokeRect(bounds.left - pad2, bounds.top - pad2, bounds.width + pad2 * 2, bounds.height + pad2 * 2);
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(34,197,94,0.06)';
                ctx.fillRect(bounds.left - pad2, bounds.top - pad2, bounds.width + pad2 * 2, bounds.height + pad2 * 2);
                ctx.restore();
              }
            }
          }

          // ─── 浮动工具栏（现代风格，可拖拽） ───
          const tbW = 220 / zoom;
          const tbH = 40 / zoom;
          const tbOff = wireToolbarOffsetRef.current;
          const tbX = mx - tbW / 2 + tbOff.x;
          const tbY = my - 50 / zoom - tbH + tbOff.y;
          const tbR = 10 / zoom;
          const tbPad = 8 / zoom;

          // 工具栏背景（白色圆角 + 柔和阴影）
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.1)';
          ctx.shadowBlur = 12 / zoom;
          ctx.shadowOffsetY = 2 / zoom;
          roundRect(ctx, tbX, tbY, tbW, tbH, tbR);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1 / zoom;
          ctx.stroke();
          ctx.restore();

          const btnW = 56 / zoom;
          const btnH = tbH - tbPad * 2;
          const btnR = 6 / zoom;
          const btnY = tbY + tbPad;

          // 闭合态按钮
          const closedBtnX = tbX + tbPad;
          ctx.save();
          ctx.fillStyle = wireEditState === 'closed' ? '#dcfce7' : '#f8fafc';
          roundRect(ctx, closedBtnX, btnY, btnW, btnH, btnR); ctx.fill();
          // 左侧色条
          if (wireEditState === 'closed') {
            ctx.fillStyle = '#10b981';
            roundRect(ctx, closedBtnX, btnY, 3 / zoom, btnH, 1.5 / zoom); ctx.fill();
          }
          ctx.strokeStyle = wireEditState === 'closed' ? '#86efac' : '#e2e8f0';
          ctx.lineWidth = 1 / zoom;
          roundRect(ctx, closedBtnX, btnY, btnW, btnH, btnR); ctx.stroke();
          ctx.fillStyle = wireEditState === 'closed' ? '#15803d' : '#64748b';
          ctx.font = `bold ${11 / zoom}px "Microsoft YaHei", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('闭合态', closedBtnX + btnW / 2, btnY + btnH / 2);
          ctx.restore();

          // 断开态按钮
          const openBtnX = closedBtnX + btnW + 6 / zoom;
          ctx.save();
          ctx.fillStyle = wireEditState === 'open' ? '#fff7ed' : '#f8fafc';
          roundRect(ctx, openBtnX, btnY, btnW, btnH, btnR); ctx.fill();
          if (wireEditState === 'open') {
            ctx.fillStyle = '#f97316';
            roundRect(ctx, openBtnX, btnY, 3 / zoom, btnH, 1.5 / zoom); ctx.fill();
          }
          ctx.strokeStyle = wireEditState === 'open' ? '#fdba74' : '#e2e8f0';
          ctx.lineWidth = 1 / zoom;
          roundRect(ctx, openBtnX, btnY, btnW, btnH, btnR); ctx.stroke();
          ctx.fillStyle = wireEditState === 'open' ? '#c2410c' : '#64748b';
          ctx.font = `bold ${11 / zoom}px "Microsoft YaHei", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('断开态', openBtnX + btnW / 2, btnY + btnH / 2);
          ctx.restore();

          // 保存按钮（点击有绿色闪烁反馈）
          const saveBtnW = 48 / zoom;
          const saveBtnX = openBtnX + btnW + 8 / zoom;
          const saveFlashing = Date.now() - wireSaveFlash < 600;
          ctx.save();
          if (saveFlashing) {
            // Green flash glow
            ctx.shadowColor = 'rgba(34,197,94,0.5)';
            ctx.shadowBlur = 10 / zoom;
          }
          ctx.fillStyle = saveFlashing ? '#dcfce7' : '#eff6ff';
          roundRect(ctx, saveBtnX, btnY, saveBtnW, btnH, btnR); ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = saveFlashing ? '#86efac' : '#bfdbfe';
          ctx.lineWidth = 1 / zoom;
          roundRect(ctx, saveBtnX, btnY, saveBtnW, btnH, btnR); ctx.stroke();
          ctx.fillStyle = saveFlashing ? '#15803d' : '#1d4ed8';
          ctx.font = `${10 / zoom}px "Microsoft YaHei", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(saveFlashing ? '✓ 已保存' : '保存', saveBtnX + saveBtnW / 2, btnY + btnH / 2);
          ctx.restore();

          // 关闭按钮（右侧圆形）
          const closeR2 = btnH / 2;
          const closeCX = tbX + tbW - tbPad - closeR2;
          const closeCY = btnY + btnH / 2;
          ctx.save();
          ctx.fillStyle = '#f1f5f9';
          ctx.beginPath(); ctx.arc(closeCX, closeCY, closeR2, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1 / zoom;
          ctx.beginPath(); ctx.arc(closeCX, closeCY, closeR2, 0, Math.PI * 2); ctx.stroke();
          const xs = 3.5 / zoom;
          ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2 / zoom;
          ctx.beginPath(); ctx.moveTo(closeCX - xs, closeCY - xs); ctx.lineTo(closeCX + xs, closeCY + xs);
          ctx.moveTo(closeCX + xs, closeCY - xs); ctx.lineTo(closeCX - xs, closeCY + xs); ctx.stroke();
          ctx.restore();

          // 提示文字（无关联形状时）
          const linkedCount = activeComp.shapeElements.filter(s => s.linkedConnectionId === selectedConnectionId).length;
          if (linkedCount === 0) {
            ctx.save(); ctx.fillStyle = '#94a3b8';
            ctx.font = `${9 / zoom}px "Microsoft YaHei", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText('点击形状关联到此连线', mx, tbY + tbH + 6 / zoom);
            ctx.restore();
          }

          // 存储工具栏按钮碰撞区域
          wireToolbarRectsRef.current = {
            closedBtn: { x: closedBtnX, y: btnY, w: btnW, h: btnH },
            openBtn: { x: openBtnX, y: btnY, w: btnW, h: btnH },
            saveBtn: { x: saveBtnX, y: btnY, w: saveBtnW, h: btnH },
            closeBtn: { cx: closeCX, cy: closeCY, r: closeR2 },
            fullRect: { x: tbX, y: tbY, w: tbW, h: tbH },
          };
        }
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

  const [, setResizeNonce] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      setResizeNonce((n) => n + 1);
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

  const cursor = dragState?.type === 'pan' ? 'grabbing' : isDrawTool ? 'crosshair' : activeTool === 'wire' ? 'crosshair' : activeTool === 'select' ? 'default' : 'grab';
  const extDrag = useDragStore();

  const handleExternalDrop = useCallback((e: React.MouseEvent) => {
    if (!extDrag.active || !extDrag.draggingId) return;
    const sourceId = extDrag.draggingId;
    extDrag.endDrag();
    if (!sourceId || !activeComponentId || sourceId === activeComponentId) return;
    const sourceComp = useComponentStore.getState().components.find((c) => c.id === sourceId);
    if (!sourceComp || sourceComp.shapeElements.length === 0) return;
    const pos = getCanvasPos(e);
    const newIds = importSubComponentScaled(activeComponentId, sourceComp, pos.x, pos.y);
    useCanvasStore.getState().selectShape(null);
    for (const id of newIds) selectShape(id, true);
  }, [extDrag, activeComponentId, getCanvasPos, importSubComponentScaled, selectShape]);

  return (
    <div
      ref={containerRef}
      className={`component-canvas-container${dragOver ? ' drag-over' : ''}${extDrag.active && extDrag.draggingId ? ' ext-drag-over' : ''}`}
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
        const newIds = importSubComponentScaled(activeComponentId, sourceComp, pos.x, pos.y);
        useCanvasStore.getState().selectShape(null);
        for (const id of newIds) selectShape(id, true);
      }}
    >
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
        onMouseUp={(e) => { handleMouseUp(); handleExternalDrop(e); }}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
