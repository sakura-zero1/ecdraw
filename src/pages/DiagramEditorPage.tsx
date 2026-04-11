import { useEffect, useState } from 'react';
import { createDiagramByApi, fetchDiagrams, submitDiagramReview, type DiagramListItem } from '../services/diagramApi';

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function DiagramEditorPage() {
  const [items, setItems] = useState<DiagramListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await fetchDiagrams();
      setItems(list);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError('');
    try {
      await createDiagramByApi(trimmed);
      setName('');
      await load();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const handleSubmitReview = async (id: string) => {
    setError('');
    try {
      await submitDiagramReview(id);
      await load();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸编辑</h3>
      </div>

      <div className="card">
        <div className="form-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新建图纸名称" />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            新建图纸
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="review-list">
        {items.map((item) => (
          <div key={item.id} className="review-item">
            <div className="review-item-top">
              <strong>{item.name}</strong>
              <span className={`review-status ${String(item.status).toLowerCase()}`}>{item.status}</span>
            </div>
            <div className="review-meta">
              <span>更新时间: {new Date(item.updatedAt).toLocaleString()}</span>
            </div>
            {(item.status === 'DRAFT' || item.status === 'REJECTED') && (
              <div className="review-actions">
                <span />
                <button className="btn btn-sm btn-primary" onClick={() => void handleSubmitReview(item.id)}>
                  提交审核
                </button>
                <span />
              </div>
            )}
          </div>
        ))}
        {!loading && items.length === 0 ? <div className="empty-hint">暂无图纸</div> : null}
      </div>
    </div>
  );
}
