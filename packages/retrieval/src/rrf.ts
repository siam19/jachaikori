/**
 * @file packages/retrieval/src/rrf.ts
 * Reciprocal Rank Fusion (RRF) with article-level rollup for hybrid keyword + semantic search.
 */

import type { OutletId, SearchHit } from '@jachaikori/schema';

export interface RankedChunkCandidate {
  chunkId: string;
  articleId: string;
  outlet: OutletId;
  title: string;
  canonicalUrl: string;
  publishedAt: string | null;
  snippet: string;
  clusterId?: string | null;
  clusterOutletCount?: number | null;
}

export interface RrfOptions {
  k?: number;
  limit?: number;
}

/**
 * Merges keyword (FTS5 BM25) and semantic (Vectorize) ranked lists using
 * Reciprocal Rank Fusion: score = sum(1 / (k + rank)), rolling up multiple chunks
 * from the same article to the highest-scoring passage.
 */
export function reciprocalRankFuse(
  keywordCandidates: RankedChunkCandidate[],
  semanticCandidates: RankedChunkCandidate[],
  options: RrfOptions = {}
): SearchHit[] {
  const k = options.k ?? 60;
  const limit = options.limit ?? 10;

  const byArticle = new Map<
    string,
    {
      best: RankedChunkCandidate;
      bestChunkScore: number;
      totalScore: number;
      sources: Set<'keyword' | 'semantic'>;
    }
  >();

  function accumulate(list: RankedChunkCandidate[], source: 'keyword' | 'semantic') {
    // Track best rank per article within a single list so an article with 5 matching chunks
    // doesn't artificially dominate over an article with 1 strong match.
    const seenArticleInList = new Set<string>();

    for (let i = 0; i < list.length; i++) {
      const cand = list[i]!;
      const rrfDelta = 1 / (k + i + 1);
      const existing = byArticle.get(cand.articleId);

      if (!existing) {
        byArticle.set(cand.articleId, {
          best: cand,
          bestChunkScore: rrfDelta,
          totalScore: rrfDelta,
          sources: new Set([source]),
        });
        seenArticleInList.add(cand.articleId);
      } else {
        existing.sources.add(source);
        if (!seenArticleInList.has(cand.articleId)) {
          existing.totalScore += rrfDelta;
          seenArticleInList.add(cand.articleId);
        }
        if (rrfDelta > existing.bestChunkScore && cand.snippet) {
          existing.best = cand;
          existing.bestChunkScore = rrfDelta;
        }
      }
    }
  }

  accumulate(keywordCandidates, 'keyword');
  accumulate(semanticCandidates, 'semantic');

  return Array.from(byArticle.values())
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, limit)
    .map((entry) => ({
      articleId: entry.best.articleId,
      outlet: entry.best.outlet,
      title: entry.best.title,
      canonicalUrl: entry.best.canonicalUrl,
      publishedAt: entry.best.publishedAt,
      snippet: entry.best.snippet,
      score: Number(entry.totalScore.toFixed(6)),
      sources: Array.from(entry.sources),
      clusterId: entry.best.clusterId ?? null,
      clusterOutletCount: entry.best.clusterOutletCount ?? null,
    }));
}
