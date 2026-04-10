import type { ElectricalComponent, ShapeElement } from '../../types';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import PinRenderer from './PinRenderer';
import ConnectionRenderer from './ConnectionRenderer';

interface Props {
  component: ElectricalComponent;
}

function renderShape(el: ShapeElement) {
  const baseProps = {
    fill: el.fill || 'transparent',
    stroke: el.stroke || '#fff',
    strokeWidth: el.strokeWidth ?? 2,
    opacity: el.opacity ?? 1,
    style: { cursor: 'pointer' },
  };

  switch (el.type) {
    case 'rect':
      return (
        <rect
          key={el.id}
          data-shape-id={el.id}
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          rx={el.rx ?? 0}
          {...baseProps}
        />
      );
    case 'circle':
      return <circle key={el.id} data-shape-id={el.id} cx={el.cx} cy={el.cy} r={el.r} {...baseProps} />;
    case 'ellipse':
      return <ellipse key={el.id} data-shape-id={el.id} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...baseProps} />;
    case 'line':
      return (
        <line
          key={el.id}
          data-shape-id={el.id}
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          fill="none"
          stroke={el.stroke || '#fff'}
          strokeWidth={el.strokeWidth ?? 2}
          opacity={el.opacity ?? 1}
          style={{ cursor: 'pointer' }}
        />
      );
    case 'path':
      return <path key={el.id} data-shape-id={el.id} d={el.d} {...baseProps} />;
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
        const anchorX = el.x ?? el.cx ?? el.x1 ?? 0;
        const anchorY = el.y ?? el.cy ?? el.y1 ?? 0;
        const radius = el.r ?? 0;
        const width = el.width ?? (radius > 0 ? radius * 2 : Math.abs((el.x2 ?? 0) - (el.x1 ?? 0)));
        const height = el.height ?? (radius > 0 ? radius * 2 : Math.abs((el.y2 ?? 0) - (el.y1 ?? 0)));

        return (
          <g key={el.id}>
            {renderShape(el)}
            {isSelected && (
              <rect
                x={anchorX - 2}
                y={anchorY - 2}
                width={width + 4}
                height={height + 4}
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
