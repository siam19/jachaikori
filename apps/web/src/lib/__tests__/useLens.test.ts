import { describe, expect, it } from 'vitest';
import {
  applyLensPatch,
  categoryToTypeParam,
  lensQuery,
  parseLensFromParams,
  withNeighbour,
} from '../useLens';

describe('useLens helpers & category-to-API mapping', () => {
  it('maps 5 UI categories to canonical comma-separated ?type= lists', () => {
    expect(categoryToTypeParam('all')).toBeUndefined();
    expect(categoryToTypeParam('structure')).toBe(
      'holds_role,affiliated_with,part_of,appointed_or_elected,resigned_or_removed'
    );
    expect(categoryToTypeParam('economy')).toBe(
      'signed_deal_or_agreed,funded_or_invested,regulated_or_directed'
    );
  });

  it('round-trips lens state cleanly through URLSearchParams', () => {
    const initial = new URLSearchParams();
    const patched = applyLensPatch(initial, {
      from: '2026-06-01',
      to: '2026-11-18',
      with: 'ent_bangladesh_bank',
      cat: 'law',
      hubs: true,
    });
    const parsed = parseLensFromParams(patched);
    expect(parsed).toEqual({
      from: '2026-06-01',
      to: '2026-11-18',
      with: 'ent_bangladesh_bank',
      role: undefined,
      cat: 'law',
      sort: undefined,
      hubs: true,
    });
    expect(lensQuery.relations(parsed)).toEqual({
      from: '2026-06-01',
      to: '2026-11-18',
      includeHubs: true,
      type: 'investigated_or_charged,ruled_or_sentenced',
    });
    expect(lensQuery.activity()).toEqual({});
  });

  it('filters relation rows client-side by `with` co-entity', () => {
    const rows = [
      { otherEntity: { id: 'ent_a' }, weight: 10 },
      { otherEntity: { id: 'ent_b' }, weight: 5 },
    ];
    expect(withNeighbour(rows, { with: 'ent_b', hubs: false })).toHaveLength(1);
    expect(withNeighbour(rows, { hubs: false })).toHaveLength(2);
  });
});
