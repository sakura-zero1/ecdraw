import type { Pin, ShapeElement } from '../types';
import { getShapeBounds, type Bounds } from './alignment';

const NODE_WIDTH_DEFAULT = 140;
const NODE_HEIGHT_DEFAULT = 90;
const THUMB_PAD = 4;

/**
 * World-space position of a pin attached to an instance, accounting for the
 * shape thumbnail's auto-fit scale + offset. Mirrors the editor's geometry so
 * the viewer connects edges at the same points the editor draws them.
 */
export function getPinNodePos(
  pin: Pin,
  instX: number,
  instY: number,
  shapesBounds: Bounds | null,
  nodeW: number = NODE_WIDTH_DEFAULT,
  nodeH: number = NODE_HEIGHT_DEFAULT,
): { x: number; y: number } {
  if (!shapesBounds || shapesBounds.width === 0 || shapesBounds.height === 0) {
    return { x: instX + pin.position.x, y: instY + pin.position.y };
  }
  const availW = nodeW - THUMB_PAD * 2;
  const availH = nodeH - THUMB_PAD * 2;
  const scale = Math.min(availW / shapesBounds.width, availH / shapesBounds.height);
  const offX = instX + THUMB_PAD + (availW - shapesBounds.width * scale) / 2;
  const offY = instY + THUMB_PAD + (availH - shapesBounds.height * scale) / 2;
  return {
    x: offX + (pin.position.x - shapesBounds.left) * scale,
    y: offY + (pin.position.y - shapesBounds.top) * scale,
  };
}

/** Pin world position after applying the instance's rotation/flip transforms. */
export function getTransformedPinPos(
  pin: Pin,
  instX: number,
  instY: number,
  nodeW: number,
  nodeH: number,
  shapesBounds: Bounds | null,
  instanceData: Record<string, unknown> | null | undefined,
): { x: number; y: number } {
  const local = getPinNodePos(pin, instX, instY, shapesBounds, nodeW, nodeH);
  const { rotation, flipH, flipV } = getInstanceTransform(instanceData);
  if (rotation === 0 && !flipH && !flipV) return local;
  return transformPoint(local.x, local.y, instX + nodeW / 2, instY + nodeH / 2, rotation, flipH, flipV);
}

/**
 * Apply rotation + horizontal/vertical flip to a point around a center.
 * Matches the transform order used in DiagramCanvas: flip in local space first,
 * then rotate in world space, so visual results stay consistent across both
 * the editor and the viewer.
 */
