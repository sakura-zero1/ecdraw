import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { CATEGORY_LABELS, CATEGORIES } from '../../constants/categories';
import type { ComponentCategory, ConnectivityMatrix, ElectricalComponent } from '../../types';
import {
  createComponentByApi,
  deleteComponentByApi,
  duplicateComponentByApi,
  fetchComponentLibrary,
  saveComponentVersionByApi,
  updateComponentMetaByApi,
} from '../../services/componentApi';
import {
  approveReviewByApi,
  fetchReviewQueue,
  rejectReviewByApi,
  type ReviewFilterStatus,
  type ReviewQueueItem,
  type ReviewStatus,
} from '../../services/reviewApi';
import {
  fetchDiagramReadonlySnapshot,
  fetchPublishedDiagrams,
  type DiagramListItem,
  type DiagramSnapshot,
} from '../../services/diagramApi';
import { fetchAuditLogs, type AuditItem } from '../../services/auditApi';
import SvgCanvas from '../canvas/SvgCanvas';
import ReadonlyDiagramPreview from '../diagram/ReadonlyDiagramPreview';
import PropertyPanel from '../panels/PropertyPanel';
import PinListPanel from '../panels/PinListPanel';
import ConnectivityMatrixPanel from '../panels/ConnectivityMatrixPanel';
import CollapsibleSection from '../panels/CollapsibleSection';
import './AppLayout.css';

type PanelTab = 'property' | 'pins';
const REVIEW_PAGE_SIZE = 10;
const AUDIT_PAGE_SIZE = 20;

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    if (payload && typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    return error.message || '请求失败';
  }
  return error.message || '请求失败';
}

function matrixListToMap(list: ConnectivityMatrix[]) {
  return list.reduce<Record<string, ConnectivityMatrix>>((acc, matrix) => {
    acc[matrix.componentId] = matrix;
    return acc;
  }, {});
}

