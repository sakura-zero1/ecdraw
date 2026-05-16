import type { ShapeElement } from '../types';
import { getTextBounds } from './canvasRenderer';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export function getShapeBounds(el: ShapeElement): Bounds {
  const halfStroke = (el.strokeWidth ?? 0) / 2;
  switch (el.type) {
    case 'rect': {
      const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
      return { left: x - halfStroke, top: y - halfStroke, right: x + w + halfStroke, bottom: y + h + halfStroke, width: w + halfStroke * 2, height: h + halfStroke * 2, cx: x + w / 2, cy: y + h / 2 };
    }
    case 'circle': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, r = el.r ?? 0;
      return { left: cx - r - halfStroke, top: cy - r - halfStroke, right: cx + r + halfStroke, bottom: cy + r + halfStroke, width: r * 2 + halfStroke * 2, height: r * 2 + halfStroke * 2, cx, cy };
    }
    case 'ellipse': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, rx = el.rx ?? 0, ry = el.ry ?? 0;
      return { left: cx - rx - halfStroke, top: cy - ry - halfStroke, right: cx + rx + halfStroke, bottom: cy + ry + halfStroke, width: rx * 2 + halfStroke * 2, height: ry * 2 + halfStroke * 2, cx, cy };
    }
    case 'line': {
      const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
      const left = Math.min(x1, x2) - halfStroke, top = Math.min(y1, y2) - halfStroke;
      return { left, top, right: Math.max(x1, x2) + halfStroke, bottom: Math.max(y1, y2) + halfStroke, width: Math.abs(x2 - x1) + halfStroke * 2, height: Math.abs(y2 - y1) + halfStroke * 2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
    }
    case 'text': {
      const b = getTextBounds(el);
      return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
    }
    default:
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
}

export function moveShapeBy(el: ShapeElement, dx: number, dy: number): Partial<ShapeElement> {
  const updates: Record<string, number> = {};
  const pos = getShapePositionKeys(el);
  for (const [k, v] of Object.entries(pos)) {
    updates[k] = Math.round(v + (k.includes('x') || k === 'cx' ? dx : k.includes('y') || k === 'cy' ? dy : 0));
  }
  return updates;
}

function getShapePositionKeys(el: ShapeElement): Record<string, number> {
  switch (el.type) {
    case 'rect': return { x: el.x ?? 0, y: el.y ?? 0 };
    case 'circle': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'ellipse': return { cx: el.cx ?? 0, cy: el.cy ?? 0 };
    case 'line': return { x1: el.x1 ?? 0, y1: el.y1 ?? 0, x2: el.x2 ?? 0, y2: el.y2 ?? 0 };
    case 'text': return { x: el.x ?? 0, y: el.y ?? 0 };
    default: return {};
  }
}

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'dist-h' | 'dist-v';

