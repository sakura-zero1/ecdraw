import { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchPublishedDiagrams,
  fetchDiagramReadonlySnapshot,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../services/diagramApi';
import { fetchLinesByDiagram, upsertLineSegment, batchUpsertLineSegments, type LineSegmentData, type WireOwnership, type WireType } from '../services/lineApi';

function parseApiError(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

const WIRE_OWNERSHIP_LABELS: Record<string, string> = { user: '用户', public: '公用' };
const WIRE_TYPE_LABELS: Record<string, string> = { overhead: '架空', cable: '电缆' };

export default function LinePage() {
  const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<DiagramSnapshot | null>(null);
  const [lineSegments, setLineSegments] = useState<LineSegmentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    length: '',
    wireModel: '',
    wireOwnership: '' as WireOwnership | '',
    wireType: '' as WireType | '',
    isMainDisplay: false,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

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

  const instanceLabelMap: Record<string, string> = {};
  if (snapshot?.instances) {
    for (const inst of snapshot.instances) {
      instanceLabelMap[inst.id] = inst.label || '(未命名)';
    }
  }

  const startEdit = (edgeId: string) => {
    const existing = lineSegments.find((l) => l.diagramEdgeId === edgeId);
    setEditForm({
      length: existing?.length != null ? String(existing.length) : '',
      wireModel: existing?.wireModel ?? '',
      wireOwnership: existing?.wireOwnership ?? '',
      wireType: existing?.wireType ?? '',
      isMainDisplay: existing?.isMainDisplay ?? false,
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
        length: editForm.length ? Number(editForm.length) : null,
        wireModel: editForm.wireModel || null,
        wireOwnership: editForm.wireOwnership || null,
        wireType: editForm.wireType || null,
        isMainDisplay: editForm.isMainDisplay,
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

  const allEdges: { edgeId: string; sourceId: string; targetId: string; data: LineSegmentData | null }[] = [];

  for (const seg of lineSegments) {
    allEdges.push({
      edgeId: seg.diagramEdgeId,
      sourceId: seg.diagramEdge?.sourceInstanceId ?? '',
      targetId: seg.diagramEdge?.targetInstanceId ?? '',
      data: seg,
    });
  }

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

  const diagramName = diagrams.find((d) => d.id === selectedId)?.name ?? '图纸';

  const handleExport = () => {
    const rows = allEdges.map((edge) => {
      const sourceLabel = instanceLabelMap[edge.sourceId] || edge.sourceId.slice(-6);
      const targetLabel = instanceLabelMap[edge.targetId] || edge.targetId.slice(-6);
      return {
        '起点名称': sourceLabel,
        '终点名称': targetLabel,
        '线路ID': edge.edgeId,
        '长度(km)': edge.data?.length ?? '',
        '导线型号': edge.data?.wireModel ?? '',
        '导线产权': edge.data?.wireOwnership ? WIRE_OWNERSHIP_LABELS[edge.data.wireOwnership] ?? edge.data.wireOwnership : '',
        '导线类型': edge.data?.wireType ? WIRE_TYPE_LABELS[edge.data.wireType] ?? edge.data.wireType : '',
        '是否主显示': edge.data?.isMainDisplay ? '是' : '否',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '线路数据');
    XLSX.writeFile(wb, `${diagramName}_线路数据.xlsx`);
  };

  const handleImport = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as Record<string, string>[];

      const ownershipReverse: Record<string, WireOwnership> = { '用户': 'user', '公用': 'public' };
      const typeReverse: Record<string, WireType> = { '架空': 'overhead', '电缆': 'cable' };

      const items: Array<{
        diagramEdgeId: string;
        length?: number | null;
        wireModel?: string | null;
        wireOwnership?: WireOwnership | null;
        wireType?: WireType | null;
        isMainDisplay?: boolean | null;
      }> = [];

      const edgeIdSet = new Set(allEdges.map((e) => e.edgeId));

      for (const row of rows) {
        const edgeId = row['线路ID'];
        if (!edgeId || !edgeIdSet.has(edgeId)) continue;
        const ownershipVal = row['导线产权'];
        const typeVal = row['导线类型'];
        const mainDisplayVal = row['是否主显示'];
        items.push({
          diagramEdgeId: edgeId,
          length: row['长度(km)'] != null && row['长度(km)'] !== '' ? Number(row['长度(km)']) : null,
          wireModel: row['导线型号'] || null,
          wireOwnership: (ownershipReverse[ownershipVal] || ownershipVal || null) as WireOwnership | null,
          wireType: (typeReverse[typeVal] || typeVal || null) as WireType | null,
          isMainDisplay: mainDisplayVal === '是' ? true : mainDisplayVal === '否' ? false : null,
        });
      }

      if (items.length === 0) {
        setError('未找到匹配的数据行');
        return;
      }

      await batchUpsertLineSegments(items);
      const lines = await fetchLinesByDiagram(selectedId);
      setLineSegments(lines);
      showToast(`成功导入 ${items.length} 条线路数据`);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

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
            <div className="toast">
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
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button className="btn btn-sm" onClick={handleExport} disabled={allEdges.length === 0}>
                    导出 Excel
                  </button>
                  <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
                    导入 Excel
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleImport(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
              <table className="matrix-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>起点</th>
                    <th>终点</th>
                    <th>长度 (km)</th>
                    <th>导线型号</th>
                    <th>导线产权</th>
                    <th>导线类型</th>
                    <th>主显示</th>
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
                              <select
                                value={editForm.wireOwnership}
                                onChange={(e) => setEditForm((f) => ({ ...f, wireOwnership: e.target.value as WireOwnership | '' }))}
                                style={{ width: 70, fontSize: 12 }}
                              >
                                <option value="">请选择</option>
                                <option value="user">用户</option>
                                <option value="public">公用</option>
                              </select>
                            </td>
                            <td>
                              <select
                                value={editForm.wireType}
                                onChange={(e) => setEditForm((f) => ({ ...f, wireType: e.target.value as WireType | '' }))}
                                style={{ width: 70, fontSize: 12 }}
                              >
                                <option value="">请选择</option>
                                <option value="overhead">架空</option>
                                <option value="cable">电缆</option>
                              </select>
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={editForm.isMainDisplay}
                                onChange={(e) => setEditForm((f) => ({ ...f, isMainDisplay: e.target.checked }))}
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
                            <td>{edge.data?.length ?? '-'}</td>
                            <td>{edge.data?.wireModel ?? '-'}</td>
                            <td>{edge.data?.wireOwnership ? WIRE_OWNERSHIP_LABELS[edge.data.wireOwnership] ?? edge.data.wireOwnership : '-'}</td>
                            <td>{edge.data?.wireType ? WIRE_TYPE_LABELS[edge.data.wireType] ?? edge.data.wireType : '-'}</td>
                            <td>{edge.data?.isMainDisplay ? '是' : '否'}</td>
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
