import type { ElectricalComponent, ShapeElement, ConnectivityMatrix } from '../../types';
import { getShapeBounds } from '../../utils/alignment';

const PIN_COLORS: Record<string, string> = {
  input: '#3b82f6',
  output: '#f97316',
  bidirectional: '#8b5cf6',
  power: '#eab308',
  ground: '#6b7280',
};

const THUMB_W = 80;
const THUMB_H = 52;
const PAD = 4;

interface Props {
  component: ElectricalComponent;
  matrix?: ConnectivityMatrix;
}

function resolveShapeProps(el: ShapeElement, matrices: Record<string, ConnectivityMatrix>, compId: string): ShapeElement {
  if (el.linkedConnectionId) {
    const matrix = matrices[compId];
    if (matrix) {
      const conn = matrix.connections.find((c) => c.id === el.linkedConnectionId);
      if (conn && conn.state !== 'none') {
        const override = conn.state === 'closed' ? el.stateClosed : el.stateOpen;
        if (override) return { ...el, ...override };
        return el;
      }
    }
  }
  return el;
}

function renderThumbShape(resolved: ShapeElement) {
  const base = {
    fill: resolved.fill || 'transparent',
    stroke: resolved.stroke || '#334155',
    strokeWidth: 1.2,
    opacity: resolved.opacity ?? 1,
  };
  switch (resolved.type) {
    case 'rect':
      return <rect x={resolved.x} y={resolved.y} width={resolved.width} height={resolved.height} rx={resolved.rx ?? 0} {...base} />;
    case 'circle':
      return <circle cx={resolved.cx} cy={resolved.cy} r={resolved.r} {...base} />;
    case 'ellipse':
      return <ellipse cx={resolved.cx} cy={resolved.cy} rx={resolved.rx} ry={resolved.ry} {...base} />;
    case 'line':
      return <line x1={resolved.x1} y1={resolved.y1} x2={resolved.x2} y2={resolved.y2} stroke={base.stroke} strokeWidth={base.strokeWidth} opacity={base.opacity} />;
    case 'path':
      return <path d={resolved.d} {...base} />;
    case 'text': {
      const t = resolved.text ?? '';
      if (!t) return null;
      const fs = resolved.fontSize ?? 16;
      const ff = resolved.fontFamily ?? 'sans-serif';
      const fw = resolved.fontWeight ?? 'normal';
      return (
        <text
          x={resolved.x}
          y={resolved.y}
          fill={base.fill !== 'transparent' ? base.fill : base.stroke}
          fontSize={fs}
          fontFamily={ff}
          fontWeight={fw}
          textAnchor={resolved.textAlign === 'center' ? 'middle' : resolved.textAlign === 'right' ? 'end' : 'start'}
          dominantBaseline="hanging"
        >
          {t}
        </text>
      );
    }
    default:
      return null;
  }
}

export function ComponentPreviewSvg({ component, matrix }: Props) {
  const shapes = component.shapeElements;
  const pins = component.pins.filter((p) => p.visible);

  const matrices = matrix ? { [component.id]: matrix } : {};
  const resolvedShapes = shapes.map((s) => resolveShapeProps(s, matrices, component.id));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of resolvedShapes) {
    const b = getShapeBounds(s);
    if (b.width === 0 && b.height === 0) continue;
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  }
  for (const p of pins) {
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x);
    maxY = Math.max(maxY, p.position.y);
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;

  const pad = 8;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;

  return (
    <svg width={w} height={h} viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}>
      <rect x={minX - pad} y={minY - pad} width={w} height={h} fill="#fafbfc" />
      {resolvedShapes.map((s) => <g key={s.id}>{renderThumbShape(s)}</g>)}
      {pins.map((p) => (
        <circle
          key={p.id}
          cx={p.position.x}
          cy={p.position.y}
          r={Math.max(4, Math.min(w, h) * 0.02)}
          fill={PIN_COLORS[p.pinType] || '#6b7280'}
          stroke="#fff"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

export default function ComponentThumbnail({ component, matrix }: Props) {
  const shapes = component.shapeElements;
  const pins = component.pins.filter((p) => p.visible);

  if (shapes.length === 0 && pins.length === 0) {
    return (
      <svg width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
        <rect x={0} y={0} width={THUMB_W} height={THUMB_H} fill="#fafbfc" rx={2} />
        <text x={THUMB_W / 2} y={THUMB_H / 2} textAnchor="middle" dominantBaseline="middle" fill="#9db0c4" fontSize={10}>
          空
        </text>
      </svg>
    );
  }

  const matrices = matrix ? { [component.id]: matrix } : {};
  const resolvedShapes = shapes.map((s) => resolveShapeProps(s, matrices, component.id));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of resolvedShapes) {
    const b = getShapeBounds(s);
    if (b.width === 0 && b.height === 0) continue;
    minX = Math.min(minX, b.left);
    minY = Math.min(minY, b.top);
    maxX = Math.max(maxX, b.right);
    maxY = Math.max(maxY, b.bottom);
  }
  for (const p of pins) {
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x);
    maxY = Math.max(maxY, p.position.y);
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    minX = 0; minY = 0; maxX = component.width; maxY = component.height;
  }

  const contentW = maxX - minX || 1;
  const contentH = maxY - minY || 1;
  const scaleX = (THUMB_W - PAD * 2) / contentW;
  const scaleY = (THUMB_H - PAD * 2) / contentH;
  const scale = Math.min(scaleX, scaleY);

  const scaledW = contentW * scale;
  const scaledH = contentH * scale;
  const offsetX = (THUMB_W - scaledW) / 2;
  const offsetY = (THUMB_H - scaledH) / 2;

  return (
    <svg width={THUMB_W} height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
      <rect x={0} y={0} width={THUMB_W} height={THUMB_H} fill="#fafbfc" rx={2} />
      <g transform={`translate(${offsetX},${offsetY}) scale(${scale}) translate(${-minX},${-minY})`}>
        {resolvedShapes.map((s) => <g key={s.id}>{renderThumbShape(s)}</g>)}
        {pins.map((p) => (
          <circle
            key={p.id}
            cx={p.position.x}
            cy={p.position.y}
            r={Math.max(3, (maxX - minX) * 0.015)}
            fill={PIN_COLORS[p.pinType] || '#6b7280'}
          />
        ))}
      </g>
    </svg>
  );
}