export function getGroupBounds(shapes: ShapeElement[]): Bounds | null {
  if (shapes.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const el of shapes) {
    const b = getShapeBounds(el);
    if (b.width === 0 && b.height === 0) continue;
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  if (!isFinite(left)) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

export function getGroupResizeHandles(b: Bounds): Array<{ key: string; x: number; y: number }> {
  return [
    { key: 'nw', x: b.left, y: b.top },
    { key: 'n', x: b.cx, y: b.top },
    { key: 'ne', x: b.right, y: b.top },
    { key: 'e', x: b.right, y: b.cy },
    { key: 'se', x: b.right, y: b.bottom },
    { key: 's', x: b.cx, y: b.bottom },
    { key: 'sw', x: b.left, y: b.bottom },
    { key: 'w', x: b.left, y: b.cy },
  ];
}

export function scaleShapeInGroup(
  shape: ShapeElement,
  origBounds: Bounds,
  newBounds: Bounds,
  origOverrides?: Record<string, Record<string, unknown>>,
): Partial<ShapeElement> {
  const origW = origBounds.width || 1;
  const origH = origBounds.height || 1;
  const scaleX = newBounds.width / origW;
  const scaleY = newBounds.height / origH;

  let result: Partial<ShapeElement>;

  switch (shape.type) {
    case 'rect': {
      const relX = (shape.x ?? 0) - origBounds.left;
      const relY = (shape.y ?? 0) - origBounds.top;
      result = {
        x: Math.round(newBounds.left + relX * scaleX),
        y: Math.round(newBounds.top + relY * scaleY),
        width: Math.round(Math.max(2, (shape.width ?? 0) * scaleX)),
        height: Math.round(Math.max(2, (shape.height ?? 0) * scaleY)),
      };
      break;
    }
    case 'circle': {
      const relX = (shape.cx ?? 0) - origBounds.left;
      const relY = (shape.cy ?? 0) - origBounds.top;
      result = {
        cx: Math.round(newBounds.left + relX * scaleX),
        cy: Math.round(newBounds.top + relY * scaleY),
        r: Math.round(Math.max(2, (shape.r ?? 0) * (scaleX + scaleY) / 2)),
      };
      break;
    }
    case 'ellipse': {
      const relX = (shape.cx ?? 0) - origBounds.left;
      const relY = (shape.cy ?? 0) - origBounds.top;
      result = {
        cx: Math.round(newBounds.left + relX * scaleX),
        cy: Math.round(newBounds.top + relY * scaleY),
        rx: Math.round(Math.max(2, (shape.rx ?? 0) * scaleX)),
        ry: Math.round(Math.max(2, (shape.ry ?? 0) * scaleY)),
      };
      break;
    }
    case 'line': {
      result = {
        x1: Math.round(newBounds.left + ((shape.x1 ?? 0) - origBounds.left) * scaleX),
        y1: Math.round(newBounds.top + ((shape.y1 ?? 0) - origBounds.top) * scaleY),
        x2: Math.round(newBounds.left + ((shape.x2 ?? 0) - origBounds.left) * scaleX),
        y2: Math.round(newBounds.top + ((shape.y2 ?? 0) - origBounds.top) * scaleY),
      };
      break;
    }
    case 'text': {
      const b = getTextBounds(shape);
      const relX = (b.x - origBounds.left);
      const relY = (b.y - origBounds.top);
      result = {
        x: Math.round(newBounds.left + relX * scaleX),
        y: Math.round(newBounds.top + relY * scaleY),
        fontSize: Math.round(Math.max(8, (shape.fontSize ?? 16) * (scaleX + scaleY) / 2)),
      };
      break;
    }
    default:
      result = {};
  }

  // Scale override position keys so stateClosed/stateOpen follow the group resize.
  // Use original override values captured at drag start to avoid drift.
  const overrides = origOverrides ?? (() => {
    const r: Record<string, Record<string, unknown>> = {};
    for (const ovKey of ['stateClosed', 'stateOpen'] as const) {
      const ov = shape[ovKey];
      if (ov && typeof ov === 'object') r[ovKey] = { ...ov as Record<string, unknown> };
    }
    return Object.keys(r).length > 0 ? r : undefined;
  })();
  if (overrides) {
    for (const [ovKey, ovOrig] of Object.entries(overrides)) {
      const ovUpdates = scaleOverride(ovOrig, shape.type, origBounds, newBounds, scaleX, scaleY);
      if (ovUpdates) (result as Record<string, unknown>)[ovKey] = { ...ovOrig, ...ovUpdates };
    }
  }

  return result;
}

function scaleOverride(
  ov: Record<string, unknown>,
  type: ShapeElement['type'],
  origBounds: Bounds,
  newBounds: Bounds,
  scaleX: number,
  scaleY: number,
): Record<string, number> | null {
  const updates: Record<string, number> = {};
  switch (type) {
    case 'rect':
      if (typeof ov.x === 'number') updates.x = Math.round(newBounds.left + (ov.x - origBounds.left) * scaleX);
      if (typeof ov.y === 'number') updates.y = Math.round(newBounds.top + (ov.y - origBounds.top) * scaleY);
      if (typeof ov.width === 'number') updates.width = Math.round(Math.max(2, ov.width * scaleX));
      if (typeof ov.height === 'number') updates.height = Math.round(Math.max(2, ov.height * scaleY));
      break;
    case 'circle':
      if (typeof ov.cx === 'number') updates.cx = Math.round(newBounds.left + (ov.cx - origBounds.left) * scaleX);
      if (typeof ov.cy === 'number') updates.cy = Math.round(newBounds.top + (ov.cy - origBounds.top) * scaleY);
      if (typeof ov.r === 'number') updates.r = Math.round(Math.max(2, ov.r * (scaleX + scaleY) / 2));
      break;
    case 'ellipse':
      if (typeof ov.cx === 'number') updates.cx = Math.round(newBounds.left + (ov.cx - origBounds.left) * scaleX);
      if (typeof ov.cy === 'number') updates.cy = Math.round(newBounds.top + (ov.cy - origBounds.top) * scaleY);
      if (typeof ov.rx === 'number') updates.rx = Math.round(Math.max(2, ov.rx * scaleX));
      if (typeof ov.ry === 'number') updates.ry = Math.round(Math.max(2, ov.ry * scaleY));
      break;
    case 'line':
      if (typeof ov.x1 === 'number') updates.x1 = Math.round(newBounds.left + (ov.x1 - origBounds.left) * scaleX);
      if (typeof ov.y1 === 'number') updates.y1 = Math.round(newBounds.top + (ov.y1 - origBounds.top) * scaleY);
      if (typeof ov.x2 === 'number') updates.x2 = Math.round(newBounds.left + (ov.x2 - origBounds.left) * scaleX);
      if (typeof ov.y2 === 'number') updates.y2 = Math.round(newBounds.top + (ov.y2 - origBounds.top) * scaleY);
      break;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

function rotatePoint90CW(px: number, py: number, cx: number, cy: number): [number, number] {
  return [Math.round(cx + (py - cy)), Math.round(cy - (px - cx))];
}

function rotatePoint90CCW(px: number, py: number, cx: number, cy: number): [number, number] {
  return [Math.round(cx - (py - cy)), Math.round(cy + (px - cx))];
}

function rotateShape90CW(shape: ShapeElement, cx: number, cy: number): Partial<ShapeElement> {
  switch (shape.type) {
    case 'rect': {
      const x = shape.x ?? 0, y = shape.y ?? 0, w = shape.width ?? 0, h = shape.height ?? 0;
      const [ncx, ncy] = rotatePoint90CW(x + w / 2, y + h / 2, cx, cy);
      return { x: Math.round(ncx - h / 2), y: Math.round(ncy - w / 2), width: Math.round(h), height: Math.round(w) };
    }
    case 'ellipse': {
      const ecx = shape.cx ?? 0, ecy = shape.cy ?? 0;
      const [ncx, ncy] = rotatePoint90CW(ecx, ecy, cx, cy);
      return { cx: ncx, cy: ncy, rx: Math.round(shape.ry ?? 0), ry: Math.round(shape.rx ?? 0) };
    }
    case 'line': {
      const [nx1, ny1] = rotatePoint90CW(shape.x1 ?? 0, shape.y1 ?? 0, cx, cy);
      const [nx2, ny2] = rotatePoint90CW(shape.x2 ?? 0, shape.y2 ?? 0, cx, cy);
      return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
    }
    case 'circle': {
      const [ncx, ncy] = rotatePoint90CW(shape.cx ?? 0, shape.cy ?? 0, cx, cy);
      return { cx: ncx, cy: ncy };
    }
    case 'text': {
      const b = getTextBounds(shape);
      const [ncx, ncy] = rotatePoint90CW(b.x + b.width / 2, b.y + b.height / 2, cx, cy);
      return { x: Math.round(ncx - b.width / 2), y: Math.round(ncy - b.height / 2) };
    }
    default: return {};
  }
}

function rotateShape90CCW(shape: ShapeElement, cx: number, cy: number): Partial<ShapeElement> {
  switch (shape.type) {
    case 'rect': {
      const x = shape.x ?? 0, y = shape.y ?? 0, w = shape.width ?? 0, h = shape.height ?? 0;
      const [ncx, ncy] = rotatePoint90CCW(x + w / 2, y + h / 2, cx, cy);
      return { x: Math.round(ncx - h / 2), y: Math.round(ncy - w / 2), width: Math.round(h), height: Math.round(w) };
    }
    case 'ellipse': {
      const ecx = shape.cx ?? 0, ecy = shape.cy ?? 0;
      const [ncx, ncy] = rotatePoint90CCW(ecx, ecy, cx, cy);
      return { cx: ncx, cy: ncy, rx: Math.round(shape.ry ?? 0), ry: Math.round(shape.rx ?? 0) };
    }
    case 'line': {
      const [nx1, ny1] = rotatePoint90CCW(shape.x1 ?? 0, shape.y1 ?? 0, cx, cy);
      const [nx2, ny2] = rotatePoint90CCW(shape.x2 ?? 0, shape.y2 ?? 0, cx, cy);
      return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
    }
    case 'circle': {
      const [ncx, ncy] = rotatePoint90CCW(shape.cx ?? 0, shape.cy ?? 0, cx, cy);
      return { cx: ncx, cy: ncy };
    }
    case 'text': {
      const b = getTextBounds(shape);
      const [ncx, ncy] = rotatePoint90CCW(b.x + b.width / 2, b.y + b.height / 2, cx, cy);
      return { x: Math.round(ncx - b.width / 2), y: Math.round(ncy - b.height / 2) };
    }
    default: return {};
  }
}

export function rotateShapes(shapes: ShapeElement[], clockwise: boolean): Map<string, Partial<ShapeElement>> {
  const result = new Map<string, Partial<ShapeElement>>();
  const bounds = getGroupBounds(shapes);
  if (!bounds) return result;
  const fn = clockwise ? rotateShape90CW : rotateShape90CCW;
  for (const s of shapes) result.set(s.id, fn(s, bounds.cx, bounds.cy));
  return result;
}

export function rotatePinPosition(px: number, py: number, shapes: ShapeElement[], clockwise: boolean): { x: number; y: number } | null {
  const bounds = getGroupBounds(shapes);
  if (!bounds) return null;
  // Shape functions swap width/height which visually flips the rotation direction in screen coords (Y-down),
  // so pins must rotate in the opposite mathematical direction to match the visual result.
  const fn = clockwise ? rotatePoint90CCW : rotatePoint90CW;
  const [nx, ny] = fn(px, py, bounds.cx, bounds.cy);
  return { x: nx, y: ny };
}

function flipShapeH(shape: ShapeElement, cx: number, _cy: number): Partial<ShapeElement> {
  switch (shape.type) {
    case 'rect': {
      const x = shape.x ?? 0, w = shape.width ?? 0;
      return { x: Math.round(2 * cx - x - w) };
    }
    case 'line':
      return { x1: Math.round(2 * cx - (shape.x1 ?? 0)), x2: Math.round(2 * cx - (shape.x2 ?? 0)) };
    case 'circle':
      return { cx: Math.round(2 * cx - (shape.cx ?? 0)) };
    case 'ellipse':
      return { cx: Math.round(2 * cx - (shape.cx ?? 0)) };
    case 'text': {
      const b = getTextBounds(shape);
      return { x: Math.round(2 * cx - b.x - b.width) };
    }
    default: return {};
  }
}

function flipShapeV(shape: ShapeElement, _cx: number, cy: number): Partial<ShapeElement> {
  switch (shape.type) {
    case 'rect': {
      const y = shape.y ?? 0, h = shape.height ?? 0;
      return { y: Math.round(2 * cy - y - h) };
    }
    case 'line':
      return { y1: Math.round(2 * cy - (shape.y1 ?? 0)), y2: Math.round(2 * cy - (shape.y2 ?? 0)) };
    case 'circle':
      return { cy: Math.round(2 * cy - (shape.cy ?? 0)) };
    case 'ellipse':
      return { cy: Math.round(2 * cy - (shape.cy ?? 0)) };
    case 'text': {
      const b = getTextBounds(shape);
      return { y: Math.round(2 * cy - b.y - b.height) };
    }
    default: return {};
  }
}

export function flipShapes(shapes: ShapeElement[], horizontal: boolean): Map<string, Partial<ShapeElement>> {
  const result = new Map<string, Partial<ShapeElement>>();
  const bounds = getGroupBounds(shapes);
  if (!bounds) return result;
  const fn = horizontal ? flipShapeH : flipShapeV;
  for (const s of shapes) result.set(s.id, fn(s, bounds.cx, bounds.cy));
  return result;
}

export function flipPinPosition(px: number, py: number, shapes: ShapeElement[], horizontal: boolean): { x: number; y: number } | null {
  const bounds = getGroupBounds(shapes);
  if (!bounds) return null;
  if (horizontal) {
    return { x: Math.round(2 * bounds.cx - px), y: py };
  } else {
    return { x: px, y: Math.round(2 * bounds.cy - py) };
  }
}

export function computeAlignment(elements: ShapeElement[], mode: AlignMode): Map<string, Partial<ShapeElement>> {
  const result = new Map<string, Partial<ShapeElement>>();
  if (elements.length < 2) return result;

  const bounds = elements.map((el) => ({ el, b: getShapeBounds(el) }));

  switch (mode) {
    case 'left': {
      const target = Math.min(...bounds.map(({ b }) => b.left));
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, target - b.left, 0));
      }
      break;
    }
    case 'right': {
      const target = Math.max(...bounds.map(({ b }) => b.right));
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, target - b.right, 0));
      }
      break;
    }
    case 'center-h': {
      const target = Math.min(...bounds.map(({ b }) => b.left)) / 2 + Math.max(...bounds.map(({ b }) => b.right)) / 2;
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, Math.round(target - b.cx), 0));
      }
      break;
    }
    case 'top': {
      const target = Math.min(...bounds.map(({ b }) => b.top));
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, 0, target - b.top));
      }
      break;
    }
    case 'bottom': {
      const target = Math.max(...bounds.map(({ b }) => b.bottom));
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, 0, target - b.bottom));
      }
      break;
    }
    case 'center-v': {
      const target = Math.min(...bounds.map(({ b }) => b.top)) / 2 + Math.max(...bounds.map(({ b }) => b.bottom)) / 2;
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, 0, Math.round(target - b.cy)));
      }
      break;
    }
    case 'dist-h': {
      if (bounds.length < 3) break;
      const sorted = [...bounds].sort((a, b) => a.b.cx - b.b.cx);
      const minCx = sorted[0].b.cx;
      const maxCx = sorted[sorted.length - 1].b.cx;
      const step = (maxCx - minCx) / (sorted.length - 1);
      sorted.forEach(({ el, b }, i) => {
        result.set(el.id, moveShapeBy(el, Math.round(minCx + step * i - b.cx), 0));
      });
      break;
    }
    case 'dist-v': {
      if (bounds.length < 3) break;
      const sorted = [...bounds].sort((a, b) => a.b.cy - b.b.cy);
      const minCy = sorted[0].b.cy;
      const maxCy = sorted[sorted.length - 1].b.cy;
      const step = (maxCy - minCy) / (sorted.length - 1);
      sorted.forEach(({ el, b }, i) => {
        result.set(el.id, moveShapeBy(el, 0, Math.round(minCy + step * i - b.cy)));
      });
      break;
    }
  }

  return result;
}

