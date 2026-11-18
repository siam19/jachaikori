/**
 * @file apps/api/test/api.test.ts
 * Integration tests for /health, /search (Bangla FTS5 + RRF), /clusters, and /clusters/:id/graph.
 */

import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleApiRequest, type ApiEnv } from '../src/index';
import { createSqliteD1Adapter } from '../src/local-dev';
import { normalizeBanglaForFts } from '@jachaikori/retrieval';

function createTestEnv(): { db: Database; env: ApiEnv } {
  const db = new Database(':memory:');
  const migrationSql = readFileSync(
    join(import.meta.dir, '../migrations/0001_initial.sql'),
    'utf8'
  );
  db.run(migrationSql);

  db.run(
    `INSERT INTO article (id, outlet, canonical_url, title, published_at, lead, clean_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'art-pa-1',
      'prothom-alo',
      'https://www.prothomalo.com/bangladesh/1',
      'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন',
      '2026-11-12T10:00:00Z',
      'নতুন এলএনজি টার্মিনাল নির্মাণে চুক্তি সই হয়েছে।',
      'নতুন এলএনজি টার্মিনাল নির্মাণে চুক্তি সই হয়েছে।',
    ]
  );

  db.run(
    `INSERT INTO article (id, outlet, canonical_url, title, published_at, lead, clean_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'art-ds-1',
      'daily-star',
      'https://www.thedailystar.net/news/1',
      'LNG terminal project approved in Coxs Bazar',
      '2026-11-12T12:00:00Z',
      'Government approves new LNG terminal.',
      'Government approves new LNG terminal.',
    ]
  );

  db.run(
    `INSERT INTO chunk (id, article_id, outlet, position, text, published_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'art-pa-1:0',
      'art-pa-1',
      'prothom-alo',
      0,
      normalizeBanglaForFts('কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন\n\nনতুন এলএনজি টার্মিনাল নির্মাণে চুক্তি সই হয়েছে।'),
      '2026-11-12T10:00:00Z',
    ]
  );

  db.run(
    `INSERT INTO chunk (id, article_id, outlet, position, text, published_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'art-ds-1:0',
      'art-ds-1',
      'daily-star',
      0,
      'LNG terminal project approved in Coxs Bazar\n\nGovernment approves new LNG terminal.',
      '2026-11-12T12:00:00Z',
    ]
  );

  db.run(
    `INSERT INTO event_cluster (id, label, lead_snippet, first_seen, last_seen, article_count, outlet_count, outlets_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'clu_art-pa-1',
      'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন',
      'নতুন এলএনজি টার্মিনাল নির্মাণে চুক্তি সই হয়েছে।',
      '2026-11-12T10:00:00Z',
      '2026-11-12T12:00:00Z',
      2,
      2,
      JSON.stringify(['daily-star', 'prothom-alo']),
    ]
  );
  db.run(`INSERT INTO article_cluster (article_id, cluster_id) VALUES ('art-pa-1', 'clu_art-pa-1'), ('art-ds-1', 'clu_art-pa-1')`);
  db.run(`INSERT INTO article_similarity_edge (source_id, target_id, similarity) VALUES ('art-ds-1', 'art-pa-1', 0.89)`);

  return { db, env: { DB: createSqliteD1Adapter(db) } };
}

describe('API Worker Routes', () => {
  it('serves /health, Bangla /search, /clusters, and /clusters/:id/graph', async () => {
    const { db, env } = createTestEnv();
    try {
      const healthRes = await handleApiRequest(new Request('http://localhost/health'), env);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as any;
      expect(health.counts).toEqual({ articles: 2, chunks: 2, clusters: 1, edges: 1 });

      // Bangla keyword search
      const searchRes = await handleApiRequest(
        new Request('http://localhost/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'কক্সবাজারে এলএনজি', mode: 'keyword' }),
        }),
        env
      );
      expect(searchRes.status).toBe(200);
      const searchData = (await searchRes.json()) as any;
      expect(searchData.hits.length).toBe(1);
      expect(searchData.hits[0].articleId).toBe('art-pa-1');
      expect(searchData.hits[0].clusterId).toBe('clu_art-pa-1');
      expect(searchData.hits[0].clusterOutletCount).toBe(2);

      // Clusters list
      const cluRes = await handleApiRequest(new Request('http://localhost/clusters?minOutlets=2'), env);
      expect(cluRes.status).toBe(200);
      const cluData = (await cluRes.json()) as any;
      expect(cluData.clusters.length).toBe(1);
      expect(cluData.clusters[0].outlets).toEqual(['daily-star', 'prothom-alo']);

      // Cluster graph
      const graphRes = await handleApiRequest(
        new Request('http://localhost/clusters/clu_art-pa-1/graph'),
        env
      );
      expect(graphRes.status).toBe(200);
      const graphData = (await graphRes.json()) as any;
      expect(graphData.nodes.length).toBe(2);
      expect(graphData.edges.length).toBe(1);
      expect(graphData.edges[0].similarity).toBe(0.89);
    } finally {
      db.close();
    }
  });
});
