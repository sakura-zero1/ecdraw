import { useEffect, useState, useCallback } from 'react';
import {
  approveReviewByApi,
  fetchReviewQueue,
  rejectReviewByApi,
  type ReviewFilterStatus,
  type ReviewQueueItem,
  type ReviewStatus,
} from '../services/reviewApi';
import ViewerCanvas from '../components/diagram/ViewerCanvas';
import { fetchDiagramTopology, type TopologyResponse } from '../services/diagramApi';
import { parseError } from '../utils/parseError';

function parseApiError(error: unknown) {
  return parseError(error);
}

export default function DiagramReviewPage() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [status, setStatus] = useState<ReviewFilterStatus>('PENDING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<TopologyResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(0.6);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewSelectedId, setPreviewSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const s = status === 'ALL' ? undefined : (status as ReviewStatus);
      const result = await fetchReviewQueue({ status: s, page: 1, pageSize: 50 });
      setItems(result.items);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setActionLoadingId(id);
    setError('');
    try {
      const comment = comments[id]?.trim() || undefined;
      if (action === 'approve') await approveReviewByApi(id, comment);
      else await rejectReviewByApi(id, comment);
      await load();
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setActionLoadingId('');
    }
  };

  const handleTogglePreview = useCallback(async (item: ReviewQueueItem) => {
    if (expandedReviewId === item.id) {
      setExpandedReviewId(null);
      setPreviewData(null);
      return;
    }
    setExpandedReviewId(item.id);
    setPreviewData(null);
    setPreviewLoading(true);
    setPreviewZoom(0.6);
    setPreviewPan({ x: 0, y: 0 });
    setPreviewSelectedId(null);
    try {
      const topology = await fetchDiagramTopology(item.diagramId);
      setPreviewData(topology);
    } catch {
      // silently fail — preview is optional
    } finally {
      setPreviewLoading(false);
    }
  }, [expandedReviewId]);

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸审核</h3>
        <div className="page-actions">
          <select value={status} onChange={(e) => setStatus(e.target.value as ReviewFilterStatus)}>
            <option value="PENDING">待审核</option>
            <option value="APPROVED">已通过</option>
            <option value="REJECTED">已驳回</option>
            <option value="ALL">全部</option>
          </select>
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="review-list">
        {items.map((item) => {
          const processing = actionLoadingId === item.id;
          const isExpanded = expandedReviewId === item.id;
          return (
            <div key={item.id} className="review-item">
              <div className="review-item-top">
                <strong>图纸 #{item.diagramId.slice(0, 8)}</strong>
                <span className={`review-status ${item.status.toLowerCase()}`}>{item.status}</span>
              </div>
              <div className="review-meta">
                <span>版本 #{item.diagramVersionId.slice(0, 8)}</span>
                <span>提交: {new Date(item.submittedAt).toLocaleString()}</span>
              </div>
              {item.status === 'PENDING' && (
                <div style={{ marginBottom: 6 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => void handleTogglePreview(item)}
                  >
                    {isExpanded ? '收起预览' : '查看预览'}
                  </button>
                </div>
              )}
              {isExpanded && (
                <div className="review-preview-area">
                  {previewLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gray-500)', fontSize: '13px' }}>
                      加载拓扑预览...
                    </div>
                  ) : previewData ? (
                    <ViewerCanvas
                      instances={previewData.instances}
                      edges={previewData.edges}
                      viewMode="complete"
                      zoom={previewZoom}
                      panX={previewPan.x}
                      panY={previewPan.y}
                      onSetZoom={setPreviewZoom}
                      onSetPan={(x, y) => setPreviewPan({ x, y })}
                      selectedInstanceId={previewSelectedId}
                      onSelectInstance={setPreviewSelectedId}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gray-400)', fontSize: '13px' }}>
                      无法加载预览
                    </div>
                  )}
                </div>
              )}
              {item.status === 'PENDING' ? (
                <div className="review-actions">
                  <input
                    value={comments[item.id] ?? ''}
                    onChange={(e) => setComments((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="审核意见（可选）"
                  />
                  <button className="btn btn-sm btn-primary" disabled={processing} onClick={() => void handleAction(item.id, 'approve')}>
                    通过
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={processing} onClick={() => void handleAction(item.id, 'reject')}>
                    驳回
                  </button>
                </div>
              ) : (
                <div className="review-result">
                  <span>审核人: {item.reviewerId ?? '-'}</span>
                  <span>意见: {item.comment || '无'}</span>
                </div>
              )}
            </div>
          );
        })}
        {!loading && items.length === 0 ? <div className="empty-hint">暂无审核数据</div> : null}
      </div>
    </div>
  );
}
