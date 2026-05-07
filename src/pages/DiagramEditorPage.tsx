import { useEffect, useState, useCallback, useRef } from 'react';
import {
  createDiagramByApi,
  fetchDiagrams,
  submitDiagramReview,
  updateDiagram,
  duplicateDiagram,
  requestDeleteDiagram,
  deleteDiagram,
  type DiagramListItem,
  type DiagramStatus,
} from '../services/diagramApi';
import { useDiagramStore } from '../stores/useDiagramStore';
import DiagramCanvas from '../components/diagram/DiagramCanvas';
import type { DiagramCanvasHandle } from '../components/diagram/DiagramCanvas';
import ComponentLibraryPanel from '../components/diagram/ComponentLibraryPanel';
import { CATEGORY_LABELS } from '../constants/categories';
import type { DiagramInstance, DiagramEdge } from '../services/diagramApi';
import type { ConnectivityMatrix } from '../types/connection';
import type { Pin } from '../types';
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
  onLineDataChanged,
}: {
  edgeId: string;
  diagramId: string;
  onLineDataChanged?: () => void;
}) {
  const [, setLine] = useState<LineSegmentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [length, setLength] = useState<string>('');
  const [wireModel, setWireModel] = useState('');
  const [wireOwnership, setWireOwnership] = useState<'user' | 'public' | ''>('');
  const [wireType, setWireType] = useState<'overhead' | 'cable' | ''>('');
  const [isMainDisplay, setIsMainDisplay] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLinesByDiagram(diagramId)
      .then((items) => {
        if (cancelled) return;
        const found = items.find((l) => l.diagramEdgeId === edgeId) || null;
        setLine(found);
        if (found) {
          setLength(found.length != null ? String(found.length) : '');
          setWireModel(found.wireModel || '');
          setWireOwnership(found.wireOwnership || '');
          setWireType(found.wireType || '');
          setIsMainDisplay(found.isMainDisplay ?? false);
        } else {
          setLength('');
          setWireModel('');
          setWireOwnership('');
          setWireType('');
          setIsMainDisplay(false);
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
        length: length ? Number(length) : null,
        wireModel: wireModel || null,
        wireOwnership: wireOwnership || null,
        wireType: wireType || null,
        isMainDisplay,
      };
      await upsertLineSegment(edgeId, data);

      const items = await fetchLinesByDiagram(diagramId);
      const found = items.find((l) => l.diagramEdgeId === edgeId) || null;
      setLine(found);
      if (found) {
        setLength(found.length != null ? String(found.length) : '');
        setWireModel(found.wireModel || '');
        setWireOwnership(found.wireOwnership || '');
        setWireType(found.wireType || '');
        setIsMainDisplay(found.isMainDisplay ?? false);
      }

      const savedOk =
        (found?.length ?? null) === (data.length ?? null) &&
        (found?.wireModel ?? null) === (data.wireModel ?? null) &&
        (found?.wireOwnership ?? null) === (data.wireOwnership ?? null) &&
        (found?.wireType ?? null) === (data.wireType ?? null) &&
        (found?.isMainDisplay ?? false) === (data.isMainDisplay ?? false);

      if (savedOk) {
        setMessage('保存成功');
      } else {
        setMessage('保存可能未完全生效，部分字段未被后端识别');
      }
      onLineDataChanged?.();
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
          <span>长度 (km)</span>
          <input
            type="number"
            step="0.01"
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
          <span>导线产权</span>
          <select
            value={wireOwnership}
            onChange={(e) => setWireOwnership(e.target.value as 'user' | 'public' | '')}
          >
            <option value="">请选择</option>
            <option value="user">用户</option>
            <option value="public">公用</option>
          </select>
        </label>
        <label className="de-data-field">
          <span>导线类型</span>
          <select
            value={wireType}
            onChange={(e) => setWireType(e.target.value as 'overhead' | 'cable' | '')}
          >
            <option value="">请选择</option>
            <option value="overhead">架空</option>
            <option value="cable">电缆</option>
          </select>
        </label>
        <label className="de-data-field de-data-field-row">
          <span>是否主显示</span>
          <input
            type="checkbox"
            checked={isMainDisplay}
            onChange={(e) => setIsMainDisplay(e.target.checked)}
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

function TransformControls({ instanceId, instanceData }: { instanceId: string; instanceData: Record<string, unknown> }) {
  const updateTransform = useDiagramStore((s) => s.updateInstanceTransform);
  const data = instanceData as { rotation?: number; flipH?: boolean; flipV?: boolean };
  const rotation = data.rotation ?? 0;
  const flipH = !!data.flipH;
  const flipV = !!data.flipV;

  const [angleText, setAngleText] = useState(String(rotation));
  const [angleDirty, setAngleDirty] = useState(false);

  // Sync local state when rotation prop changes
  const [prevRotation, setPrevRotation] = useState(rotation);
  if (prevRotation !== rotation) {
    setAngleText(String(rotation));
    setAngleDirty(false);
    setPrevRotation(rotation);
  }

  const rotate = (deg: number) => {
    updateTransform(instanceId, { rotation: (rotation + deg + 360) % 360 });
  };

  const toggleFlipH = () => {
    updateTransform(instanceId, { flipH: !flipH });
  };

  const toggleFlipV = () => {
    updateTransform(instanceId, { flipV: !flipV });
  };

  const applyAngle = () => {
    if (!angleDirty) return;
    const n = Number(angleText);
    if (!Number.isNaN(n)) {
      updateTransform(instanceId, { rotation: ((n % 360) + 360) % 360 });
    } else {
      setAngleText(String(rotation));
      setAngleDirty(false);
    }
  };

  return (
    <>
      <div className="de-field-group">
        <div className="de-transform-row">
          <button className="btn btn-sm" onClick={() => rotate(-90)} title="左转90°">↺ 90°</button>
          <button className="btn btn-sm" onClick={() => rotate(90)} title="右转90°">↻ 90°</button>
        </div>
        <div className="de-transform-row">
          <button className={`btn btn-sm${flipH ? ' active' : ''}`} onClick={toggleFlipH} title="水平翻转">水平翻转</button>
          <button className={`btn btn-sm${flipV ? ' active' : ''}`} onClick={toggleFlipV} title="垂直翻转">垂直翻转</button>
        </div>
      </div>
      <div className="de-field-group">
        <label>
          <span className="field-label">角度</span>
          <div className="de-field-row">
            <input
              type="number"
              value={angleText}
              onChange={(e) => { setAngleText(e.target.value); setAngleDirty(true); }}
              onBlur={applyAngle}
              onKeyDown={(e) => { if (e.key === 'Enter') applyAngle(); }}
              style={{ width: 80 }}
            />
            <span style={{ marginLeft: 4, color: 'var(--color-text-dim)', fontSize: 12 }}>°</span>
          </div>
        </label>
      </div>
    </>
  );
}

function InstancePropertyPanel({
  instance,
  edges,
  componentMap,
  componentConnections,
  allInstances,
  onUpdateLabel,
  onRemoveInstance,
  onRemoveEdge,
  onUpdateConnectionLabel,
}: {
  instance: DiagramInstance;
  edges: DiagramEdge[];
  componentMap: Record<string, { name: string; category: string; pins?: Pin[] }>;
  componentConnections: Record<string, ConnectivityMatrix>;
  allInstances: DiagramInstance[];
  onUpdateLabel: (id: string, label: string) => void;
  onRemoveInstance: (id: string) => void;
  onRemoveEdge: (id: string) => void;
  onUpdateConnectionLabel: (instanceId: string, connId: string, data: { name?: string; visible?: boolean }) => void;
}) {
  const comp = componentMap[instance.componentId];
  const category = comp?.category || 'junctionPoint';
  const categoryName = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] || '未知';

  const connectedEdges = edges.filter(
    (e) => e.sourceInstanceId === instance.id || e.targetInstanceId === instance.id,
  );

  const [editLabel, setEditLabel] = useState(instance.label);
  const [dirty, setDirty] = useState(false);

  // Sync local state when instance changes
  const [prevInstanceId, setPrevInstanceId] = useState(instance.id);
  const [prevLabel, setPrevLabel] = useState(instance.label);
  if (prevInstanceId !== instance.id || prevLabel !== instance.label) {
    setEditLabel(instance.label);
    setDirty(false);
    setPrevInstanceId(instance.id);
    setPrevLabel(instance.label);
  }

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
        <div className="de-panel-section-title">变换</div>
        <TransformControls instanceId={instance.id} instanceData={instance.instanceData} />
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

      {/* Connection labels for internal connections */}
      <ConnectionLabelsSection
        instance={instance}
        componentConnections={componentConnections}
        componentMap={componentMap}
        onUpdateConnectionLabel={onUpdateConnectionLabel}
      />

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

// ---------- Connection Labels Section ----------

interface ConnectionLabelEntry {
  name: string;
  visible: boolean;
  offsetX: number;
  offsetY: number;
}

function ConnectionLabelsSection({
  instance,
  componentConnections,
  componentMap,
  onUpdateConnectionLabel,
}: {
  instance: DiagramInstance;
  componentConnections: Record<string, ConnectivityMatrix>;
  componentMap: Record<string, { name: string; category: string; pins?: Pin[] }>;
  onUpdateConnectionLabel: (instanceId: string, connId: string, data: { name?: string; visible?: boolean }) => void;
}) {
  const matrix = componentConnections[instance.componentId];
  if (!matrix || matrix.connections.length === 0) return null;

  const pins = componentMap[instance.componentId]?.pins ?? [];
  const pinLabelMap = Object.fromEntries(pins.map((p) => [p.id, p.label]));
  const instanceData = (instance.instanceData as Record<string, unknown>) ?? {};
  const connectionLabels = (instanceData.connectionLabels as Record<string, ConnectionLabelEntry>) ?? {};

  return (
    <div className="de-panel-section">
      <div className="de-panel-section-title">内部连接 ({matrix.connections.length})</div>
      {matrix.connections.map((conn) => {
        const labelA = pinLabelMap[conn.pinAId] || conn.pinAId;
        const labelB = pinLabelMap[conn.pinBId] || conn.pinBId;
        const entry = connectionLabels[conn.id];
        const name = entry?.name ?? '';
        const visible = entry?.visible ?? true;

        return (
          <div key={conn.id} className="de-conn-label-row">
            <span className="de-conn-pin-pair" title={`${labelA} ↔ ${labelB}`}>
              {labelA} ↔ {labelB}
            </span>
            <div className="de-conn-label-controls">
              <input
                className="de-conn-name-input"
                value={name}
                placeholder="名称"
                onChange={(e) => {
                  onUpdateConnectionLabel(instance.id, conn.id, { name: e.target.value });
                }}
              />
              <button
                className={`btn btn-sm ${visible ? 'btn-primary' : ''}`}
                title={visible ? '隐藏标签' : '显示标签'}
                onClick={() => {
                  onUpdateConnectionLabel(instance.id, conn.id, { visible: !visible });
                }}
              >
                {visible ? '👁' : '👁‍🗨'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Edge Property Panel ----------

function EdgePropertyPanel({
  edge,
  instances,
  onRemoveEdge,
  onLineDataChanged,
}: {
  edge: DiagramEdge;
  instances: DiagramInstance[];
  onRemoveEdge: (id: string) => void;
  onLineDataChanged?: () => void;
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
          <LineDataPanel edgeId={edge.id} diagramId={diagramId} onLineDataChanged={onLineDataChanged} />
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

// ---------- Status Label ----------

const STATUS_LABELS: Record<DiagramStatus, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '审核中',
  PUBLISHED: '已发布',
  REJECTED: '已驳回',
  PENDING_DELETE: '待删除',
};

const STATUS_COLORS: Record<DiagramStatus, string> = {
  DRAFT: '#6b7280',
  PENDING_REVIEW: '#f59e0b',
  PUBLISHED: '#22c55e',
  REJECTED: '#ef4444',
  PENDING_DELETE: '#ef4444',
};

// ---------- Diagram Card ----------

function DiagramCard({
  item,
  onOpen,
  onSubmitReview,
  onWithdrawReview,
  onRename,
  onDuplicate,
  onDelete,
}: {
  item: DiagramListItem;
  onOpen: (id: string) => void;
  onSubmitReview: (id: string) => void;
  onWithdrawReview: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local state when item.name changes
  const [prevName, setPrevName] = useState(item.name);
  if (prevName !== item.name) {
    setEditName(item.name);
    setPrevName(item.name);
  }

  const startEdit = () => {
    setEditing(true);
    setEditName(item.name);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmEdit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      onRename(item.id, trimmed);
    }
    setEditing(false);
  };

  const canEdit = item.status === 'DRAFT' || item.status === 'REJECTED';
  const canSubmitReview = item.status === 'DRAFT' || item.status === 'REJECTED';
  const canWithdrawReview = item.status === 'PENDING_REVIEW';
  const canDelete = item.status !== 'PENDING_DELETE' && item.status !== 'PENDING_REVIEW';
  const canDuplicate = true;

  return (
    <div className="dg-card">
      <div className="dg-card-header">
        <span
          className="dg-card-status"
          style={{ background: STATUS_COLORS[item.status] || '#6b7280' }}
        >
          {STATUS_LABELS[item.status] || item.status}
        </span>
        <div className="dg-card-actions">
          {canEdit && (
            <button
              className="dg-card-icon-btn"
              title="进入编辑"
              onClick={() => onOpen(item.id)}
            >
              ✎
            </button>
          )}
          {canDuplicate && (
            <button
              className="dg-card-icon-btn"
              title="复制图纸"
              onClick={() => onDuplicate(item.id)}
            >
              ⧉
            </button>
          )}
          {canDelete && (
            <button
              className="dg-card-icon-btn dg-card-icon-danger"
              title="删除图纸"
              onClick={() => onDelete(item.id)}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="dg-card-body" onClick={canEdit ? () => onOpen(item.id) : undefined}>
        {editing ? (
          <input
            ref={inputRef}
            className="dg-card-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={confirmEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="dg-card-name"
            onClick={canEdit ? (e) => { e.stopPropagation(); startEdit(); } : undefined}
            title={canEdit ? '点击编辑名称' : item.name}
          >
            {item.name}
          </span>
        )}
        {item.description && (
          <span className="dg-card-desc">{item.description}</span>
        )}
      </div>

      <div className="dg-card-footer">
        <span className="dg-card-time">
          {new Date(item.updatedAt).toLocaleDateString()}
        </span>
        {canWithdrawReview && (
          <button
            className="dg-card-review-btn"
            onClick={() => onWithdrawReview(item.id)}
          >
            撤回审核
          </button>
        )}
        {canSubmitReview && (
          <button
            className="dg-card-review-btn"
            onClick={() => onSubmitReview(item.id)}
          >
            提交审核
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Diagram List ----------

function DiagramList({
  items,
  loading,
  error,
  newDiagramName,
  setNewDiagramName,
  onCreate,
  onOpen,
  onSubmitReview,
  onWithdrawReview,
  onReload,
  setError,
}: {
  items: DiagramListItem[];
  loading: boolean;
  error: string;
  newDiagramName: string;
  setNewDiagramName: (v: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onSubmitReview: (id: string) => void;
  onWithdrawReview: (id: string) => void;
  onReload: () => void;
  setError: (v: string) => void;
}) {
  const handleRename = async (id: string, name: string) => {
    try {
      await updateDiagram(id, { name });
      await onReload();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateDiagram(id);
      await onReload();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  const handleDelete = async (id: string) => {
    const item = items.find((d) => d.id === id);
    if (!item) return;

    const isPublished = item.status === 'PUBLISHED';
    const msg = isPublished
      ? `确定要删除图纸"${item.name}"吗？已发布图纸删除需要审核通过后才会生效。`
      : `确定要删除图纸"${item.name}"吗？删除后不可恢复。`;
    const confirmed = window.confirm(msg);
    if (!confirmed) return;

    try {
      if (isPublished) {
        await requestDeleteDiagram(id);
      } else {
        await deleteDiagram(id);
      }
      await onReload();
    } catch (e) {
      setError(parseApiError(e));
    }
  };

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>图纸管理</h3>
      </div>

      <div className="dg-create-bar">
        <input
          value={newDiagramName}
          onChange={(e) => setNewDiagramName(e.target.value)}
          placeholder="新建图纸名称"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onCreate();
          }}
        />
        <button className="btn btn-primary" onClick={() => void onCreate()}>
          新建图纸
        </button>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      {loading && <div className="empty-hint">加载中...</div>}

      {!loading && items.length === 0 && (
        <div className="empty-hint">暂无图纸</div>
      )}

      {!loading && items.length > 0 && (
        <div className="dg-card-grid">
          {items.map((item) => (
            <DiagramCard
              key={item.id}
              item={item}
              onOpen={onOpen}
              onSubmitReview={onSubmitReview}
              onWithdrawReview={onWithdrawReview}
              onRename={handleRename}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Main Page ----------

export default function DiagramEditorPage() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const {
    diagramId,
    diagramInfo,
    instances,
    edges,
    componentMap,
    componentConnections,
    loading,
    selectedInstanceId,
    selectedEdgeId,
    zoom,
    panX,
    panY,
    loadDiagram,
    addInstance,
    addInstanceFromClipboard,
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
    ensureComponentInMap,
    refreshComponentMap,
    updateInstanceLabel,
    moveConnectionLabel,
    updateConnectionLabel,
    moveInstanceLabel,
    persistInstanceLabelMove,
    saveDraft,
    withdrawReview,
  } = useDiagramStore();

  const [items, setItems] = useState<DiagramListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [newDiagramName, setNewDiagramName] = useState('');

  // Naming highlight state (flashing red border on unnamed instances)
  const unnamedHighlightIds = useDiagramStore((s) => s.unnamedHighlightIds);
  const setUnnamedHighlightIds = useCallback((ids: string[]) => {
    useDiagramStore.setState({ unnamedHighlightIds: ids });
  }, []);

  const canvasRef = useRef<DiagramCanvasHandle>(null);

  // Clipboard for copy/paste instances
  const clipboardRef = useRef<{
    componentId: string;
    label: string;
    instanceData: Record<string, unknown>;
  } | null>(null);

  // Line segment data for canvas rendering
  const [lineDataMap, setLineDataMap] = useState<Record<string, LineSegmentData>>({});
  const refreshLineData = useCallback(() => {
    if (!diagramId) return;
    fetchLinesByDiagram(diagramId)
      .then((items) => {
        const map: Record<string, LineSegmentData> = {};
        for (const item of items) {
          map[item.diagramEdgeId] = item;
        }
        setLineDataMap(map);
      })
      .catch(() => {});
  }, [diagramId]);

  useEffect(() => {
    refreshLineData();
  }, [refreshLineData]);

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

  const handleSaveDraft = async () => {
    if (!diagramId) return;
    try {
      await saveDraft();
      alert('草稿已保存');
    } catch {
      // store already sets error
    }
  };

  const handleWithdrawReview = async (id?: string) => {
    const targetId = id ?? diagramId;
    if (!targetId) return;
    const confirmed = window.confirm('确定要撤回审核吗？图纸将回到草稿状态，可继续编辑。');
    if (!confirmed) return;
    try {
      if (id) {
        // From card list
        const { withdrawDiagramReview } = await import('../services/diagramApi');
        await withdrawDiagramReview(id);
      } else {
        // From editor
        await withdrawReview();
      }
      await loadList();
    } catch {
      // store already sets error
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
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const componentId = e.dataTransfer.getData('text/plain');
      if (!componentId) return;

      // Ensure the component data (shapeElements, pins, etc.) is in the map
      await ensureComponentInMap(componentId);

      // Convert screen coords to world coords via the canvas ref
      const worldPos = canvasRef.current?.screenToWorld(e.clientX, e.clientY);
      if (!worldPos) return;

      // Center the instance on the drop point
      const compMeta = componentMap[componentId];
      const nodeWidth = compMeta?.displayWidth ?? 140;
      const nodeHeight = compMeta?.displayHeight ?? 56;
      const dropX = worldPos.x - nodeWidth / 2;
      const dropY = worldPos.y - nodeHeight / 2;

      await addInstance(componentId, dropX, dropY);
    },
    [addInstance, componentMap, ensureComponentInMap],
  );

  const handleSubmitReview = async (id: string) => {
    // Check for unnamed instances before submitting
    const unnamed = instances.filter((inst) => {
      const comp = componentMap[inst.componentId];
      const defaultLabel = comp?.name || '未知';
      return !inst.label || inst.label === defaultLabel;
    });

    if (unnamed.length > 0) {
      setUnnamedHighlightIds(unnamed.map((inst) => inst.id));
      setListError(`还有 ${unnamed.length} 个元件未命名，请为红色闪烁的元件命名后再提交审核。`);
      return;
    }

    setUnnamedHighlightIds([]);
    const confirmed = window.confirm('确定要提交审核吗？提交后将无法继续编辑。');
    if (!confirmed) return;

    try {
      await submitDiagramReview(id);
      if (diagramId === id) {
        clearDiagram();
      }
      await loadList();
    } catch (e) {
      setListError(parseApiError(e));
    }
  };

  // ---------- Keyboard shortcuts ----------

  useEffect(() => {
    if (!diagramId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const hasMod = e.ctrlKey || e.metaKey;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedInstanceId) {
          void removeInstance(selectedInstanceId);
        } else if (selectedEdgeId) {
          void removeEdge(selectedEdgeId);
        }
      }

      if (hasMod && e.key === 'z') {
        e.preventDefault();
        undo();
      }

      if (hasMod && e.key === 'c') {
        if (selectedInstanceId) {
          const inst = instances.find((i) => i.id === selectedInstanceId);
          if (inst) {
            e.preventDefault();
            clipboardRef.current = {
              componentId: inst.componentId,
              label: inst.label,
              instanceData: JSON.parse(JSON.stringify(inst.instanceData)),
            };
          }
        }
      }

      if (hasMod && e.key === 'v') {
        if (clipboardRef.current) {
          e.preventDefault();
          const clip = clipboardRef.current;
          const offset = 40;
          const selectedInst = instances.find((i) => i.id === selectedInstanceId);
          const pasteX = (selectedInst ? selectedInst.positionX + offset : 100);
          const pasteY = (selectedInst ? selectedInst.positionY + offset : 100);
          void addInstanceFromClipboard(clip.componentId, pasteX, pasteY, clip.label, clip.instanceData);
        }
      }

      if (hasMod && e.key === 's') {
        e.preventDefault();
        if (diagramInfo?.status === 'DRAFT' || diagramInfo?.status === 'REJECTED') {
          void saveDraft().then(() => {
            alert('草稿已保存');
          }).catch(() => {});
        }
      }

      if (e.key === 'Escape') {
        selectInstance(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [diagramId, selectedInstanceId, selectedEdgeId, instances, removeInstance, removeEdge, undo, selectInstance, addInstanceFromClipboard, panX, panY, zoom, saveDraft, diagramInfo]);

  // ---------- Auto-refresh component map when diagram is open ----------

  useEffect(() => {
    if (!diagramId) return;

    // Refresh on window focus (user returns from component editor or another tab)
    const onFocus = () => { void refreshComponentMap(); };
    window.addEventListener('focus', onFocus);

    // Poll every 30 seconds to pick up component changes made in another session
    const interval = setInterval(() => { void refreshComponentMap(); }, 30_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [diagramId, refreshComponentMap]);

  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
    : null;

  const selectedEdge = selectedEdgeId
    ? edges.find((e) => e.id === selectedEdgeId) ?? null
    : null;

  // ---- Render: Diagram Editor (canvas open) ----
  if (diagramId) {
    const layoutClass = `de-editor-layout${leftCollapsed ? ' left-collapsed' : ''}${rightCollapsed ? ' right-collapsed' : ''}`;
    return (
      <div className={layoutClass}>
        {/* Left panel: Component Library */}
        <div className={`de-left-panel${leftCollapsed ? ' collapsed' : ''}`}>
          {leftCollapsed ? (
            <button className="de-panel-expand-btn" onClick={() => setLeftCollapsed(false)} title="展开元件库">▶</button>
          ) : (
            <ComponentLibraryPanel
              headerExtra={
                <button className="de-panel-header-btn" onClick={() => setLeftCollapsed(true)} title="收起元件库">◀</button>
              }
            />
          )}
        </div>

        {/* Center: Canvas (drop target) */}
        <div
          className="de-main-area"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          {/* Floating toolbar overlay */}
          <div className="de-floating-toolbar">
            <button className="btn btn-sm" onClick={handleBackToList}>
              ← 返回
            </button>
            <span className="de-toolbar-title">
              {diagramInfo?.name || '未命名图纸'}
            </span>
            <span className={`review-status ${String(diagramInfo?.status).toLowerCase()}`}>
              {diagramInfo?.status || ''}
            </span>
            <span className="de-zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={undo}>撤销</button>
            {(diagramInfo?.status === 'DRAFT' || diagramInfo?.status === 'REJECTED') && (
              <button
                className="btn btn-sm"
                onClick={() => void handleSaveDraft()}
              >
                保存草稿
              </button>
            )}
            {diagramInfo?.status === 'PENDING_REVIEW' && (
              <button
                className="btn btn-sm"
                onClick={() => void handleWithdrawReview()}
              >
                撤回审核
              </button>
            )}
            {(diagramInfo?.status === 'DRAFT' || diagramInfo?.status === 'REJECTED') && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void handleSubmitReview(diagramId)}
              >
                提交审核
              </button>
            )}
          </div>

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
              onRemoveEdge={(id) => void removeEdge(id)}
              onMoveInstance={moveInstance}
              onPersistInstanceMove={persistInstanceMove}
              onSetZoom={setZoom}
              onSetPan={setPan}
              onConnectPins={handleConnectPins}
              unnamedHighlightIds={unnamedHighlightIds}
              componentConnections={componentConnections}
              onMoveConnectionLabel={moveConnectionLabel}
              onUpdateConnectionLabel={(instanceId, connId, data) => void updateConnectionLabel(instanceId, connId, data)}
              onMoveInstanceLabel={moveInstanceLabel}
              onPersistInstanceLabelMove={(id) => void persistInstanceLabelMove(id)}
              onUpdateInstanceLabel={(id, label) => void updateInstanceLabel(id, label)}
              lineDataMap={lineDataMap}
            />
          )}
        </div>

        {/* Right panel: Instance/Edge properties */}
        <div className={`de-right-panel${rightCollapsed ? ' collapsed' : ''}`}>
          {rightCollapsed ? (
            <button className="de-panel-expand-btn" onClick={() => setRightCollapsed(false)} title="展开属性面板">◀</button>
          ) : (
            <>
              <div className="de-panel-top">
                <span className="de-panel-title">
                  {selectedInstance ? '实例属性' : selectedEdge ? '连线属性' : '属性面板'}
                </span>
                <button className="de-panel-header-btn" onClick={() => setRightCollapsed(true)} title="收起属性面板">▶</button>
              </div>
              {selectedInstance ? (
                <InstancePropertyPanel
                  instance={selectedInstance}
                  edges={edges}
                  componentMap={componentMap}
                  componentConnections={componentConnections}
                  allInstances={instances}
                  onUpdateLabel={updateInstanceLabel}
                  onRemoveInstance={(id) => void removeInstance(id)}
                  onRemoveEdge={(id) => void removeEdge(id)}
                  onUpdateConnectionLabel={(instanceId, connId, data) => void updateConnectionLabel(instanceId, connId, data)}
                />
              ) : selectedEdge ? (
                <EdgePropertyPanel
                  edge={selectedEdge}
                  instances={instances}
                  onRemoveEdge={(id) => void removeEdge(id)}
                  onLineDataChanged={refreshLineData}
                />
              ) : (
                <div className="de-empty-hint">
                  {instances.length === 0 ? '暂无实例' : '点击节点查看属性'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Render: Diagram list (no canvas open) ----
  return (
    <DiagramList
      items={items}
      loading={listLoading}
      error={listError}
      newDiagramName={newDiagramName}
      setNewDiagramName={setNewDiagramName}
      onCreate={handleCreate}
      onOpen={handleOpenDiagram}
      onSubmitReview={handleSubmitReview}
      onWithdrawReview={handleWithdrawReview}
      onReload={loadList}
      setError={setListError}
    />
  );
}
