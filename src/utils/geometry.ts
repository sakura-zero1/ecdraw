import type { Position } from '../types';

export function computeLinePath(from: Position, to: Position): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

export function computeOrthogonalPath(from: Position, to: Position): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function midpoint(a: Position, b: Position): Position {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---- Edge crossing bridge utilities ----

/** Detect intersection of two line segments. Returns point or null. */
export function segIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): { x: number; y: number } | null {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
    return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
  }
  return null;
}

/**
 * Sample a cubic bezier into polyline segments for intersection detection.
 * Returns array of segment pairs [[[x1,y1],[x2,y2]], ...].
 */
export function sampleBezierToSegments(
  sx: number, sy: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  tx: number, ty: number,
  n: number = 12,
): [number, number][][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const t2 = 1 - t;
    const x = t2 * t2 * t2 * sx + 3 * t2 * t2 * t * cp1x + 3 * t2 * t * t * cp2x + t * t * t * tx;
    const y = t2 * t2 * t2 * sy + 3 * t2 * t2 * t * cp1y + 3 * t2 * t * t * cp2y + t * t * t * ty;
    pts.push([x, y]);
  }
  const segs: [number, number][][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push([pts[i], pts[i + 1]]);
  }
  return segs;
}

export interface CrossingInfo {
  x: number;
  y: number;
  segIdx: number; // which segment of the "over" edge this crossing is on
  dirX: number;   // direction of the "over" edge segment at crossing
  dirY: number;
}

/**
 * Compute all pairwise crossings between edges.
 * Returns a Map: overEdgeIdx → CrossingInfo[].
 * Rule: edge with higher index is the "over" edge.
 */
export function computeEdgeCrossings(
  edgeSegments: [number, number][][][],  // edgeSegments[edgeIdx] = list of segments
): Map<number, CrossingInfo[]> {
  const crossings = new Map<number, CrossingInfo[]>();
  const n = edgeSegments.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const segsI = edgeSegments[i];
      const segsJ = edgeSegments[j];
      for (let si = 0; si < segsI.length; si++) {
        for (let sj = 0; sj < segsJ.length; sj++) {
          const pt = segIntersect(
            segsI[si][0][0], segsI[si][0][1], segsI[si][1][0], segsI[si][1][1],
            segsJ[sj][0][0], segsJ[sj][0][1], segsJ[sj][1][0], segsJ[sj][1][1],
          );
          if (pt) {
            // Edge j is "over" (higher index)
            // Record for edge j, segment sj
            const dx = segsJ[sj][1][0] - segsJ[sj][0][0];
            const dy = segsJ[sj][1][1] - segsJ[sj][0][1];
            const len = Math.sqrt(dx * dx + dy * dy);
            const dirX = len > 0.001 ? dx / len : 1;
            const dirY = len > 0.001 ? dy / len : 0;
            let list = crossings.get(j);
            if (!list) { list = []; crossings.set(j, list); }
            list.push({ x: pt.x, y: pt.y, segIdx: sj, dirX, dirY });
            // Also record for edge i (it's "under", no bridge needed)
            // But we need to ensure edge i draws normally, so no action needed
          }
        }
      }
    }
  }
  return crossings;
}

/**
 * Draw a polyline path (array of points) with bridge arcs at specified crossing points.
 * The caller must have done ctx.beginPath() / ctx.moveTo(firstPoint).
 * This function draws lineTo + bridge arcs for each segment.
 *
 * @param ctx - canvas context
 * @param pts - polyline points [[x,y], ...]
 * @param segCrossings - crossings grouped by segment index: Map<segIdx, CrossingInfo[]>
 * @param bridgeR - bridge radius in world coordinates
 */
export function drawPathWithBridges(
  ctx: CanvasRenderingContext2D,
  pts: number[][],
  segCrossings: Map<number, CrossingInfo[]>,
  bridgeR: number,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i][0], y1 = pts[i][1];
    const x2 = pts[i + 1][0], y2 = pts[i + 1][1];
    const crs = segCrossings.get(i);
    if (!crs || crs.length === 0) {
      ctx.lineTo(x2, y2);
      continue;
    }
    // Sort crossings by distance from segment start
    const dx = x2 - x1, dy = y2 - y1;
    const sorted = [...crs].sort((a, b) => {
      const da = (a.x - x1) * dx + (a.y - y1) * dy;
      const db = (b.x - x1) * dx + (b.y - y1) * dy;
      return da - db;
    });
    for (const c of sorted) {
      // Perpendicular direction for the bump
      const normX = -c.dirY, normY = c.dirX;
      // Points before/after bridge
      const befX = c.x - c.dirX * bridgeR;
      const befY = c.y - c.dirY * bridgeR;
      const aftX = c.x + c.dirX * bridgeR;
      const aftY = c.y + c.dirY * bridgeR;
      // Control point for arc (perpendicular offset)
      const cpX = c.x + normX * bridgeR;
      const cpY = c.y + normY * bridgeR;

      ctx.lineTo(befX, befY);
      ctx.quadraticCurveTo(cpX, cpY, aftX, aftY);
    }
    ctx.lineTo(x2, y2);
  }
}
