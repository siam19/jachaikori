/**
 * @file tools/backfill/src/db.ts
 * Local SQLite index store (`data/index/index.sqlite`) mirroring D1's schema
 * plus binary Float32Array vector storage for chunk & article centroid vectors.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BANGLA_FTS_TOKENIZE_CLAUSE, type ComputedCluster, type SimilarityEdge } from '@jachaikori/retrieval';
import type {
  ArticleChunk,
  ArticleEntityMention,
  Entity,
  EntityAlias,
  EntityRelation,
  OutletId,
} from '@jachaikori/schema';

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
    `);

    // Migrate existing article_entity tables created before Sprint 4
    const cols = this.db.prepare('PRAGMA table_info(article_entity)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'role')) {
      this.db.run("ALTER TABLE article_entity ADD COLUMN role TEXT NOT NULL DEFAULT 'mentioned'");
    }
  }

  getExistingArticleIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM article').all() as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
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
  ): void {
    const tx = this.db.transaction(() => {
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
    });
    tx();
  }

  getAllArticlesForEntities(): Array<{
    id: string;
    outlet: OutletId;
    title: string;
    lead: string | null;
    cleanText: string | null;
    publishedAt: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT id, outlet, title, lead, clean_text as cleanText, published_at as publishedAt
         FROM article
         ORDER BY published_at DESC`
      )
      .all() as any[];
  }

  replaceEntityRegistryAndClearHypergraph(entities: Entity[], aliases: EntityAlias[]): void {
    const tx = this.db.transaction(() => {
      this.db.run('DELETE FROM entity_relation');
      this.db.run('DELETE FROM article_entity');
      this.db.run('DELETE FROM entity_alias');
      this.db.run('DELETE FROM entity');

      const insertEntity = this.db.prepare(
        `INSERT INTO entity (id, canonical_bn, canonical_en, entity_type, metadata_json)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const e of entities) {
        insertEntity.run(
          e.id,
          e.canonicalBn ?? null,
          e.canonicalEn ?? null,
          e.entityType,
          e.metadataJson ?? null
        );
      }

      const insertAlias = this.db.prepare(
        `INSERT OR REPLACE INTO entity_alias (alias_norm, alias_raw, entity_id, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const a of aliases) {
        insertAlias.run(
          a.aliasNorm,
          a.aliasRaw,
          a.entityId,
          a.validFrom ?? null,
          a.validTo ?? null
        );
      }
    });
    tx();
  }

  saveEntityHypergraphBatch(
    mentions: ArticleEntityMention[],
    relations: EntityRelation[]
  ): void {
    const tx = this.db.transaction(() => {
      const insertMention = this.db.prepare(
        `INSERT OR REPLACE INTO article_entity (article_id, entity_id, chunk_id, surface_form, role, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const m of mentions) {
        insertMention.run(
          m.articleId,
          m.entityId,
          m.chunkId ?? null,
          m.surfaceForm,
          m.role,
          m.confidence
        );
      }

      const insertRelation = this.db.prepare(
        `INSERT OR REPLACE INTO entity_relation (id, article_id, source_entity_id, target_entity_id, relation_type, evidence_snippet, published_at, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of relations) {
        insertRelation.run(
          r.id,
          r.articleId,
          r.sourceEntityId,
          r.targetEntityId,
          r.relationType,
          r.evidenceSnippet,
          r.publishedAt ?? null,
          r.confidence
        );
      }
    });
    tx();
  }

  getRawDb(): Database {
    return this.db;
  }

  getArticlesForLlmExtract(limit?: number): Array<{
    id: string;
    outlet: string;
    title: string;
    lead: string | null;
    cleanText: string | null;
    publishedAt: string | null;
    clusterId: string | null;
    outletCount: number;
  }> {
    const sql = `
      SELECT
        a.id,
        a.outlet,
        a.title,
        a.lead,
        a.clean_text as cleanText,
        a.published_at as publishedAt,
        ac.cluster_id as clusterId,
        COALESCE(ec.outlet_count, 1) as outletCount
      FROM article a
      LEFT JOIN article_cluster ac ON ac.article_id = a.id
      LEFT JOIN event_cluster ec ON ec.id = ac.cluster_id
      ORDER BY
        CASE WHEN COALESCE(ec.outlet_count, 1) >= 2 THEN 0 ELSE 1 END ASC,
        COALESCE(ec.outlet_count, 1) DESC,
        a.published_at DESC
      ${limit && limit > 0 ? 'LIMIT ?' : ''}
    `;
    return (limit && limit > 0
      ? this.db.prepare(sql).all(limit)
      : this.db.prepare(sql).all()) as any;
  }

  getKnownCandidatesForArticle(
    articleId: string,
    clusterId: string | null
  ): Array<{
    id: string;
    canonicalBn: string | null;
    canonicalEn: string | null;
    entityType: string;
  }> {
    if (clusterId) {
      return this.db
        .prepare(
          `SELECT DISTINCT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn, e.entity_type as entityType
           FROM entity e
           JOIN article_entity ae ON ae.entity_id = e.id
           LEFT JOIN article_cluster ac ON ac.article_id = ae.article_id
           WHERE ae.article_id = ? OR ac.cluster_id = ?
           LIMIT 30`
        )
        .all(articleId, clusterId) as any;
    }
    return this.db
      .prepare(
        `SELECT DISTINCT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn, e.entity_type as entityType
         FROM entity e
         JOIN article_entity ae ON ae.entity_id = e.id
         WHERE ae.article_id = ?
         LIMIT 30`
      )
      .all(articleId) as any;
  }

  upsertLlmExtractionBatch(params: {
    entities: Entity[];
    aliases: EntityAlias[];
    mentions: ArticleEntityMention[];
    claims: Array<{
      id: string;
      articleId: string;
      claimText: string;
      claimType: string;
      subjectEntityId: string | null;
      objectEntityId: string | null;
      evidenceSnippet: string | null;
      confidence: number;
    }>;
  }): void {
    const tx = this.db.transaction(() => {
      const insertEntity = this.db.prepare(
        `INSERT OR IGNORE INTO entity (id, canonical_bn, canonical_en, entity_type, metadata_json)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const e of params.entities) {
        insertEntity.run(
          e.id,
          e.canonicalBn ?? null,
          e.canonicalEn ?? null,
          e.entityType,
          e.metadataJson ?? null
        );
      }

      const insertAlias = this.db.prepare(
        `INSERT OR IGNORE INTO entity_alias (alias_norm, alias_raw, entity_id, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const a of params.aliases) {
        insertAlias.run(
          a.aliasNorm,
          a.aliasRaw,
          a.entityId,
          a.validFrom ?? null,
          a.validTo ?? null
        );
      }

      const insertMention = this.db.prepare(
        `INSERT OR REPLACE INTO article_entity (article_id, entity_id, chunk_id, surface_form, role, confidence)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const m of params.mentions) {
        insertMention.run(
          m.articleId,
          m.entityId,
          m.chunkId ?? null,
          m.surfaceForm,
          m.role,
          m.confidence
        );
      }

      const insertClaim = this.db.prepare(
        `INSERT OR REPLACE INTO claim (id, article_id, claim_text, claim_type, subject_entity_id, object_entity_id, evidence_snippet, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of params.claims) {
        insertClaim.run(
          c.id,
          c.articleId,
          c.claimText,
          c.claimType,
          c.subjectEntityId,
          c.objectEntityId,
          c.evidenceSnippet,
          c.confidence
        );
      }
    });
    tx();
  }

  materializeEventEntities(): { eventEntityRows: number; eventsCovered: number } {
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
          COUNT(DISTINCT CASE WHEN ae.role IN ('actor', 'subject', 'quoted_speaker') THEN ac.article_id END) AS headline_count,
          MIN(
            1.0,
            (CAST(COUNT(DISTINCT ac.article_id) AS REAL) / MAX(1, ec.article_count)) * 0.60 +
            (CASE WHEN COUNT(DISTINCT CASE WHEN ae.role IN ('actor', 'subject', 'quoted_speaker') THEN ac.article_id END) > 0 THEN 0.25 ELSE 0.0 END) +
            (CAST(COUNT(DISTINCT a.outlet) AS REAL) / MAX(1, ec.outlet_count)) * 0.15
          ) AS salience,
          COALESCE(ec.first_seen, MIN(a.published_at), '') AS event_start,
          COALESCE(ec.last_seen, MAX(a.published_at), '') AS event_end
        FROM article_cluster ac
        JOIN event_cluster ec ON ec.id = ac.cluster_id
        JOIN article a ON a.id = ac.article_id
        JOIN article_entity ae ON ae.article_id = ac.article_id
        GROUP BY ec.id, ae.entity_id
      `);
    });
    tx();

    const row = this.db
      .prepare('SELECT COUNT(*) as eventEntityRows, COUNT(DISTINCT event_id) as eventsCovered FROM event_entity')
      .get() as { eventEntityRows: number; eventsCovered: number };
    return row;
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
           (SELECT COUNT(*) FROM entity) as entities,
           (SELECT COUNT(*) FROM entity_relation) as entityRelations`
      )
      .get() as any;
  }

  close(): void {
    this.db.run('PRAGMA wal_checkpoint(PASSIVE);');
    this.db.close();
  }
}
