import { useEffect, useState, useCallback } from 'react';
import {
  fetchPublishedDiagrams,
  fetchDiagramReadonlySnapshot,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../services/diagramApi';
import { fetchLinesByDiagram, upsertLineSegment, type LineSegmentData } from '../services/lineApi';

function parseApiError(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function LinePage() {
  const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<DiagramSnapshot | null>(null);
  const [lineSegments, setLineSegments] = useState<LineSegmentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    startPole: '',
    endPole: '',
    length: '',
    wireModel: '',
    impedance: '',
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

  // On diagram select: fetch snapshot + line data
  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      setLineSegments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [detail, lines] = await Promise.all([
          fetchDiagramReadonlySnapshot(selectedId),
          fetchLinesByDiagram(selectedId),
        ]);
        if (cancelled) return;
        setSnapshot(detail.snapshot);
        setLineSegments(lines);
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

  // Build instance label lookup from snapshot
  const instanceLabelMap: Record<string, string> = {};
  if (snapshot?.instances) {
    for (const inst of snapshot.instances) {
      instanceLabelMap[inst.id] = inst.label || '(未命名)';
    }
  }

  const startEdit = (edgeId: string) => {
    const existing = lineSegments.find((l) => l.diagramEdgeId === edgeId);
    setEditForm({
      startPole: existing?.startPole ?? '',
      endPole: existing?.endPole ?? '',
      length: existing?.length != null ? String(existing.length) : '',
      wireModel: existing?.wireModel ?? '',
      impedance: existing?.impedance != null ? String(existing.impedance) : '',
    });
    setEditingEdgeId(edgeId);
  };

  const cancelEdit = () => {
    setEditingEdgeId(null);
  };

  const handleSave = async (edgeId: string) => {
    setSaving(true);
    setError('');
    try {
      const data = {
        startPole: editForm.startPole || null,
        endPole: editForm.endPole || null,
        length: editForm.length ? Number(editForm.length) : null,
        wireModel: editForm.wireModel || null,
        impedance: editForm.impedance ? Number(editForm.impedance) : null,
      };
      const updated = await upsertLineSegment(edgeId, data);
      setLineSegments((prev) =>
        prev.some((l) => l.diagramEdgeId === edgeId)
          ? prev.map((l) => (l.diagramEdgeId === edgeId ? updated : l))
          : [...prev, updated],
      );
      setEditingEdgeId(null);
      showToast('保存成功');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  // Collect edges from line segments data (they come with diagramEdge info)
  // Also include edges from snapshot connections that may not have line data yet
  const allEdges: { edgeId: string; sourceId: string; targetId: string; data: LineSegmentData | null }[] = [];

  for (const seg of lineSegments) {
    allEdges.push({
      edgeId: seg.diagramEdgeId,
      sourceId: seg.diagramEdge?.sourceInstanceId ?? '',
      targetId: seg.diagramEdge?.targetInstanceId ?? '',
      data: seg,
    });
  }

  // Add snapshot connections that don't have line data yet
  const edgeIdSet = new Set(allEdges.map((e) => e.edgeId));
  for (const conn of snapshot?.connections ?? []) {
    if (!edgeIdSet.has(conn.id)) {
      allEdges.push({
        edgeId: conn.id,
        sourceId: conn.fromInstanceId,
        targetId: conn.toInstanceId,
        data: lineSegments.find((l) => l.diagramEdgeId === conn.id) ?? null,
      });
      edgeIdSet.add(conn.id);
    }
  }

  return (
    <div className="workspace-page">
      <div className="page-head"><h3>线路台账维护</h3></div>
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
          ) : allEdges.length === 0 ? (
            <div className="empty-hint">该图纸暂无线路数据</div>
          ) : (
            <div style={{ padding: 12 }}>
              <div className="published-preview-meta">
                <span>线路总数: {allEdges.length}</span>
                <span>已录入台账: {lineSegments.length}</span>
              </div>
              <table className="matrix-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>起点</th>
                    <th>终点</th>
                    <th>起始杆号</th>
                    <th>终止杆号</th>
                    <th>长度 (m)</th>
                    <th>导线型号</th>
                    <th>阻抗 (Ohm)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allEdges.map((edge) => {
                    const isEditing = editingEdgeId === edge.edgeId;
                    const sourceLabel = instanceLabelMap[edge.sourceId] || edge.sourceId.slice(-6);
                    const targetLabel = instanceLabelMap[edge.targetId] || edge.targetId.slice(-6);
                    return (
                      <tr key={edge.edgeId}>
                        <td style={{ textAlign: 'left' }}>{sourceLabel}</td>
                        <td style={{ textAlign: 'left' }}>{targetLabel}</td>
                        {isEditing ? (
                          <>
                            <td>
                              <input
                                type="text"
                                value={editForm.startPole}
                                onChange={(e) => setEditForm((f) => ({ ...f, startPole: e.target.value }))}
                                placeholder="起始杆号"
                                style={{ width: 70, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.endPole}
                                onChange={(e) => setEditForm((f) => ({ ...f, endPole: e.target.value }))}
                                placeholder="终止杆号"
                                style={{ width: 70, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                value={editForm.length}
                                onChange={(e) => setEditForm((f) => ({ ...f, length: e.target.value }))}
                                placeholder="长度"
                                style={{ width: 60, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.wireModel}
                                onChange={(e) => setEditForm((f) => ({ ...f, wireModel: e.target.value }))}
                                placeholder="导线型号"
                                style={{ width: 80, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="any"
                                value={editForm.impedance}
                                onChange={(e) => setEditForm((f) => ({ ...f, impedance: e.target.value }))}
                                placeholder="阻抗"
                                style={{ width: 60, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <button
                                className="btn btn-sm btn-primary"
                                disabled={saving}
                                onClick={() => void handleSave(edge.edgeId)}
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
                            <td>{edge.data?.startPole ?? '-'}</td>
                            <td>{edge.data?.endPole ?? '-'}</td>
                            <td>{edge.data?.length ?? '-'}</td>
                            <td>{edge.data?.wireModel ?? '-'}</td>
                            <td>{edge.data?.impedance ?? '-'}</td>
                            <td>
                              <button className="btn btn-sm btn-primary" onClick={() => startEdit(edge.edgeId)}>
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
