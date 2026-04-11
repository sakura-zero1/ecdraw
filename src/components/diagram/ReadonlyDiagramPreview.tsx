import type { DiagramSnapshot } from '../../services/diagramApi';

interface Props {
  snapshot: DiagramSnapshot;
}

type Box = { x: number; y: number; width: number; height: number };

function getInstanceBox(x: number, y: number, scale = 1): Box {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return {
    x,
    y,
    width: 120 * s,
    height: 56 * s,
  };
}

export default function ReadonlyDiagramPreview({ snapshot }: Props) {
  const instances = Array.isArray(snapshot.instances) ? snapshot.instances : [];
  const connections = Array.isArray(snapshot.connections) ? snapshot.connections.filter((line) => line.visible !== false) : [];

  const boxes = new Map<string, Box>();
  instances.forEach((item) => {
    boxes.set(item.id, getInstanceBox(Number(item.x) || 0, Number(item.y) || 0, item.scale));
  });

  const view = snapshot.viewport ?? { zoom: 1, panX: 0, panY: 0 };
  const zoom = Number(view.zoom) > 0 ? Number(view.zoom) : 1;
  const panX = Number(view.panX) || 0;
  const panY = Number(view.panY) || 0;

  return (
    <div className="readonly-diagram-root">
      <div
        className="readonly-diagram-stage"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="readonly-lines" width="2400" height="1400" viewBox="0 0 2400 1400">
          {connections.map((line) => {
            const from = boxes.get(line.fromInstanceId);
            const to = boxes.get(line.toInstanceId);
            if (!from || !to) return null;

            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height / 2;
            const x2 = to.x + to.width / 2;
            const y2 = to.y + to.height / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            return (
              <g key={line.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={line.state === 'open' ? '#f97316' : '#10b981'}
                  strokeWidth={2}
                />
                {line.label ? (
                  <text x={midX} y={midY - 6} textAnchor="middle" fontSize="12" fill="#334155">
                    {line.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {instances.map((item) => {
          const box = boxes.get(item.id);
          if (!box) return null;
          return (
            <div
              key={item.id}
              className="readonly-node"
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                transform: `rotate(${Number(item.rotation) || 0}deg)`,
              }}
            >
              <span>{item.label || item.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
