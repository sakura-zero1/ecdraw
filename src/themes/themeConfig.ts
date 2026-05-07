export type ThemeId =
  | 'light-default'
  | 'light-warm'
  | 'light-mint'
  | 'dark-pro'
  | 'dark-midnight'
  | 'dark-forest';

export interface ThemeVars {
  /* Gray scale */
  '--gray-900': string;
  '--gray-700': string;
  '--gray-500': string;
  '--gray-400': string;
  '--gray-300': string;
  '--gray-200': string;
  '--gray-100': string;
  '--gray-50': string;
  '--gray-25': string;
  /* Accent */
  '--accent': string;
  '--accent-hover': string;
  '--accent-soft': string;
  /* Semantic */
  '--success': string;
  '--success-soft': string;
  '--warning': string;
  '--warning-soft': string;
  '--danger': string;
  '--danger-soft': string;
  '--info': string;
  /* Surfaces */
  '--surface': string;
  '--surface-elevated': string;
  '--surface-overlay': string;
  /* Shadows */
  '--shadow-sm': string;
  '--shadow': string;
  '--shadow-lg': string;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  mode: 'light' | 'dark';
  previewColors: string[]; // 3 colors shown in the switcher chip
}

const lightGray = {
  '--gray-900': '#1a1a1a',
  '--gray-700': '#444444',
  '--gray-500': '#888888',
  '--gray-400': '#aaaaaa',
  '--gray-300': '#cccccc',
  '--gray-200': '#e5e5e5',
  '--gray-100': '#f0f0f0',
  '--gray-50': '#f5f5f5',
  '--gray-25': '#fafbfc',
};

const darkGray = {
  '--gray-900': '#eceded',
  '--gray-700': '#b0b3b8',
  '--gray-500': '#6b7078',
  '--gray-400': '#535961',
  '--gray-300': '#3a3f48',
  '--gray-200': '#2a2d35',
  '--gray-100': '#1f2127',
  '--gray-50': '#181a1f',
  '--gray-25': '#131519',
};

type DeepPartial<T> = { [P in keyof T]?: string };

function build(vars: DeepPartial<ThemeVars>): ThemeVars {
  return vars as ThemeVars;
}

