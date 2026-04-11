import type { ElectricalComponent, ShapeElement } from '../../types';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { getShapeBounds } from '../../utils/alignment';
import PinRenderer from './PinRenderer';
import ConnectionRenderer from './ConnectionRenderer';

interface Props {
  component: ElectricalComponent;
}

function resolveShapeProps(el: ShapeElement): ShapeElement {
  if (el.linkedConnectionId) {
    const matrices = useConnectionStore.getState().matrices;
    for (const matrix of Object.values(matrices)) {
      const conn = matrix.connections.find((c: { id: string }) => c.id === el.linkedConnectionId);
      if (conn) {
        const override = conn.state === 'closed' ? el.stateClosed : el.stateOpen;
        if (override) return { ...el, ...override };
        return el;
      }
    }
  }
  return el;
}

function renderShape(el: ShapeElement) {
  const resolved = resolveShapeProps(el);
  const baseProps = {
    fill: resolved.fill || 'transparent',
    stroke: resolved.stroke || '#fff',
    strokeWidth: resolved.strokeWidth ?? 2,
    opacity: resolved.opacity ?? 1,
    style: { cursor: 'pointer' },
  };

  switch (resolved.type) {
    case 'rect':
      return (
        <rect
          key={el.id}
          data-shape-id={el.id}
          x={resolved.x}
          y={resolved.y}
          width={resolved.width}
          height={resolved.height}
          rx={resolved.rx ?? 0}
          {...baseProps}
        />
      );
    case 'circle':
      return <circle key={el.id} data-shape-id={el.id} cx={resolved.cx} cy={resolved.cy} r={resolved.r} {...baseProps} />;
    case 'ellipse':
      return <ellipse key={el.id} data-shape-id={el.id} cx={resolved.cx} cy={resolved.cy} rx={resolved.rx} ry={resolved.ry} {...baseProps} />;
    case 'line':
      return (
        <line
          key={el.id}
          data-shape-id={el.id}
          x1={resolved.x1}
          y1={resolved.y1}
          x2={resolved.x2}
          y2={resolved.y2}
          fill="none"
          stroke={resolved.stroke || '#fff'}
          strokeWidth={resolved.strokeWidth ?? 2}
          opacity={resolved.opacity ?? 1}
          style={{ cursor: 'pointer' }}
        />
      );
    case 'path':
      return <path key={el.id} data-shape-id={el.id} d={resolved.d} {...baseProps} />;
    default:
      return null;
  }
}

export default function ComponentRenderer({ component }: Props) {
  const matrix = useConnectionStore((s) => s.matrices[component.id]);
  const connections = matrix?.connections ?? [];
  const selectedShapeIds = useCanvasStore((s) => s.selectedShapeIds);

  return (
    <g>
      <rect
        x={0}
        y={0}
        width={component.width}
        height={component.height}
        fill="#0d1520"
        stroke="#2a3a5e"
        strokeWidth={1}
        rx={3}
        strokeDasharray="4,4"
      />

      {component.shapeElements.map((el) => {
        const isSelected = selectedShapeIds.includes(el.id);
        const b = getShapeBounds(resolveShapeProps(el));

        return (
          <g key={el.id}>
            {renderShape(el)}
            {isSelected && (
              <rect
                x={b.left - 2}
                y={b.top - 2}
                width={b.width + 4}
                height={b.height + 4}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1}
                strokeDasharray="3,3"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}

      {component.shapeElements.length === 0 && (
        <text
          x={component.width / 2}
          y={component.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#4a5a7e"
          fontSize={11}
          pointerEvents="none"
        >
          使用工具栏绘制图形
        </text>
      )}

      {connections.map((conn) => (
        <ConnectionRenderer key={conn.id} connection={conn} pins={component.pins} />
      ))}

      {component.pins.map((pin) => (
        <PinRenderer key={pin.id} pin={pin} />
      ))}
    </g>
  );
}
