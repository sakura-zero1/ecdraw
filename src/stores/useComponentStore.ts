import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type { ElectricalComponent, Pin, PinType, ComponentCategory, ShapeElement } from '../types';
import { useConnectionStore } from './useConnectionStore';

interface ComponentStore {
  components: ElectricalComponent[];
  activeComponentId: string | null;

  // Undo
  undoStack: string[];
  pushUndo: () => void;
  undo: () => void;

  addComponent: (name: string, category: ComponentCategory, width: number, height: number) => string;
  updateComponent: (id: string, updates: Partial<ElectricalComponent>) => void;
  removeComponent: (id: string) => void;
  duplicateComponent: (id: string) => string | null;
  setActiveComponent: (id: string | null) => void;
  getComponent: (id: string) => ElectricalComponent | undefined;

  addPin: (componentId: string, label: string, pinType: PinType) => string;
  updatePin: (componentId: string, pinId: string, updates: Partial<Pin>) => void;
  removePin: (componentId: string, pinId: string) => void;

  addShapeElement: (componentId: string, element: Omit<ShapeElement, 'id'>) => string;
  updateShapeElement: (componentId: string, elementId: string, updates: Partial<ShapeElement>) => void;
  removeShapeElement: (componentId: string, elementId: string) => void;
  cloneShapeElement: (componentId: string, elementId: string) => string | null;
  cloneFromClipboard: (componentId: string, element: ShapeElement) => string | null;
  groupShapeElements: (componentId: string, elementIds: string[]) => string | null;
  ungroupShapeElements: (componentId: string, elementIds: string[]) => void;

  loadComponents: (components: ElectricalComponent[]) => void;
}

const MAX_UNDO = 50;

