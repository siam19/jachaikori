/**
 * @file packages/retrieval/test/retrieval.test.ts
 * Tests for paragraph-aware chunking, RRF fusion, temporal QueryExpander, and clustering.
 */

import { describe, expect, it } from 'bun:test';
import { chunkArticle } from '../src/chunker';
import { reciprocalRankFuse } from '../src/rrf';
import { AliasDictionaryExpander } from '../src/query-expander';
import {
  buildTemporalSimilarityEdges,
  buildTemporalSimilarityEdgesAsync,
  clusterArticlesBySimilarity,
  clusterArticlesBySimilarityAsync,
  computeArticleCentroid,
  normalizeVector,
} from '../src/clustering';

describe('Paragraph-Aware Chunker', () => {
  it('prepends headline on chunk 0 and respects paragraph boundaries', () => {
    const p1 = 'ক'.repeat(700);
    const p2 = 'খ'.repeat(700);
    const p3 = 'গ'.repeat(700);

    const chunks = chunkArticle(
      {
        id: 'art-1',
        outlet: 'prothom-alo',
        title: 'গুরুত্বপূর্ণ সংবাদ শিরোনাম',
        cleanText: `${p1}\n\n${p2}\n\n${p3}`,
        publishedAt: '2026-11-10T10:00:00Z',
      },
      { maxChars: 1600, overlapChars: 150 }
    );

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.id).toBe('art-1:0');
    expect(chunks[0]!.text.startsWith('গুরুত্বপূর্ণ সংবাদ শিরোনাম')).toBe(true);
    expect(chunks[1]!.id).toBe('art-1:1');
    expect(chunks[1]!.text).toContain('গ');
  });
});

describe('Reciprocal Rank Fusion (RRF)', () => {
  it('boosts articles appearing in both keyword and semantic lists and deduplicates chunks', () => {
    const hits = reciprocalRankFuse(
      [
        {
          chunkId: 'a1:0',
          articleId: 'a1',
          outlet: 'prothom-alo',
          title: 'Article 1',
          canonicalUrl: 'https://prothomalo.com/1',
          publishedAt: '2026-11-10T00:00:00Z',
          snippet: 'kw-1',
        },
        {
          chunkId: 'a1:1',
          articleId: 'a1',
          outlet: 'prothom-alo',
          title: 'Article 1',
          canonicalUrl: 'https://prothomalo.com/1',
          publishedAt: '2026-11-10T00:00:00Z',
          snippet: 'kw-1b',
        },
        {
          chunkId: 'a2:0',
          articleId: 'a2',
          outlet: 'daily-star',
          title: 'Article 2',
          canonicalUrl: 'https://thedailystar.net/2',
          publishedAt: '2026-11-10T00:00:00Z',
          snippet: 'kw-2',
        },
      ],
      [
        {
          chunkId: 'a2:0',
          articleId: 'a2',
          outlet: 'daily-star',
          title: 'Article 2',
          canonicalUrl: 'https://thedailystar.net/2',
          publishedAt: '2026-11-10T00:00:00Z',
          snippet: 'sem-2',
        },
        {
          chunkId: 'a3:0',
          articleId: 'a3',
          outlet: 'bdnews24',
          title: 'Article 3',
          canonicalUrl: 'https://bangla.bdnews24.com/3',
          publishedAt: '2026-11-10T00:00:00Z',
          snippet: 'sem-3',
        },
      ],
      { k: 60, limit: 10 }
    );

    expect(hits.length).toBe(3);
    // a2 appeared in BOTH lists (rank 3 kw + rank 1 sem) -> beats a1 (rank 1 kw only)
    expect(hits[0]!.articleId).toBe('a2');
    expect(hits[0]!.sources).toEqual(['keyword', 'semantic']);
    expect(hits[1]!.articleId).toBe('a1');
  });
});

describe('Temporal Alias QueryExpander', () => {
  it('resolves role aliases within their valid date window and enforces token boundaries & case', () => {
    const expander = new AliasDictionaryExpander(
      [
        {
          aliasNorm: 'pm',
          aliasRaw: 'PM',
          entityId: 'ent_role_pm',
          requireUppercase: true,
        },
        {
          aliasNorm: 'তারেক রহমান',
          aliasRaw: 'তারেক রহমান',
          entityId: 'ent-tareque',
        },
        {
          aliasNorm: 'শেখ হাসিনা',
          aliasRaw: 'শেখ হাসিনা',
          entityId: 'ent-hasina',
        },
        {
          aliasNorm: 'us',
          aliasRaw: 'US',
          entityId: 'ent-usa',
          requireUppercase: true,
        },
        {
          aliasNorm: 'যুক্তরাষ্ট্র',
          aliasRaw: 'যুক্তরাষ্ট্র',
          entityId: 'ent-usa',
        },
      ],
      [
        {
          id: 'rt-tareque',
          roleEntityId: 'ent_role_pm',
          holderEntityId: 'ent-tareque',
          validFrom: '2026-02-17',
          validTo: null,
        },
        {
          id: 'rt-hasina',
          roleEntityId: 'ent_role_pm',
          holderEntityId: 'ent-hasina',
          validFrom: '2009-01-01',
          validTo: '2024-08-05',
        },
      ]
    );

    const res2026 = expander.expand('PM statement on economy', '2026-11-10');
    expect(res2026.matchedEntityIds).toEqual(['ent-tareque']);
    expect(res2026.expandedTerms).toContain('তারেক রহমান');

    // Substring guard: "business" must NOT trigger "US", "development" must NOT trigger "PM"
    const resSub = expander.expand('business development policy');
    expect(resSub.matchedEntityIds).toEqual([]);
    expect(resSub.expandedTerms).toEqual([]);

    // Role guard: "Former PM" must NOT expand to incumbent PM
    const resFormer = expander.expand('Former PM trial update', '2026-11-10');
    expect(resFormer.matchedEntityIds).toEqual([]);
  });
});

