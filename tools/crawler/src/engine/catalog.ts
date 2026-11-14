/**
 * @file tools/crawler/src/engine/catalog.ts
 * SQLite catalog storage for harvested article URLs, metadata, and crawl cursors.
 * Built with native `bun:sqlite` and shares 100% schema compatibility with Cloudflare D1.
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { Article, CrawlJob, ListItem, OutletId } from '@jachaikori/schema';
import { canonicalizeUrl } from './url';
import { parsePublishedDate } from '../dates/parser';

export class CatalogDatabase {
  private db: Database;

  constructor(filePath: string = 'data/catalog.sqlite') {
    this.db = new Database(filePath, { create: true });
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  /**
   * Initializes the D1-compatible SQLite tables and indices.
   */
  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS article (
        id TEXT PRIMARY KEY,
        outlet TEXT NOT NULL,
        canonical_url TEXT NOT NULL UNIQUE,
        original_url TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT,
        published_at_raw TEXT,
        fetched_at TEXT,
        status TEXT NOT NULL DEFAULT 'discovered',
        raw_html_pointer TEXT,
        clean_text TEXT,
        byline TEXT,
        pipeline_version TEXT NOT NULL DEFAULT 'v1',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS article_source (
        article_id TEXT NOT NULL,
        outlet TEXT NOT NULL,
        source_key TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        PRIMARY KEY (article_id, source_key),
        FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS crawl_job (
        id TEXT PRIMARY KEY,
        outlet TEXT NOT NULL,
        source_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        cursor TEXT,
        items_found INTEGER NOT NULL DEFAULT 0,
        oldest_date_reached TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_article_outlet_date ON article(outlet, published_at);
      CREATE INDEX IF NOT EXISTS idx_article_status ON article(status);
      CREATE INDEX IF NOT EXISTS idx_job_outlet ON crawl_job(outlet);
    `);
  }

  /**
   * Generates a deterministic article ID by hashing its canonical URL.
   */
  static hashUrl(canonicalUrl: string): string {
    return createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 32);
  }

  /**
   * Upserts a discovered ListItem into the article and article_source tables.
   */
  upsertDiscoveredItem(
    outlet: OutletId,
    sourceKey: string,
    item: ListItem,
    customUrlCleaner?: (url: string) => string
  ): { isNew: boolean; articleId: string; publishedAtIso: string | null } {
    const canonical = canonicalizeUrl(item.url, customUrlCleaner);
    const articleId = CatalogDatabase.hashUrl(canonical);
    const nowIso = new Date().toISOString();
    const publishedAtIso = parsePublishedDate(item.publishedAtRaw);

    const upsertStmt = this.db.prepare(`
      INSERT INTO article (
        id, outlet, canonical_url, original_url, title,
        published_at, published_at_raw, status, pipeline_version, created_at, updated_at
      ) VALUES (
        $id, $outlet, $canonicalUrl, $originalUrl, $title,
        $publishedAt, $publishedAtRaw, 'discovered', 'v1', $createdAt, $updatedAt
      )
      ON CONFLICT(canonical_url) DO UPDATE SET
        title = COALESCE(NULLIF(excluded.title, ''), article.title),
        published_at = COALESCE(excluded.published_at, article.published_at),
        published_at_raw = COALESCE(NULLIF(excluded.published_at_raw, ''), article.published_at_raw),
        updated_at = excluded.updated_at
      RETURNING (created_at = updated_at) AS is_new;
    `);

    const result = upsertStmt.get({
      $id: articleId,
      $outlet: outlet,
      $canonicalUrl: canonical,
      $originalUrl: item.url,
      $title: item.title,
      $publishedAt: publishedAtIso,
      $publishedAtRaw: item.publishedAtRaw,
      $createdAt: nowIso,
      $updatedAt: nowIso,
    }) as { is_new: number } | undefined;

    const isNew = Boolean(result?.is_new);

    // Record source linkage
    this.db.run(
      `INSERT OR IGNORE INTO article_source (article_id, outlet, source_key, discovered_at)
       VALUES (?, ?, ?, ?);`,
      [articleId, outlet, sourceKey, nowIso]
    );

    return { isNew, articleId, publishedAtIso };
  }

  /**
   * Reads or creates a persistent crawl job cursor.
   */
  getOrCreateJob(outlet: OutletId, sourceKey: string): CrawlJob {
    const jobId = `${outlet}:${sourceKey}`;
    const row = this.db.prepare('SELECT * FROM crawl_job WHERE id = ?').get(jobId) as any;

    if (row) {
      return {
        id: row.id,
        outlet: row.outlet as OutletId,
        sourceKey: row.source_key,
        status: row.status,
        cursor: row.cursor,
        itemsFound: row.items_found,
        oldestDateReached: row.oldest_date_reached,
        lastError: row.last_error,
        updatedAt: row.updated_at,
      };
    }

    const nowIso = new Date().toISOString();
    this.db.run(
      `INSERT INTO crawl_job (id, outlet, source_key, status, cursor, items_found, updated_at)
       VALUES (?, ?, ?, 'pending', NULL, 0, ?)`,
      [jobId, outlet, sourceKey, nowIso]
    );

    return {
      id: jobId,
      outlet,
      sourceKey,
      status: 'pending',
      cursor: null,
      itemsFound: 0,
      oldestDateReached: null,
      lastError: null,
      updatedAt: nowIso,
    };
  }

  /**
   * Updates job cursor progress and stats.
   */
  updateJobProgress(
    jobId: string,
    updates: Partial<Pick<CrawlJob, 'status' | 'cursor' | 'itemsFound' | 'oldestDateReached' | 'lastError'>>
  ): void {
    const nowIso = new Date().toISOString();
    const sets: string[] = ['updated_at = $updatedAt'];
    const params: Record<string, any> = { $jobId: jobId, $updatedAt: nowIso };

    if (updates.status !== undefined) {
      sets.push('status = $status');
      params.$status = updates.status;
    }
    if (updates.cursor !== undefined) {
      sets.push('cursor = $cursor');
      params.$cursor = updates.cursor;
    }
    if (updates.itemsFound !== undefined) {
      sets.push('items_found = $itemsFound');
      params.$itemsFound = updates.itemsFound;
    }
    if (updates.oldestDateReached !== undefined) {
      sets.push('oldest_date_reached = $oldestDateReached');
      params.$oldestDateReached = updates.oldestDateReached;
    }
    if (updates.lastError !== undefined) {
      sets.push('last_error = $lastError');
      params.$lastError = updates.lastError;
    }

    this.db.prepare(`UPDATE crawl_job SET ${sets.join(', ')} WHERE id = $jobId`).run(params);
  }

  /**
   * Retrieves summary statistics per outlet.
   */
  getOutletStats(): Array<{ outlet: string; totalArticles: number; oldestArticle: string | null; newestArticle: string | null }> {
    const rows = this.db.prepare(`
      SELECT 
        outlet,
        COUNT(*) as totalArticles,
        MIN(published_at) as oldestArticle,
        MAX(published_at) as newestArticle
      FROM article
      GROUP BY outlet
      ORDER BY outlet ASC
    `).all() as any[];

    return rows;
  }

  /**
   * Exports articles from the database.
   */
  getArticles(outlet?: OutletId): Array<{ id: string; outlet: string; canonicalUrl: string; title: string; publishedAt: string | null }> {
    if (outlet) {
      return this.db.prepare(`
        SELECT id, outlet, canonical_url as canonicalUrl, title, published_at as publishedAt
        FROM article
        WHERE outlet = ?
        ORDER BY published_at DESC, created_at DESC
      `).all(outlet) as any[];
    }

    return this.db.prepare(`
      SELECT id, outlet, canonical_url as canonicalUrl, title, published_at as publishedAt
      FROM article
      ORDER BY outlet ASC, published_at DESC, created_at DESC
    `).all() as any[];
  }

  /**
   * Closes the database cleanly.
   */
  close(): void {
    this.db.close();
  }
}
