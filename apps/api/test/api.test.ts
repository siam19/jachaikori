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
  const migration4 = readFileSync(
    join(import.meta.dir, '../migrations/0004_entity_v2.sql'),
    'utf8'
  );
  const migration5 = readFileSync(
    join(import.meta.dir, '../migrations/0005_checks.sql'),
    'utf8'
  );
  db.run(migration1);
  db.run(migration2);
  db.run(migration3);
  db.run(migration4);
  db.run(migration5);

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
  db.run(`INSERT INTO entity_relation (id, article_id, source_entity_id, target_entity_id, relation_type, evidence_snippet, published_at, confidence) VALUES ('rel-1', 'art-pa-1', 'ent_lng', 'ent_coxs_bazar', 'incident_at', 'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন', '2026-11-12T10:00:00Z', 0.92)`);

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
      expect(entGraph.edges[0].relationType).toBe('incident_at');
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

  it('serves v2 /registry/snapshot (ETag), POST /resolve, /entities/:id dossier, /articles, /relations, and hub filtering', async () => {
    const { db, env } = createTestEnv();
    try {
      db.run(
        `INSERT INTO registry_version (version, updated_at, note) VALUES (3, '2026-11-24T00:00:00Z', 'test-v3')`
      );
      db.run(
        `UPDATE entity
         SET description_bn = 'কক্সবাজার বাংলাদেশের দক্ষিণ-পূর্বাঞ্চলের উপকূলীয় জেলা।',
             description_en = 'Coxs Bazar is a coastal district in southeastern Bangladesh.',
             short_tagline_bn = 'উপকূলীয় জেলা',
             short_tagline_en = 'Coastal district of Bangladesh',
             description_sources_json = '["art-pa-1"]',
             article_count = 2,
             event_count = 1
         WHERE id = 'ent_coxs_bazar'`
      );
      // Add a merged alias entity pointing to ent_coxs_bazar + a hub entity (Bangladesh)
      db.run(
        `INSERT INTO entity (id, canonical_bn, canonical_en, entity_type, status, merged_into)
         VALUES ('ent_coxs_old', 'কক্সবাজার পুরাতন', 'Old Coxs', 'location', 'merged', 'ent_coxs_bazar')`
      );
      db.run(
        `INSERT INTO entity (id, canonical_bn, canonical_en, entity_type, status, is_hub, article_count, event_count)
         VALUES ('ent_bangladesh', 'বাংলাদেশ', 'Bangladesh', 'location', 'active', 1, 2, 1)`
      );
      db.run(
        `INSERT INTO event_entity (event_id, entity_id, role, article_count, outlet_count, headline_count, salience, event_start, event_end)
         VALUES ('clu_art-pa-1', 'ent_bangladesh', 'location', 2, 2, 0, 0.4, '2026-11-12T10:00:00Z', '2026-11-12T12:00:00Z')`
      );
      db.run(
        `INSERT INTO entity_relation (id, article_id, source_entity_id, target_entity_id, relation_type, predicate_label, source, evidence_snippet, published_at, confidence)
         VALUES
           ('rel-hub-passive', 'art-pa-1', 'ent_coxs_bazar', 'ent_bangladesh', 'incident_at', 'located in', 'deterministic', 'কক্সবাজারে প্রকল্প', '2026-11-12T10:00:00Z', 0.8),
           ('rel-hub-macro', 'art-ds-1', 'ent_lng', 'ent_bangladesh', 'funded_or_invested', 'approved financing for', 'llm_claim', 'Government approves new LNG terminal.', '2026-11-12T12:00:00Z', 0.92)`
      );

      // 1) GET /registry/snapshot with ETag + 304 Not Modified
      const snapRes = await handleApiRequest(new Request('http://localhost/registry/snapshot'), env);
      expect(snapRes.status).toBe(200);
      expect(snapRes.headers.get('ETag')).toBe('"v3"');
      const snap = (await snapRes.json()) as any;
      expect(snap.version).toBe(3);
      expect(snap.entities.length).toBeGreaterThanOrEqual(3);

      const snap304 = await handleApiRequest(
        new Request('http://localhost/registry/snapshot', { headers: { 'If-None-Match': '"v3"' } }),
        env
      );
      expect(snap304.status).toBe(304);

      // 2) POST /resolve ad-hoc text resolution
      const resolveRes = await handleApiRequest(
        new Request('http://localhost/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'কক্সবাজারে নতুন প্রকল্প অনুমোদন হয়েছে।', publishedAt: '2026-11-12' }),
        }),
        env
      );
      expect(resolveRes.status).toBe(200);
      const resolved = (await resolveRes.json()) as any;
      expect(resolved.registryVersion).toBe(3);
      expect(resolved.mentions.some((m: any) => m.entityId === 'ent_coxs_bazar')).toBe(true);

      // 3) GET /entities/:id dossier + merged_into redirect
      const profRes = await handleApiRequest(new Request('http://localhost/entities/ent_coxs_old'), env);
      expect(profRes.status).toBe(200);
      const prof = (await profRes.json()) as any;
      expect(prof.id).toBe('ent_coxs_bazar');
      expect(prof.redirectedFrom).toBe('ent_coxs_old');
      expect(prof.descriptionEn).toContain('coastal district');
      expect(prof.descriptionSources.length).toBe(1);
      expect(prof.descriptionSources[0].articleId).toBe('art-pa-1');

      // 4) GET /entities/:id/articles with co-entity `with=` intersection
      const artRes = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/articles?with=ent_lng'),
        env
      );
      expect(artRes.status).toBe(200);
      const artData = (await artRes.json()) as any;
      expect(artData.total).toBe(1);
      expect(artData.articles[0].id).toBe('art-pa-1');

      // 5) GET /entities/:id/relations hides passive hub incident_at by default, preserves macro funded_or_invested to hub
      const relCoxs = await handleApiRequest(new Request('http://localhost/entities/ent_coxs_bazar/relations'), env);
      expect(relCoxs.status).toBe(200);
      const relCoxsData = (await relCoxs.json()) as any;
      expect(relCoxsData.relations.some((r: any) => r.otherEntity.id === 'ent_bangladesh')).toBe(false);
      expect(relCoxsData.relations.some((r: any) => r.otherEntity.id === 'ent_lng')).toBe(true);

      const relLng = await handleApiRequest(new Request('http://localhost/entities/ent_lng/relations'), env);
      const relLngData = (await relLng.json()) as any;
      const macroEdge = relLngData.relations.find((r: any) => r.relationType === 'funded_or_invested');
      expect(macroEdge).toBeDefined();
      expect(macroEdge.otherEntity.id).toBe('ent_bangladesh');
      expect(macroEdge.predicateLabels).toContain('approved financing for');

      // 6) GET /entities/:id/ego hides hubs by default, shows them with includeHubs=true
      const egoNoHub = await handleApiRequest(new Request('http://localhost/entities/ent_coxs_bazar/ego'), env);
      const egoNoHubData = (await egoNoHub.json()) as any;
      expect(egoNoHubData.neighbors.some((n: any) => n.id === 'ent_bangladesh')).toBe(false);

      const egoWithHub = await handleApiRequest(
        new Request('http://localhost/entities/ent_coxs_bazar/ego?includeHubs=true'),
        env
      );
      const egoWithHubData = (await egoWithHub.json()) as any;
      expect(egoWithHubData.neighbors.some((n: any) => n.id === 'ent_bangladesh')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('serves Sprint 6 POST /verify (multipart image + JSON text), exact cache, /checks/:id, /checks/:id/image, and /checks/popular', async () => {
    const { db, env: baseEnv } = createTestEnv();
    try {
      // Minimal valid 1x1 PNG bytes (> 32 bytes)
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
        0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
        0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
        0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
      ]);

      const storedImages = new Map<string, { bytes: Uint8Array; mimeType: string }>();
      const env: ApiEnv = {
        ...baseEnv,
        VLM_PROVIDER: 'workers-ai',
        AI: {
          async run(model: string) {
            if (model.includes('bge-reranker')) {
              return { response: [{ id: 0, score: 0.93 }] };
            }
            return {
              response: JSON.stringify({
                inputKind: 'photo_card',
                language: 'bn',
                headline: 'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন',
                ocrText: 'কক্সবাজারে এলএনজি টার্মিনাল প্রকল্প অনুমোদন — প্রথম আলো',
                quotedSpeaker: null,
                attributedStatement: 'কক্সবাজারে নতুন এলএনজি টার্মিনাল নির্মাণে চুক্তি সই হয়েছে।',
                isQuote: false,
                claimedNumbers: [],
                claimedDates: ['2026-11-12'],
                claimedEntities: ['কক্সবাজার'],
                publisherLogo: 'প্রথম আলো',
                hasVerifiableClaim: true,
                confidence: 0.95,
              }),
            };
          },
        } as unknown as Ai,
        LOCAL_IMAGE_STORE: {
          async put(key, bytes, mimeType) {
            storedImages.set(key, { bytes, mimeType });
          },
          async get(key) {
            return storedImages.get(key) ?? null;
          },
        },
      };

      // 1) Multipart image upload -> matched + stored image
      const form = new FormData();
      form.append('image', new File([pngBytes], 'card.png', { type: 'image/png' }));
      const verifyRes = await handleApiRequest(
        new Request('http://localhost/verify', { method: 'POST', body: form }),
        env
      );
      expect(verifyRes.status).toBe(200);
      const check = (await verifyRes.json()) as any;
      expect(check.status).toBe('matched');
      expect(check.provider).toBe('workers-ai');
      expect(check.extraction.publisherLogoOutletId).toBe('prothom-alo');
      expect(check.sources.length).toBeGreaterThanOrEqual(1);
      expect(check.sources[0].articleId).toBe('art-pa-1');
      expect(check.imageUrl).toBe(`/checks/${check.id}/image`);

      // 2) GET /checks/:id/image serves stored PNG
      const imgRes = await handleApiRequest(new Request(`http://localhost${check.imageUrl}`), env);
      expect(imgRes.status).toBe(200);
      expect(imgRes.headers.get('content-type')).toBe('image/png');
      expect((await imgRes.arrayBuffer()).byteLength).toBe(pngBytes.byteLength);

      // 3) Duplicate upload hits exact cache & increments hitCount
      const form2 = new FormData();
      form2.append('image', new File([pngBytes], 'repost.png', { type: 'image/png' }));
      const verifyRes2 = await handleApiRequest(
        new Request('http://localhost/verify', { method: 'POST', body: form2 }),
        env
      );
      expect(verifyRes2.status).toBe(200);
      const check2 = (await verifyRes2.json()) as any;
      expect(check2.id).toBe(check.id);
      expect(check2.cacheHit).toBe('exact');
      expect(check2.hitCount).toBe(2);
      expect(check2.costUsd).toBe(0);

      // 4) GET /checks/:id & GET /checks/popular
      const getRes = await handleApiRequest(new Request(`http://localhost/checks/${check.id}`), env);
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as any;
      expect(fetched.hitCount).toBe(2);

      const popRes = await handleApiRequest(new Request('http://localhost/checks/popular?limit=10'), env);
      expect(popRes.status).toBe(200);
      const pop = (await popRes.json()) as any;
      expect(pop.checks.length).toBe(1);
      expect(pop.checks[0].id).toBe(check.id);
      expect(pop.checks[0].hitCount).toBe(2);
      expect(pop.checks[0].topOutlet).toBe('prothom-alo');

      // 5) Invalid image payload rejected cleanly with HTTP 400
      const badForm = new FormData();
      badForm.append('image', new File([new TextEncoder().encode('not-an-image-bytes-at-all-1234567890')], 'bad.jpg'));
      const badRes = await handleApiRequest(
        new Request('http://localhost/verify', { method: 'POST', body: badForm }),
        env
      );
      expect(badRes.status).toBe(400);

      // 6) Fictional text claim returns honest `no_coverage`
      const noCovRes = await handleApiRequest(
        new Request('http://localhost/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'মঙ্গল গ্রহে বুলেট ট্রেন চালু হয়েছে বলে দাবি করা হয়েছে',
          }),
        }),
        { ...baseEnv, VLM_PROVIDER: 'auto' } // uses Heuristic fallback with zero LLM keys
      );
      expect(noCovRes.status).toBe(200);
      const noCov = (await noCovRes.json()) as any;
      expect(noCov.status).toBe('no_coverage');
      expect(noCov.emptyStateNotice.en).toContain('does not mean the claim is false');
    } finally {
      db.close();
    }
  });
});
