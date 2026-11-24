/**
 * @file tools/crawler/test/catalog.test.ts
 * Tests for URL canonicalization, SQLite catalog upserts, scrape persistence, and rate limiter cancellation.
 */

import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeUrl } from '../src/engine/url';
import { CatalogDatabase } from '../src/engine/catalog';
import { DomainRateLimiter } from '../src/engine/limiter';

describe('URL Canonicalization', () => {
  it('strips tracking parameters, fragments, and trailing slashes', () => {
    const raw =
      'https://www.tbsnews.net/bangladesh/politics/article-123/?utm_source=facebook&utm_medium=cpc&fbclid=XYZ#comments';
    expect(canonicalizeUrl(raw)).toBe('https://www.tbsnews.net/bangladesh/politics/article-123');
  });

  it('lowercases domain and standardizes protocol', () => {
    const raw = 'http://DAILYSTAR.NET/news/123/';
    expect(canonicalizeUrl(raw)).toBe('https://dailystar.net/news/123');
  });
});

describe('CatalogDatabase (SQLite)', () => {
  it('initializes schema and handles idempotent upserts', () => {
    const catalog = new CatalogDatabase(':memory:');

    const first = catalog.upsertDiscoveredItem('business-standard', 'national', {
      url: 'https://www.tbsnews.net/bangladesh/article-1?utm_source=fb',
      title: 'First Article Title',
      publishedAtRaw: '2026-10-30T10:00:00Z',
    });

    expect(first.isNew).toBe(true);
    expect(first.articleId).toBeDefined();

    // Re-upserting same canonical url should not duplicate
    const second = catalog.upsertDiscoveredItem('business-standard', 'economy', {
      url: 'https://www.tbsnews.net/bangladesh/article-1',
      title: 'First Article Title',
      publishedAtRaw: '2026-10-30T10:00:00Z',
    });

    expect(second.isNew).toBe(false);
    expect(second.articleId).toBe(first.articleId);

    // Job tracking
    const job = catalog.getOrCreateJob('business-standard', 'national');
    expect(job.status).toBe('pending');
    expect(job.itemsFound).toBe(0);

    catalog.updateJobProgress(job.id, {
      status: 'running',
      itemsFound: 25,
      cursor: JSON.stringify({ page: 2 }),
    });

    const updated = catalog.getOrCreateJob('business-standard', 'national');
    expect(updated.status).toBe('running');
    expect(updated.itemsFound).toBe(25);
    expect(updated.cursor).toBe('{"page":2}');

    // Pruning off-topic rows and stale jobs
    catalog.upsertDiscoveredItem('business-standard', 'archive', {
      url: 'https://www.tbsnews.net/videos/live-stream-99',
      title: 'Off-topic video',
      publishedAtRaw: '2026-10-30T11:00:00Z',
    });
    catalog.getOrCreateJob('business-standard', 'stale-source');

    const pruneRes = catalog.pruneCatalog(
      (_outlet, url) => !url.includes('/videos/'),
      new Set(['business-standard:national'])
    );
    expect(pruneRes.skippedArticles).toBe(1);
    expect(pruneRes.deletedArticles).toBe(0);
    expect(pruneRes.deletedJobs).toBe(1);
    expect(pruneRes.remainingArticles).toBe(1);
    expect(catalog.getTotalArticleCount(true)).toBe(2);

    catalog.close();
  });

  it('migrates legacy schema seamlessly and persists extracted/failed articles for interrupt-safe resume', () => {
    const dbPath = join(import.meta.dir, '.legacy-migration-test.sqlite');
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    try {
      // Simulate Sprint 1 schema without `lead` or `last_error` columns
      const rawDb = new Database(dbPath, { create: true });
      rawDb.run(`
        CREATE TABLE article (
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
      `);
      rawDb.close();

      // Open with CatalogDatabase — should auto-migrate `lead` and `last_error`
      const catalog = new CatalogDatabase(dbPath);

      const older = catalog.upsertDiscoveredItem('prothom-alo', 'bangladesh', {
        url: 'https://www.prothomalo.com/bangladesh/older-1',
        title: 'Older Headline',
        publishedAtRaw: '2026-11-01T10:00:00Z',
      });
      const newer = catalog.upsertDiscoveredItem('prothom-alo', 'politics', {
        url: 'https://www.prothomalo.com/politics/newer-2',
        title: 'Newer Headline',
        publishedAtRaw: '2026-11-10T12:00:00Z',
      });

      // Queue orders newest first
      const queue1 = catalog.getPendingArticlesForOutlet('prothom-alo');
      expect(queue1.map((q) => q.id)).toEqual([newer.articleId, older.articleId]);

      // Save extracted article for newer item (with null publishedAtIso to test COALESCE preservation)
      catalog.saveExtractedArticle(newer.articleId, {
        title: 'Extracted Newer Headline',
        publishedAtRaw: '১০ নভেম্বর ২০২৬',
        publishedAtIso: null,
        byline: 'নিজস্ব প্রতিবেদক',
        lead: 'প্রথম অনুচ্ছেদ।',
        cleanText: 'প্রথম অনুচ্ছেদ।\n\nদ্বিতীয় অনুচ্ছেদ বিস্তারিত সংবাদ।',
      });

      const savedNewer = catalog.getArticleById(newer.articleId);
      expect(savedNewer?.status).toBe('extracted');
      expect(savedNewer?.title).toBe('Extracted Newer Headline');
      expect(savedNewer?.publishedAt).toBe('2026-11-10T12:00:00.000Z');
      expect(savedNewer?.byline).toBe('নিজস্ব প্রতিবেদক');
      expect(savedNewer?.lead).toBe('প্রথম অনুচ্ছেদ।');
      expect(savedNewer?.cleanText).toContain('দ্বিতীয় অনুচ্ছেদ');
      expect(savedNewer?.fetchedAt).toBeTruthy();

      // Mark older article as failed
      catalog.markArticleFailed(older.articleId, 'HTTP 502 Bad Gateway');
      const failedOlder = catalog.getArticleById(older.articleId);
      expect(failedOlder?.status).toBe('failed');
      expect(failedOlder?.lastError).toBe('HTTP 502 Bad Gateway');

      // Resuming without retryFailed sees 0 pending ('extracted' and 'failed' skipped)
      expect(catalog.getPendingArticlesForOutlet('prothom-alo').length).toBe(0);

      // Resuming with retryFailed picks up only the failed item
      const retryQueue = catalog.getPendingArticlesForOutlet('prothom-alo', { retryFailed: true });
      expect(retryQueue.map((q) => q.id)).toEqual([older.articleId]);

      const progress = catalog.getScrapeProgressByOutlet();
      expect(progress).toEqual([
        {
          outlet: 'prothom-alo',
          activeTotal: 2,
          extractedCount: 1,
          failedCount: 1,
          pendingCount: 0,
        },
      ]);

      catalog.close();
    } finally {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });

  it('excludes skipped rows from GCP export and preserves skipped rows on GCP import', () => {
    const dbPath = join(tmpdir(), `jachaikori-gcp-test-${Date.now()}.sqlite`);
    try {
      const catalog = new CatalogDatabase(dbPath);
      const keep = catalog.upsertDiscoveredItem('prothom-alo', 'bangladesh', {
        url: 'https://www.prothomalo.com/bangladesh/keep-1',
        title: 'Keep Article',
        publishedAtRaw: '2026-11-10T10:00:00Z',
      });
      const skip = catalog.upsertDiscoveredItem('prothom-alo', 'bangladesh', {
        url: 'https://www.prothomalo.com/bangladesh/skip-2',
        title: 'Low Signal Article',
        publishedAtRaw: '2026-11-10T11:00:00Z',
      });
      const blocked = catalog.upsertDiscoveredItem('prothom-alo', 'bangladesh', {
        url: 'https://www.prothomalo.com/bangladesh/blocked-3',
        title: 'Blocked Article',
        publishedAtRaw: '2026-11-10T12:00:00Z',
      });
      catalog.close();

      // Mark one article as skipped directly in SQLite
      const raw = new Database(dbPath);
      raw.prepare("UPDATE article SET status = 'skipped' WHERE id = ?").run(skip.articleId);
      raw.close();

      const catalog2 = new CatalogDatabase(dbPath);
      const pending = catalog2.getPendingArticlesForGcpExport();
      expect(pending.map((p) => p.id)).toEqual([blocked.articleId, keep.articleId]);

      // Even if a result record references the skipped ID, importGcpResults must preserve 'skipped'
      // and leave 'blocked' rows untouched as 'discovered'
      const res = catalog2.importGcpResults([
        {
          id: keep.articleId,
          status: 'extracted',
          title: 'Keep Article Updated',
          cleanText: 'Full extracted body text with sufficient length to be valid.',
        },
        {
          id: skip.articleId,
          status: 'extracted',
          title: 'Should Not Overwrite',
          cleanText: 'Should never overwrite skipped status.',
        },
        {
          id: blocked.articleId,
          status: 'blocked',
          errorMessage: 'HTTP 403 [server=cloudflare]',
        },
      ]);

      expect(res.extracted).toBe(1);
      expect(res.blockedLeftDiscovered).toBe(1);
      expect(res.skippedPreserved).toBe(1);
      expect(catalog2.getArticleById(keep.articleId)?.status).toBe('extracted');
      expect(catalog2.getArticleById(skip.articleId)?.status).toBe('skipped');
      expect(catalog2.getArticleById(blocked.articleId)?.status).toBe('discovered');
      catalog2.close();
    } finally {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});

describe('DomainRateLimiter', () => {
  it('reserves slots atomically and cancels waits immediately on AbortSignal', async () => {
    const limiter = new DomainRateLimiter({ baseDelayMs: 5000, minJitterMs: 0, jitterMs: 0 });

    // First acquire on fresh domain resolves immediately and reserves +5000ms slot
    await limiter.acquire('prothomalo.com');
    expect(limiter.getWaitRemainingMs('prothomalo.com')).toBeGreaterThan(4000);

    // Second acquire waits on the reserved slot, and aborts immediately when signal fires
    const ac = new AbortController();
    const start = Date.now();
    setTimeout(() => ac.abort(), 30);

    await expect(limiter.acquire('prothomalo.com', ac.signal)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(500);
  });
});
