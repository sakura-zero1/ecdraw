import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fetchComponentLibrary, fetchCategories } from '../../services/componentApi';
import { CATEGORIES, CATEGORY_LABELS } from '../../constants/categories';
import type { ElectricalComponent, CategoryInfo } from '../../types';
import ComponentThumbnail, { ComponentPreviewSvg } from '../panels/ComponentThumbnail';

// ---------- Category icon (simple SVG) ----------

function CategoryIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" fill={color} opacity="0.18" />
      <circle cx="8" cy="8" r="3" fill={color} />
    </svg>
  );
}

// ---------- Props ----------

interface ComponentLibraryPanelProps {
  onSelectComponent?: (componentId: string) => void;
  onComponentClick?: (componentId: string) => void;
  headerExtra?: React.ReactNode;
}

// ---------- Component ----------

export default function ComponentLibraryPanel(_props: ComponentLibraryPanelProps) {
  const [components, setComponents] = useState<ElectricalComponent[]>([]);
  const [categoryList, setCategoryList] = useState<CategoryInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [previewComp, setPreviewComp] = useState<ElectricalComponent | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const popupRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleItemMouseEnter = useCallback((e: React.MouseEvent, comp: ElectricalComponent) => {
    const itemRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      setPreviewComp(comp);
      // 先放在右侧，渲染后用 useEffect 校正位置
      setPreviewPos({ x: Math.round(itemRect.right + 8), y: Math.round(itemRect.top) });
    }, 300);
  }, []);

  // 弹窗渲染后校正位置，防止超出视口
  useEffect(() => {
    if (!previewComp || !popupRef.current) return;
    const el = popupRef.current;
    const popRect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = { ...previewPos };

    // 右侧放不下则放到左侧
    if (x + popRect.width > vw - 8) {
      x = Math.max(8, x - popRect.width - 16);
    }
    // 下方超出视口则上移
    if (y + popRect.height > vh - 8) {
      y = Math.max(8, vh - 8 - popRect.height);
    }
    // 上方超出视口
    if (y < 8) y = 8;

    if (x !== previewPos.x || y !== previewPos.y) {
      setPreviewPos({ x, y });
    }
  }, [previewComp, previewPos]);

  const handleItemMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPreviewComp(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setError('');
    Promise.all([fetchComponentLibrary(), fetchCategories()])
      .then(([{ components: comps }, cats]) => {
        if (!cancelled) {
          setComponents(comps);
          setCategoryList(cats);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载元件库失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const visibleCategories = useMemo(() => allCategories.filter((c) => c.visible !== false), [allCategories]);

  const categoryOrder = useMemo(() => visibleCategories.map((c) => c.name), [visibleCategories]);
  const categoryLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of visibleCategories) m[c.name] = c.label;
    return m;
  }, [visibleCategories]);
  const categoryColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of visibleCategories) m[c.name] = c.color;
    return m;
  }, [visibleCategories]);

  const filteredComponents = useMemo(() => {
    if (!search.trim()) return components;
    const q = search.trim().toLowerCase();
    return components.filter((c) => c.name.toLowerCase().includes(q));
  }, [components, search]);

  const grouped = useMemo(() => {
    const map: Record<string, ElectricalComponent[]> = {};
    for (const cat of categoryOrder) map[cat] = [];
    for (const comp of filteredComponents) {
      const cat = comp.category || 'junctionPoint';
      if (!map[cat]) map[cat] = [];
      map[cat].push(comp);
    }
    return map;
  }, [filteredComponents, categoryOrder]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  // Simulate drag via document-level mouse events (reliable across all webviews)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragActivatedRef = useRef(false);
  const DRAG_THRESHOLD = 5;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingIdRef.current || !dragStartPosRef.current) return;
      if (!dragActivatedRef.current) {
        const dx = e.clientX - dragStartPosRef.current.x;
        const dy = e.clientY - dragStartPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        dragActivatedRef.current = true;
        (window as any).__ecdraw_drag = { componentId: draggingIdRef.current, origin: 'library' };
      }
      setGhostPos({ x: e.clientX, y: e.clientY });
    };
    const onUp = () => {
      draggingIdRef.current = null;
      dragStartPosRef.current = null;
      dragActivatedRef.current = false;
      setGhostPos(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleItemMouseDown = useCallback((e: React.MouseEvent, componentId: string) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    draggingIdRef.current = componentId;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragActivatedRef.current = false;
  }, []);

  return (
    <div className="de-lib-panel">
      <div className="de-lib-header">
        <span className="de-lib-title">元件库</span>
        <span className="de-lib-count">{components.length}</span>
      </div>

      <div className="de-lib-search">
        <input
          type="text"
          placeholder="搜索元件..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="de-lib-list">
        {loading && <div className="de-lib-hint">加载中...</div>}
        {error && <div className="de-lib-hint de-lib-error">{error}</div>}
        {!loading && !error && components.length === 0 && (
          <div className="de-lib-hint">暂无元件</div>
        )}

        {categoryOrder.map((cat) => {
          const catComponents = grouped[cat] || [];
          const isCollapsed = collapsedCategories.has(cat);
          const label = categoryLabelMap[cat];
          const color = categoryColorMap[cat] || '#6b7280';

          return (
            <div key={cat} className="de-lib-category">
              <button
                className="de-lib-cat-header"
                onClick={() => toggleCategory(cat)}
              >
                <span className={`de-lib-cat-arrow ${isCollapsed ? '' : 'open'}`}>
                  &#9654;
                </span>
                <CategoryIcon color={color} />
                <span className="de-lib-cat-title">{label}</span>
                <span className="de-lib-cat-count">{catComponents.length}</span>
              </button>

              {!isCollapsed && (
                <div className="de-lib-cat-items">
                  {catComponents.length === 0 && (
                    <div className="de-lib-empty">无元件</div>
                  )}
                  {catComponents.map((comp) => (
                    <div
                      key={comp.id}
                      className="de-lib-item"
                      title={comp.description || comp.name}
                      onMouseDown={(e) => handleItemMouseDown(e, comp.id)}
                      onMouseEnter={(e) => handleItemMouseEnter(e, comp)}
                      onMouseLeave={handleItemMouseLeave}
                    >
                      <ComponentThumbnail component={comp} />
                      <span className="de-lib-item-name">{comp.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewComp && createPortal(
        <div
          ref={popupRef}
          className="de-lib-preview-popup"
          style={{
            position: 'fixed',
            left: previewPos.x,
            top: previewPos.y,
            zIndex: 9999,
          }}
        >
          <div className="de-lib-preview-label">{previewComp.name}</div>
          <ComponentPreviewSvg component={previewComp} />
        </div>,
        document.body,
      )}
      {ghostPos && draggingIdRef.current && (() => {
        const comp = components.find((c) => c.id === draggingIdRef.current);
        if (!comp) return null;
        return (
          <div
            className="drag-ghost"
            style={{ position: 'fixed', left: ghostPos.x - 30, top: ghostPos.y - 20, zIndex: 10000, pointerEvents: 'none' }}
          >
            <ComponentThumbnail component={comp} />
          </div>
        );
      })()}
    </div>
  );
}
