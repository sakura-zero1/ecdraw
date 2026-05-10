import { create } from 'zustand';

interface DragState {
  draggingId: string | null;
  startX: number;
  startY: number;
  ghostX: number;
  ghostY: number;
  active: boolean; // true after mouse moves past threshold
  startDrag: (id: string, x: number, y: number) => void;
  moveGhost: (x: number, y: number) => void;
  endDrag: () => void;
}

export const useDragStore = create<DragState>((set) => ({
  draggingId: null,
  startX: 0,
  startY: 0,
  ghostX: 0,
  ghostY: 0,
  active: false,
  startDrag: (id, x, y) => set({ draggingId: id, startX: x, startY: y, ghostX: x, ghostY: y, active: false }),
  moveGhost: (x, y) =>
    set((s) => {
      if (!s.draggingId) return s;
      const dx = x - s.startX;
      const dy = y - s.startY;
      return { ghostX: x, ghostY: y, active: s.active || Math.abs(dx) > 4 || Math.abs(dy) > 4 };
    }),
  endDrag: () => set({ draggingId: null, active: false }),
}));
