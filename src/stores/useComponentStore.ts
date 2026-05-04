import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type { ElectricalComponent, Pin, PinType, ComponentCategory, ShapeElement } from '../types';
import { useConnectionStore } from './useConnectionStore';
import { useCanvasStore } from './useCanvasStore';
import { getGroupBounds, scaleShapeInGroup } from '../utils/alignment';
import type { Bounds } from '../utils/alignment';

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
  removeMany: (componentId: string, shapeIds: string[], pinIds: string[]) => void;
  cloneShapeElement: (componentId: string, elementId: string) => string | null;
  cloneFromClipboard: (componentId: string, element: ShapeElement, groupIdOverride?: string) => string | null;
  groupShapeElements: (componentId: string, elementIds: string[]) => string | null;
  ungroupShapeElements: (componentId: string, elementIds: string[]) => void;

  loadComponents: (components: ElectricalComponent[]) => void;

  importSubComponent: (targetComponentId: string, sourceComponent: ElectricalComponent, offsetX: number, offsetY: number) => string[];
  importSubComponentScaled: (targetId: string, sourceComp: ElectricalComponent, centerX: number, centerY: number) => string[];
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
          displayWidth: 140, displayHeight: 90,
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

    removeMany: (componentId, shapeIds, pinIds) => {
      if (shapeIds.length === 0 && pinIds.length === 0) return;
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (!comp) return;
        if (shapeIds.length > 0) {
          const ids = new Set(shapeIds);
          comp.shapeElements = comp.shapeElements.filter((e) => !ids.has(e.id));
        }
        if (pinIds.length > 0) {
          const ids = new Set(pinIds);
          comp.pins = comp.pins.filter((p) => !ids.has(p.id));
        }
        comp.updatedAt = new Date().toISOString();
      });
      for (const pid of pinIds) {
        useConnectionStore.getState().removePinConnections(componentId, pid);
      }
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

    cloneFromClipboard: (componentId, element, groupIdOverride?) => {
      const comp = get().components.find((c) => c.id === componentId);
      if (!comp) return null;
      get().pushUndo();
      const newId = uuid();
      const cloned: ShapeElement = { ...element, id: newId, groupId: groupIdOverride ?? undefined };
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

    importSubComponent: (targetComponentId, sourceComponent, offsetX, offsetY) => {
      get().pushUndo();
      const groupId = uuid();
      const newShapeIds: string[] = [];

      const newShapes = sourceComponent.shapeElements.map((s) => {
        const newId = uuid();
        newShapeIds.push(newId);
        const cloned: ShapeElement = { ...s, id: newId, groupId, linkedConnectionId: undefined, stateClosed: undefined, stateOpen: undefined };
        if ('x' in cloned && cloned.x !== undefined) cloned.x += offsetX;
        if ('y' in cloned && cloned.y !== undefined) cloned.y += offsetY;
        if ('cx' in cloned && cloned.cx !== undefined) cloned.cx += offsetX;
        if ('cy' in cloned && cloned.cy !== undefined) cloned.cy += offsetY;
        if ('x1' in cloned && cloned.x1 !== undefined) cloned.x1 += offsetX;
        if ('y1' in cloned && cloned.y1 !== undefined) cloned.y1 += offsetY;
        if ('x2' in cloned && cloned.x2 !== undefined) cloned.x2 += offsetX;
        if ('y2' in cloned && cloned.y2 !== undefined) cloned.y2 += offsetY;
        return cloned;
      });

      // For path d attribute, do proper x/y offset
      for (const shape of newShapes) {
        if (shape.type === 'path' && shape.d) {
          const nums = shape.d.match(/[+-]?\d*\.?\d+/g);
          if (nums && nums.length >= 2) {
            let numIdx = 0;
            const rebuilt = shape.d.replace(/[+-]?\d*\.?\d+/g, () => {
              const orig = nums[numIdx++];
              const val = parseFloat(orig);
              if (isNaN(val)) return orig;
              // Even index = x, odd index = y
              const isY = numIdx % 2 === 0;
              const offset = isY ? offsetY : offsetX;
              return String(val + offset);
            });
            shape.d = rebuilt;
          }
        }
      }

      const newPins = sourceComponent.pins.map((p) => ({
        ...p,
        id: uuid(),
        position: { x: p.position.x + offsetX, y: p.position.y + offsetY },
      }));

      set((state) => {
        const comp = state.components.find((c) => c.id === targetComponentId);
        if (!comp) return;
        comp.shapeElements.push(...newShapes);
        comp.pins.push(...newPins);
        comp.updatedAt = new Date().toISOString();
      });

      return newShapeIds;
    },

    importSubComponentScaled: (targetId, sourceComp, centerX, centerY) => {
      get().pushUndo();
      const contentBounds = getGroupBounds(sourceComp.shapeElements);
      if (!contentBounds || (contentBounds.width === 0 && contentBounds.height === 0)) return [];

      const dw = sourceComp.displayWidth ?? 140;
      const dh = sourceComp.displayHeight ?? 90;
      const cw = contentBounds.width || 1;
      const ch = contentBounds.height || 1;

      // Target content-to-display reference
      const targetComp = get().components.find(c => c.id === targetId);
      const targetContentBounds = targetComp ? getGroupBounds(targetComp.shapeElements) : null;
      const targetDw = targetComp?.displayWidth ?? 140;
      const targetDh = targetComp?.displayHeight ?? 90;
      const targetCw = targetContentBounds?.width || targetComp?.width || cw;
      const targetCh = targetContentBounds?.height || targetComp?.height || ch;

      // Per-dimension scale: source content → source display → target display → target content
      // Then pick the more constraining dimension to preserve aspect ratio.
      const scaleW = (dw / cw) * (targetCw / targetDw);
      const scaleH = (dh / ch) * (targetCh / targetDh);
      const uniformScale = Math.min(scaleW, scaleH);

      const targetBounds: Bounds = {
        left: centerX - (cw * uniformScale) / 2,
        top: centerY - (ch * uniformScale) / 2,
        right: centerX + (cw * uniformScale) / 2,
        bottom: centerY + (ch * uniformScale) / 2,
        width: cw * uniformScale,
        height: ch * uniformScale,
        cx: centerX,
        cy: centerY,
      };

      const groupId = uuid();
      const newShapeIds: string[] = [];
      const newShapes = sourceComp.shapeElements.map((shape) => {
        const newId = uuid();
        newShapeIds.push(newId);
        const updates = scaleShapeInGroup(shape, contentBounds, targetBounds);
        return { ...shape, ...updates, id: newId, groupId, linkedConnectionId: undefined, stateClosed: undefined, stateOpen: undefined } as ShapeElement;
      });

      const newPins = sourceComp.pins.map((p) => {
        const relX = p.position.x - contentBounds.left;
        const relY = p.position.y - contentBounds.top;
        return {
          ...p,
          id: uuid(),
          groupId,
          position: {
            x: Math.round(targetBounds.left + relX * uniformScale),
            y: Math.round(targetBounds.top + relY * uniformScale),
          },
        };
      });

      const pinIdMap: Record<string, string> = {};
      sourceComp.pins.forEach((oldPin, i) => { pinIdMap[oldPin.id] = newPins[i].id; });

      set((state) => {
        const comp = state.components.find((c) => c.id === targetId);
        if (!comp) return;
        comp.shapeElements.push(...newShapes);
        comp.pins.push(...newPins);
        comp.updatedAt = new Date().toISOString();
      });

      // Copy connectivity matrix: map connections to new pin IDs
      const sourceMatrix = useConnectionStore.getState().matrices[sourceComp.id];
      if (sourceMatrix && sourceMatrix.connections.length > 0) {
        const connStore = useConnectionStore.getState();
        for (const conn of sourceMatrix.connections) {
          const pinAId = pinIdMap[conn.pinAId];
          const pinBId = pinIdMap[conn.pinBId];
          if (!pinAId || !pinBId) continue;
          const connId = connStore.addConnection(targetId, pinAId, pinBId);
          if (conn.state !== 'closed') connStore.setConnectionState(targetId, connId, conn.state);
          if (!conn.visible) connStore.toggleConnectionVisible(targetId, connId);
        }
      }

      return newShapeIds;
    },

    loadComponents: (components) => {
      set((state) => {
        state.components = components.map((c) => ({
          ...c,
          shapeElements: c.shapeElements ?? [],
          displayWidth: c.displayWidth ?? 140,
          displayHeight: c.displayHeight ?? 90,
        }));
        state.activeComponentId = components.length > 0 ? components[0].id : null;
        state.undoStack = [];
      });
    },

    groupShapeElements: (componentId, elementIds) => {
      const ids = Array.from(new Set(elementIds));
      // Allow grouping when shapes >= 2, or when only pins are selected
      const selectedPinIds = useCanvasStore.getState().selectedPinIds;
      if (ids.length < 2 && selectedPinIds.length === 0) return null;
      const groupId = uuid();
      get().pushUndo();
      set((state) => {
        const comp = state.components.find((c) => c.id === componentId);
        if (!comp) return;
        comp.shapeElements.forEach((el) => {
          if (ids.includes(el.id)) el.groupId = groupId;
        });
        comp.pins.forEach((pin) => {
          if (selectedPinIds.includes(pin.id)) pin.groupId = groupId;
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
        // Collect groupIds from shapes being ungrouped
        const targetGroupIds = new Set<string>();
        comp.shapeElements.forEach((el) => {
          if (ids.includes(el.id) && el.groupId) {
            targetGroupIds.add(el.groupId);
            el.groupId = undefined;
          }
        });
        // Clear groupId on pins that belong to those groups or are in selectedPinIds
        const selectedPinIds = useCanvasStore.getState().selectedPinIds;
        comp.pins.forEach((pin) => {
          if ((pin.groupId && targetGroupIds.has(pin.groupId)) || selectedPinIds.includes(pin.id)) {
            pin.groupId = undefined;
          }
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
        displayWidth: c.displayWidth ?? 140,
        displayHeight: c.displayHeight ?? 90,
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
