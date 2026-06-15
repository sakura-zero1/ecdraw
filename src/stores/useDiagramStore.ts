import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createDiagramInstance,
  updateDiagramInstance,
  deleteDiagramInstance,
  createDiagramEdge,
  deleteDiagramEdge,
  updateDiagramEdgeLineType,
  updateDiagramEdgePolylineMidRatio,
  fetchDiagramForEditor,
  saveDiagram,
  withdrawDiagramReview,
  type DiagramInstance,
  type DiagramEdge,
  type LineType,
  type DiagramListItem,
} from '../services/diagramApi';
import { fetchComponentLibrary } from '../services/componentApi';
import { parseError } from '../utils/parseError';
import type { Pin, ShapeElement } from '../types';
import type { ConnectivityMatrix } from '../types/connection';

const MAX_UNDO = 50;

export interface ComponentMeta {
  name: string;
  category: string;
  pins?: Pin[];
  shapeElements?: ShapeElement[];
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
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
  componentConnections: Record<string, ConnectivityMatrix>;
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

  // Highlight unnamed instances (flashing red border)
  unnamedHighlightIds: string[];

  // Default line type for new edges
  defaultLineType: LineType;
  setDefaultLineType: (lt: LineType) => void;

  // User settings
  labelFontSize: number;
  setLabelFontSize: (size: number) => void;

  // Actions
  loadDiagram: (diagramId: string) => Promise<void>;
  addInstance: (componentId: string, x: number, y: number) => Promise<void>;
  addInstanceFromClipboard: (componentId: string, x: number, y: number, label: string, instanceData: Record<string, unknown>) => Promise<void>;
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
  updateEdgeLineType: (id: string, lineType: LineType) => Promise<void>;
  updateEdgePolylineMidRatio: (id: string, ratio: number) => Promise<void>;
  _setEdgePolylineMidRatio: (id: string, ratio: number) => void;
  selectInstance: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  pushUndo: () => void;
  undo: () => void;
  setZoom: (z: number) => void;
  setPan: (x: number, y: number) => void;
  clearDiagram: () => void;
  ensureComponentInMap: (componentId: string) => Promise<void>;
  refreshComponentMap: () => Promise<void>;
  updateInstanceLabel: (id: string, label: string) => Promise<void>;
  updateInstanceTransform: (id: string, transform: { rotation?: number; flipH?: boolean; flipV?: boolean }) => Promise<void>;
  moveConnectionLabel: (instanceId: string, connId: string, offsetX: number, offsetY: number) => void;
  updateConnectionLabel: (instanceId: string, connId: string, data: { name?: string; visible?: boolean; offsetX?: number; offsetY?: number }) => Promise<void>;
  moveInstanceLabel: (id: string, offsetX: number, offsetY: number) => void;
  persistInstanceLabelMove: (id: string) => Promise<void>;
  saveDraft: () => Promise<void>;
  withdrawReview: () => Promise<void>;
}

