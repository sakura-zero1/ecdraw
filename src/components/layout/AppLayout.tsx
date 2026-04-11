import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { CATEGORY_LABELS, CATEGORIES } from '../../constants/categories';
import type { ComponentCategory, ConnectivityMatrix, ElectricalComponent } from '../../types';
import {
  createComponentByApi,
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
import './AppLayout.css';

type PanelTab = 'property' | 'pins';

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

  const [storageMode, setStorageMode] = useState<'api' | 'local'>('local');
  const [syncStatus, setSyncStatus] = useState('本地模式');

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

  return (
    <div className="app-layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">ECDraw</h1>
          <span className="app-subtitle">电气元件绘制工具 · {syncStatus}</span>
        </div>

        <div className="toolbar-right">
          <button className="btn" onClick={() => setShowNewDialog(true)}>+ 新建元件</button>
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
    </div>
  );
}
