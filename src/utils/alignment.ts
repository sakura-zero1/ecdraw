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

function moveShapeBy(el: ShapeElement, dx: number, dy: number): Partial<ShapeElement> {
  const updates: Record<string, number> = {};
  const pos = getShapePositionKeys(el);
  for (const [k, v] of Object.entries(pos)) {
    updates[k] = v + (k.includes('x') || k === 'cx' ? dx : k.includes('y') || k === 'cy' ? dy : 0);
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
      const sorted = [...bounds].sort((a, b) => a.b.left - b.b.left);
      const totalSpan = sorted[sorted.length - 1].b.right - sorted[0].b.left;
      const totalWidth = sorted.reduce((sum, { b }) => sum + b.width, 0);
      const gap = (totalSpan - totalWidth) / (sorted.length - 1);
      let cursor = sorted[0].b.left;
      for (const { el, b } of sorted) {
        result.set(el.id, moveShapeBy(el, Math.round(cursor - b.left), 0));
        cursor += b.width + gap;
      }
      break;
    }
    case 'dist-v': {
      if (bounds.length < 3) break;
      const sorted = [...bounds].sort((a, b) => a.b.top - b.b.top);
      const totalSpan = sorted[sorted.length - 1].b.bottom - sorted[0].b.top;
      const totalHeight = sorted.reduce((sum, { b }) => sum + b.height, 0);
      const gap = (totalSpan - totalHeight) / (sorted.length - 1);
      let cursor = sorted[0].b.top;
      for (const { el, b } of bounds) {
        result.set(el.id, moveShapeBy(el, 0, Math.round(cursor - b.top)));
        cursor += b.height + gap;
      }
      break;
    }
  }

  return result;
}
