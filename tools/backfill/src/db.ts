/**
 * @file tools/backfill/src/db.ts
 * Local SQLite index store (`data/index/index.sqlite`) mirroring D1's schema
 * (0001..0004) plus binary Float32Array vector storage for chunk & article centroid vectors,
 * streaming entity resolution I/O, registry versioning, candidate mining, merge/unmerge logs,
 * event-entity materialization with dynamic hub flags, and Stage B/C Vertex Batch selectors.
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildRedirects, SEED_HUB_IDS } from '@jachaikori/entities';
import { BANGLA_FTS_TOKENIZE_CLAUSE, type ComputedCluster, type SimilarityEdge } from '@jachaikori/retrieval';
import type {
  ArticleChunk,
  ArticleEntityMention,
  Entity,
  EntityAlias,
  EntityCandidate,
  EntityRelation,
  OutletId,
  RegistrySnapshot,
  RoleTerm,
} from '@jachaikori/schema';

export interface StreamedArticleRow {
  rowid: number;
  id: string;
  outlet: OutletId;
  title: string;
  lead: string | null;
  cleanText: string | null;
  publishedAt: string | null;
}

export interface EventRepresentativeArticle {
  clusterId: string;
  clusterLabel: string;
  outletCount: number;
  articleId: string;
  outlet: OutletId;
  title: string;
  lead: string | null;
  cleanText: string | null;
  publishedAt: string | null;
  language: 'bn' | 'en';
}

export interface DossierEntityPacket {
  id: string;
  canonicalBn: string | null;
  canonicalEn: string | null;
  entityType: Entity['entityType'];
  articleCount: number;
  eventCount: number;
  aliases: string[];
  roleTerms: Array<{ role: string; validFrom: string; validTo: string | null }>;
  sampleArticles: Array<{
    articleId: string;
    outlet: string;
    publishedAt: string | null;
    title: string;
    lead: string | null;
  }>;
  topRelations: Array<{
    direction: 'out' | 'in';
    relationType: string;
    predicateLabel: string | null;
    otherName: string;
    weight: number;
    sampleSnippet: string;
  }>;
}

export class IndexDatabase {
  private db: Database;

  constructor(filePath: string = 'data/index/index.sqlite') {
    if (filePath !== ':memory:') {
      mkdirSync(dirname(filePath), { recursive: true });
    }
    this.db = new Database(filePath, { create: true });
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    this.db.run('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private ensureColumn(table: string, column: string, definitionSql: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definitionSql}`);
    }
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS article (
        id TEXT PRIMARY KEY,
        outlet TEXT NOT NULL,
        canonical_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        published_at TEXT,
        byline TEXT,
        lead TEXT,
        clean_text TEXT,
        pipeline_version TEXT NOT NULL DEFAULT 'v1'
      );
      CREATE INDEX IF NOT EXISTS idx_article_outlet_date ON article(outlet, published_at DESC);

      CREATE TABLE IF NOT EXISTS chunk (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        outlet TEXT NOT NULL,
        position INTEGER NOT NULL,
        text TEXT NOT NULL,
        published_at TEXT,
        embedding_version TEXT NOT NULL DEFAULT 'bge-m3-v1',
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chunk_article ON chunk(article_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        article_id UNINDEXED,
        outlet UNINDEXED,
        text,
        content='chunk',
        content_rowid='rowid',
        tokenize="${BANGLA_FTS_TOKENIZE_CLAUSE}"
      );

      CREATE TRIGGER IF NOT EXISTS chunk_ai AFTER INSERT ON chunk BEGIN
        INSERT INTO chunk_fts(rowid, article_id, outlet, text)
        VALUES (new.rowid, new.article_id, new.outlet, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON chunk BEGIN
        INSERT INTO chunk_fts(chunk_fts, rowid, article_id, outlet, text)
        VALUES ('delete', old.rowid, old.article_id, old.outlet, old.text);
      END;

      CREATE TABLE IF NOT EXISTS chunk_vector (
        chunk_id TEXT PRIMARY KEY,
        dims INTEGER NOT NULL,
        embedding_version TEXT NOT NULL,
        vector_blob BLOB NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunk(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS article_vector (
        article_id TEXT PRIMARY KEY,
        dims INTEGER NOT NULL,
        embedding_version TEXT NOT NULL,
        vector_blob BLOB NOT NULL,
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS event_cluster (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        lead_snippet TEXT,
        first_seen TEXT,
        last_seen TEXT,
        article_count INTEGER NOT NULL,
        outlet_count INTEGER NOT NULL,
        outlets_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cluster_outlets_date ON event_cluster(outlet_count DESC, last_seen DESC);

      CREATE TABLE IF NOT EXISTS article_cluster (
        article_id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
        FOREIGN KEY (cluster_id) REFERENCES event_cluster(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_cluster_cid ON article_cluster(cluster_id);

      CREATE TABLE IF NOT EXISTS article_similarity_edge (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        similarity REAL NOT NULL,
        PRIMARY KEY (source_id, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_edge_source ON article_similarity_edge(source_id);
      CREATE INDEX IF NOT EXISTS idx_edge_target ON article_similarity_edge(target_id);

      CREATE TABLE IF NOT EXISTS entity (
        id TEXT PRIMARY KEY,
        canonical_bn TEXT,
        canonical_en TEXT,
        entity_type TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS entity_alias (
        alias_norm TEXT NOT NULL,
        alias_raw TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        PRIMARY KEY (alias_norm, entity_id),
        FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS article_entity (
        article_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        chunk_id TEXT,
        surface_form TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'mentioned',
        confidence REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (article_id, entity_id, surface_form),
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_entity_aid ON article_entity(article_id);
      CREATE INDEX IF NOT EXISTS idx_article_entity_eid ON article_entity(entity_id);
      CREATE INDEX IF NOT EXISTS idx_alias_norm ON entity_alias(alias_norm);

      CREATE TABLE IF NOT EXISTS entity_relation (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        evidence_snippet TEXT NOT NULL,
        published_at TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
        FOREIGN KEY (source_entity_id) REFERENCES entity(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_rel_article ON entity_relation(article_id);
      CREATE INDEX IF NOT EXISTS idx_rel_source ON entity_relation(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON entity_relation(target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON entity_relation(relation_type);

      CREATE TABLE IF NOT EXISTS event_entity (
        event_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'mentioned',
        article_count INTEGER NOT NULL DEFAULT 0,
        outlet_count INTEGER NOT NULL DEFAULT 0,
        headline_count INTEGER NOT NULL DEFAULT 0,
        salience REAL NOT NULL DEFAULT 0,
        event_start TEXT NOT NULL,
        event_end TEXT NOT NULL,
        PRIMARY KEY (event_id, entity_id),
        FOREIGN KEY (event_id) REFERENCES event_cluster(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_event_entity_entity_start ON event_entity(entity_id, event_start);
      CREATE INDEX IF NOT EXISTS idx_event_entity_start ON event_entity(event_start);

      CREATE TABLE IF NOT EXISTS event_redirect (
        old_id TEXT PRIMARY KEY,
        new_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS claim (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL,
        claim_text TEXT NOT NULL,
        claim_type TEXT NOT NULL DEFAULT 'factual',
        subject_entity_id TEXT,
        object_entity_id TEXT,
        evidence_snippet TEXT,
        confidence REAL NOT NULL DEFAULT 0.85,
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_claim_article ON claim(article_id);
      CREATE INDEX IF NOT EXISTS idx_claim_subject ON claim(subject_entity_id);

      -- Sprint 5 (0004_entity_v2) tables
      CREATE TABLE IF NOT EXISTS role_term (
        id TEXT PRIMARY KEY,
        role_entity_id TEXT NOT NULL,
        holder_entity_id TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        source_url TEXT,
        FOREIGN KEY (role_entity_id) REFERENCES entity(id) ON DELETE CASCADE,
        FOREIGN KEY (holder_entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_role_term_role ON role_term(role_entity_id, valid_from DESC);
      CREATE INDEX IF NOT EXISTS idx_role_term_holder ON role_term(holder_entity_id, valid_from DESC);

      CREATE TABLE IF NOT EXISTS registry_version (
        version INTEGER PRIMARY KEY,
        updated_at TEXT NOT NULL,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS article_resolution (
        article_id TEXT PRIMARY KEY,
        registry_version INTEGER NOT NULL,
        resolver_version TEXT NOT NULL,
        resolved_at TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_article_resolution_ver ON article_resolution(registry_version, resolver_version);

      CREATE TABLE IF NOT EXISTS entity_candidate (
        alias_norm TEXT PRIMARY KEY,
        surface_raw TEXT NOT NULL,
        guessed_type TEXT NOT NULL,
        doc_freq INTEGER NOT NULL DEFAULT 1,
        outlet_count INTEGER NOT NULL DEFAULT 1,
        distinct_days INTEGER NOT NULL DEFAULT 1,
        sample_sentences_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        verdict_json TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_status_freq ON entity_candidate(status, doc_freq DESC);

      CREATE TABLE IF NOT EXISTS entity_denylist (
        alias_norm TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entity_merge_log (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        score REAL,
        created_at TEXT NOT NULL,
        undone_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_merge_log_from ON entity_merge_log(from_entity_id);
      CREATE INDEX IF NOT EXISTS idx_merge_log_to ON entity_merge_log(to_entity_id);

      -- Sprint 6 (0005_checks) tables
      CREATE TABLE IF NOT EXISTS verification_check (
        id TEXT PRIMARY KEY,
        input_type TEXT NOT NULL,
        image_hash TEXT,
        perceptual_hash TEXT,
        text_hash TEXT,
        r2_key TEXT,
        extracted_claim_json TEXT NOT NULL,
        results_json TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_version TEXT NOT NULL,
        pipeline_version TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 1,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        stage_timings_json TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_hit_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_check_image_hash ON verification_check(image_hash, pipeline_version);
      CREATE INDEX IF NOT EXISTS idx_check_perceptual_hash ON verification_check(pipeline_version, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_check_text_hash ON verification_check(text_hash, pipeline_version);
      CREATE INDEX IF NOT EXISTS idx_check_popular ON verification_check(hit_count DESC, last_hit_at DESC);

      CREATE TABLE IF NOT EXISTS vlm_cache (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model_version TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        response_json TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Idempotent column migrations for existing pre-Sprint-5 index.sqlite files
    this.ensureColumn('entity', 'status', "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn('entity', 'source', "TEXT NOT NULL DEFAULT 'seed'");
    this.ensureColumn('entity', 'merged_into', 'TEXT');
    this.ensureColumn('entity', 'is_hub', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('entity', 'description_bn', 'TEXT');
    this.ensureColumn('entity', 'description_en', 'TEXT');
    this.ensureColumn('entity', 'short_tagline_bn', 'TEXT');
    this.ensureColumn('entity', 'short_tagline_en', 'TEXT');
    this.ensureColumn('entity', 'description_sources_json', 'TEXT');
    this.ensureColumn('entity', 'description_updated_at', 'TEXT');
    this.ensureColumn('entity', 'auto_score', 'REAL');
    this.ensureColumn('entity', 'verdict_json', 'TEXT');
    this.ensureColumn('entity', 'article_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('entity', 'event_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('entity', 'first_seen', 'TEXT');
    this.ensureColumn('entity', 'last_seen', 'TEXT');

    this.ensureColumn('entity_alias', 'kind', "TEXT NOT NULL DEFAULT 'name'");
    this.ensureColumn('entity_alias', 'require_uppercase', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('entity_alias', 'source', "TEXT NOT NULL DEFAULT 'seed'");

    this.ensureColumn('article_entity', 'role', "TEXT NOT NULL DEFAULT 'mentioned'");
    this.ensureColumn('article_entity', 'mention_count', 'INTEGER NOT NULL DEFAULT 1');
    this.ensureColumn('article_entity', 'in_headline', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('article_entity', 'link_method', "TEXT NOT NULL DEFAULT 'name_exact'");
    this.ensureColumn('article_entity', 'link_confidence', 'REAL NOT NULL DEFAULT 0.9');
    this.ensureColumn('article_entity', 'salience', 'REAL NOT NULL DEFAULT 0.5');

    this.ensureColumn('entity_relation', 'predicate_label', 'TEXT');
    this.ensureColumn('entity_relation', 'source', "TEXT NOT NULL DEFAULT 'deterministic'");

    this.ensureColumn('claim', 'speaker_entity_id', 'TEXT');
    this.ensureColumn('claim', 'numbers_json', 'TEXT');
    this.ensureColumn('claim', 'dates_json', 'TEXT');
    this.ensureColumn('claim', 'hedging_level', "TEXT DEFAULT 'reported'");
    this.ensureColumn('claim', 'extractor_version', "TEXT NOT NULL DEFAULT 'v2'");

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_entity_status_articles ON entity(status, article_count DESC);
      CREATE INDEX IF NOT EXISTS idx_entity_hub ON entity(is_hub, status);
      CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_alias(entity_id);
      CREATE INDEX IF NOT EXISTS idx_article_entity_aid_eid ON article_entity(article_id, entity_id);
      CREATE INDEX IF NOT EXISTS idx_article_entity_eid_salience ON article_entity(entity_id, salience DESC);
      CREATE INDEX IF NOT EXISTS idx_rel_source_type ON entity_relation(source_entity_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_rel_target_type ON entity_relation(target_entity_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_claim_speaker ON claim(speaker_entity_id);
    `);
  }

  getExistingArticleIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM article').all() as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  getTotalArticleCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM article').get() as { c: number };
    return row.c;
  }

  /**
   * Keyset-paginated streaming iterator over `article` so 211k+ full bodies never spike RAM.
   */
  *streamArticlesForEntities(batchSize = 2000): Generator<StreamedArticleRow[]> {
    const stmt = this.db.prepare(
      `SELECT rowid, id, outlet, title, lead, clean_text as cleanText, published_at as publishedAt
       FROM article
       WHERE rowid > ?
       ORDER BY rowid ASC
       LIMIT ?`
    );

    let lastRowId = 0;
    while (true) {
      const batch = stmt.all(lastRowId, batchSize) as StreamedArticleRow[];
      if (batch.length === 0) break;
      yield batch;
      lastRowId = batch[batch.length - 1]!.rowid;
    }
  }

  upsertArticleAndChunks(
    article: {
      id: string;
      outlet: OutletId;
      canonicalUrl: string;
      title: string;
      publishedAt: string | null;
      byline: string | null;
      lead: string | null;
      cleanText: string;
    },
    chunks: ArticleChunk[]
  ): void {
    const insertArticle = this.db.prepare(`
      INSERT INTO article (id, outlet, canonical_url, title, published_at, byline, lead, clean_text, pipeline_version)
      VALUES ($id, $outlet, $canonicalUrl, $title, $publishedAt, $byline, $lead, $cleanText, 'v1')
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        published_at = excluded.published_at,
        byline = excluded.byline,
        lead = excluded.lead,
        clean_text = excluded.clean_text
    `);

    const deleteOldChunks = this.db.prepare('DELETE FROM chunk WHERE article_id = ?');
    const insertChunk = this.db.prepare(`
      INSERT INTO chunk (id, article_id, outlet, position, text, published_at, embedding_version)
      VALUES ($id, $articleId, $outlet, $position, $text, $publishedAt, $embeddingVersion)
    `);

    const tx = this.db.transaction(() => {
      insertArticle.run({
        $id: article.id,
        $outlet: article.outlet,
        $canonicalUrl: article.canonicalUrl,
        $title: article.title,
        $publishedAt: article.publishedAt,
        $byline: article.byline,
        $lead: article.lead,
        $cleanText: article.cleanText,
      });
      deleteOldChunks.run(article.id);
      for (const ch of chunks) {
        insertChunk.run({
          $id: ch.id,
          $articleId: ch.articleId,
          $outlet: ch.outlet,
          $position: ch.position,
          $text: ch.text,
          $publishedAt: ch.publishedAt,
          $embeddingVersion: ch.embeddingVersion,
        });
      }
    });

    tx();
  }

  getAllChunksForExport(): Array<{ id: string; article_id: string; outlet: string; text: string }> {
    return this.db
      .prepare('SELECT id, article_id, outlet, text FROM chunk ORDER BY article_id, position')
      .all() as Array<{ id: string; article_id: string; outlet: string; text: string }>;
  }

  saveChunkVectorsBatch(
    rows: Array<{ chunkId: string; dims: number; embeddingVersion: string; vector: Float32Array }>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO chunk_vector (chunk_id, dims, embedding_version, vector_blob)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        dims = excluded.dims,
        embedding_version = excluded.embedding_version,
        vector_blob = excluded.vector_blob
    `);
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const bytes = new Uint8Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength);
        stmt.run(r.chunkId, r.dims, r.embeddingVersion, bytes);
      }
    });
    tx();
  }

  saveArticleVector(
    articleId: string,
    dims: number,
    embeddingVersion: string,
    vector: Float32Array
  ): void {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
    this.db
      .prepare(
        `INSERT INTO article_vector (article_id, dims, embedding_version, vector_blob)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET
           dims = excluded.dims,
           embedding_version = excluded.embedding_version,
           vector_blob = excluded.vector_blob`
      )
      .run(articleId, dims, embeddingVersion, bytes);
  }

  getArticleChunksWithVectors(): Array<{
    articleId: string;
    position: number;
    embeddingVersion: string;
    vectorBlob: Uint8Array;
  }> {
    return this.db
      .prepare(
        `SELECT c.article_id as articleId, c.position as position, cv.embedding_version as embeddingVersion, cv.vector_blob as vectorBlob
         FROM chunk c
         JOIN chunk_vector cv ON cv.chunk_id = c.id
         ORDER BY c.article_id ASC, c.position ASC`
      )
      .all() as any[];
  }

  getEmbeddedArticles(): Array<{
    articleId: string;
    outlet: OutletId;
    title: string;
    lead: string | null;
    publishedAt: string | null;
    vectorBlob: Uint8Array;
  }> {
    return this.db
      .prepare(
        `SELECT a.id as articleId, a.outlet, a.title, a.lead, a.published_at as publishedAt, av.vector_blob as vectorBlob
         FROM article_vector av
         JOIN article a ON a.id = av.article_id`
      )
      .all() as any[];
  }

  saveClustersAndEdges(
    edges: SimilarityEdge[],
    clusters: ComputedCluster[],
    articleToCluster: Map<string, string>
  ): { redirectsWritten: number } {
    let redirectsWritten = 0;
    const tx = this.db.transaction(() => {
      // Snapshot old article -> cluster mapping before wiping so stable event_redirect rows can be built
      const prevRows = this.db
        .prepare('SELECT article_id as articleId, cluster_id as clusterId FROM article_cluster')
        .all() as Array<{ articleId: string; clusterId: string }>;
      const prevMap = new Map(prevRows.map((r) => [r.articleId, r.clusterId]));

      this.db.run('DELETE FROM article_similarity_edge');
      this.db.run('DELETE FROM article_cluster');
      this.db.run('DELETE FROM event_cluster');

      const insertEdge = this.db.prepare(
        'INSERT INTO article_similarity_edge (source_id, target_id, similarity) VALUES (?, ?, ?)'
      );
      for (const e of edges) {
        insertEdge.run(e.source, e.target, e.similarity);
      }

      const insertCluster = this.db.prepare(
        `INSERT INTO event_cluster (id, label, lead_snippet, first_seen, last_seen, article_count, outlet_count, outlets_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of clusters) {
        insertCluster.run(
          c.id,
          c.label,
          c.leadSnippet,
          c.firstSeen,
          c.lastSeen,
          c.articleIds.length,
          c.outlets.length,
          JSON.stringify(c.outlets)
        );
      }

      const insertMember = this.db.prepare(
        'INSERT INTO article_cluster (article_id, cluster_id) VALUES (?, ?)'
      );
      for (const [articleId, clusterId] of articleToCluster.entries()) {
        insertMember.run(articleId, clusterId);
      }

      // Compute & collapse event redirects when previous cluster memberships existed
      if (prevMap.size > 0) {
        const redirects = buildRedirects(prevMap, articleToCluster, 0.5);
        const collapseStmt = this.db.prepare('UPDATE event_redirect SET new_id = ? WHERE new_id = ?');
        const upsertRedirect = this.db.prepare(
          'INSERT OR REPLACE INTO event_redirect (old_id, new_id) VALUES (?, ?)'
        );
        for (const r of redirects) {
          collapseStmt.run(r.newId, r.oldId);
          upsertRedirect.run(r.oldId, r.newId);
        }
        redirectsWritten = redirects.length;
      }
    });
    tx();
    return { redirectsWritten };
  }

  getCurrentRegistryVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM registry_version').get() as { v: number | null };
    return row?.v ?? 0;
  }

  bumpRegistryVersion(note: string): number {
    const next = this.getCurrentRegistryVersion() + 1;
    this.db
      .prepare('INSERT INTO registry_version (version, updated_at, note) VALUES (?, ?, ?)')
      .run(next, new Date().toISOString(), note);
    return next;
  }

  /**
   * One-way sync of curated `source = 'seed'` entities, aliases, and `role_term` rows.
   * Preserves all `source = 'auto'` / `'manual'` entities, descriptions, and merge history.
   */
  syncSeedRegistry(entities: Entity[], aliases: EntityAlias[], roleTerms: RoleTerm[]): number {
    let version = 1;
    const tx = this.db.transaction(() => {
      const upsertEntity = this.db.prepare(`
        INSERT INTO entity (
          id, canonical_bn, canonical_en, entity_type, status, source, is_hub,
          short_tagline_bn, short_tagline_en, description_bn, description_en, metadata_json
        ) VALUES (?, ?, ?, ?, 'active', 'seed', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          canonical_bn = excluded.canonical_bn,
          canonical_en = excluded.canonical_en,
          entity_type = excluded.entity_type,
          status = 'active',
          source = 'seed',
          is_hub = excluded.is_hub,
          short_tagline_bn = COALESCE(excluded.short_tagline_bn, entity.short_tagline_bn),
          short_tagline_en = COALESCE(excluded.short_tagline_en, entity.short_tagline_en),
          description_bn = COALESCE(excluded.description_bn, entity.description_bn),
          description_en = COALESCE(excluded.description_en, entity.description_en),
          metadata_json = COALESCE(excluded.metadata_json, entity.metadata_json)
      `);

      for (const e of entities) {
        upsertEntity.run(
          e.id,
          e.canonicalBn ?? null,
          e.canonicalEn ?? null,
          e.entityType,
          e.isHub ? 1 : 0,
          e.shortTaglineBn ?? null,
          e.shortTaglineEn ?? null,
          e.descriptionBn ?? null,
          e.descriptionEn ?? null,
          e.metadataJson ?? null
        );
      }

      // Replace only seed-owned aliases so auto/manual aliases stay intact
      this.db.run("DELETE FROM entity_alias WHERE source = 'seed'");
      const upsertAlias = this.db.prepare(`
        INSERT OR REPLACE INTO entity_alias (
          alias_norm, alias_raw, entity_id, valid_from, valid_to, kind, require_uppercase, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')
      `);
      for (const a of aliases) {
        upsertAlias.run(
          a.aliasNorm,
          a.aliasRaw,
          a.entityId,
          a.validFrom ?? null,
          a.validTo ?? null,
          a.kind ?? 'name',
          a.requireUppercase ? 1 : 0
        );
      }

      // Replace role_term rows from curated seed
      this.db.run('DELETE FROM role_term');
      const insertRoleTerm = this.db.prepare(`
        INSERT INTO role_term (id, role_entity_id, holder_entity_id, valid_from, valid_to, source_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const rt of roleTerms) {
        insertRoleTerm.run(
          rt.id,
          rt.roleEntityId,
          rt.holderEntityId,
          rt.validFrom,
          rt.validTo ?? null,
          rt.sourceUrl ?? null
        );
      }

      version = this.bumpRegistryVersion(
        `sync-seed: ${entities.length} entities, ${aliases.length} aliases, ${roleTerms.length} role_terms`
      );
    });
    tx();
    return version;
  }

  getRegistrySnapshot(): RegistrySnapshot {
    const version = Math.max(1, this.getCurrentRegistryVersion());
    const entities = (
      this.db
        .prepare(
          `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
                  status, source, merged_into as mergedInto, is_hub as isHub,
                  description_bn as descriptionBn, description_en as descriptionEn,
                  short_tagline_bn as shortTaglineBn, short_tagline_en as shortTaglineEn,
                  description_sources_json as descriptionSourcesJson, description_updated_at as descriptionUpdatedAt,
                  auto_score as autoScore, verdict_json as verdictJson,
                  article_count as articleCount, event_count as eventCount,
                  first_seen as firstSeen, last_seen as lastSeen, metadata_json as metadataJson
           FROM entity`
        )
        .all() as any[]
    ).map((r) => ({ ...r, isHub: Boolean(r.isHub) })) as Entity[];

    const aliases = (
      this.db
        .prepare(
          `SELECT alias_norm as aliasNorm, alias_raw as aliasRaw, entity_id as entityId,
                  valid_from as validFrom, valid_to as validTo, kind,
                  require_uppercase as requireUppercase, source
           FROM entity_alias`
        )
        .all() as any[]
    ).map((r) => ({ ...r, requireUppercase: Boolean(r.requireUppercase) })) as EntityAlias[];

    const roleTerms = this.db
      .prepare(
        `SELECT id, role_entity_id as roleEntityId, holder_entity_id as holderEntityId,
                valid_from as validFrom, valid_to as validTo, source_url as sourceUrl
         FROM role_term`
      )
      .all() as RoleTerm[];

    return {
      version,
      generatedAt: new Date().toISOString(),
      entities,
      aliases,
      roleTerms,
    };
  }

  getDenylistSet(): Set<string> {
    const rows = this.db.prepare('SELECT alias_norm as aliasNorm FROM entity_denylist').all() as Array<{
      aliasNorm: string;
    }>;
    return new Set(rows.map((r) => r.aliasNorm));
  }

  clearDeterministicResolutionData(preserveLlmRelations = true): void {
    const tx = this.db.transaction(() => {
      if (preserveLlmRelations) {
        this.db.run("DELETE FROM entity_relation WHERE source = 'deterministic'");
      } else {
        this.db.run('DELETE FROM entity_relation');
      }
      this.db.run('DELETE FROM article_entity');
      this.db.run('DELETE FROM article_resolution');
    });
    tx();
  }

  /**
   * Legacy full-replace helper kept for backwards compatibility in tests/scripts.
   */
  replaceEntityRegistryAndClearHypergraph(
    entities: Entity[],
    aliases: EntityAlias[],
    roleTerms: RoleTerm[] = []
  ): void {
    const tx = this.db.transaction(() => {
      this.db.run('DELETE FROM entity_relation');
      this.db.run('DELETE FROM article_entity');
      this.db.run('DELETE FROM article_resolution');
      this.db.run('DELETE FROM role_term');
      this.db.run('DELETE FROM entity_alias');
      this.db.run('DELETE FROM entity');

      const insertEntity = this.db.prepare(
        `INSERT INTO entity (id, canonical_bn, canonical_en, entity_type, status, source, is_hub, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of entities) {
        insertEntity.run(
          e.id,
          e.canonicalBn ?? null,
          e.canonicalEn ?? null,
          e.entityType,
          e.status ?? 'active',
          e.source ?? 'seed',
          e.isHub ? 1 : 0,
          e.metadataJson ?? null
        );
      }

      const insertAlias = this.db.prepare(
        `INSERT OR REPLACE INTO entity_alias (alias_norm, alias_raw, entity_id, valid_from, valid_to, kind, require_uppercase, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of aliases) {
        insertAlias.run(
          a.aliasNorm,
          a.aliasRaw,
          a.entityId,
          a.validFrom ?? null,
          a.validTo ?? null,
          a.kind ?? 'name',
          a.requireUppercase ? 1 : 0,
          a.source ?? 'seed'
        );
      }

      const insertRt = this.db.prepare(
        `INSERT INTO role_term (id, role_entity_id, holder_entity_id, valid_from, valid_to, source_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const rt of roleTerms) {
        insertRt.run(
          rt.id,
          rt.roleEntityId,
          rt.holderEntityId,
          rt.validFrom,
          rt.validTo ?? null,
          rt.sourceUrl ?? null
        );
      }
      this.bumpRegistryVersion(`replace-all: ${entities.length} entities`);
    });
    tx();
  }

  saveArticleResolutionBatch(
    mentions: ArticleEntityMention[],
    relations: EntityRelation[],
    stamps: Array<{ articleId: string; registryVersion: number; resolverVersion: string; mentionCount: number }>
  ): void {
    const nowIso = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const insertMention = this.db.prepare(
        `INSERT OR REPLACE INTO article_entity (
           article_id, entity_id, chunk_id, surface_form, role, confidence,
           mention_count, in_headline, link_method, link_confidence, salience
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of mentions) {
        insertMention.run(
          m.articleId,
          m.entityId,
          m.chunkId ?? null,
          m.surfaceForm,
          m.role,
          m.linkConfidence ?? m.confidence,
          m.mentionCount ?? 1,
          m.inHeadline ? 1 : 0,
          m.linkMethod ?? 'name_exact',
          m.linkConfidence ?? m.confidence,
          m.salience ?? 0.5
        );
      }

      const insertRelation = this.db.prepare(
        `INSERT OR REPLACE INTO entity_relation (
           id, article_id, source_entity_id, target_entity_id, relation_type,
           predicate_label, source, evidence_snippet, published_at, confidence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of relations) {
        insertRelation.run(
          r.id,
          r.articleId,
          r.sourceEntityId,
          r.targetEntityId,
          r.relationType,
          r.predicateLabel ?? null,
          r.source ?? 'deterministic',
          r.evidenceSnippet,
          r.publishedAt ?? null,
          r.confidence
        );
      }

      const upsertStamp = this.db.prepare(
        `INSERT OR REPLACE INTO article_resolution (article_id, registry_version, resolver_version, resolved_at, mention_count)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const st of stamps) {
        upsertStamp.run(st.articleId, st.registryVersion, st.resolverVersion, nowIso, st.mentionCount);
      }
    });
    tx();
  }

  saveEntityHypergraphBatch(
    mentions: ArticleEntityMention[],
    relations: EntityRelation[]
  ): void {
    this.saveArticleResolutionBatch(mentions, relations, []);
  }

  upsertEntityCandidates(candidates: EntityCandidate[]): void {
    const nowIso = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO entity_candidate (
          alias_norm, surface_raw, guessed_type, doc_freq, outlet_count, distinct_days,
          sample_sentences_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(alias_norm) DO UPDATE SET
          surface_raw = excluded.surface_raw,
          guessed_type = excluded.guessed_type,
          doc_freq = excluded.doc_freq,
          outlet_count = excluded.outlet_count,
          distinct_days = excluded.distinct_days,
          sample_sentences_json = excluded.sample_sentences_json,
          updated_at = excluded.updated_at
      `);
      for (const c of candidates) {
        stmt.run(
          c.aliasNorm,
          c.surfaceRaw,
          c.guessedType,
          c.docFreq,
          c.outletCount,
          c.distinctDays,
          c.sampleSentencesJson,
          nowIso
        );
      }
    });
    tx();
  }

  getPendingCandidates(opts: {
    minDocFreq?: number;
    minOutlets?: number;
    limit?: number;
    includeVerified?: boolean;
  } = {}): EntityCandidate[] {
    const minDocFreq = opts.minDocFreq ?? 4;
    const minOutlets = opts.minOutlets ?? 2;
    const statusClause = opts.includeVerified ? "status IN ('pending', 'promoted', 'merged', 'rejected')" : "status = 'pending'";
    const limitClause = opts.limit && opts.limit > 0 ? 'LIMIT ?' : '';
    const sql = `
      SELECT alias_norm as aliasNorm, surface_raw as surfaceRaw, guessed_type as guessedType,
             doc_freq as docFreq, outlet_count as outletCount, distinct_days as distinctDays,
             sample_sentences_json as sampleSentencesJson, status, verdict_json as verdictJson,
             updated_at as updatedAt
      FROM entity_candidate
      WHERE ${statusClause}
        AND doc_freq >= ?
        AND outlet_count >= ?
        AND alias_norm NOT IN (SELECT alias_norm FROM entity_denylist)
      ORDER BY doc_freq DESC, outlet_count DESC
      ${limitClause}
    `;
    return (
      limitClause
        ? this.db.prepare(sql).all(minDocFreq, minOutlets, opts.limit!)
        : this.db.prepare(sql).all(minDocFreq, minOutlets)
    ) as EntityCandidate[];
  }

  /**
   * Auditable, reversible entity merge: marks `fromId` as merged into `toId`,
   * repoints aliases, and records a row in `entity_merge_log`.
   */
  mergeEntities(fromEntityId: string, toEntityId: string, reason: string, score: number | null = null): string {
    const logId = `mrg_${createHash('sha1').update(`${fromEntityId}|${toEntityId}|${Date.now()}`).digest('hex').slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE entity SET status = 'merged', merged_into = ? WHERE id = ?")
        .run(toEntityId, fromEntityId);
      // Collapse any existing chains pointing to fromEntityId
      this.db
        .prepare('UPDATE entity SET merged_into = ? WHERE merged_into = ?')
        .run(toEntityId, fromEntityId);
      // Copy aliases onto surviving entity
      this.db
        .prepare(
          `INSERT OR IGNORE INTO entity_alias (alias_norm, alias_raw, entity_id, valid_from, valid_to, kind, require_uppercase, source)
           SELECT alias_norm, alias_raw, ?, valid_from, valid_to, kind, require_uppercase, source
           FROM entity_alias WHERE entity_id = ?`
        )
        .run(toEntityId, fromEntityId);
      // Repoint existing article_entity and entity_relation rows where non-conflicting
      this.db
        .prepare(
          `INSERT OR IGNORE INTO article_entity (
             article_id, entity_id, chunk_id, surface_form, role, confidence,
             mention_count, in_headline, link_method, link_confidence, salience
           )
           SELECT article_id, ?, chunk_id, surface_form, role, confidence,
                  mention_count, in_headline, link_method, link_confidence, salience
           FROM article_entity WHERE entity_id = ?`
        )
        .run(toEntityId, fromEntityId);
      this.db.prepare('DELETE FROM article_entity WHERE entity_id = ?').run(fromEntityId);
      this.db
        .prepare('UPDATE OR IGNORE entity_relation SET source_entity_id = ? WHERE source_entity_id = ?')
        .run(toEntityId, fromEntityId);
      this.db
        .prepare('UPDATE OR IGNORE entity_relation SET target_entity_id = ? WHERE target_entity_id = ?')
        .run(toEntityId, fromEntityId);
      this.db
        .prepare('DELETE FROM entity_relation WHERE source_entity_id = target_entity_id')
        .run();

      this.db
        .prepare(
          `INSERT INTO entity_merge_log (id, from_entity_id, to_entity_id, reason, score, created_at, undone_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(logId, fromEntityId, toEntityId, reason, score, nowIso);
      this.bumpRegistryVersion(`merge ${fromEntityId} -> ${toEntityId} (${logId})`);
    });
    tx();
    return logId;
  }

  /**
   * Reverses a logged merge cleanly so `from_entity_id` returns to `'active'`.
   */
  unmergeEntities(logId: string): { fromEntityId: string; toEntityId: string } | null {
    const row = this.db
      .prepare('SELECT from_entity_id as fromEntityId, to_entity_id as toEntityId, undone_at as undoneAt FROM entity_merge_log WHERE id = ?')
      .get(logId) as { fromEntityId: string; toEntityId: string; undoneAt: string | null } | null;
    if (!row || row.undoneAt) return null;

    const nowIso = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE entity SET status = 'active', merged_into = NULL WHERE id = ?")
        .run(row.fromEntityId);
      // Remove copied aliases from target that originally belonged to fromEntityId
      this.db
        .prepare(
          `DELETE FROM entity_alias
           WHERE entity_id = ?
             AND source != 'seed'
             AND alias_norm IN (SELECT alias_norm FROM entity_alias WHERE entity_id = ?)`
        )
        .run(row.toEntityId, row.fromEntityId);
      this.db.prepare('UPDATE entity_merge_log SET undone_at = ? WHERE id = ?').run(nowIso, logId);
      this.bumpRegistryVersion(`unmerge ${logId}: restored ${row.fromEntityId}`);
    });
    tx();
    return { fromEntityId: row.fromEntityId, toEntityId: row.toEntityId };
  }

  rejectEntity(entityId: string, reason: string): number {
    const nowIso = new Date().toISOString();
    let deniedCount = 0;
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE entity SET status = 'rejected' WHERE id = ?").run(entityId);
      const aliases = this.db
        .prepare('SELECT alias_norm as aliasNorm FROM entity_alias WHERE entity_id = ?')
        .all(entityId) as Array<{ aliasNorm: string }>;
      const insertDeny = this.db.prepare(
        'INSERT OR REPLACE INTO entity_denylist (alias_norm, reason, created_at) VALUES (?, ?, ?)'
      );
      for (const a of aliases) {
        insertDeny.run(a.aliasNorm, reason, nowIso);
        deniedCount++;
      }
      this.db.prepare('DELETE FROM article_entity WHERE entity_id = ?').run(entityId);
      this.db.prepare('DELETE FROM entity_relation WHERE source_entity_id = ? OR target_entity_id = ?').run(entityId, entityId);
      this.db.prepare('DELETE FROM event_entity WHERE entity_id = ?').run(entityId);
      this.bumpRegistryVersion(`reject ${entityId}: ${reason}`);
    });
    tx();
    return deniedCount;
  }

  /**
   * Stage B selector: picks 1–2 richest representative articles per multi-outlet cluster
   * (longest Bangla article + longest English article when cluster is bilingual).
   * Zero N+1 queries!
   */
  getEventRepresentativeArticles(opts: {
    minOutlets?: number;
    maxPerCluster?: number;
    limitClusters?: number;
    skipAlreadyExtracted?: boolean;
  } = {}): EventRepresentativeArticle[] {
    const minOutlets = opts.minOutlets ?? 2;
    const maxPerCluster = opts.maxPerCluster ?? 2;
    const limitClusters = opts.limitClusters;

    const alreadyExtractedArticles = new Set<string>();
    if (opts.skipAlreadyExtracted) {
      const rows = this.db
        .prepare("SELECT DISTINCT article_id as articleId FROM claim WHERE extractor_version = 'v2'")
        .all() as Array<{ articleId: string }>;
      for (const r of rows) alreadyExtractedArticles.add(r.articleId);
    }

    const clusters = (
      limitClusters && limitClusters > 0
        ? this.db
            .prepare(
              `SELECT id, label, outlet_count as outletCount
               FROM event_cluster
               WHERE outlet_count >= ?
               ORDER BY outlet_count DESC, last_seen DESC
               LIMIT ?`
            )
            .all(minOutlets, limitClusters)
        : this.db
            .prepare(
              `SELECT id, label, outlet_count as outletCount
               FROM event_cluster
               WHERE outlet_count >= ?
               ORDER BY outlet_count DESC, last_seen DESC`
            )
            .all(minOutlets)
    ) as Array<{ id: string; label: string; outletCount: number }>;

    const clusterMeta = new Map(clusters.map((c) => [c.id, c]));
    if (clusterMeta.size === 0) return [];

    // Stream member rows in one indexed scan grouped by cluster_id
    const memberRows = this.db
      .prepare(
        `SELECT ac.cluster_id as clusterId, a.id as articleId, a.outlet, a.title, a.lead,
                a.clean_text as cleanText, a.published_at as publishedAt,
                LENGTH(COALESCE(a.clean_text, '')) as bodyLen
         FROM article_cluster ac
         JOIN event_cluster ec ON ec.id = ac.cluster_id
         JOIN article a ON a.id = ac.article_id
         WHERE ec.outlet_count >= ?
         ORDER BY ac.cluster_id ASC, bodyLen DESC`
      )
      .all(minOutlets) as Array<{
      clusterId: string;
      articleId: string;
      outlet: OutletId;
      title: string;
      lead: string | null;
      cleanText: string | null;
      publishedAt: string | null;
      bodyLen: number;
    }>;

    const byCluster = new Map<string, { bn?: typeof memberRows[0]; en?: typeof memberRows[0]; second?: typeof memberRows[0] }>();
    for (const r of memberRows) {
      if (!clusterMeta.has(r.clusterId)) continue;
      let slot = byCluster.get(r.clusterId);
      if (!slot) {
        slot = {};
        byCluster.set(r.clusterId, slot);
      }
      const isEn = r.outlet === 'daily-star' || r.outlet === 'business-standard';
      if (isEn) {
        if (!slot.en) slot.en = r;
        else if (!slot.second) slot.second = r;
      } else {
        if (!slot.bn) slot.bn = r;
        else if (!slot.second) slot.second = r;
      }
    }

    const out: EventRepresentativeArticle[] = [];
    for (const c of clusters) {
      const slot = byCluster.get(c.id);
      if (!slot) continue;
      const picked: Array<{ row: typeof memberRows[0]; lang: 'bn' | 'en' }> = [];
      if (slot.bn) picked.push({ row: slot.bn, lang: 'bn' });
      if (slot.en && picked.length < maxPerCluster) picked.push({ row: slot.en, lang: 'en' });
      if (picked.length === 1 && slot.second && maxPerCluster >= 2 && c.outletCount >= 4) {
        // For huge 4+ outlet monolingual clusters, add a 2nd distinct-outlet Bangla source
        if (slot.second.outlet !== picked[0]!.row.outlet) {
          picked.push({
            row: slot.second,
            lang: slot.second.outlet === 'daily-star' || slot.second.outlet === 'business-standard' ? 'en' : 'bn',
          });
        }
      }

      for (const p of picked) {
        if (alreadyExtractedArticles.has(p.row.articleId)) continue;
        out.push({
          clusterId: c.id,
          clusterLabel: c.label,
          outletCount: c.outletCount,
          articleId: p.row.articleId,
          outlet: p.row.outlet,
          title: p.row.title,
          lead: p.row.lead,
          cleanText: p.row.cleanText,
          publishedAt: p.row.publishedAt,
          language: p.lang,
        });
      }
    }

    return out;
  }

  /**
   * Stage C selector: builds corpus-grounded evidence packets for top active entities + all seed entities.
   */
  getTopEntitiesForDossier(opts: {
    minArticles?: number;
    limit?: number;
    onlyMissing?: boolean;
  } = {}): DossierEntityPacket[] {
    const minArticles = opts.minArticles ?? 5;
    const limit = opts.limit ?? 5000;
    const missingClause = opts.onlyMissing ? 'AND (description_en IS NULL OR description_bn IS NULL)' : '';

    const entities = this.db
      .prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn,
                entity_type as entityType, article_count as articleCount, event_count as eventCount
         FROM entity
         WHERE status = 'active'
           AND (source = 'seed' OR article_count >= ? OR event_count >= 2)
           ${missingClause}
         ORDER BY article_count DESC, event_count DESC
         LIMIT ?`
      )
      .all(minArticles, limit) as Array<{
      id: string;
      canonicalBn: string | null;
      canonicalEn: string | null;
      entityType: Entity['entityType'];
      articleCount: number;
      eventCount: number;
    }>;

    const aliasStmt = this.db.prepare('SELECT alias_raw as aliasRaw FROM entity_alias WHERE entity_id = ? LIMIT 12');
    const roleStmt = this.db.prepare(
      `SELECT COALESCE(r.canonical_en, r.canonical_bn, rt.role_entity_id) as role,
              rt.valid_from as validFrom, rt.valid_to as validTo
       FROM role_term rt
       LEFT JOIN entity r ON r.id = rt.role_entity_id
       WHERE rt.holder_entity_id = ?
       ORDER BY rt.valid_from DESC`
    );
    const artStmt = this.db.prepare(
      `SELECT a.id as articleId, a.outlet, a.published_at as publishedAt, a.title, a.lead
       FROM article_entity ae
       JOIN article a ON a.id = ae.article_id
       WHERE ae.entity_id = ?
       ORDER BY ae.in_headline DESC, ae.salience DESC, a.published_at DESC
       LIMIT 8`
    );
    const relStmt = this.db.prepare(
      `SELECT
         CASE WHEN r.source_entity_id = ? THEN 'out' ELSE 'in' END as direction,
         r.relation_type as relationType,
         r.predicate_label as predicateLabel,
         COALESCE(other.canonical_en, other.canonical_bn, other.id) as otherName,
         COUNT(*) as weight,
         MIN(r.evidence_snippet) as sampleSnippet
       FROM entity_relation r
       JOIN entity other ON other.id = CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END
       WHERE (r.source_entity_id = ? OR r.target_entity_id = ?)
         AND other.status = 'active'
       GROUP BY direction, r.relation_type, other.id
       ORDER BY weight DESC
       LIMIT 10`
    );

    const packets: DossierEntityPacket[] = [];
    for (const ent of entities) {
      const aliases = (aliasStmt.all(ent.id) as Array<{ aliasRaw: string }>).map((a) => a.aliasRaw);
      const roleTerms = roleStmt.all(ent.id) as Array<{ role: string; validFrom: string; validTo: string | null }>;
      const sampleArticles = artStmt.all(ent.id) as DossierEntityPacket['sampleArticles'];
      const topRelations = relStmt.all(ent.id, ent.id, ent.id, ent.id) as DossierEntityPacket['topRelations'];
      packets.push({
        ...ent,
        aliases,
        roleTerms,
        sampleArticles,
        topRelations,
      });
    }
    return packets;
  }

  saveEntityDossiers(
    dossiers: Array<{
      entityId: string;
      shortTaglineBn: string;
      shortTaglineEn: string;
      descriptionBn: string;
      descriptionEn: string;
      citingArticleIds: string[];
    }>
  ): number {
    const nowIso = new Date().toISOString();
    let updated = 0;
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare(
        `UPDATE entity
         SET short_tagline_bn = ?, short_tagline_en = ?,
             description_bn = ?, description_en = ?,
             description_sources_json = ?, description_updated_at = ?
         WHERE id = ?`
      );
      for (const d of dossiers) {
        const res = stmt.run(
          d.shortTaglineBn,
          d.shortTaglineEn,
          d.descriptionBn,
          d.descriptionEn,
          JSON.stringify(d.citingArticleIds),
          nowIso,
          d.entityId
        );
        if (res.changes > 0) updated++;
      }
    });
    tx();
    return updated;
  }

  getRawDb(): Database {
    return this.db;
  }

  upsertLlmExtractionBatch(params: {
    entities: Entity[];
    aliases: EntityAlias[];
    mentions: ArticleEntityMention[];
    relations?: EntityRelation[];
    claims: Array<{
      id: string;
      articleId: string;
      claimText: string;
      claimType: string;
      speakerEntityId?: string | null;
      subjectEntityId: string | null;
      objectEntityId: string | null;
      numbersJson?: string | null;
      datesJson?: string | null;
      hedgingLevel?: string | null;
      evidenceSnippet: string | null;
      confidence: number;
      extractorVersion?: string;
    }>;
  }): void {
    const tx = this.db.transaction(() => {
      const insertEntity = this.db.prepare(
        `INSERT OR IGNORE INTO entity (
           id, canonical_bn, canonical_en, entity_type, status, source, is_hub,
           short_tagline_bn, short_tagline_en, description_bn, description_en,
           auto_score, verdict_json, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of params.entities) {
        insertEntity.run(
          e.id,
          e.canonicalBn ?? null,
          e.canonicalEn ?? null,
          e.entityType,
          e.status ?? 'active',
          e.source ?? 'auto',
          e.isHub ? 1 : 0,
          e.shortTaglineBn ?? null,
          e.shortTaglineEn ?? null,
          e.descriptionBn ?? null,
          e.descriptionEn ?? null,
          e.autoScore ?? null,
          e.verdictJson ?? null,
          e.metadataJson ?? null
        );
      }

      const insertAlias = this.db.prepare(
        `INSERT OR IGNORE INTO entity_alias (alias_norm, alias_raw, entity_id, valid_from, valid_to, kind, require_uppercase, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of params.aliases) {
        insertAlias.run(
          a.aliasNorm,
          a.aliasRaw,
          a.entityId,
          a.validFrom ?? null,
          a.validTo ?? null,
          a.kind ?? 'name',
          a.requireUppercase ? 1 : 0,
          a.source ?? 'auto'
        );
      }

      const insertMention = this.db.prepare(
        `INSERT OR REPLACE INTO article_entity (
           article_id, entity_id, chunk_id, surface_form, role, confidence,
           mention_count, in_headline, link_method, link_confidence, salience
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of params.mentions) {
        insertMention.run(
          m.articleId,
          m.entityId,
          m.chunkId ?? null,
          m.surfaceForm,
          m.role,
          m.linkConfidence ?? m.confidence,
          m.mentionCount ?? 1,
          m.inHeadline ? 1 : 0,
          m.linkMethod ?? 'llm_linked',
          m.linkConfidence ?? m.confidence,
          m.salience ?? 0.6
        );
      }

      if (params.relations && params.relations.length > 0) {
        const insertRel = this.db.prepare(
          `INSERT OR REPLACE INTO entity_relation (
             id, article_id, source_entity_id, target_entity_id, relation_type,
             predicate_label, source, evidence_snippet, published_at, confidence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of params.relations) {
          insertRel.run(
            r.id,
            r.articleId,
            r.sourceEntityId,
            r.targetEntityId,
            r.relationType,
            r.predicateLabel ?? null,
            r.source ?? 'llm_claim',
            r.evidenceSnippet,
            r.publishedAt ?? null,
            r.confidence
          );
        }
      }

      const insertClaim = this.db.prepare(
        `INSERT OR REPLACE INTO claim (
           id, article_id, claim_text, claim_type, speaker_entity_id,
           subject_entity_id, object_entity_id, numbers_json, dates_json,
           hedging_level, evidence_snippet, confidence, extractor_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of params.claims) {
        insertClaim.run(
          c.id,
          c.articleId,
          c.claimText,
          c.claimType,
          c.speakerEntityId ?? null,
          c.subjectEntityId,
          c.objectEntityId,
          c.numbersJson ?? null,
          c.datesJson ?? null,
          c.hedgingLevel ?? 'reported',
          c.evidenceSnippet,
          c.confidence,
          c.extractorVersion ?? 'v2'
        );
      }
    });
    tx();
  }

  /**
   * Materializes `event_entity` using true `ae.in_headline`, applies a participation threshold
   * so single stray body mentions don't pollute large clusters, precomputes `entity.article_count`
   * / `event_count` / `first_seen` / `last_seen`, and updates dynamic `is_hub` flags (> 15% of events).
   */
  materializeEventEntities(): {
    eventEntityRows: number;
    eventsCovered: number;
    hubCount: number;
  } {
    const tx = this.db.transaction(() => {
      this.db.run('DELETE FROM event_entity');
      this.db.run(`
        INSERT INTO event_entity (
          event_id, entity_id, role, article_count, outlet_count, headline_count, salience, event_start, event_end
        )
        SELECT
          ec.id AS event_id,
          ae.entity_id AS entity_id,
          CASE MAX(
            CASE ae.role
              WHEN 'quoted_speaker' THEN 5
              WHEN 'actor' THEN 4
              WHEN 'subject' THEN 3
              WHEN 'location' THEN 2
              ELSE 1
            END
          )
            WHEN 5 THEN 'quoted_speaker'
            WHEN 4 THEN 'actor'
            WHEN 3 THEN 'subject'
            WHEN 2 THEN 'location'
            ELSE 'mentioned'
          END AS role,
          COUNT(DISTINCT ac.article_id) AS article_count,
          COUNT(DISTINCT a.outlet) AS outlet_count,
          COUNT(DISTINCT CASE WHEN ae.in_headline = 1 THEN ac.article_id END) AS headline_count,
          MIN(
            1.0,
            (CAST(COUNT(DISTINCT ac.article_id) AS REAL) / MAX(1, ec.article_count)) * 0.50 +
            (CASE WHEN COUNT(DISTINCT CASE WHEN ae.in_headline = 1 THEN ac.article_id END) > 0 THEN 0.30 ELSE 0.0 END) +
            (CAST(COUNT(DISTINCT a.outlet) AS REAL) / MAX(1, ec.outlet_count)) * 0.12 +
            (AVG(ae.salience) * 0.08)
          ) AS salience,
          COALESCE(ec.first_seen, MIN(a.published_at), '') AS event_start,
          COALESCE(ec.last_seen, MAX(a.published_at), '') AS event_end
        FROM article_cluster ac
        JOIN event_cluster ec ON ec.id = ac.cluster_id
        JOIN article a ON a.id = ac.article_id
        JOIN article_entity ae ON ae.article_id = ac.article_id
        JOIN entity e ON e.id = ae.entity_id
        WHERE e.status = 'active'
        GROUP BY ec.id, ae.entity_id
        HAVING COUNT(DISTINCT CASE WHEN ae.in_headline = 1 THEN ac.article_id END) > 0
            OR COUNT(DISTINCT ac.article_id) >= 2
            OR ec.article_count <= 2
      `);

      // Recompute denormalized per-entity article_count, first_seen, last_seen
      this.db.run(`
        UPDATE entity
        SET article_count = 0, event_count = 0, first_seen = NULL, last_seen = NULL
      `);

      this.db.run(`
        UPDATE entity
        SET
          article_count = COALESCE((
            SELECT COUNT(DISTINCT ae.article_id)
            FROM article_entity ae
            WHERE ae.entity_id = entity.id
          ), 0),
          first_seen = (
            SELECT MIN(a.published_at)
            FROM article_entity ae
            JOIN article a ON a.id = ae.article_id
            WHERE ae.entity_id = entity.id AND a.published_at IS NOT NULL
          ),
          last_seen = (
            SELECT MAX(a.published_at)
            FROM article_entity ae
            JOIN article a ON a.id = ae.article_id
            WHERE ae.entity_id = entity.id AND a.published_at IS NOT NULL
          )
      `);

      this.db.run(`
        UPDATE entity
        SET event_count = COALESCE((
          SELECT COUNT(DISTINCT ee.event_id)
          FROM event_entity ee
          WHERE ee.entity_id = entity.id
        ), 0)
      `);

      // Update is_hub flags: explicit SEED_HUB_IDS OR appearing in > 15% of all events
      const totalEventsRow = this.db
        .prepare('SELECT COUNT(DISTINCT event_id) as c FROM event_entity')
        .get() as { c: number };
      const hubThreshold = Math.max(50, Math.floor((totalEventsRow.c || 0) * 0.15));

      this.db.run('UPDATE entity SET is_hub = 0');
      const hubIds = Array.from(SEED_HUB_IDS);
      if (hubIds.length > 0) {
        const ph = hubIds.map(() => '?').join(',');
        this.db.prepare(`UPDATE entity SET is_hub = 1 WHERE id IN (${ph})`).run(...hubIds);
      }
      this.db.prepare('UPDATE entity SET is_hub = 1 WHERE event_count >= ?').run(hubThreshold);
    });
    tx();

    const row = this.db
      .prepare('SELECT COUNT(*) as eventEntityRows, COUNT(DISTINCT event_id) as eventsCovered FROM event_entity')
      .get() as { eventEntityRows: number; eventsCovered: number };
    const hubRow = this.db
      .prepare("SELECT COUNT(*) as c FROM entity WHERE is_hub = 1 AND status = 'active'")
      .get() as { c: number };
    return {
      eventEntityRows: row.eventEntityRows,
      eventsCovered: row.eventsCovered,
      hubCount: hubRow.c,
    };
  }

  getEntityDiagnostics(): {
    totals: Record<string, number>;
    topEntities: Array<{
      id: string;
      canonicalBn: string | null;
      canonicalEn: string | null;
      entityType: string;
      isHub: number;
      articleCount: number;
      eventCount: number;
      hasDescription: number;
    }>;
    relationHistogram: Array<{ relationType: string; source: string; count: number }>;
    linkMethodHistogram: Array<{ linkMethod: string; count: number }>;
    sampleRelations: Array<{
      sourceName: string;
      relationType: string;
      predicateLabel: string | null;
      targetName: string;
      source: string;
      snippet: string;
    }>;
  } {
    const totals = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM article) as articles,
           (SELECT COUNT(*) FROM entity WHERE status = 'active') as activeEntities,
           (SELECT COUNT(*) FROM entity WHERE status = 'active' AND source = 'seed') as seedEntities,
           (SELECT COUNT(*) FROM entity WHERE status = 'active' AND source = 'auto') as autoEntities,
           (SELECT COUNT(*) FROM entity WHERE status = 'active' AND is_hub = 1) as hubs,
           (SELECT COUNT(*) FROM entity WHERE status = 'active' AND description_en IS NOT NULL) as entitiesWithDescriptions,
           (SELECT COUNT(*) FROM entity_alias) as aliases,
           (SELECT COUNT(*) FROM role_term) as roleTerms,
           (SELECT COUNT(*) FROM article_entity) as articleMentions,
           (SELECT COUNT(*) FROM event_entity) as eventEntityRows,
           (SELECT COUNT(*) FROM entity_relation) as relations,
           (SELECT COUNT(*) FROM claim) as claims,
           (SELECT COUNT(*) FROM entity_candidate WHERE status = 'pending') as pendingCandidates`
      )
      .get() as Record<string, number>;

    const topEntities = this.db
      .prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn,
                entity_type as entityType, is_hub as isHub,
                article_count as articleCount, event_count as eventCount,
                CASE WHEN description_en IS NOT NULL THEN 1 ELSE 0 END as hasDescription
         FROM entity
         WHERE status = 'active'
         ORDER BY article_count DESC
         LIMIT 30`
      )
      .all() as any[];

    const relationHistogram = this.db
      .prepare(
        `SELECT relation_type as relationType, source, COUNT(*) as count
         FROM entity_relation
         GROUP BY relation_type, source
         ORDER BY count DESC`
      )
      .all() as any[];

    const linkMethodHistogram = this.db
      .prepare(
        `SELECT link_method as linkMethod, COUNT(*) as count
         FROM article_entity
         GROUP BY link_method
         ORDER BY count DESC`
      )
      .all() as any[];

    const sampleRelations = this.db
      .prepare(
        `SELECT
           COALESCE(s.canonical_en, s.canonical_bn, s.id) as sourceName,
           r.relation_type as relationType,
           r.predicate_label as predicateLabel,
           COALESCE(t.canonical_en, t.canonical_bn, t.id) as targetName,
           r.source,
           r.evidence_snippet as snippet
         FROM entity_relation r
         JOIN entity s ON s.id = r.source_entity_id
         JOIN entity t ON t.id = r.target_entity_id
         ORDER BY RANDOM()
         LIMIT 25`
      )
      .all() as any[];

    return { totals, topEntities, relationHistogram, linkMethodHistogram, sampleRelations };
  }

  getCounts(): {
    articles: number;
    chunks: number;
    chunkVectors: number;
    articleVectors: number;
    clusters: number;
    edges: number;
    entities: number;
    entityRelations: number;
  } {
    return this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM article) as articles,
           (SELECT COUNT(*) FROM chunk) as chunks,
           (SELECT COUNT(*) FROM chunk_vector) as chunkVectors,
           (SELECT COUNT(*) FROM article_vector) as articleVectors,
           (SELECT COUNT(*) FROM event_cluster) as clusters,
           (SELECT COUNT(*) FROM article_similarity_edge) as edges,
           (SELECT COUNT(*) FROM entity WHERE status = 'active') as entities,
           (SELECT COUNT(*) FROM entity_relation) as entityRelations`
      )
      .get() as any;
  }

  close(): void {
    this.db.run('PRAGMA wal_checkpoint(PASSIVE);');
    this.db.close();
  }
}
