import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Connection, Pin } from '../../types';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { computeLinePath } from '../../utils/geometry';

interface Props {
  connection: Connection;
  pins: Pin[];
}

export default function ConnectionRenderer({ connection, pins }: Props) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const { selectConnection, selectedConnectionId } = useCanvasStore();
  const isSelected = selectedConnectionId === connection.id;

  const pinA = pins.find((p) => p.id === connection.pinAId);
  const pinB = pins.find((p) => p.id === connection.pinBId);

  useEffect(() => {
    if (pathRef.current) {
      const len = pathRef.current.getTotalLength();
      setPathLength(len);
    }
  }, [connection.pathSvg, pinA, pinB]);

  if (!pinA || !pinB) return null;

  const d = connection.pathSvg || computeLinePath(pinA.position, pinB.position);
  const isClosed = connection.state === 'closed';
  const color = isClosed ? '#22c55e' : '#ef4444';

  return (
    <g>
      {/* Invisible wider path for click target */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          selectConnection(connection.id);
        }}
      />
      <motion.path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? 3 : 2}
        strokeDasharray={pathLength || 1}
        animate={{
          strokeDashoffset: isClosed ? 0 : pathLength,
        }}
        transition={{
          duration: connection.animationDuration / 1000,
          ease: 'easeInOut',
        }}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          selectConnection(connection.id);
        }}
        style={{ cursor: 'pointer' }}
      />
    </g>
  );
}
