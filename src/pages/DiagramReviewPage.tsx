import { useEffect, useState } from 'react';
import {
  approveReviewByApi,
  fetchReviewQueue,
  rejectReviewByApi,
  type ReviewFilterStatus,
  type ReviewQueueItem,
  type ReviewStatus,
} from '../services/reviewApi';

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function DiagramReviewPage() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [status, setStatus] = useState<ReviewFilterStatus>('PENDING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});

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
          return (
            <div key={item.id} className="review-item">
              <div className="review-item-top">
                <strong>{item.diagram.name}</strong>
                <span className={`review-status ${item.status.toLowerCase()}`}>{item.status}</span>
              </div>
              <div className="review-meta">
                <span>版本: v{item.diagramVersion.versionNo}</span>
                <span>提交: {new Date(item.submittedAt).toLocaleString()}</span>
              </div>
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