export interface GroupUnit {
  groupId: string;
  shapes: ShapeElement[];
  bounds: Bounds;
}

export function groupShapesByUnit(shapes: ShapeElement[]): GroupUnit[] {
  const map = new Map<string, ShapeElement[]>();
  for (const s of shapes) {
    const key = s.groupId || s.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  const units: GroupUnit[] = [];
  for (const [groupId, groupShapes] of map) {
    const bounds = getGroupBounds(groupShapes);
    if (bounds) units.push({ groupId, shapes: groupShapes, bounds });
  }
  return units;
}

export function computeAlignmentByGroup(
  shapes: ShapeElement[],
  mode: AlignMode,
): Map<string, Partial<ShapeElement>> {
  const result = new Map<string, Partial<ShapeElement>>();
  if (shapes.length < 2) return result;

  const units = groupShapesByUnit(shapes);
  if (units.length < 2) return result;

  switch (mode) {
    case 'left': {
      const target = Math.min(...units.map((u) => u.bounds.left));
      for (const u of units) {
        const dx = target - u.bounds.left;
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, dx, 0));
      }
      break;
    }
    case 'right': {
      const target = Math.max(...units.map((u) => u.bounds.right));
      for (const u of units) {
        const dx = target - u.bounds.right;
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, dx, 0));
      }
      break;
    }
    case 'center-h': {
      const target = Math.min(...units.map((u) => u.bounds.left)) / 2 + Math.max(...units.map((u) => u.bounds.right)) / 2;
      for (const u of units) {
        const dx = Math.round(target - u.bounds.cx);
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, dx, 0));
      }
      break;
    }
    case 'top': {
      const target = Math.min(...units.map((u) => u.bounds.top));
      for (const u of units) {
        const dy = target - u.bounds.top;
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, 0, dy));
      }
      break;
    }
    case 'bottom': {
      const target = Math.max(...units.map((u) => u.bounds.bottom));
      for (const u of units) {
        const dy = target - u.bounds.bottom;
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, 0, dy));
      }
      break;
    }
    case 'center-v': {
      const target = Math.min(...units.map((u) => u.bounds.top)) / 2 + Math.max(...units.map((u) => u.bounds.bottom)) / 2;
      for (const u of units) {
        const dy = Math.round(target - u.bounds.cy);
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, 0, dy));
      }
      break;
    }
    case 'dist-h': {
      if (units.length < 3) break;
      const sorted = [...units].sort((a, b) => a.bounds.cx - b.bounds.cx);
      const minCx = sorted[0].bounds.cx;
      const maxCx = sorted[sorted.length - 1].bounds.cx;
      const step = (maxCx - minCx) / (sorted.length - 1);
      sorted.forEach((u, i) => {
        const dx = Math.round(minCx + step * i - u.bounds.cx);
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, dx, 0));
      });
      break;
    }
    case 'dist-v': {
      if (units.length < 3) break;
      const sorted = [...units].sort((a, b) => a.bounds.cy - b.bounds.cy);
      const minCy = sorted[0].bounds.cy;
      const maxCy = sorted[sorted.length - 1].bounds.cy;
      const step = (maxCy - minCy) / (sorted.length - 1);
      sorted.forEach((u, i) => {
        const dy = Math.round(minCy + step * i - u.bounds.cy);
        for (const s of u.shapes) result.set(s.id, moveShapeBy(s, 0, dy));
      });
      break;
    }
  }

  return result;
}
