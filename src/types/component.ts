export type ComponentCategory = string;

export interface CategoryInfo {
  id: string;
  name: string;
  label: string;
  color: string;
  builtIn: boolean;
  visible: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export type ShapeType = 'rect' | 'circle' | 'ellipse' | 'line' | 'path' | 'text';

export interface ShapeStateOverride {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  cx?: number;
  cy?: number;
  r?: number;
  ry?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface ShapeElement {
  id: string;
  groupId?: string;
  type: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  linkedConnectionId?: string;
  stateClosed?: ShapeStateOverride;
  stateOpen?: ShapeStateOverride;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  cx?: number;
  cy?: number;
  r?: number;
  ry?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  d?: string;
  // text shape properties
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: CanvasTextAlign;
}

export interface ElectricalComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  shapeElements: ShapeElement[];
  pins: Pin[];
  createdAt: string;
  updatedAt: string;
}

export interface Pin {
  id: string;
  label: string;
  number: number;
  position: Position;
  pinType: PinType;
  visible: boolean;
  groupId?: string;
}

export type PinType = 'input' | 'output' | 'bidirectional' | 'power' | 'ground';
