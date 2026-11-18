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
  const migration1 = readFileSync(
    join(import.meta.dir, '../migrations/0001_initial.sql'),
    'utf8'
  );
  const migration2 = readFileSync(
    join(import.meta.dir, '../migrations/0002_entity_hypergraph.sql'),
    'utf8'
  );
  const migration3 = readFileSync(
    join(import.meta.dir, '../migrations/0003_event_entity.sql'),
    'utf8'
  );
  db.run(migration1);
  db.run(migration2);
  db.run(migration3);

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

  db.run(`INSERT INTO entity (id, canonical_bn, canonical_en, entity_type) VALUES ('ent_coxs_bazar', 'কক্সবাজার', 'Coxs Bazar', 'location'), ('ent_lng', 'এলএনজি টার্মিনাল', 'LNG terminal', 'event_topic')`);
  db.run(`INSERT INTO entity_alias (alias_norm, alias_raw, entity_id) VALUES ('কক্সবাজার', 'কক্সবাজার', 'ent_coxs_bazar'), ('coxs bazar', 'Coxs Bazar', 'ent_coxs_bazar')`);
  db.run(`INSERT INTO article_entity (article_id, entity_id, surface_form, role, confidence) VALUES ('art-pa-1', 'ent_coxs_bazar', 'কক্সবাজারে', 'location', 0.95), ('art-pa-1', 'ent_lng', 'এলএনজি টার্মিনাল', 'subject', 0.95), ('art-ds-1', 'ent_coxs_bazar', 'Coxs Bazar', 'location', 0.95)`);
  db.run(
    `INSERT INTO event_entity (event_id, entity_id, role, article_count, outlet_count, headline_count, salience, event_start, event_end)
     VALUES
       ('clu_art-pa-1', 'ent_coxs_bazar', 'location', 2, 2, 1, 0.9, '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z'),
       ('clu_art-pa-1', 'ent_lng', 'subject', 1, 1, 1, 0.7, '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z')`
  );
  db.run(`INSERT INTO event_redirect (old_id, new_id) VALUES ('clu_old_1', 'clu_art-pa-1')`);
  db.run(`INSERT INTO entity_relation (id, article_id, source_entity_id, target_entity_id, relation_type, evidence_snippet, published_at, confidence) VALUES ('rel-1', 'art-pa-1', 'ent_lng', 'ent_coxs_bazar', 'located_in', 'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন', '2026-11-12T10:00:00Z', 0.92)`);

  return { db, env: { DB: createSqliteD1Adapter(db) } };
}

