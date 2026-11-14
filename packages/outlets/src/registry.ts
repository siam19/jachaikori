/**
 * @file packages/outlets/src/registry.ts
 * Registry map of all 9 accredited outlet crawlers.
 */

import type { OutletId } from '@jachaikori/schema';
import type { OutletCrawler } from './types';

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
