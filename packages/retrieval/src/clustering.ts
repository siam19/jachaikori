/**
 * @file packages/retrieval/src/clustering.ts
 * Pure Float32Array vector math, centroid pooling, time-windowed similarity edge construction,
 * and centroid-guarded event clustering across Bangla and English news outlets.
 */

import type { OutletId } from '@jachaikori/schema';

export interface ArticleVectorRecord {
  articleId: string;
  outlet: OutletId;
  title: string;
  lead?: string | null;
  publishedAt: string | null;
  vector: Float32Array;
}

export interface SimilarityEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface ComputedCluster {
  id: string;
  label: string;
  leadSnippet: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  articleIds: string[];
  outlets: OutletId[];
}

export interface EdgeProgress {
  processed: number;
  total: number;
  comparisons: number;
  matchedPairs: number;
}

export interface ClusterProgress {
  processed: number;
  total: number;
  clustersFormed: number;
  clusteredArticles: number;
}

export interface TemporalEdgeOptions {
  windowDays?: number;
  minSimilarity?: number;
  topKPerArticle?: number;
  onProgress?: (progress: EdgeProgress) => void;
}

export interface ClusteringOptions {
  centroidThreshold?: number;
  minClusterSize?: number;
  onProgress?: (progress: ClusterProgress) => void;
}

interface SortedArticleEntry {
  item: ArticleVectorRecord;
  ts: number;
}

interface CandidateMatch {
  targetIdx: number;
  sim: number;
}

/**
 * L2-normalizes a Float32Array in place and returns it.
 */
export function normalizeVector(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i]!;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] = vec[i]! / norm;
    }
  }
  return vec;
}

/**
 * Computes dot product of two L2-normalized vectors (= cosine similarity)
 * using 4-way loop unrolling for hot similarity loops.
 */