export default function AppLayout() {
  const { components, activeComponentId, addComponent, setActiveComponent, duplicateComponent, loadComponents } =
    useComponentStore();
  const { matrices, loadMatrices } = useConnectionStore();
  const activeComponent = components.find((c) => c.id === activeComponentId);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ComponentCategory>('junctionPoint');
  const [deleteTarget, setDeleteTarget] = useState<ElectricalComponent | null>(null);

  const [storageMode, setStorageMode] = useState<'api' | 'local'>('local');
  const [syncStatus, setSyncStatus] = useState('本地模式');
  const [saving, setSaving] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('property');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>([]);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewFilterStatus>('PENDING');
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewTotalPages, setReviewTotalPages] = useState(1);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewActionLoadingId, setReviewActionLoadingId] = useState('');
  const [reviewCommentDrafts, setReviewCommentDrafts] = useState<Record<string, string>>({});
  const [showPublishedDialog, setShowPublishedDialog] = useState(false);
  const [publishedList, setPublishedList] = useState<DiagramListItem[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [publishedError, setPublishedError] = useState('');
  const [selectedPublishedId, setSelectedPublishedId] = useState('');
  const [readonlySnapshot, setReadonlySnapshot] = useState<DiagramSnapshot | null>(null);
  const [readonlyVersionNo, setReadonlyVersionNo] = useState(0);
  const [readonlyLoading, setReadonlyLoading] = useState(false);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');
  const [auditTargetTypeFilter, setAuditTargetTypeFilter] = useState('ALL');
  const [auditTargetIdFilter, setAuditTargetIdFilter] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<ComponentCategory, boolean>>(
    () =>
      CATEGORIES.reduce((acc, cat) => {
        acc[cat] = false;
        return acc;
      }, {} as Record<ComponentCategory, boolean>)
  );

  const lastVersionSignaturesRef = useRef<Record<string, string>>({});
  const lastMetaSignaturesRef = useRef<Record<string, string>>({});

  const normalizedKeyword = searchKeyword.trim().toLowerCase();
  const visibleComponents = useMemo(
    () =>
      normalizedKeyword
        ? components.filter((c) => {
            const keywords = [c.name, c.description ?? '', CATEGORY_LABELS[c.category]];
            return keywords.some((value) => value.toLowerCase().includes(normalizedKeyword));
          })
        : components,
    [components, normalizedKeyword]
  );

  const groupedComponents = useMemo(
    () =>
      CATEGORIES.reduce((acc, cat) => {
        acc[cat] = visibleComponents.filter((c) => c.category === cat);
        return acc;
      }, {} as Record<ComponentCategory, typeof components>),
    [visibleComponents]
  );

  const hydrateFromApi = useCallback(async () => {
    const { components: apiComponents, matrices: apiMatrices } = await fetchComponentLibrary();
    loadComponents(apiComponents);
    loadMatrices(apiMatrices);

    const matrixMap = matrixListToMap(apiMatrices);
    lastVersionSignaturesRef.current = {};
    lastMetaSignaturesRef.current = {};
    apiComponents.forEach((component) => {
      const matrix = matrixMap[component.id] ?? { componentId: component.id, connections: [] };
      lastVersionSignaturesRef.current[component.id] = JSON.stringify({
        width: component.width,
        height: component.height,
        shapeElements: component.shapeElements,
        pins: component.pins,
        matrix,
      });
      lastMetaSignaturesRef.current[component.id] = JSON.stringify({
        name: component.name,
        category: component.category,
        description: component.description,
      });
    });
    setStorageMode('api');
    setSyncStatus('API 已连接');
  }, [loadComponents, loadMatrices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await hydrateFromApi();
      } catch {
        if (!cancelled) {
          setStorageMode('local');
          setSyncStatus('API 不可用，使用本地模式');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromApi]);

  useEffect(() => {
    if (storageMode !== 'api') return;
    if (!activeComponent) return;

    const matrix = matrices[activeComponent.id] ?? { componentId: activeComponent.id, connections: [] };
    const signature = JSON.stringify({
      width: activeComponent.width,
      height: activeComponent.height,
      shapeElements: activeComponent.shapeElements,
      pins: activeComponent.pins,
      matrix,
    });

    if (lastVersionSignaturesRef.current[activeComponent.id] === signature) return;

    const timer = window.setTimeout(async () => {
      try {
        await saveComponentVersionByApi(activeComponent, matrix);
        lastVersionSignaturesRef.current[activeComponent.id] = signature;
        setSyncStatus(`已同步版本 ${new Date().toLocaleTimeString()}`);
      } catch {
        setStorageMode('local');
        setSyncStatus('版本同步失败，已回退本地模式');
      }
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [activeComponent, matrices, storageMode]);

  useEffect(() => {
    if (storageMode !== 'api') return;
    if (!activeComponent) return;

    const signature = JSON.stringify({
      name: activeComponent.name,
      category: activeComponent.category,
      description: activeComponent.description,
    });
    if (lastMetaSignaturesRef.current[activeComponent.id] === signature) return;

    const timer = window.setTimeout(async () => {
      try {
        await updateComponentMetaByApi(activeComponent);
        lastMetaSignaturesRef.current[activeComponent.id] = signature;
      } catch {
        setStorageMode('local');
        setSyncStatus('元数据同步失败，已回退本地模式');
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [activeComponent, storageMode]);

  const handleAddComponent = async () => {
    const targetName = newName || CATEGORY_LABELS[newCategory];
    if (storageMode === 'api') {
      try {
        const created = await createComponentByApi(targetName, newCategory);
        loadComponents([...components, created]);
        loadMatrices([...Object.values(matrices), { componentId: created.id, connections: [] }]);
        setActiveComponent(created.id);
        lastMetaSignaturesRef.current[created.id] = JSON.stringify({
          name: created.name,
          category: created.category,
          description: created.description,
        });
        lastVersionSignaturesRef.current[created.id] = JSON.stringify({
          width: created.width,
          height: created.height,
          shapeElements: created.shapeElements,
          pins: created.pins,
          matrix: { componentId: created.id, connections: [] },
        });
        setSyncStatus(`已通过 API 新建 ${created.name}`);
      } catch {
        const id = addComponent(targetName, newCategory, 1200, 800);
        setActiveComponent(id);
        setStorageMode('local');
        setSyncStatus('新建失败，已回退本地模式');
      }
    } else {
      addComponent(targetName, newCategory, 1200, 800);
    }

    setShowNewDialog(false);
    setNewName('');
  };

  const handleDuplicate = async (component: ElectricalComponent) => {
    if (storageMode === 'api') {
      try {
        const duplicated = await duplicateComponentByApi(component.id);
        loadComponents([...components, duplicated.component]);
        loadMatrices([...Object.values(matrices), duplicated.matrix]);
        setActiveComponent(duplicated.component.id);
        lastMetaSignaturesRef.current[duplicated.component.id] = JSON.stringify({
          name: duplicated.component.name,
          category: duplicated.component.category,
          description: duplicated.component.description,
        });
        lastVersionSignaturesRef.current[duplicated.component.id] = JSON.stringify({
          width: duplicated.component.width,
          height: duplicated.component.height,
          shapeElements: duplicated.component.shapeElements,
          pins: duplicated.component.pins,
          matrix: duplicated.matrix,
        });
        setSyncStatus(`已通过 API 复制 ${duplicated.component.name}`);
        return;
      } catch {
        setStorageMode('local');
        setSyncStatus('复制失败，已回退本地模式');
      }
    }

    duplicateComponent(component.id);
  };

  const { removeComponent } = useComponentStore();

  const handleDelete = async (comp: ElectricalComponent) => {
    if (storageMode === 'api') {
      try {
        await deleteComponentByApi(comp.id);
      } catch {
        setSyncStatus('删除失败');
        setDeleteTarget(null);
        return;
      }
    }
    removeComponent(comp.id);
    setDeleteTarget(null);
  };

  const handleSave = async () => {
    if (storageMode !== 'api') {
      setSyncStatus('本地模式无法保存到云端');
      return;
    }
    const comp = useComponentStore.getState().components.find((c) => c.id === useComponentStore.getState().activeComponentId);
    if (!comp) return;
    setSaving(true);
    try {
      const matrix = matrices[comp.id] ?? { componentId: comp.id, connections: [] };
      await saveComponentVersionByApi(comp, matrix);
      await updateComponentMetaByApi(comp);
      lastVersionSignaturesRef.current[comp.id] = JSON.stringify({
        width: comp.width, height: comp.height, shapeElements: comp.shapeElements, pins: comp.pins, matrix,
      });
      lastMetaSignaturesRef.current[comp.id] = JSON.stringify({
        name: comp.name, category: comp.category, description: comp.description,
      });
      setSyncStatus(`已保存 ${new Date().toLocaleTimeString()}`);
    } catch {
      setSyncStatus('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const loadReviewList = useCallback(async () => {
    if (!showReviewDialog) return;
    setReviewLoading(true);
    setReviewError('');
    try {
      const status = reviewStatusFilter === 'ALL' ? undefined : (reviewStatusFilter as ReviewStatus);
      const result = await fetchReviewQueue({
        status,
        page: reviewPage,
        pageSize: REVIEW_PAGE_SIZE,
      });
      setReviewItems(result.items);
      setReviewTotal(result.total);
      setReviewTotalPages(result.totalPages);
    } catch (error) {
      setReviewError(parseApiError(error));
    } finally {
      setReviewLoading(false);
    }
  }, [reviewPage, reviewStatusFilter, showReviewDialog]);

  useEffect(() => {
    void loadReviewList();
  }, [loadReviewList]);

  const handleReviewAction = async (id: string, action: 'approve' | 'reject') => {
    setReviewActionLoadingId(id);
    setReviewError('');
    const comment = reviewCommentDrafts[id]?.trim();
    try {
      if (action === 'approve') {
        await approveReviewByApi(id, comment || undefined);
      } else {
        await rejectReviewByApi(id, comment || undefined);
      }
      await loadReviewList();
    } catch (error) {
      setReviewError(parseApiError(error));
    } finally {
      setReviewActionLoadingId('');
    }
  };

  const loadPublishedList = useCallback(async () => {
    if (!showPublishedDialog) return;
    setPublishedLoading(true);
    setPublishedError('');
    try {
      const list = await fetchPublishedDiagrams();
      setPublishedList(list);
      if (!selectedPublishedId && list.length > 0) {
        setSelectedPublishedId(list[0].id);
      }
      if (selectedPublishedId && !list.some((item) => item.id === selectedPublishedId)) {
        setSelectedPublishedId(list[0]?.id ?? '');
      }
    } catch (error) {
      setPublishedError(parseApiError(error));
    } finally {
      setPublishedLoading(false);
    }
  }, [selectedPublishedId, showPublishedDialog]);

  useEffect(() => {
    void loadPublishedList();
  }, [loadPublishedList]);

  useEffect(() => {
    if (!showPublishedDialog || !selectedPublishedId) {
      setReadonlySnapshot(null);
      setReadonlyVersionNo(0);
      return;
    }

    let cancelled = false;
    setReadonlyLoading(true);
    setPublishedError('');
    void (async () => {
      try {
        const payload = await fetchDiagramReadonlySnapshot(selectedPublishedId);
        if (cancelled) return;
        setReadonlySnapshot(payload.snapshot);
        setReadonlyVersionNo(payload.versionNo);
      } catch (error) {
        if (!cancelled) {
          setPublishedError(parseApiError(error));
          setReadonlySnapshot(null);
          setReadonlyVersionNo(0);
        }
      } finally {
        if (!cancelled) {
          setReadonlyLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPublishedId, showPublishedDialog]);

  const loadAuditList = useCallback(async () => {
    if (!showAuditDialog) return;
    setAuditLoading(true);
    setAuditError('');
    try {
      const action = auditActionFilter === 'ALL' ? undefined : auditActionFilter;
      const targetType = auditTargetTypeFilter === 'ALL' ? undefined : auditTargetTypeFilter;
      const targetId = auditTargetIdFilter.trim() || undefined;
      const result = await fetchAuditLogs({
        action,
        targetType,
        targetId,
        page: auditPage,
        pageSize: AUDIT_PAGE_SIZE,
      });
      setAuditItems(result.items);
      setAuditTotal(result.total);
      setAuditTotalPages(result.totalPages);
    } catch (error) {
      setAuditError(parseApiError(error));
    } finally {
      setAuditLoading(false);
    }
  }, [auditActionFilter, auditPage, auditTargetIdFilter, auditTargetTypeFilter, showAuditDialog]);

  useEffect(() => {
    void loadAuditList();
  }, [loadAuditList]);

  return (
    <div className="app-layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">ECDraw</h1>
          <span className="app-subtitle">电气元件绘制工具 · {syncStatus}</span>
        </div>

        <div className="toolbar-right">
          <button
            className="btn btn-primary"
            disabled={saving || storageMode !== 'api'}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            className={`btn ${showAuditDialog ? 'btn-active' : ''}`}
            onClick={() => {
              setShowAuditDialog(true);
              setAuditPage(1);
            }}
          >
            审计追踪
          </button>
          <button
            className={`btn ${showPublishedDialog ? 'btn-active' : ''}`}
            onClick={() => {
              setShowPublishedDialog(true);
            }}
          >
            发布浏览
          </button>
          <button
            className={`btn ${showReviewDialog ? 'btn-active' : ''}`}
            onClick={() => {
              setShowReviewDialog(true);
              setReviewPage(1);
            }}
          >
            审核队列
          </button>
          <button
            className="btn"
            onClick={() => {
              void (async () => {
                try {
                  await hydrateFromApi();
                } catch {
                  setStorageMode('local');
                  setSyncStatus('刷新失败，维持本地模式');
                }
              })();
            }}
          >
            云端刷新
          </button>
          <button
            className="btn"
            onClick={() => {
              const { components: comps } = useComponentStore.getState();
              const { matrices: matrixMap } = useConnectionStore.getState();
              const data = {
                version: '1.0.0',
                components: comps,
                matrices: Object.values(matrixMap),
                savedAt: new Date().toISOString(),
              };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'project.ecp.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            导出
          </button>
          <button
            className="btn"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const data = JSON.parse(text) as {
                    components?: ElectricalComponent[];
                    matrices?: ConnectivityMatrix[];
                  };
                  if (data.components) useComponentStore.getState().loadComponents(data.components);
                  if (data.matrices) useConnectionStore.getState().loadMatrices(data.matrices);
                  setStorageMode('local');
                  setSyncStatus('已导入本地数据');
                } catch {
                  alert('导入失败：文件格式不正确，请选择有效的 .ecp.json 文件');
                }
              };
              input.click();
            }}
          >
            导入
          </button>
        </div>
      </header>

      <div className="main-content">
        {!sidebarCollapsed ? (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span>元件列表</span>
              <div className="header-actions">
                <span className="count-badge">
                  {normalizedKeyword ? `${visibleComponents.length}/${components.length}` : components.length}
                </span>
                <button className="icon-btn" title="收起列表" onClick={() => setSidebarCollapsed(true)}>◂</button>
              </div>
            </div>
            <div className="sidebar-search">
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索名称/描述/分类"
              />
              <button className="btn btn-sm" onClick={() => setShowNewDialog(true)} style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>+ 新建</button>
            </div>
            <div className="component-list">
              {components.length === 0 && <div className="empty-hint">暂无元件，点击“新建元件”开始绘制</div>}
              {components.length > 0 && visibleComponents.length === 0 && (
                <div className="empty-hint">未找到匹配项，调整关键词后重试</div>
              )}

              {CATEGORIES.map((cat) => {
                const items = groupedComponents[cat];
                const collapsed = collapsedCategories[cat];
                return (
                  <div key={cat} className="category-group">
                    <button
                      className="category-header"
                      onClick={() => setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                      title={collapsed ? `展开${CATEGORY_LABELS[cat]}` : `收起${CATEGORY_LABELS[cat]}`}
                    >
                      <span className={`category-arrow ${collapsed ? '' : 'open'}`}>▸</span>
                      <span className="category-title">{CATEGORY_LABELS[cat]}</span>
                      <span className="category-count">{items.length}</span>
                    </button>

                    {!collapsed &&
                      items.map((comp) => (
                        <div
                          key={comp.id}
                          className={`component-item ${comp.id === activeComponentId ? 'active' : ''}`}
                          onClick={() => setActiveComponent(comp.id)}
                        >
                          <span className="comp-name" title={comp.name}>
                            {comp.name}
                          </span>
                          <button
                            className="item-action-btn"
                            title="复制元件"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDuplicate(comp);
                            }}
                          >
                            ⧉
                          </button>
                          <button
                            className="item-action-btn item-action-danger"
                            title="删除元件"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(comp);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </aside>
        ) : (
          <button className="rail-toggle left" title="展开列表" onClick={() => setSidebarCollapsed(false)}>
            ▸
          </button>
        )}

        <main className="canvas-area">
          <SvgCanvas />
        </main>

        {!panelCollapsed ? (
          <aside className="panel">
            <div className="panel-top">
              {activeComponent ? (
                <div className="panel-tabs">
                  <button
                    className={`tab-btn ${activeTab === 'property' ? 'active' : ''}`}
                    onClick={() => setActiveTab('property')}
                  >
                    元件属性
                  </button>
                  <button className={`tab-btn ${activeTab === 'pins' ? 'active' : ''}`} onClick={() => setActiveTab('pins')}>
                    引脚管理
                  </button>
                </div>
              ) : (
                <div className="panel-title-ghost">元件属性</div>
              )}
              <button className="icon-btn" title="收起属性栏" onClick={() => setPanelCollapsed(true)}>
                ▸
              </button>
            </div>

            {activeComponent ? (
              <div className="panel-body">
                {activeTab === 'property' && (
                  <CollapsibleSection title="元件属性">
                    <PropertyPanel component={activeComponent} />
                  </CollapsibleSection>
                )}

                {activeTab === 'pins' && (
                  <>
                    <CollapsibleSection title="引脚管理">
                      <PinListPanel component={activeComponent} />
                    </CollapsibleSection>
                    <ConnectivityMatrixPanel component={activeComponent} />
                  </>
                )}
              </div>
            ) : (
              <div className="empty-hint">请选择或新建一个元件</div>
            )}
          </aside>
        ) : (
          <button className="rail-toggle right" title="展开属性栏" onClick={() => setPanelCollapsed(false)}>
            ◂
          </button>
        )}
      </div>

      {showAuditDialog && (
        <div className="dialog-overlay" onClick={() => setShowAuditDialog(false)}>
          <div className="dialog audit-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="review-header">
              <h3>审计追踪</h3>
              <div className="review-page-actions">
                <button className="btn btn-sm" disabled={auditLoading} onClick={() => void loadAuditList()}>
                  刷新
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAuditDialog(false)}>
                  关闭
                </button>
              </div>
            </div>

            <div className="audit-filters">
              <select
                value={auditTargetTypeFilter}
                onChange={(e) => {
                  setAuditTargetTypeFilter(e.target.value);
                  setAuditPage(1);
                }}
              >
                <option value="ALL">全部目标</option>
                <option value="Diagram">Diagram</option>
                <option value="ReviewRequest">ReviewRequest</option>
                <option value="Component">Component</option>
              </select>
              <select
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditActionFilter(e.target.value);
                  setAuditPage(1);
                }}
              >
                <option value="ALL">全部动作</option>
                <option value="DIAGRAM_SUBMIT_REVIEW">DIAGRAM_SUBMIT_REVIEW</option>
                <option value="REVIEW_APPROVE">REVIEW_APPROVE</option>
                <option value="REVIEW_REJECT">REVIEW_REJECT</option>
                <option value="DIAGRAM_SAVE">DIAGRAM_SAVE</option>
              </select>
              <input
                value={auditTargetIdFilter}
                onChange={(e) => {
                  setAuditTargetIdFilter(e.target.value);
                  setAuditPage(1);
                }}
                placeholder="targetId 过滤（可选）"
              />
            </div>

            {auditError && <div className="review-error">{auditError}</div>}
            {auditLoading && <div className="empty-hint">正在加载...</div>}

            {!auditLoading && (
              <div className="audit-list">
                {auditItems.length === 0 && <div className="empty-hint">暂无审计记录</div>}
                {auditItems.map((item) => (
                  <div key={item.id} className="audit-item">
                    <div className="audit-top">
                      <strong>{item.action}</strong>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="audit-meta">
                      <span>用户: {item.user.username} ({item.user.role})</span>
                      <span>目标: {item.targetType}/{item.targetId}</span>
                    </div>
                    <pre>{item.payload ? JSON.stringify(item.payload, null, 2) : '{}'}</pre>
                  </div>
                ))}
              </div>
            )}

            <div className="review-pagination">
              <span>
                第 {auditPage}/{auditTotalPages} 页，共 {auditTotal} 条
              </span>
              <div className="review-page-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={auditLoading || auditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={auditLoading || auditPage >= auditTotalPages}
                  onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPublishedDialog && (
        <div className="dialog-overlay" onClick={() => setShowPublishedDialog(false)}>
          <div className="dialog published-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="review-header">
              <h3>已发布图纸</h3>
              <div className="review-page-actions">
                <button className="btn btn-sm" disabled={publishedLoading} onClick={() => void loadPublishedList()}>
                  刷新
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowPublishedDialog(false)}>
                  关闭
                </button>
              </div>
            </div>

            {publishedError && <div className="review-error">{publishedError}</div>}

            <div className="published-layout">
              <aside className="published-list">
                {publishedLoading && <div className="empty-hint">正在加载...</div>}
                {!publishedLoading && publishedList.length === 0 && <div className="empty-hint">暂无已发布图纸</div>}
                {!publishedLoading &&
                  publishedList.map((item) => (
                    <button
                      key={item.id}
                      className={`published-item ${selectedPublishedId === item.id ? 'active' : ''}`}
                      onClick={() => setSelectedPublishedId(item.id)}
                    >
                      <strong>{item.name}</strong>
                      <span>{new Date(item.updatedAt).toLocaleString()}</span>
                    </button>
                  ))}
              </aside>

              <section className="published-preview">
                {readonlyLoading && <div className="empty-hint">正在加载图纸预览...</div>}
                {!readonlyLoading && readonlySnapshot && (
                  <>
                    <div className="published-preview-meta">
                      <span>版本: v{readonlyVersionNo}</span>
                      <span>实例: {readonlySnapshot.instances.length}</span>
                      <span>连线: {readonlySnapshot.connections.length}</span>
                    </div>
                    <ReadonlyDiagramPreview snapshot={readonlySnapshot} />
                  </>
                )}
                {!readonlyLoading && !readonlySnapshot && <div className="empty-hint">请选择左侧图纸查看</div>}
              </section>
            </div>
          </div>
        </div>
      )}

      {showReviewDialog && (
        <div className="dialog-overlay" onClick={() => setShowReviewDialog(false)}>
          <div className="dialog review-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="review-header">
              <h3>审核队列</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowReviewDialog(false)}>
                关闭
              </button>
            </div>

            <div className="review-filters">
              <select
                value={reviewStatusFilter}
                onChange={(e) => {
                  setReviewStatusFilter(e.target.value as ReviewFilterStatus);
                  setReviewPage(1);
                }}
              >
                <option value="PENDING">待审核</option>
                <option value="APPROVED">已通过</option>
                <option value="REJECTED">已驳回</option>
                <option value="ALL">全部</option>
              </select>
              <button className="btn btn-sm" disabled={reviewLoading} onClick={() => void loadReviewList()}>
                刷新
              </button>
            </div>

            {reviewError && <div className="review-error">{reviewError}</div>}
            {reviewLoading && <div className="empty-hint">正在加载...</div>}
            {!reviewLoading && reviewItems.length === 0 && <div className="empty-hint">暂无审核记录</div>}

            {!reviewLoading && reviewItems.length > 0 && (
              <div className="review-list">
                {reviewItems.map((item) => {
                  const processing = reviewActionLoadingId === item.id;
                  const comment = reviewCommentDrafts[item.id] ?? '';
                  return (
                    <div key={item.id} className="review-item">
                      <div className="review-item-top">
                        <strong>{item.diagram.name}</strong>
                        <span className={`review-status ${item.status.toLowerCase()}`}>{item.status}</span>
                      </div>
                      <div className="review-meta">
                        <span>图纸版本: v{item.diagramVersion.versionNo}</span>
                        <span>提交时间: {new Date(item.submittedAt).toLocaleString()}</span>
                      </div>
                      {item.status === 'PENDING' ? (
                        <div className="review-actions">
                          <input
                            value={comment}
                            onChange={(e) =>
                              setReviewCommentDrafts((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            placeholder="审核意见（可选）"
                          />
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={processing}
                            onClick={() => void handleReviewAction(item.id, 'approve')}
                          >
                            通过
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={processing}
                            onClick={() => void handleReviewAction(item.id, 'reject')}
                          >
                            驳回
                          </button>
                        </div>
                      ) : (
                        <div className="review-result">
                          <span>审核人: {item.reviewerId ?? '-'}</span>
                          <span>审核时间: {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : '-'}</span>
                          <span>意见: {item.comment || '无'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="review-pagination">
              <span>
                第 {reviewPage}/{reviewTotalPages} 页，共 {reviewTotal} 条
              </span>
              <div className="review-page-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={reviewLoading || reviewPage <= 1}
                  onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={reviewLoading || reviewPage >= reviewTotalPages}
                  onClick={() => setReviewPage((p) => Math.min(reviewTotalPages, p + 1))}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewDialog && (
        <div className="dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建元件</h3>
            <label>
              名称
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="可选，留空使用分类名称" />
            </label>
            <label>
              分类
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as ComponentCategory)}>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </label>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  void handleAddComponent();
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p style={{ margin: '12px 0', color: 'var(--color-text-dim)' }}>
              确定要删除元件「{deleteTarget.name}」吗？此操作不可撤销。
            </p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void handleDelete(deleteTarget)}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
