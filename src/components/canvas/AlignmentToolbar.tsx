import { useCanvasStore } from '../../stores/useCanvasStore';
import { useComponentStore } from '../../stores/useComponentStore';
import { computeAlignmentByGroup, groupShapesByUnit, type AlignMode } from '../../utils/alignment';

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
  const groupEditingGroupId = useCanvasStore((s) => s.groupEditingGroupId);
  const { activeComponentId, getComponent, updateShapeElement, pushUndo } = useComponentStore();

  if (!activeComponentId) return null;

  const comp = getComponent(activeComponentId);
  if (!comp) return null;

  const selectedShapes = comp.shapeElements.filter((e) => selectedShapeIds.includes(e.id));
  const units = groupShapesByUnit(selectedShapes);
  const allSameGroup = units.length <= 1 && !groupEditingGroupId;

  if (selectedShapes.length < 2 || allSameGroup) return null;

  const handleAlign = (mode: AlignMode) => {
    pushUndo();
    const updates = computeAlignmentByGroup(selectedShapes, mode);
    for (const [id, partial] of updates) {
      updateShapeElement(activeComponentId, id, partial);
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
          disabled={mode.startsWith('dist') && units.length < 3}
        >
          <span className="align-icon">{icon}</span>
        </button>
      ))}
      <span className="align-count">{units.length} 个组件</span>
    </div>
  );
}
