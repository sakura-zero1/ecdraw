import { useCallback, useEffect, useRef } from 'react';
import type { DiagramInstance, DiagramEdge } from '../../services/diagramApi';
import { CATEGORY_LABELS } from '../../constants/categories';
import type { ComponentCategory } from '../../types';

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
const EDGE_SELECTED_COLOR = '#3b82f6';
const SELECTION_BORDER_COLOR = '#2563eb';
const GRID_COLOR = '#e2e8f0';
const GRID_COLOR_MAJOR = '#cbd5e1';
const LABEL_COLOR = '#ffffff';
const BG_COLOR = '#f8fafc';

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

// ---------- Props ----------

export interface DiagramCanvasProps {
  instances: DiagramInstance[];
  edges: DiagramEdge[];
  componentMap: Record<string, { name: string; category: string }>;
  selectedInstanceId: string | null;
  selectedEdgeId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  onSelectInstance: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveInstance: (id: string, x: number, y: number) => void;
  onPersistInstanceMove: (id: string) => void;
  onSetZoom: (z: number) => void;
  onSetPan: (x: number, y: number) => void;
}

// ---------- Component ----------

export default function DiagramCanvas({
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
  onMoveInstance,
  onPersistInstanceMove,
  onSetZoom,
  onSetPan,
}: DiagramCanvasProps) {
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

    // ---- Edges ----
    for (const edge of edges) {
      const source = instances.find((i) => i.id === edge.sourceInstanceId);
      const target = instances.find((i) => i.id === edge.targetInstanceId);
      if (!source || !target) continue;

      const sx = source.positionX + NODE_WIDTH / 2;
      const sy = source.positionY + NODE_HEIGHT / 2;
      const tx = target.positionX + NODE_WIDTH / 2;
      const ty = target.positionY + NODE_HEIGHT / 2;

      const isSelected = edge.id === selectedEdgeId;
      ctx.strokeStyle = isSelected ? EDGE_SELECTED_COLOR : EDGE_COLOR;
      ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    // ---- Nodes ----
    for (const inst of instances) {
      const comp = componentMap[inst.componentId];
      const cat: ComponentCategory = (comp?.category as ComponentCategory) || 'junctionPoint';
      const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS.junctionPoint;
      const isSelected = inst.id === selectedInstanceId;

      const x = inst.positionX;
      const y = inst.positionY;

      // Shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.12)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // Fill
      ctx.fillStyle = color;
      roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
      ctx.fill();
      ctx.restore();

      // Selection border
      if (isSelected) {
        ctx.strokeStyle = SELECTION_BORDER_COLOR;
        ctx.lineWidth = 2.5 / zoom;
        roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `${13 / Math.max(zoom, 0.3)}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const label = inst.label || comp?.name || (CATEGORY_LABELS[cat] || '未知');
      // Truncate label if too long
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
  }, [instances, edges, componentMap, selectedInstanceId, selectedEdgeId, zoom, panX, panY]);

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
        if (
          worldX >= inst.positionX &&
          worldX <= inst.positionX + NODE_WIDTH &&
          worldY >= inst.positionY &&
          worldY <= inst.positionY + NODE_HEIGHT
        ) {
          return inst.id;
        }
      }
      return null;
    },
    [instances],
  );

  const hitTestEdge = useCallback(
    (worldX: number, worldY: number): string | null => {
      const threshold = 8 / zoom;
      for (const edge of edges) {
        const source = instances.find((i) => i.id === edge.sourceInstanceId);
        const target = instances.find((i) => i.id === edge.targetInstanceId);
        if (!source || !target) continue;

        const sx = source.positionX + NODE_WIDTH / 2;
        const sy = source.positionY + NODE_HEIGHT / 2;
        const tx = target.positionX + NODE_WIDTH / 2;
        const ty = target.positionY + NODE_HEIGHT / 2;

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
    [edges, instances, zoom],
  );

  // ---------- Mouse handlers ----------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY);

      // Right-click or Ctrl+left-click => pan
      if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        panRef.current = {
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: panX,
          startPanY: panY,
        };
        return;
      }

      if (e.button !== 0) return;

      // Hit test node first
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
    [screenToWorld, panX, panY, hitTestInstance, hitTestEdge, instances, onSelectInstance, onSelectEdge],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Panning
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startScreenX;
        const dy = e.clientY - panRef.current.startScreenY;
        onSetPan(panRef.current.startPanX + dx, panRef.current.startPanY + dy);
        return;
      }

      // Dragging node
      if (dragRef.current) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const world = screenToWorld(screenX, screenY);

        const dx = world.x - dragRef.current.startWorldX;
        const dy = world.y - dragRef.current.startWorldY;

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragRef.current.moved = true;
        }

        onMoveInstance(
          dragRef.current.instanceId,
          dragRef.current.startInstX + dx,
          dragRef.current.startInstY + dy,
        );
      }
    },
    [screenToWorld, onSetPan, onMoveInstance],
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>) => {
      if (panRef.current) {
        panRef.current = null;
        return;
      }

      if (dragRef.current) {
        if (dragRef.current.moved) {
          onPersistInstanceMove(dragRef.current.instanceId);
        }
        dragRef.current = null;
      }
    },
    [onPersistInstanceMove],
  );

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

  // ---------- Cursor ----------

  const getCursor = useCallback(() => {
    if (panRef.current) return 'grabbing';
    if (dragRef.current) return 'grabbing';
    return 'default';
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
          cursor: getCursor(),
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