export const useDiagramStore = create<DiagramEditorState>()(
  immer((set, get) => ({
    diagramId: null,
    diagramInfo: null,
    instances: [],
    edges: [],
    componentMap: {},
    componentConnections: {},
    loading: false,
    error: '',
    selectedInstanceId: null,
    selectedEdgeId: null,
    zoom: 0.5,
    panX: 0,
    panY: 0,
    undoStack: [],
    unnamedHighlightIds: [],
    defaultLineType: 'straight' as LineType,
    setDefaultLineType: (lt: LineType) => {
      set((state) => { state.defaultLineType = lt; });
    },
    labelFontSize: Number(localStorage.getItem('ecdraw-label-font-size')) || 20,
    setLabelFontSize: (size: number) => {
      localStorage.setItem('ecdraw-label-font-size', String(size));
      set((state) => { state.labelFontSize = size; });
    },

    loadDiagram: async (diagramId: string) => {
      set((state) => {
        state.loading = true;
        state.error = '';
      });
      try {
        // Load diagram data (instances + edges) from snapshot
        const data = await fetchDiagramForEditor(diagramId);

        // Load component library to build componentMap
        const { components, matrices } = await fetchComponentLibrary();
        const compMap: Record<string, ComponentMeta> = {};
        for (const comp of components) {
          compMap[comp.id] = {
            name: comp.name,
            category: comp.category,
            pins: comp.pins,
            shapeElements: comp.shapeElements,
            width: comp.width,
            height: comp.height,
            displayWidth: comp.displayWidth,
            displayHeight: comp.displayHeight,
          };
        }
        const connMap: Record<string, ConnectivityMatrix> = {};
        for (const m of matrices) {
          connMap[m.componentId] = m;
        }

        set((state) => {
          state.diagramId = diagramId;
          state.diagramInfo = data.diagram;
          state.instances = data.instances;
          state.edges = data.edges;
          state.componentMap = compMap;
          state.componentConnections = connMap;
          state.loading = false;
          state.selectedInstanceId = null;
          state.selectedEdgeId = null;
          state.undoStack = [];
          state.zoom = 0.5;
          state.panX = 0;
          state.panY = 0;
        });
      } catch (e) {
        const message = parseError(e) || '加载图纸失败';
        set((state) => {
          state.loading = false;
          state.error = message;
        });
      }
    },

    addInstance: async (componentId: string, x: number, y: number) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        const instance = await createDiagramInstance(diagramId, {
          componentId,
          positionX: x,
          positionY: y,
        });
        set((state) => {
          state.instances.push(instance);
          state.selectedInstanceId = instance.id;
          state.selectedEdgeId = null;
        });
      } catch (e) {
        const message = parseError(e) || '添加实例失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    addInstanceFromClipboard: async (componentId: string, x: number, y: number, label: string, instanceData: Record<string, unknown>) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        const cleanData = { ...instanceData };
        delete (cleanData as Record<string, unknown>).connectionLabels;
        const instance = await createDiagramInstance(diagramId, {
          componentId,
          positionX: x,
          positionY: y,
          label,
          instanceData: cleanData,
        });
        set((state) => {
          state.instances.push(instance);
          state.selectedInstanceId = instance.id;
          state.selectedEdgeId = null;
        });
      } catch (e) {
        const message = parseError(e) || '粘贴实例失败';
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
        const message = parseError(e) || '删除实例失败';
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
          lineType: get().defaultLineType,
        });
        set((state) => {
          state.edges.push(edge);
        });
      } catch (e) {
        const message = parseError(e) || '添加连线失败';
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
        const message = parseError(e) || '删除连线失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    updateEdgeLineType: async (id: string, lineType: LineType) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      try {
        const updated = await updateDiagramEdgeLineType(diagramId, id, lineType);
        set((state) => {
          const idx = state.edges.findIndex((e) => e.id === id);
          if (idx >= 0) state.edges[idx] = updated;
        });
      } catch (e) {
        const message = parseError(e) || '更新线型失败';
        set((state) => {
          state.error = message;
        });
      }
    },

    updateEdgePolylineMidRatio: async (id: string, ratio: number) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      try {
        const updated = await updateDiagramEdgePolylineMidRatio(diagramId, id, ratio);
        set((state) => {
          const idx = state.edges.findIndex((e) => e.id === id);
          if (idx >= 0) state.edges[idx] = updated;
        });
      } catch (e) {
        const message = parseError(e) || '更新折线位置失败';
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

    _setEdgePolylineMidRatio: (id: string, ratio: number) => {
      set((state) => {
        const idx = state.edges.findIndex((e) => e.id === id);
        if (idx >= 0) state.edges[idx].polylineMidRatio = ratio;
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
        state.unnamedHighlightIds = [];
        state.zoom = 0.5;
        state.panX = 0;
        state.panY = 0;
        state.error = '';
        state.loading = false;
      });
    },

    ensureComponentInMap: async (componentId: string) => {
      const existing = get().componentMap[componentId];
      if (existing?.shapeElements && existing.shapeElements.length > 0) return;
      await get().refreshComponentMap();
    },

    refreshComponentMap: async () => {
      try {
        const { components, matrices } = await fetchComponentLibrary();
        set((state) => {
          for (const comp of components) {
            state.componentMap[comp.id] = {
              name: comp.name,
              category: comp.category,
              pins: comp.pins,
              shapeElements: comp.shapeElements,
              width: comp.width,
              height: comp.height,
              displayWidth: comp.displayWidth,
              displayHeight: comp.displayHeight,
            };
          }
          for (const m of matrices) {
            state.componentConnections[m.componentId] = m;
          }
        });
      } catch {
        // Silently fail
      }
    },

    updateInstanceLabel: async (id: string, label: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      set((state) => {
        const instance = state.instances.find((i) => i.id === id);
        if (instance) {
          instance.label = label;
        }
        // Remove from unnamed highlight once user gives it a custom name
        const comp = state.componentMap[instance?.componentId ?? ''];
        const defaultLabel = comp?.name || '未知';
        if (label && label !== defaultLabel) {
          state.unnamedHighlightIds = state.unnamedHighlightIds.filter((uid) => uid !== id);
        }
      });

      try {
        await updateDiagramInstance(diagramId, id, { label });
      } catch {
        // Silent fail
      }
    },

    updateInstanceTransform: async (id: string, transform: { rotation?: number; flipH?: boolean; flipV?: boolean }) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      let newInstanceData: Record<string, unknown> = {};
      set((state) => {
        const instance = state.instances.find((i) => i.id === id);
        if (instance) {
          const data = { ...(instance.instanceData as Record<string, unknown>) };
          if (transform.rotation !== undefined) data.rotation = transform.rotation;
          if (transform.flipH !== undefined) data.flipH = transform.flipH;
          if (transform.flipV !== undefined) data.flipV = transform.flipV;
          instance.instanceData = data;
          newInstanceData = data;
        }
      });

      try {
        await updateDiagramInstance(diagramId, id, { instanceData: newInstanceData });
      } catch {
        // Silent fail
      }
    },

    moveConnectionLabel: (instanceId: string, connId: string, offsetX: number, offsetY: number) => {
      set((state) => {
        const instance = state.instances.find((i) => i.id === instanceId);
        if (!instance) return;
        const data = { ...(instance.instanceData as Record<string, unknown>) };
        const labels = (data.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
        if (labels[connId]) {
          labels[connId].offsetX = offsetX;
          labels[connId].offsetY = offsetY;
          data.connectionLabels = labels;
          instance.instanceData = data;
        }
      });
    },

    updateConnectionLabel: async (instanceId: string, connId: string, labelData: { name?: string; visible?: boolean; offsetX?: number; offsetY?: number }) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      get().pushUndo();

      let newInstanceData: Record<string, unknown> = {};
      set((state) => {
        const instance = state.instances.find((i) => i.id === instanceId);
        if (!instance) return;
        const data = { ...(instance.instanceData as Record<string, unknown>) };
        const labels = (data.connectionLabels as Record<string, { name: string; visible: boolean; offsetX: number; offsetY: number }>) ?? {};
        if (!labels[connId]) {
          labels[connId] = { name: '', visible: true, offsetX: 0, offsetY: 0 };
        }
        if (labelData.name !== undefined) labels[connId].name = labelData.name;
        if (labelData.visible !== undefined) labels[connId].visible = labelData.visible;
        if (labelData.offsetX !== undefined) labels[connId].offsetX = labelData.offsetX;
        if (labelData.offsetY !== undefined) labels[connId].offsetY = labelData.offsetY;
        data.connectionLabels = labels;
        instance.instanceData = data;
        newInstanceData = data;
      });

      try {
        await updateDiagramInstance(diagramId, instanceId, { instanceData: newInstanceData });
      } catch {
        // Silent fail
      }
    },

    moveInstanceLabel: (id: string, offsetX: number, offsetY: number) => {
      set((state) => {
        const instance = state.instances.find((i) => i.id === id);
        if (!instance) return;
        const data = { ...(instance.instanceData as Record<string, unknown>) };
        data.labelOffsetX = offsetX;
        data.labelOffsetY = offsetY;
        instance.instanceData = data;
      });
    },

    persistInstanceLabelMove: async (id: string) => {
      const diagramId = get().diagramId;
      if (!diagramId) return;
      const instance = get().instances.find((i) => i.id === id);
      if (!instance) return;
      try {
        await updateDiagramInstance(diagramId, id, { instanceData: instance.instanceData as Record<string, unknown> });
      } catch {
        // Silent fail
      }
    },

    saveDraft: async () => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      const { instances, edges } = get();
      const snapshot = {
        schemaVersion: 1,
        instances: instances.map((inst) => ({
          id: inst.id,
          componentId: inst.componentId,
          label: inst.label,
          x: inst.positionX,
          y: inst.positionY,
          instanceData: inst.instanceData,
        })),
        connections: edges.map((edge) => ({
          id: edge.id,
          // Write both naming conventions so future readers (and the historic
          // version-topology reader) all find what they expect.
          fromInstanceId: edge.sourceInstanceId,
          toInstanceId: edge.targetInstanceId,
          sourceInstanceId: edge.sourceInstanceId,
          targetInstanceId: edge.targetInstanceId,
          fromPinId: edge.sourcePinId,
          toPinId: edge.targetPinId,
          sourcePinId: edge.sourcePinId,
          targetPinId: edge.targetPinId,
          lineType: edge.lineType ?? 'straight',
          polylineMidRatio: edge.polylineMidRatio,
        })),
        viewport: { zoom: get().zoom, panX: get().panX, panY: get().panY },
      };

      try {
        const updated = await saveDiagram(diagramId, snapshot);
        set((state) => {
          state.diagramInfo = updated;
        });
      } catch (e) {
        const message = parseError(e) || '保存草稿失败';
        set((state) => {
          state.error = message;
        });
        throw e;
      }
    },

    withdrawReview: async () => {
      const diagramId = get().diagramId;
      if (!diagramId) return;

      try {
        await withdrawDiagramReview(diagramId);
        set((state) => {
          if (state.diagramInfo) {
            state.diagramInfo.status = 'DRAFT';
          }
        });
      } catch (e) {
        const message = parseError(e) || '撤回审核失败';
        set((state) => {
          state.error = message;
        });
        throw e;
      }
    },
  })),
);
