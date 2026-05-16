import { useState, useRef, useCallback } from 'react';
import { type VersionSummary, type VersionStatus } from '../../services/diagramApi';

const STATUS_COLORS: Record<VersionStatus, string> = {
  ONLINE: 'var(--success)',
  DRAFT: 'var(--gray-400)',
  REVIEWING: 'var(--info)',
  REJECTED: 'var(--warning)',
  DECOMMISSIONED: 'var(--danger)',
};

const STATUS_LABELS: Record<VersionStatus, string> = {
  ONLINE: '已发布',
  DRAFT: '草稿',
  REVIEWING: '审核中',
  REJECTED: '已驳回',
  DECOMMISSIONED: '已退运',
};

const DELETABLE_STATUSES: VersionStatus[] = ['DRAFT', 'REJECTED', 'DECOMMISSIONED'];

interface TooltipData {
  version: VersionSummary;
  x: number;
  y: number;
}

interface VersionTimelineProps {
  versions: VersionSummary[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  currentOnlineVersionId: string | null;
  onDeleteVersion?: (versionId: string) => void;
}

export default function VersionTimeline({
  versions,
  selectedVersionId,
  onSelectVersion,
  currentOnlineVersionId,
  onDeleteVersion,
}: VersionTimelineProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent, v: VersionSummary) => {
    setTooltip({ version: v, x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, v: VersionSummary) => {
    e.stopPropagation();
    const label = `v${v.versionNo} (${STATUS_LABELS[v.status]})`;
    if (window.confirm(`确定删除版本 ${label} 吗？此操作不可恢复。`)) {
      onDeleteVersion?.(v.id);
    }
  }, [onDeleteVersion]);

  const canDelete = onDeleteVersion && versions.length > 1;

  return (
    <div className="viewer-timeline" ref={containerRef}>
      <div className="viewer-timeline-line" />
      {versions.map((v) => {
        const isSelected = v.id === selectedVersionId;
        const isOnline = v.id === currentOnlineVersionId;
        const showDelete = canDelete && DELETABLE_STATUSES.includes(v.status);
        return (
          <div
            key={v.id}
            className={`viewer-timeline-node${isSelected ? ' selected' : ''}`}
            onClick={() => onSelectVersion(v.id)}
            onMouseMove={(e) => handleMouseMove(e, v)}
            onMouseLeave={handleMouseLeave}
          >
            <div
              className={`viewer-timeline-dot${isOnline ? ' online-pulse' : ''}`}
              style={{
                borderColor: STATUS_COLORS[v.status],
                backgroundColor: isSelected ? STATUS_COLORS[v.status] : undefined,
              }}
            />
            <span className="viewer-timeline-label">{`v${v.versionNo}`}</span>
            {showDelete && (
              <button
                className="viewer-timeline-delete"
                onClick={(e) => handleDelete(e, v)}
                title="删除此版本"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {tooltip && (
        <div
          className="viewer-timeline-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <div className="tt-title">{`v${tooltip.version.versionNo}`}</div>
          <span
            className="tt-badge"
            style={{
              background: `${STATUS_COLORS[tooltip.version.status]}22`,
              color: STATUS_COLORS[tooltip.version.status],
            }}
          >
            {STATUS_LABELS[tooltip.version.status]}
          </span>
          <div className="tt-time">
            {new Date(tooltip.version.createdAt).toLocaleDateString()}
          </div>
          {tooltip.version.publishedAt && (
            <div className="tt-time">
              发布: {new Date(tooltip.version.publishedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
