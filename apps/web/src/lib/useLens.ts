import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { EntityRelationType } from '@jachaikori/schema';

export type RelationCategoryId = 'all' | 'structure' | 'stance' | 'economy' | 'law' | 'diplomacy';

export const RELATION_CATEGORY_TYPES: Record<Exclude<RelationCategoryId, 'all'>, readonly EntityRelationType[]> = {
  structure: [
    'holds_role',
    'affiliated_with',
    'part_of',
    'appointed_or_elected',
    'resigned_or_removed',
  ],
  stance: [
    'quoted_about',
    'supported_or_endorsed',
    'criticized_or_opposed',
    'demanded_or_urged',
  ],
  economy: [
    'signed_deal_or_agreed',
    'funded_or_invested',
    'regulated_or_directed',
  ],
  law: [
    'investigated_or_charged',
    'ruled_or_sentenced',
  ],
  diplomacy: [
    'met_with',
    'diplomatic_action',
    'incident_at',
  ],
};

export function categoryToTypeParam(cat?: RelationCategoryId | null): string | undefined {
  if (!cat || cat === 'all') return undefined;
  return RELATION_CATEGORY_TYPES[cat].join(',');
}

export interface Lens {
  from?: string;
  to?: string;
  with?: string;
  role?: string;
  cat?: RelationCategoryId;
  sort?: 'recent' | 'salience';
  hubs: boolean;
}

export const lensQuery = {
  articles: (l: Lens) => ({
    with: l.with,
    role: l.role,
    from: l.from,
    to: l.to,
    sort: l.sort ?? 'recent',
  }),
  relations: (l: Lens) => ({
    from: l.from,
    to: l.to,
    includeHubs: l.hubs,
    type: categoryToTypeParam(l.cat),
  }),
  ego: (l: Lens) => ({
    from: l.from,
    to: l.to,
    includeHubs: l.hubs,
  }),
  activity: () => ({}),
};

export function withNeighbour<R extends { otherEntity: { id: string } }>(rows: R[], l: Lens): R[] {
  return l.with ? rows.filter((r) => r.otherEntity.id === l.with) : rows;
}

export function isLensActive(l: Lens): boolean {
  return Boolean(l.from || l.to || l.with || l.role || (l.cat && l.cat !== 'all') || l.hubs);
}

const VALID_CATS = new Set<string>(['all', 'structure', 'stance', 'economy', 'law', 'diplomacy']);

export function parseLensFromParams(sp: URLSearchParams): Lens {
  const rawCat = sp.get('cat');
  const cat = rawCat && VALID_CATS.has(rawCat) ? (rawCat as RelationCategoryId) : undefined;
  const rawSort = sp.get('sort');
  const sort = rawSort === 'salience' ? 'salience' : rawSort === 'recent' ? 'recent' : undefined;
  return {
    from: sp.get('from') || undefined,
    to: sp.get('to') || undefined,
    with: sp.get('with') || undefined,
    role: sp.get('role') || undefined,
    cat,
    sort,
    hubs: sp.get('hubs') === '1',
  };
}

export function applyLensPatch(
  prev: URLSearchParams,
  patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>
): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === false || v === '' || (k === 'cat' && v === 'all')) {
      next.delete(k);
    } else if (k === 'hubs') {
      next.set('hubs', '1');
    } else {
      next.set(k, String(v));
    }
  }
  return next;
}

export function useLens() {
  const [sp, setSp] = useSearchParams();
  const lens = useMemo(() => parseLensFromParams(sp), [sp]);

  const setLens = useCallback(
    (patch: Partial<Record<keyof Lens, string | boolean | null | undefined>>) => {
      setSp((prev) => applyLensPatch(prev, patch), { replace: true });
    },
    [setSp]
  );

  const clearLens = useCallback(() => {
    setSp(
      (prev) =>
        applyLensPatch(prev, {
          from: null,
          to: null,
          with: null,
          role: null,
          cat: null,
          hubs: false,
        }),
      { replace: true }
    );
  }, [setSp]);

  return [lens, setLens, clearLens] as const;
}
