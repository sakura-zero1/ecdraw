import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type { Connection, ConnectionState, ConnectivityMatrix } from '../types';

interface ConnectionStore {
  matrices: Record<string, ConnectivityMatrix>;

  addConnection: (componentId: string, pinAId: string, pinBId: string) => string;
  removeConnection: (componentId: string, connectionId: string) => void;
  setConnectionState: (componentId: string, connectionId: string, state: ConnectionState) => void;
  toggleConnectionState: (componentId: string, connectionId: string) => void;
  toggleConnectionVisible: (componentId: string, connectionId: string) => void;
  cycleCellState: (componentId: string, pinAId: string, pinBId: string) => void;
  removePinConnections: (componentId: string, pinId: string) => void;
  removeComponentMatrix: (componentId: string) => void;
  duplicateComponentMatrix: (sourceComponentId: string, targetComponentId: string, pinIdMap: Record<string, string>) => Record<string, string>;

  getMatrix: (componentId: string) => ConnectivityMatrix;
  loadMatrices: (matrices: ConnectivityMatrix[]) => void;
}

const newConnection = (componentId: string, pinAId: string, pinBId: string): Connection => ({
  id: uuid(),
  componentId,
  pinAId,
  pinBId,
  state: 'closed',
  pathSvg: '',
  animationDuration: 500,
  visible: true,
});

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    immer((set, get) => ({
      matrices: {},

      addConnection: (componentId, pinAId, pinBId) => {
        const conn = newConnection(componentId, pinAId, pinBId);
        set((state) => {
          if (!state.matrices[componentId]) {
            state.matrices[componentId] = { componentId, connections: [] };
          }
          state.matrices[componentId].connections.push(conn);
        });
        return conn.id;
      },

      removeConnection: (componentId, connectionId) => {
        set((state) => {
          const matrix = state.matrices[componentId];
          if (matrix) {
            matrix.connections = matrix.connections.filter((c) => c.id !== connectionId);
          }
        });
      },

      setConnectionState: (componentId, connectionId, connState) => {
        set((state) => {
          const conn = state.matrices[componentId]?.connections.find((c) => c.id === connectionId);
          if (conn) conn.state = connState;
        });
      },

      toggleConnectionState: (componentId, connectionId) => {
        set((state) => {
          const conn = state.matrices[componentId]?.connections.find((c) => c.id === connectionId);
          if (conn) {
            if (conn.state === 'closed') conn.state = 'open';
            else if (conn.state === 'open') conn.state = 'none';
            else conn.state = 'closed';
          }
        });
      },

      toggleConnectionVisible: (componentId, connectionId) => {
        set((state) => {
          const conn = state.matrices[componentId]?.connections.find((c) => c.id === connectionId);
          if (conn) conn.visible = !conn.visible;
        });
      },

      cycleCellState: (componentId, pinAId, pinBId) => {
        set((state) => {
          if (!state.matrices[componentId]) {
            state.matrices[componentId] = { componentId, connections: [] };
          }
          const matrix = state.matrices[componentId];
          const existing = matrix.connections.find(
            (c) =>
              (c.pinAId === pinAId && c.pinBId === pinBId) ||
              (c.pinAId === pinBId && c.pinBId === pinAId)
          );

          if (!existing) {
            matrix.connections.push(newConnection(componentId, pinAId, pinBId));
          } else if (existing.state === 'none') {
            existing.state = 'closed';
          } else if (existing.state === 'closed') {
            existing.state = 'open';
          } else {
            existing.state = 'none';
          }
        });
      },

      removePinConnections: (componentId, pinId) => {
        set((state) => {
          const matrix = state.matrices[componentId];
          if (!matrix) return;
          matrix.connections = matrix.connections.filter((c) => c.pinAId !== pinId && c.pinBId !== pinId);
        });
      },

      removeComponentMatrix: (componentId) => {
        set((state) => {
          delete state.matrices[componentId];
        });
      },

      duplicateComponentMatrix: (sourceComponentId, targetComponentId, pinIdMap) => {
        const connectionIdMap: Record<string, string> = {};
        set((state) => {
          const source = state.matrices[sourceComponentId];
          if (!source) return;
          state.matrices[targetComponentId] = {
            componentId: targetComponentId,
            connections: source.connections
              .map((conn) => {
                const pinAId = pinIdMap[conn.pinAId];
                const pinBId = pinIdMap[conn.pinBId];
                if (!pinAId || !pinBId) return null;
                const newId = uuid();
                connectionIdMap[conn.id] = newId;
                return {
                  ...conn,
                  id: newId,
                  componentId: targetComponentId,
                  pinAId,
                  pinBId,
                  visible: conn.visible ?? true,
                };
              })
              .filter((c): c is Connection => c !== null),
          };
        });
        return connectionIdMap;
      },

      getMatrix: (componentId) => {
        return get().matrices[componentId] || { componentId, connections: [] };
      },

      loadMatrices: (matrices) => {
        set((state) => {
          state.matrices = {};
          for (const m of matrices) {
            state.matrices[m.componentId] = {
              ...m,
              connections: m.connections.map((c) => ({ ...c, visible: c.visible ?? true })),
            };
          }
        });
      },
    })),
    {
      name: 'ecdraw-connection-library-v1',
      partialize: (state) => ({ matrices: state.matrices }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ConnectionStore>;
        const matrices = p.matrices ?? {};
        const normalized: Record<string, ConnectivityMatrix> = {};

        for (const [cid, matrix] of Object.entries(matrices)) {
          normalized[cid] = {
            ...matrix,
            componentId: matrix.componentId ?? cid,
            connections: (matrix.connections ?? []).map((c) => ({ ...c, visible: c.visible ?? true })),
          };
        }

        return {
          ...current,
          matrices: normalized,
        };
      },
    }
  )
);
