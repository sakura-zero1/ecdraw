import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pin, ShapeElement } from '../../types';
import {
  drawShapeOnCanvas,
  transformPoint,
  getInstanceTransform,
  computeShapesBounds,
  getTransformedPinPos,
  getDominantShapeColor,
} from '../../utils/canvasShape';

// ---------- Types ----------

export type ViewMode = 'simplified' | 'complete' | 'geographic';

interface ComponentSnapshot {
  shapeElements?: ShapeElement[];
  pins?: Pin[];
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
}

export interface TopologyInstance {
  id: string;
  diagramId: string;
  componentId: string;
  label: string;
  positionX: number;
  positionY: number;
  instanceData: Record<string, unknown>;
  component: { id: string; name: string; category: string; snapshot?: unknown };
  districtData: { id: string; transformerCapacity: number | null; supplyRange: string | null; supplyArea: string | null; householdCount: number | null } | null;
  gisData: { id: string; latitude: number | null; longitude: number | null } | null;
}

export interface TopologyEdge {
  id: string;
  diagramId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePinId: string;
  targetPinId: string;
  lineSegmentData: { id: string; length: number | null; wireModel: string | null; wireOwnership: string | null; wireType: string | null; isMainDisplay: boolean | null } | null;
}

export interface ViewerCanvasProps {
  instances: TopologyInstance[];
  edges: TopologyEdge[];
  viewMode: ViewMode;
  zoom: number;
  panX: number;
  panY: number;
  onSetZoom: (z: number) => void;
  onSetPan: (x: number, y: number) => void;
  selectedInstanceId: string | null;
  onSelectInstance: (id: string | null) => void;
  outageResult?: {
    reachableInstanceIds: string[];
    unreachableInstanceIds: string[];
  } | null;
  highlightedInstanceId?: string | null;
}

// ---------- Constants ----------

const NODE_WIDTH = 140;
const NODE_HEIGHT = 90;

const NODE_RADIUS = 8;
const GRID_SIZE = 40;

/** Resolve the node dimensions for an instance, falling back to defaults when component data is missing. */
function getInstanceSize(inst: TopologyInstance): { w: number; h: number } {
  const snap = inst.component?.snapshot as ComponentSnapshot | undefined;
  const w = Number(snap?.displayWidth) > 0 ? Number(snap?.displayWidth) : NODE_WIDTH;
  const h = Number(snap?.displayHeight) > 0 ? Number(snap?.displayHeight) : NODE_HEIGHT;
  return { w, h };
}

const CATEGORY_COLORS: Record<string, string> = {
  powerPoint: '#22c55e',
  switchPoint: '#3b82f6',
  junctionPoint: '#6b7280',
  loadPoint: '#f97316',
};

const EDGE_COLOR = '#94a3b8';
const BG_COLOR = '#f8fafc';
const GRID_COLOR = '#e2e8f0';
const GRID_COLOR_MAJOR = '#cbd5e1';

// Outage overlay colors
const OUTAGE_REACHABLE_COLOR = '#22c55e';   // green
const OUTAGE_UNREACHABLE_COLOR = '#ef4444';  // red
const HIGHLIGHT_COLOR = '#eab308';            // gold/yellow

// ---------- Helpers ----------

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

// ---------- Component ----------

