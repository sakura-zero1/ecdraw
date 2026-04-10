import { useMemo, useState } from 'react';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { CATEGORY_LABELS, CATEGORIES } from '../../constants/categories';
import type { ComponentCategory } from '../../types';
import SvgCanvas from '../canvas/SvgCanvas';
import PropertyPanel from '../panels/PropertyPanel';
import PinListPanel from '../panels/PinListPanel';
import ConnectivityMatrixPanel from '../panels/ConnectivityMatrixPanel';
import CollapsibleSection from '../panels/CollapsibleSection';
import './AppLayout.css';

type PanelTab = 'property' | 'pins';

export default function AppLayout() {
  const { components, activeComponentId, addComponent, setActiveComponent, duplicateComponent } = useComponentStore();
  const activeComponent = components.find((c) => c.id === activeComponentId);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ComponentCategory>('junctionPoint');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('property');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<ComponentCategory, boolean>>(
    () =>
      CATEGORIES.reduce((acc, cat) => {
        acc[cat] = false;
        return acc;
      }, {} as Record<ComponentCategory, boolean>)
  );

  const groupedComponents = useMemo(
    () =>
      CATEGORIES.reduce((acc, cat) => {
        acc[cat] = components.filter((c) => c.category === cat);
        return acc;
      }, {} as Record<ComponentCategory, typeof components>),
    [components]
  );

  const handleAddComponent = () => {
    addComponent(newName || CATEGORY_LABELS[newCategory], newCategory, 1200, 800);
    setShowNewDialog(false);
    setNewName('');
  };

  return (
    <div className="app-layout">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">ECDraw</h1>
          <span className="app-subtitle">电气元件绘制工具</span>
        </div>

        <div className="toolbar-right">
          <button className="btn" onClick={() => setShowNewDialog(true)}>+ 新建元件</button>
          <button
            className="btn"
            onClick={() => {
              const { components: comps } = useComponentStore.getState();
              const { matrices } = useConnectionStore.getState();
              const data = {
                version: '1.0.0',
                components: comps,
                matrices: Object.values(matrices),
                savedAt: new Date().toISOString(),
              };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'project.ecp.json';
              a.click();
              URL.revokeObjectURL(url);
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
                const text = await file.text();
                const data = JSON.parse(text);
                if (data.components) useComponentStore.getState().loadComponents(data.components);
                if (data.matrices) useConnectionStore.getState().loadMatrices(data.matrices);
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
                <span className="count-badge">{components.length}</span>
                <button className="icon-btn" title="收起列表" onClick={() => setSidebarCollapsed(true)}>◂</button>
              </div>
            </div>
            <div className="component-list">
              {components.length === 0 && <div className="empty-hint">暂无元件，点击“新建元件”开始绘制</div>}

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

                    {!collapsed && items.map((comp) => (
                      <div
                        key={comp.id}
                        className={`component-item ${comp.id === activeComponentId ? 'active' : ''}`}
                        onClick={() => setActiveComponent(comp.id)}
                      >
                        <span className="comp-name" title={comp.name}>{comp.name}</span>
                        <button
                          className="item-action-btn"
                          title="复制元件"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateComponent(comp.id);
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
          <button className="rail-toggle left" title="展开列表" onClick={() => setSidebarCollapsed(false)}>▸</button>
        )}

        <main className="canvas-area">
          <SvgCanvas />
        </main>

        {!panelCollapsed ? (
          <aside className="panel">
            <div className="panel-top">
              {activeComponent ? (
                <div className="panel-tabs">
                  <button className={`tab-btn ${activeTab === 'property' ? 'active' : ''}`} onClick={() => setActiveTab('property')}>元件属性</button>
                  <button className={`tab-btn ${activeTab === 'pins' ? 'active' : ''}`} onClick={() => setActiveTab('pins')}>引脚管理</button>
                </div>
              ) : (
                <div className="panel-title-ghost">元件属性</div>
              )}
              <button className="icon-btn" title="收起属性栏" onClick={() => setPanelCollapsed(true)}>▸</button>
            </div>

            {activeComponent ? (
              <>
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
              </>
            ) : (
              <div className="empty-hint">请选择或新建一个元件</div>
            )}
          </aside>
        ) : (
          <button className="rail-toggle right" title="展开属性栏" onClick={() => setPanelCollapsed(false)}>◂</button>
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
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </label>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewDialog(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleAddComponent}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
