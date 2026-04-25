import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { computeAlignment, type AlignMode } from '../../utils/alignment';
import type { Pin } from '../../types';

const ALIGN_BUTTONS: { mode: AlignMode; icon: string; label: string }[] = [
  { mode: 'left', icon: '⇤', label: '左对齐' },
  { mode: 'center-h', icon: '↔', label: '水平居中' },
  { mode: 'right', icon: '⇥', label: '右对齐' },
  { mode: 'top', icon: '⇡', label: '顶部对齐' },
  { mode: 'center-v', icon: '↕', label: '垂直居中' },
  { mode: 'bottom', icon: '⇣', label: '底部对齐' },
  { mode: 'dist-h', icon: '⦀', label: '横向等距' },
  { mode: 'dist-v', icon: '≡', label: '纵向等距' },
];

export default function AlignmentToolbar() {
  const selectedShapeIds = useCanvasStore((s) => s.selectedShapeIds);
  const selectedPinIds = useCanvasStore((s) => s.selectedPinIds);
  const { activeComponentId, getComponent, updateShapeElement, updatePin, pushUndo } = useComponentStore();

  if (!activeComponentId) return null;

  const comp = getComponent(activeComponentId);
  if (!comp) return null;

  const selectedShapes = comp.shapeElements.filter((e) => selectedShapeIds.includes(e.id));
  const selectedPins = comp.pins.filter((p) => selectedPinIds.includes(p.id));

  // If all selected shapes share the same groupId, they are in a group — disable alignment unless in group-editing mode
  const groupEditingGroupId = useCanvasStore((s) => s.groupEditingGroupId);
  const allSameGroup = selectedShapes.length >= 2 && selectedShapes.every((s) => s.groupId && s.groupId === selectedShapes[0].groupId) && !groupEditingGroupId;

  const shapeMode = selectedShapes.length >= 2 && !allSameGroup;
  const pinMode = !shapeMode && selectedPins.length >= 2;
  if (!shapeMode && !pinMode) return null;

  const handleAlign = (mode: AlignMode) => {
    if (shapeMode) {
      pushUndo();
      const updates = computeAlignment(selectedShapes, mode);
      for (const [id, partial] of updates) {
        updateShapeElement(activeComponentId, id, partial);
      }
      return;
    }

    pushUndo();
    const pinUpdates = computePinAlignment(selectedPins, mode);
    for (const [id, pos] of pinUpdates) {
      updatePin(activeComponentId, id, { position: pos });
    }
  };

  return (
    <div className="alignment-toolbar">
      {ALIGN_BUTTONS.map(({ mode, icon, label }) => (
        <button
          key={mode}
          className="align-btn"
          onClick={() => handleAlign(mode)}
          title={label}
          disabled={mode.startsWith('dist') && (shapeMode ? selectedShapes.length < 3 : selectedPins.length < 3)}
        >
          <span className="align-icon">{icon}</span>
        </button>
      ))}
      <span className="align-count">{shapeMode ? `${selectedShapes.length} 个图形` : `${selectedPins.length} 个引脚`}</span>
    </div>
  );
}

function computePinAlignment(pins: Pin[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (pins.length < 2) return result;

  const xs = pins.map((p) => p.position.x);
  const ys = pins.map((p) => p.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  switch (mode) {
    case 'left':
      pins.forEach((p) => result.set(p.id, { x: minX, y: p.position.y }));
      break;
    case 'right':
      pins.forEach((p) => result.set(p.id, { x: maxX, y: p.position.y }));
      break;
    case 'center-h':
      pins.forEach((p) => result.set(p.id, { x: Math.round(centerX), y: p.position.y }));
      break;
    case 'top':
      pins.forEach((p) => result.set(p.id, { x: p.position.x, y: minY }));
      break;
    case 'bottom':
      pins.forEach((p) => result.set(p.id, { x: p.position.x, y: maxY }));
      break;
    case 'center-v':
      pins.forEach((p) => result.set(p.id, { x: p.position.x, y: Math.round(centerY) }));
      break;
    case 'dist-h': {
      if (pins.length < 3) break;
      const sorted = [...pins].sort((a, b) => a.position.x - b.position.x);
      const gap = (maxX - minX) / (sorted.length - 1);
      sorted.forEach((p, i) => result.set(p.id, { x: Math.round(minX + gap * i), y: p.position.y }));
      break;
    }
    case 'dist-v': {
      if (pins.length < 3) break;
      const sorted = [...pins].sort((a, b) => a.position.y - b.position.y);
      const gap = (maxY - minY) / (sorted.length - 1);
      sorted.forEach((p, i) => result.set(p.id, { x: p.position.x, y: Math.round(minY + gap * i) }));
      break;
    }
  }

  return result;
}
