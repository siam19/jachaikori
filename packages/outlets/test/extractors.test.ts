/**
 * @file packages/outlets/test/extractors.test.ts
 * Fixture-based unit tests verifying `extractArticle(html, url)` across all 8 active outlets.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOutlet } from '../src/registry';
import type { OutletId } from '@jachaikori/schema';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');

function loadFixture(outlet: OutletId): string {
  return readFileSync(join(FIXTURES_DIR, `${outlet}.html`), 'utf8');
}

describe('Article Extractors (Real HTML Fixtures)', () => {
  it('prothom-alo: extracts title, JSON-LD datePublished, DOM byline, and story-element-text body', () => {
    const html = loadFixture('prothom-alo');
    const res = getOutlet('prothom-alo').extractArticle!(
      html,
      'https://www.prothomalo.com/bangladesh/district/o6quxfkn3i'
    );

    expect(res.title).toBe('টুঙ্গিপাড়ায় বিএনপি ও যুবদলের কার্যালয়ে আগুন, ভাঙচুর');
    expect(res.publishedAtRaw).toBe('2026-11-15T01:07:22+06:00');
    expect(res.publishedAtIso).toBe('2026-11-15T01:07:22+06:00');
    expect(res.byline).toBe('প্রতিনিধি গোপালগঞ্জ');
    expect(res.lead).toContain('গোপালগঞ্জের টুঙ্গিপাড়ায়');
    expect(res.cleanText.length).toBeGreaterThan(1000);
  });

  it('bangladesh-protidin: extracts title, meta article:published_time, .bi-pen byline, and article body', () => {
    const html = loadFixture('bangladesh-protidin');
    const res = getOutlet('bangladesh-protidin').extractArticle!(
      html,
      'https://www.bd-pratidin.com/country/2026/11/15/1326252'
    );

    expect(res.title).toBe('জামালপুরের সেই বোমাসদৃশ বস্তুটি নিষ্ক্রিয় করল ডিসপোজাল ইউনিট');
    expect(res.publishedAtRaw).toBe('2026-11-15T01:31:34+06:00');
    expect(res.publishedAtIso).toBe('2026-11-15T01:31:34+06:00');
    expect(res.byline).toBe('জামালপুর প্রতিনিধি');
    expect(res.lead).toContain('জামালপুরে রেলওয়ে ওভারপাসের ওপর');
    expect(res.cleanText.length).toBeGreaterThan(800);
  });

  it('jugantor: extracts title, published time, author, and .desktopDetailBody', () => {
    const html = loadFixture('jugantor');
    const res = getOutlet('jugantor').extractArticle!(
      html,
      'https://www.jugantor.com/economics/1184292'
    );

    expect(res.title).toBe('খেলাপি ঋণের বড় অংশই দুর্নীতি ও অপরাধে সৃষ্ট');
    expect(res.publishedAtRaw).toBe('2026-11-14T23:07:49+06:00');
    expect(res.publishedAtIso).toBe('2026-11-14T23:07:49+06:00');
    expect(res.byline).toBe('যুগান্তর প্রতিবেদন');
    expect(res.lead).toContain('ব্যাংক খাতে বিতরণ করা ঋণের');
    expect(res.cleanText.length).toBeGreaterThan(2000);
  });

  it('kaler-kantho: extracts canonical article via JSON-LD without infinite-scroll pollution', () => {
    const html = loadFixture('kaler-kantho');
    const res = getOutlet('kaler-kantho').extractArticle!(
      html,
      'https://www.kalerkantho.com/online/national/2026/11/15/1767731'
    );

    expect(res.title).toBe('নতুন থানা-পৌরসভা গঠনসহ ৪ প্রস্তাবে সুপারিশের সিদ্ধান্ত');
    expect(res.publishedAtRaw).toBe('2026-11-15T01:14:37+06:00');
    expect(res.publishedAtIso).toBe('2026-11-15T01:14:37+06:00');
    expect(res.byline).toBe('অনলাইন ডেস্ক');
    expect(res.lead).toContain('নতুন থানা, পৌরসভা গঠন');
    expect(res.cleanText.length).toBeGreaterThan(3000);
  });

  it('ittefaq: extracts title, published time, author, and .jw_article_body', () => {
    const html = loadFixture('ittefaq');
    const res = getOutlet('ittefaq').extractArticle!(
      html,
      'https://www.ittefaq.com.bd/821025'
    );

    expect(res.title).toBe('টুঙ্গিপাড়ায় বিএনপি ও যুবদলের দুই কার্যালয়ে ভাঙচুর-আগুন');
    expect(res.publishedAtRaw).toBe('2026-11-15T02:50:00+06:00');
    expect(res.publishedAtIso).toBe('2026-11-15T02:50:00+06:00');
    expect(res.byline).toBe('ইত্তেফাক ডিজিটাল রিপোর্ট');
    expect(res.lead).toContain('গোপালগঞ্জের টুঙ্গিপাড়ায়');
    expect(res.cleanText.length).toBeGreaterThan(1000);
  });

  it('daily-star: extracts title, time[datetime], author block, and body', () => {
    const html = loadFixture('daily-star');
    const res = getOutlet('daily-star').extractArticle!(
      html,
      'https://www.thedailystar.net/news/crime-justice/news/case-filed-over-shooting-anurag-pharma-4323986'
    );

    expect(res.title).toBe('Case filed over shooting at Anurag Pharma');
    expect(res.publishedAtRaw).toBe('2026-11-16T00:10:00+06:00');
    expect(res.publishedAtIso).toBe('2026-11-16T00:10:00+06:00');
    expect(res.byline).toBe('Star Online Report');
    expect(res.lead).toContain('A case has been filed over the shooting at Anurag Pharma');
    expect(res.cleanText.length).toBeGreaterThan(800);
  });

  it('business-standard: extracts title, published time, author, and strips inline DFP/Google News promos', () => {
    const html = loadFixture('business-standard');
    const res = getOutlet('business-standard').extractArticle!(
      html,
      'https://www.tbsnews.net/bangladesh/health/diabetes-mela-app-provide-info-diabetes-risk-diagnosis-treatment-1602646'
    );

    expect(res.title).toBe("'Diabetes Mela' app to provide info on diabetes risk, diagnosis, treatment");
    expect(res.publishedAtRaw).toBe('2026-11-15T00:05:00+06:00');
    expect(res.publishedAtIso).toBe('2026-11-15T00:05:00+06:00');
    expect(res.byline).toBe('TBS Report');
    expect(res.lead).toContain('Against the backdrop of increasing prevalence of diabetes');
    expect(res.cleanText).not.toContain('googletag');
    expect(res.cleanText).not.toContain('Keep updated, follow The Business Standard');
    expect(res.cleanText.length).toBeGreaterThan(2000);
  });

  it('bdnews24: extracts title, published time, author, and .details-brief body', () => {
    const html = loadFixture('bdnews24');
    const res = getOutlet('bdnews24').extractArticle!(
      html,
      'https://bangla.bdnews24.com/bangladesh/n5ug66uhcd'
    );

    expect(res.title).toBe('ঢাকায় ইয়ুথ ট্যুরিজম এক্সপো ১৯ নভেম্বর শুরু');
    expect(res.publishedAtRaw).toBe('2026-11-14T18:26:58+00:00');
    expect(res.publishedAtIso).toBe('2026-11-14T18:26:58+00:00');
    expect(res.byline).toBe('বিডিনিউজ টোয়েন্টিফোর ডটকম নিউজ সার্ভিস');
    expect(res.lead).toContain('দেশের বিভিন্ন ভ্রমণ গন্তব্য');
    expect(res.cleanText.length).toBeGreaterThan(1000);
  });
});
