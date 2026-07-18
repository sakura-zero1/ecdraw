// 组合元件生成器（元件编辑器「组合向导」的核心逻辑，纯函数）。
//
// 两级组合：
//  1. composeBayComponent   —— 设备 → 间隔：把断路器/刀闸/地刀/CT/电缆头等自上而下
//     纵向串联成一个「开关间隔」元件（引脚对齐、串联导通、开合动画随设备带入）。
//  2. composeCabinetComponent —— 间隔 → 柜体：把若干间隔横排挂在顶部母线下，
//     加外框与柜名，生成环网柜/高配室元件。对外引脚为各间隔底部端子。
//
// 约定：贯穿式设备（开关/CT 等）应有上下两个引脚；终端设备（PT 等）只画一个
// 上引脚，串联链在它处终止。设备编号（#160/#16 等）不在此生成——由图纸编辑器
// 的实例级连接标签（connectionLabels）按各图纸单独命名。

import { v4 as uuid } from 'uuid';
import type { Connection, ConnectivityMatrix, ElectricalComponent, Pin, ShapeElement } from '../types';
import { getGroupBounds, scaleShapeInGroup } from './alignment';
import type { Bounds } from './alignment';

export interface ComposeSource {
  comp: ElectricalComponent;
  matrix: ConnectivityMatrix;
}

export interface ComposeResult {
  component: ElectricalComponent;
  matrix: ConnectivityMatrix;
}

// —— 布局常量（元件画布坐标）——
const BAY_WIDTH = 240;    // 设备/间隔统一宽度（等比缩放基准）
const CHAIN_GAP = 36;     // 串联设备之间的连接段长度
const SIDE_MARGIN = 140;  // 间隔元件左右留白
const TOP_MARGIN = 80;
const BOTTOM_MARGIN = 80;

// 柜体布局
const CAB_BAY_GAP = 56;      // 间隔水平间距
const CAB_TITLE_FONT = 44;   // 柜名字号
const CAB_BUSBAR_H = 12;     // 母线厚度（粗横条）
const CAB_DROP = 56;         // 母线底到间隔顶引脚的下垂长度
const CAB_INNER_PAD = 88;    // 柜体内容到画布左右边缘

const INK = '#0f172a';

function makeBounds(left: number, top: number, width: number, height: number): Bounds {
  return {
    left, top, right: left + width, bottom: top + height,
    width, height, cx: left + width / 2, cy: top + height / 2,
  };
}

/** scaleShapeInGroup 不处理 path：按与 importSubComponent 相同的约定（奇数位 x / 偶数位 y）缩放平移 d */
function scalePathD(d: string, orig: Bounds, dest: Bounds): string {
  const scaleX = dest.width / (orig.width || 1);
  const scaleY = dest.height / (orig.height || 1);
  let idx = 0;
  return d.replace(/[+-]?\d*\.?\d+/g, (m) => {
    const v = parseFloat(m);
    if (isNaN(v)) return m;
    idx += 1;
    const isY = idx % 2 === 0;
    return isY
      ? String(Math.round(dest.top + (v - orig.top) * scaleY))
      : String(Math.round(dest.left + (v - orig.left) * scaleX));
  });
}

function pinsBounds(pins: Pin[]): Bounds | null {
  if (pins.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pins) {
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x);
    maxY = Math.max(maxY, p.position.y);
  }
  return makeBounds(minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
}

interface MaterializedPart {
  shapes: ShapeElement[];
  pins: Pin[];
  connections: Connection[];
  /** 组件坐标系中最靠上的引脚（新对象引用，可原地改 visible） */
  topPin: Pin | null;
  /** 最靠下的引脚；单引脚设备返回 null（终端设备，链在此终止） */
  bottomPin: Pin | null;
}

