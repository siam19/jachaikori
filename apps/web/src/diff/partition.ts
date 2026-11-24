import type { ClaimDiffFlag, ClaimDiffItem } from '@jachaikori/schema';

const INLINE_FLAGS = new Set<ClaimDiffFlag>([
  'mismatch_number',
  'mismatch_date',
  'mismatch_speaker',
  'mismatch_quote',
]);

const severityRank = (d: ClaimDiffItem): number =>
  d.severity === 'major' ? 2 : d.severity === 'notable' ? 1 : 0;

export interface InlineDiffEntry {
  d: ClaimDiffItem;
  at: number;
  marker: number;
}

export interface RackDiffEntry {
  d: ClaimDiffItem;
  marker: number;
}

export interface PartitionedDiffs {
  inline: InlineDiffEntry[];
  rack: RackDiffEntry[];
  matches: ClaimDiffItem[];
}

/**
 * Partitions a source's diffs into inline Proof Strip swaps and Rack rows directly beneath.
 * Guarantees the nothing-dropped invariant: every non-`match` diff lands in either
 * `inline` or `rack` (overlapping spans are demoted to `rack`, never silently dropped).
 */
export function partitionDiffs(headline: string, diffs: ClaimDiffItem[]): PartitionedDiffs {
  const matches = diffs.filter((d) => d.flag === 'match');
  const real = diffs.filter((d) => d.flag !== 'match');

  const cands = real.map((d) => ({
    d,
    at:
      headline && d.cardSpan && d.articleSpan && INLINE_FLAGS.has(d.flag)
        ? headline.indexOf(d.cardSpan)
        : -1,
  }));

  const rawRack: ClaimDiffItem[] = cands.filter((c) => c.at < 0).map((c) => c.d);
  const rawInline: Array<{ d: ClaimDiffItem; at: number }> = [];

  let end = 0;
  for (const c of cands.filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)) {
    if (c.at < end) {
      rawRack.push(c.d);
      continue;
    }
    rawInline.push({ d: c.d, at: c.at });
    end = c.at + c.d.cardSpan!.length;
  }

  rawRack.sort((a, b) => severityRank(b) - severityRank(a));

  const inline: InlineDiffEntry[] = rawInline.map((item, idx) => ({
    ...item,
    marker: idx + 1,
  }));
  const rack: RackDiffEntry[] = rawRack.map((d, idx) => ({
    d,
    marker: inline.length + idx + 1,
  }));

  if (import.meta.env.DEV) {
    console.assert(inline.length + rack.length === real.length, 'partitionDiffs dropped a diff');
  }

  return { inline, rack, matches };
}

export const CIRCLED_MARKERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const;

export function formatMarker(n: number): string {
  return CIRCLED_MARKERS[n - 1] ?? `(${n})`;
}
