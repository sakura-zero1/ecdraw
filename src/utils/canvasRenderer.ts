/**
 * Shared Canvas rendering utilities for shape elements.
 * Used by both ComponentCanvas (component editor) and DiagramCanvas (diagram editor).
 */
import type { ShapeElement, PinType } from '../types';

// Pin colors by type
export const PIN_COLORS: Record<PinType, string> = {
  input: '#3b82f6',
  output: '#f97316',
  bidirectional: '#8b5cf6',
  power: '#eab308',
  ground: '#6b7280',
};

/**
 * Draw a ShapeElement on a Canvas context.
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
  ctx.lineJoin = 'round';

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
    case 'text': {
      const t = el.text ?? '';
      if (!t) break;
      const fs = el.fontSize ?? 16;
      const ff = el.fontFamily ?? '"Microsoft YaHei", "PingFang SC", sans-serif';
      const fw = el.fontWeight ?? 'normal';
      ctx.font = `${fw} ${fs}px ${ff}`;
      ctx.textAlign = el.textAlign ?? 'left';
      ctx.textBaseline = 'top';
      const textColor = (fill !== 'transparent' && fill !== 'none') ? fill : stroke;
      ctx.fillStyle = textColor;
      ctx.fillText(t, el.x ?? 0, el.y ?? 0);
      if (strokeWidth > 0 && stroke !== 'transparent' && stroke !== textColor) {
        ctx.strokeText(t, el.x ?? 0, el.y ?? 0);
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw a grid on the canvas.
 */
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, gridSize = 20) {
  ctx.save();
  ctx.strokeStyle = '#d8e3ef';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = 0; x <= w; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a pin on the canvas.
 */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pinType: PinType,
  label: string,
  selected: boolean,
  radius = 5,
) {
  const color = PIN_COLORS[pinType] || PIN_COLORS.bidirectional;

  // Outer circle
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = selected ? '#e0f2fe' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = selected ? '#0ea5e9' : color;
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.stroke();

  // Inner dot
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Label
  if (label) {
    ctx.fillStyle = '#607286';
    ctx.font = '10px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + radius + 3, y);
  }
}

/**
 * Compute bounding box for a text shape.
 */
export function getTextBounds(el: ShapeElement): { x: number; y: number; width: number; height: number } {
  const text = el.text ?? '';
  if (!text) return { x: el.x ?? 0, y: el.y ?? 0, width: 0, height: 0 };
  const fs = el.fontSize ?? 16;
  const ff = el.fontFamily ?? '"Microsoft YaHei", "PingFang SC", sans-serif';
  const fw = el.fontWeight ?? 'normal';

  // Use an offscreen canvas to measure text
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${fw} ${fs}px ${ff}`;

  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxWidth) maxWidth = m.width;
  }
  const lineHeight = fs * 1.2;
  const totalHeight = lineHeight * lines.length;

  let x = el.x ?? 0;
  const y = el.y ?? 0;
  const align = el.textAlign ?? 'left';
  if (align === 'center') x -= maxWidth / 2;
  else if (align === 'right') x -= maxWidth;

  return { x, y, width: maxWidth, height: totalHeight };
}

/**
 * Build a Path2D for a shape (used for hit testing).
 */
export function buildShapePath(el: ShapeElement): Path2D {
  const path = new Path2D();
  const sw = Math.max(el.strokeWidth ?? 2, 4); // Expand hit area

  switch (el.type) {
    case 'rect': {
      const x = el.x ?? 0, y = el.y ?? 0, w = el.width ?? 0, h = el.height ?? 0;
      path.rect(x - sw / 2, y - sw / 2, w + sw, h + sw);
      break;
    }
    case 'circle': {
      const r = (el.r ?? 0) + sw / 2;
      path.arc(el.cx ?? 0, el.cy ?? 0, r, 0, Math.PI * 2);
      break;
    }
    case 'ellipse': {
      const rx = (el.rx ?? 0) + sw / 2, ry = (el.ry ?? 0) + sw / 2;
      path.ellipse(el.cx ?? 0, el.cy ?? 0, rx, ry, 0, 0, Math.PI * 2);
      break;
    }
    case 'line': {
      path.moveTo(el.x1 ?? 0, el.y1 ?? 0);
      path.lineTo(el.x2 ?? 0, el.y2 ?? 0);
      break;
    }
    case 'path': {
      if (el.d) {
        const p = new Path2D(el.d);
        path.addPath(p);
      }
      break;
    }
    case 'polygon': {
      const pts = el.points ?? [];
      if (pts.length >= 3) {
        path.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
        path.closePath();
      }
      break;
    }
    case 'text': {
      const bounds = getTextBounds(el);
      path.rect(bounds.x - sw / 2, bounds.y - sw / 2, bounds.width + sw, bounds.height + sw);
      break;
    }
  }
  return path;
}
