/**
 * @file packages/verification/src/diff/cross-outlet.ts
 * Deterministic cross-outlet claim comparison for `GET /events/:id/comparison`:
 * identifies consensus figures, divergent figures, and hedging-strength differences
 * across the accredited outlets covering the same event cluster.
 */

import type {
  CrossOutletDifference,
  OutletId,
  StoredArticleClaim,
} from '@jachaikori/schema';
import {
  formatCanonicalQuantity,
  parseQuantities,
  toBanglaDigits,
  type NumericUnitFamily,
  type ParsedQuantity,
} from './numbers';

export interface OutletClaimsInput {
  outlet: OutletId;
  articleId: string;
  title: string;
  claims: StoredArticleClaim[];
}

export function analyzeCrossOutletDifferences(
  outletItems: OutletClaimsInput[]
): CrossOutletDifference[] {
  if (outletItems.length < 2) return [];
  const differences: CrossOutletDifference[] = [];

  // 1. Compare explicit currency & percentage quantities across distinct outlets
  const byFamily = new Map<
    NumericUnitFamily,
    Array<{ outlet: OutletId; articleId: string; q: ParsedQuantity }>
  >();

  for (const item of outletItems) {
    const spans = [
      ...item.claims.flatMap((c) => c.numbers),
      item.title,
    ];
    const quantities = parseQuantities(spans).filter((q) => q.unitFamily !== 'count');
    for (const q of quantities) {
      const list = byFamily.get(q.unitFamily) ?? [];
      // Keep at most 1 entry per (outlet, canonicalValue)
      if (!list.some((x) => x.outlet === item.outlet && Math.abs(x.q.canonicalValue - q.canonicalValue) <= Math.max(q.canonicalValue * 0.02, 1e-6))) {
        list.push({ outlet: item.outlet, articleId: item.articleId, q });
      }
      byFamily.set(q.unitFamily, list);
    }
  }

  for (const [family, entries] of byFamily.entries()) {
    const distinctOutlets = new Set(entries.map((e) => e.outlet));
    if (distinctOutlets.size < 2) continue;

    // Group quantities within 2% tolerance into value buckets
    const buckets: Array<{ rep: ParsedQuantity; items: typeof entries }> = [];
    for (const e of entries) {
      const match = buckets.find((b) => {
        const denom = Math.max(Math.abs(b.rep.canonicalValue), Math.abs(e.q.canonicalValue), 1e-9);
        return Math.abs(b.rep.canonicalValue - e.q.canonicalValue) / denom <= 0.02;
      });
      if (match) match.items.push(e);
      else buckets.push({ rep: e.q, items: [e] });
    }

    // Consensus bucket shared by >= 2 outlets
    const consensusBuckets = buckets
      .filter((b) => new Set(b.items.map((x) => x.outlet)).size >= 2)
      .sort((a, b) => b.items.length - a.items.length);

    if (consensusBuckets[0]) {
      const b = consensusBuckets[0];
      const outlets = Array.from(new Set(b.items.map((x) => x.outlet)));
      const formatted = formatCanonicalQuantity(b.rep);
      differences.push({
        kind: 'consensus_number',
        outlets,
        summaryEn: `${outlets.length} outlets report the same figure (${formatted}).`,
        summaryBn: `${toBanglaDigits(String(outlets.length))}টি সংবাদমাধ্যম একই সংখ্যা (${toBanglaDigits(formatted)}) উল্লেখ করেছে।`,
        details: b.items.slice(0, 6).map((x) => ({
          outlet: x.outlet,
          articleId: x.articleId,
          span: x.q.raw,
        })),
      });
    }

    // Divergent numeric figures within the same unit family across distinct outlets (within 10x order of magnitude)
    if (buckets.length >= 2) {
      const sorted = buckets.sort((a, b) => b.items.length - a.items.length);
      const b1 = sorted[0]!;
      const b2 = sorted.find(
        (b) =>
          b !== b1 &&
          b.items.some((x) => !b1.items.some((y) => y.outlet === x.outlet)) &&
          Math.max(b1.rep.canonicalValue, b.rep.canonicalValue) /
            Math.max(Math.min(b1.rep.canonicalValue, b.rep.canonicalValue), 1e-9) <=
            10
      );
      if (b2) {
        const combined = [...b1.items.slice(0, 3), ...b2.items.slice(0, 3)];
        const outlets = Array.from(new Set(combined.map((x) => x.outlet)));
        differences.push({
          kind: 'number_difference',
          outlets,
          summaryEn: `Different ${family.replace('_', ' ')} figures appear across outlets: ${formatCanonicalQuantity(b1.rep)} vs ${formatCanonicalQuantity(b2.rep)}.`,
          summaryBn: `সংবাদমাধ্যমভেদে ভিন্ন সংখ্যা পাওয়া গেছে: ${b1.rep.raw} বনাম ${b2.rep.raw}।`,
          details: combined.map((x) => ({
            outlet: x.outlet,
            articleId: x.articleId,
            span: x.q.raw,
          })),
        });
      }
    }
  }

  // 2. Compare hedging stance across outlets (`certain` vs `hedged`/`conditional`)
  const certainOutlets: Array<{ outlet: OutletId; articleId: string; span: string }> = [];
  const hedgedOutlets: Array<{ outlet: OutletId; articleId: string; span: string }> = [];

  for (const item of outletItems) {
    if (item.claims.length === 0) continue;
    const hasCertain = item.claims.find((c) => c.hedgingLevel === 'certain');
    const hasHedged = item.claims.find((c) => c.hedgingLevel === 'hedged' || c.hedgingLevel === 'conditional');
    if (hasHedged) {
      hedgedOutlets.push({
        outlet: item.outlet,
        articleId: item.articleId,
        span: `[${hasHedged.hedgingLevel}] ${hasHedged.claimText.slice(0, 120)}`,
      });
    } else if (hasCertain) {
      certainOutlets.push({
        outlet: item.outlet,
        articleId: item.articleId,
        span: `[certain] ${hasCertain.claimText.slice(0, 120)}`,
      });
    }
  }

  if (certainOutlets.length > 0 && hedgedOutlets.length > 0) {
    const details = [...certainOutlets.slice(0, 3), ...hedgedOutlets.slice(0, 3)];
    const outlets = Array.from(new Set(details.map((d) => d.outlet)));
    differences.push({
      kind: 'hedging_difference',
      outlets,
      summaryEn: `Framing certainty differs across outlets: ${certainOutlets.map((x) => x.outlet).join(', ')} state claims definitively while ${hedgedOutlets.map((x) => x.outlet).join(', ')} use cautious or conditional framing.`,
      summaryBn: `উপস্থাপনার নিশ্চয়তায় ভিন্নতা রয়েছে: ${certainOutlets.map((x) => x.outlet).join(', ')} নিশ্চিতভাবে প্রতিবেদন করেছে, আর ${hedgedOutlets.map((x) => x.outlet).join(', ')} সম্ভাব্য বা শর্তসাপেক্ষ ভাষা ব্যবহার করেছে।`,
      details,
    });
  }

  return differences.slice(0, 8);
}
