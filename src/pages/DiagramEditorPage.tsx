import { useEffect, useState, useCallback } from 'react';
import {
  createDiagramByApi,
  fetchDiagrams,
  submitDiagramReview,
  type DiagramListItem,
} from '../services/diagramApi';
import { useDiagramStore } from '../stores/useDiagramStore';
import DiagramCanvas from '../components/diagram/DiagramCanvas';
import { CATEGORY_LABELS } from '../constants/categories';
import type { DiagramInstance, DiagramEdge } from '../services/diagramApi';
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
    moveInstance,
    persistInstanceMove,
    removeInstance,
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
    try {
      await submitDiagramReview(id);
      await loadList();
      // Reload current diagram if it's the one submitted
      if (diagramId === id) {
        await loadDiagram(id);
      }
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

  const selectedInstance = selectedInstanceId
    ? instances.find((i) => i.id === selectedInstanceId) ?? null
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

        {/* Center: Canvas */}
        <div className="de-main-area">
          {loading ? (
            <div className="de-empty-center">加载中...</div>
          ) : (
            <DiagramCanvas
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
            />
          )}
        </div>

        {/* Right panel: Instance properties */}
        <div className="de-right-panel">
          <div className="de-panel-top">
            <span className="de-panel-title">
              {selectedInstance ? '实例属性' : '属性面板'}
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
          ) : (
            <div className="de-empty-hint">
              {instances.length === 0 ? '暂无实例' : '点击节点查看属性'}
            </div>
          )}
        </div>

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