export default function ViewerCanvas({
  instances,
  edges,
  viewMode,
  zoom,
  panX,
  panY,
  onSetZoom,
  onSetPan,
  selectedInstanceId,
  onSelectInstance,
  outageResult,
  highlightedInstanceId,
}: ViewerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    startScreenX: number;
    startScreenY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const animFrameRef = useRef<number>(0);
  const [isPanning, setIsPanning] = useState(false);

  // ---- Compute visible instances and edges based on viewMode ----

  const getVisibleData = useCallback(() => {
    if (viewMode === 'simplified') {
      const visibleIds = new Set<string>();
      const visibleInstances = instances.filter((inst) => {
        const cat = inst.component?.category;
        const show = cat === 'powerPoint' || cat === 'switchPoint';
        if (show) visibleIds.add(inst.id);
        return show;
      });
      const visibleEdges = edges.filter(
        (edge) => visibleIds.has(edge.sourceInstanceId) && visibleIds.has(edge.targetInstanceId),
      );
      return { visibleInstances, visibleEdges };
    }
    if (viewMode === 'geographic') {
      const visibleInstances = instances.filter(
        (inst) => inst.gisData && inst.gisData.latitude != null && inst.gisData.longitude != null,
      );
      // Show edges where both endpoints have gis data
      const visibleIds = new Set(visibleInstances.map((i) => i.id));
      const visibleEdges = edges.filter(
        (edge) => visibleIds.has(edge.sourceInstanceId) && visibleIds.has(edge.targetInstanceId),
      );
      return { visibleInstances, visibleEdges };
    }
    // complete
    return { visibleInstances: instances, visibleEdges: edges };
  }, [instances, edges, viewMode]);

  // ---- Compute instance positions (handles geographic mapping) ----

  const getInstancePosition = useCallback(
    (inst: TopologyInstance, canvasW: number, canvasH: number): { x: number; y: number } => {
      if (viewMode === 'geographic' && inst.gisData && inst.gisData.latitude != null && inst.gisData.longitude != null) {
        // Calculate bounds from all geographic instances
        const geoInstances = instances.filter(
          (i) => i.gisData && i.gisData.latitude != null && i.gisData.longitude != null,
        );
        if (geoInstances.length === 0) return { x: inst.positionX, y: inst.positionY };

        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        for (const gi of geoInstances) {
          const lat = gi.gisData!.latitude!;
          const lng = gi.gisData!.longitude!;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }

        const latRange = maxLat - minLat || 1;
        const lngRange = maxLng - minLng || 1;

        const x = ((inst.gisData.longitude! - minLng) / lngRange) * canvasW * 0.8 + canvasW * 0.1;
        const y = (1 - (inst.gisData.latitude! - minLat) / latRange) * canvasH * 0.8 + canvasH * 0.1;

        // Center the node
        return { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 };
      }
      return { x: inst.positionX, y: inst.positionY };
    },
    [instances, viewMode],
  );

  // ---- Screen <-> World helpers ----

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom,
    }),
    [panX, panY, zoom],
  );

  // ---- Draw ----

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;

    if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
      canvas.width = Math.round(displayW * dpr);
      canvas.height = Math.round(displayH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayW, displayH);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, displayW, displayH);

    const { visibleInstances, visibleEdges } = getVisibleData();

    // Geographic mode with no data
    if (viewMode === 'geographic' && visibleInstances.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '16px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无地理数据', displayW / 2, displayH / 2);
      return;
    }

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // ---- Grid (skip in geographic view) ----
    if (viewMode !== 'geographic') {
      const gridMajor = GRID_SIZE * 5;
      const worldLeft = -panX / zoom;
      const worldTop = -panY / zoom;
      const worldRight = (displayW - panX) / zoom;
      const worldBottom = (displayH - panY) / zoom;

      const gridStartX = Math.floor(worldLeft / GRID_SIZE) * GRID_SIZE;
      const gridStartY = Math.floor(worldTop / GRID_SIZE) * GRID_SIZE;

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
    }

    // Build position + size + instance map
    const posMap = new Map<string, { x: number; y: number }>();
    const sizeMap = new Map<string, { w: number; h: number }>();
    const instMap = new Map<string, TopologyInstance>();
    for (const inst of visibleInstances) {
      posMap.set(inst.id, getInstancePosition(inst, displayW, displayH));
      sizeMap.set(inst.id, getInstanceSize(inst));
      instMap.set(inst.id, inst);
    }

    // Compute endpoint of an edge at a given instance/pin. Falls back to the
    // shape-area center when pin metadata is missing.
    const computeEndpoint = (instanceId: string, pinId: string): { x: number; y: number } | null => {
      const inst = instMap.get(instanceId);
      const pos = posMap.get(instanceId);
      const size = sizeMap.get(instanceId);
      if (!inst || !pos || !size) return null;
      const snap = inst.component?.snapshot as ComponentSnapshot | undefined;
      const pins = Array.isArray(snap?.pins) ? (snap?.pins as Pin[]) : [];
      const pin = pins.find((p) => p.id === pinId);
      const shapesBounds = Array.isArray(snap?.shapeElements) && snap.shapeElements.length > 0
        ? computeShapesBounds(snap.shapeElements as ShapeElement[])
        : null;
      if (pin) {
        // Position the pin into world coords, then apply instance position offset
        // (getTransformedPinPos expects instance origin to be inst.positionX/Y, but
        // for geographic view pos may differ — we use pos.x/y as the origin)
        return getTransformedPinPos(pin, pos.x, pos.y, size.w, size.h, shapesBounds, inst.instanceData);
      }
      // Fallback: shape-area center
      const thumbAreaH = size.h;
      return { x: pos.x + size.w / 2, y: pos.y + thumbAreaH / 2 };
    };

    // ---- Edges ----
    for (const edge of visibleEdges) {
      const s = computeEndpoint(edge.sourceInstanceId, edge.sourcePinId);
      const t = computeEndpoint(edge.targetInstanceId, edge.targetPinId);
      if (!s || !t) continue;
      const sx = s.x, sy = s.y, tx = t.x, ty = t.y;

      const lineData = edge.lineSegmentData;
      let edgeColor = EDGE_COLOR;
      if (lineData?.wireOwnership === 'user') {
        edgeColor = 'rgb(85,48,217)';
      } else if (lineData?.wireOwnership === 'public') {
        edgeColor = '#000000';
      }

      const isCable = lineData?.wireType === 'cable';
      const isMainDisplay = lineData?.isMainDisplay ?? true;
      const edgeAlpha = isMainDisplay ? 1 : 0.5;

      ctx.save();
      ctx.globalAlpha = edgeAlpha;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 2 / zoom;
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

    // ---- Nodes (rendering aligned with DiagramCanvas for visual consistency) ----
    const now = Date.now();
    const THUMB_PAD = 4;
    for (const inst of visibleInstances) {
      const cat = inst.component?.category || 'junctionPoint';
      const fallbackColor = CATEGORY_COLORS[cat] || CATEGORY_COLORS.junctionPoint;
      const pos = posMap.get(inst.id);
      const size = sizeMap.get(inst.id);
      if (!pos || !size) continue;

      const x = pos.x;
      const y = pos.y;
      const nw = size.w;
      const nh = size.h;
      const thumbAreaH = nh;

      const snap = inst.component?.snapshot as ComponentSnapshot | undefined;
      const shapeElements = Array.isArray(snap?.shapeElements) ? snap.shapeElements : [];
      const hasShapes = shapeElements.length > 0;
      const { rotation, flipH, flipV } = getInstanceTransform(inst.instanceData);

      const isReachable = !!outageResult && outageResult.reachableInstanceIds.includes(inst.id);
      const isUnreachable = !!outageResult && outageResult.unreachableInstanceIds.includes(inst.id);
      const isDisconnectPoint = !!highlightedInstanceId && inst.id === highlightedInstanceId;
      const isSelected = inst.id === selectedInstanceId;

      // Shape-area center used as the rotation/flip pivot
      const cx = x + nw / 2;
      const cy = y + thumbAreaH / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      if (flipH) ctx.scale(-1, 1);
      if (flipV) ctx.scale(1, -1);
      ctx.translate(-cx, -cy);

      // ---- Shape thumbnail area ----
      if (hasShapes) {
        ctx.save();
        if (isUnreachable) ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.rect(x, y, nw, thumbAreaH);
        ctx.clip();

        const bounds = computeShapesBounds(shapeElements);
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          const availW = nw - THUMB_PAD * 2;
          const availH = thumbAreaH - THUMB_PAD * 2;
          const scale = Math.min(availW / bounds.width, availH / bounds.height);
          const offX = x + THUMB_PAD + (availW - bounds.width * scale) / 2;
          const offY = y + THUMB_PAD + (availH - bounds.height * scale) / 2;

          ctx.translate(offX, offY);
          ctx.scale(scale, scale);
          ctx.translate(-bounds.left, -bounds.top);

          for (const s of shapeElements) {
            drawShapeOnCanvas(ctx, s);
          }

          // Restore transform stack so subsequent border/etc draw correctly
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.translate(panX, panY);
          ctx.scale(zoom, zoom);
          // Re-apply the instance rotation/flip transform we were under
          ctx.translate(cx, cy);
          ctx.rotate((rotation * Math.PI) / 180);
          if (flipH) ctx.scale(-1, 1);
          if (flipV) ctx.scale(1, -1);
          ctx.translate(-cx, -cy);
        }
        ctx.restore();
      } else {
        // Fallback: solid rounded rectangle (legacy look for components missing shape data)
        ctx.save();
        let fillColor = fallbackColor;
        if (isUnreachable) fillColor = OUTAGE_UNREACHABLE_COLOR + '99';
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.fill();
        ctx.restore();
      }

      // ---- Outer border + selection highlight (inside transform, around shape area) ----
      ctx.strokeStyle = isSelected ? '#2563eb' : 'rgba(148,163,184,0.4)';
      ctx.lineWidth = isSelected ? 2.5 / zoom : 1 / zoom;
      ctx.beginPath();
      roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
      ctx.stroke();
      if (isSelected && !outageResult) {
        ctx.fillStyle = 'rgba(37,99,235,0.06)';
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.fill();
      }

      // ---- Outage borders & hatch ----
      if (isReachable) {
        ctx.strokeStyle = OUTAGE_REACHABLE_COLOR;
        ctx.lineWidth = 3 / zoom;
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.stroke();
      }
      if (isUnreachable) {
        ctx.strokeStyle = OUTAGE_UNREACHABLE_COLOR;
        ctx.lineWidth = 3 / zoom;
        ctx.beginPath();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.stroke();
        // Hatch
        ctx.save();
        roundRect(ctx, x, y, nw, thumbAreaH, NODE_RADIUS);
        ctx.clip();
        ctx.strokeStyle = 'rgba(239,68,68,0.35)';
        ctx.lineWidth = 2 / zoom;
        const step = 10 / zoom;
        for (let hx = x - thumbAreaH; hx < x + nw + thumbAreaH; hx += step) {
          ctx.beginPath();
          ctx.moveTo(hx, y);
          ctx.lineTo(hx + thumbAreaH, y + thumbAreaH);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (isDisconnectPoint) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 300);
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = (3 + pulse * 2) / zoom;
        ctx.globalAlpha = 0.7 + pulse * 0.3;
        ctx.beginPath();
        roundRect(ctx, x - 3 / zoom, y - 3 / zoom, nw + 6 / zoom, thumbAreaH + 6 / zoom, NODE_RADIUS + 2 / zoom);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.restore(); // end shape transform

      // ---- Label (always upright, below the transformed shape bounding box) ----
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

      const instData = (inst.instanceData as Record<string, unknown>) ?? {};
      const labelOffsetX = (instData.labelOffsetX as number) ?? 0;
      const labelOffsetY = (instData.labelOffsetY as number) ?? 0;

      // Label size + color mirror DiagramCanvas:
      // - size: user's labelFontSize (persisted in localStorage by the editor), default 20
      // - color: dominant fill/stroke color of the component's shapes, white→black
      const fontSize = Number(localStorage.getItem('ecdraw-label-font-size')) || 20;
      ctx.save();
      ctx.translate(shapeCenterX + labelOffsetX, labelTop + labelOffsetY);
      const rawColor = (hasShapes ? getDominantShapeColor(shapeElements) : null) ?? fallbackColor;
      const labelColor = /^#ffffff$/i.test(rawColor) || /^#fff$/i.test(rawColor) || /^white$/i.test(rawColor)
        ? '#000000'
        : rawColor;
      ctx.fillStyle = labelColor;
      ctx.font = `500 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(inst.label || inst.component?.name || '未知', 0, fontSize / 2);
      ctx.restore();
    }

    ctx.restore();
  }, [instances, edges, viewMode, zoom, panX, panY, selectedInstanceId, outageResult, highlightedInstanceId, getVisibleData, getInstancePosition]);

  // ---- Render loop ----

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw]);

  // Continuous animation for pulsing highlight
  useEffect(() => {
    if (!highlightedInstanceId) return;
    let running = true;
    const animate = () => {
      if (!running) return;
      requestDraw();
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [highlightedInstanceId, requestDraw]);

  // ---- Resize observer ----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      requestDraw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [requestDraw]);

  // ---- Hit test ----

  const hitTestInstance = useCallback(
    (worldX: number, worldY: number): string | null => {
      const { visibleInstances } = getVisibleData();
      const canvas = canvasRef.current;
      const displayW = canvas?.clientWidth || 800;
      const displayH = canvas?.clientHeight || 600;
      for (let i = visibleInstances.length - 1; i >= 0; i--) {
        const inst = visibleInstances[i];
        const pos = getInstancePosition(inst, displayW, displayH);
        const { w, h } = getInstanceSize(inst);
        const thumbAreaH = h;
        if (
          worldX >= pos.x &&
          worldX <= pos.x + w &&
          worldY >= pos.y &&
          worldY <= pos.y + thumbAreaH
        ) {
          return inst.id;
        }
      }
      return null;
    },
    [getVisibleData, getInstancePosition],
  );

  // ---- Mouse handlers ----

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      // Left-click on empty space starts pan
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        panRef.current = {
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: panX,
          startPanY: panY,
        };
        setIsPanning(true);
        return;
      }

      if (e.button !== 0) return;

      // Hit test node
      const hitId = hitTestInstance(world.x, world.y);
      if (hitId) {
        onSelectInstance(hitId);
        return;
      }

      // Click on empty space: start pan or deselect
      panRef.current = {
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      };
      setIsPanning(true);
      onSelectInstance(null);
    },
    [screenToWorld, panX, panY, hitTestInstance, onSelectInstance],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startScreenX;
        const dy = e.clientY - panRef.current.startScreenY;
        onSetPan(panRef.current.startPanX + dx, panRef.current.startPanY + dy);
      }
    },
    [onSetPan],
  );

  const handleMouseUp = useCallback(() => {
    panRef.current = null;
    setIsPanning(false);
  }, []);

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
          cursor: isPanning ? 'grabbing' : 'default',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