export const THEMES: Record<ThemeId, ThemeVars> = {
  /* ===== Light Themes ===== */

  'light-default': build({
    ...lightGray,
    '--accent': '#e11d48',
    '--accent-hover': '#be123c',
    '--accent-soft': 'rgba(225,29,72,0.06)',
    '--success': '#16a34a',
    '--success-soft': '#f0fdf4',
    '--warning': '#d97706',
    '--warning-soft': '#fffbeb',
    '--danger': '#dc2626',
    '--danger-soft': '#fef2f2',
    '--info': '#0284c7',
    '--surface': '#ffffff',
    '--surface-elevated': '#fafbfc',
    '--surface-overlay': 'rgba(255,255,255,0.94)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.04)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.06)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.08)',
  }),

  'light-warm': build({
    ...lightGray,
    '--gray-25': '#fefdfb',
    '--gray-50': '#fdf9f4',
    '--gray-100': '#f8f0e5',
    '--accent': '#d97706',
    '--accent-hover': '#b45309',
    '--accent-soft': 'rgba(217,119,6,0.07)',
    '--success': '#15803d',
    '--success-soft': '#f0fdf5',
    '--warning': '#d97706',
    '--warning-soft': '#fffbeb',
    '--danger': '#b91c1c',
    '--danger-soft': '#fef5f5',
    '--info': '#0369a1',
    '--surface': '#ffffff',
    '--surface-elevated': '#fefdfb',
    '--surface-overlay': 'rgba(254,253,251,0.95)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.03)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.05)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.07)',
  }),

  'light-mint': build({
    ...lightGray,
    '--gray-25': '#f9fdfb',
    '--gray-50': '#f3faf7',
    '--gray-100': '#e8f5ef',
    '--accent': '#0d9488',
    '--accent-hover': '#0f766e',
    '--accent-soft': 'rgba(13,148,136,0.06)',
    '--success': '#059669',
    '--success-soft': '#ecfdf7',
    '--warning': '#d97706',
    '--warning-soft': '#fffbeb',
    '--danger': '#dc2626',
    '--danger-soft': '#fef2f2',
    '--info': '#0284c7',
    '--surface': '#ffffff',
    '--surface-elevated': '#f9fdfb',
    '--surface-overlay': 'rgba(249,253,251,0.95)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.03)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.05)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.07)',
  }),

  /* ===== Dark Themes ===== */

  'dark-pro': build({
    ...darkGray,
    '--accent': '#60a5fa',
    '--accent-hover': '#93bbfd',
    '--accent-soft': 'rgba(96,165,250,0.12)',
    '--success': '#4ade80',
    '--success-soft': 'rgba(74,222,128,0.1)',
    '--warning': '#fbbf24',
    '--warning-soft': 'rgba(251,191,36,0.1)',
    '--danger': '#f87171',
    '--danger-soft': 'rgba(248,113,113,0.1)',
    '--info': '#38bdf8',
    '--surface': '#1a1d23',
    '--surface-elevated': '#1f2127',
    '--surface-overlay': 'rgba(26,29,35,0.94)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.2)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.3)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.4)',
  }),

  'dark-midnight': build({
    ...darkGray,
    '--gray-25': '#0f1420',
    '--gray-50': '#141a2b',
    '--gray-100': '#1a2140',
    '--accent': '#a78bfa',
    '--accent-hover': '#c4b5fd',
    '--accent-soft': 'rgba(167,139,250,0.12)',
    '--success': '#4ade80',
    '--success-soft': 'rgba(74,222,128,0.1)',
    '--warning': '#fbbf24',
    '--warning-soft': 'rgba(251,191,36,0.1)',
    '--danger': '#f87171',
    '--danger-soft': 'rgba(248,113,113,0.1)',
    '--info': '#38bdf8',
    '--surface': '#111827',
    '--surface-elevated': '#141a2b',
    '--surface-overlay': 'rgba(17,24,39,0.95)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.25)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.35)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.45)',
  }),

  'dark-forest': build({
    ...darkGray,
    '--gray-25': '#101812',
    '--gray-50': '#161f19',
    '--gray-100': '#1c2a20',
    '--accent': '#34d399',
    '--accent-hover': '#6ee7b7',
    '--accent-soft': 'rgba(52,211,153,0.12)',
    '--success': '#4ade80',
    '--success-soft': 'rgba(74,222,128,0.1)',
    '--warning': '#fbbf24',
    '--warning-soft': 'rgba(251,191,36,0.1)',
    '--danger': '#f87171',
    '--danger-soft': 'rgba(248,113,113,0.1)',
    '--info': '#38bdf8',
    '--surface': '#141a16',
    '--surface-elevated': '#161f19',
    '--surface-overlay': 'rgba(20,26,22,0.95)',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.25)',
    '--shadow': '0 2px 8px rgba(0,0,0,0.35)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.45)',
  }),
};

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  'light-default': {
    id: 'light-default',
    name: '默认浅色',
    mode: 'light',
    previewColors: ['#fafbfc', '#ffffff', '#e11d48'],
  },
  'light-warm': {
    id: 'light-warm',
    name: '暖阳',
    mode: 'light',
    previewColors: ['#fefdfb', '#fdf9f4', '#d97706'],
  },
  'light-mint': {
    id: 'light-mint',
    name: '薄荷',
    mode: 'light',
    previewColors: ['#f9fdfb', '#f3faf7', '#0d9488'],
  },
  'dark-pro': {
    id: 'dark-pro',
    name: '暗黑专业',
    mode: 'dark',
    previewColors: ['#131519', '#1a1d23', '#60a5fa'],
  },
  'dark-midnight': {
    id: 'dark-midnight',
    name: '午夜蓝',
    mode: 'dark',
    previewColors: ['#0f1420', '#141a2b', '#a78bfa'],
  },
  'dark-forest': {
    id: 'dark-forest',
    name: '深林绿',
    mode: 'dark',
    previewColors: ['#101812', '#161f19', '#34d399'],
  },
};

export const DEFAULT_THEME: ThemeId = 'light-default';
