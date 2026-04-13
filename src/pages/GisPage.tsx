import { useEffect, useState, useCallback } from 'react';
import {
  fetchPublishedDiagrams,
  fetchDiagramReadonlySnapshot,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../services/diagramApi';
import { fetchGisByDiagram, upsertGis, type GisData } from '../services/gisApi';

function parseApiError(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function GisPage() {
  const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<DiagramSnapshot | null>(null);
  const [gisMap, setGisMap] = useState<Record<string, GisData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    latitude: '',
    longitude: '',
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Load published diagrams
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const list = await fetchPublishedDiagrams();
        if (cancelled) return;
        setDiagrams(list);
        setSelectedId((prev) => prev || list[0]?.id || '');
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // On diagram select: fetch snapshot + gis data
  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      setGisMap({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [detail, gisList] = await Promise.all([
          fetchDiagramReadonlySnapshot(selectedId),
          fetchGisByDiagram(selectedId),
        ]);
        if (cancelled) return;
        setSnapshot(detail.snapshot);
        const map: Record<string, GisData> = {};
        for (const g of gisList) {
          map[g.diagramInstanceId] = g;
        }
        setGisMap(map);
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }, []);

  const startEdit = (instanceId: string) => {
    const existing = gisMap[instanceId];
    setEditForm({
      latitude: existing?.latitude != null ? String(existing.latitude) : '',
      longitude: existing?.longitude != null ? String(existing.longitude) : '',
    });
    setEditingId(instanceId);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleSave = async (instanceId: string) => {
    setSaving(true);
    setError('');
    try {
      const data = {
        latitude: editForm.latitude ? Number(editForm.latitude) : undefined,
        longitude: editForm.longitude ? Number(editForm.longitude) : undefined,
      };
      const updated = await upsertGis(instanceId, data);
      setGisMap((prev) => ({ ...prev, [instanceId]: updated }));
      setEditingId(null);
      showToast('保存成功');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const instances = snapshot?.instances ?? [];

  return (
    <div className="workspace-page">
      <div className="page-head"><h3>地理信息维护</h3></div>
      <div className="published-layout">
        <aside className="published-list">
          {diagrams.map((item) => (
            <button
              key={item.id}
              className={`published-item ${selectedId === item.id ? 'active' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{new Date(item.updatedAt).toLocaleString()}</span>
            </button>
          ))}
          {!loading && diagrams.length === 0 && <div className="empty-hint">暂无已发布图纸</div>}
        </aside>
        <section className="published-preview">
          {error && <div className="form-error">{error}</div>}
          {toast && (
            <div style={{
              position: 'fixed', top: 16, right: 16, zIndex: 9999,
              background: '#10b981', color: '#fff', padding: '8px 18px',
              borderRadius: 8, fontSize: 13, fontWeight: 600,
            }}>
              {toast}
            </div>
          )}
          {!selectedId ? (
            <div className="empty-hint">请选择图纸</div>
          ) : loading ? (
            <div className="empty-hint">加载中...</div>
          ) : instances.length === 0 ? (
            <div className="empty-hint">该图纸暂无实例</div>
          ) : (
            <div style={{ padding: 12 }}>
              <div className="published-preview-meta">
                <span>实例总数: {instances.length}</span>
                <span>已录入坐标: {Object.keys(gisMap).length}</span>
              </div>
              <table className="matrix-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>实例名称</th>
                    <th>纬度 (Latitude)</th>
                    <th>经度 (Longitude)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => {
                    const gis = gisMap[inst.id];
                    const isEditing = editingId === inst.id;
                    return (
                      <tr key={inst.id}>
                        <td style={{ textAlign: 'left', minWidth: 80 }}>{inst.label || '(未命名)'}</td>
                        {isEditing ? (
                          <>
                            <td>
                              <input
                                type="number"
                                step="any"
                                value={editForm.latitude}
                                onChange={(e) => setEditForm((f) => ({ ...f, latitude: e.target.value }))}
                                placeholder="纬度"
                                style={{ width: 120, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                value={editForm.longitude}
                                onChange={(e) => setEditForm((f) => ({ ...f, longitude: e.target.value }))}
                                placeholder="经度"
                                style={{ width: 120, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={saving}
                                onClick={() => void handleSave(inst.id)}
                              >
                                {saving ? '保存中...' : '保存'}
                              </button>
                              <button className="btn btn-sm" onClick={cancelEdit} style={{ marginLeft: 4 }}>
                                取消
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{gis?.latitude ?? '-'}</td>
                            <td>{gis?.longitude ?? '-'}</td>
                            <td>
                              <button className="btn btn-sm btn-primary" onClick={() => startEdit(inst.id)}>
                                编辑
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
