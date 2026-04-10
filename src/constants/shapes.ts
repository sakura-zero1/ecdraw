import type { ComponentCategory } from '../types';

export const PREDEFINED_SHAPES: Partial<Record<ComponentCategory, { svg: string; width: number; height: number }>> = {
  powerPoint: {
    width: 100,
    height: 100,
    svg: `<circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="50" y1="10" x2="50" y2="30" stroke="currentColor" stroke-width="2"/>
<line x1="50" y1="70" x2="50" y2="90" stroke="currentColor" stroke-width="2"/>
<line x1="10" y1="50" x2="30" y2="50" stroke="currentColor" stroke-width="2"/>
<line x1="70" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="2"/>`,
  },
  switchPoint: {
    width: 120,
    height: 60,
    svg: `<line x1="8" y1="30" x2="40" y2="30" stroke="currentColor" stroke-width="2"/>
<line x1="80" y1="30" x2="112" y2="30" stroke="currentColor" stroke-width="2"/>
<circle cx="40" cy="30" r="4" fill="currentColor"/>
<circle cx="80" cy="30" r="4" fill="currentColor"/>
<line x1="44" y1="26" x2="78" y2="16" stroke="currentColor" stroke-width="2"/>`,
  },
  junctionPoint: {
    width: 90,
    height: 90,
    svg: `<line x1="45" y1="8" x2="45" y2="82" stroke="currentColor" stroke-width="2"/>
<line x1="8" y1="45" x2="82" y2="45" stroke="currentColor" stroke-width="2"/>
<circle cx="45" cy="45" r="5" fill="currentColor"/>`,
  },
  loadPoint: {
    width: 110,
    height: 70,
    svg: `<rect x="18" y="12" width="74" height="46" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
<line x1="0" y1="35" x2="18" y2="35" stroke="currentColor" stroke-width="2"/>
<line x1="92" y1="35" x2="110" y2="35" stroke="currentColor" stroke-width="2"/>`,
  },
};
