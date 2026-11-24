/**
 * @file packages/verification/src/pipeline.ts
 * End-to-end Core Verification Pipeline orchestrator:
 * validate -> exact/dHash cache lookup -> dual-provider VLM extract ->
 * entity-aware query builder -> hybrid FTS5 + BGE-M3 RRF -> calibrated rerank ->
 * honest empty state -> persist check & R2 card.
 */

import type { CompiledRegistry } from '@jachaikori/entities';
import {
  reciprocalRankFuse,
  type AliasDictionaryExpander,
  type RankedChunkCandidate,
} from '@jachaikori/retrieval';
import type {
  CardExtraction,
  VerificationCheck,
  VerificationSourceMatch,
} from '@jachaikori/schema';
import { makeVlmCacheKey, type VlmResponseCache } from './cache';
import {
  computePerceptualHash,
  DEFAULT_DHASH_MAX_HAMMING,
  hammingDistanceHex64,
  sha256Hex,
  validateImageBytes,
  type SupportedImageMime,
} from './image-hash';
import {
  EXTRACT_PROMPT_VERSION,
  NEUTRAL_EMPTY_STATE_NOTICE,
  NON_CLAIM_NOTICE,
  PIPELINE_VERSION,
  RERANK_PROMPT_VERSION,
} from './prompts';
import type {
  CandidateReranker,
  ClaimDiffJudge,
  RerankCandidateInput,
  RerankCandidateScore,
  VlmExtractor,
} from './providers/types';
import { runClaimDiffEngine, type ArticleClaimStore } from './diff/engine';
import { buildVerificationQueries } from './query-builder';

export const DEFAULT_MIN_MATCH_SCORE = 0.42;
export const DEFAULT_MAX_SOURCES = 8;
export const DEFAULT_MAX_TEXT_CHARS = 8000;

export type VerificationPipelineInput =
  | {
      type: 'image';
      bytes: Uint8Array;
      bypassCache?: boolean;
    }
  | {
      type: 'text';
      text: string;
      bypassCache?: boolean;
    };

export interface VerificationCheckStore {
  findByExactHash(
    inputType: 'image' | 'text',
    hash: string,
    pipelineVersion: string
  ): Promise<VerificationCheck | null>;
  findRecentPerceptualHashes(
    pipelineVersion: string,
    limit?: number
  ): Promise<Array<{ id: string; perceptualHash: string }>>;
  getById(id: string): Promise<VerificationCheck | null>;
  incrementHitCount(id: string, nowIso: string): Promise<number>;
  save(check: VerificationCheck, textHash?: string | null): Promise<void>;
}

export interface VerificationImageStore {
  put(key: string, bytes: Uint8Array, mimeType: SupportedImageMime): Promise<void>;
}

export interface VerificationRetriever {
  searchKeyword(ftsQuery: string, limit: number): Promise<RankedChunkCandidate[]>;
  searchSemantic(queryText: string, limit: number): Promise<RankedChunkCandidate[]>;
  getArticleEntityMatches?(
    articleIds: string[],
    targetEntityIds: string[]
  ): Promise<Map<string, string[]>>;
}

export interface VerificationPipelineDeps {
  extractor: VlmExtractor;
  reranker: CandidateReranker;
  diffJudge?: ClaimDiffJudge;
  compiledRegistry: CompiledRegistry;
  expander: AliasDictionaryExpander;
  retriever: VerificationRetriever;
  checkStore: VerificationCheckStore;
  claimStore?: ArticleClaimStore;
  vlmCache?: VlmResponseCache;
  imageStore?: VerificationImageStore;
  minMatchScore?: number;
  maxSources?: number;
  maxHammingDistance?: number;
  enableClaimDiff?: boolean;
  pipelineVersion?: string;
  now?: () => Date;
}

function generateCheckId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return `chk_${hex}`;
}

