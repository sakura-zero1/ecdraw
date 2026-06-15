import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComponentStore } from '../../stores/useComponentStore';
import { useConnectionStore } from '../../stores/useConnectionStore';
import { useDragStore } from '../../stores/useDragStore';
import { CATEGORY_LABELS, CATEGORIES } from '../../constants/categories';
import type { ComponentCategory, ConnectivityMatrix, ElectricalComponent, CategoryInfo } from '../../types';
import {
  createComponentByApi,
  deleteComponentByApi,
  duplicateComponentByApi,
  fetchComponentLibrary,
  saveComponentVersionByApi,
  updateComponentMetaByApi,
  fetchCategories,
  createCategory,
  deleteCategory,
  updateCategoryVisibility,
  renameCategory,
} from '../../services/componentApi';
import SvgCanvas from '../canvas/ComponentCanvas';
import PropertyPanel from '../panels/PropertyPanel';
import PinListPanel from '../panels/PinListPanel';
import ConnectivityMatrixPanel from '../panels/ConnectivityMatrixPanel';
import CollapsibleSection from '../panels/CollapsibleSection';
import ComponentThumbnail from '../panels/ComponentThumbnail';
import './AppLayout.css';

type PanelTab = 'property' | 'pins';

function matrixListToMap(list: ConnectivityMatrix[]) {
  return list.reduce<Record<string, ConnectivityMatrix>>((acc, matrix) => {
    acc[matrix.componentId] = matrix;
    return acc;
  }, {});
}

const PRESET_COLORS = ['#22c55e', '#3b82f6', '#6b7280', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];

