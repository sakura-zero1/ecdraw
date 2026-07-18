import { useEffect, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  fetchPublishedDiagrams,
  fetchDiagramReadonlySnapshot,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../services/diagramApi';
import { fetchDistrictsByDiagram, upsertDistrict, batchUpsertDistricts, type DistrictData } from '../services/districtApi';
import { fetchComponentLibrary } from '../services/componentApi';
import { parseError } from '../utils/parseError';

function parseApiError(error: unknown) {
  return parseError(error);
}

export default function DistrictPage() {
  const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<DiagramSnapshot | null>(null);
  const [districtMap, setDistrictMap] = useState<Record<string, DistrictData>>({});
  // componentId → category，用于筛出「台区=负荷点」实例
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  // componentId → electrical.role（国标种子库元件的语义声明）
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    transformerCapacity: '',
    supplyRange: '',
    supplyArea: '',
    householdCount: '',
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

  // Load component library once → build componentId→category map（台区只取负荷点元件）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { components } = await fetchComponentLibrary();
        if (cancelled) return;
        const map: Record<string, string> = {};
        const roles: Record<string, string> = {};
        for (const c of components) {
          map[c.id] = c.category;
          if (c.electrical?.role) roles[c.id] = c.electrical.role;
        }
        setCategoryMap(map);
        setRoleMap(roles);
      } catch {
        // 分类映射拉取失败不阻断页面
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // On diagram select: fetch snapshot + district data
  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      setDistrictMap({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [detail, districts] = await Promise.all([
          fetchDiagramReadonlySnapshot(selectedId),
          fetchDistrictsByDiagram(selectedId),
        ]);
        if (cancelled) return;
        setSnapshot(detail.snapshot);
        const map: Record<string, DistrictData> = {};
        for (const d of districts) {
          map[d.diagramInstanceId] = d;
        }
        setDistrictMap(map);
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
    const existing = districtMap[instanceId];
    setEditForm({
      transformerCapacity: existing?.transformerCapacity != null ? String(existing.transformerCapacity) : '',
      supplyRange: existing?.supplyRange ?? '',
      supplyArea: existing?.supplyArea ?? '',
      householdCount: existing?.householdCount != null ? String(existing.householdCount) : '',
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
        transformerCapacity: editForm.transformerCapacity ? Number(editForm.transformerCapacity) : null,
        supplyRange: editForm.supplyRange || null,
        supplyArea: editForm.supplyArea || null,
        householdCount: editForm.householdCount ? Number(editForm.householdCount) : null,
      };
      const updated = await upsertDistrict(instanceId, data);
      setDistrictMap((prev) => ({ ...prev, [instanceId]: updated }));
      setEditingId(null);
      showToast('保存成功');
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const instances = snapshot?.instances ?? [];
  // 台区 = 负荷点元件：分类为 loadPoint，或电气语义声明 role=load（国标种子库配变）
  const districtInstances = instances.filter(
    (inst) => categoryMap[inst.componentId] === 'loadPoint' || roleMap[inst.componentId] === 'load',
  );

  const diagramName = diagrams.find((d) => d.id === selectedId)?.name ?? '图纸';

  const handleExport = () => {
    const rows = districtInstances.map((inst) => {
      const district = districtMap[inst.id];
      return {
        '实例名称': inst.label || '(未命名)',
        '实例ID': inst.id,
        '变压器容量(kVA)': district?.transformerCapacity ?? '',
        '供电范围': district?.supplyRange ?? '',
        '供电面积(m²)': district?.supplyArea ?? '',
        '供电户数': district?.householdCount ?? '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '台区数据');
    XLSX.writeFile(wb, `${diagramName}_台区数据.xlsx`);
  };

  const handleImport = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as Record<string, string>[];

      const labelToId = new Map<string, string>();
      for (const inst of districtInstances) {
        labelToId.set(inst.label, inst.id);
      }

      const items: Array<{
        diagramInstanceId: string;
        transformerCapacity?: number | null;
        supplyRange?: string | null;
        supplyArea?: string | null;
        householdCount?: number | null;
      }> = [];

      for (const row of rows) {
        const label = row['实例名称'];
        const id = labelToId.get(label) || row['实例ID'];
        if (!id) continue;
        items.push({
          diagramInstanceId: id,
          transformerCapacity: row['变压器容量(kVA)'] != null && row['变压器容量(kVA)'] !== '' ? Number(row['变压器容量(kVA)']) : null,
          supplyRange: row['供电范围'] || null,
          supplyArea: row['供电面积(m²)'] || null,
          householdCount: row['供电户数'] != null && row['供电户数'] !== '' ? Number(row['供电户数']) : null,
        });
      }

      if (items.length === 0) {
        setError('未找到匹配的数据行');
        return;
      }

      await batchUpsertDistricts(items);
      // Refresh district data
      const districts = await fetchDistrictsByDiagram(selectedId);
      const map: Record<string, DistrictData> = {};
      for (const d of districts) {
        map[d.diagramInstanceId] = d;
      }
      setDistrictMap(map);
      showToast(`成功导入 ${items.length} 条台区数据`);
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  return (
    <div className="workspace-page">
      <div className="page-head"><h3>台区数据维护</h3></div>
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
          ) : districtInstances.length === 0 ? (
            <div className="empty-hint">该图纸暂无台区（负荷点）元件</div>
          ) : (
            <div style={{ padding: 12 }}>
              <div className="published-preview-meta">
                <span>台区总数（负荷点）: {districtInstances.length}</span>
                <span>已录入台区数据: {Object.keys(districtMap).length}</span>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button className="btn btn-sm" onClick={handleExport} disabled={districtInstances.length === 0}>
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
                    <th>实例名称</th>
                    <th>变压器容量 (kVA)</th>
                    <th>供电范围</th>
                    <th>供电面积 (m2)</th>
                    <th>户数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {districtInstances.map((inst) => {
                    const district = districtMap[inst.id];
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
                                value={editForm.transformerCapacity}
                                onChange={(e) => setEditForm((f) => ({ ...f, transformerCapacity: e.target.value }))}
                                placeholder="容量"
                                style={{ width: 80, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.supplyRange}
                                onChange={(e) => setEditForm((f) => ({ ...f, supplyRange: e.target.value }))}
                                placeholder="范围"
                                style={{ width: 80, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                value={editForm.supplyArea}
                                onChange={(e) => setEditForm((f) => ({ ...f, supplyArea: e.target.value }))}
                                placeholder="面积"
                                style={{ width: 80, fontSize: 12 }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                value={editForm.householdCount}
                                onChange={(e) => setEditForm((f) => ({ ...f, householdCount: e.target.value }))}
                                placeholder="户数"
                                style={{ width: 60, fontSize: 12 }}
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
                            <td>{district?.transformerCapacity ?? '-'}</td>
                            <td>{district?.supplyRange ?? '-'}</td>
                            <td>{district?.supplyArea ?? '-'}</td>
                            <td>{district?.householdCount ?? '-'}</td>
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