describe('API Worker Routes', () => {
  it('serves /health, Bangla /search, /clusters, /clusters/:id/graph, and entity hypergraph endpoints', async () => {
    const { db, env } = createTestEnv();
    try {
      const healthRes = await handleApiRequest(new Request('http://localhost/health'), env);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as any;
      expect(health.counts).toEqual({
        articles: 2,
        chunks: 2,
        clusters: 1,
        edges: 1,
        entities: 2,
        entityRelations: 1,
      });

      // Bangla keyword search + cross-lingual alias expansion
      const searchRes = await handleApiRequest(
        new Request('http://localhost/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'কক্সবাজার এলএনজি', mode: 'keyword' }),
        }),
        env
      );
      expect(searchRes.status).toBe(200);
      const searchData = (await searchRes.json()) as any;
      expect(searchData.hits.length).toBe(2);
      expect(searchData.hits.map((h: any) => h.articleId)).toContain('art-pa-1');
      expect(searchData.hits.map((h: any) => h.articleId)).toContain('art-ds-1');
      expect(searchData.hits[0].clusterId).toBe('clu_art-pa-1');
      expect(searchData.hits[0].clusterOutletCount).toBe(2);
      expect(searchData.expandedTerms).toContain('Coxs Bazar');

      // Clusters list
      const cluRes = await handleApiRequest(new Request('http://localhost/clusters?minOutlets=2'), env);
      expect(cluRes.status).toBe(200);
      const cluData = (await cluRes.json()) as any;
      expect(cluData.clusters.length).toBe(1);
      expect(cluData.clusters[0].outlets).toEqual(['daily-star', 'prothom-alo']);

      // Cluster graph with resolved entity badges
      const graphRes = await handleApiRequest(
        new Request('http://localhost/clusters/clu_art-pa-1/graph'),
        env
      );
      expect(graphRes.status).toBe(200);
      const graphData = (await graphRes.json()) as any;
      expect(graphData.nodes.length).toBe(2);
      expect(graphData.edges.length).toBe(1);
      expect(graphData.edges[0].similarity).toBe(0.89);
      expect(graphData.entities.length).toBe(2);

      // Entity list + Ego Entity Hypergraph + Cluster Entity Hypergraph
      const entListRes = await handleApiRequest(new Request('http://localhost/entities'), env);
      expect(entListRes.status).toBe(200);
      const entListData = (await entListRes.json()) as any;
      expect(entListData.entities.length).toBe(2);

      const entGraphRes = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/graph'),
        env
      );
      expect(entGraphRes.status).toBe(200);
      const entGraph = (await entGraphRes.json()) as any;
      expect(entGraph.centerEntity.id).toBe('ent_coxs_bazar');
      expect(entGraph.edges.length).toBe(1);
      expect(entGraph.edges[0].relationType).toBe('located_in');
      expect(entGraph.hyperedges.length).toBeGreaterThanOrEqual(1);

      const cluEntRes = await handleApiRequest(
        new Request('http://localhost/clusters/clu_art-pa-1/entities'),
        env
      );
      expect(cluEntRes.status).toBe(200);
      const cluEnt = (await cluEntRes.json()) as any;
      expect(cluEnt.nodes.length).toBe(2);
      expect(cluEnt.hyperedges.length).toBe(2);
    } finally {
      db.close();
    }
  });

  it('serves /entities/suggest, /entities/:id/ego, /entities/:id/activity, /events, and /events/:id/graph', async () => {
    const { db, env } = createTestEnv();
    try {
      const suggestRes = await handleApiRequest(
        new Request('http://localhost/entities/suggest?q=Cox'),
        env
      );
      expect(suggestRes.status).toBe(200);
      const suggestData = (await suggestRes.json()) as any;
      expect(suggestData.entities.length).toBe(1);
      expect(suggestData.entities[0].id).toBe('ent_coxs_bazar');

      const emptySuggestRes = await handleApiRequest(
        new Request('http://localhost/entities/suggest?q='),
        env
      );
      expect(emptySuggestRes.status).toBe(200);
      expect(((await emptySuggestRes.json()) as any).entities).toEqual([]);

      const egoRes = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/ego'),
        env
      );
      expect(egoRes.status).toBe(200);
      const egoData = (await egoRes.json()) as any;
      expect(egoData.centerEntity.id).toBe('ent_coxs_bazar');
      expect(egoData.nMe).toBe(1);
      expect(egoData.nAll).toBe(1);
      expect(egoData.neighbors.length).toBe(1);
      expect(egoData.neighbors[0].id).toBe('ent_lng');
      expect(egoData.neighbors[0].score).toBe(0); // log2((1*1)/(1*1)) = 0
      expect(egoData.events.length).toBe(1);
      expect(egoData.events[0].firstSeen).toBe('2026-11-12T10:00:00Z');

      // n_all === 0 guard when date window excludes all events
      const egoEmptyRes = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/ego?from=2027-01-01'),
        env
      );
      expect(egoEmptyRes.status).toBe(200);
      const egoEmptyData = (await egoEmptyRes.json()) as any;
      expect(egoEmptyData.nAll).toBe(0);
      expect(egoEmptyData.neighbors).toEqual([]);

      const actRes = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/activity'),
        env
      );
      expect(actRes.status).toBe(200);
      const actData = (await actRes.json()) as any;
      expect(actData.series.length).toBe(1);
      expect(actData.series[0].date).toBe('2026-11-12');
      expect(actData.series[0].eventCount).toBe(1);

      const eventsRes = await handleApiRequest(
        new Request(
          'http://localhost/events?entity=ent_coxs_bazar&entity=ent_lng&from=2026-11-12&to=2026-11-12'
        ),
        env
      );
      expect(eventsRes.status).toBe(200);
      const eventsData = (await eventsRes.json()) as any;
      expect(eventsData.events.length).toBe(1);
      expect(eventsData.events[0].id).toBe('clu_art-pa-1');

      // Event graph via redirect
      const evGraphRes = await handleApiRequest(
        new Request('http://localhost/events/clu_old_1/graph'),
        env
      );
      expect(evGraphRes.status).toBe(200);
      const evGraph = (await evGraphRes.json()) as any;
      expect(evGraph.event.id).toBe('clu_art-pa-1');
      expect(evGraph.event.redirectedFrom).toBe('clu_old_1');
      expect(evGraph.nodes.length).toBe(2);
      expect(evGraph.edges.length).toBe(1);
      expect(evGraph.edges[0].evidence[0].title).toBe(
        'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন'
      );
      expect(evGraph.edges[0].evidence[0].publishedAt).toBe('2026-11-12T10:00:00Z');
      expect(evGraph.edges[0].evidence[0].canonicalUrl).toBe(
        'https://www.prothomalo.com/bangladesh/1'
      );
    } finally {
      db.close();
    }
  });
});
