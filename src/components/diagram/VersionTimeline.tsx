import { useState, useCallback } from 'react';
import { type VersionSummary, type VersionStatus } from '../../services/diagramApi';

const STATUS_COLORS: Record<VersionStatus, string> = {
  ONLINE: 'var(--success)',
  DRAFT: 'var(--gray-400)',
  REVIEWING: 'var(--info)',
  REJECTED: 'var(--warning)',
  DECOMMISSIONED: 'var(--gray-400)',
};

const STATUS_LABELS: Record<VersionStatus, string> = {
  ONLINE: '已发布',
  DRAFT: '草稿',
  REVIEWING: '审核中',
  REJECTED: '已驳回',
  DECOMMISSIONED: '已退运',
};

// 草稿（进行中的修订）应通过编辑器「放弃修订」撤销，不在时间线删除，避免破坏修订状态。
const DELETABLE_STATUSES: VersionStatus[] = ['REJECTED', 'DECOMMISSIONED'];

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

  // 锚定到节点右侧（只在进入节点时定位一次，避免 mousemove 高频 setState）
  const handleMouseEnter = useCallback((e: React.MouseEvent, v: VersionSummary) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ version: v, x: rect.right + 12, y: rect.top + rect.height / 2 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent, v: VersionSummary) => {
    e.stopPropagation();
    const label = `v${v.versionNo} (${STATUS_LABELS[v.status]})`;
    if (window.confirm(`确定删除版本 ${label} 吗？此操作不可恢复，将一并删除该版本的审核记录。`)) {
      onDeleteVersion?.(v.id);
    }
  }, [onDeleteVersion]);

  const canDelete = onDeleteVersion && versions.length > 1;

  return (
    <div className="viewer-timeline">
      <div className="viewer-timeline-line" />
      {versions.map((v) => {
        const isSelected = v.id === selectedVersionId;
        const isOnline = v.id === currentOnlineVersionId;
        const isDecommissioned = v.status === 'DECOMMISSIONED';
        const showDelete = canDelete && DELETABLE_STATUSES.includes(v.status);
        return (
          <div
            key={v.id}
            className={`viewer-timeline-node${isSelected ? ' selected' : ''}${isOnline ? ' online' : ''}${isDecommissioned ? ' decommissioned' : ''}`}
            onClick={() => onSelectVersion(v.id)}
            onMouseEnter={(e) => handleMouseEnter(e, v)}
            onMouseLeave={handleMouseLeave}
          >
            <div
              className={`viewer-timeline-dot${isOnline ? ' online-pulse' : ''}`}
              style={{
                borderColor: STATUS_COLORS[v.status],
                backgroundColor: isSelected || isOnline ? STATUS_COLORS[v.status] : undefined,
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
          style={{ left: tooltip.x, top: tooltip.y }}
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
            创建: {new Date(tooltip.version.createdAt).toLocaleString()}
          </div>
          {tooltip.version.publishedAt && (
            <div className="tt-time">
              发布: {new Date(tooltip.version.publishedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
