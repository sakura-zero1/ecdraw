import { useCallback, useEffect, useRef, useState } from 'react';

// ---------- Types ----------

export type ViewMode = 'simplified' | 'complete' | 'geographic';

export interface TopologyInstance {
  id: string;
  diagramId: string;
  componentId: string;
  label: string;
  positionX: number;
  positionY: number;
  instanceData: Record<string, unknown>;
  component: { id: string; name: string; category: string };
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
const NODE_HEIGHT = 56;
const NODE_RADIUS = 8;
const GRID_SIZE = 40;

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
const LABEL_COLOR = '#ffffff';

// Outage overlay colors
const OUTAGE_REACHABLE_COLOR = '#22c55e';   // green
const OUTAGE_UNREACHABLE_COLOR = '#ef4444';  // red
const OUTAGE_DISCONNECT_COLOR = '#dc2626';    // darker red
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

    // Build position map
    const posMap = new Map<string, { x: number; y: number }>();
    for (const inst of visibleInstances) {
      posMap.set(inst.id, getInstancePosition(inst, displayW, displayH));
    }

    // ---- Edges ----
    for (const edge of visibleEdges) {
      const sourcePos = posMap.get(edge.sourceInstanceId);
      const targetPos = posMap.get(edge.targetInstanceId);
      if (!sourcePos || !targetPos) continue;

      const sx = sourcePos.x + NODE_WIDTH / 2;
      const sy = sourcePos.y + NODE_HEIGHT / 2;
      const tx = targetPos.x + NODE_WIDTH / 2;
      const ty = targetPos.y + NODE_HEIGHT / 2;

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

    // ---- Nodes ----
    const now = Date.now();
    for (const inst of visibleInstances) {
      const cat = inst.component?.category || 'junctionPoint';
      const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.junctionPoint;
      const pos = posMap.get(inst.id);
      if (!pos) continue;

      const x = pos.x;
      const y = pos.y;

      // Determine fill/stroke based on outage simulation
      let fillColor = color;
      let strokeColor = 'transparent';
      let strokeWidth = 0;
      let showHatch = false;

      if (outageResult) {
        if (outageResult.unreachableInstanceIds.includes(inst.id)) {
          fillColor = OUTAGE_UNREACHABLE_COLOR;
          fillColor = fillColor + '99'; // add transparency
        }
        if (outageResult.reachableInstanceIds.includes(inst.id)) {
          strokeColor = OUTAGE_REACHABLE_COLOR;
          strokeWidth = 3 / zoom;
        }
        if (outageResult.unreachableInstanceIds.includes(inst.id)) {
          strokeColor = OUTAGE_UNREACHABLE_COLOR;
          strokeWidth = 3 / zoom;
          showHatch = true;
        }
        // The disconnected instance itself
        if (highlightedInstanceId && inst.id === highlightedInstanceId) {
          strokeColor = OUTAGE_DISCONNECT_COLOR;
          strokeWidth = 4 / zoom;
        }
      }

      // Shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.12)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // Fill
      ctx.fillStyle = fillColor;
      roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
      ctx.fill();
      ctx.restore();

      // Outage border
      if (outageResult && strokeWidth > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
        ctx.stroke();
      }

      // Hatch pattern for unreachable
      if (showHatch) {
        ctx.save();
        roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2 / zoom;
        const step = 10 / zoom;
        for (let hx = x - NODE_HEIGHT; hx < x + NODE_WIDTH + NODE_HEIGHT; hx += step) {
          ctx.beginPath();
          ctx.moveTo(hx, y);
          ctx.lineTo(hx + NODE_HEIGHT, y + NODE_HEIGHT);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Highlighted instance (pulsing yellow border)
      if (highlightedInstanceId && inst.id === highlightedInstanceId) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 300);
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = (3 + pulse * 2) / zoom;
        ctx.globalAlpha = 0.7 + pulse * 0.3;
        roundRect(ctx, x - 3 / zoom, y - 3 / zoom, NODE_WIDTH + 6 / zoom, NODE_HEIGHT + 6 / zoom, NODE_RADIUS + 2 / zoom);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Selected instance border
      const isSelected = inst.id === selectedInstanceId;
      if (isSelected && !outageResult) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2.5 / zoom;
        roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `${13 / Math.max(zoom, 0.3)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const label = inst.label || inst.component?.name || '未知';
      const maxLabelWidth = NODE_WIDTH - 12;
      let displayLabel = label;
      if (ctx.measureText(displayLabel).width > maxLabelWidth) {
        while (displayLabel.length > 1 && ctx.measureText(displayLabel + '...').width > maxLabelWidth) {
          displayLabel = displayLabel.slice(0, -1);
        }
        displayLabel += '...';
      }
      ctx.fillText(displayLabel, x + NODE_WIDTH / 2, y + NODE_HEIGHT / 2);
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
        if (
          worldX >= pos.x &&
          worldX <= pos.x + NODE_WIDTH &&
          worldY >= pos.y &&
          worldY <= pos.y + NODE_HEIGHT
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