/** 把一个源元件（图形+引脚+连接矩阵+开合动画）缩放平移到 dest 区域，全部重新分配 ID */
function materializeSource(targetId: string, src: ComposeSource, dest: Bounds): MaterializedPart {
  const groupId = uuid();
  const orig = getGroupBounds(src.comp.shapeElements) ?? pinsBounds(src.comp.pins) ?? makeBounds(0, 0, 1, 1);
  const scaleX = dest.width / (orig.width || 1);
  const scaleY = dest.height / (orig.height || 1);

  const pinIdMap: Record<string, string> = {};
  const pins: Pin[] = src.comp.pins.map((p) => {
    const id = uuid();
    pinIdMap[p.id] = id;
    return {
      ...p,
      id,
      groupId,
      position: {
        x: Math.round(dest.left + (p.position.x - orig.left) * scaleX),
        y: Math.round(dest.top + (p.position.y - orig.top) * scaleY),
      },
    };
  });

  const connectionIdMap: Record<string, string> = {};
  const connections: Connection[] = src.matrix.connections
    .map((c) => {
      const pinAId = pinIdMap[c.pinAId];
      const pinBId = pinIdMap[c.pinBId];
      if (!pinAId || !pinBId) return null;
      const id = uuid();
      connectionIdMap[c.id] = id;
      return { ...c, id, componentId: targetId, pinAId, pinBId, visible: c.visible ?? true };
    })
    .filter((c): c is Connection => c !== null);

  const shapes: ShapeElement[] = src.comp.shapeElements.map((s) => {
    const updates = scaleShapeInGroup(s, orig, dest);
    const out: ShapeElement = {
      ...s,
      ...updates,
      id: uuid(),
      groupId,
      linkedConnectionId: s.linkedConnectionId ? connectionIdMap[s.linkedConnectionId] : undefined,
    };
    if (out.type === 'path' && out.d) out.d = scalePathD(out.d, orig, dest);
    return out;
  });

  const sorted = [...pins].sort((a, b) => a.position.y - b.position.y);
  return {
    shapes,
    pins,
    connections,
    topPin: sorted[0] ?? null,
    bottomPin: sorted.length >= 2 ? sorted[sorted.length - 1] : null,
  };
}

/** 设备之间/母线到间隔的连接导线段 */
function jointLine(x1: number, y1: number, x2: number, y2: number): ShapeElement {
  return {
    id: uuid(), type: 'line',
    fill: 'transparent', stroke: INK, strokeWidth: 3, opacity: 1,
    x1, y1, x2, y2,
  };
}

/** 固定导通的电气连接（不可分合，不显示动画路径） */
function jointConnection(targetId: string, pinAId: string, pinBId: string): Connection {
  return {
    id: uuid(), componentId: targetId, pinAId, pinBId,
    state: 'closed', pathSvg: '', animationDuration: 500, visible: false,
  };
}

function renumberPins(pins: Pin[]) {
  pins.forEach((p, i) => { p.number = i + 1; });
}

/** 按内容宽度归一到 BAY_WIDTH 的等比高度 */
function scaledHeight(src: ComposeSource): number {
  const b = getGroupBounds(src.comp.shapeElements) ?? pinsBounds(src.comp.pins);
  const w = b?.width || BAY_WIDTH;
  const h = b?.height || BAY_WIDTH;
  return Math.max(24, Math.round(h * (BAY_WIDTH / w)));
}

/** 设备 → 间隔：纵向串联 */
export function composeBayComponent(opts: {
  targetId: string;
  name: string;
  category: string;
  devices: ComposeSource[];
}): ComposeResult {
  const { targetId, name, category, devices } = opts;

  const shapes: ShapeElement[] = [];
  const pins: Pin[] = [];
  const connections: Connection[] = [];

  let cursorY = TOP_MARGIN;
  let firstTop: Pin | null = null;
  let prevBottom: Pin | null = null;

  for (const src of devices) {
    const destH = scaledHeight(src);
    const part = materializeSource(targetId, src, makeBounds(SIDE_MARGIN, cursorY, BAY_WIDTH, destH));
    shapes.push(...part.shapes);
    pins.push(...part.pins);
    connections.push(...part.connections);

    if (!firstTop && part.topPin) firstTop = part.topPin;
    if (prevBottom && part.topPin) {
      shapes.push(jointLine(
        prevBottom.position.x, prevBottom.position.y,
        part.topPin.position.x, part.topPin.position.y,
      ));
      connections.push(jointConnection(targetId, prevBottom.id, part.topPin.id));
    }
    prevBottom = part.bottomPin; // 单引脚终端设备 → null，链在此终止
    cursorY += destH + CHAIN_GAP;
  }
  const contentBottom = cursorY - CHAIN_GAP;

  // 仅链首顶引脚与链尾底引脚对外，其余全部隐藏
  for (const p of pins) {
    p.visible = (firstTop != null && p.id === firstTop.id) || (prevBottom != null && p.id === prevBottom.id);
  }
  renumberPins(pins);

  const width = BAY_WIDTH + SIDE_MARGIN * 2;
  const height = contentBottom + BOTTOM_MARGIN;
  const displayHeight = 200;
  const displayWidth = Math.max(24, Math.round((width / height) * displayHeight));

  const now = new Date().toISOString();
  return {
    component: {
      id: targetId, name, category, description: '由间隔组合向导生成',
      width, height, displayWidth, displayHeight,
      shapeElements: shapes, pins,
      createdAt: now, updatedAt: now,
    },
    matrix: { componentId: targetId, connections },
  };
}

