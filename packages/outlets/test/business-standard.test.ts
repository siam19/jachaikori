/**
 * @file packages/outlets/test/business-standard.test.ts
 * Unit tests for The Business Standard (TBS) parser.
 */

import { describe, expect, it } from 'bun:test';
import { BusinessStandardCrawler } from '../src/outlets/business-standard';

describe('BusinessStandardCrawler', () => {
  const crawler = new BusinessStandardCrawler();

  it('parses listing HTML cards into ListItems', () => {
    const mockHtml = `
      <div class="archive-contents">
        <div class="card card-list">
          <div class="card-section">
            <h4 class="card-title">
              <a href="/bangladesh/leftist-alliance-demands-scrapping-123">Leftist alliance demands scrapping</a>
            </h4>
            <div class="date">
              <a href="/bangladesh">Bangladesh</a>
            </div>
          </div>
        </div>
      </div>
    `;

    const items = crawler.parseListing(mockHtml, 'https://www.tbsnews.net/archive/2026/10/30');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Leftist alliance demands scrapping');
    expect(items[0].url).toBe('https://www.tbsnews.net/bangladesh/leftist-alliance-demands-scrapping-123');
    expect(items[0].category).toBe('Bangladesh');
    expect(items[0].publishedAtRaw).toContain('2026-10-30');
  });

  it('canonicalizes TBS URLs properly', () => {
    expect(crawler.canonicalizeUrl('https://www.tbsnews.net/news/123?utm_source=fb#headline')).toBe(
      'https://www.tbsnews.net/news/123'
    );
  });
});
