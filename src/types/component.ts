export type ComponentCategory =
  | 'powerPoint'
  | 'switchPoint'
  | 'junctionPoint'
  | 'loadPoint';

export interface Position {
  x: number;
  y: number;
}

export type ShapeType = 'rect' | 'circle' | 'ellipse' | 'line' | 'path';

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
}

export interface ElectricalComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  width: number;
  height: number;
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
}

export type PinType = 'input' | 'output' | 'bidirectional' | 'power' | 'ground';
