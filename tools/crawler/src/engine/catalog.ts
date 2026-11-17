/**
 * @file tools/crawler/src/engine/catalog.ts
 * SQLite catalog storage for harvested article URLs, metadata, and crawl cursors.
 * Built with native `bun:sqlite` and shares 100% schema compatibility with Cloudflare D1.
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { Article, CrawlJob, ListItem, OutletId } from '@jachaikori/schema';
import type { ExtractedArticle } from '@jachaikori/outlets';
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
   * Initializes the D1-compatible SQLite tables, indices, and idempotent column migrations.
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
        lead TEXT,
        clean_text TEXT,
        byline TEXT,
        last_error TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_article_outlet_status ON article(outlet, status, published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_outlet ON crawl_job(outlet);
    `);

    // Forward-compatible migration for existing catalog.sqlite databases
    const cols = this.db.prepare('PRAGMA table_info(article)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('lead')) {
      this.db.run('ALTER TABLE article ADD COLUMN lead TEXT;');
    }
    if (!colNames.has('last_error')) {
      this.db.run('ALTER TABLE article ADD COLUMN last_error TEXT;');
    }
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
   * Retrieves total count of active (non-skipped) articles across all outlets.
   */
  getTotalArticleCount(includeSkipped: boolean = false): number {
    const sql = includeSkipped
      ? 'SELECT COUNT(*) as count FROM article'
      : "SELECT COUNT(*) as count FROM article WHERE status != 'skipped'";
    const row = this.db.prepare(sql).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Retrieves count of active articles linked to a specific outlet and source.
   */
  getArticleCountForSource(outlet: OutletId, sourceKey: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM article_source s
      JOIN article a ON a.id = s.article_id
      WHERE s.outlet = ? AND s.source_key = ? AND a.status != 'skipped'
    `).get(outlet, sourceKey) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Retrieves summary statistics per outlet (active, extracted, failed, skipped).
   */
  getOutletStats(): Array<{
    outlet: string;
    totalArticles: number;
    extractedArticles: number;
    failedArticles: number;
    skippedArticles: number;
    oldestArticle: string | null;
    newestArticle: string | null;
  }> {
    const rows = this.db.prepare(`
      SELECT 
        outlet,
        SUM(CASE WHEN status != 'skipped' THEN 1 ELSE 0 END) as totalArticles,
        SUM(CASE WHEN status = 'extracted' THEN 1 ELSE 0 END) as extractedArticles,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedArticles,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skippedArticles,
        MIN(CASE WHEN status != 'skipped' THEN published_at ELSE NULL END) as oldestArticle,
        MAX(CASE WHEN status != 'skipped' THEN published_at ELSE NULL END) as newestArticle
      FROM article
      GROUP BY outlet
      ORDER BY outlet ASC
    `).all() as any[];

    return rows;
  }

  /**
   * Exports active (non-skipped) articles from the database.
   */
  getArticles(outlet?: OutletId): Array<{ id: string; outlet: string; canonicalUrl: string; title: string; publishedAt: string | null }> {
    if (outlet) {
      return this.db.prepare(`
        SELECT id, outlet, canonical_url as canonicalUrl, title, published_at as publishedAt
        FROM article
        WHERE outlet = ? AND status != 'skipped'
        ORDER BY published_at DESC, created_at DESC
      `).all(outlet) as any[];
    }

    return this.db.prepare(`
      SELECT id, outlet, canonical_url as canonicalUrl, title, published_at as publishedAt
      FROM article
      WHERE status != 'skipped'
      ORDER BY outlet ASC, published_at DESC, created_at DESC
    `).all() as any[];
  }

  /**
   * Marks disallowed articles as `status = 'skipped'` (or deletes them if `hardDelete` is true),
   * restores previously skipped rows that now pass `isAllowed`, removes orphaned `crawl_job` rows,
   * and reconciles job article counts.
   */
  pruneCatalog(
    isAllowed: (outlet: OutletId, canonicalUrl: string) => boolean,
    validJobIds?: Set<string>,
    options: { hardDelete?: boolean } = {}
  ): {
    skippedArticles: number;
    restoredArticles: number;
    deletedArticles: number;
    deletedJobs: number;
    remainingArticles: number;
    totalSkipped: number;
  } {
    const rows = this.db
      .prepare('SELECT id, outlet, canonical_url, status FROM article')
      .all() as Array<{ id: string; outlet: OutletId; canonical_url: string; status: string }>;

    const idsToSkipOrDelete: string[] = [];
    const idsToRestore: string[] = [];

    for (const row of rows) {
      const allowed = isAllowed(row.outlet, row.canonical_url);
      if (!allowed && row.status !== 'skipped') {
        idsToSkipOrDelete.push(row.id);
      } else if (allowed && row.status === 'skipped') {
        idsToRestore.push(row.id);
      }
    }

    const nowIso = new Date().toISOString();
    let skippedArticles = 0;
    let deletedArticles = 0;

    if (options.hardDelete) {
      const deleteStmt = this.db.prepare('DELETE FROM article WHERE id = ?');
      const tx = this.db.transaction((ids: string[]) => {
        for (const id of ids) deleteStmt.run(id);
      });
      if (idsToSkipOrDelete.length > 0) tx(idsToSkipOrDelete);
      deletedArticles = idsToSkipOrDelete.length;
    } else {
      const skipStmt = this.db.prepare("UPDATE article SET status = 'skipped', updated_at = ? WHERE id = ?");
      const tx = this.db.transaction((ids: string[]) => {
        for (const id of ids) skipStmt.run(nowIso, id);
      });
      if (idsToSkipOrDelete.length > 0) tx(idsToSkipOrDelete);
      skippedArticles = idsToSkipOrDelete.length;
    }

    if (idsToRestore.length > 0) {
      const restoreStmt = this.db.prepare("UPDATE article SET status = 'discovered', updated_at = ? WHERE id = ?");
      const restoreTx = this.db.transaction((ids: string[]) => {
        for (const id of ids) restoreStmt.run(nowIso, id);
      });
      restoreTx(idsToRestore);
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

    // Reconcile crawl_job.items_found against active articles in article_source
    this.db.run(`
      UPDATE crawl_job
      SET items_found = (
        SELECT COUNT(*)
        FROM article_source s
        JOIN article a ON a.id = s.article_id
        WHERE s.outlet = crawl_job.outlet
          AND s.source_key = crawl_job.source_key
          AND a.status != 'skipped'
      )
    `);

    if (deletedArticles > 0 || deletedJobs > 0) {
      this.db.run('VACUUM;');
    }

    const totalSkippedRow = this.db
      .prepare("SELECT COUNT(*) as count FROM article WHERE status = 'skipped'")
      .get() as { count: number } | undefined;

    return {
      skippedArticles,
      restoredArticles: idsToRestore.length,
      deletedArticles,
      deletedJobs,
      remainingArticles: this.getTotalArticleCount(),
      totalSkipped: totalSkippedRow?.count ?? 0,
    };
  }

  /**
   * Returns daily active article counts per outlet within an optional date window [fromDate, toDate] (YYYY-MM-DD).
   */
  getDailyCounts(
    fromDate?: string,
    toDate?: string
  ): Array<{ outlet: string; day: string; count: number }> {
    let sql = `
      SELECT outlet, substr(published_at, 1, 10) as day, COUNT(*) as count
      FROM article
      WHERE published_at IS NOT NULL AND status != 'skipped'
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
   * Samples random active articles for an outlet to verify live extraction.
   */
  sampleArticles(
    outlet: OutletId,
    limit: number = 2
  ): Array<{ canonicalUrl: string; title: string; publishedAt: string | null }> {
    return this.db
      .prepare(
        `SELECT canonical_url as canonicalUrl, title, published_at as publishedAt
         FROM article
         WHERE outlet = ? AND status != 'skipped'
         ORDER BY RANDOM()
         LIMIT ?`
      )
      .all(outlet, limit) as Array<{ canonicalUrl: string; title: string; publishedAt: string | null }>;
  }

  /**
   * Retrieves unscraped ('discovered', plus 'failed' if retryFailed=true) articles for an outlet,
   * ordered newest-first so the freshest news is scraped first.
   */
  getPendingArticlesForOutlet(
    outlet: OutletId,
    options: { limit?: number; retryFailed?: boolean } = {}
  ): Array<{ id: string; canonicalUrl: string; title: string; publishedAt: string | null }> {
    const statusFilter = options.retryFailed
      ? "status IN ('discovered', 'failed')"
      : "status = 'discovered'";

    let sql = `
      SELECT id, canonical_url as canonicalUrl, title, published_at as publishedAt
      FROM article
      WHERE outlet = ? AND ${statusFilter}
      ORDER BY published_at DESC, created_at DESC
    `;

    if (options.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      return this.db.prepare(sql).all(outlet, options.limit) as Array<{
        id: string;
        canonicalUrl: string;
        title: string;
        publishedAt: string | null;
      }>;
    }

    return this.db.prepare(sql).all(outlet) as Array<{
      id: string;
      canonicalUrl: string;
      title: string;
      publishedAt: string | null;
    }>;
  }

  /**
   * Returns current scrape progress counts per outlet for dashboard initialization.
   */
  getScrapeProgressByOutlet(): Array<{
    outlet: OutletId;
    activeTotal: number;
    extractedCount: number;
    failedCount: number;
    pendingCount: number;
  }> {
    return this.db
      .prepare(
        `SELECT
           outlet,
           SUM(CASE WHEN status != 'skipped' THEN 1 ELSE 0 END) as activeTotal,
           SUM(CASE WHEN status = 'extracted' THEN 1 ELSE 0 END) as extractedCount,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
           SUM(CASE WHEN status = 'discovered' THEN 1 ELSE 0 END) as pendingCount
         FROM article
         GROUP BY outlet
         ORDER BY outlet ASC`
      )
      .all() as Array<{
      outlet: OutletId;
      activeTotal: number;
      extractedCount: number;
      failedCount: number;
      pendingCount: number;
    }>;
  }

  /**
   * Atomically persists a scraped and extracted article immediately upon parse completion.
   * Preserves existing catalog title or published_at if the extracted page omitted them.
   */
  saveExtractedArticle(id: string, extracted: ExtractedArticle): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE article
         SET title = COALESCE(NULLIF($title, ''), title),
             published_at = COALESCE($publishedAtIso, published_at),
             published_at_raw = COALESCE(NULLIF($publishedAtRaw, ''), published_at_raw),
             byline = $byline,
             lead = $lead,
             clean_text = $cleanText,
             fetched_at = $fetchedAt,
             status = 'extracted',
             last_error = NULL,
             updated_at = $updatedAt
         WHERE id = $id`
      )
      .run({
        $id: id,
        $title: extracted.title.trim(),
        $publishedAtIso: extracted.publishedAtIso ?? null,
        $publishedAtRaw: extracted.publishedAtRaw.trim(),
        $byline: extracted.byline ?? null,
        $lead: extracted.lead ?? null,
        $cleanText: extracted.cleanText,
        $fetchedAt: nowIso,
        $updatedAt: nowIso,
      });
  }

  /**
   * Marks an article as failed with an error reason (used only after permanent parse/HTTP failure,
   * never on user Ctrl+C interruption).
   */
  markArticleFailed(id: string, errorMessage: string): void {
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE article
         SET status = 'failed',
             last_error = $lastError,
             updated_at = $updatedAt
         WHERE id = $id`
      )
      .run({
        $id: id,
        $lastError: errorMessage.slice(0, 500),
        $updatedAt: nowIso,
      });
  }

  /**
   * Retrieves a single article row by ID (useful for verification and tests).
   */
  getArticleById(id: string): {
    id: string;
    outlet: OutletId;
    canonicalUrl: string;
    title: string;
    publishedAt: string | null;
    publishedAtRaw: string | null;
    byline: string | null;
    lead: string | null;
    cleanText: string | null;
    status: string;
    lastError: string | null;
    fetchedAt: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           outlet,
           canonical_url as canonicalUrl,
           title,
           published_at as publishedAt,
           published_at_raw as publishedAtRaw,
           byline,
           lead,
           clean_text as cleanText,
           status,
           last_error as lastError,
           fetched_at as fetchedAt
         FROM article
         WHERE id = ?`
      )
      .get(id) as any;
    return row ?? null;
  }

  /**
   * Runs a passive WAL checkpoint so committed rows are flushed cleanly to disk.
   */
  checkpoint(): void {
    try {
      this.db.run('PRAGMA wal_checkpoint(PASSIVE);');
    } catch {
      // Non-fatal on :memory: or read-only DBs
    }
  }

  /**
   * Closes the database cleanly.
   */
  close(): void {
    this.checkpoint();
    this.db.close();
  }
}