export function cosineSimilarityNormalized(a: Float32Array, b: Float32Array): number {
  const len = a.length < b.length ? a.length : b.length;
  let dot0 = 0;
  let dot1 = 0;
  let dot2 = 0;
  let dot3 = 0;
  let i = 0;
  const limit = len - 3;

  for (; i < limit; i += 4) {
    dot0 += a[i]! * b[i]!;
    dot1 += a[i + 1]! * b[i + 1]!;
    dot2 += a[i + 2]! * b[i + 2]!;
    dot3 += a[i + 3]! * b[i + 3]!;
  }

  let dot = dot0 + dot1 + dot2 + dot3;
  for (; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Pools an article's chunk vectors into a single L2-normalized article centroid vector,
 * giving extra weight (0.6) to chunk 0 (headline + lead) and 0.4 to the body mean.
 */
export function computeArticleCentroid(chunkVectors: Float32Array[]): Float32Array {
  if (chunkVectors.length === 0) return new Float32Array(0);
  if (chunkVectors.length === 1) {
    return normalizeVector(new Float32Array(chunkVectors[0]!));
  }

  const dims = chunkVectors[0]!.length;
  const meanBody = new Float32Array(dims);
  for (const vec of chunkVectors) {
    for (let d = 0; d < dims; d++) {
      meanBody[d] = meanBody[d]! + vec[d]!;
    }
  }
  for (let d = 0; d < dims; d++) {
    meanBody[d] = meanBody[d]! / chunkVectors.length;
  }

  const first = chunkVectors[0]!;
  const pooled = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    pooled[d] = 0.6 * first[d]! + 0.4 * meanBody[d]!;
  }
  return normalizeVector(pooled);
}

function prepareSortedArticles(articles: ArticleVectorRecord[]): SortedArticleEntry[] {
  return [...articles]
    .map((a) => ({
      item: a,
      ts: a.publishedAt ? Date.parse(a.publishedAt) : NaN,
    }))
    .sort((a, b) => {
      if (Number.isNaN(a.ts) && Number.isNaN(b.ts)) return 0;
      if (Number.isNaN(a.ts)) return 1;
      if (Number.isNaN(b.ts)) return -1;
      return a.ts - b.ts;
    });
}

function pushTopKCandidate(
  list: CandidateMatch[],
  targetIdx: number,
  sim: number,
  topK: number,
  pruneLimit: number
): void {
  list.push({ targetIdx, sim });
  if (list.length >= pruneLimit) {
    list.sort((x, y) => y.sim - x.sim);
    list.length = topK;
  }
}

function processEdgeStep(
  i: number,
  sorted: SortedArticleEntry[],
  perNodeCandidates: CandidateMatch[][],
  windowMs: number,
  minSimilarity: number,
  topK: number,
  pruneLimit: number
): { comparisons: number; matchedPairs: number } {
  const a = sorted[i]!;
  const aVec = a.item.vector;
  const aHasTs = !Number.isNaN(a.ts);
  const aCands = perNodeCandidates[i]!;
  let comparisons = 0;
  let matchedPairs = 0;

  // Single forward pass computes each ±window pair's cosine similarity once
  for (let j = i + 1; j < sorted.length; j++) {
    const b = sorted[j]!;
    if (aHasTs && !Number.isNaN(b.ts) && b.ts - a.ts > windowMs) {
      break;
    }
    comparisons++;
    const sim = cosineSimilarityNormalized(aVec, b.item.vector);
    if (sim >= minSimilarity) {
      matchedPairs++;
      pushTopKCandidate(aCands, j, sim, topK, pruneLimit);
      pushTopKCandidate(perNodeCandidates[j]!, i, sim, topK, pruneLimit);
    }
  }

  return { comparisons, matchedPairs };
}

function finalizeEdgeMap(
  sorted: SortedArticleEntry[],
  perNodeCandidates: CandidateMatch[][],
  topK: number
): SimilarityEdge[] {
  const edgeMap = new Map<string, SimilarityEdge>();

  for (let i = 0; i < sorted.length; i++) {
    const cands = perNodeCandidates[i]!;
    if (cands.length === 0) continue;

    cands.sort((x, y) => y.sim - x.sim);
    const aId = sorted[i]!.item.articleId;
    const limit = Math.min(cands.length, topK);

    for (let k = 0; k < limit; k++) {
      const c = cands[k]!;
      const bId = sorted[c.targetIdx]!.item.articleId;
      const [u, v] = aId < bId ? [aId, bId] : [bId, aId];
      const key = `${u}|${v}`;
      const existing = edgeMap.get(key);
      if (!existing || c.sim > existing.similarity) {
        edgeMap.set(key, {
          source: u,
          target: v,
          similarity: Number(c.sim.toFixed(4)),
        });
      }
    }
  }

  return Array.from(edgeMap.values());
}

/**
 * Builds undirected similarity edges comparing each article only against articles published
 * within `±windowDays` (default 4 days). Assumes input vectors are L2-normalized.
 */
export function buildTemporalSimilarityEdges(
  articles: ArticleVectorRecord[],
  options: TemporalEdgeOptions = {}
): SimilarityEdge[] {
  const windowMs = (options.windowDays ?? 4) * 86_400_000;
  const minSimilarity = options.minSimilarity ?? 0.78;
  const topK = options.topKPerArticle ?? 8;
  const pruneLimit = Math.max(topK * 4, 32);

  if (topK <= 0 || articles.length < 2) {
    options.onProgress?.({ processed: articles.length, total: articles.length, comparisons: 0, matchedPairs: 0 });
    return [];
  }

  const sorted = prepareSortedArticles(articles);
  const perNodeCandidates: CandidateMatch[][] = Array.from({ length: sorted.length }, () => []);
  let comparisons = 0;
  let matchedPairs = 0;

  for (let i = 0; i < sorted.length; i++) {
    const step = processEdgeStep(i, sorted, perNodeCandidates, windowMs, minSimilarity, topK, pruneLimit);
    comparisons += step.comparisons;
    matchedPairs += step.matchedPairs;

    if (options.onProgress && ((i + 1) % 250 === 0 || i === sorted.length - 1)) {
      options.onProgress({ processed: i + 1, total: sorted.length, comparisons, matchedPairs });
    }
  }

  return finalizeEdgeMap(sorted, perNodeCandidates, topK);
}

/**
 * Async variant of `buildTemporalSimilarityEdges` that yields to the event loop
 * periodically so CLI spinners and progress bars update live.
 */
export async function buildTemporalSimilarityEdgesAsync(
  articles: ArticleVectorRecord[],
  options: TemporalEdgeOptions & { yieldIntervalMs?: number } = {}
): Promise<SimilarityEdge[]> {
  const windowMs = (options.windowDays ?? 4) * 86_400_000;
  const minSimilarity = options.minSimilarity ?? 0.78;
  const topK = options.topKPerArticle ?? 8;
  const yieldIntervalMs = options.yieldIntervalMs ?? 80;
  const pruneLimit = Math.max(topK * 4, 32);

  if (topK <= 0 || articles.length < 2) {
    options.onProgress?.({ processed: articles.length, total: articles.length, comparisons: 0, matchedPairs: 0 });
    return [];
  }

  const sorted = prepareSortedArticles(articles);
  const perNodeCandidates: CandidateMatch[][] = Array.from({ length: sorted.length }, () => []);
  let comparisons = 0;
  let matchedPairs = 0;
  let lastYieldAt = Date.now();

  for (let i = 0; i < sorted.length; i++) {
    const step = processEdgeStep(i, sorted, perNodeCandidates, windowMs, minSimilarity, topK, pruneLimit);
    comparisons += step.comparisons;
    matchedPairs += step.matchedPairs;

    const isLast = i === sorted.length - 1;
    if (isLast || ((i + 1) % 64 === 0 && Date.now() - lastYieldAt >= yieldIntervalMs)) {
      options.onProgress?.({ processed: i + 1, total: sorted.length, comparisons, matchedPairs });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYieldAt = Date.now();
    }
  }

  return finalizeEdgeMap(sorted, perNodeCandidates, topK);
}

function initClusteringState(articles: ArticleVectorRecord[], edges: SimilarityEdge[]) {
  const articleById = new Map(articles.map((a) => [a.articleId, a]));
  const adj = new Map<string, Array<{ neighborId: string; sim: number }>>();

  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    if (!adj.has(edge.target)) adj.set(edge.target, []);
    adj.get(edge.source)!.push({ neighborId: edge.target, sim: edge.similarity });
    adj.get(edge.target)!.push({ neighborId: edge.source, sim: edge.similarity });
  }

  // Seed clusters from highest-degree nodes first
  const orderedIds = Array.from(adj.keys()).sort((a, b) => {
    const degDiff = (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0);
    if (degDiff !== 0) return degDiff;
    return a.localeCompare(b);
  });

  return {
    articleById,
    adj,
    orderedIds,
    assigned: new Set<string>(),
    articleToCluster: new Map<string, string>(),
    clusters: [] as ComputedCluster[],
  };
}

