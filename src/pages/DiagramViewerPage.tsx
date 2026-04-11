import { useEffect, useState } from 'react';
import ReadonlyDiagramPreview from '../components/diagram/ReadonlyDiagramPreview';
import {
  fetchDiagramReadonlySnapshot,
  fetchPublishedDiagrams,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../services/diagramApi';

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function DiagramViewerPage() {
  const [items, setItems] = useState<DiagramListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<DiagramSnapshot | null>(null);
  const [versionNo, setVersionNo] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const list = await fetchPublishedDiagrams();
        if (cancelled) return;
        setItems(list);
        setSelectedId((prev) => prev || list[0]?.id || '');
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      setVersionNo(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const detail = await fetchDiagramReadonlySnapshot(selectedId);
        if (cancelled) return;
        setSnapshot(detail.snapshot);
        setVersionNo(detail.versionNo);
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸查看</h3>
      </div>
      <div className="published-layout">
        <aside className="published-list">
          {items.map((item) => (
            <button
              key={item.id}
              className={`published-item ${selectedId === item.id ? 'active' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{new Date(item.updatedAt).toLocaleString()}</span>
            </button>
          ))}
          {!loading && items.length === 0 ? <div className="empty-hint">暂无已发布图纸</div> : null}
        </aside>
        <section className="published-preview">
          {error ? <div className="form-error">{error}</div> : null}
          {snapshot ? (
            <>
              <div className="published-preview-meta">
                <span>版本: v{versionNo}</span>
                <span>实例: {snapshot.instances.length}</span>
                <span>连线: {snapshot.connections.length}</span>
              </div>
              <ReadonlyDiagramPreview snapshot={snapshot} />
            </>
          ) : (
            <div className="empty-hint">{loading ? '加载中...' : '请选择图纸'}</div>
          )}
        </section>
      </div>
    </div>
  );
}