/** 间隔 → 柜体：横排挂母线 + 外框 + 柜名 */
export function composeCabinetComponent(opts: {
  targetId: string;
  name: string;
  category: string;
  bays: ComposeSource[];
}): ComposeResult {
  const { targetId, name, category, bays } = opts;
  const n = bays.length;

  const contentW = n * BAY_WIDTH + (n - 1) * CAB_BAY_GAP;
  const innerLeft = CAB_INNER_PAD;
  const totalW = contentW + CAB_INNER_PAD * 2;

  const titleY = 44;
  const busbarY = titleY + CAB_TITLE_FONT + 28;
  const bayTop = busbarY + CAB_BUSBAR_H + CAB_DROP;

  const shapes: ShapeElement[] = [];
  const pins: Pin[] = [];
  const connections: Connection[] = [];

  // 母线（粗横条）+ 隐藏母线引脚
  shapes.push({
    id: uuid(), type: 'rect',
    fill: INK, stroke: INK, strokeWidth: 1, opacity: 1,
    x: innerLeft - 24, y: busbarY, width: contentW + 48, height: CAB_BUSBAR_H,
  });
  const busPin: Pin = {
    id: uuid(), label: '母线', number: 0,
    position: { x: Math.round(innerLeft + contentW / 2), y: Math.round(busbarY + CAB_BUSBAR_H / 2) },
    pinType: 'bidirectional', visible: false,
  };
  pins.push(busPin);

  let maxBayBottom = bayTop;
  bays.forEach((src, i) => {
    const destH = scaledHeight(src);
    const left = innerLeft + i * (BAY_WIDTH + CAB_BAY_GAP);
    const part = materializeSource(targetId, src, makeBounds(left, bayTop, BAY_WIDTH, destH));
    shapes.push(...part.shapes);
    pins.push(...part.pins);
    connections.push(...part.connections);

    // 间隔仅底部端子对外
    for (const p of part.pins) {
      p.visible = part.bottomPin != null && p.id === part.bottomPin.id;
    }
    // 母线下垂导线 + 电气连接
    if (part.topPin) {
      shapes.push(jointLine(
        part.topPin.position.x, busbarY + CAB_BUSBAR_H,
        part.topPin.position.x, part.topPin.position.y,
      ));
      connections.push(jointConnection(targetId, busPin.id, part.topPin.id));
    }
    maxBayBottom = Math.max(maxBayBottom, bayTop + destH);
  });

  // 外框 + 柜名（顶部居中）
  const boxBottom = maxBayBottom + 56;
  shapes.push({
    id: uuid(), type: 'rect',
    fill: 'transparent', stroke: INK, strokeWidth: 2, opacity: 1,
    x: 20, y: 16, width: totalW - 40, height: boxBottom - 16,
  });
  shapes.push({
    id: uuid(), type: 'text',
    fill: INK, stroke: 'transparent', strokeWidth: 0, opacity: 1,
    text: name, fontSize: CAB_TITLE_FONT, textAlign: 'center',
    x: Math.round(totalW / 2), y: titleY,
  });

  renumberPins(pins);

  const width = totalW;
  const height = boxBottom + 32;
  const displayWidth = Math.min(480, Math.max(80, n * 56));
  const displayHeight = Math.max(40, Math.round(displayWidth * (height / width)));

  const now = new Date().toISOString();
  return {
    component: {
      id: targetId, name, category, description: '由柜体组合向导生成',
      width, height, displayWidth, displayHeight,
      shapeElements: shapes, pins,
      createdAt: now, updatedAt: now,
    },
    matrix: { componentId: targetId, connections },
  };
}
