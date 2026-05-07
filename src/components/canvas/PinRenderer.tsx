import { useState, useCallback } from 'react';
import type { Pin } from '../../types';
import { useComponentStore } from '../../stores/useComponentStore';
import { useCanvasStore } from '../../stores/useCanvasStore';

const PIN_COLORS: Record<string, string> = {
  input: '#3b82f6',
  output: '#f97316',
  bidirectional: '#8b5cf6',
  power: '#eab308',
  ground: '#6b7280',
};

interface Props {
  pin: Pin;
}

export default function PinRenderer({ pin }: Props) {
  const [dragging, setDragging] = useState(false);
  const { activeComponentId, updatePin } = useComponentStore();
  const { selectPin, selectedPinId } = useCanvasStore();
  const isSelected = selectedPinId === pin.id;
  const color = PIN_COLORS[pin.pinType] || '#6b7280';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      selectPin(pin.id);
      setDragging(true);

      const svg = (e.currentTarget as SVGElement).closest('svg');
      const startPos = { ...pin.position };
      const startClientX = e.clientX;
      const startClientY = e.clientY;

      // Compute initial SVG position of mouse for delta calculation
      let startSvgX = startPos.x;
      let startSvgY = startPos.y;
      if (svg) {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const local = pt.matrixTransform(ctm.inverse());
          startSvgX = local.x;
          startSvgY = local.y;
        }
      }

      const handleMove = (ev: MouseEvent) => {
        if (!activeComponentId) return;
        if (svg) {
          const ctm = svg.getScreenCTM();
          if (ctm) {
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX;
            pt.y = ev.clientY;
            const local = pt.matrixTransform(ctm.inverse());
            const dx = local.x - startSvgX;
            const dy = local.y - startSvgY;
            updatePin(activeComponentId, pin.id, {
              position: { x: Math.round(startPos.x + dx), y: Math.round(startPos.y + dy) },
            });
          }
        } else {
          // Fallback: use viewport zoom if no SVG reference
          const { zoom } = useCanvasStore.getState().viewport;
          const dx = (ev.clientX - startClientX) / zoom;
          const dy = (ev.clientY - startClientY) / zoom;
          updatePin(activeComponentId, pin.id, {
            position: { x: Math.round(startPos.x + dx), y: Math.round(startPos.y + dy) },
          });
        }
      };

      const handleUp = () => {
        setDragging(false);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [pin.id, pin.position, activeComponentId, updatePin, selectPin]
  );

  return (
    <g style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
      <line
        x1={pin.position.x - 12}
        y1={pin.position.y}
        x2={pin.position.x}
        y2={pin.position.y}
        stroke={color}
        strokeWidth={2}
      />
      <circle
        cx={pin.position.x}
        cy={pin.position.y}
        r={isSelected ? 6 : 4}
        fill={color}
        stroke={isSelected ? '#fff' : 'transparent'}
        strokeWidth={2}
        onMouseDown={handleMouseDown}
        style={{ cursor: 'pointer' }}
      />
      <text
        x={pin.position.x + 14}
        y={pin.position.y - 8}
        textAnchor="start"
        fill="#8890a0"
        fontSize={10}
        pointerEvents="none"
      >
        {pin.label}
      </text>
    </g>
  );
}