describe('Temporal Similarity Edges & Centroid-Guarded Clustering', () => {
  it('clusters nearby similar articles across outlets and respects time windows', () => {
    const vEventA1 = normalizeVector(new Float32Array([1, 0.1, 0, 0]));
    const vEventA2 = normalizeVector(new Float32Array([0.99, 0.12, 0.02, 0]));
    const vEventAOld = normalizeVector(new Float32Array([1, 0.1, 0, 0])); // 20 days earlier -> excluded by ±4d window
    const vEventB = normalizeVector(new Float32Array([0, 0, 1, 0]));

    const articles = [
      {
        articleId: 'pa-1',
        outlet: 'prothom-alo' as const,
        title: 'ঢাকায় মেট্রোরেল স্টেশন উদ্বোধন',
        publishedAt: '2026-11-10T10:00:00Z',
        vector: vEventA1,
      },
      {
        articleId: 'ds-1',
        outlet: 'daily-star' as const,
        title: 'Metro rail station inaugurated in Dhaka',
        publishedAt: '2026-11-11T10:00:00Z',
        vector: vEventA2,
      },
      {
        articleId: 'old-1',
        outlet: 'ittefaq' as const,
        title: 'Old metro report',
        publishedAt: '2026-10-15T10:00:00Z',
        vector: vEventAOld,
      },
      {
        articleId: 'tbs-1',
        outlet: 'business-standard' as const,
        title: 'Central bank interest rate hike',
        publishedAt: '2026-11-10T12:00:00Z',
        vector: vEventB,
      },
    ];

    const centroid = computeArticleCentroid([vEventA1, vEventA2]);
    expect(centroid.length).toBe(4);

    const edges = buildTemporalSimilarityEdges(articles, {
      windowDays: 4,
      minSimilarity: 0.85,
      topKPerArticle: 5,
    });

    expect(edges.length).toBe(1);
    expect([edges[0]!.source, edges[0]!.target].sort()).toEqual(['ds-1', 'pa-1']);

    const { clusters, articleToCluster } = clusterArticlesBySimilarity(articles, edges, {
      centroidThreshold: 0.85,
      minClusterSize: 2,
    });

    expect(clusters.length).toBe(1);
    expect(clusters[0]!.outlets).toEqual(['daily-star', 'prothom-alo']);
    expect(articleToCluster.get('pa-1')).toBe(clusters[0]!.id);
    expect(articleToCluster.get('old-1')).toBeUndefined();
  });

  it('async edge and cluster builders emit progress and match sync results', async () => {
    const v1 = normalizeVector(new Float32Array([1, 0.1, 0, 0]));
    const v2 = normalizeVector(new Float32Array([0.98, 0.15, 0, 0]));
    const v3 = normalizeVector(new Float32Array([0, 1, 0.1, 0]));

    const articles = [
      { articleId: 'a1', outlet: 'prothom-alo' as const, title: 'Event 1', publishedAt: '2026-11-10T10:00:00Z', vector: v1 },
      { articleId: 'a2', outlet: 'daily-star' as const, title: 'Event 1b', publishedAt: '2026-11-11T10:00:00Z', vector: v2 },
      { articleId: 'a3', outlet: 'ittefaq' as const, title: 'Event 2', publishedAt: '2026-11-10T11:00:00Z', vector: v3 },
    ];

    let edgeProgressCalled = false;
    const syncEdges = buildTemporalSimilarityEdges(articles, { windowDays: 4, minSimilarity: 0.85, topKPerArticle: 5 });
    const asyncEdges = await buildTemporalSimilarityEdgesAsync(articles, {
      windowDays: 4,
      minSimilarity: 0.85,
      topKPerArticle: 5,
      onProgress: (p) => {
        if (p.processed === p.total) edgeProgressCalled = true;
      },
    });
    expect(edgeProgressCalled).toBe(true);
    expect(asyncEdges).toEqual(syncEdges);

    let clusterProgressCalled = false;
    const syncRes = clusterArticlesBySimilarity(articles, syncEdges, { centroidThreshold: 0.85, minClusterSize: 2 });
    const asyncRes = await clusterArticlesBySimilarityAsync(articles, asyncEdges, {
      centroidThreshold: 0.85,
      minClusterSize: 2,
      onProgress: (p) => {
        if (p.processed === p.total) clusterProgressCalled = true;
      },
    });
    expect(clusterProgressCalled).toBe(true);
    expect(asyncRes.clusters).toEqual(syncRes.clusters);
  });
});
