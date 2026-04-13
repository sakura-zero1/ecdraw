import { useEffect, useState, useCallback, useRef } from 'react';
import {
  createDiagramByApi,
  fetchDiagrams,
  submitDiagramReview,
  type DiagramListItem,
} from '../services/diagramApi';
import { useDiagramStore } from '../stores/useDiagramStore';
import DiagramCanvas from '../components/diagram/DiagramCanvas';
import type { DiagramCanvasHandle } from '../components/diagram/DiagramCanvas';
import ComponentLibraryPanel from '../components/diagram/ComponentLibraryPanel';
import { CATEGORY_LABELS } from '../constants/categories';
import type { DiagramInstance, DiagramEdge } from '../services/diagramApi';
import { fetchDistrictsByDiagram, upsertDistrict, type DistrictData } from '../services/districtApi';
import { fetchLinesByDiagram, upsertLineSegment, type LineSegmentData } from '../services/lineApi';
import { fetchGisByDiagram, upsertGis, type GisData } from '../services/gisApi';
import CollapsibleSection from '../components/panels/CollapsibleSection';
import './DiagramEditorPage.css';

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

// ---------- District Data Panel ----------

function DistrictDataPanel({
  instanceId,
  diagramId,
}: {
  instanceId: string;
  diagramId: string;
}) {
  const [, setDistrict] = useState<DistrictData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [transformerCapacity, setTransformerCapacity] = useState<string>('');
  const [supplyRange, setSupplyRange] = useState('');
  const [supplyArea, setSupplyArea] = useState('');
  const [householdCount, setHouseholdCount] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDistrictsByDiagram(diagramId)
      .then((items) => {
        if (cancelled) return;
        const found = items.find((d) => d.diagramInstanceId === instanceId) || null;
        setDistrict(found);
        if (found) {
          setTransformerCapacity(found.transformerCapacity != null ? String(found.transformerCapacity) : '');
          setSupplyRange(found.supplyRange || '');
          setSupplyArea(found.supplyArea || '');
          setHouseholdCount(found.householdCount != null ? String(found.householdCount) : '');
        } else {
          setTransformerCapacity('');
          setSupplyRange('');
          setSupplyArea('');
          setHouseholdCount('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('加载台区数据失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [instanceId, diagramId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data: Partial<Omit<DistrictData, 'id' | 'diagramInstanceId' | 'updatedBy' | 'createdAt' | 'updatedAt'>> = {
        transformerCapacity: transformerCapacity ? Number(transformerCapacity) : null,
        supplyRange: supplyRange || null,
        supplyArea: supplyArea || null,
        householdCount: householdCount ? Number(householdCount) : null,
      };
      const result = await upsertDistrict(instanceId, data);
      setDistrict(result);
      setMessage('保存成功');
    } catch (e) {
      setMessage(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="de-data-hint">加载中...</div>;

  return (
    <CollapsibleSection title="台区数据">
      <div className="de-data-fields">
        <label className="de-data-field">
          <span>变压器容量 (kVA)</span>
          <input
            type="number"
            value={transformerCapacity}
            onChange={(e) => setTransformerCapacity(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>供电范围</span>
          <input
            value={supplyRange}
            onChange={(e) => setSupplyRange(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>供电区域</span>
          <input
            value={supplyArea}
            onChange={(e) => setSupplyArea(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>供电户数</span>
          <input
            type="number"
            value={householdCount}
            onChange={(e) => setHouseholdCount(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存台区数据'}
        </button>
        {message && <div className={`de-data-msg ${message === '保存成功' ? 'success' : 'error'}`}>{message}</div>}
      </div>
    </CollapsibleSection>
  );
}

// ---------- GIS Data Panel ----------

function GisDataPanel({
  instanceId,
  diagramId,
}: {
  instanceId: string;
  diagramId: string;
}) {
  const [, setGis] = useState<GisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGisByDiagram(diagramId)
      .then((items) => {
        if (cancelled) return;
        const found = items.find((g) => g.diagramInstanceId === instanceId) || null;
        setGis(found);
        if (found) {
          setLatitude(found.latitude != null ? String(found.latitude) : '');
          setLongitude(found.longitude != null ? String(found.longitude) : '');
        } else {
          setLatitude('');
          setLongitude('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('加载地理信息失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [instanceId, diagramId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data: { latitude?: number; longitude?: number } = {};
      if (latitude) data.latitude = Number(latitude);
      if (longitude) data.longitude = Number(longitude);
      const result = await upsertGis(instanceId, data);
      setGis(result);
      setMessage('保存成功');
    } catch (e) {
      setMessage(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="de-data-hint">加载中...</div>;

  return (
    <CollapsibleSection title="地理信息">
      <div className="de-data-fields">
        <label className="de-data-field">
          <span>纬度</span>
          <input
            type="number"
            step="0.000001"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>经度</span>
          <input
            type="number"
            step="0.000001"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存地理数据'}
        </button>
        {message && <div className={`de-data-msg ${message === '保存成功' ? 'success' : 'error'}`}>{message}</div>}
      </div>
    </CollapsibleSection>
  );
}

// ---------- Line Segment Data Panel ----------

function LineDataPanel({
  edgeId,
  diagramId,
}: {
  edgeId: string;
  diagramId: string;
}) {
  const [, setLine] = useState<LineSegmentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [startPole, setStartPole] = useState('');
  const [endPole, setEndPole] = useState('');
  const [length, setLength] = useState<string>('');
  const [wireModel, setWireModel] = useState('');
  const [impedance, setImpedance] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLinesByDiagram(diagramId)
      .then((items) => {
        if (cancelled) return;
        const found = items.find((l) => l.diagramEdgeId === edgeId) || null;
        setLine(found);
        if (found) {
          setStartPole(found.startPole || '');
          setEndPole(found.endPole || '');
          setLength(found.length != null ? String(found.length) : '');
          setWireModel(found.wireModel || '');
          setImpedance(found.impedance != null ? String(found.impedance) : '');
        } else {
          setStartPole('');
          setEndPole('');
          setLength('');
          setWireModel('');
          setImpedance('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('加载线路数据失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [edgeId, diagramId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data: Partial<Omit<LineSegmentData, 'id' | 'diagramEdgeId' | 'updatedBy' | 'createdAt' | 'updatedAt'>> = {
        startPole: startPole || null,
        endPole: endPole || null,
        length: length ? Number(length) : null,
        wireModel: wireModel || null,
        impedance: impedance ? Number(impedance) : null,
      };
      const result = await upsertLineSegment(edgeId, data);
      setLine(result);
      setMessage('保存成功');
    } catch (e) {
      setMessage(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="de-data-hint">加载中...</div>;

  return (
    <CollapsibleSection title="线路台账">
      <div className="de-data-fields">
        <label className="de-data-field">
          <span>起始杆号</span>
          <input
            value={startPole}
            onChange={(e) => setStartPole(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>终止杆号</span>
          <input
            value={endPole}
            onChange={(e) => setEndPole(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>长度 (km)</span>
          <input
            type="number"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>导线型号</span>
          <input
            value={wireModel}
            onChange={(e) => setWireModel(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <label className="de-data-field">
          <span>阻抗 (Ω)</span>
          <input
            type="number"
            step="0.01"
            value={impedance}
            onChange={(e) => setImpedance(e.target.value)}
            placeholder="请输入"
          />
        </label>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存线路数据'}
        </button>
        {message && <div className={`de-data-msg ${message === '保存成功' ? 'success' : 'error'}`}>{message}</div>}
      </div>
    </CollapsibleSection>
  );
}

// ---------- Sub-components ----------

function InstancePropertyPanel({
  instance,
  edges,
  componentMap,
  allInstances,
  onUpdateLabel,
  onRemoveInstance,
  onRemoveEdge,
}: {
  instance: DiagramInstance;
  edges: DiagramEdge[];
  componentMap: Record<string, { name: string; category: string }>;
  allInstances: DiagramInstance[];
  onUpdateLabel: (id: string, label: string) => void;
  onRemoveInstance: (id: string) => void;
  onRemoveEdge: (id: string) => void;
}) {
  const comp = componentMap[instance.componentId];
  const category = comp?.category || 'junctionPoint';
  const categoryName = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] || '未知';

  const connectedEdges = edges.filter(
    (e) => e.sourceInstanceId === instance.id || e.targetInstanceId === instance.id,
  );

  const [editLabel, setEditLabel] = useState(instance.label);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setEditLabel(instance.label);
    setDirty(false);
  }, [instance.id, instance.label]);

  const handleLabelSave = () => {
    if (dirty && editLabel.trim()) {
      onUpdateLabel(instance.id, editLabel.trim());
      setDirty(false);
    }
  };

  // Access diagramId from the store (passed via context would be cleaner, but this works)
  const diagramId = useDiagramStore((s) => s.diagramId);

  return (
    <div className="de-panel-body">
      <div className="de-panel-section">
        <div className="de-panel-section-title">实例属性</div>
        <div className="de-field-group">
          <label>
            <span className="field-label">名称</span>
            <div className="de-field-row">
              <input
                value={editLabel}
                onChange={(e) => {
                  setEditLabel(e.target.value);
                  setDirty(true);
                }}
                onBlur={handleLabelSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLabelSave();
                }}
              />
            </div>
          </label>
        </div>
        <div className="de-field-group">
          <div className="de-info-row">
            <span className="de-info-label">元件</span>
            <span className="de-info-value">{comp?.name || '未知'}</span>
          </div>
          <div className="de-info-row">
            <span className="de-info-label">分类</span>
            <span className="de-info-value">{categoryName}</span>
          </div>
          <div className="de-info-row">
            <span className="de-info-label">位置</span>
            <span className="de-info-value">
              ({Math.round(instance.positionX)}, {Math.round(instance.positionY)})
            </span>
          </div>
        </div>
      </div>

      <div className="de-panel-section">
        <div className="de-panel-section-title">连接 ({connectedEdges.length})</div>
        {connectedEdges.length === 0 && (
          <div className="de-empty-hint">无连接</div>
        )}
        {connectedEdges.map((edge) => {
          const isSource = edge.sourceInstanceId === instance.id;
          const otherId = isSource ? edge.targetInstanceId : edge.sourceInstanceId;
          const otherInst = allInstances.find((i) => i.id === otherId);
          return (
            <div key={edge.id} className="de-conn-item">
              <span className="de-conn-label">
                {isSource ? '→' : '←'} {otherInst?.label || otherId}
              </span>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => onRemoveEdge(edge.id)}
              >
                删除
              </button>
            </div>
          );
        })}
      </div>

      {/* Additional data: District for loadPoint */}
      {diagramId && category === 'loadPoint' && (
        <div className="de-panel-section">
          <DistrictDataPanel instanceId={instance.id} diagramId={diagramId} />
        </div>
      )}

      {/* Additional data: GIS for all instances */}
      {diagramId && (
        <div className="de-panel-section">
          <GisDataPanel instanceId={instance.id} diagramId={diagramId} />
        </div>
      )}

      <div className="de-panel-section">
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={() => onRemoveInstance(instance.id)}
        >
          删除实例
        </button>
      </div>
    </div>
  );
}

// ---------- Edge Property Panel ----------

function EdgePropertyPanel({
  edge,
  instances,
  onRemoveEdge,
}: {
  edge: DiagramEdge;
  instances: DiagramInstance[];
  onRemoveEdge: (id: string) => void;
}) {
  const source = instances.find((i) => i.id === edge.sourceInstanceId);
  const target = instances.find((i) => i.id === edge.targetInstanceId);
  const diagramId = useDiagramStore((s) => s.diagramId);

  return (
    <div className="de-panel-body">
      <div className="de-panel-section">
        <div className="de-panel-section-title">连线属性</div>
        <div className="de-field-group">
          <div className="de-info-row">
            <span className="de-info-label">起始实例</span>
            <span className="de-info-value">{source?.label || edge.sourceInstanceId}</span>
          </div>
          <div className="de-info-row">
            <span className="de-info-label">目标实例</span>
            <span className="de-info-value">{target?.label || edge.targetInstanceId}</span>
          </div>
        </div>
      </div>

      {/* Line segment data */}
      {diagramId && (
        <div className="de-panel-section">
          <LineDataPanel edgeId={edge.id} diagramId={diagramId} />
        </div>
      )}

      <div className="de-panel-section">
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={() => onRemoveEdge(edge.id)}
        >
          删除连线
        </button>
      </div>
    </div>
  );
}

// ---------- Main Page ----------

export default function DiagramEditorPage() {
  const {
    diagramId,
    diagramInfo,
    instances,
    edges,
    componentMap,
    loading,
    error,
    selectedInstanceId,
    selectedEdgeId,
    zoom,
    panX,
    panY,
    loadDiagram,
    addInstance,
    moveInstance,
    persistInstanceMove,
    removeInstance,
    addEdge,
    removeEdge,
    selectInstance,
    selectEdge,
    setZoom,
    setPan,
    clearDiagram,
    undo,
    updateInstanceLabel,
  } = useDiagramStore();

  const [items, setItems] = useState<DiagramListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [newDiagramName, setNewDiagramName] = useState('');

  // Naming dialog state
  const [showNamingDialog, setShowNamingDialog] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [pendingComponentId, setPendingComponentId] = useState<string | null>(null);
  const [pendingDropX, setPendingDropX] = useState(0);
  const [pendingDropY, setPendingDropY] = useState(0);

  const canvasRef = useRef<DiagramCanvasHandle>(null);
  const namingInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const list = await fetchDiagrams();
      setItems(list);
    } catch (e) {
      setListError(parseApiError(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const handleCreate = async () => {
    const trimmed = newDiagramName.trim();
    if (!trimmed) return;
    try {
      await createDiagramByApi(trimmed);
      setNewDiagramName('');
      await loadList();
    } catch (e) {
      setListError(parseApiError(e));
    }
  };

  const handleSubmitReview = async (id: string) => {
    const confirmed = window.confirm('确定要提交审核吗？提交后将无法继续编辑。');
    if (!confirmed) return;

    try {
      await submitDiagramReview(id);
      // If this is the currently open diagram, go back to list
      if (diagramId === id) {
        clearDiagram();
      }
      await loadList();
    } catch (e) {
      setListError(parseApiError(e));
    }
  };

  const handleOpenDiagram = async (id: string) => {
    await loadDiagram(id);
  };

  const handleBackToList = () => {
    clearDiagram();
  };

  // ---------- Pin connection handler ----------

  const handleConnectPins = useCallback(
    async (sourceInstanceId: string, sourcePinId: string, targetInstanceId: string, targetPinId: string) => {
      await addEdge(sourceInstanceId, targetInstanceId, sourcePinId, targetPinId);
    },
    [addEdge],
  );

  // ---------- Drag-and-drop handlers ----------

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const componentId = e.dataTransfer.getData('text/plain');
      if (!componentId) return;

      // Convert screen coords to world coords via the canvas ref
      const worldPos = canvasRef.current?.screenToWorld(e.clientX, e.clientY);
      if (!worldPos) return;

      // Center the instance on the drop point
      const nodeWidth = 140;
      const nodeHeight = 56;
      const dropX = worldPos.x - nodeWidth / 2;
      const dropY = worldPos.y - nodeHeight / 2;

      // Open naming dialog
      setPendingComponentId(componentId);
      setPendingDropX(dropX);
      setPendingDropY(dropY);
      setNewInstanceName('');
      setShowNamingDialog(true);

      // Focus input after dialog opens
      setTimeout(() => namingInputRef.current?.focus(), 50);
    },
    [],
  );

  const handleConfirmPlacement = useCallback(async () => {
    if (!pendingComponentId || !newInstanceName.trim()) return;
    setShowNamingDialog(false);
    await addInstance(pendingComponentId, newInstanceName.trim(), pendingDropX, pendingDropY);
    setPendingComponentId(null);
    setNewInstanceName('');
  }, [pendingComponentId, newInstanceName, pendingDropX, pendingDropY, addInstance]);

  const handleCancelNaming = useCallback(() => {
    setShowNamingDialog(false);
    setPendingComponentId(null);
    setNewInstanceName('');
  }, []);

  // ---------- Keyboard shortcuts ----------

  useEffect(() => {
    if (!diagramId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedInstanceId) {
          void removeInstance(selectedInstanceId);
        } else if (selectedEdgeId) {
          void removeEdge(selectedEdgeId);
        }
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }

      if (e.key === 'Escape') {
        selectInstance(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [diagramId, selectedInstanceId, selectedEdgeId, removeInstance, removeEdge, undo, selectInstance]);

  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null;

  const selectedEdge = selectedEdgeId
    ? edges.find((e) => e.id === selectedEdgeId) ?? null
    : null;

  // Filter diagrams: show user's DRAFT and REJECTED ones for editing
  const editableDiagrams = items.filter(
    (d) => d.status === 'DRAFT' || d.status === 'REJECTED',
  );

  // ---- Render: Diagram Editor (canvas open) ----
  if (diagramId) {
    return (
      <div className="de-editor-layout">
        {/* Top bar */}
        <div className="de-topbar">
          <div className="de-topbar-left">
            <button className="btn btn-sm" onClick={handleBackToList}>
              ← 返回
            </button>
            <span className="de-topbar-title">
              {diagramInfo?.name || '未命名图纸'}
            </span>
            <span className={`review-status ${String(diagramInfo?.status).toLowerCase()}`}>
              {diagramInfo?.status || ''}
            </span>
          </div>
          <div className="de-topbar-right">
            <span className="de-zoom-label">缩放: {Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={undo}>撤销</button>
            {diagramInfo?.status === 'DRAFT' || diagramInfo?.status === 'REJECTED' ? (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void handleSubmitReview(diagramId)}
              >
                提交审核
              </button>
            ) : null}
          </div>
        </div>

        {/* Left panel: Component Library */}
        <div className="de-left-panel">
          <ComponentLibraryPanel />
        </div>

        {/* Center: Canvas (drop target) */}
        <div
          className="de-main-area"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          {loading ? (
            <div className="de-empty-center">加载中...</div>
          ) : (
            <DiagramCanvas
              ref={canvasRef}
              instances={instances}
              edges={edges}
              componentMap={componentMap}
              selectedInstanceId={selectedInstanceId}
              selectedEdgeId={selectedEdgeId}
              zoom={zoom}
              panX={panX}
              panY={panY}
              onSelectInstance={selectInstance}
              onSelectEdge={selectEdge}
              onMoveInstance={moveInstance}
              onPersistInstanceMove={persistInstanceMove}
              onSetZoom={setZoom}
              onSetPan={setPan}
              onConnectPins={handleConnectPins}
            />
          )}
        </div>

        {/* Right panel: Instance/Edge properties */}
        <div className="de-right-panel">
          <div className="de-panel-top">
            <span className="de-panel-title">
              {selectedInstance ? '实例属性' : selectedEdge ? '连线属性' : '属性面板'}
            </span>
          </div>
          {selectedInstance ? (
            <InstancePropertyPanel
              instance={selectedInstance}
              edges={edges}
              componentMap={componentMap}
              allInstances={instances}
              onUpdateLabel={updateInstanceLabel}
              onRemoveInstance={(id) => void removeInstance(id)}
              onRemoveEdge={(id) => void removeEdge(id)}
            />
          ) : selectedEdge ? (
            <EdgePropertyPanel
              edge={selectedEdge}
              instances={instances}
              onRemoveEdge={(id) => void removeEdge(id)}
            />
          ) : (
            <div className="de-empty-hint">
              {instances.length === 0 ? '暂无实例' : '点击节点查看属性'}
            </div>
          )}
        </div>

        {/* Naming dialog */}
        {showNamingDialog && (
          <div className="dialog-overlay" onClick={handleCancelNaming}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <h3>命名实例</h3>
              <label>
                实例名称（必填）
                <input
                  ref={namingInputRef}
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newInstanceName.trim()) {
                      void handleConfirmPlacement();
                    }
                    if (e.key === 'Escape') {
                      handleCancelNaming();
                    }
                  }}
                  placeholder="例如：1号变压器"
                  autoFocus
                />
              </label>
              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={handleCancelNaming}>取消</button>
                <button
                  className="btn btn-primary"
                  disabled={!newInstanceName.trim()}
                  onClick={() => void handleConfirmPlacement()}
                >
                  放置
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && <div className="de-error-toast">{error}</div>}
      </div>
    );
  }

  // ---- Render: Diagram list (no canvas open) ----
  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸编辑</h3>
      </div>

      <div className="card">
        <div className="form-row">
          <input
            value={newDiagramName}
            onChange={(e) => setNewDiagramName(e.target.value)}
            placeholder="新建图纸名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
          />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            新建图纸
          </button>
        </div>
      </div>

      {listError ? <div className="form-error">{listError}</div> : null}

      <div className="review-list">
        {listLoading && <div className="empty-hint">加载中...</div>}
        {!listLoading && editableDiagrams.length === 0 && (
          <div className="empty-hint">暂无可编辑图纸</div>
        )}
        {editableDiagrams.map((item) => (
          <div key={item.id} className="review-item">
            <div className="review-item-top">
              <strong>{item.name}</strong>
              <span className={`review-status ${String(item.status).toLowerCase()}`}>
                {item.status}
              </span>
            </div>
            <div className="review-meta">
              <span>更新时间: {new Date(item.updatedAt).toLocaleString()}</span>
            </div>
            <div className="review-actions">
              <span />
              <button
                className="btn btn-sm"
                onClick={() => void handleOpenDiagram(item.id)}
              >
                编辑
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void handleSubmitReview(item.id)}
              >
                提交审核
              </button>
              <span />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
