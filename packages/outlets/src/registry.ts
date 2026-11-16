/**
 * @file packages/outlets/src/registry.ts
 * Registry map of all accredited outlet crawlers.
 */

import type { OutletId } from '@jachaikori/schema';
import type { OutletCrawler } from './types';
import { BusinessStandardCrawler } from './outlets/business-standard';
import { IttefaqCrawler } from './outlets/ittefaq';
import { BdNews24Crawler } from './outlets/bdnews24';
import { DailyStarCrawler } from './outlets/daily-star';
import { ProthomAloCrawler } from './outlets/prothom-alo';
import { JugantorCrawler } from './outlets/jugantor';
import { BangladeshProtidinCrawler } from './outlets/bangladesh-protidin';
import { KalerKanthoCrawler } from './outlets/kaler-kantho';

const registry = new Map<OutletId, OutletCrawler>();

export function registerOutlet(crawler: OutletCrawler): void {
  registry.set(crawler.id, crawler);
}

export function getOutlet(id: OutletId): OutletCrawler {
  const crawler = registry.get(id);
  if (!crawler) {
    throw new Error(`Outlet "${id}" is not registered. Registered: ${Array.from(registry.keys()).join(', ')}`);
  }
  return crawler;
}

export function getAllOutlets(): OutletCrawler[] {
  return Array.from(registry.values());
}

// Automatically register all implemented outlet crawlers
registerOutlet(new BusinessStandardCrawler());
registerOutlet(new IttefaqCrawler());
registerOutlet(new BdNews24Crawler());
registerOutlet(new DailyStarCrawler());
registerOutlet(new ProthomAloCrawler());
registerOutlet(new JugantorCrawler());
registerOutlet(new BangladeshProtidinCrawler());
registerOutlet(new KalerKanthoCrawler());
