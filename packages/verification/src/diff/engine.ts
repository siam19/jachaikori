/**
 * @file packages/verification/src/diff/engine.ts
 * Hybrid Claim-Level Diff & Distortion Engine:
 * Combines authoritative deterministic Bangla/English comparators (numbers, dates,
 * speaker/role_term, denial/hedging signals) with a dual-provider semantic judge
 * (`GeminiFlashAdapter` / `WorkersAiAdapter` / `HeuristicVerificationAdapter`) and
 * on-demand article claim caching over Sprint 5's `claim` table.
 */

import { resolveArticle, type CompiledRegistry } from '@jachaikori/entities';
import type {
  CardExtraction,
  ClaimDiffFlag,
  ClaimDiffItem,
  EmptyStateNotice,
  OverallDiffStatus,
  StoredArticleClaim,
  VerificationSourceMatch,
} from '@jachaikori/schema';
import { makeVlmCacheKey, type VlmResponseCache } from '../cache';
import { sha256Hex } from '../image-hash';
import { ARTICLE_CLAIM_PROMPT_VERSION, DIFF_PROMPT_VERSION } from '../prompts';
import { HeuristicVerificationAdapter } from '../providers/heuristic';
import type { ClaimDiffJudge } from '../providers/types';
import { compareDateClaims } from './dates';
import { compareNumericClaims, toBanglaDigits } from './numbers';
import { compareSpeakerAndRoles } from './speaker';

export interface ArticleClaimStore {
  getByArticleIds(articleIds: string[]): Promise<Map<string, StoredArticleClaim[]>>;
  getArticleBodies?(articleIds: string[]): Promise<Map<string, string>>;
  saveArticleClaims?(claims: StoredArticleClaim[]): Promise<void>;
}

export interface RunClaimDiffParams {
  extraction: CardExtraction;
  sources: VerificationSourceMatch[];
  compiledRegistry: CompiledRegistry;
  referenceDateIso: string;
  nowIso: string;
  diffJudge?: ClaimDiffJudge;
  claimStore?: ArticleClaimStore;
  vlmCache?: VlmResponseCache;
  inputHash: string;
  bypassCache?: boolean;
  /** Cap how many top matched sources receive full claim-level diffing (default: 5). */
  maxSourcesToDiff?: number;
  /** Cap on-demand claim extractions per check when Stage B rows are absent (default: 2). */
  maxOnDemandExtractions?: number;
}

export interface RunClaimDiffResult {
  sources: VerificationSourceMatch[];
  overallDiffStatus: OverallDiffStatus;
  overallDiffSummary: EmptyStateNotice;
  extraCostUsd: number;
}

const MISMATCH_FLAGS = new Set<ClaimDiffFlag>([
  'mismatch_number',
  'mismatch_date',
  'mismatch_speaker',
  'mismatch_quote',
  'hedging_shift',
  'missing_context',
]);

function dedupeAndMergeDiffs(detDiffs: ClaimDiffItem[], semDiffs: ClaimDiffItem[]): ClaimDiffItem[] {
  const out: ClaimDiffItem[] = [];
  const detFlags = new Set<ClaimDiffFlag>(detDiffs.map((d) => d.flag));

  // Authoritative deterministic findings always go first
  for (const d of detDiffs) {
    out.push(d);
  }

  for (const s of semDiffs) {
    // Do not let an LLM `match` override a deterministic numeric/date/speaker mismatch
    if (
      s.flag === 'match' &&
      (detFlags.has('mismatch_number') ||
        detFlags.has('mismatch_date') ||
        detFlags.has('mismatch_speaker'))
    ) {
      continue;
    }
    // Avoid duplicating a flag already proven deterministically with the same span
    if (
      detFlags.has(s.flag) &&
      (s.flag === 'mismatch_number' || s.flag === 'mismatch_date' || s.flag === 'mismatch_speaker')
    ) {
      continue;
    }
    out.push(s);
  }

  // Sort: major mismatches -> notable mismatches -> info matches
  const rank = (item: ClaimDiffItem): number => {
    if (item.flag === 'match') return 3;
    if (item.severity === 'major') return 0;
    if (item.severity === 'notable') return 1;
    return 2;
  };
  return out.sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence).slice(0, 6);
}

function summarizeSourceDiff(diffs: ClaimDiffItem[], outlet: string): EmptyStateNotice {
  const mismatches = diffs.filter((d) => MISMATCH_FLAGS.has(d.flag));
  if (mismatches.length === 0) {
    return {
      en: `No concrete numeric, date, speaker, or framing differences detected against ${outlet} reporting.`,
      bn: `${outlet}-এর প্রতিবেদনের সঙ্গে সংখ্যা, তারিখ, বক্তা বা উপস্থাপনার কোনো সুনির্দিষ্ট অসঙ্গতি পাওয়া যায়নি।`,
    };
  }
  const top = mismatches[0]!;
  return {
    en: top.explanationEn,
    bn: top.explanationBn,
  };
}

