/**
 * @file tools/crawler/test/prune.test.ts
 * Unit tests for low-signal headline/URL pruning with high-salience overrides.
 */

import { describe, expect, it } from 'bun:test';
import { evaluateHeadlineForPrune } from '../src/engine/prune';

describe('Headline Low-Signal Pruner', () => {
  it('prunes gold/commodity tickers, weather bulletins, obituaries, and exam notices', () => {
    expect(
      evaluateHeadlineForPrune({
        outlet: 'prothom-alo',
        canonicalUrl: 'https://www.prothomalo.com/business/123',
        title: 'আজকের স্বর্ণের দাম কত, ভরি প্রতি কমল ২ হাজার টাকা',
      })
    ).toEqual({ skip: true, reason: 'price_ticker' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'jugantor',
        canonicalUrl: 'https://www.jugantor.com/national/456',
        title: 'সারা দেশে বৃষ্টির আভাস, তাপমাত্রা কমতে পারে',
      })
    ).toEqual({ skip: true, reason: 'weather_bulletin' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'ittefaq',
        canonicalUrl: 'https://www.ittefaq.com.bd/country/789',
        title: 'বিশিষ্ট সমাজসেবক হাজী আব্দুল করিমের ইন্তেকাল',
      })
    ).toEqual({ skip: true, reason: 'obituary' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'bdnews24',
        canonicalUrl: 'https://bangla.bdnews24.com/bangladesh/111',
        title: 'ঢাকা বিশ্ববিদ্যালয়ের ভর্তি পরীক্ষার সময়সূচি প্রকাশ',
      })
    ).toEqual({ skip: true, reason: 'exam_admission' });
  });

  it('prunes dedicated corporate/stock URL sections', () => {
    expect(
      evaluateHeadlineForPrune({
        outlet: 'business-standard',
        canonicalUrl: 'https://www.tbsnews.net/economy/stocks/dse-index-drops-10-points',
        title: 'DSE index drops 10 points',
      })
    ).toEqual({ skip: true, reason: 'corporate_or_stock_section' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'kaler-kantho',
        canonicalUrl: 'https://www.kalerkantho.com/online/corporatecorner/2026/05/01/1234',
        title: 'ব্র্যাক ব্যাংকের নতুন শাখা উদ্বোধন',
      })
    ).toEqual({ skip: true, reason: 'corporate_or_stock_section' });
  });

  it('prunes print-edition URLs and routine prayer/lottery/bite/club headlines', () => {
    expect(
      evaluateHeadlineForPrune({
        outlet: 'kaler-kantho',
        canonicalUrl: 'https://www.kalerkantho.com/print-edition/news/2026/05/01/1234',
        title: 'জাতীয় সংসদে বাজেট আলোচনা',
      })
    ).toEqual({ skip: true, reason: 'print_edition' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'bangladesh-protidin',
        canonicalUrl: 'https://www.bd-pratidin.com/first-page/2026/05/01/5678',
        title: 'প্রথম পাতার প্রতিবেদন',
      })
    ).toEqual({ skip: true, reason: 'print_edition' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'jugantor',
        canonicalUrl: 'https://www.jugantor.com/tp-news/12345',
        title: 'ছাপা পত্রিকার সংবাদ',
      })
    ).toEqual({ skip: true, reason: 'print_edition' });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'prothom-alo',
        canonicalUrl: 'https://www.prothomalo.com/bangladesh/999',
        title: 'আজকের নামাজের সময়সূচি',
      })
    ).toEqual({ skip: true, reason: 'prayer_daily' });
  });

  it('keeps high-salience national, political, protest, or disaster stories despite matching keywords', () => {
    expect(
      evaluateHeadlineForPrune({
        outlet: 'prothom-alo',
        canonicalUrl: 'https://www.prothomalo.com/bangladesh/district/222',
        title: 'সড়ক দুর্ঘটনায় শিক্ষার্থীর মৃত্যু: মহাসড়ক অবরোধ ও বিক্ষোভ',
      })
    ).toEqual({ skip: false });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'daily-star',
        canonicalUrl: 'https://www.thedailystar.net/news/bangladesh/news/333',
        title: 'Former minister passes away in Dhaka, PM expresses condolence',
      })
    ).toEqual({ skip: false });

    expect(
      evaluateHeadlineForPrune({
        outlet: 'jugantor',
        canonicalUrl: 'https://www.jugantor.com/national/444',
        title: 'ঘূর্ণিঝড় ও ভারী বৃষ্টিপাতে উপকূলে সতর্কতা',
      })
    ).toEqual({ skip: false });
  });
});
