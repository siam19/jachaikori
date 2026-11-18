/**
 * @file packages/entities/src/discover.ts
 * Discovers recurring named entities (quoted speakers in Bangla/English titles)
 * across a corpus so entities beyond the static seed registry still join the hypergraph.
 */

import type { Entity } from '@jachaikori/schema';
import { normalizeText, normalizeToken } from './normalize';
import type { ExpandedEntityAlias } from './seed';

const EXCLUDED_SPEAKERS = new Set([
  'প্রতিবেদক',
  'নিজস্ব প্রতিবেদক',
  'প্রতিনিধি',
  'বিশেষ প্রতিনিধি',
  'ডেক্স',
  'ডেস্ক',
  'সংশ্লিষ্ট',
  'সাক্ষাৎকার',
  'মতামত',
  'সম্পাদকীয়',
  'বিশ্লেষণ',
  'সরকার',
  'পুলিশ',
  'আদালত',
  'বিশেষজ্ঞরা',
  'বিশ্লেষকরা',
  'সূত্র',
  'বক্তারা',
  'নেতারা',
  'জানালেন',
  'বললেন',
  'প্রতিবেদন',
  'আপডেট',
  'সর্বশেষ',
  'ভিডিও',
  'মন্ত্রী',
  'প্রতিমন্ত্রী',
  'উপদেষ্টা',
  'সচিব',
  'চেয়ারম্যান',
  'মেয়র',
  'পরিচালক',
  'সভাপতি',
  'সাধারণ সম্পাদক',
  'মুখপাত্র',
  'কমিটি',
  'বিচারক',
  'minister',
  'adviser',
  'secretary',
  'chairman',
  'experts',
  'study',
  'report',
  'official',
  'spokesperson',
  'police',
  'court',
  'govt',
]);

function fnv1aHex(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface DiscoverOptions {
  minMentions?: number;
  existingAliases?: ExpandedEntityAlias[];
  maxEntities?: number;
}

/**
 * Mines recurring speaker names from `<headline> : <Speaker>` patterns across Bangla & English titles,
 * returning newly discovered `Entity` + `ExpandedEntityAlias` entries not already covered by `existingAliases`.
 */
export function discoverRecurringHeadlineEntities(
  titles: string[],
  options: DiscoverOptions = {}
): { entities: Entity[]; aliases: ExpandedEntityAlias[] } {
  const minMentions = options.minMentions ?? 8;
  const maxEntities = options.maxEntities ?? 150;

  const knownNorms = new Set(
    (options.existingAliases ?? []).map((a) => a.aliasNorm)
  );

  const counts = new Map<string, { raw: string; count: number }>();

  for (const title of titles) {
    const clean = normalizeText(title);
    const colonIdx = clean.lastIndexOf(':');
    if (colonIdx <= 10) continue;

    const tail = clean.slice(colonIdx + 1).trim();
    if (!tail || tail.length < 3 || tail.length > 36) continue;
    // Skip clauses with numbers, quotes, or excessive words (unlikely to be a clean speaker name)
    if (/[0-9০-৯"'‘’“”?!।]/.test(tail)) continue;
    const words = tail.split(/\s+/);
    if (words.length > 4) continue;

    const norm = words.map(normalizeToken).filter(Boolean).join(' ');
    if (!norm || knownNorms.has(norm) || EXCLUDED_SPEAKERS.has(norm)) continue;

    // Require either Bangla proper noun phrase or Capitalized English name
    const isBangla = /[\u0980-\u09FF]/.test(tail);
    const isEnProper = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(tail);
    if (!isBangla && !isEnProper) continue;

    const prev = counts.get(norm);
    if (prev) {
      prev.count++;
    } else {
      counts.set(norm, { raw: tail, count: 1 });
    }
  }

  const ranked = Array.from(counts.entries())
    .filter(([, v]) => v.count >= minMentions)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxEntities);

  const entities: Entity[] = [];
  const aliases: ExpandedEntityAlias[] = [];

  for (const [norm, { raw, count }] of ranked) {
    const isBangla = /[\u0980-\u09FF]/.test(raw);
    const id = `ent_dyn_${fnv1aHex(norm)}`;
    entities.push({
      id,
      canonicalBn: isBangla ? raw : null,
      canonicalEn: isBangla ? null : raw,
      entityType: 'person',
      metadataJson: JSON.stringify({ discovered: true, titleSpeakerMentions: count }),
    });
    aliases.push({
      aliasNorm: norm,
      aliasRaw: raw,
      entityId: id,
      validFrom: null,
      validTo: null,
    });
  }

  return { entities, aliases };
}