function mergeKeywordCandidateLists(lists: RankedChunkCandidate[][], limit: number): RankedChunkCandidate[] {
  const seenArticles = new Set<string>();
  const merged: RankedChunkCandidate[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seenArticles.has(item.articleId)) continue;
      seenArticles.add(item.articleId);
      merged.push(item);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

export async function runVerificationPipeline(
  input: VerificationPipelineInput,
  deps: VerificationPipelineDeps
): Promise<VerificationCheck> {
  const totalStart = performance.now();
  const nowDate = (deps.now ?? (() => new Date()))();
  const nowIso = nowDate.toISOString();
  const pipelineVersion = deps.pipelineVersion ?? PIPELINE_VERSION;
  const minMatchScore = deps.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;
  const maxSources = deps.maxSources ?? DEFAULT_MAX_SOURCES;
  const maxHamming = deps.maxHammingDistance ?? DEFAULT_DHASH_MAX_HAMMING;

  const timings = {
    cacheLookupMs: 0,
    extractMs: 0,
    entityResolveMs: 0,
    retrievalMs: 0,
    rerankMs: 0,
    diffMs: 0,
    persistMs: 0,
  };

  // 1. Validate & fingerprint input
  let validatedImg: { bytes: Uint8Array; mimeType: SupportedImageMime; ext: string } | null = null;
  let cleanText = '';
  let inputHash = '';
  let imageHash: string | null = null;
  let perceptualHash: string | null = null;
  let textHash: string | null = null;

  if (input.type === 'image') {
    validatedImg = validateImageBytes(input.bytes);
    imageHash = await sha256Hex(validatedImg.bytes);
    inputHash = imageHash;
    const ph = await computePerceptualHash(validatedImg.bytes, validatedImg.mimeType);
    perceptualHash = ph.hash;
  } else {
    cleanText = input.text.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      throw new Error('Verification text cannot be empty.');
    }
    if (cleanText.length > DEFAULT_MAX_TEXT_CHARS) {
      cleanText = cleanText.slice(0, DEFAULT_MAX_TEXT_CHARS);
    }
    textHash = await sha256Hex(cleanText.toLowerCase());
    inputHash = textHash;
  }

  // 2. Exact & perceptual-hash check cache lookup
  const cacheStart = performance.now();
  if (!input.bypassCache) {
    const exactHit = await deps.checkStore.findByExactHash(input.type, inputHash, pipelineVersion);
    if (exactHit) {
      const hitCount = await deps.checkStore.incrementHitCount(exactHit.id, nowIso);
      timings.cacheLookupMs = Math.round(performance.now() - cacheStart);
      return {
        ...exactHit,
        cacheHit: 'exact',
        hitCount,
        costUsd: 0,
        latencyMs: Math.round(performance.now() - totalStart),
        stageTimingsMs: timings,
        lastHitAt: nowIso,
      };
    }

    if (input.type === 'image' && perceptualHash) {
      const recent = await deps.checkStore.findRecentPerceptualHashes(pipelineVersion, 400);
      let bestId: string | null = null;
      let bestDist = maxHamming + 1;
      for (const row of recent) {
        const dist = hammingDistanceHex64(perceptualHash, row.perceptualHash);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = row.id;
          if (dist === 0) break;
        }
      }
      if (bestId && bestDist <= maxHamming) {
        const perceptualHit = await deps.checkStore.getById(bestId);
        if (perceptualHit) {
          const hitCount = await deps.checkStore.incrementHitCount(perceptualHit.id, nowIso);
          timings.cacheLookupMs = Math.round(performance.now() - cacheStart);
          return {
            ...perceptualHit,
            cacheHit: 'perceptual',
            hitCount,
            costUsd: 0,
            latencyMs: Math.round(performance.now() - totalStart),
            stageTimingsMs: timings,
            lastHitAt: nowIso,
          };
        }
      }
    }
  }
  timings.cacheLookupMs = Math.round(performance.now() - cacheStart);

  // 3. VLM / LLM Claim Extraction (with deterministic response cache)
  const extractStart = performance.now();
  let extraction: CardExtraction;
  let usedProvider = deps.extractor.providerId;
  let usedModel = deps.extractor.modelVersion;
  let totalCostUsd = 0;

  const extractCacheKey = await makeVlmCacheKey(
    inputHash,
    EXTRACT_PROMPT_VERSION,
    `${deps.extractor.providerId}:${deps.extractor.modelVersion}`
  );
  const cachedExtract = !input.bypassCache && deps.vlmCache
    ? await deps.vlmCache.get(extractCacheKey)
    : null;

  if (cachedExtract) {
    extraction = JSON.parse(cachedExtract.responseJson) as CardExtraction;
    usedProvider = cachedExtract.provider as VerificationCheck['provider'];
    usedModel = cachedExtract.modelVersion;
  } else {
    const extRes =
      input.type === 'image'
        ? await deps.extractor.extractFromImage(validatedImg!.bytes, validatedImg!.mimeType)
        : await deps.extractor.extractFromText(cleanText);
    extraction = extRes.extraction;
    usedProvider = extRes.usage.provider;
    usedModel = extRes.usage.modelVersion;
    totalCostUsd += extRes.usage.costUsd;

    if (deps.vlmCache) {
      await deps.vlmCache.set({
        cacheKey: extractCacheKey,
        provider: extRes.usage.provider,
        modelVersion: extRes.usage.modelVersion,
        promptVersion: EXTRACT_PROMPT_VERSION,
        responseJson: JSON.stringify(extraction),
        inputTokens: extRes.usage.inputTokens,
        outputTokens: extRes.usage.outputTokens,
        costUsd: extRes.usage.costUsd,
        createdAt: nowIso,
      });
    }
  }
  timings.extractMs = Math.round(performance.now() - extractStart);

  const checkId = generateCheckId();
  const r2Key = validatedImg ? `cards/${checkId}.${validatedImg.ext}` : null;
  const imageUrl = r2Key ? `/checks/${checkId}/image` : null;

  // 4. Short-circuit cleanly if input contains no verifiable news claim
  const hasAnyText = Boolean(
    extraction.headline?.trim() || extraction.attributedStatement?.trim() || extraction.ocrText.trim()
  );
  if (!extraction.hasVerifiableClaim || !hasAnyText) {
    const persistStart = performance.now();
    if (validatedImg && r2Key && deps.imageStore) {
      await deps.imageStore.put(r2Key, validatedImg.bytes, validatedImg.mimeType);
    }
    const nonClaimCheck: VerificationCheck = {
      id: checkId,
      status: 'non_claim',
      cacheHit: 'none',
      provider: usedProvider,
      modelVersion: usedModel,
      pipelineVersion,
      inputType: input.type,
      imageHash,
      perceptualHash,
      r2Key,
      imageUrl,
      extraction,
      resolvedEntities: [],
      queryTerms: [],
      sources: [],
      emptyStateNotice: NON_CLAIM_NOTICE,
      hitCount: 1,
      latencyMs: Math.round(performance.now() - totalStart),
      stageTimingsMs: timings,
      costUsd: Number(totalCostUsd.toFixed(6)),
      createdAt: nowIso,
      lastHitAt: nowIso,
    };
    await deps.checkStore.save(nonClaimCheck, textHash);
    timings.persistMs = Math.round(performance.now() - persistStart);
    nonClaimCheck.latencyMs = Math.round(performance.now() - totalStart);
    return nonClaimCheck;
  }

  // 5. Entity Resolution v2 & Query Builder
  const resolveStart = performance.now();
  const queryPlan = buildVerificationQueries(
    extraction,
    deps.compiledRegistry,
    deps.expander,
    { nowIso }
  );
  timings.entityResolveMs = Math.round(performance.now() - resolveStart);

  // 6. Hybrid Retrieval (FTS5 Keyword + BGE-M3 Semantic -> RRF k=60)
  const retrievalStart = performance.now();
  const ftsToRun = queryPlan.ftsQueries.slice(0, 2);
  const [kwLists, semHits] = await Promise.all([
    Promise.all(ftsToRun.map((q) => deps.retriever.searchKeyword(q, 30))),
    queryPlan.semanticQuery
      ? deps.retriever.searchSemantic(queryPlan.semanticQuery, 30)
      : Promise.resolve([]),
  ]);
  const kwHits = mergeKeywordCandidateLists(kwLists, 40);
  const fused = reciprocalRankFuse(kwHits, semHits, { k: 60, limit: 20 });

  const bestChunkByArticle = new Map<string, string>();
  for (const hit of [...kwHits, ...semHits]) {
    if (!bestChunkByArticle.has(hit.articleId)) {
      bestChunkByArticle.set(hit.articleId, hit.chunkId);
    }
  }

  const candidateIds = fused.map((f) => f.articleId);
  const targetEntityIds = queryPlan.resolvedEntities.filter((e) => !e.isHub).map((e) => e.entityId);
  const entityOverlapMap =
    deps.retriever.getArticleEntityMatches && candidateIds.length > 0 && targetEntityIds.length > 0
      ? await deps.retriever.getArticleEntityMatches(candidateIds, targetEntityIds)
      : new Map<string, string[]>();

  const rerankInputs: RerankCandidateInput[] = fused.map((f) => ({
    articleId: f.articleId,
    chunkId: bestChunkByArticle.get(f.articleId) ?? null,
    outlet: f.outlet,
    title: f.title,
    canonicalUrl: f.canonicalUrl,
    publishedAt: f.publishedAt,
    snippet: f.snippet,
    clusterId: f.clusterId ?? null,
    clusterOutletCount: f.clusterOutletCount ?? null,
    rrfScore: f.score,
    matchedEntityIds: entityOverlapMap.get(f.articleId) ?? [],
  }));
  timings.retrievalMs = Math.round(performance.now() - retrievalStart);

  // 7. Calibrated Reranking
  const rerankStart = performance.now();
  let scoreList: RerankCandidateScore[] = [];
  if (rerankInputs.length > 0) {
    const rerankInputSig = await sha256Hex(
      `${inputHash}|${rerankInputs.map((c) => c.articleId).join(',')}`
    );
    const rerankCacheKey = await makeVlmCacheKey(
      rerankInputSig,
      RERANK_PROMPT_VERSION,
      `${deps.reranker.providerId}:${deps.reranker.modelVersion}`
    );
    const cachedRerank = !input.bypassCache && deps.vlmCache
      ? await deps.vlmCache.get(rerankCacheKey)
      : null;

    if (cachedRerank) {
      scoreList = JSON.parse(cachedRerank.responseJson) as RerankCandidateScore[];
    } else {
      const rr = await deps.reranker.rerank(extraction, rerankInputs);
      scoreList = rr.scores;
      totalCostUsd += rr.usage.costUsd;
      if (deps.vlmCache) {
        await deps.vlmCache.set({
          cacheKey: rerankCacheKey,
          provider: rr.usage.provider,
          modelVersion: rr.usage.modelVersion,
          promptVersion: RERANK_PROMPT_VERSION,
          responseJson: JSON.stringify(scoreList),
          inputTokens: rr.usage.inputTokens,
          outputTokens: rr.usage.outputTokens,
          costUsd: rr.usage.costUsd,
          createdAt: nowIso,
        });
      }
    }
  }
  timings.rerankMs = Math.round(performance.now() - rerankStart);

  const scoreById = new Map(scoreList.map((s) => [s.articleId, s]));
  const sources: VerificationSourceMatch[] = rerankInputs
    .map((c) => {
      const s = scoreById.get(c.articleId);
      return {
        articleId: c.articleId,
        chunkId: c.chunkId ?? null,
        outlet: c.outlet,
        title: c.title,
        canonicalUrl: c.canonicalUrl,
        publishedAt: c.publishedAt,
        snippet: c.snippet,
        clusterId: c.clusterId ?? null,
        clusterOutletCount: c.clusterOutletCount ?? null,
        rrfScore: Number(c.rrfScore.toFixed(6)),
        rerankScore: Number((s?.relevanceScore ?? 0).toFixed(4)),
        matchSummary: s?.matchSummary ?? null,
        matchedEntityIds: c.matchedEntityIds ?? [],
      };
    })
    .filter((m) => m.rerankScore >= minMatchScore)
    .sort((a, b) => b.rerankScore - a.rerankScore || b.rrfScore - a.rrfScore)
    .slice(0, maxSources);

  const status: VerificationCheck['status'] = sources.length > 0 ? 'matched' : 'no_coverage';
  const emptyStateNotice = status === 'no_coverage' ? NEUTRAL_EMPTY_STATE_NOTICE : null;

  // 7b. Sprint 7 Claim-Level Diff & Distortion Engine on matched sources
  let finalSources = sources;
  let overallDiffStatus: VerificationCheck['overallDiffStatus'] = null;
  let overallDiffSummary: VerificationCheck['overallDiffSummary'] = null;

  if (status === 'matched' && deps.enableClaimDiff !== false) {
    const diffStart = performance.now();
    const diffRes = await runClaimDiffEngine({
      extraction,
      sources,
      compiledRegistry: deps.compiledRegistry,
      referenceDateIso: queryPlan.referenceDate,
      nowIso,
      diffJudge: deps.diffJudge,
      claimStore: deps.claimStore,
      vlmCache: deps.vlmCache,
      inputHash,
      bypassCache: input.bypassCache,
    });
    finalSources = diffRes.sources;
    overallDiffStatus = diffRes.overallDiffStatus;
    overallDiffSummary = diffRes.overallDiffSummary;
    totalCostUsd += diffRes.extraCostUsd;
    timings.diffMs = Math.round(performance.now() - diffStart);
  }

  // 8. Persist uploaded image + check record
  const persistStart = performance.now();
  if (validatedImg && r2Key && deps.imageStore) {
    await deps.imageStore.put(r2Key, validatedImg.bytes, validatedImg.mimeType);
  }

  const check: VerificationCheck = {
    id: checkId,
    status,
    cacheHit: 'none',
    provider: usedProvider,
    modelVersion: usedModel,
    pipelineVersion,
    inputType: input.type,
    imageHash,
    perceptualHash,
    r2Key,
    imageUrl,
    extraction,
    resolvedEntities: queryPlan.resolvedEntities,
    queryTerms: queryPlan.queryTerms,
    sources: finalSources,
    overallDiffStatus,
    overallDiffSummary,
    emptyStateNotice,
    hitCount: 1,
    latencyMs: Math.round(performance.now() - totalStart),
    stageTimingsMs: timings,
    costUsd: Number(totalCostUsd.toFixed(6)),
    createdAt: nowIso,
    lastHitAt: nowIso,
  };

  await deps.checkStore.save(check, textHash);
  timings.persistMs = Math.round(performance.now() - persistStart);
  check.latencyMs = Math.round(performance.now() - totalStart);
  return check;
}