/** 在文本中高亮命中的搜索关键词（大小写不敏感，仅高亮首个匹配段）。 */
function highlightMatch(text: string, keyword: string) {
  if (!keyword) return text;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hl">{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  );
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
  const [deleteCatTarget, setDeleteCatTarget] = useState<CategoryInfo | null>(null);

  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [catLabel, setCatLabel] = useState('');
  const [catColor, setCatColor] = useState('#6b7280');
  const [categoryList, setCategoryList] = useState<CategoryInfo[]>([]);

  const [storageMode, setStorageMode] = useState<'api' | 'local'>('local');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_syncStatus, setSyncStatus] = useState('本地模式');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }, []);

  const [activeTab, setActiveTab] = useState<PanelTab>('property');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('ce-collapsed-categories');
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatLabel, setEditingCatLabel] = useState('');
  const editingInputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  const lastVersionSignaturesRef = useRef<Record<string, string>>({});
  const lastMetaSignaturesRef = useRef<Record<string, string>>({});

  // Merged category list: dynamic from API + fallback to built-in constants
  const allCategories = useMemo(() => {
    if (categoryList.length > 0) return categoryList;
    return CATEGORIES.map((name) => ({
      id: name,
      name,
      label: CATEGORY_LABELS[name] ?? name,
      color: '#6b7280',
      builtIn: true,
      visible: true,
    }));
  }, [categoryList]);

  const categoryOrder = useMemo(() => allCategories.map((c) => c.name), [allCategories]);
  const categoryLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of allCategories) m[c.name] = c.label;
    return m;
  }, [allCategories]);
  const categoryColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of allCategories) m[c.name] = c.color;
    return m;
  }, [allCategories]);

  useEffect(() => {
    try {
      localStorage.setItem('ce-collapsed-categories', JSON.stringify(collapsedCategories));
    } catch {
      // 忽略 localStorage 写入失败（隐私模式等）
    }
  }, [collapsedCategories]);

  // 选中元件变化时，将其卡片滚动到列表可视区
  useEffect(() => {
    if (!activeComponentId) return;
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeComponentId]);

  const normalizedKeyword = searchKeyword.trim().toLowerCase();
  const isSearching = normalizedKeyword.length > 0;
  const visibleComponents = useMemo(
    () =>
      normalizedKeyword
        ? components.filter((c) => {
            const keywords = [c.name, c.description ?? '', categoryLabelMap[c.category] ?? c.category];
            return keywords.some((value) => value.toLowerCase().includes(normalizedKeyword));
          })
        : components,
    [components, normalizedKeyword, categoryLabelMap]
  );

  const groupedComponents = useMemo(() => {
    const acc: Record<string, typeof components> = {};
    for (const cat of categoryOrder) acc[cat] = [];
    for (const comp of visibleComponents) {
      const cat = comp.category || 'junctionPoint';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(comp);
    }
    return acc;
  }, [visibleComponents, categoryOrder]);

  const loadCategoriesFromApi = useCallback(async () => {
    try {
      const cats = await fetchCategories();
      setCategoryList(cats);
    } catch {
      // fallback to built-in constants
    }
  }, []);

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

    await loadCategoriesFromApi();
  }, [loadComponents, loadMatrices, loadCategoriesFromApi]);

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
      displayWidth: activeComponent.displayWidth,
      displayHeight: activeComponent.displayHeight,
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
    const targetName = newName || categoryLabelMap[newCategory] || newCategory;
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
        showToast('删除失败，请检查网络或重新登录');
        setDeleteTarget(null);
        return;
      }
    }
    removeComponent(comp.id);
    setDeleteTarget(null);
  };

  const handleSave = async () => {
    if (storageMode !== 'api') {
      showToast('本地模式，无法保存到云端');
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
        width: comp.width, height: comp.height, displayWidth: comp.displayWidth, displayHeight: comp.displayHeight, shapeElements: comp.shapeElements, pins: comp.pins, matrix,
      });
      lastMetaSignaturesRef.current[comp.id] = JSON.stringify({
        name: comp.name, category: comp.category, description: comp.description,
      });
      showToast('保存成功');
    } catch {
      showToast('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCategory = async () => {
    const label = catLabel.trim();
    if (!label) return;
    const name = label.replace(/\s+/g, '');
    try {
      await createCategory(name, label, catColor);
      await loadCategoriesFromApi();
      setShowCategoryDialog(false);
      setCatLabel('');
      setCatColor('#6b7280');
      showToast(`类别「${label}」已创建`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '创建类别失败');
    }
  };

  const handleDeleteCategory = async (cat: CategoryInfo) => {
    if (cat.builtIn) return;
    try {
      await deleteCategory(cat.id);
      await Promise.all([loadCategoriesFromApi(), hydrateFromApi()]);
      showToast(`类别「${cat.label}」已删除`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除类别失败');
    }
  };

  const handleToggleCategoryVisibility = async (cat: CategoryInfo) => {
    const newVisible = !cat.visible;
    try {
      await updateCategoryVisibility(cat.id, newVisible);
      await loadCategoriesFromApi();
      showToast(`类别「${cat.label}」${newVisible ? '已显示' : '已隐藏'}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新类别可见性失败');
    }
  };

  const handleStartRename = (cat: CategoryInfo) => {
    setEditingCatId(cat.id);
    setEditingCatLabel(cat.label);
    setTimeout(() => editingInputRef.current?.select(), 0);
  };

  const handleFinishRename = async () => {
    if (!editingCatId) return;
    const trimmed = editingCatLabel.trim();
    if (!trimmed) {
      setEditingCatId(null);
      return;
    }
    const cat = allCategories.find((c) => c.id === editingCatId);
    if (cat && trimmed === cat.label) {
      setEditingCatId(null);
      return;
    }
    try {
      await renameCategory(editingCatId, trimmed);
      await loadCategoriesFromApi();
      showToast(`类别已重命名为「${trimmed}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '重命名失败，名称可能已存在');
    }
    setEditingCatId(null);
  };

  // Global mouse-based drag for component import (replaces HTML5 DnD for WebView2 compat)
  const drag = useDragStore();
  useEffect(() => {
    const onMove = (e: MouseEvent) => drag.moveGhost(e.clientX, e.clientY);
    const onUp = () => drag.endDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  return (
    <div className="app-layout">
      {toast && <div className="ce-toast">{toast}</div>}
      <aside className="sidebar">
            <div className="sidebar-header">
              <span>元件列表</span>
              <div className="ce-panel-header-actions">
                <span className="count-badge">
                  {normalizedKeyword ? `${visibleComponents.length}/${components.length}` : components.length}
                </span>
              </div>
            </div>
          <div className="sidebar-search">
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索名称/描述/分类"
            />
            <button className="btn btn-sm" onClick={() => setShowNewDialog(true)} style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>+ 新建</button>
            <button className="btn btn-sm" onClick={() => setShowCategoryDialog(true)} style={{ marginLeft: 4, whiteSpace: 'nowrap' }} title="新建类别">+ 类别</button>
          </div>
          <div className="sidebar-actions">
            <button
              className="btn btn-sm btn-primary"
              data-testid="save-btn"
              disabled={saving || storageMode !== 'api'}
              onClick={() => void handleSave()}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                void (async () => {
                  try {
                    await hydrateFromApi();
                    showToast('刷新成功');
                  } catch {
                    setStorageMode('local');
                    showToast('刷新失败');
                  }
                })();
              }}
            >
              刷新
            </button>
          </div>
          <div className="component-list">
            {components.length === 0 && <div className="empty-hint">暂无元件，点击"+ 新建"开始绘制</div>}
            {components.length > 0 && visibleComponents.length === 0 && (
              <div className="empty-hint">未找到匹配项，调整关键词后重试</div>
            )}

            {categoryOrder.map((cat) => {
              const items = groupedComponents[cat] ?? [];
              // 搜索时隐藏无命中的空分类，避免列表被空标题占满
              if (isSearching && items.length === 0) return null;
              // 搜索时强制展开，确保命中项不会被折叠状态藏起来
              const collapsed = isSearching ? false : collapsedCategories[cat];
              const label = categoryLabelMap[cat] ?? cat;
              const color = categoryColorMap[cat] ?? '#6b7280';
              const catInfo = allCategories.find((c) => c.name === cat);
              const isEditing = catInfo && editingCatId === catInfo.id;
              return (
                <div key={cat} className="category-group">
                  <button
                    className="category-header"
                    onClick={() => setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                    title={collapsed ? `展开${label}` : `收起${label}`}
                    onDoubleClick={(e) => { e.stopPropagation(); if (catInfo) handleStartRename(catInfo); }}
                  >
                    <span className={`category-arrow ${collapsed ? '' : 'open'}`}>▸</span>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                      <circle cx="8" cy="8" r="6" fill={color} opacity="0.18" />
                      <circle cx="8" cy="8" r="3" fill={color} />
                    </svg>
                    {isEditing ? (
                      <input
                        ref={editingInputRef}
                        className="category-rename-input"
                        value={editingCatLabel}
                        onChange={(e) => setEditingCatLabel(e.target.value)}
                        onBlur={() => void handleFinishRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void handleFinishRename(); }
                          if (e.key === 'Escape') { setEditingCatId(null); }
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="category-title">{label}</span>
                    )}
                    <span className="category-count">{items.length}</span>
                    {catInfo && (
                      <span
                        className={`category-vis-btn ${catInfo.visible !== false ? '' : 'hidden-cat'}`}
                        title={catInfo.visible !== false ? '在图纸编辑器中隐藏此类别' : '在图纸编辑器中显示此类别'}
                        onClick={(e) => { e.stopPropagation(); void handleToggleCategoryVisibility(catInfo); }}
                      >
                        {catInfo.visible !== false ? '👁' : '👁‍🗨'}
                      </span>
                    )}
                    {catInfo && !catInfo.builtIn && (
                      <span
                        className="category-delete-btn"
                        title="删除类别"
                        onClick={(e) => { e.stopPropagation(); setDeleteCatTarget(catInfo); }}
                      >✕</span>
                    )}
                  </button>

                  {!collapsed && (
                    <div className="component-list-items">
                    {items.map((comp) => (
                      <div
                        key={comp.id}
                        ref={comp.id === activeComponentId ? activeItemRef : undefined}
                        className={`component-item ${comp.id === activeComponentId ? 'active' : ''} ${drag.active && drag.draggingId === comp.id ? 'dragging' : ''}`}
                        onClick={() => { if (!drag.active) setActiveComponent(comp.id); }}
                        onMouseDown={(e) => {
                          if (comp.id === activeComponentId) return;
                          if ((e.target as HTMLElement).closest('button')) return;
                          e.preventDefault();
                          drag.startDrag(comp.id, e.clientX, e.clientY);
                        }}
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
                          {highlightMatch(comp.name, normalizedKeyword)}
                        </span>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="canvas-area">
          <SvgCanvas onSave={handleSave} />
        </main>

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
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                {allCategories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.label}
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

      {showCategoryDialog && (
        <div className="dialog-overlay" onClick={() => setShowCategoryDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建类别</h3>
            <label>
              类别名称
              <input value={catLabel} onChange={(e) => setCatLabel(e.target.value)} placeholder="如：继电器" />
            </label>
            <label>
              颜色
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCatColor(c)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, padding: 0,
                      border: '2px solid var(--gray-200)',
                      background: c, cursor: 'pointer', position: 'relative',
                    }}
                  >
                    {catColor === c && (
                      <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.3)', fontSize: 10, lineHeight: 1, color: '#16a34a', fontWeight: 700 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </label>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowCategoryDialog(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={!catLabel.trim()}
                onClick={() => void handleCreateCategory()}
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

      {deleteCatTarget && (
        <div className="dialog-overlay" onClick={() => setDeleteCatTarget(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>确认删除类别</h3>
            <p style={{ margin: '12px 0', color: 'var(--color-text-dim)' }}>
              确定要删除类别「{deleteCatTarget.label}」吗？
              {groupedComponents[deleteCatTarget.name]?.length
                ? `该类别下的 ${groupedComponents[deleteCatTarget.name].length} 个元件也将被一并删除。`
                : ''}
              此操作不可撤销。
            </p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteCatTarget(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => { void handleDeleteCategory(deleteCatTarget); setDeleteCatTarget(null); }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      {drag.active && drag.draggingId && (() => {
        const comp = components.find((c) => c.id === drag.draggingId);
        if (!comp) return null;
        return (
          <div
            className="drag-ghost"
            style={{ left: drag.ghostX - 30, top: drag.ghostY - 20 }}
          >
            <ComponentThumbnail component={comp} matrix={matrices[comp.id]} />
          </div>
        );
      })()}
    </div>
  );
}
