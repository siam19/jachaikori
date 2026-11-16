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

    const existing = this.db.prepare('SELECT 1 FROM article WHERE id = ?').get(articleId);
    const isNew = !existing;

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
        updated_at = excluded.updated_at;
    `);

    upsertStmt.run({
      $id: articleId,
      $outlet: outlet,
      $canonicalUrl: canonical,
      $originalUrl: item.url,
      $title: item.title,
      $publishedAt: publishedAtIso,
      $publishedAtRaw: item.publishedAtRaw,
      $createdAt: nowIso,
      $updatedAt: nowIso,
    });

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
   * Retrieves total count of discovered articles across all outlets.
   */
  getTotalArticleCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM article').get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Retrieves count of articles linked to a specific outlet and source.
   */
  getArticleCountForSource(outlet: OutletId, sourceKey: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM article_source
      WHERE outlet = ? AND source_key = ?
    `).get(outlet, sourceKey) as { count: number } | undefined;
    return row?.count ?? 0;
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
   * Prunes articles that fail the URL allowlist filter, removes orphaned crawl_job rows,
   * reconciles job article counts, and vacuums the SQLite database.
   */
  pruneCatalog(
    isAllowed: (outlet: OutletId, canonicalUrl: string) => boolean,
    validJobIds?: Set<string>
  ): { deletedArticles: number; deletedJobs: number; remainingArticles: number } {
    const rows = this.db
      .prepare('SELECT id, outlet, canonical_url FROM article')
      .all() as Array<{ id: string; outlet: OutletId; canonical_url: string }>;

    const idsToDelete: string[] = [];
    for (const row of rows) {
      if (!isAllowed(row.outlet, row.canonical_url)) {
        idsToDelete.push(row.id);
      }
    }

    const deleteArticleStmt = this.db.prepare('DELETE FROM article WHERE id = ?');
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteArticleStmt.run(id);
      }
    });

    if (idsToDelete.length > 0) {
      tx(idsToDelete);
    }

    let deletedJobs = 0;
    if (validJobIds) {
      const jobs = this.db.prepare('SELECT id FROM crawl_job').all() as Array<{ id: string }>;
      const deleteJobStmt = this.db.prepare('DELETE FROM crawl_job WHERE id = ?');
      for (const job of jobs) {
        if (!validJobIds.has(job.id)) {
          deleteJobStmt.run(job.id);
          deletedJobs++;
        }
      }
    }

    // Reconcile crawl_job.items_found against article_source
    this.db.run(`
      UPDATE crawl_job
      SET items_found = (
        SELECT COUNT(*)
        FROM article_source
        WHERE article_source.outlet = crawl_job.outlet
          AND article_source.source_key = crawl_job.source_key
      )
    `);

    if (idsToDelete.length > 0 || deletedJobs > 0) {
      this.db.run('VACUUM;');
    }

    return {
      deletedArticles: idsToDelete.length,
      deletedJobs,
      remainingArticles: this.getTotalArticleCount(),
    };
  }

  /**
   * Returns daily article counts per outlet within an optional date window [fromDate, toDate] (YYYY-MM-DD).
   */
  getDailyCounts(
    fromDate?: string,
    toDate?: string
  ): Array<{ outlet: string; day: string; count: number }> {
    let sql = `
      SELECT outlet, substr(published_at, 1, 10) as day, COUNT(*) as count
      FROM article
      WHERE published_at IS NOT NULL
    `;
    const params: string[] = [];
    if (fromDate) {
      sql += ' AND substr(published_at, 1, 10) >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND substr(published_at, 1, 10) <= ?';
      params.push(toDate);
    }
    sql += ' GROUP BY outlet, day ORDER BY outlet ASC, day ASC';
    return this.db.prepare(sql).all(...params) as Array<{ outlet: string; day: string; count: number }>;
  }

  /**
   * Closes the database cleanly.
   */
  close(): void {
    this.db.close();
  }
}
