/**
 * @file tools/crawler/src/engine/runner.ts
 * Job runner that drives an outlet crawler for a given source, writes batches to SQLite,
 * checks the stop condition, and saves checkpoint cursors.
 */

import type { SourceDef } from '@jachaikori/schema';
import type { OutletCrawler, CrawlContext } from '@jachaikori/outlets';
import { CatalogDatabase } from './catalog';
import { PoliteHttpClient } from './http';
import { StopEvaluator } from './stop';

export interface RunOptions {
  outlet: OutletCrawler;
  source: SourceDef;
  catalog: CatalogDatabase;
  httpClient: PoliteHttpClient;
  cutoffDate?: string;
  maxPages?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  jobId: string;
  itemsFound: number;
  newItemsSaved: number;
  stopReason?: string;
  status: 'done' | 'failed' | 'blocked';
  lastError?: string;
}

export async function runCrawlJob(options: RunOptions): Promise<RunResult> {
  const { outlet, source, catalog, httpClient, cutoffDate = '2026-01-01', maxPages, signal } = options;
  const job = catalog.getOrCreateJob(outlet.id, source.key);

  catalog.updateJobProgress(job.id, { status: 'running' });

  const stopEvaluator = new StopEvaluator({
    cutoffDate,
    maxSafetyBatches: maxPages,
  });

  const ctx: CrawlContext = {
    fetchText: (url, init) => httpClient.fetchText(url, init),
    fetchJson: (url, init) => httpClient.fetchJson(url, init),
    cursor: job.cursor,
    log: {
      info: (msg, meta) => console.log(`[INFO] [${outlet.id}:${source.key}] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[WARN] [${outlet.id}:${source.key}] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[ERROR] [${outlet.id}:${source.key}] ${msg}`, meta ?? ''),
      debug: (msg, meta) => console.debug(`[DEBUG] [${outlet.id}:${source.key}] ${msg}`, meta ?? ''),
    },
    signal,
  };

  let totalItemsFound = job.itemsFound;
  let newItemsSaved = 0;
  let oldestDate: string | null = job.oldestDateReached;

  try {
    const batches = outlet.crawl(source, ctx);

    for await (const batch of batches) {
      if (signal?.aborted) {
        ctx.log.info('Job aborted by signal');
        break;
      }

      const publishedDates: Array<string | null> = [];

      for (const item of batch.items) {
        totalItemsFound++;
        const { isNew, publishedAtIso } = catalog.upsertDiscoveredItem(
          outlet.id,
          source.key,
          item,
          outlet.canonicalizeUrl
        );

        if (isNew) {
          newItemsSaved++;
        }

        publishedDates.push(publishedAtIso);

        if (publishedAtIso && (!oldestDate || publishedAtIso < oldestDate)) {
          oldestDate = publishedAtIso;
        }
      }

      // Save cursor progress after each batch
      catalog.updateJobProgress(job.id, {
        cursor: batch.nextCursor,
        itemsFound: totalItemsFound,
        oldestDateReached: oldestDate,
      });

      // Check stop rule
      const evalResult = stopEvaluator.evaluateBatch(publishedDates, batch.nextCursor);
      ctx.log.info(`Batch processed (${batch.items.length} items). Total: ${totalItemsFound}. Next cursor: ${batch.nextCursor}`);

      if (evalResult.shouldStop) {
        ctx.log.info(`Stopping criteria met: ${evalResult.reason}`);
        catalog.updateJobProgress(job.id, { status: 'done' });
        return {
          jobId: job.id,
          itemsFound: totalItemsFound,
          newItemsSaved,
          stopReason: evalResult.reason,
          status: 'done',
        };
      }
    }

    catalog.updateJobProgress(job.id, { status: 'done' });
    return {
      jobId: job.id,
      itemsFound: totalItemsFound,
      newItemsSaved,
      status: 'done',
    };
  } catch (err: any) {
    ctx.log.error(`Crawl job failed: ${err.message}`);
    catalog.updateJobProgress(job.id, {
      status: 'failed',
      lastError: err.message,
    });
    return {
      jobId: job.id,
      itemsFound: totalItemsFound,
      newItemsSaved,
      status: 'failed',
      lastError: err.message,
    };
  }
}
