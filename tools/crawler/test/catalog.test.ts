/**
 * @file tools/crawler/test/catalog.test.ts
 * Tests for URL canonicalization and SQLite catalog upserts.
 */

import { describe, expect, it } from 'bun:test';
import { canonicalizeUrl } from '../src/engine/url';
import { CatalogDatabase } from '../src/engine/catalog';
import { unlinkSync } from 'node:fs';

describe('URL Canonicalization', () => {
  it('strips tracking parameters, fragments, and trailing slashes', () => {
    const raw = 'https://www.tbsnews.net/bangladesh/politics/article-123/?utm_source=facebook&utm_medium=cpc&fbclid=XYZ#comments';
    expect(canonicalizeUrl(raw)).toBe('https://www.tbsnews.net/bangladesh/politics/article-123');
  });

  it('lowercases domain and standardizes protocol', () => {
    const raw = 'http://DAILYSTAR.NET/news/123/';
    expect(canonicalizeUrl(raw)).toBe('https://dailystar.net/news/123');
  });
});

describe('CatalogDatabase (SQLite)', () => {
  const testDbPath = 'data/test-catalog.sqlite';

  it('initializes schema and handles idempotent upserts', () => {
    try {
      unlinkSync(testDbPath);
    } catch {}

    const catalog = new CatalogDatabase(testDbPath);

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

    catalog.close();
    try {
      unlinkSync(testDbPath);
    } catch {}
  });
});
