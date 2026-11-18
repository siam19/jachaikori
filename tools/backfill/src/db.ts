/**
 * @file tools/backfill/src/db.ts
 * Local SQLite index store (`data/index/index.sqlite`) mirroring D1's schema
 * plus binary Float32Array vector storage for chunk & article centroid vectors.
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BANGLA_FTS_TOKENIZE_CLAUSE, type ComputedCluster, type SimilarityEdge } from '@jachaikori/retrieval';
import type { ArticleChunk, OutletId } from '@jachaikori/schema';

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
        confidence REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (article_id, entity_id, surface_form),
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
      );
    `);
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

  getRawDb(): Database {
    return this.db;
  }

  getCounts(): { articles: number; chunks: number; chunkVectors: number; articleVectors: number; clusters: number; edges: number } {
    return this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM article) as articles,
           (SELECT COUNT(*) FROM chunk) as chunks,
           (SELECT COUNT(*) FROM chunk_vector) as chunkVectors,
           (SELECT COUNT(*) FROM article_vector) as articleVectors,
           (SELECT COUNT(*) FROM event_cluster) as clusters,
           (SELECT COUNT(*) FROM article_similarity_edge) as edges`
      )
      .get() as any;
  }

  close(): void {
    this.db.run('PRAGMA wal_checkpoint(PASSIVE);');
    this.db.close();
  }
}