export function transformPoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
): { x: number; y: number } {
  let dx = px - cx;
  let dy = py - cy;
  if (flipH) dx = -dx;
  if (flipV) dy = -dy;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Extract rotation/flipH/flipV from instanceData. */
export function getInstanceTransform(instanceData: Record<string, unknown> | null | undefined) {
  const data = (instanceData ?? {}) as { rotation?: number; flipH?: boolean; flipV?: boolean };
  return {
    rotation: data.rotation ?? 0,
    flipH: !!data.flipH,
    flipV: !!data.flipV,
  };
}

/**
 * Find the dominant fill color (by area), falling back to dominant stroke color
 * (by perimeter). Used for the instance label so it visually picks up the
 * "main color" of the underlying shapes. Returns null if no colored elements.
 */
export function getDominantShapeColor(shapes: ShapeElement[]): string | null {
  const areaByColor: Record<string, number> = {};
  const perimeterByColor: Record<string, number> = {};

  for (const el of shapes) {
    const fill = el.fill || 'transparent';
    if (fill !== 'transparent' && fill !== 'none') {
      let area = 0;
      switch (el.type) {
        case 'rect':
          area = (el.width ?? 0) * (el.height ?? 0);
          break;
        case 'circle':
          area = Math.PI * (el.r ?? 0) ** 2;
          break;
        case 'ellipse':
          area = Math.PI * (el.rx ?? 0) * (el.ry ?? 0);
          break;
        case 'path': {
          const b = getShapeBounds(el);
          area = b.width * b.height;
          break;
        }
        case 'line':
          break;
      }
      if (area > 0) areaByColor[fill] = (areaByColor[fill] || 0) + area;
    }

    const stroke = el.stroke || '#334155';
    if (stroke !== 'transparent' && stroke !== 'none') {
      let len = 0;
      switch (el.type) {
        case 'rect':
          len = 2 * ((el.width ?? 0) + (el.height ?? 0));
          break;
        case 'circle':
          len = 2 * Math.PI * (el.r ?? 0);
          break;
        case 'ellipse': {
          const rx = el.rx ?? 0, ry = el.ry ?? 0;
          len = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
          break;
        }
        case 'line': {
          const dx = (el.x2 ?? 0) - (el.x1 ?? 0);
          const dy = (el.y2 ?? 0) - (el.y1 ?? 0);
          len = Math.sqrt(dx * dx + dy * dy);
          break;
        }
        case 'path': {
          const b = getShapeBounds(el);
          len = 2 * (b.width + b.height);
          break;
        }
      }
      if (len > 0) perimeterByColor[stroke] = (perimeterByColor[stroke] || 0) + len;
    }
  }

  let best: string | null = null;
  let bestVal = 0;
  for (const [c, a] of Object.entries(areaByColor)) {
    if (a > bestVal) { best = c; bestVal = a; }
  }
  if (best) return best;
  for (const [c, l] of Object.entries(perimeterByColor)) {
    if (l > bestVal) { best = c; bestVal = l; }
  }
  return best;
}

/** Compute axis-aligned bounding box of a set of shapes. */
export function computeShapesBounds(shapes: ShapeElement[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const b = getShapeBounds(s);
    if (b.width === 0 && b.height === 0) continue;
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  }
  if (!isFinite(minX)) return null;
  return {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Draws a single ShapeElement onto a canvas 2D context.
 * Used by both the diagram editor (DiagramCanvas) and the read-only viewer (ViewerCanvas)
 * so both render component internals identically.
 */
export function drawShapeOnCanvas(ctx: CanvasRenderingContext2D, el: ShapeElement) {
  const fill = el.fill || 'transparent';
  const stroke = el.stroke || '#334155';
  const strokeWidth = el.strokeWidth ?? 2;
  const opacity = el.opacity ?? 1;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;

  switch (el.type) {
    case 'rect':
      ctx.beginPath();
      ctx.rect(el.x ?? 0, el.y ?? 0, el.width ?? 0, el.height ?? 0);
      if (fill !== 'transparent' && fill !== 'none') ctx.fill();
      ctx.stroke();
      break;
    case 'circle': {
      const r = el.r ?? 0;
      ctx.beginPath();
      ctx.arc(el.cx ?? 0, el.cy ?? 0, r, 0, Math.PI * 2);
      if (fill !== 'transparent' && fill !== 'none') ctx.fill();
      ctx.stroke();
      break;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(el.cx ?? 0, el.cy ?? 0, el.rx ?? 0, el.ry ?? 0, 0, 0, Math.PI * 2);
      if (fill !== 'transparent' && fill !== 'none') ctx.fill();
      ctx.stroke();
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(el.x1 ?? 0, el.y1 ?? 0);
      ctx.lineTo(el.x2 ?? 0, el.y2 ?? 0);
      ctx.stroke();
      break;
    case 'path':
      if (el.d) {
        const path = new Path2D(el.d);
        if (fill !== 'transparent' && fill !== 'none') ctx.fill(path);
        ctx.stroke(path);
      }
      break;
    case 'polygon':
      if (el.points && el.points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(el.points[0][0], el.points[0][1]);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i][0], el.points[i][1]);
        ctx.closePath();
        if (fill !== 'transparent' && fill !== 'none') ctx.fill();
        ctx.stroke();
      }
      break;
    case 'text':
      if (el.text) {
        const fs = el.fontSize ?? 16;
        ctx.font = `${el.fontWeight ?? 'normal'} ${fs}px ${el.fontFamily ?? '"Microsoft YaHei", sans-serif'}`;
        ctx.textAlign = el.textAlign ?? 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(el.text, el.x ?? 0, el.y ?? 0);
      }
      break;
  }
  ctx.restore();
}
