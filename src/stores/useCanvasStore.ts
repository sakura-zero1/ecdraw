import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ToolMode, Viewport, ShapeElement, Pin } from '../types';

interface CanvasStore {
  viewport: Viewport;
  activeTool: ToolMode;
  selectedPinId: string | null;
  selectedPinIds: string[];
  selectedConnectionId: string | null;
  selectedShapeIds: string[];
  flashedShapeIds: string[];
  flashNonce: number;
  hoveredShapeIds: string[];
  groupEditingGroupId: string | null;

  // Clipboard
  clipboard: { shapes: ShapeElement[]; pins: Pin[] };

  // Drawing defaults
  defaultFill: string;
  defaultStroke: string;
  defaultStrokeWidth: number;

  setViewport: (viewport: Partial<Viewport>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  setActiveTool: (tool: ToolMode) => void;
  selectPin: (id: string | null, multi?: boolean) => void;
  selectConnection: (id: string | null) => void;
  selectShape: (id: string | null, multi?: boolean) => void;
  selectMany: (shapeIds: string[], pinIds: string[]) => void;
  clearSelection: () => void;
  setClipboard: (clip: { shapes: ShapeElement[]; pins: Pin[] }) => void;
  setDefaultFill: (color: string) => void;
  setDefaultStroke: (color: string) => void;
  setDefaultStrokeWidth: (w: number) => void;
  flashShapes: (shapeIds: string[], durationMs?: number) => void;
  setHoveredShapes: (ids: string[]) => void;
  clearHoveredShapes: () => void;
  enterGroupEditing: (groupId: string) => void;
  exitGroupEditing: () => void;
}

/** Convenience: get first selected shape id */
export function getSelectedShapeId(state: { selectedShapeIds: string[] }): string | null {
  return state.selectedShapeIds[0] ?? null;
}

const DEFAULT_VIEWPORT: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 };

export const useCanvasStore = create<CanvasStore>()(
  immer((set) => ({
    viewport: { ...DEFAULT_VIEWPORT },
    activeTool: 'select' as ToolMode,
    selectedPinId: null,
    selectedPinIds: [],
    selectedConnectionId: null,
    selectedShapeIds: [],
    flashedShapeIds: [],
    flashNonce: 0,
    hoveredShapeIds: [],
    groupEditingGroupId: null,
    clipboard: { shapes: [], pins: [] },
    defaultFill: 'transparent',
    defaultStroke: '#000000',
    defaultStrokeWidth: 5,

    setViewport: (vp) => {
      set((state) => {
        Object.assign(state.viewport, vp);
      });
    },

    zoomIn: () => {
      set((state) => {
        state.viewport.zoom = Math.min(state.viewport.zoom * 1.2, 5);
      });
    },

    zoomOut: () => {
      set((state) => {
        state.viewport.zoom = Math.max(state.viewport.zoom / 1.2, 0.1);
      });
    },

    resetView: () => {
      set((state) => {
        state.viewport = { ...DEFAULT_VIEWPORT };
      });
    },

    setActiveTool: (tool) => {
      set((state) => {
        state.activeTool = tool;
        state.selectedShapeIds = [];
        state.selectedPinIds = [];
        state.selectedPinId = null;
        state.groupEditingGroupId = null;
      });
    },

    selectPin: (id, multi = false) => {
      set((state) => {
        if (!multi) state.selectedShapeIds = [];
        if (id === null) {
          state.selectedPinIds = [];
          state.selectedPinId = null;
          return;
        }
        if (multi) {
          const idx = state.selectedPinIds.indexOf(id);
          if (idx >= 0) {
            state.selectedPinIds.splice(idx, 1);
          } else {
            state.selectedPinIds.push(id);
          }
          state.selectedPinId = state.selectedPinIds[0] ?? null;
        } else {
          state.selectedPinIds = [id];
          state.selectedPinId = id;
        }
      });
    },

    selectConnection: (id) => {
      set((state) => {
        state.selectedConnectionId = id;
      });
    },

    selectShape: (id, multi = false) => {
      set((state) => {
        if (!multi) { state.selectedPinIds = []; state.selectedPinId = null; }
        if (id === null) {
          state.selectedShapeIds = [];
        } else if (multi) {
          const idx = state.selectedShapeIds.indexOf(id);
          if (idx >= 0) {
            state.selectedShapeIds.splice(idx, 1);
          } else {
            state.selectedShapeIds.push(id);
          }
        } else {
          state.selectedShapeIds = [id];
        }
      });
    },

    selectMany: (shapeIds, pinIds) => {
      set((state) => {
        state.selectedShapeIds = [...shapeIds];
        state.selectedPinIds = [...pinIds];
        state.selectedPinId = pinIds[0] ?? null;
        state.groupEditingGroupId = null;
      });
    },

    clearSelection: () => {
      set((state) => {
        state.selectedShapeIds = [];
        state.selectedPinIds = [];
        state.selectedPinId = null;
        state.groupEditingGroupId = null;
      });
    },

    setClipboard: (clip) => {
      set((state) => {
        state.clipboard = clip;
      });
    },

    setDefaultFill: (color) => {
      set((state) => {
        state.defaultFill = color;
      });
    },

    setDefaultStroke: (color) => {
      set((state) => {
        state.defaultStroke = color;
      });
    },

    setDefaultStrokeWidth: (w) => {
      set((state) => {
        state.defaultStrokeWidth = w;
      });
    },

    flashShapes: (shapeIds, durationMs = 900) => {
      const ids = Array.from(new Set(shapeIds));
      if (ids.length === 0) return;
      const nextNonce = Date.now();
      set((state) => {
        state.flashedShapeIds = ids;
        state.flashNonce = nextNonce;
      });
      window.setTimeout(() => {
        set((state) => {
          if (state.flashNonce === nextNonce) {
            state.flashedShapeIds = [];
          }
        });
      }, durationMs);
    },

    setHoveredShapes: (ids) => {
      set((state) => {
        state.hoveredShapeIds = ids;
      });
    },

    clearHoveredShapes: () => {
      set((state) => {
        state.hoveredShapeIds = [];
      });
    },

    enterGroupEditing: (groupId) => {
      set((state) => {
        state.groupEditingGroupId = groupId;
        state.selectedShapeIds = [];
      });
    },

    exitGroupEditing: () => {
      set((state) => {
        state.groupEditingGroupId = null;
        state.selectedShapeIds = [];
      });
    },
  }))
);


