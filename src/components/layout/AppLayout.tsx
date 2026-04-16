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
import SvgCanvas from '../canvas/SvgCanvas';
import PropertyPanel from '../panels/PropertyPanel';
import PinListPanel from '../panels/PinListPanel';
import ConnectivityMatrixPanel from '../panels/ConnectivityMatrixPanel';
import CollapsibleSection from '../panels/CollapsibleSection';
import ComponentThumbnail from '../panels/ComponentThumbnail';
import './AppLayout.css';

type PanelTab = 'property' | 'pins';

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

  return (
    <div className="app-layout">
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        {sidebarCollapsed ? (
          <button className="ce-panel-expand-btn" onClick={() => setSidebarCollapsed(false)} title="展开元件列表">▶</button>
        ) : (
          <>
            <div className="sidebar-header">
              <span>元件列表</span>
              <div className="ce-panel-header-actions">
                <span className="count-badge">
                  {normalizedKeyword ? `${visibleComponents.length}/${components.length}` : components.length}
                </span>
                <button className="ce-panel-header-btn" onClick={() => setSidebarCollapsed(true)} title="收起元件列表">◀</button>
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
          <div className="sidebar-actions">
            <button
              className="btn btn-sm"
              data-testid="save-btn"
              disabled={saving || storageMode !== 'api'}
              onClick={() => void handleSave()}
            >
              保存
            </button>
            <button
              className="btn btn-sm"
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
              刷新
            </button>
          </div>
          <div className="component-list">
            {components.length === 0 && <div className="empty-hint">暂无元件，点击"新建元件"开始绘制</div>}
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

                  {!collapsed && (
                    <div className="component-list-items">
                    {items.map((comp) => (
                      <div
                        key={comp.id}
                        className={`component-item ${comp.id === activeComponentId ? 'active' : ''}`}
                        onClick={() => setActiveComponent(comp.id)}
                      >
                        <div className="comp-thumb-wrap">
                          <ComponentThumbnail component={comp} matrix={matrices[comp.id]} />
                          <div className="comp-card-actions">
                            <button
                              className="card-action-btn"
                              title="复制元件"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDuplicate(comp);
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              className="card-action-btn card-action-danger"
                              title="删除元件"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(comp);
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <span className="comp-card-name" title={comp.name}>
                          {comp.name}
                        </span>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
            </>
          )}
        </aside>

        <main className="canvas-area">
          <SvgCanvas />
        </main>

        <aside className={`panel${panelCollapsed ? ' collapsed' : ''}`}>
          {panelCollapsed ? (
            <button className="ce-panel-expand-btn" onClick={() => setPanelCollapsed(false)} title="展开属性面板">◀</button>
          ) : (
            <>
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
                <button className="ce-panel-header-btn" onClick={() => setPanelCollapsed(true)} title="收起属性面板">▶</button>
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
            </>
          )}
        </aside>

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
