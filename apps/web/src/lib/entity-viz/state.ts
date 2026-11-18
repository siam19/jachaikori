import type { Lang } from './types';

export interface ViewState {
  entity: string;
  with: string[]; // extra entities: intersect their events
  from: string;
  to: string;
  lang: Lang;
}

export function readState(url: URL, defaults: { from: string; to: string }): Omit<ViewState, 'entity'> {
  const p = url.searchParams;
  return {
    with: p.getAll('with'),
    from: p.get('from') ?? defaults.from,
    to: p.get('to') ?? defaults.to,
    lang: p.get('lang') === 'en' ? 'en' : 'bn',
  };
}

export function toSearch(s: ViewState): string {
  const p = new URLSearchParams({ from: s.from, to: s.to, lang: s.lang });
  if (s.entity) p.set('entity', s.entity);
  s.with.forEach((id) => p.append('with', id));
  return `?${p}`;
}
