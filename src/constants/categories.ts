import type { ComponentCategory } from '../types';

export const BUILTIN_CATEGORIES: ComponentCategory[] = [
  'powerPoint',
  'switchPoint',
  'junctionPoint',
  'loadPoint',
];

export const CATEGORY_LABELS: Record<string, string> = {
  powerPoint: '电源点',
  switchPoint: '分合点',
  junctionPoint: '衔接点',
  loadPoint: '负荷点',
};

export const CATEGORIES = BUILTIN_CATEGORIES;

export const PIN_TYPE_LABELS = {
  input: '输入',
  output: '输出',
  bidirectional: '双向',
  power: '电源',
  ground: '接地',
} as const;
