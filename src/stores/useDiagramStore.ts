import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createDiagramInstance,
  updateDiagramInstance,
  deleteDiagramInstance,
  createDiagramEdge,
  deleteDiagramEdge,
  fetchDiagramForEditor,
  type DiagramInstance,
  type DiagramEdge,
  type DiagramListItem,
} from '../services/diagramApi';
import { fetchComponentLibrary } from '../services/componentApi';
import type { Pin } from '../types';

const MAX_UNDO = 50;

export interface ComponentMeta {
  name: string;
  category: string;
  pins?: Pin[];
}

interface Snapshot {
  instances: DiagramInstance[];
  edges: DiagramEdge[];
}

interface DiagramEditorState {
  // Current diagram
  diagramId: string | null;
  diagramInfo: DiagramListItem | null;
  instances: DiagramInstance[];
  edges: DiagramEdge[];
  componentMap: Record<string, ComponentMeta>;
  loading: boolean;
  error: string;

  // Selection
  selectedInstanceId: string | null;
  selectedEdgeId: string | null;

  // Canvas viewport
  zoom: number;
  panX: number;
  panY: number;

  // Undo
  undoStack: string[];

  // Actions
  loadDiagram: (diagramId: string) => Promise<void>;
  addInstance: (componentId: string, label: string, x: number, y: number) => Promise<void>;
  moveInstance: (id: string, x: number, y: number) => void;
  persistInstanceMove: (id: string) => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  addEdge: (
    sourceInstanceId: string,
    targetInstanceId: string,
    sourcePinId: string,
    targetPinId: string,
  ) => Promise<void>;
  removeEdge: (id: string) => Promise<void>;
  selectInstance: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  pushUndo: () => void;
  undo: () => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  clearDiagram: () => void;
  updateInstanceLabel: (id: string, label: string) => Promise<void>;
}

export const useDiagramStore = create<DiagramEditorState>()(
  immer((set, get) => ({
    diagramId: null,
    diagramInfo: null,
    instances: [],
    edges: [],
    componentMap: {},
    loading: false,
    error: '',
    selectedInstanceId: null,
    selectedEdgeId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    undoStack: [],

    loadDiagram: async (diagramId: string) => {
      set((state) => {
        state.loading = true;
        state.error = '';
      });
      try {
        // Load diagram data (instances + edges) from snapshot
        const data = await fetchDiagramForEditor(diagramId);

        // Load component library to build componentMap
        const { components } = await fetchComponentLibrary();
        const compMap: Record<string, ComponentMeta> = {};
        for (const comp of components) {
          compMap[comp.id] = {
            name: comp.name,
            category: comp.category,
            pins: comp.pins,
          };
        }

        set((state) => {
          state.diagramId = diagramId;
          state.diagramInfo = data.diagram;
          state.instances = data.instances;
          state.edges = data.edges;
          state.componentMap = compMap;
          state.loading = false;
          state.selectedInstanceId = null;
          state.selectedEdgeId = null;
          state.undoStack = [];
          state.zoom = 1;
          state.panX = 0;
          state.panY = 0;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '加载图纸失败';
        set((state) => {
          state.loading = false;
          state.error = message;
        });
      }
    },

    addInstance: async (componentId: string, label: string, x: number, y: number) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        const instance = await createDiagramInstance(diagramId, {
          componentId,
          label,
          positionX: x,
          positionY: y,
        });
        set((state) => {
          state.instances.push(instance);
          state.selectedInstanceId = instance.id;
          state.selectedEdgeId = null;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '添加实例失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    moveInstance: (id: string, x: number, y: number) => {
      set((state) => {
        const instance = state.instances.find((i) => i.id === id);
        if (instance) {
          instance.positionX = x;
          instance.positionY = y;
        }
      });
    },

    persistInstanceMove: async (id: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      const instance = get().instances.find((i) => i.id === id);
      if (!instance) return;

      try {
        await updateDiagramInstance(diagramId, id, {
          positionX: instance.positionX,
          positionY: instance.positionY,
        });
      } catch {
        // Silent fail for optimistic update
      }
    },

    removeInstance: async (id: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        await deleteDiagramInstance(diagramId, id);
        set((state) => {
          state.instances = state.instances.filter((i) => i.id !== id);
          state.edges = state.edges.filter(
            (e) => e.sourceInstanceId !== id && e.targetInstanceId !== id,
          );
          if (state.selectedInstanceId === id) state.selectedInstanceId = null;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '删除实例失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    addEdge: async (
      sourceInstanceId: string,
      targetInstanceId: string,
      sourcePinId: string,
      targetPinId: string,
    ) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        const edge = await createDiagramEdge(diagramId, {
          sourceInstanceId,
          targetInstanceId,
          sourcePinId,
          targetPinId,
        });
        set((state) => {
          state.edges.push(edge);
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '添加连线失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    removeEdge: async (id: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        await deleteDiagramEdge(diagramId, id);
        set((state) => {
          state.edges = state.edges.filter((e) => e.id !== id);
          if (state.selectedEdgeId === id) state.selectedEdgeId = null;
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '删除连线失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    selectInstance: (id: string | null) => {
      set((state) => {
        state.selectedInstanceId = id;
        if (id) state.selectedEdgeId = null;
      });
    },

    selectEdge: (id: string | null) => {
      set((state) => {
        state.selectedEdgeId = id;
        if (id) state.selectedInstanceId = null;
      });
    },

    pushUndo: () => {
      const snapshot: Snapshot = {
        instances: JSON.parse(JSON.stringify(get().instances)),
        edges: JSON.parse(JSON.stringify(get().edges)),
      };
      const serialized = JSON.stringify(snapshot);
      set((state) => {
        state.undoStack.push(serialized);
        if (state.undoStack.length > MAX_UNDO) {
          state.undoStack.shift();
        }
      });
    },

    undo: () => {
      set((state) => {
        if (state.undoStack.length === 0) return;
        const prev = state.undoStack.pop()!;
        const snapshot: Snapshot = JSON.parse(prev);
        state.instances = snapshot.instances;
        state.edges = snapshot.edges;
        state.selectedInstanceId = null;
        state.selectedEdgeId = null;
      });
    },

    setZoom: (z: number) => {
      set((state) => {
        state.zoom = Math.max(0.1, Math.min(5, z));
      });
    },

    setPan: (x: number, y: number) => {
      set((state) => {
        state.panX = x;
        state.panY = y;
      });
    },

    clearDiagram: () => {
      set((state) => {
        state.diagramId = null;
        state.diagramInfo = null;
        state.instances = [];
        state.edges = [];
        state.selectedInstanceId = null;
        state.selectedEdgeId = null;
        state.undoStack = [];
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        state.error = '';
        state.loading = false;
      });
    },

    updateInstanceLabel: async (id: string, label: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      set((state) => {
        const instance = state.instances.find((i) => i.id === id);
        if (instance) {
          instance.label = label;
        }
      });

      try {
        await updateDiagramInstance(diagramId, id, { label });
      } catch {
        // Silent fail
      }
    },
  })),
);
