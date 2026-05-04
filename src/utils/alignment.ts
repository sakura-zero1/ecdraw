import type { ShapeElement } from '../types';

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
  switch (el.type) {
    case 'rect': {
      const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
      return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
    }
    case 'circle': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, r = el.r ?? 0;
      return { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r, width: r * 2, height: r * 2, cx, cy };
    }
    case 'ellipse': {
      const cx = el.cx ?? 0, cy = el.cy ?? 0, rx = el.rx ?? 0, ry = el.ry ?? 0;
      return { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry, width: rx * 2, height: ry * 2, cx, cy };
    }
    case 'line': {
      const x1 = el.x1 ?? 0, y1 = el.y1 ?? 0, x2 = el.x2 ?? 0, y2 = el.y2 ?? 0;
      const left = Math.min(x1, x2), top = Math.min(y1, y2);
      return { left, top, right: Math.max(x1, x2), bottom: Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
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
    default:
      result = {};
  }

  // Scale override position keys so stateClosed/stateOpen follow the group resize
  for (const ovKey of ['stateClosed', 'stateOpen'] as const) {
    const ov = shape[ovKey];
    if (!ov || typeof ov !== 'object') continue;
    const ovUpdates = scaleOverride(ov as Record<string, unknown>, shape.type, origBounds, newBounds, scaleX, scaleY);
    if (ovUpdates) (result as Record<string, unknown>)[ovKey] = { ...ov, ...ovUpdates };
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
    default: return {};
  }
}

export function flipShapes(shapes: ShapeElement[], horizontal: boolean): Map<string, Partial<ShapeElement>> {
  const result = new Map<string, Partial<ShapeElement>>();
  const bounds = getGroupBounds(shapes);
  if (!bounds) return result;
  const fn = horizontal ? flipShapeH : flipShapeV;
  const center = horizontal ? bounds.cx : bounds.cy;
  for (const s of shapes) result.set(s.id, fn(s, bounds.cx, bounds.cy));
  return result;
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
