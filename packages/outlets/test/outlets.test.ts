/**
 * @file packages/outlets/test/outlets.test.ts
 * Unit tests verifying HTML/XML/JSON parsers, category allowlisting, and URL canonicalization across all outlets.
 */

import { describe, expect, it } from 'bun:test';
import { IttefaqCrawler } from '../src/outlets/ittefaq';
import { BdNews24Crawler } from '../src/outlets/bdnews24';
import { DailyStarCrawler } from '../src/outlets/daily-star';
import { ProthomAloCrawler } from '../src/outlets/prothom-alo';
import { JugantorCrawler } from '../src/outlets/jugantor';
import { BangladeshProtidinCrawler } from '../src/outlets/bangladesh-protidin';
import { KalerKanthoCrawler } from '../src/outlets/kaler-kantho';
import { isAllowedArticleUrl } from '../src/filters';

describe('Daily Ittefaq Parser', () => {
  const crawler = new IttefaqCrawler();

  it('parses Ittefaq card elements correctly', () => {
    const html = `
      <div class="archive_list">
        <div class="archive_post col-sm-6">
          <a href="//www.ittefaq.com.bd/820654/sample-story-title">
            <h3 class="title">পুলিশের মামলার পর জানা গেল পলাতক সাবেক এমপি</h3>
          </a>
          <span class="category">রাজনীতি</span>
        </div>
      </div>
    `;
    const items = crawler.parseListing(html, '2026-11-14T12:00:00+06:00');
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('পুলিশের মামলার পর');
    expect(items[0].url).toBe('https://www.ittefaq.com.bd/820654/sample-story-title');
    expect(items[0].category).toBe('রাজনীতি');
  });

  it('unwraps JadeWits AJAX JSON responses and filters out world-news and sports cards', () => {
    const ajaxJson = JSON.stringify({
      total: 2,
      finished: false,
      html: `
        <div class="row">
          <div class="col col1">
            <div class="each col_in">
              <h2 class="title">
                <a class="link_overlay" href="//www.ittefaq.com.bd/820990/national-budget-update">বাজেট বাস্তবায়নে নতুন নির্দেশনা</a>
              </h2>
              <div class="additional">
                <a class="category aitm" href="https://www.ittefaq.com.bd/national">জাতীয়</a>
              </div>
            </div>
          </div>
          <div class="col col2">
            <div class="each col_in">
              <h2 class="title">
                <a class="link_overlay" href="//www.ittefaq.com.bd/820995/world-drone-strike">রিয়াদে ফের ড্রোন হামলা</a>
              </h2>
              <div class="additional">
                <a class="category aitm" href="https://www.ittefaq.com.bd/world-news">বিশ্ব সংবাদ</a>
              </div>
            </div>
          </div>
        </div>
      `,
    });

    const items = crawler.parseListing(ajaxJson, '2026-11-14T12:00:00+06:00');
    expect(items.length).toBe(1);
    expect(items[0].url).toBe('https://www.ittefaq.com.bd/820990/national-budget-update');
    expect(items[0].category).toBe('জাতীয়');
  });
});

describe('bdnews24 (Bangla) Parser', () => {
  const crawler = new BdNews24Crawler();

  it('configures all 5 target category sections including commerce and court', () => {
    expect(crawler.defaultSources.map((s) => s.key)).toEqual([
      'national',
      'politics',
      'economy',
      'commerce',
      'court',
    ]);
  });

  it('parses bdnews24 HTML cards from /archive/fetch and filters off-topic sections', () => {
    const html = `
      <div class="col-md-3">
        <div class="SubCat-wrapper">
          <a href="https://bangla.bdnews24.com/bangladesh/n5ug66uhcd">
            <span>বাংলাদেশ</span>
            <h5>ঢাকায় ইয়ুথ ট্যুরিজম এক্সপো ১৯ নভেম্বর শুরু</h5>
            <div class="date">প্রকাশিত : 15 নভেম্বর 2026, 12:26 AM</div>
          </a>
        </div>
      </div>
      <div class="col-md-3">
        <div class="SubCat-wrapper">
          <a href="https://bangla.bdnews24.com/cricket/abc123xyz">
            <span>ক্রিকেট</span>
            <h5>সিরিজ জিতল বাংলাদেশ</h5>
          </a>
        </div>
      </div>
    `;
    const items = crawler.parseListing(html);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('ঢাকায় ইয়ুথ ট্যুরিজম এক্সপো ১৯ নভেম্বর শুরু');
    expect(items[0].url).toBe('https://bangla.bdnews24.com/bangladesh/n5ug66uhcd');
    expect(items[0].publishedAtRaw).toContain('15 নভেম্বর 2026');
  });
});