function expandClusterFromSeed(
  seedId: string,
  state: ReturnType<typeof initClusteringState>,
  centroidThreshold: number,
  minClusterSize: number
): void {
  const { articleById, adj, assigned, articleToCluster, clusters } = state;
  if (assigned.has(seedId)) return;
  const seed = articleById.get(seedId);
  if (!seed) return;

  const members: ArticleVectorRecord[] = [seed];
  const dims = seed.vector.length;
  const centroidSum = new Float32Array(seed.vector);
  let centroid = normalizeVector(new Float32Array(centroidSum));

  const queue = [...(adj.get(seedId) ?? [])].sort((x, y) => y.sim - x.sim);
  const seenCandidates = new Set<string>([seedId]);

  for (let qi = 0; qi < queue.length; qi++) {
    const cand = queue[qi]!;
    if (assigned.has(cand.neighborId) || seenCandidates.has(cand.neighborId)) continue;
    seenCandidates.add(cand.neighborId);

    const candArt = articleById.get(cand.neighborId);
    if (!candArt) continue;

    const simToCentroid = cosineSimilarityNormalized(candArt.vector, centroid);
    if (simToCentroid >= centroidThreshold) {
      members.push(candArt);
      for (let d = 0; d < dims; d++) {
        centroidSum[d] = centroidSum[d]! + candArt.vector[d]!;
      }
      centroid = normalizeVector(new Float32Array(centroidSum));

      for (const nextEdge of adj.get(cand.neighborId) ?? []) {
        if (!assigned.has(nextEdge.neighborId) && !seenCandidates.has(nextEdge.neighborId)) {
          queue.push(nextEdge);
        }
      }
    }
  }

  if (members.length < minClusterSize) return;

  for (const m of members) {
    assigned.add(m.articleId);
  }

  // Representative headline: pick member closest to final cluster centroid
  let bestRep = members[0]!;
  let bestRepSim = -1;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  const outletSet = new Set<OutletId>();

  for (const m of members) {
    outletSet.add(m.outlet);
    const s = cosineSimilarityNormalized(m.vector, centroid);
    if (s > bestRepSim) {
      bestRepSim = s;
      bestRep = m;
    }
    if (m.publishedAt) {
      if (!firstSeen || m.publishedAt < firstSeen) firstSeen = m.publishedAt;
      if (!lastSeen || m.publishedAt > lastSeen) lastSeen = m.publishedAt;
    }
  }

  const clusterId = `clu_${seedId.slice(0, 12)}`;
  for (const m of members) {
    articleToCluster.set(m.articleId, clusterId);
  }

  clusters.push({
    id: clusterId,
    label: bestRep.title,
    leadSnippet: bestRep.lead ?? null,
    firstSeen,
    lastSeen,
    articleIds: members.map((m) => m.articleId),
    outlets: Array.from(outletSet).sort(),
  });
}