export const useComponentStore = create<ComponentStore>()(
  persist(immer((set, get) => ({
    components: [],
    activeComponentId: null,
    undoStack: [],

    pushUndo: () => {
      const snapshot = JSON.stringify(get().components);
      set((state) => {
        state.undoStack.push(snapshot);
        if (state.undoStack.length > MAX_UNDO) {
          state.undoStack.shift();
        }
      });
    },

    undo: () => {
      set((state) => {
        if (state.undoStack.length === 0) return;
        const prev = state.undoStack.pop()!;
        state.components = JSON.parse(prev);
        // Ensure activeComponentId still refers to a valid component
        if (state.activeComponentId && !state.components.some((c) => c.id === state.activeComponentId)) {
          state.activeComponentId = state.components.length > 0 ? state.components[0].id : null;
        }
      });
    },

    addComponent: (name, category, width, height) => {
      get().pushUndo();
      const id = uuid();
      const now = new Date().toISOString();
      set((state) => {
        state.components.push({
          id, name, category, description: '', width, height,
          shapeElements: [], pins: [], createdAt: now, updatedAt: now,
        });
        state.activeComponentId = id;
      });
      return id;
    },

    updateComponent: (id, updates) => {
      set((state) => {
        const comp = state.components.find((c) => c.id === id);
        if (comp) {
          Object.assign(comp, updates, { updatedAt: new Date().toISOString() });
        }
      });
    },

    removeComponent: (id) => {
      get().pushUndo();
      set((state) => {
        state.components = state.components.filter((c) => c.id !== id);
        if (state.activeComponentId === id) state.activeComponentId = null;
      });
      useConnectionStore.getState().removeComponentMatrix(id);
    },

    duplicateComponent: (id) => {
      const source = get().components.find((c) => c.id === id);
      if (!source) return null;
      get().pushUndo();

      const newComponentId = uuid();
      const now = new Date().toISOString();

      const existingNames = new Set(get().components.map((c) => c.name));
      const prefix = `${source.name}副本`;
      let next = 2;
      while (existingNames.has(`${prefix}${next}`)) {
        next += 1;
      }
      const newName = `${prefix}${next}`;

      const pinIdMap: Record<string, string> = {};
      const newPins = source.pins.map((p) => {
        const newPinId = uuid();
        pinIdMap[p.id] = newPinId;
        return { ...p, id: newPinId };
      });

      const connectionIdMap = useConnectionStore.getState().duplicateComponentMatrix(source.id, newComponentId, pinIdMap);

      const newShapes = source.shapeElements.map((s) => {
        const newId = uuid();
        const mapped: ShapeElement = { ...s, id: newId };
        if (mapped.linkedConnectionId && connectionIdMap[mapped.linkedConnectionId]) {
          mapped.linkedConnectionId = connectionIdMap[mapped.linkedConnectionId];
        }
        return mapped;
      });

      set((state) => {
        state.components.push({
          ...source,
          id: newComponentId,
          name: newName,
          pins: newPins,
          shapeElements: newShapes,
          createdAt: now,
          updatedAt: now,
        });
        state.activeComponentId = newComponentId;
      });
      return newComponentId;
    },

    setActiveComponent: (id) => {
      set((state) => { state.activeComponentId = id; });
    },

    getComponent: (id) => get().components.find((c) => c.id === id),

    addPin: (componentId, label, pinType) => {
      get().pushUndo();
      const id = uuid();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) {
          comp.pins.push({ id, label, number: comp.pins.length + 1, position: { x: 50, y: 50 }, pinType, visible: true });
          comp.updatedAt = new Date().toISOString();
        }
      });
      return id;
    },

    updatePin: (componentId, pinId, updates) => {
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) {
          const pin = comp.pins.find((p) => p.id === pinId);
          if (pin) { Object.assign(pin, updates); comp.updatedAt = new Date().toISOString(); }
        }
      });
    },

    removePin: (componentId, pinId) => {
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) { comp.pins = comp.pins.filter((p) => p.id !== pinId); comp.updatedAt = new Date().toISOString(); }
      });
      useConnectionStore.getState().removePinConnections(componentId, pinId);
    },

    addShapeElement: (componentId, element) => {
      get().pushUndo();
      const id = uuid();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) { comp.shapeElements.push({ ...element, id }); comp.updatedAt = new Date().toISOString(); }
      });
      return id;
    },

    updateShapeElement: (componentId, elementId, updates) => {
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) {
          const el = comp.shapeElements.find((e) => e.id === elementId);
          if (el) { Object.assign(el, updates); comp.updatedAt = new Date().toISOString(); }
        }
      });
    },

    removeShapeElement: (componentId, elementId) => {
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (comp) { comp.shapeElements = comp.shapeElements.filter((e) => e.id !== elementId); comp.updatedAt = new Date().toISOString(); }
      });
    },

    cloneShapeElement: (componentId, elementId) => {
      const comp = get().components.find((c) => c.id === componentId);
      const el = comp?.shapeElements.find((e) => e.id === elementId);
      if (!el) return null;
      get().pushUndo();
      const newId = uuid();
      // Deep clone with offset
      const cloned: ShapeElement = { ...el, id: newId, groupId: undefined };
      // Offset position by 20px
      if ('x' in cloned && cloned.x !== undefined) cloned.x += 20;
      if ('y' in cloned && cloned.y !== undefined) cloned.y += 20;
      if ('cx' in cloned && cloned.cx !== undefined) cloned.cx += 20;
      if ('cy' in cloned && cloned.cy !== undefined) cloned.cy += 20;
      if ('x1' in cloned && cloned.x1 !== undefined) cloned.x1 += 20;
      if ('y1' in cloned && cloned.y1 !== undefined) cloned.y1 += 20;
      if ('x2' in cloned && cloned.x2 !== undefined) cloned.x2 += 20;
      if ('y2' in cloned && cloned.y2 !== undefined) cloned.y2 += 20;
      set((state) => {
        const c = state.components.find((c) => c.id === componentId);
        if (c) { c.shapeElements.push(cloned); c.updatedAt = new Date().toISOString(); }
      });
      return newId;
    },

    cloneFromClipboard: (componentId, element) => {
      const comp = get().components.find((c) => c.id === componentId);
      if (!comp) return null;
      get().pushUndo();
      const newId = uuid();
      const cloned: ShapeElement = { ...element, id: newId, groupId: undefined };
      // Offset position by 20px
      if ('x' in cloned && cloned.x !== undefined) cloned.x += 20;
      if ('y' in cloned && cloned.y !== undefined) cloned.y += 20;
      if ('cx' in cloned && cloned.cx !== undefined) cloned.cx += 20;
      if ('cy' in cloned && cloned.cy !== undefined) cloned.cy += 20;
      if ('x1' in cloned && cloned.x1 !== undefined) cloned.x1 += 20;
      if ('y1' in cloned && cloned.y1 !== undefined) cloned.y1 += 20;
      if ('x2' in cloned && cloned.x2 !== undefined) cloned.x2 += 20;
      if ('y2' in cloned && cloned.y2 !== undefined) cloned.y2 += 20;
      set((state) => {
        const c = state.components.find((c) => c.id === componentId);
        if (c) { c.shapeElements.push(cloned); c.updatedAt = new Date().toISOString(); }
      });
      return newId;
    },

    loadComponents: (components) => {
      set((state) => {
        state.components = components.map((c) => ({ ...c, shapeElements: c.shapeElements ?? [] }));
        state.activeComponentId = components.length > 0 ? components[0].id : null;
        state.undoStack = [];
      });
    },

    groupShapeElements: (componentId, elementIds) => {
      const ids = Array.from(new Set(elementIds));
      if (ids.length < 2) return null;
      const groupId = uuid();
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (!comp) return;
        comp.shapeElements.forEach((el) => {
          if (ids.includes(el.id)) el.groupId = groupId;
        });
        comp.updatedAt = new Date().toISOString();
      });
      return groupId;
    },

    ungroupShapeElements: (componentId, elementIds) => {
      const ids = Array.from(new Set(elementIds));
      if (ids.length === 0) return;
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (!comp) return;
        comp.shapeElements.forEach((el) => {
          if (ids.includes(el.id)) el.groupId = undefined;
        });
        comp.updatedAt = new Date().toISOString();
      });
    },
  })), {
    name: 'ecdraw-component-library-v1',
    partialize: (state) => ({
      components: state.components,
      activeComponentId: state.activeComponentId,
    }),
    merge: (persisted, current) => {
      const p = persisted as Partial<ComponentStore>;
      const components = (p.components ?? []).map((c) => ({
        ...c,
        shapeElements: c.shapeElements ?? [],
        pins: c.pins ?? [],
      }));
      const activeComponentId = components.some((c) => c.id === p.activeComponentId)
        ? p.activeComponentId ?? null
        : components[0]?.id ?? null;
      return {
        ...current,
        components,
        activeComponentId,
      };
    },
  })
);