describe('The Daily Star Parser', () => {
  const crawler = new DailyStarCrawler();

  it('parses Drupal views cards with h5.card-title and time[datetime]', () => {
    const html = `
      <div class="card-content">
        <h5 class="card-title">
          <a href="/news/politics/news/she-still-hurting-nation-even-after-fleeing-shafiqur-rahman-4323616">
            ‘She is still hurting nation even after fleeing’: Shafiqur Rahman
          </a>
        </h5>
        <div class="card-info">
          <time class="rsi-ago" datetime="2026-11-14T18:13:26+06:00">30 SEC(s)</time>
          <span>Politics</span>
        </div>
      </div>
    `;
    const items = crawler.parseListing(html);
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('‘She is still hurting nation');
    expect(items[0].url).toBe('https://www.thedailystar.net/news/politics/news/she-still-hurting-nation-even-after-fleeing-shafiqur-rahman-4323616');
    expect(items[0].publishedAtRaw).toBe('2026-11-14T18:13:26+06:00');
  });

  it('parses Drupal viewsShowMore AJAX responses with JSON commands', () => {
    const ajaxJson = JSON.stringify([
      { command: 'settings' },
      {
        command: 'viewsShowMore',
        method: 'append',
        data: `
          <div class="row">
            <h3 class="card-title">
              <a href="/news/bangladesh/news/lighter-penalties-little-relief-free-speech-4322536">
                Lighter penalties, but little relief for free speech
              </a>
            </h3>
            <div class="card-info">
              <time class="rsi-ago" datetime="2026-11-13T00:00:00+06:00">13 November 2026</time>
            </div>
          </div>
        `,
      },
    ]);
    const items = crawler.parseListing(ajaxJson);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Lighter penalties, but little relief for free speech');
    expect(items[0].url).toBe('https://www.thedailystar.net/news/bangladesh/news/lighter-penalties-little-relief-free-speech-4322536');
    expect(items[0].publishedAtRaw).toBe('2026-11-13T00:00:00+06:00');
  });
});

describe('Prothom Alo Parser', () => {
  const crawler = new ProthomAloCrawler();

  it('parses search results HTML with publication time and section', () => {
    const html = `
      <div class="news_item_content">
        <a class="title-link" href="https://www.prothomalo.com/bangladesh/district/xyz-story">
          <h3 class="headline-title">গাজীপুরে শ্রমিক অসন্তোষের জেরে কারখানা বন্ধ</h3>
        </a>
        <time class="published-time">১৫ মিনিট আগে</time>
      </div>
    `;
    const items = crawler.parseListing(html, '2026-11-14T12:00:00+06:00');
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('গাজীপুরে শ্রমিক অসন্তোষের');
    expect(items[0].category).toBe('bangladesh');
    expect(items[0].publishedAtRaw).toBe('১৫ মিনিট আগে');
  });

  it('parses Quintype /api/v1/advanced-search JSON and drops off-topic sections', () => {
    const json = JSON.stringify({
      total: 2,
      items: [
        {
          headline: 'মূল্যস্ফীতি নিয়ন্ত্রণে নতুন পদক্ষেপ',
          url: 'https://www.prothomalo.com/business/economics/abc123',
          'published-at': 1794678677000,
        },
        {
          headline: 'সিনেমার শুটিং শুরু',
          url: 'https://www.prothomalo.com/entertainment/dhallywood/def456',
          'published-at': 1794678677000,
        },
      ],
    });
    const items = crawler.parseListing(json, '2026-11-14T12:00:00+06:00');
    expect(items.length).toBe(1);
    expect(items[0].url).toBe('https://www.prothomalo.com/business/economics/abc123');
    expect(items[0].category).toBe('business');
    expect(items[0].publishedAtRaw).toBe(new Date(1794678677000).toISOString());
  });
});

describe('Daily Jugantor Parser', () => {
  const crawler = new JugantorCrawler();

  it('parses media cards from archive search and excludes international/sports', () => {
    const html = `
      <div class="media positionRelative">
        <div class="media-body">
          <h4 class="title10">
            <a href="/national/2026/11/14/123456/sample-title">
              কম ভাত খেয়েও রক্তে শর্করা বেশি: কী করবেন
            </a>
          </h4>
          <p class="desktopTime">১৪ নভেম্বর ২০২৬, ০৩:২৯ পিএম</p>
        </div>
      </div>
      <div class="media positionRelative">
        <div class="media-body">
          <h4 class="title10">
            <a href="/international/2026/11/14/999999/foreign-news">
              আন্তর্জাতিক সংবাদ
            </a>
          </h4>
        </div>
      </div>
    `;
    const items = crawler.parseListing(html, '2026-11-14T12:00:00+06:00');
    expect(items.length).toBe(1);
    expect(items[0].title).toContain('কম ভাত খেয়েও');
    expect(items[0].url).toBe('https://www.jugantor.com/national/2026/11/14/123456/sample-title');
    expect(items[0].publishedAtRaw).toContain('১৪ নভেম্বর ২০২৬');
  });
});

