import { useState, useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import type { DiagramInstance, DiagramEdge } from '../../services/diagramApi';
import { CATEGORY_LABELS } from '../../constants/categories';
import type { ComponentCategory, Pin, PinType, ShapeElement } from '../../types';
import type { ConnectivityMatrix } from '../../types/connection';
import { getShapeBounds, type Bounds } from '../../utils/alignment';
import { drawShapeOnCanvas, getDominantShapeColor } from '../../utils/canvasShape';
import type { LineSegmentData } from '../../services/lineApi';

// ---------- Constants ----------

const NODE_WIDTH = 140;
const NODE_HEIGHT = 90;
const NODE_RADIUS = 8;
const GRID_SIZE = 40;
const SNAP_THRESHOLD = 6; // World-unit snap threshold for alignment guides
const ANGLE_SNAP_THRESHOLD = 5; // Degrees threshold for H/V angle snap

const CATEGORY_COLORS: Record<string, string> = {
  powerPoint: '#22c55e',
  switchPoint: '#3b82f6',
  junctionPoint: '#6b7280',
  loadPoint: '#f97316',
};

const PIN_COLORS: Record<PinType, string> = {
  input: '#3b82f6',
  output: '#f97316',
  bidirectional: '#8b5cf6',
  power: '#eab308',
  ground: '#6b7280',
};

const EDGE_COLOR = '#94a3b8';
const EDGE_SELECTED_COLOR = '#3b82f6';
const SELECTION_BORDER_COLOR = '#2563eb';
const GRID_COLOR = '#e2e8f0';
const GRID_COLOR_MAJOR = '#cbd5e1';
const BG_COLOR = '#f8fafc';

const PIN_RADIUS = 5;
const PIN_HIT_RADIUS = 10;

// ---------- Helpers ----------

/** Transform a local point: flip in local space first, then rotate in screen space. */
function transformPoint(
  px: number, py: number,
  cx: number, cy: number,
  rotation: number, flipH: boolean, flipV: boolean,
): { x: number; y: number } {
  let dx = px - cx;
  let dy = py - cy;
  // Flip in local space
  if (flipH) dx = -dx;
  if (flipV) dy = -dy;
  // Then rotate in screen space (direction always visually correct)
  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Inverse-transform: un-rotate first, then unflip. */
function inverseTransformPoint(
  wx: number, wy: number,
  cx: number, cy: number,
  rotation: number, flipH: boolean, flipV: boolean,
): { x: number; y: number } {
  // Inverse rotate first
  const rad = -rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = wx - cx;
  const dy = wy - cy;
  const rdx = dx * cos - dy * sin;
  const rdy = dx * sin + dy * cos;
  // Then unflip
  return { x: cx + (flipH ? -rdx : rdx), y: cy + (flipV ? -rdy : rdy) };
}

/** Read transform values from instanceData. */
function getInstanceTransform(instanceData: Record<string, unknown>) {
  return {
    rotation: (instanceData as { rotation?: number }).rotation ?? 0,
    flipH: !!(instanceData as { flipH?: boolean }).flipH,
    flipV: !!(instanceData as { flipV?: boolean }).flipV,
  };
}

/** Get the world-space pin position for an instance, accounting for rotation/flip. */
function getTransformedPinPos(
  pin: Pin | undefined,
  instX: number, instY: number,
  nw: number, nh: number,
  shapesBounds: Bounds | null,
  instanceData: Record<string, unknown>,
): { x: number; y: number } {
  const thumbAreaH = nh;
  const localPos = pin
    ? getPinNodePos(pin, instX, instY, shapesBounds, nw, nh)
    : { x: instX + nw / 2, y: instY + thumbAreaH / 2 };
  const { rotation, flipH, flipV } = getInstanceTransform(instanceData);
  if (rotation === 0 && !flipH && !flipV) return localPos;
  return transformPoint(localPos.x, localPos.y, instX + nw / 2, instY + thumbAreaH / 2, rotation, flipH, flipV);
}

/** Check if a line segment is near-horizontal or near-vertical (within ANGLE_SNAP_THRESHOLD degrees). */
function getLineAxisSnap(x1: number, y1: number, x2: number, y2: number): 'horizontal' | 'vertical' | null {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx < 0.5 && dy < 0.5) return null; // degenerate
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle < ANGLE_SNAP_THRESHOLD) return 'horizontal';      // ~0°
  if (angle > 90 - ANGLE_SNAP_THRESHOLD) return 'vertical';   // ~90°
  return null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function getPinsForInstance(inst: DiagramInstance): Pin[] {
  const pins = (inst.instanceData as { pins?: Pin[] })?.pins;
  return Array.isArray(pins) ? pins : [];
}

// drawShapeOnCanvas moved to '../../utils/canvasShape' so ViewerCanvas can share it.

function computeShapesBounds(shapes: ShapeElement[]): Bounds | null {
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
  return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// getDominantShapeColor moved to '../../utils/canvasShape'.

function getPinNodePos(
  pin: Pin,
  instX: number,
  instY: number,
  shapesBounds: Bounds | null,
  nodeW: number = NODE_WIDTH,
  nodeH: number = NODE_HEIGHT,
): { x: number; y: number } {
  if (!shapesBounds || shapesBounds.width === 0 || shapesBounds.height === 0) {
    return { x: instX + pin.position.x, y: instY + pin.position.y };
  }
  const THUMB_PAD = 4;
  const thumbAreaH = nodeH;
  const availW = nodeW - THUMB_PAD * 2;
  const availH = thumbAreaH - THUMB_PAD * 2;
  const scaleX = availW / shapesBounds.width;
  const scaleY = availH / shapesBounds.height;
  const scale = Math.min(scaleX, scaleY);
  const offX = instX + THUMB_PAD + (availW - shapesBounds.width * scale) / 2;
  const offY = instY + THUMB_PAD + (availH - shapesBounds.height * scale) / 2;
  return {
    x: offX + (pin.position.x - shapesBounds.left) * scale,
    y: offY + (pin.position.y - shapesBounds.top) * scale,
  };
}

// ---------- Ref handle ----------

export interface DiagramCanvasHandle {
  screenToWorld: (screenX: number, screenY: number) => { x: number; y: number } | null;
  getContainerRect: () => DOMRect | undefined;
}

// ---------- Props ----------

export interface DiagramCanvasProps {
  instances: DiagramInstance[];
  edges: DiagramEdge[];
  componentMap: Record<string, { name: string; category: string; pins?: Pin[]; shapeElements?: ShapeElement[]; width?: number; height?: number; displayWidth?: number; displayHeight?: number }>;
  selectedInstanceId: string | null;
  selectedEdgeId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  onSelectInstance: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onRemoveEdge: (id: string) => void;
  onMoveInstance: (id: string, x: number, y: number) => void;
  onPersistInstanceMove: (id: string) => void;
  onSetZoom: (z: number) => void;
  onSetPan: (x: number, y: number) => void;
  onConnectPins?: (sourceInstanceId: string, sourcePinId: string, targetInstanceId: string, targetPinId: string) => void;
  unnamedHighlightIds?: string[];
  componentConnections?: Record<string, ConnectivityMatrix>;
  onMoveConnectionLabel?: (instanceId: string, connId: string, offsetX: number, offsetY: number) => void;
  onUpdateConnectionLabel?: (instanceId: string, connId: string, data: { name?: string; visible?: boolean; offsetX?: number; offsetY?: number }) => void;
  onMoveInstanceLabel?: (id: string, offsetX: number, offsetY: number) => void;
  onPersistInstanceLabelMove?: (id: string) => void;
  onUpdateInstanceLabel?: (id: string, label: string) => void;
  lineDataMap?: Record<string, LineSegmentData>;
  labelFontSize?: number;
}

// ---------- Component ----------

const DiagramCanvasInner = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(function DiagramCanvas({
  instances,
  edges,
  componentMap,
  selectedInstanceId,
  selectedEdgeId,
  zoom,
  panX,
  panY,
  onSelectInstance,
  onSelectEdge,
  onRemoveEdge,
  onMoveInstance,
  onPersistInstanceMove,
  onSetZoom,
  onSetPan,
  onConnectPins,
  unnamedHighlightIds = [],
  componentConnections = {},
  onMoveConnectionLabel,
  onUpdateConnectionLabel,
  onMoveInstanceLabel,
  onPersistInstanceLabelMove,
  onUpdateInstanceLabel,
  lineDataMap = {},
  labelFontSize = 20,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragRef = useRef<{
    instanceId: string;
    startWorldX: number;
    startWorldY: number;
    startInstX: number;
    startInstY: number;
    moved: boolean;
  } | null>(null);

  // Connection mode state
  const connectingFromPinRef = useRef<{
    instanceId: string;
    pinId: string;
    x: number;
    y: number;
  } | null>(null);

  // Label drag state
  const labelDragRef = useRef<{
    instanceId: string;
    connId: string;
    startOffsetX: number;
    startOffsetY: number;
    startWorldX: number;
    startWorldY: number;
  } | null>(null);

  // Instance label drag state
  const instanceLabelDragRef = useRef<{
    instanceId: string;
    startOffsetX: number;
    startOffsetY: number;
    startWorldX: number;
    startWorldY: number;
    moved: boolean;
  } | null>(null);

  // Inline label editing state
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState('');
  // Connection label editing state
  const [editingConnectionLabel, setEditingConnectionLabel] = useState<{ instanceId: string; connId: string } | null>(null);
  const [editingConnectionLabelText, setEditingConnectionLabelText] = useState('');

  // Alignment guides state
  const alignmentGuidesRef = useRef<{ axis: 'x' | 'y'; value: number }[]>([]);

  // Mouse world position for rubber-band line
  const mouseWorldPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Hovered edge for delete button
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [cursorMode, setCursorMode] = useState<'default' | 'crosshair' | 'grabbing'>('default');

  // Ref to latest hitTestPin to avoid circular deps in draw
  const hitTestPinRef = useRef<(wx: number, wy: number) => { instanceId: string; pinId: string } | null>(() => null);
  const pushOffsetsRef = useRef<Record<string, { dx: number; dy: number }>>({});

  // Expose helpers to parent via ref
  useImperativeHandle(ref, () => ({
    screenToWorld: (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (screenX - rect.left - panX) / zoom,
        y: (screenY - rect.top - panY) / zoom,
      };
    },
    getContainerRect: () => {
      return canvasRef.current?.getBoundingClientRect();
    },
  }), [panX, panY, zoom]);

  // Pan state
  const panRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // World <-> screen coordinate helpers
  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom,
    }),
    [panX, panY, zoom],
  );

  // ---------- Draw ----------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;

    // Resize buffer if needed
    if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
      canvas.width = Math.round(displayW * dpr);
      canvas.height = Math.round(displayH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayW, displayH);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, displayW, displayH);

    // ---- Grid ----
    const gridMajor = GRID_SIZE * 5;
    const worldLeft = -panX / zoom;
    const worldTop = -panY / zoom;
    const worldRight = (displayW - panX) / zoom;
    const worldBottom = (displayH - panY) / zoom;

    const gridStartX = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE;
    const gridStartY = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE;

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Minor grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5 / zoom;
    ctx.beginPath();
    for (let gx = gridStartX; gx <= worldRight; gx += GRID_SIZE) {
      ctx.moveTo(gx, worldTop);
      ctx.lineTo(gx, worldBottom);
    }
    for (let gy = gridStartY; gy <= worldBottom; gy += GRID_SIZE) {
      ctx.moveTo(worldLeft, gy);
      ctx.lineTo(worldRight, gy);
    }
    ctx.stroke();

    // Major grid
    const majorStartX = Math.floor(worldLeft / gridMajor) * gridMajor;
    const majorStartY = Math.floor(worldTop / gridMajor) * gridMajor;
    ctx.strokeStyle = GRID_COLOR_MAJOR;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    for (let gx = majorStartX; gx <= worldRight; gx += gridMajor) {
      ctx.moveTo(gx, worldTop);
      ctx.lineTo(gx, worldBottom);
    }
    for (let gy = majorStartY; gy <= worldBottom; gy += gridMajor) {
      ctx.moveTo(worldLeft, gy);
      ctx.lineTo(worldRight, gy);
    }
    ctx.stroke();

    pushOffsetsRef.current = {}; // Clear any existing offsets

    // ---- Edges ----
    for (const edge of edges) {
      const source = instances.find((i) => i.id === edge.sourceInstanceId);
      const target = instances.find((i) => i.id === edge.targetInstanceId);
      if (!source || !target) continue;

      const sourceComp = componentMap[source.componentId];
      const targetComp = componentMap[target.componentId];
      const sourceShapes = sourceComp?.shapeElements;
      const targetShapes = targetComp?.shapeElements;
      const sourceBounds = sourceShapes?.length ? computeShapesBounds(sourceShapes) : null;
      const targetBounds = targetShapes?.length ? computeShapesBounds(targetShapes) : null;

      const sourcePin = getPinsForInstance(source).find(p => p.id === edge.sourcePinId)
        || sourceComp?.pins?.find(p => p.id === edge.sourcePinId);
      const targetPin = getPinsForInstance(target).find(p => p.id === edge.targetPinId)
        || targetComp?.pins?.find(p => p.id === edge.targetPinId);

      const sNw = sourceComp?.displayWidth ?? NODE_WIDTH;
      const sNh = sourceComp?.displayHeight ?? NODE_HEIGHT;
      const tNw = targetComp?.displayWidth ?? NODE_WIDTH;
      const tNh = targetComp?.displayHeight ?? NODE_HEIGHT;
      const sThumbH = sNh;
      const tThumbH = tNh;
      const sPo = pushOffsetsRef.current[source.id] ?? { dx: 0, dy: 0 };
      const tPo = pushOffsetsRef.current[target.id] ?? { dx: 0, dy: 0 };
      const sVisX = source.positionX + sPo.dx;
      const sVisY = source.positionY + sPo.dy;
      const tVisX = target.positionX + tPo.dx;
      const tVisY = target.positionY + tPo.dy;
      const sPosLocal = sourcePin ? getPinNodePos(sourcePin, sVisX, sVisY, sourceBounds, sNw, sNh) : { x: sVisX + sNw / 2, y: sVisY + sThumbH / 2 };
      const tPosLocal = targetPin ? getPinNodePos(targetPin, tVisX, tVisY, targetBounds, tNw, tNh) : { x: tVisX + tNw / 2, y: tVisY + tThumbH / 2 };

      // Apply instance transforms to pin positions
      const sTr = getInstanceTransform(source.instanceData);
      const tTr = getInstanceTransform(target.instanceData);
      const sCx = sVisX + sNw / 2;
      const sCy = sVisY + sThumbH / 2;
      const tCx = tVisX + tNw / 2;
      const tCy = tVisY + tThumbH / 2;
      const sPos = transformPoint(sPosLocal.x, sPosLocal.y, sCx, sCy, sTr.rotation, sTr.flipH, sTr.flipV);
      const tPos = transformPoint(tPosLocal.x, tPosLocal.y, tCx, tCy, tTr.rotation, tTr.flipH, tTr.flipV);

      const sx = sPos.x;
      const sy = sPos.y;
      const tx = tPos.x;
      const ty = tPos.y;

      const isSelected = edge.id === selectedEdgeId;
      const lineData = lineDataMap[edge.id];

      // Determine line color based on wire ownership
      let edgeColor = EDGE_COLOR;
      if (lineData?.wireOwnership === 'user') {
        edgeColor = 'rgb(85,48,217)';
      } else if (lineData?.wireOwnership === 'public') {
        edgeColor = '#000000';
      }
      if (isSelected) edgeColor = EDGE_SELECTED_COLOR;

      // Determine line style based on wire type
      const isCable = lineData?.wireType === 'cable';

      // Determine opacity based on isMainDisplay
      const isMainDisplay = lineData?.isMainDisplay ?? true;
      const edgeAlpha = isMainDisplay ? 1 : 0.5;

      ctx.save();
      ctx.globalAlpha = edgeAlpha;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
      if (isCable) {
        ctx.setLineDash([8 / zoom, 4 / zoom]);
      }
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      if (isCable) {
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ---- Nodes ----
    const THUMB_PAD = 4;

    for (const inst of instances) {
      const comp = componentMap[inst.componentId];
      const cat: ComponentCategory = (comp?.category as ComponentCategory) || 'junctionPoint';
      const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.junctionPoint;
      const isSelected = inst.id === selectedInstanceId;
      const shapes = comp?.shapeElements;
      const hasShapes = shapes && shapes.length > 0;

      const nw = comp?.displayWidth ?? NODE_WIDTH;
      const nh = comp?.displayHeight ?? NODE_HEIGHT;

      const po = pushOffsetsRef.current[inst.id] ?? { dx: 0, dy: 0 };
      const x = inst.positionX + po.dx;
      const y = inst.positionY + po.dy;

      // Apply instance transform (rotation + flip) — only for shape + pins
      const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);
      const thumbAreaH = nh;
      // Rotate around center of shape area (not including label bar space)
      const cx = x + nw / 2;
      const cy = y + thumbAreaH / 2;
      ctx.save();
      ctx.translate(cx, cy);
      // Canvas applies transforms in reverse: code rotate→scale = applied scale→rotate = flip then rotate
      ctx.rotate(rotation * Math.PI / 180);
      if (flipH) ctx.scale(-1, 1);
      if (flipV) ctx.scale(1, -1);
      ctx.translate(-cx, -cy);

      // Shape thumbnail area (top portion)
      if (hasShapes) {
        ctx.save();
        // Clip to top area
        ctx.beginPath();
        ctx.rect(x, y, nw, thumbAreaH);
        ctx.clip();

        // Compute shapes bounding box and scale
        const bounds = computeShapesBounds(shapes);
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          const availW = nw - THUMB_PAD * 2;
          const availH = thumbAreaH - THUMB_PAD * 2;
          const scaleX = availW / bounds.width;
          const scaleY = availH / bounds.height;
          const scale = Math.min(scaleX, scaleY);
          const offX = x + THUMB_PAD + (availW - bounds.width * scale) / 2;
          const offY = y + THUMB_PAD + (availH - bounds.height * scale) / 2;

          ctx.translate(offX, offY);
          ctx.scale(scale, scale);
          ctx.translate(-bounds.left, -bounds.top);

          for (const s of shapes) {
            drawShapeOnCanvas(ctx, s);
          }

          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.translate(panX, panY);
          ctx.scale(zoom, zoom);
        }
        ctx.restore();
      } else {
        // No shapes — transparent background, no fill
      }

      // ---- Pins (drawn inside transform so they rotate with the shape) ----
      const showPins = zoom > 0.5 || isSelected;
      if (showPins) {
        const pins = getPinsForInstance(inst).length > 0
          ? getPinsForInstance(inst)
          : (comp?.pins || []);
        const sBounds = hasShapes ? computeShapesBounds(shapes!) : null;

        for (const pin of pins) {
          const pos = getPinNodePos(pin, x, y, sBounds, nw, nh);
          const px = pos.x;
          const py = pos.y;
          const pinColor = PIN_COLORS[pin.pinType] || PIN_COLORS.bidirectional;

          // Pin outer circle
          ctx.beginPath();
          ctx.arc(px, py, PIN_RADIUS / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = pinColor;
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();

          // Pin inner dot
          ctx.beginPath();
          ctx.arc(px, py, (PIN_RADIUS - 2) / zoom, 0, Math.PI * 2);
          ctx.fillStyle = pinColor;
          ctx.fill();

          // Pin label (when zoomed in enough)
          if (zoom > 0.7 && pin.label) {
            ctx.fillStyle = '#607286';
            ctx.font = `${9 / Math.max(zoom, 0.3)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(pin.label, px + (PIN_RADIUS + 3) / zoom, py);
          }
        }
      }

      // Outer border + selection highlight (inside transform, around shape area only)
      const isUnnamed = unnamedHighlightIds.includes(inst.id);
      ctx.strokeStyle = isSelected ? SELECTION_BORDER_COLOR : 'rgba(148,163,184,0.4)';
      ctx.lineWidth = isSelected ? 2.5 / zoom : 1 / zoom;
      ctx.beginPath();
      roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
      ctx.stroke();
      if (isSelected) {
        ctx.fillStyle = 'rgba(37,99,235,0.06)';
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.fill();
      }

      // Unnamed instance flashing highlight
      if (isUnnamed) {
        const flash = Math.sin(Date.now() / 300) > 0;
        if (flash) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3 / zoom;
          ctx.beginPath();
          roundRect(ctx, x - 2, y - 2, nw + 4, thumbAreaH + 4, NODE_RADIUS + 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(239,68,68,0.08)';
          ctx.beginPath();
          roundRect(ctx, x - 2, y - 2, nw + 4, thumbAreaH + 4, NODE_RADIUS + 2);
          ctx.fill();
        }
      }

      ctx.restore(); // end shape/pin transform

      // ---- Label bar (always upright, below the visual bounding box, zoom-independent) ----
      const corners = (rotation !== 0 || flipH || flipV)
        ? [
            transformPoint(x, y, cx, cy, rotation, flipH, flipV),
            transformPoint(x + nw, y, cx, cy, rotation, flipH, flipV),
            transformPoint(x, y + thumbAreaH, cx, cy, rotation, flipH, flipV),
            transformPoint(x + nw, y + thumbAreaH, cx, cy, rotation, flipH, flipV),
          ]
        : null;
      const shapeBottom = corners ? Math.max(...corners.map((c) => c.y)) : y + thumbAreaH;
      const shapeCenterX = corners
        ? (Math.min(...corners.map((c) => c.x)) + Math.max(...corners.map((c) => c.x))) / 2
        : x + nw / 2;
      const gap = corners ? 2 : 0;
      const labelTop = shapeBottom + gap;

      // Apply label offset from instanceData (stored as world coordinates)
      const instData = (inst.instanceData as Record<string, unknown>) ?? {};
      const labelOffsetX = (instData.labelOffsetX as number) ?? 0;
      const labelOffsetY = (instData.labelOffsetY as number) ?? 0;

      const label = inst.label || comp?.name || (CATEGORY_LABELS[cat] || '未知');

      // Skip canvas rendering if inline editing this label
      if (editingLabelId !== inst.id) {
        // Label scales with zoom (world-space text)
        const fontSize = labelFontSize;
        ctx.save();
        ctx.translate(shapeCenterX + labelOffsetX, labelTop + labelOffsetY);

        const rawColor = (comp?.shapeElements?.length ? getDominantShapeColor(comp.shapeElements) : null) ?? color;
        const dominantColor = /^#ffffff$/i.test(rawColor) || /^#fff$/i.test(rawColor) || /^white$/i.test(rawColor) ? '#000000' : rawColor;
        ctx.fillStyle = dominantColor;
        ctx.font = `500 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, fontSize / 2);

        ctx.restore();
      }
    }

    // ---- Connection labels (drawn on top of nodes) ----
    for (const inst of instances) {
      const comp = componentMap[inst.componentId];
      if (!comp) continue;
      const matrix = componentConnections[inst.componentId];
      if (!matrix || matrix.connections.length === 0) continue;

      const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
      const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
      if (Object.keys(connectionLabels).length === 0) continue;

      const nw = comp.displayWidth ?? comp.width ?? NODE_WIDTH;
      const nh = comp.displayHeight ?? comp.height ?? NODE_HEIGHT;
      const x = inst.positionX;
      const y = inst.positionY;

      const pins = comp.pins ?? [];
      const pinMap = Object.fromEntries(pins.map((p) => [p.id, p]));
      const shapesBounds = comp.shapeElements?.length ? computeShapesBounds(comp.shapeElements) : null;

      for (const conn of matrix.connections) {
        const entry = connectionLabels[conn.id];
        if (!entry || !entry.visible || !entry.name) continue;

        const pinA = pinMap[conn.pinAId];
        const pinB = pinMap[conn.pinBId];
        if (!pinA || !pinB) continue;

        const posA = getTransformedPinPos(pinA, x, y, nw, nh, shapesBounds, instanceData);
        const posB = getTransformedPinPos(pinB, x, y, nw, nh, shapesBounds, instanceData);

        const midX = (posA.x + posB.x) / 2 + entry.offsetX;
        const midY = (posA.y + posB.y) / 2 + entry.offsetY;

        // Connection label scales with zoom (world-space)
        ctx.save();
        ctx.translate(midX, midY);

        const fontSize = 12;
        ctx.font = `500 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        const textW = ctx.measureText(entry.name).width;
        const padX = 6;
        const padY = 3;

        // Background
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeStyle = 'rgba(148,163,184,0.6)';
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        roundRect(ctx, -textW / 2 - padX, -fontSize / 2 - padY, textW + padX * 2, fontSize + padY * 2, 3);
        ctx.fill();
        ctx.stroke();

        // Text
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(entry.name, 0, 0);

        ctx.restore();
      }
    }

    // ---- Rubber-band line for pin connection ----
    const connectingFrom = connectingFromPinRef.current;
    if (connectingFrom) {
      const mwp = mouseWorldPosRef.current;

      // Check snap to nearby pin
      const snapPin = hitTestPinRef.current(mwp.x, mwp.y);
      let targetX = mwp.x;
      let targetY = mwp.y;
      if (snapPin && snapPin.instanceId !== connectingFrom.instanceId) {
        const snapInst = instances.find((i) => i.id === snapPin.instanceId);
        if (snapInst) {
          const snapComp = componentMap[snapInst.componentId];
          const snapPins = getPinsForInstance(snapInst).length > 0
            ? getPinsForInstance(snapInst)
            : (snapComp?.pins || []);
          const snapPinData = snapPins.find((p) => p.id === snapPin.pinId);
          if (snapPinData) {
            const snapBounds = snapComp?.shapeElements?.length ? computeShapesBounds(snapComp.shapeElements) : null;
            const snapPo = pushOffsetsRef.current[snapInst.id] ?? { dx: 0, dy: 0 };
            const snapPos = getTransformedPinPos(snapPinData, snapInst.positionX + snapPo.dx, snapInst.positionY + snapPo.dy, snapComp?.displayWidth ?? NODE_WIDTH, snapComp?.displayHeight ?? NODE_HEIGHT, snapBounds, snapInst.instanceData);
            targetX = snapPos.x;
            targetY = snapPos.y;
          }
        }
      }

      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(connectingFrom.x, connectingFrom.y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Highlight the source pin
      ctx.beginPath();
      ctx.arc(connectingFrom.x, connectingFrom.y, PIN_RADIUS * 1.5 / zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / zoom;
      ctx.stroke();

      // Snap target indicator
      if (snapPin && targetX !== mwp.x) {
        ctx.beginPath();
        ctx.arc(targetX, targetY, PIN_RADIUS * 2 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5 / zoom;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(targetX, targetY, PIN_RADIUS / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
      }
    }

    // ---- Hovered edge delete button ----
    if (hoveredEdgeId) {
      const hoveredEdge = edges.find((e) => e.id === hoveredEdgeId);
      if (hoveredEdge) {
        const source = instances.find((i) => i.id === hoveredEdge.sourceInstanceId);
        const target = instances.find((i) => i.id === hoveredEdge.targetInstanceId);
        if (source && target) {
          const sourceComp = componentMap[source.componentId];
          const targetComp = componentMap[target.componentId];
          const sourceBounds = sourceComp?.shapeElements?.length ? computeShapesBounds(sourceComp.shapeElements) : null;
          const targetBounds = targetComp?.shapeElements?.length ? computeShapesBounds(targetComp.shapeElements) : null;
          const sourcePin = getPinsForInstance(source).find(p => p.id === hoveredEdge.sourcePinId) || sourceComp?.pins?.find(p => p.id === hoveredEdge.sourcePinId);
          const targetPin = getPinsForInstance(target).find(p => p.id === hoveredEdge.targetPinId) || targetComp?.pins?.find(p => p.id === hoveredEdge.targetPinId);
          const sPo = pushOffsetsRef.current[source.id] ?? { dx: 0, dy: 0 };
          const tPo = pushOffsetsRef.current[target.id] ?? { dx: 0, dy: 0 };
          const sPos = getTransformedPinPos(sourcePin, source.positionX + sPo.dx, source.positionY + sPo.dy, sourceComp?.displayWidth ?? NODE_WIDTH, sourceComp?.displayHeight ?? NODE_HEIGHT, sourceBounds, source.instanceData);
          const tPos = getTransformedPinPos(targetPin, target.positionX + tPo.dx, target.positionY + tPo.dy, targetComp?.displayWidth ?? NODE_WIDTH, targetComp?.displayHeight ?? NODE_HEIGHT, targetBounds, target.instanceData);

          const midX = (sPos.x + tPos.x) / 2;
          const midY = (sPos.y + tPos.y) / 2;
          const btnR = 10 / zoom;

          // Circle background
          ctx.beginPath();
          ctx.arc(midX, midY, btnR, 0, Math.PI * 2);
          ctx.fillStyle = '#fef2f2';
          ctx.fill();
          ctx.strokeStyle = '#fca5a5';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();

          // X mark
          const xSize = 4 / zoom;
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 2 / zoom;
          ctx.beginPath();
          ctx.moveTo(midX - xSize, midY - xSize);
          ctx.lineTo(midX + xSize, midY + xSize);
          ctx.moveTo(midX + xSize, midY - xSize);
          ctx.lineTo(midX - xSize, midY + xSize);
          ctx.stroke();
        }
      }
    }

    // ---- Alignment guides ----
    const guides = alignmentGuidesRef.current;
    if (guides.length > 0) {
      // Compute visible world bounds
      const vl = -panX / zoom;
      const vt = -panY / zoom;
      const vr = (canvas.width / dpr - panX) / zoom;
      const vb = (canvas.height / dpr - panY) / zoom;

      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeStyle = '#ff4081';
      ctx.lineWidth = 1.5 / zoom;

      for (const g of guides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          ctx.moveTo(g.value, vt);
          ctx.lineTo(g.value, vb);
        } else {
          ctx.moveTo(vl, g.value);
          ctx.lineTo(vr, g.value);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [instances, edges, componentMap, selectedInstanceId, selectedEdgeId, zoom, panX, panY, hoveredEdgeId, unnamedHighlightIds, componentConnections, editingLabelId, editingConnectionLabel, lineDataMap, labelFontSize]);

  // ---------- Render loop ----------

  const rafRef = useRef<number>(0);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Redraw on state changes
  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  // ---------- Resize observer ----------

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      requestDraw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestDraw]);

  // ---------- Hit test ----------

  const hitTestInstance = useCallback(
    (worldX: number, worldY: number): string | null => {
      // Iterate in reverse so topmost is hit first
      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        const comp = componentMap[inst.componentId];
        const nw = comp?.displayWidth ?? NODE_WIDTH;
        const nh = comp?.displayHeight ?? NODE_HEIGHT;
        const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);
        const thumbAreaH = nh;
        const po = pushOffsetsRef.current[inst.id] ?? { dx: 0, dy: 0 };
        const vx = inst.positionX + po.dx;
        const vy = inst.positionY + po.dy;
        const cx = vx + nw / 2;
        const cy = vy + thumbAreaH / 2;
        const local = inverseTransformPoint(worldX, worldY, cx, cy, rotation, flipH, flipV);
        if (
          local.x >= vx &&
          local.x <= vx + nw &&
          local.y >= vy &&
          local.y <= vy + thumbAreaH
        ) {
          return inst.id;
        }
      }
      return null;
    },
    [instances, componentMap],
  );

  const hitTestInstanceLabel = useCallback(
    (worldX: number, worldY: number): string | null => {
      const padding = 6 / zoom; // extra hit padding around label
      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        const comp = componentMap[inst.componentId];
        const nw = comp?.displayWidth ?? NODE_WIDTH;
        const nh = comp?.displayHeight ?? NODE_HEIGHT;
        const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);
        const thumbAreaH = nh;
        const cx = inst.positionX + nw / 2;
        const cy = inst.positionY + thumbAreaH / 2;

        const corners = (rotation !== 0 || flipH || flipV)
          ? [
              transformPoint(inst.positionX, inst.positionY, cx, cy, rotation, flipH, flipV),
              transformPoint(inst.positionX + nw, inst.positionY, cx, cy, rotation, flipH, flipV),
              transformPoint(inst.positionX, inst.positionY + thumbAreaH, cx, cy, rotation, flipH, flipV),
              transformPoint(inst.positionX + nw, inst.positionY + thumbAreaH, cx, cy, rotation, flipH, flipV),
            ]
          : null;
        const sBottom = corners ? Math.max(...corners.map(c => c.y)) : inst.positionY + thumbAreaH;
        const sCenterX = corners
          ? (Math.min(...corners.map(c => c.x)) + Math.max(...corners.map(c => c.x))) / 2
          : inst.positionX + nw / 2;
        const gap = corners ? 2 : 0;

        const instData = (inst.instanceData as Record<string, unknown>) ?? {};
        const labelOffsetX = (instData.labelOffsetX as number) ?? 0;
        const labelOffsetY = (instData.labelOffsetY as number) ?? 0;
        // Offset is in world coordinates
        const labelCX = sCenterX + labelOffsetX;
        const labelTY = sBottom + gap + labelOffsetY;

        // Label scales with zoom (world-space)
        const label = inst.label || comp?.name || '未知';
        const fontSize = labelFontSize;
        const approxW = label.length * fontSize * 0.6;
        const approxH = fontSize + 8;

        if (
          worldX >= labelCX - approxW / 2 - padding &&
          worldX <= labelCX + approxW / 2 + padding &&
          worldY >= labelTY - padding &&
          worldY <= labelTY + approxH + padding
        ) {
          return inst.id;
        }
      }
      return null;
    },
    [instances, componentMap, zoom],
  );

  /**
   * Compute snap alignment guides while dragging an instance.
   * Returns snapped position and guide lines to render.
   */
  /** Compute rotated AABB edges for an instance at a given position. */
  const getVisualBounds = useCallback(
    (instX: number, instY: number, w: number, h: number, rotation: number, flipH: boolean, flipV: boolean) => {
      // Use thumbAreaH (excluding label bar) for the visual shape bounds
      const thumbH = h;
      if (rotation === 0 && !flipH && !flipV) {
        return { left: instX, right: instX + w, top: instY, bottom: instY + thumbH, cx: instX + w / 2, cy: instY + thumbH / 2 };
      }
      const cx = instX + w / 2;
      const cy = instY + thumbH / 2;
      const corners = [
        transformPoint(instX, instY, cx, cy, rotation, flipH, flipV),
        transformPoint(instX + w, instY, cx, cy, rotation, flipH, flipV),
        transformPoint(instX, instY + thumbH, cx, cy, rotation, flipH, flipV),
        transformPoint(instX + w, instY + thumbH, cx, cy, rotation, flipH, flipV),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), cx, cy };
    },
    [],
  );

  const computeSnapGuides = useCallback(
    (dragId: string, rawX: number, rawY: number, dragW: number, dragH: number) => {
      // Collect all candidate snaps: { delta, axis, guideValue }
      type Cand = { delta: number; axis: 'x' | 'y'; gv: number };
      const cands: Cand[] = [];

      // Get drag instance's visual bounds (accounting for rotation/flip)
      const dragInst = instances.find((i) => i.id === dragId);
      const dragTr = dragInst ? getInstanceTransform(dragInst.instanceData) : { rotation: 0, flipH: false, flipV: false };
      const db = getVisualBounds(rawX, rawY, dragW, dragH, dragTr.rotation, dragTr.flipH, dragTr.flipV);

      for (const inst of instances) {
        if (inst.id === dragId) continue;
        const comp = componentMap[inst.componentId];
        const ow = comp?.displayWidth ?? NODE_WIDTH;
        const oh = comp?.displayHeight ?? NODE_HEIGHT;
        const tr = getInstanceTransform(inst.instanceData);
        const ob = getVisualBounds(inst.positionX, inst.positionY, ow, oh, tr.rotation, tr.flipH, tr.flipV);

        // X-axis: compare visual left, right, center-x
        for (const [dv, rv] of [
          [db.left, ob.left], [db.left, ob.right],
          [db.right, ob.left], [db.right, ob.right],
          [db.cx, ob.cx],
        ] as [number, number][]) {
          cands.push({ delta: dv - rv, axis: 'x', gv: rv });
        }
        // Y-axis: compare visual top, bottom, center-y
        for (const [dv, rv] of [
          [db.top, ob.top], [db.top, ob.bottom],
          [db.bottom, ob.top], [db.bottom, ob.bottom],
          [db.cy, ob.cy],
        ] as [number, number][]) {
          cands.push({ delta: dv - rv, axis: 'y', gv: rv });
        }
      }

      // Find best snap per axis
      const withinThreshold = cands.filter((c) => Math.abs(c.delta) <= SNAP_THRESHOLD);
      const bestX = withinThreshold.filter((c) => c.axis === 'x').sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
      const bestY = withinThreshold.filter((c) => c.axis === 'y').sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];

      const snappedX = bestX ? rawX - bestX.delta : rawX;
      const snappedY = bestY ? rawY - bestY.delta : rawY;

      // Collect guides that match the best delta (deduplicated)
      const guides: { axis: 'x' | 'y'; value: number }[] = [];
      const seen = new Set<string>();
      const addGuide = (c: Cand) => {
        const key = `${c.axis}:${Math.round(c.gv * 100)}`;
        if (!seen.has(key)) {
          seen.add(key);
          guides.push({ axis: c.axis, value: c.gv });
        }
      };
      if (bestX) {
        for (const c of withinThreshold) {
          if (c.axis === 'x' && Math.abs(c.delta - bestX.delta) < 0.5) addGuide(c);
        }
      }
      if (bestY) {
        for (const c of withinThreshold) {
          if (c.axis === 'y' && Math.abs(c.delta - bestY.delta) < 0.5) addGuide(c);
        }
      }

      return { snappedX, snappedY, guides };
    },
    [instances, componentMap, getVisualBounds],
  );

  /** Hit test a pin across all instances. Returns { instanceId, pinId } if hit. */
  const hitTestPin = useCallback(
    (worldX: number, worldY: number): { instanceId: string; pinId: string } | null => {
      const threshold = PIN_HIT_RADIUS / zoom;
      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        const comp = componentMap[inst.componentId];
        const pins = getPinsForInstance(inst).length > 0
          ? getPinsForInstance(inst)
          : (comp?.pins || []);
        const shapes = comp?.shapeElements;
        const sBounds = shapes?.length ? computeShapesBounds(shapes) : null;
        const nw = comp?.displayWidth ?? NODE_WIDTH;
        const nh = comp?.displayHeight ?? NODE_HEIGHT;
        const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);
        const thumbAreaH = nh;
        const po = pushOffsetsRef.current[inst.id] ?? { dx: 0, dy: 0 };
        const vx = inst.positionX + po.dx;
        const vy = inst.positionY + po.dy;
        const icx = vx + nw / 2;
        const icy = vy + thumbAreaH / 2;

        for (const pin of pins) {
          const localPos = getPinNodePos(pin, vx, vy, sBounds, nw, nh);
          const pos = transformPoint(localPos.x, localPos.y, icx, icy, rotation, flipH, flipV);
          const dist = Math.sqrt((worldX - pos.x) ** 2 + (worldY - pos.y) ** 2);
          if (dist <= threshold) {
            return { instanceId: inst.id, pinId: pin.id };
          }
        }
      }
      return null;
    },
    [instances, componentMap, zoom],
  );
  useEffect(() => { hitTestPinRef.current = hitTestPin; }, [hitTestPin]);

  const hitTestEdge = useCallback(
    (worldX: number, worldY: number): string | null => {
      const threshold = 8 / zoom;
      for (const edge of edges) {
        const source = instances.find((i) => i.id === edge.sourceInstanceId);
        const target = instances.find((i) => i.id === edge.targetInstanceId);
        if (!source || !target) continue;

        const sourceComp = componentMap[source.componentId];
        const targetComp = componentMap[target.componentId];
        const sourceBounds = sourceComp?.shapeElements?.length ? computeShapesBounds(sourceComp.shapeElements) : null;
        const targetBounds = targetComp?.shapeElements?.length ? computeShapesBounds(targetComp.shapeElements) : null;

        const sourcePin = getPinsForInstance(source).find(p => p.id === edge.sourcePinId)
          || sourceComp?.pins?.find(p => p.id === edge.sourcePinId);
        const targetPin = getPinsForInstance(target).find(p => p.id === edge.targetPinId)
          || targetComp?.pins?.find(p => p.id === edge.targetPinId);

        const sPo = pushOffsetsRef.current[source.id] ?? { dx: 0, dy: 0 };
        const tPo = pushOffsetsRef.current[target.id] ?? { dx: 0, dy: 0 };
        const sPos = getTransformedPinPos(sourcePin, source.positionX + sPo.dx, source.positionY + sPo.dy, sourceComp?.displayWidth ?? NODE_WIDTH, sourceComp?.displayHeight ?? NODE_HEIGHT, sourceBounds, source.instanceData);
        const tPos = getTransformedPinPos(targetPin, target.positionX + tPo.dx, target.positionY + tPo.dy, targetComp?.displayWidth ?? NODE_WIDTH, targetComp?.displayHeight ?? NODE_HEIGHT, targetBounds, target.instanceData);

        const sx = sPos.x;
        const sy = sPos.y;
        const tx = tPos.x;
        const ty = tPos.y;

        // Distance from point to line segment
        const dx = tx - sx;
        const dy = ty - sy;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;

        let t = ((worldX - sx) * dx + (worldY - sy) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const closestX = sx + t * dx;
        const closestY = sy + t * dy;
        const dist = Math.sqrt((worldX - closestX) ** 2 + (worldY - closestY) ** 2);

        if (dist < threshold) {
          return edge.id;
        }
      }
      return null;
    },
    [edges, instances, componentMap, zoom],
  );

  const hitTestConnectionLabel = useCallback(
    (worldX: number, worldY: number): { instanceId: string; connId: string } | null => {
      const threshold = 14; // hit area in world coords
      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        const comp = componentMap[inst.componentId];
        if (!comp) continue;
        const matrix = componentConnections[inst.componentId];
        if (!matrix || matrix.connections.length === 0) continue;

        const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
        const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};

        const pins = comp.pins ?? [];
        const pinMap = Object.fromEntries(pins.map((p) => [p.id, p]));
        const nw = comp.displayWidth ?? comp.width ?? NODE_WIDTH;
        const nh = comp.displayHeight ?? comp.height ?? NODE_HEIGHT;
        const shapesBounds = comp.shapeElements?.length ? computeShapesBounds(comp.shapeElements) : null;

        for (const conn of matrix.connections) {
          const entry = connectionLabels[conn.id];
          if (!entry || !entry.visible || !entry.name) continue;

          const pinA = pinMap[conn.pinAId];
          const pinB = pinMap[conn.pinBId];
          if (!pinA || !pinB) continue;

          const posA = getTransformedPinPos(pinA, inst.positionX, inst.positionY, nw, nh, shapesBounds, instanceData);
          const posB = getTransformedPinPos(pinB, inst.positionX, inst.positionY, nw, nh, shapesBounds, instanceData);

          const midX = (posA.x + posB.x) / 2 + entry.offsetX;
          const midY = (posA.y + posB.y) / 2 + entry.offsetY;

          const dist = Math.sqrt((worldX - midX) ** 2 + (worldY - midY) ** 2);
          if (dist <= threshold) {
            return { instanceId: inst.id, connId: conn.id };
          }
        }
      }
      return null;
    },
    [instances, componentMap, componentConnections],
  );

  // ---------- Mouse handlers ----------

  /** Compute edge midpoint in world coords */
  const getEdgeMidpoint = useCallback(
    (edgeId: string): { x: number; y: number } | null => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return null;
      const source = instances.find((i) => i.id === edge.sourceInstanceId);
      const target = instances.find((i) => i.id === edge.targetInstanceId);
      if (!source || !target) return null;
      const sourceComp = componentMap[source.componentId];
      const targetComp = componentMap[target.componentId];
      const sourceBounds = sourceComp?.shapeElements?.length ? computeShapesBounds(sourceComp.shapeElements) : null;
      const targetBounds = targetComp?.shapeElements?.length ? computeShapesBounds(targetComp.shapeElements) : null;
      const sourcePin = getPinsForInstance(source).find(p => p.id === edge.sourcePinId) || sourceComp?.pins?.find(p => p.id === edge.sourcePinId);
      const targetPin = getPinsForInstance(target).find(p => p.id === edge.targetPinId) || targetComp?.pins?.find(p => p.id === edge.targetPinId);
      const sPo = pushOffsetsRef.current[source.id] ?? { dx: 0, dy: 0 };
      const tPo = pushOffsetsRef.current[target.id] ?? { dx: 0, dy: 0 };
      const sPos = getTransformedPinPos(sourcePin, source.positionX + sPo.dx, source.positionY + sPo.dy, sourceComp?.displayWidth ?? NODE_WIDTH, sourceComp?.displayHeight ?? NODE_HEIGHT, sourceBounds, source.instanceData);
      const tPos = getTransformedPinPos(targetPin, target.positionX + tPo.dx, target.positionY + tPo.dy, targetComp?.displayWidth ?? NODE_WIDTH, targetComp?.displayHeight ?? NODE_HEIGHT, targetBounds, target.instanceData);
      return { x: (sPos.x + tPos.x) / 2, y: (sPos.y + tPos.y) / 2 };
    },
    [edges, instances, componentMap],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      // Middle-click / right-click / Ctrl+left-click => pan
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        e.preventDefault();
        panRef.current = {
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: panX,
          startPanY: panY,
        };
        setCursorMode('grabbing');
        return;
      }

      if (e.button !== 0) return;

      // Check edge delete button click
      if (hoveredEdgeId) {
        const mid = getEdgeMidpoint(hoveredEdgeId);
        if (mid) {
          const dist = Math.sqrt((world.x - mid.x) ** 2 + (world.y - mid.y) ** 2);
          if (dist <= 12 / zoom) {
            onRemoveEdge(hoveredEdgeId);
            setHoveredEdgeId(null);
            return;
          }
        }
      }

      // If in connection mode, check if we clicked a pin or empty space
      if (connectingFromPinRef.current) {
        const hitPin = hitTestPin(world.x, world.y);
        if (hitPin && hitPin.instanceId !== connectingFromPinRef.current.instanceId) {
          // Complete the connection
          onConnectPins?.(
            connectingFromPinRef.current.instanceId,
            connectingFromPinRef.current.pinId,
            hitPin.instanceId,
            hitPin.pinId,
          );
        }
        // Cancel connection mode regardless
        connectingFromPinRef.current = null;
        setCursorMode('default');
        requestDraw();
        return;
      }

      // Hit test pin first (pins are above nodes)
      const hitPinResult = hitTestPin(world.x, world.y);
      if (hitPinResult) {
        // Start connection mode from this pin
        const inst = instances.find((i) => i.id === hitPinResult.instanceId);
        if (inst) {
          const comp = componentMap[inst.componentId];
          const pins = getPinsForInstance(inst).length > 0
            ? getPinsForInstance(inst)
            : (comp?.pins || []);
          const pin = pins.find((p) => p.id === hitPinResult.pinId);
          if (pin) {
            const shapes = comp?.shapeElements;
            const sBounds = shapes?.length ? computeShapesBounds(shapes) : null;
            const nw = comp?.displayWidth ?? NODE_WIDTH;
            const nh = comp?.displayHeight ?? NODE_HEIGHT;
            const srcPo = pushOffsetsRef.current[inst.id] ?? { dx: 0, dy: 0 };
            const pos = getTransformedPinPos(pin, inst.positionX + srcPo.dx, inst.positionY + srcPo.dy, nw, nh, sBounds, inst.instanceData);
            connectingFromPinRef.current = {
              instanceId: inst.id,
              pinId: pin.id,
              x: pos.x,
              y: pos.y,
            };
            setCursorMode('crosshair');
            onSelectInstance(inst.id);
            requestDraw();
          }
        }
        return;
      }

      // Hit test instance label (drag to reposition)
      const hitInstLabel = hitTestInstanceLabel(world.x, world.y);
      if (hitInstLabel) {
        const inst = instances.find((i) => i.id === hitInstLabel);
        if (inst) {
          const instData = (inst.instanceData as Record<string, unknown>) ?? {};
          instanceLabelDragRef.current = {
            instanceId: hitInstLabel,
            startOffsetX: (instData.labelOffsetX as number) ?? 0,
            startOffsetY: (instData.labelOffsetY as number) ?? 0,
            startWorldX: world.x,
            startWorldY: world.y,
            moved: false,
          };
          setCursorMode('grabbing');
          onSelectInstance(hitInstLabel);
          return;
        }
      }

      // Hit test connection label
      const hitLabel = hitTestConnectionLabel(world.x, world.y);
      if (hitLabel) {
        const inst = instances.find((i) => i.id === hitLabel.instanceId);
        if (inst) {
          const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
          const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
          const entry = connectionLabels[hitLabel.connId];
          if (entry) {
            labelDragRef.current = {
              instanceId: hitLabel.instanceId,
              connId: hitLabel.connId,
              startOffsetX: entry.offsetX,
              startOffsetY: entry.offsetY,
              startWorldX: world.x,
              startWorldY: world.y,
            };
            setCursorMode('grabbing');
            onSelectInstance(hitLabel.instanceId);
            return;
          }
        }
      }

      // Hit test node
      const hitId = hitTestInstance(world.x, world.y);
      if (hitId) {
        const inst = instances.find((i) => i.id === hitId);
        if (inst) {
          dragRef.current = {
            instanceId: hitId,
            startWorldX: world.x,
            startWorldY: world.y,
            startInstX: inst.positionX,
            startInstY: inst.positionY,
            moved: false,
          };
          setCursorMode('grabbing');
          onSelectInstance(hitId);
        }
        return;
      }

      // Hit test edge
      const hitEdge = hitTestEdge(world.x, world.y);
      if (hitEdge) {
        onSelectEdge(hitEdge);
        return;
      }

      // Deselect
      onSelectInstance(null);
    },
    [screenToWorld, panX, panY, hitTestInstance, hitTestPin, hitTestEdge, hitTestConnectionLabel, hitTestInstanceLabel, instances, componentMap, onSelectInstance, onSelectEdge, onRemoveEdge, onConnectPins, requestDraw, hoveredEdgeId, getEdgeMidpoint, zoom],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      // Update mouse world position for rubber-band line
      if (connectingFromPinRef.current) {
        mouseWorldPosRef.current = { x: world.x, y: world.y };
        requestDraw();
      }

      // Hover edge detection for delete button
      if (!connectingFromPinRef.current && !panRef.current && !dragRef.current) {
        const hitEdge = hitTestEdge(world.x, world.y);
        if (hitEdge !== hoveredEdgeId) {
          setHoveredEdgeId(hitEdge);
        }
      }

      // Panning
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startScreenX;
        const dy = e.clientY - panRef.current.startScreenY;
        onSetPan(panRef.current.startPanX + dx, panRef.current.startPanY + dy);
        return;
      }

      // Dragging instance label (offset in world coordinates)
      if (instanceLabelDragRef.current) {
        const dx = world.x - instanceLabelDragRef.current.startWorldX;
        const dy = world.y - instanceLabelDragRef.current.startWorldY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          instanceLabelDragRef.current.moved = true;
        }
        const newOffsetX = instanceLabelDragRef.current.startOffsetX + dx;
        const newOffsetY = instanceLabelDragRef.current.startOffsetY + dy;
        onMoveInstanceLabel?.(instanceLabelDragRef.current.instanceId, newOffsetX, newOffsetY);
        requestDraw();
        return;
      }

      // Dragging connection label
      if (labelDragRef.current) {
        const dx = world.x - labelDragRef.current.startWorldX;
        const dy = world.y - labelDragRef.current.startWorldY;
        const newOffsetX = labelDragRef.current.startOffsetX + dx;
        const newOffsetY = labelDragRef.current.startOffsetY + dy;
        onMoveConnectionLabel?.(labelDragRef.current.instanceId, labelDragRef.current.connId, newOffsetX, newOffsetY);
        requestDraw();
        return;
      }

      // Dragging node
      if (dragRef.current) {
        const dx = world.x - dragRef.current.startWorldX;
        const dy = world.y - dragRef.current.startWorldY;

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragRef.current.moved = true;
        }

        const rawX = dragRef.current.startInstX + dx;
        const rawY = dragRef.current.startInstY + dy;

        // Get dragged instance dimensions
        const dragInst = instances.find((i) => i.id === dragRef.current!.instanceId);
        const dragComp = dragInst ? componentMap[dragInst.componentId] : null;
        const dragW = dragComp?.displayWidth ?? NODE_WIDTH;
        const dragH = dragComp?.displayHeight ?? NODE_HEIGHT;

        // Alignment snap
        const snapResult = computeSnapGuides(
          dragRef.current.instanceId, rawX, rawY, dragW, dragH,
        );
        let { snappedX, snappedY } = snapResult;
        const { guides } = snapResult;

        // Edge angle snap: check connected edges for H/V
        const edgeGuides: { axis: 'x' | 'y'; value: number }[] = [];
        if (dragInst) {
          const dragPins = getPinsForInstance(dragInst).length > 0
            ? getPinsForInstance(dragInst)
            : (dragComp?.pins || []);
          const dragShapes = dragComp?.shapeElements;
          const dragSBounds = dragShapes?.length ? computeShapesBounds(dragShapes) : null;

          for (const edge of edges) {
            let otherInst: DiagramInstance | undefined;
            let otherComp: typeof dragComp | undefined = undefined;
            let dragPinId: string | undefined;
            let otherPinId: string | undefined;

            if (edge.sourceInstanceId === dragRef.current!.instanceId) {
              otherInst = instances.find((i) => i.id === edge.targetInstanceId);
              otherComp = otherInst ? componentMap[otherInst.componentId] ?? undefined : undefined;
              dragPinId = edge.sourcePinId;
              otherPinId = edge.targetPinId;
            } else if (edge.targetInstanceId === dragRef.current!.instanceId) {
              otherInst = instances.find((i) => i.id === edge.sourceInstanceId);
              otherComp = otherInst ? componentMap[otherInst.componentId] ?? undefined : undefined;
              dragPinId = edge.targetPinId;
              otherPinId = edge.sourcePinId;
            }
            if (!otherInst || !otherComp) continue;

            // Other pin position (fixed, not dragged)
            const otherPins = getPinsForInstance(otherInst).length > 0
              ? getPinsForInstance(otherInst)
              : (otherComp?.pins || []);
            const otherPin = otherPins.find((p) => p.id === otherPinId);
            const otherSBounds = otherComp?.shapeElements?.length ? computeShapesBounds(otherComp.shapeElements) : null;
            const otherPo = pushOffsetsRef.current[otherInst.id] ?? { dx: 0, dy: 0 };
            const otherPos = getTransformedPinPos(otherPin, otherInst.positionX + otherPo.dx, otherInst.positionY + otherPo.dy, otherComp?.displayWidth ?? NODE_WIDTH, otherComp?.displayHeight ?? NODE_HEIGHT, otherSBounds, otherInst.instanceData);

            // Dragged pin position at current snapped location (with instance transform applied)
            const dragPin = dragPins.find((p) => p.id === dragPinId);
            const dragLocalPos = dragPin
              ? getPinNodePos(dragPin, snappedX, snappedY, dragSBounds, dragComp?.displayWidth, dragComp?.displayHeight)
              : { x: snappedX + dragW / 2, y: snappedY + dragH / 2 };
            // Apply the dragged instance's rotation/flip transform
            const dragTr = getInstanceTransform(dragInst!.instanceData);
            const dragPos = (dragTr.rotation !== 0 || dragTr.flipH || dragTr.flipV)
              ? transformPoint(dragLocalPos.x, dragLocalPos.y, snappedX + dragW / 2, snappedY + dragH / 2, dragTr.rotation, dragTr.flipH, dragTr.flipV)
              : dragLocalPos;

            const axisSnap = getLineAxisSnap(dragPos.x, dragPos.y, otherPos.x, otherPos.y);
            if (axisSnap === 'horizontal') {
              // Snap so dragPin.y === otherPos.y
              // dragPin.y depends on snappedY + offset from instance origin
              const pinOffsetY = dragPos.y - snappedY;
              const desiredY = otherPos.y - pinOffsetY;
              if (Math.abs(desiredY - snappedY) <= SNAP_THRESHOLD) {
                snappedY = desiredY;
                edgeGuides.push({ axis: 'y', value: otherPos.y });
              }
            } else if (axisSnap === 'vertical') {
              const pinOffsetX = dragPos.x - snappedX;
              const desiredX = otherPos.x - pinOffsetX;
              if (Math.abs(desiredX - snappedX) <= SNAP_THRESHOLD) {
                snappedX = desiredX;
                edgeGuides.push({ axis: 'x', value: otherPos.x });
              }
            }
          }
        }

        alignmentGuidesRef.current = [...guides, ...edgeGuides];

        onMoveInstance(
          dragRef.current.instanceId,
          snappedX,
          snappedY,
        );
      }
    },
    [screenToWorld, onSetPan, onMoveInstance, requestDraw, connectingFromPinRef, panRef, dragRef, labelDragRef, instanceLabelDragRef, hitTestEdge, hoveredEdgeId, computeSnapGuides, instances, edges, componentMap, onMoveConnectionLabel, onMoveInstanceLabel],
  );

  const handleMouseUp = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_e: React.MouseEvent<HTMLCanvasElement>) => {
      if (panRef.current) {
        panRef.current = null;
        setCursorMode('default');
        return;
      }

      // End instance label drag — persist if moved
      if (instanceLabelDragRef.current) {
        if (instanceLabelDragRef.current.moved) {
          onPersistInstanceLabelMove?.(instanceLabelDragRef.current.instanceId);
        }
        instanceLabelDragRef.current = null;
        setCursorMode('default');
        requestDraw();
        return;
      }

      // End connection label drag — persist final position
      if (labelDragRef.current) {
        const { instanceId, connId } = labelDragRef.current;
        // Re-read current offset from the store via the callback
        const inst = instances.find((i) => i.id === instanceId);
        if (inst) {
          const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
          const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
          const entry = connectionLabels[connId];
          if (entry) {
            onUpdateConnectionLabel?.(instanceId, connId, { offsetX: entry.offsetX, offsetY: entry.offsetY });
          }
        }
        labelDragRef.current = null;
        setCursorMode('default');
        requestDraw();
        return;
      }

      if (dragRef.current) {
        if (dragRef.current.moved) {
          onPersistInstanceMove(dragRef.current.instanceId);
        }
        dragRef.current = null;
        alignmentGuidesRef.current = [];
        setCursorMode('default');
        requestDraw();
      }
    },
    [onPersistInstanceMove, requestDraw, screenToWorld, instances, onUpdateConnectionLabel, onPersistInstanceLabelMove],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      // Check for connection label double click
      const hitConnectionLabel = hitTestConnectionLabel(world.x, world.y);
      if (hitConnectionLabel) {
        const inst = instances.find((i) => i.id === hitConnectionLabel.instanceId);
        if (inst) {
          const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
          const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
          const labelEntry = connectionLabels[hitConnectionLabel.connId];
          if (labelEntry) {
            setEditingConnectionLabel(hitConnectionLabel);
            setEditingConnectionLabelText(labelEntry.name || '');
          }
        }
        return;
      }

      // Check for instance label double click
      const hitId = hitTestInstanceLabel(world.x, world.y);
      if (hitId) {
        const inst = instances.find((i) => i.id === hitId);
        if (inst) {
          setEditingLabelId(hitId);
          setEditingLabelText(inst.label || '');
        }
      }
    },
    [screenToWorld, hitTestInstanceLabel, hitTestConnectionLabel, instances],
  );

  const handleEditConfirm = useCallback(() => {
    if (editingLabelId && editingLabelText.trim()) {
      onUpdateInstanceLabel?.(editingLabelId, editingLabelText.trim());
    }
    if (editingConnectionLabel && editingConnectionLabelText.trim()) {
      onUpdateConnectionLabel?.(editingConnectionLabel.instanceId, editingConnectionLabel.connId, {
        name: editingConnectionLabelText.trim()
      });
    }
    setEditingLabelId(null);
    setEditingLabelText('');
    setEditingConnectionLabel(null);
    setEditingConnectionLabelText('');
  }, [editingLabelId, editingLabelText, onUpdateInstanceLabel, editingConnectionLabel, editingConnectionLabelText, onUpdateConnectionLabel]);

  const handleEditCancel = useCallback(() => {
    setEditingLabelId(null);
    setEditingLabelText('');
    setEditingConnectionLabel(null);
    setEditingConnectionLabelText('');
  }, []);

  // Compute screen position for inline edit input
  const editInputStyle = (() => {
    if (!editingLabelId) return null;
    const inst = instances.find((i) => i.id === editingLabelId);
    if (!inst) return null;
    const comp = componentMap[inst.componentId];
    const nw = comp?.displayWidth ?? NODE_WIDTH;
    const nh = comp?.displayHeight ?? NODE_HEIGHT;
    const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);
    const thumbAreaH = nh;
    const cx = inst.positionX + nw / 2;
    const cy = inst.positionY + thumbAreaH / 2;

    const corners = (rotation !== 0 || flipH || flipV)
      ? [
          transformPoint(inst.positionX, inst.positionY, cx, cy, rotation, flipH, flipV),
          transformPoint(inst.positionX + nw, inst.positionY, cx, cy, rotation, flipH, flipV),
          transformPoint(inst.positionX, inst.positionY + thumbAreaH, cx, cy, rotation, flipH, flipV),
          transformPoint(inst.positionX + nw, inst.positionY + thumbAreaH, cx, cy, rotation, flipH, flipV),
        ]
      : null;
    const sBottom = corners ? Math.max(...corners.map(c => c.y)) : inst.positionY + thumbAreaH;
    const sCenterX = corners
      ? (Math.min(...corners.map(c => c.x)) + Math.max(...corners.map(c => c.x))) / 2
      : inst.positionX + nw / 2;

    const instData = (inst.instanceData as Record<string, unknown>) ?? {};
    const labelOffsetX = (instData.labelOffsetX as number) ?? 0;
    const labelOffsetY = (instData.labelOffsetY as number) ?? 0;

    // World position + offset → screen position
    const screenX = (sCenterX + labelOffsetX) * zoom + panX;
    const screenY = (sBottom + 2 + labelOffsetY) * zoom + panY;

    const rawColor = (comp?.shapeElements?.length ? getDominantShapeColor(comp.shapeElements) : null) ?? CATEGORY_COLORS[comp?.category || 'junctionPoint'];
    const dominantColor = /^#ffffff$/i.test(rawColor) || /^#fff$/i.test(rawColor) || /^white$/i.test(rawColor) ? '#000000' : rawColor;

    return {
      position: 'absolute' as const,
      left: `${screenX}px`,
      top: `${screenY}px`,
      transform: 'translate(-50%, 0)',
      fontSize: `${labelFontSize * zoom * 0.65}px`,
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: dominantColor,
      background: 'rgba(255,255,255,0.92)',
      border: `1.5px solid ${dominantColor}`,
      borderRadius: '4px',
      padding: '2px 8px',
      outline: 'none',
      textAlign: 'center' as const,
      width: `${Math.max(20, editingLabelText.length) + 1}ch`,
      zIndex: 10,
    };
  })();

  // Compute screen position for connection label edit input
  const connectionEditInputStyle = (() => {
    if (!editingConnectionLabel) return null;
    const { instanceId, connId } = editingConnectionLabel;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return null;
    const comp = componentMap[inst.componentId];
    if (!comp) return null;
    const matrix = componentConnections[inst.componentId];
    if (!matrix) return null;
    const conn = matrix.connections.find(c => c.id === connId);
    if (!conn) return null;

    const instanceData = (inst.instanceData as Record<string, unknown>) ?? {};
    const connectionLabels = (instanceData.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
    const entry = connectionLabels[connId];
    if (!entry) return null;

    const pins = comp.pins ?? [];
    const pinMap = Object.fromEntries(pins.map((p) => [p.id, p]));
    const pinA = pinMap[conn.pinAId];
    const pinB = pinMap[conn.pinBId];
    if (!pinA || !pinB) return null;

    const nw = comp.displayWidth ?? comp.width ?? NODE_WIDTH;
    const nh = comp.displayHeight ?? comp.height ?? NODE_HEIGHT;
    const shapesBounds = comp.shapeElements?.length ? computeShapesBounds(comp.shapeElements) : null;

    const posA = getTransformedPinPos(pinA, inst.positionX, inst.positionY, nw, nh, shapesBounds, instanceData);
    const posB = getTransformedPinPos(pinB, inst.positionX, inst.positionY, nw, nh, shapesBounds, instanceData);

    const midX = (posA.x + posB.x) / 2 + entry.offsetX;
    const midY = (posA.y + posB.y) / 2 + entry.offsetY;

    // World position → screen position
    const screenX = midX * zoom + panX;
    const screenY = midY * zoom + panY;

    return {
      position: 'absolute' as const,
      left: `${screenX}px`,
      top: `${screenY}px`,
      transform: 'translate(-50%, -50%)',
      fontSize: `${12 * zoom}px`,
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      color: '#475569',
      background: 'rgba(255,255,255,0.92)',
      border: '1.5px solid #94a3b8',
      borderRadius: '4px',
      padding: '2px 8px',
      outline: 'none',
      textAlign: 'center' as const,
      width: `${Math.max(10, editingConnectionLabelText.length) + 1}ch`,
      zIndex: 10,
    };
  })();

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * factor));

      // Zoom centered on mouse position
      const newPanX = mouseX - (mouseX - panX) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - panY) * (newZoom / zoom);

      onSetZoom(newZoom);
      onSetPan(newPanX, newPanY);
    },
    [zoom, panX, panY, onSetZoom, onSetPan],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // Cancel connection mode on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectingFromPinRef.current) {
        connectingFromPinRef.current = null;
        setCursorMode('default');
        requestDraw();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestDraw]);

  // ---------- Cursor ----------

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: cursorMode,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onAuxClick={handleAuxClick}
      />
      {editingLabelId && editInputStyle && (
        <input
          style={editInputStyle}
          value={editingLabelText}
          autoFocus
          onChange={(e) => setEditingLabelText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleEditConfirm();
            if (e.key === 'Escape') handleEditCancel();
          }}
          onBlur={handleEditConfirm}
        />
      )}
      {editingConnectionLabel && connectionEditInputStyle && (
        <input
          style={connectionEditInputStyle}
          value={editingConnectionLabelText}
          autoFocus
          onChange={(e) => setEditingConnectionLabelText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleEditConfirm();
            if (e.key === 'Escape') handleEditCancel();
          }}
          onBlur={handleEditConfirm}
        />
      )}
    </div>
  );
});

export default DiagramCanvasInner;