/**
 * Groups connected articles into event clusters using greedy seed-expansion with a
 * centroid-similarity guard (`cosine(article, clusterCentroid) >= centroidThreshold`)
 * to prevent transitive topic drift ("chain monsters").
 */
export function clusterArticlesBySimilarity(
  articles: ArticleVectorRecord[],
  edges: SimilarityEdge[],
  options: ClusteringOptions = {}
): {
  clusters: ComputedCluster[];
  articleToCluster: Map<string, string>;
} {
  const centroidThreshold = options.centroidThreshold ?? 0.80;
  const minClusterSize = options.minClusterSize ?? 2;
  const state = initClusteringState(articles, edges);

  for (let i = 0; i < state.orderedIds.length; i++) {
    expandClusterFromSeed(state.orderedIds[i]!, state, centroidThreshold, minClusterSize);
    if (options.onProgress && ((i + 1) % 250 === 0 || i === state.orderedIds.length - 1)) {
      options.onProgress({
        processed: i + 1,
        total: state.orderedIds.length,
        clustersFormed: state.clusters.length,
        clusteredArticles: state.articleToCluster.size,
      });
    }
  }

  if (state.orderedIds.length === 0) {
    options.onProgress?.({ processed: 0, total: 0, clustersFormed: 0, clusteredArticles: 0 });
  }

  return { clusters: state.clusters, articleToCluster: state.articleToCluster };
}

/**
 * Async variant of `clusterArticlesBySimilarity` that yields to the event loop
 * periodically so CLI spinners and progress bars update live.
 */
export async function clusterArticlesBySimilarityAsync(
  articles: ArticleVectorRecord[],
  edges: SimilarityEdge[],
  options: ClusteringOptions & { yieldIntervalMs?: number } = {}
): Promise<{
  clusters: ComputedCluster[];
  articleToCluster: Map<string, string>;
}> {
  const centroidThreshold = options.centroidThreshold ?? 0.80;
  const minClusterSize = options.minClusterSize ?? 2;
  const yieldIntervalMs = options.yieldIntervalMs ?? 80;
  const state = initClusteringState(articles, edges);

  if (state.orderedIds.length === 0) {
    options.onProgress?.({ processed: 0, total: 0, clustersFormed: 0, clusteredArticles: 0 });
    return { clusters: state.clusters, articleToCluster: state.articleToCluster };
  }

  let lastYieldAt = Date.now();
  for (let i = 0; i < state.orderedIds.length; i++) {
    expandClusterFromSeed(state.orderedIds[i]!, state, centroidThreshold, minClusterSize);
    const isLast = i === state.orderedIds.length - 1;
    if (isLast || ((i + 1) % 128 === 0 && Date.now() - lastYieldAt >= yieldIntervalMs)) {
      options.onProgress?.({
        processed: i + 1,
        total: state.orderedIds.length,
        clustersFormed: state.clusters.length,
        clusteredArticles: state.articleToCluster.size,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYieldAt = Date.now();
    }
  }

  return { clusters: state.clusters, articleToCluster: state.articleToCluster };
}