describe('Bangladesh Pratidin Parser', () => {
  const crawler = new BangladeshProtidinCrawler();

  it('parses daily sitemap XML entries and keeps core national/politics/economy while dropping country/international/sports', () => {
    const xml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://www.bd-pratidin.com/national/2026/11/14/1326217</loc>
          <news:news>
            <news:publication_date>2026-11-14T12:40:00+06:00</news:publication_date>
            <news:title>নারীদের জন্য আসছে ১০০ বৈদ্যুতিক বাস</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.bd-pratidin.com/minister-speech/2026/11/14/1326218</loc>
          <news:news>
            <news:publication_date>2026-11-14T13:00:00+06:00</news:publication_date>
            <news:title>জ্বালানি খাতে নতুন নীতিমালা ঘোষণা</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.bd-pratidin.com/country/2026/11/14/1326221</loc>
          <news:news>
            <news:publication_date>2026-11-14T13:05:00+06:00</news:publication_date>
            <news:title>উপজেলা সংবাদ</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.bd-pratidin.com/international-news/2026/11/14/1326219</loc>
          <news:news>
            <news:publication_date>2026-11-14T13:10:00+06:00</news:publication_date>
            <news:title>বিদেশি সংবাদ</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.bd-pratidin.com/sports/2026/11/14/1326220</loc>
          <news:news>
            <news:publication_date>2026-11-14T13:20:00+06:00</news:publication_date>
            <news:title>খেলার খবর</news:title>
          </news:news>
        </url>
      </urlset>
    `;
    const items = crawler.parseListing(xml);
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('https://www.bd-pratidin.com/national/2026/11/14/1326217');
    expect(items[1].url).toBe('https://www.bd-pratidin.com/minister-speech/2026/11/14/1326218');
  });
});

describe('Kaler Kantho Parser', () => {
  const crawler = new KalerKanthoCrawler();

  it('parses daily sitemap XML entries and keeps core online sections while dropping print-edition/country-news/world/sports', () => {
    const xml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://www.kalerkantho.com/online/national/2026/11/14/1767603</loc>
          <news:news>
            <news:publication_date>2026-11-14T16:49:26+06:00</news:publication_date>
            <news:title>ডিসেম্বর পর্যন্ত গ্যাসের চাহিদা মেটানোর মজুদ আছে : জ্বালানিমন্ত্রী</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.kalerkantho.com/online/business/2026/11/14/1767607</loc>
          <news:news>
            <news:publication_date>2026-11-14T16:55:00+06:00</news:publication_date>
            <news:title>রপ্তানি আয় বেড়েছে</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.kalerkantho.com/print-edition/first-page/2026/11/14/1767604</loc>
          <news:news>
            <news:publication_date>2026-11-14T06:00:00+06:00</news:publication_date>
            <news:title>প্রথম পাতার শীর্ষ সংবাদ</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.kalerkantho.com/online/world/2026/11/14/1767605</loc>
          <news:news>
            <news:publication_date>2026-11-14T17:00:00+06:00</news:publication_date>
            <news:title>বিশ্ব সংবাদ</news:title>
          </news:news>
        </url>
        <url>
          <loc>https://www.kalerkantho.com/multimedia/2026/11/14/1767606</loc>
          <news:news>
            <news:publication_date>2026-11-14T17:10:00+06:00</news:publication_date>
            <news:title>ভিডিও প্রতিবেদন</news:title>
          </news:news>
        </url>
      </urlset>
    `;
    const items = crawler.parseListing(xml);
    expect(items.length).toBe(2);
    expect(items[0].url).toBe('https://www.kalerkantho.com/online/national/2026/11/14/1767603');
    expect(items[1].url).toBe('https://www.kalerkantho.com/online/business/2026/11/14/1767607');
  });

  it('validates case-insensitive URL allowlisting in filters', () => {
    expect(isAllowedArticleUrl('kaler-kantho', 'https://www.kalerkantho.com/online/Politics/2026/11/14/100')).toBe(true);
    expect(isAllowedArticleUrl('kaler-kantho', 'https://www.kalerkantho.com/online/Court/2026/11/14/101')).toBe(true);
    expect(isAllowedArticleUrl('kaler-kantho', 'https://www.kalerkantho.com/online/country-news/2026/11/14/104')).toBe(false);
    expect(isAllowedArticleUrl('kaler-kantho', 'https://www.kalerkantho.com/online/sport/2026/11/14/102')).toBe(false);
    expect(isAllowedArticleUrl('kaler-kantho', 'https://www.kalerkantho.com/print-edition/first-page/2026/11/14/103')).toBe(false);
  });
});