const DIFF_FLAG_LABELS: Record<Exclude<ClaimDiffFlag, 'match'>, { en: string; bn: string }> = {
  mismatch_number: { en: 'numbers', bn: 'সংখ্যা' },
  mismatch_date: { en: 'dates', bn: 'তারিখ' },
  mismatch_speaker: { en: 'speaker attribution', bn: 'বক্তার পরিচয়' },
  mismatch_quote: { en: 'quote wording', bn: 'উদ্ধৃতির ভাষা' },
  hedging_shift: { en: 'certainty framing', bn: 'নিশ্চয়তার মাত্রা' },
  missing_context: { en: 'omitted context', bn: 'বাদ পড়া প্রসঙ্গ' },
};

function formatDiffFlagLabels(flags: ClaimDiffFlag[], lang: 'en' | 'bn'): string {
  const labels = flags
    .filter((f): f is Exclude<ClaimDiffFlag, 'match'> => f !== 'match' && f in DIFF_FLAG_LABELS)
    .map((f) => DIFF_FLAG_LABELS[f][lang]);
  return labels.join(', ');
}

function summarizeOverallDiff(sources: VerificationSourceMatch[]): {
  status: OverallDiffStatus;
  summary: EmptyStateNotice;
} {
  const inspected = sources.filter((s) => Array.isArray(s.diffs));
  if (inspected.length === 0) {
    return {
      status: 'insufficient_claims',
      summary: {
        en: 'Matched accredited articles were found, but claim-level comparison could not be completed.',
        bn: 'মূলধারার প্রতিবেদন পাওয়া গেছে, তবে দাবি-ভিত্তিক তুলনা সম্পন্ন করা যায়নি।',
      },
    };
  }

  const allMismatches = inspected.flatMap((s) => (s.diffs ?? []).filter((d) => MISMATCH_FLAGS.has(d.flag)));
  const majorMismatches = allMismatches.filter((d) => d.severity === 'major');
  const uniqueMismatchFlags = Array.from(new Set(allMismatches.map((d) => d.flag)));

  if (majorMismatches.length > 0) {
    const labelEn = formatDiffFlagLabels(uniqueMismatchFlags, 'en');
    const labelBn = formatDiffFlagLabels(uniqueMismatchFlags, 'bn');
    return {
      status: 'significant_differences',
      summary: {
        en: `Notable differences detected between the card and matched accredited reporting (${labelEn}). Review the side-by-side citations below.`,
        bn: `কার্ডের দাবি ও মূলধারার প্রতিবেদনের মধ্যে উল্লেখযোগ্য পার্থক্য পাওয়া গেছে (${labelBn})। নিচে প্রতিবেদনভিত্তিক তুলনা দেখুন।`,
      },
    };
  }

  if (allMismatches.length > 0) {
    const labelEn = formatDiffFlagLabels(uniqueMismatchFlags, 'en');
    const labelBn = formatDiffFlagLabels(uniqueMismatchFlags, 'bn');
    return {
      status: 'minor_differences',
      summary: {
        en: `Core topic aligns with accredited coverage, with minor framing or detail differences noted (${labelEn}).`,
        bn: `মূল বিষয়টি মূলধারার প্রতিবেদনের সঙ্গে সামঞ্জস্যপূর্ণ, তবে উপস্থাপনা বা তথ্যে সামান্য পার্থক্য রয়েছে (${labelBn})।`,
      },
    };
  }

  return {
    status: 'aligned',
    summary: {
      en: `Card details align with matched coverage across ${inspected.length} accredited ${inspected.length === 1 ? 'article' : 'articles'}, with no numeric, date, or speaker discrepancies detected.`,
      bn: `কার্ডের তথ্যগুলো ${toBanglaDigits(String(inspected.length))}টি মূলধারার প্রতিবেদনের সঙ্গে সামঞ্জস্যপূর্ণ; সংখ্যা, তারিখ বা বক্তার কোনো অসঙ্গতি পাওয়া যায়নি।`,
    },
  };
}

function resolveNameToId(
  rawName: string | null,
  compiled: CompiledRegistry,
  publishedAt: string | null
): string | null {
  if (!rawName || !rawName.trim()) return null;
  const r = resolveArticle(
    { id: '_clm_ent', title: rawName, publishedAt },
    compiled,
    { emitUnlinked: false, maxBodySentences: 0 }
  );
  return r.mentions[0]?.entityId ?? null;
}

