import { useEffect, useState } from 'react';
import {
  fetchReviewQueue,
  type ReviewFilterStatus,
  type ReviewQueueItem,
  type ReviewStatus,
} from '../services/reviewApi';
import ReviewCompareView from '../components/review/ReviewCompareView';
import { parseError } from '../utils/parseError';

export default function DiagramReviewPage() {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [status, setStatus] = useState<ReviewFilterStatus>('PENDING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const s = status === 'ALL' ? undefined : (status as ReviewStatus);
      const result = await fetchReviewQueue({ status: s, page: 1, pageSize: 50 });
      setItems(result.items);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  if (selected) {
    return (
      <div className="workspace-page">
        <ReviewCompareView
          review={selected}
          onBack={() => setSelected(null)}
          onActionDone={() => {
            setSelected(null);
            void load();
          }}
        />
      </div>
    );
  }

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
        {items.map((item) => (
          <div key={item.id} className="review-row">
            <div className="review-row-main">
              <strong>图纸 #{item.diagramId.slice(0, 8)}</strong>
              <span className={`review-status ${item.status.toLowerCase()}`}>{item.status}</span>
            </div>
            <div className="review-row-meta">
              <span>提交人 {item.submitterId.slice(0, 8)}</span>
              <span>提交 {new Date(item.submittedAt).toLocaleString()}</span>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setSelected(item)}>
              查看对比 →
            </button>
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="empty-hint">暂无审核数据</div> : null}
      </div>
    </div>
  );
}
