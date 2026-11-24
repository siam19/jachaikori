/**
 * @file packages/verification/src/query-builder.ts
 * Entity-aware bilingual query builder connecting VLM `CardExtraction` to Sprint 5's
 * compiled Entity Resolution v2 (`resolveArticle` + temporal `role_term`s + `AliasDictionaryExpander`).
 */

import { resolveArticle, type CompiledRegistry } from '@jachaikori/entities';
import {
  buildFtsMatchQuery,
  tokenizeBangla,
  type AliasDictionaryExpander,
} from '@jachaikori/retrieval';
import type { CardExtraction, ResolvedCardEntity } from '@jachaikori/schema';

export interface VerificationQueryPlan {
  /** Primary & fallback FTS5 MATCH queries (ordered most specific -> broadest). */
  ftsQueries: string[];
  /** Dense semantic query text for BGE-M3 embedding / Vectorize search. */
  semanticQuery: string;
  /** Canonical entities resolved from the card's text + speaker + date. */
  resolvedEntities: ResolvedCardEntity[];
  /** Human-readable expanded query terms (returned in API for transparency). */
  queryTerms: string[];
  /** Optional ISO reference date inferred from card (used for role_term resolution). */
  referenceDate: string;
}

const STOPWORDS = new Set([
  // Common English stopwords
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'have', 'been', 'will', 'would', 'could',
  'should', 'about', 'after', 'before', 'into', 'over', 'said', 'says', 'told', 'news', 'report',
  'today', 'yesterday', 'tomorrow', 'their', 'there', 'which', 'while', 'where', 'when', 'what',
  // Common Bangla stopwords
  'এবং', 'কিন্তু', 'তবে', 'কারণ', 'জন্য', 'থেকে', 'নিয়ে', 'নিয়ে', 'করে', 'করেন', 'করা', 'হয়েছে', 'হয়েছে',
  'হবে', 'হয়ে', 'হয়ে', 'বলেন', 'বলেছেন', 'বলে', 'জানান', 'জানিয়েছেন', 'জানিয়েছেন', 'এই', 'সেই', 'তার',
  'তাঁর', 'একটি', 'একজন', 'কোনো', 'মধ্যে', 'সঙ্গে', 'সাথে', 'ওপর', 'উপর', 'দিয়ে', 'দিয়ে', 'কাছে', 'হলো',
  'ছিল', 'থাকবে', 'আছে', 'নেই', 'আরও', 'এখন', 'আজ', 'গতকাল', 'আগামীকাল',
]);

function inferIsoDateFromClaimedDates(claimedDates: string[], fallbackIso: string): string {
  for (const raw of claimedDates) {
    const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso?.[1]) return `${iso[1]}T12:00:00Z`;
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed) && parsed > Date.UTC(2000, 0, 1) && parsed < Date.UTC(2035, 0, 1)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallbackIso;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = item.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function extractSalientTokens(text: string, maxTokens = 10): string[] {
  const tokens = tokenizeBangla(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= maxTokens) break;
  }
  return out;
}

/**
 * Transforms a structured `CardExtraction` into entity-expanded FTS5 keyword queries
 * and a clean dense semantic query for BGE-M3 retrieval.
 */