export async function runClaimDiffEngine(params: RunClaimDiffParams): Promise<RunClaimDiffResult> {
  const maxSourcesToDiff = params.maxSourcesToDiff ?? 5;
  const maxOnDemand = params.maxOnDemandExtractions ?? 2;
  const heuristic = new HeuristicVerificationAdapter();
  const judge = params.diffJudge ?? heuristic;

  const targetSources = params.sources.slice(0, maxSourcesToDiff);
  if (targetSources.length === 0) {
    return {
      sources: params.sources,
      overallDiffStatus: 'insufficient_claims',
      overallDiffSummary: {
        en: 'No matched accredited articles available for claim comparison.',
        bn: 'দাবি তুলনার জন্য কোনো মূলধারার প্রতিবেদন পাওয়া যায়নি।',
      },
      extraCostUsd: 0,
    };
  }

  const targetIds = targetSources.map((s) => s.articleId);
  const claimsMap = params.claimStore
    ? await params.claimStore.getByArticleIds(targetIds)
    : new Map<string, StoredArticleClaim[]>();

  // On-demand claim extraction for top matched articles missing pre-extracted Stage B claims
  const missingClaimSources = targetSources
    .filter((s) => (claimsMap.get(s.articleId)?.length ?? 0) === 0)
    .slice(0, maxOnDemand);

  let extraCostUsd = 0;

  if (missingClaimSources.length > 0 && params.claimStore?.saveArticleClaims) {
    const bodies = params.claimStore.getArticleBodies
      ? await params.claimStore.getArticleBodies(missingClaimSources.map((s) => s.articleId))
      : new Map<string, string>();

    await Promise.all(
      missingClaimSources.map(async (src) => {
        const bodyText = bodies.get(src.articleId) || src.snippet;
        if (!bodyText.trim()) return;
        try {
          const cacheKey = await makeVlmCacheKey(
            await sha256Hex(src.articleId),
            ARTICLE_CLAIM_PROMPT_VERSION,
            `${judge.providerId}:${judge.modelVersion}`
          );
          let extractedClaims: StoredArticleClaim[] = [];
          const cached = !params.bypassCache && params.vlmCache
            ? await params.vlmCache.get(cacheKey)
            : null;

          if (cached) {
            extractedClaims = JSON.parse(cached.responseJson) as StoredArticleClaim[];
          } else {
            const res = await judge.extractArticleClaims({
              articleId: src.articleId,
              outlet: src.outlet,
              title: src.title,
              publishedAt: src.publishedAt,
              text: bodyText,
            });
            extraCostUsd += res.usage.costUsd;
            extractedClaims = await Promise.all(
              res.claims.map(async (c, idx) => ({
                id: `clm_od_${(await sha256Hex(`${src.articleId}|${idx}|${c.claimText}`)).slice(0, 14)}`,
                articleId: src.articleId,
                claimText: c.claimText,
                claimType: c.claimType,
                speakerEntityId: resolveNameToId(c.speakerName, params.compiledRegistry, src.publishedAt),
                speakerName: c.speakerName,
                subjectEntityId: resolveNameToId(c.subjectName, params.compiledRegistry, src.publishedAt),
                subjectName: c.subjectName,
                objectEntityId: resolveNameToId(c.objectName, params.compiledRegistry, src.publishedAt),
                objectName: c.objectName,
                numbers: c.numbers,
                dates: c.dates,
                hedgingLevel: c.hedgingLevel,
                evidenceSnippet: c.evidenceSnippet,
                confidence: 0.85,
                extractorVersion: 'v2-ondemand',
              }))
            );
            if (params.vlmCache && extractedClaims.length > 0) {
              await params.vlmCache.set({
                cacheKey,
                provider: res.usage.provider,
                modelVersion: res.usage.modelVersion,
                promptVersion: ARTICLE_CLAIM_PROMPT_VERSION,
                responseJson: JSON.stringify(extractedClaims),
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
                costUsd: res.usage.costUsd,
                createdAt: params.nowIso,
              });
            }
          }

          if (extractedClaims.length > 0) {
            claimsMap.set(src.articleId, extractedClaims);
            await params.claimStore!.saveArticleClaims!(extractedClaims);
          }
        } catch {
          // On-demand extraction failure is non-fatal; deterministic + snippet diff still runs
        }
      })
    );
  }

  // Run deterministic + semantic diffing across top matched sources in parallel
  const diffedTop = await Promise.all(
    targetSources.map(async (src): Promise<VerificationSourceMatch> => {
      const articleClaims = claimsMap.get(src.articleId) ?? [];

      // Collect card & article numeric + date spans (claims + headline/snippet)
      const cardNumSpans = [
        ...params.extraction.claimedNumbers,
        ...(params.extraction.headline ? [params.extraction.headline] : []),
        ...(params.extraction.attributedStatement ? [params.extraction.attributedStatement] : []),
      ];
      const artNumSpans = [
        ...articleClaims.flatMap((c) => c.numbers),
        src.title,
        src.snippet,
      ];
      const artDateSpans = [
        ...articleClaims.flatMap((c) => c.dates),
        src.title,
      ];

      // 1. Authoritative deterministic comparators
      const numDiffs = compareNumericClaims(cardNumSpans, artNumSpans);
      const dateDiffs = compareDateClaims({
        cardDates: params.extraction.claimedDates,
        cardText: [params.extraction.headline, params.extraction.ocrText].filter(Boolean).join(' '),
        articleDates: artDateSpans,
        articlePublishedAt: src.publishedAt,
        nowIso: params.nowIso,
      });
      const speakerDiffs = compareSpeakerAndRoles({
        extraction: params.extraction,
        articleClaims,
        articleTitle: src.title,
        articleSnippet: src.snippet,
        articlePublishedAt: src.publishedAt,
        compiled: params.compiledRegistry,
        referenceDateIso: params.referenceDateIso,
      });
      // Always also run deterministic denial/hedging detector from Heuristic adapter
      const heurDiffs = (
        await heuristic.compareClaims({
          extraction: params.extraction,
          article: {
            articleId: src.articleId,
            outlet: src.outlet,
            title: src.title,
            publishedAt: src.publishedAt,
            snippet: src.snippet,
          },
          articleClaims,
        })
      ).diffs;

      const deterministicDiffs = [...numDiffs, ...dateDiffs, ...speakerDiffs, ...heurDiffs];

      // 2. Dual-provider semantic quote / hedging / context judge (with cache)
      let semanticDiffs: ClaimDiffItem[] = [];
      let semanticSummary: EmptyStateNotice | null = null;

      if (judge.providerId !== 'heuristic') {
        try {
          const diffCacheKey = await makeVlmCacheKey(
            await sha256Hex(`${params.inputHash}|${src.articleId}|${articleClaims.length}`),
            DIFF_PROMPT_VERSION,
            `${judge.providerId}:${judge.modelVersion}`
          );
          const cached = !params.bypassCache && params.vlmCache
            ? await params.vlmCache.get(diffCacheKey)
            : null;
          if (cached) {
            const parsed = JSON.parse(cached.responseJson) as {
              diffs: ClaimDiffItem[];
              summary: EmptyStateNotice | null;
            };
            semanticDiffs = parsed.diffs ?? [];
            semanticSummary = parsed.summary ?? null;
          } else {
            const semRes = await judge.compareClaims({
              extraction: params.extraction,
              article: {
                articleId: src.articleId,
                outlet: src.outlet,
                title: src.title,
                publishedAt: src.publishedAt,
                snippet: src.snippet,
              },
              articleClaims,
            });
            semanticDiffs = semRes.diffs;
            semanticSummary = semRes.summary;
            extraCostUsd += semRes.usage.costUsd;

            if (params.vlmCache) {
              await params.vlmCache.set({
                cacheKey: diffCacheKey,
                provider: semRes.usage.provider,
                modelVersion: semRes.usage.modelVersion,
                promptVersion: DIFF_PROMPT_VERSION,
                responseJson: JSON.stringify({ diffs: semanticDiffs, summary: semanticSummary }),
                inputTokens: semRes.usage.inputTokens,
                outputTokens: semRes.usage.outputTokens,
                costUsd: semRes.usage.costUsd,
                createdAt: params.nowIso,
              });
            }
          }
        } catch {
          // Semantic failure never blocks deterministic diffs
        }
      }

      const merged = dedupeAndMergeDiffs(deterministicDiffs, semanticDiffs);
      const flags = Array.from(new Set(merged.map((d) => d.flag)));
      const hasHardMismatch = merged.some(
        (d) =>
          d.deterministic &&
          (d.flag === 'mismatch_number' ||
            d.flag === 'mismatch_date' ||
            d.flag === 'mismatch_speaker' ||
            d.flag === 'missing_context')
      );

      return {
        ...src,
        diffFlags: flags.length > 0 ? flags : ['match'],
        diffs: merged,
        diffSummary: hasHardMismatch
          ? summarizeSourceDiff(merged, src.outlet)
          : semanticSummary ?? summarizeSourceDiff(merged, src.outlet),
        articleClaimsCount: articleClaims.length,
      };
    })
  );

  const finalSources = [...diffedTop, ...params.sources.slice(maxSourcesToDiff)];
  const overall = summarizeOverallDiff(diffedTop);

  return {
    sources: finalSources,
    overallDiffStatus: overall.status,
    overallDiffSummary: overall.summary,
    extraCostUsd,
  };
}
