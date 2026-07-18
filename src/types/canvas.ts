export type ToolMode = 'select' | 'pan' | 'add-pin' | 'wire' | 'draw-rect' | 'draw-circle' | 'draw-ellipse' | 'draw-line' | 'draw-text' | 'draw-triangle' | 'draw-polygon';

export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface ProjectFile {
  version: string;
  name: string;
  components: import('./component').ElectricalComponent[];
  matrices: import('./connection').ConnectivityMatrix[];
  viewport: Viewport;
  savedAt: string;
}
