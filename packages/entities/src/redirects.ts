/**
 * @file packages/entities/src/redirects.ts
 * Computes stable event_redirect mappings when event_cluster IDs change across re-clustering runs.
 */

export interface EventRedirect {
  oldId: string;
  newId: string;
}

/**
 * Given previous and next `articleId -> eventId` maps taken before and after re-clustering,
 * emits redirects for every old event ID whose articles moved predominantly (>= minOverlap)
 * into a different new event ID.
 */
export function buildRedirects(
  prev: Map<string, string>,
  next: Map<string, string>,
  minOverlap = 0.5
): EventRedirect[] {
  const sizes = new Map<string, number>();
  const hits = new Map<string, Map<string, number>>();

  for (const [articleId, oldId] of prev) {
    sizes.set(oldId, (sizes.get(oldId) ?? 0) + 1);
    const newId = next.get(articleId);
    if (!newId) continue;
    let m = hits.get(oldId);
    if (!m) {
      m = new Map<string, number>();
      hits.set(oldId, m);
    }
    m.set(newId, (m.get(newId) ?? 0) + 1);
  }

  const out: EventRedirect[] = [];
  for (const [oldId, m] of hits) {
    let bestNewId = '';
    let bestCount = 0;
    for (const [newId, count] of m) {
      if (count > bestCount || (count === bestCount && newId < bestNewId)) {
        bestNewId = newId;
        bestCount = count;
      }
    }
    const oldSize = sizes.get(oldId) ?? 0;
    if (bestNewId && bestNewId !== oldId && oldSize > 0 && bestCount / oldSize >= minOverlap) {
      out.push({ oldId, newId: bestNewId });
    }
  }
  return out;
}
