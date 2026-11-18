import * as d3 from 'd3';
import type { EntityNode, EntityType, Lang } from './types';

export const TYPE_COLOR: Record<EntityType, string> = {
  person: '#38bdf8',
  org: '#a78bfa',
  location: '#34d399',
  role: '#fbbf24',
  event_topic: '#f472b6',
};

const TYPE_SYMBOL: Record<EntityType, d3.SymbolType> = {
  person: d3.symbolCircle,
  org: d3.symbolSquare,
  location: d3.symbolDiamond,
  role: d3.symbolTriangle,
  event_topic: d3.symbolStar,
};

export const labelFor = (e: Pick<EntityNode, 'id' | 'label'>, lang: Lang): string =>
  (lang === 'bn' ? e.label.bn ?? e.label.en : e.label.en ?? e.label.bn) ?? e.id;

/** Truncate long labels (e.g. Bangla) for SVG canvas display; full text belongs in <title>. */
export function truncateLabel(text: string, maxLen = 20): string {
  const chars = Array.from(text);
  if (chars.length <= maxLen) return text;
  return `${chars.slice(0, maxLen - 1).join('')}…`;
}

/** SVG path for a type's symbol with the given radius (symbol size is area). */
export const symbolPath = (type: EntityType, r: number): string =>
  d3.symbol(TYPE_SYMBOL[type], Math.PI * r * r)() ?? '';