export function buildVerificationQueries(
  extraction: CardExtraction,
  compiled: CompiledRegistry,
  expander: AliasDictionaryExpander,
  opts: { nowIso?: string } = {}
): VerificationQueryPlan {
  const referenceDate = inferIsoDateFromClaimedDates(
    extraction.claimedDates,
    opts.nowIso ?? new Date().toISOString()
  );

  const titleInput = [extraction.headline, extraction.quotedSpeaker]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' — ');
  const bodyInput = [
    extraction.attributedStatement,
    extraction.ocrText,
    extraction.claimedEntities.join(' '),
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n');

  // 1. Resolve canonical entities using Sprint 5's v2.0.0 resolver + temporal role_terms
  const resolved = resolveArticle(
    {
      id: '_verify_card',
      title: titleInput || bodyInput.slice(0, 220),
      lead: extraction.attributedStatement,
      cleanText: bodyInput,
      publishedAt: referenceDate,
    },
    compiled,
    { emitUnlinked: false, maxBodySentences: 15 }
  );

  const resolvedEntities: ResolvedCardEntity[] = [];
  for (const m of resolved.mentions) {
    const ent = compiled.entityMap.get(m.entityId);
    if (!ent) continue;
    resolvedEntities.push({
      entityId: ent.id,
      canonicalBn: ent.canonicalBn ?? null,
      canonicalEn: ent.canonicalEn ?? null,
      entityType: ent.entityType,
      isHub: Boolean(ent.isHub),
      surfaceForm: m.surfaceForm,
      linkMethod: String(m.linkMethod ?? 'name_exact'),
    });
  }

  // 2. Cross-lingual alias expansion via Sprint 5's fixed AliasDictionaryExpander
  const fullClaimText = [
    extraction.headline,
    extraction.quotedSpeaker,
    extraction.attributedStatement,
    extraction.ocrText,
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ');

  const expanded = expander.expand(fullClaimText, referenceDate);

  // Prioritize non-hub entity canonical names (both Bangla and English for cross-lingual recall)
  const nonHubCanonicalTerms: string[] = [];
  for (const e of resolvedEntities) {
    if (e.isHub) continue;
    if (e.canonicalBn) nonHubCanonicalTerms.push(e.canonicalBn);
    if (e.canonicalEn) nonHubCanonicalTerms.push(e.canonicalEn);
  }

  const salientClaimTokens = extractSalientTokens(
    [extraction.headline, extraction.attributedStatement].filter(Boolean).join(' ') || extraction.ocrText,
    10
  );
  const numberTokens = extraction.claimedNumbers
    .flatMap((n) => tokenizeBangla(n))
    .filter((t) => /[\d০-৯]/.test(t));

  // Query 1: Keep multi-word canonical entities as intact FTS5 phrases so
  // "বাংলাদেশ ব্যাংক" does NOT split into `"বাংলাদেশ" OR "ব্যাংক"` (which matches 150k chunks!).
  const quotePhrase = (raw: string): string | null => {
    const clean = raw.replace(/["'()[\]{}*^:]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length >= 2 ? `"${clean}"` : null;
  };

  const buildPhraseOrQuery = (phrases: string[], tokens: string[]): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const p of phrases) {
      const q = quotePhrase(p);
      if (q && !seen.has(q.toLowerCase())) {
        seen.add(q.toLowerCase());
        parts.push(q);
      }
    }
    for (const t of tokens) {
      if (t === 'বাংলাদেশ' || t === 'bangladesh' || t === 'ঢাকা' || t === 'dhaka') continue;
      const q = quotePhrase(t);
      if (q && !seen.has(q.toLowerCase())) {
        seen.add(q.toLowerCase());
        parts.push(q);
      }
    }
    return parts.slice(0, 14).join(' OR ');
  };

  const ftsQueries: string[] = [];
  if (salientClaimTokens.length >= 3) {
    const strictAnd = buildFtsMatchQuery(salientClaimTokens.slice(0, 4).join(' '), 'AND');
    if (strictAnd) ftsQueries.push(strictAnd);
  }
  const focusedFts = buildPhraseOrQuery(
    nonHubCanonicalTerms.slice(0, 4),
    [...salientClaimTokens.slice(0, 7), ...numberTokens.slice(0, 3)]
  );
  if (focusedFts && !ftsQueries.includes(focusedFts)) ftsQueries.push(focusedFts);

  const crossFts = buildPhraseOrQuery(
    [...nonHubCanonicalTerms.slice(0, 6), ...expanded.expandedTerms.slice(0, 6)],
    salientClaimTokens.slice(0, 6)
  );
  if (crossFts && !ftsQueries.includes(crossFts)) ftsQueries.push(crossFts);

  // Dense semantic query for BGE-M3
  const semanticParts = dedupeStrings([
    extraction.headline ?? '',
    extraction.quotedSpeaker ? `Speaker: ${extraction.quotedSpeaker}` : '',
    extraction.attributedStatement ?? '',
    nonHubCanonicalTerms.slice(0, 4).join(', '),
  ]);
  const semanticQuery = (semanticParts.join('. ') || extraction.ocrText).slice(0, 600);

  return {
    ftsQueries,
    semanticQuery,
    resolvedEntities,
    queryTerms: dedupeStrings([...nonHubCanonicalTerms, ...salientClaimTokens]).slice(0, 16),
    referenceDate,
  };
}
