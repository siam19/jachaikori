/**
 * @file tools/crawler/src/engine/runner.ts
 * Job runner that drives an outlet crawler for a given source, writes batches to SQLite,
 * checks the stop condition, and saves checkpoint cursors.
 */

import type { SourceDef } from '@jachaikori/schema';
import type { OutletCrawler, CrawlContext } from '@jachaikori/outlets';
import color from 'picocolors';
import { CatalogDatabase } from './catalog';
import { PoliteHttpClient } from './http';
import { BrowserPool } from './browser';
import { StopEvaluator } from './stop';
import { appendFileSync, mkdirSync } from 'node:fs';
import { canonicalizeUrl } from './url';

export interface RunOptions {
  outlet: OutletCrawler;
  source: SourceDef;
  catalog: CatalogDatabase;
  httpClient: PoliteHttpClient;
  browserPool?: BrowserPool;
  cutoffDate?: string;
  maxPages?: number;
  resume?: boolean;
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
  const {
    outlet,
    source,
    catalog,
    httpClient,
    browserPool,
    cutoffDate = '2026-01-01',
    maxPages,
    resume = false,
    signal,
  } = options;
  const job = catalog.getOrCreateJob(outlet.id, source.key);

  // Register outlet domain crawl delay with limiter
  try {
    const domain = new URL(source.url).hostname;
    httpClient.getLimiter().setDomainDelay(domain, outlet.policy.crawlDelayMs);
  } catch {
    // Ignore invalid source URLs
  }

  catalog.updateJobProgress(job.id, { status: 'running' });

  const stopEvaluator = new StopEvaluator({
    cutoffDate,
    maxSafetyBatches: maxPages,
  });

  // If resuming, use saved cursor; otherwise start fresh from latest published articles
  const initialCursor = resume ? job.cursor : null;

  const ctx: CrawlContext = {
    fetchText: (url, init) => httpClient.fetchText(url, init),
    fetchJson: (url, init) => httpClient.fetchJson(url, init),
    fetchPageHtml: browserPool ? (url, opts) => browserPool.fetchRenderedHtml(url, opts) : undefined,
    cursor: initialCursor,
    log: {
      info: (msg, meta) => console.log(`  ${color.dim('│')} ${color.cyan(`[${outlet.id}:${source.key}]`)} ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`  ${color.dim('│')} ${color.yellow(`[${outlet.id}:${source.key}]`)} ⚠️  ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`  ${color.dim('│')} ${color.red(`[${outlet.id}:${source.key}]`)} ✗  ${msg}`, meta ?? ''),
      debug: (msg, meta) => console.debug(`  ${color.dim('│')} ${color.dim(`[${outlet.id}:${source.key}]`)} ${msg}`, meta ?? ''),
    },
    signal,
  };

  let totalItemsFound = catalog.getArticleCountForSource(outlet.id, source.key);
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
      const batchUrls: string[] = [];
      let newItemsInBatch = 0;

      for (const item of batch.items) {
        const cleanUrl = canonicalizeUrl(item.url, outlet.canonicalizeUrl);
        batchUrls.push(cleanUrl);

        const { isNew, publishedAtIso } = catalog.upsertDiscoveredItem(
          outlet.id,
          source.key,
          item,
          outlet.canonicalizeUrl
        );

        if (isNew) {
          totalItemsFound++;
          newItemsSaved++;
          newItemsInBatch++;
          try {
            mkdirSync('data/urls', { recursive: true });
            const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
            appendFileSync(`data/urls/${outlet.id}.txt`, `${cleanUrl} | ${cleanTitle}\n`);
          } catch {
            // Non-fatal if file write fails
          }
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

      // Check stop rule with duplicate loop detection
      const evalResult = stopEvaluator.evaluateBatch(publishedDates, batch.nextCursor, batchUrls);
      const catalogTotal = catalog.getTotalArticleCount();
      const oldestStr = oldestDate ? oldestDate.split('T')[0] : 'unknown';
      ctx.log.info(
        `Batch: ${color.white(batch.items.length)} items (${color.green(`+${newItemsInBatch} new`)}) · Total: ${color.yellow(String(totalItemsFound))} · Catalog: ${color.cyan(catalogTotal.toLocaleString())} · Oldest: ${color.dim(oldestStr)}`
      );

      if (evalResult.shouldStop) {
        ctx.log.info(`Stopping criteria met: ${evalResult.reason}`);
        const finalStatus = totalItemsFound === 0 ? 'failed' : 'done';
        const finalError = totalItemsFound === 0 ? `Stopped with 0 articles found (${evalResult.reason})` : undefined;
        catalog.updateJobProgress(job.id, { status: finalStatus, lastError: finalError });
        return {
          jobId: job.id,
          itemsFound: totalItemsFound,
          newItemsSaved,
          stopReason: evalResult.reason,
          status: finalStatus,
          lastError: finalError,
        };
      }
    }

    const finalStatus = totalItemsFound === 0 ? 'failed' : 'done';
    const finalError = totalItemsFound === 0 ? 'Stream ended with 0 articles found' : undefined;
    catalog.updateJobProgress(job.id, { status: finalStatus, lastError: finalError });
    return {
      jobId: job.id,
      itemsFound: totalItemsFound,
      newItemsSaved,
      status: finalStatus,
      lastError: finalError,
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
