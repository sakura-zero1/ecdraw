import { useEffect, useState, useMemo } from 'react';
import { fetchComponentLibrary } from '../../services/componentApi';
import { CATEGORIES, CATEGORY_LABELS } from '../../constants/categories';
import type { ElectricalComponent } from '../../types';

// ---------- Category icon (simple SVG) ----------

const CATEGORY_ICONS: Record<string, string> = {
  powerPoint: '#22c55e',
  switchPoint: '#3b82f6',
  junctionPoint: '#6b7280',
  loadPoint: '#f97316',
};

function CategoryIcon({ category }: { category: string }) {
  const color = CATEGORY_ICONS[category] || '#6b7280';
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
}

// ---------- Component ----------

export default function ComponentLibraryPanel(_props: ComponentLibraryPanelProps) {
  const [components, setComponents] = useState<ElectricalComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchComponentLibrary()
      .then(({ components: comps }) => {
        if (!cancelled) setComponents(comps);
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

  const filteredComponents = useMemo(() => {
    if (!search.trim()) return components;
    const q = search.trim().toLowerCase();
    return components.filter((c) => c.name.toLowerCase().includes(q));
  }, [components, search]);

  const grouped = useMemo(() => {
    const map: Record<string, ElectricalComponent[]> = {};
    for (const cat of CATEGORIES) {
      map[cat] = [];
    }
    for (const comp of filteredComponents) {
      const cat = comp.category || 'junctionPoint';
      if (!map[cat]) map[cat] = [];
      map[cat].push(comp);
    }
    return map;
  }, [filteredComponents]);

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

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, componentId: string) => {
    e.dataTransfer.setData('text/plain', componentId);
    e.dataTransfer.effectAllowed = 'copy';
  };

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

        {CATEGORIES.map((cat) => {
          const catComponents = grouped[cat] || [];
          const isCollapsed = collapsedCategories.has(cat);
          const label = CATEGORY_LABELS[cat];

          return (
            <div key={cat} className="de-lib-category">
              <button
                className="de-lib-cat-header"
                onClick={() => toggleCategory(cat)}
              >
                <span className={`de-lib-cat-arrow ${isCollapsed ? '' : 'open'}`}>
                  &#9654;
                </span>
                <CategoryIcon category={cat} />
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
                      draggable
                      onDragStart={(e) => handleDragStart(e, comp.id)}
                      title={comp.description || comp.name}
                    >
                      <CategoryIcon category={comp.category} />
                      <span className="de-lib-item-name">{comp.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
