import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { THEME_META, type ThemeId } from '../../themes/themeConfig';
import './ThemeSwitcher.css';

const LIGHT_THEMES: ThemeId[] = ['light-default', 'light-warm', 'light-mint'];
const DARK_THEMES: ThemeId[] = ['dark-pro', 'dark-midnight', 'dark-forest'];

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const modeLabel = THEME_META[theme].mode === 'dark' ? '深色' : '浅色';

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className="theme-switcher-btn"
        onClick={() => setOpen(!open)}
        title={`当前：${THEME_META[theme].name}（${modeLabel}）`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a10 10 0 0 1 0 20" fill="currentColor" opacity="0.3" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="12" y1="2" x2="12" y2="22" />
        </svg>
      </button>

      {open && (
        <div className="theme-dropdown">
          <div className="theme-dropdown-title">选择皮肤</div>

          <div className="theme-section-label">浅色</div>
          <div className="theme-options">
            {LIGHT_THEMES.map((id) => (
              <ThemeOption
                key={id}
                id={id}
                active={theme === id}
                onClick={() => { setTheme(id); setOpen(false); }}
              />
            ))}
          </div>

          <div className="theme-section-label">深色</div>
          <div className="theme-options">
            {DARK_THEMES.map((id) => (
              <ThemeOption
                key={id}
                id={id}
                active={theme === id}
                onClick={() => { setTheme(id); setOpen(false); }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeOption({ id, active, onClick }: { id: ThemeId; active: boolean; onClick: () => void }) {
  const meta = THEME_META[id];
  return (
    <button className={`theme-option${active ? ' active' : ''}`} onClick={onClick}>
      <span className="theme-option-swatch" aria-hidden>
        {meta.previewColors.map((color, i) => (
          <span
            key={i}
            className="theme-swatch-dot"
            style={{ background: color, boxShadow: i === 2 ? `0 0 0 1px ${color}40` : undefined }}
          />
        ))}
      </span>
      <span className="theme-option-name">{meta.name}</span>
      {active && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}
