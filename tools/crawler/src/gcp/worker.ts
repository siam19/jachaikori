/**
 * @file tools/crawler/src/gcp/worker.ts
 * Cloud Run Job worker for coordinated distributed article scraping.
 * Coordinates across multiple simultaneous Cloud Run Jobs & tasks via atomic GCS leases.
 */

import { getOutlet } from '@jachaikori/outlets';
import type { OutletId } from '@jachaikori/schema';
import { BrowserPool } from '../engine/browser';
import { PoliteHttpClient } from '../engine/http';
import { abortableSleep, DomainRateLimiter } from '../engine/limiter';
import { isChallengeOrCaptchaHtml, MIN_VALID_BODY_CHARS, PLAYWRIGHT_NATIVE_OUTLETS } from '../engine/scraper';
import { GcsClient } from './gcs';
import type {
  DoneMarker,
  LeaseLock,
  ScrapeChunkItem,
  ScrapeChunkMeta,
  ScrapePool,
  ScrapeResultRecord,
  ScrapeRunManifest,
  TaskHeartbeat,
} from './types';

const LEASE_TTL_MS = 45 * 60 * 1000;
const FLUSH_EVERY_N_ARTICLES = 20;
const OUTLET_CIRCUIT_BREAKER_THRESHOLD = 8;

function extractTitle(html: string | null): string {
  if (!html) return '';
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1]!.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

function formatBlockDiagnostic(
  httpStatus: number,
  html: string | null,
  serverHeader?: string
): string {
  const parts: string[] = [];
  if (serverHeader) parts.push(`server=${serverHeader}`);
  const title = extractTitle(html);
  if (title) parts.push(`title="${title}"`);
  const detail = parts.length > 0 ? ` [${parts.join(' | ')}]` : '';
  if (html && isChallengeOrCaptchaHtml(html)) {
    return `Cloudflare challenge (HTTP ${httpStatus})${detail}`;
  }
  return `HTTP ${httpStatus}${detail}`;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function resolvePrimaryDomain(outletId: OutletId): string {
  const outlet = getOutlet(outletId);
  try {
    return new URL(outlet.baseUrl).hostname;
  } catch {
    return `${outletId}.local`;
  }
}

function matchesPool(outlet: OutletId, pool: ScrapePool): boolean {
  if (pool === 'all') return true;
  const isBrowser = PLAYWRIGHT_NATIVE_OUTLETS.has(outlet);
  return pool === 'browser' ? isBrowser : !isBrowser;
}

/**
 * Interleaves chunks across outlets in round-robin order and rotates by taskIndex
 * so parallel Cloud Run tasks spread across different outlets rather than colliding on one domain.
 */
function orderChunksForWorker(chunks: ScrapeChunkMeta[], taskIndex: number): ScrapeChunkMeta[] {
  const byOutlet = new Map<OutletId, ScrapeChunkMeta[]>();
  for (const chunk of chunks) {
    const arr = byOutlet.get(chunk.outlet) ?? [];
    arr.push(chunk);
    byOutlet.set(chunk.outlet, arr);
  }

  const outletLists = Array.from(byOutlet.values());
  if (outletLists.length === 0) return [];

  const shift = taskIndex % outletLists.length;
  const rotated = [...outletLists.slice(shift), ...outletLists.slice(0, shift)];

  const interleaved: ScrapeChunkMeta[] = [];
  let idx = 0;
  while (true) {
    let added = false;
    for (const list of rotated) {
      if (idx < list.length) {
        interleaved.push(list[idx]!);
        added = true;
      }
    }
    if (!added) break;
    idx++;
  }
  return interleaved;
}

export async function runGcpScrapeWorker(): Promise<void> {
  const bucket = process.env.GCS_BUCKET;
  const runId = process.env.RUN_ID;
  const pool = (process.env.POOL ?? 'all') as ScrapePool;
  const jobName = process.env.JOB_NAME ?? `jachaikori-scrape-${pool}`;
  const taskIndex = Number(process.env.CLOUD_RUN_TASK_INDEX ?? 0);
  const taskCount = Math.max(1, Number(process.env.CLOUD_RUN_TASK_COUNT ?? 1));
  const maxRuntimeMs = Number(process.env.MAX_RUNTIME_MS ?? 22 * 60 * 60 * 1000);

  if (!bucket || !runId) {
    throw new Error('GCS_BUCKET and RUN_ID environment variables are required.');
  }

  const workerId = `${jobName}-task-${taskIndex}`;
  const runPrefix = `scrape-runs/${runId}`;
  const gcs = new GcsClient({ authMode: 'auto' });

  const abortController = new AbortController();
  const startedAt = Date.now();

  const onSignal = (sig: string) => {
    console.log(`[${workerId}] Received ${sig}, shutting down cleanly after current article...`);
    abortController.abort();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const manifest = await gcs.getObjectJson<ScrapeRunManifest>(bucket, `${runPrefix}/manifest.json`);
  if (!manifest) {
    throw new Error(`Run manifest not found at gs://${bucket}/${runPrefix}/manifest.json`);
  }

  const eligibleChunks = manifest.chunks.filter((c) => matchesPool(c.outlet, pool));
  const orderedChunks = orderChunksForWorker(eligibleChunks, taskIndex);

  console.log(
    `[${workerId}] Started (pool=${pool}, task=${taskIndex + 1}/${taskCount}, eligibleChunks=${orderedChunks.length}/${manifest.totalChunks})`
  );

  const limiter = new DomainRateLimiter();
  const httpClient = new PoliteHttpClient({ limiter, maxRetries: 2, timeoutMs: 18_000 });
  const browserPool = new BrowserPool();

  let totalScraped = 0;
  let totalFailed = 0;
  let chunksCompleted = 0;
  let activeLeasePath: string | null = null;
  const blockedOutlets = new Set<OutletId>();

  const writeHeartbeat = async (
    status: TaskHeartbeat['status'],
    chunkId: string | null = null,
    outlet: OutletId | null = null,
    chunkDone = 0,
    chunkTotal = 0
  ) => {
    const hb: TaskHeartbeat = {
      workerId,
      jobName,
      taskIndex,
      pool,
      status,
      currentChunkId: chunkId,
      currentOutlet: outlet,
      chunkDone,
      chunkTotal,
      totalScraped,
      totalFailed,
      chunksCompleted,
      updatedAt: new Date().toISOString(),
    };
    try {
      await gcs.putObjectJson(bucket, `${runPrefix}/heartbeats/${workerId}.json`, hb);
    } catch (err: any) {
      console.warn(`[${workerId}] Failed writing heartbeat: ${err?.message ?? err}`);
    }
  };

  await writeHeartbeat('idle');

  try {
    while (!abortController.signal.aborted && Date.now() - startedAt < maxRuntimeMs) {
      const [doneObjs, leaseObjs] = await Promise.all([
        gcs.listObjects(bucket, `${runPrefix}/done/`),
        gcs.listObjects(bucket, `${runPrefix}/leases/`),
      ]);

      const doneIds = new Set(
        doneObjs.map((o) => o.name.slice(`${runPrefix}/done/`.length).replace(/\.json$/, ''))
      );
      const leaseMap = new Map<string, { name: string; updatedMs: number }>();
      for (const l of leaseObjs) {
        const id = l.name.slice(`${runPrefix}/leases/`.length).replace(/\.lock$/, '');
        leaseMap.set(id, { name: l.name, updatedMs: Date.parse(l.updated) || 0 });
      }

      let claimedChunk: ScrapeChunkMeta | null = null;

      for (const candidate of orderedChunks) {
        if (abortController.signal.aborted) break;
        if (doneIds.has(candidate.chunkId)) continue;
        if (blockedOutlets.has(candidate.outlet)) continue;

        const existingLease = leaseMap.get(candidate.chunkId);
        if (existingLease) {
          const ageMs = Date.now() - existingLease.updatedMs;
          if (ageMs < LEASE_TTL_MS) {
            continue;
          }
          // Stale lease from crashed/preempted task: remove it before attempting re-claim
          console.log(
            `[${workerId}] Reclaiming stale lease for ${candidate.chunkId} (age=${Math.round(ageMs / 60000)}m)`
          );
          await gcs.deleteObject(bucket, existingLease.name);
        }

        const leasePath = `${runPrefix}/leases/${candidate.chunkId}.lock`;
        const lock: LeaseLock = {
          chunkId: candidate.chunkId,
          outlet: candidate.outlet,
          workerId,
          jobName,
          taskIndex,
          claimedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        };

        const won = await gcs.putObjectJson(bucket, leasePath, lock, { ifGenerationMatch: 0 });
        if (won) {
          claimedChunk = candidate;
          activeLeasePath = leasePath;
          break;
        }
      }

      if (!claimedChunk) {
        console.log(`[${workerId}] No more unclaimed chunks in pool=${pool}.`);
        break;
      }

      const outlet = getOutlet(claimedChunk.outlet);
      const domain = resolvePrimaryDomain(claimedChunk.outlet);
      const usePlaywrightNative = PLAYWRIGHT_NATIVE_OUTLETS.has(claimedChunk.outlet);
      limiter.setDomainDelay(domain, Math.max(800, Math.floor(outlet.policy.crawlDelayMs * 0.6)));
      const baseDelayMs = Math.max(outlet.policy.crawlDelayMs, usePlaywrightNative ? 1500 : 1600);

      const chunkRaw = await gcs.getObjectText(bucket, claimedChunk.objectPath);
      if (!chunkRaw) {
        console.warn(`[${workerId}] Missing chunk object ${claimedChunk.objectPath}, skipping.`);
        activeLeasePath = null;
        continue;
      }

      const items: ScrapeChunkItem[] = chunkRaw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ScrapeChunkItem);

      // Resume partial chunk results if reclaiming a stale lease
      const resultsPath = `${runPrefix}/results/${claimedChunk.chunkId}.jsonl`;
      const existingResultsRaw = await gcs.getObjectText(bucket, resultsPath);
      const records: ScrapeResultRecord[] = [];
      const alreadyDoneIds = new Set<string>();
      if (existingResultsRaw) {
        for (const line of existingResultsRaw.split('\n')) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line) as ScrapeResultRecord;
            records.push(rec);
            alreadyDoneIds.add(rec.id);
          } catch {
            // ignore partial trailing line
          }
        }
      }

      const pendingItems = items.filter((item) => !alreadyDoneIds.has(item.id));
      console.log(
        `[${workerId}] Claimed ${claimedChunk.chunkId} (${claimedChunk.outlet}): ${pendingItems.length}/${items.length} pending`
      );

      let chunkScraped = 0;
      let chunkFailed = 0;
      let chunkBlocked = 0;
      let consecutiveBlocks = 0;
      let processedSinceFlush = 0;
      let outletCircuitTripped = false;

      const flushPartial = async () => {
        if (records.length > 0) {
          const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
          await gcs.putObjectText(bucket, resultsPath, jsonl, {
            contentType: 'application/x-ndjson; charset=utf-8',
          });
        }
        if (activeLeasePath) {
          await gcs.putObjectJson(bucket, activeLeasePath, {
            chunkId: claimedChunk.chunkId,
            outlet: claimedChunk.outlet,
            workerId,
            jobName,
            taskIndex,
            claimedAt: new Date().toISOString(),
            heartbeatAt: new Date().toISOString(),
          } satisfies LeaseLock);
        }
        await writeHeartbeat(
          'running',
          claimedChunk.chunkId,
          claimedChunk.outlet,
          alreadyDoneIds.size + chunkScraped + chunkFailed,
          items.length
        );
      };

      await writeHeartbeat(
        'running',
        claimedChunk.chunkId,
        claimedChunk.outlet,
        alreadyDoneIds.size,
        items.length
      );

      const maxNavsBeforeRecycle =
        claimedChunk.outlet === 'kaler-kantho' || claimedChunk.outlet === 'jugantor' ? 1 : 40;

      for (let i = 0; i < pendingItems.length; i++) {
        if (abortController.signal.aborted || Date.now() - startedAt >= maxRuntimeMs) {
          break;
        }

        const item = pendingItems[i]!;
        if (i > 0) {
          const jitterMs = usePlaywrightNative ? randomInt(400, 1000) : randomInt(500, 1400);
          try {
            await abortableSleep(baseDelayMs + jitterMs, abortController.signal);
          } catch {
            break;
          }
        }

        let html: string | null = null;
        let httpStatus = 200;
        let serverHeader: string | undefined;

        try {
          if (usePlaywrightNative) {
            const res = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
              limiter,
              signal: abortController.signal,
              timeoutMs: 28_000,
              maxNavsBeforeRecycle,
            });
            html = res.html;
            httpStatus = res.status;
            serverHeader = res.serverHeader;
          } else {
            const response = await httpClient.fetch(item.canonicalUrl, {
              signal: abortController.signal,
            });
            httpStatus = response.status;
            serverHeader = response.headers.get('server') ?? undefined;

            if (response.ok) {
              const bodyText = await response.text();
              if (isChallengeOrCaptchaHtml(bodyText)) {
                const pwRes = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
                  limiter,
                  signal: abortController.signal,
                  timeoutMs: 28_000,
                  maxNavsBeforeRecycle: 40,
                });
                html = pwRes.html;
                httpStatus = pwRes.status;
                serverHeader = pwRes.serverHeader ?? serverHeader;
              } else {
                html = bodyText;
              }
            } else if (httpStatus === 403) {
              const pwRes = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
                limiter,
                signal: abortController.signal,
                timeoutMs: 28_000,
                maxNavsBeforeRecycle: 40,
              });
              html = pwRes.html;
              httpStatus = pwRes.status;
              serverHeader = pwRes.serverHeader ?? serverHeader;
            }
          }
        } catch (err: any) {
          if (abortController.signal.aborted || err?.name === 'AbortError') {
            break;
          }
          chunkFailed++;
          totalFailed++;
          records.push({
            id: item.id,
            outlet: claimedChunk.outlet,
            status: 'failed',
            errorMessage: String(err?.message ?? err).slice(0, 400),
            scrapedAt: new Date().toISOString(),
          });
          processedSinceFlush++;
          if (processedSinceFlush >= FLUSH_EVERY_N_ARTICLES) {
            processedSinceFlush = 0;
            await flushPartial();
          }
          continue;
        }

        if (!html || httpStatus >= 400 || isChallengeOrCaptchaHtml(html)) {
          const isEdgeBlock =
            httpStatus === 403 || httpStatus === 429 || Boolean(html && isChallengeOrCaptchaHtml(html));
          const diagError = formatBlockDiagnostic(httpStatus, html, serverHeader);

          if (isEdgeBlock) {
            chunkBlocked++;
            consecutiveBlocks++;
            records.push({
              id: item.id,
              outlet: claimedChunk.outlet,
              status: 'blocked',
              errorMessage: diagError,
              scrapedAt: new Date().toISOString(),
            });
          } else {
            chunkFailed++;
            totalFailed++;
            records.push({
              id: item.id,
              outlet: claimedChunk.outlet,
              status: 'failed',
              errorMessage: diagError,
              scrapedAt: new Date().toISOString(),
            });
          }

          if (consecutiveBlocks >= OUTLET_CIRCUIT_BREAKER_THRESHOLD) {
            console.warn(
              `[${workerId}] Circuit breaker tripped for ${claimedChunk.outlet} (${consecutiveBlocks} consecutive blocks: ${diagError}). Skipping remaining chunks for this outlet on GCP.`
            );
            blockedOutlets.add(claimedChunk.outlet);
            outletCircuitTripped = true;
            break;
          }
        } else {
          try {
            const extracted = outlet.extractArticle(html, item.canonicalUrl);
            if (!extracted.cleanText || extracted.cleanText.trim().length < MIN_VALID_BODY_CHARS) {
              chunkFailed++;
              totalFailed++;
              records.push({
                id: item.id,
                outlet: claimedChunk.outlet,
                status: 'failed',
                errorMessage: 'Extracted body too short or empty',
                scrapedAt: new Date().toISOString(),
              });
            } else {
              consecutiveBlocks = 0;
              chunkScraped++;
              totalScraped++;
              records.push({
                id: item.id,
                outlet: claimedChunk.outlet,
                status: 'extracted',
                title: extracted.title,
                publishedAtIso: extracted.publishedAtIso ?? null,
                publishedAtRaw: extracted.publishedAtRaw,
                byline: extracted.byline ?? null,
                lead: extracted.lead ?? null,
                cleanText: extracted.cleanText,
                scrapedAt: new Date().toISOString(),
              });
            }
          } catch (err: any) {
            chunkFailed++;
            totalFailed++;
            records.push({
              id: item.id,
              outlet: claimedChunk.outlet,
              status: 'failed',
              errorMessage: `Extraction error: ${String(err?.message ?? err).slice(0, 350)}`,
              scrapedAt: new Date().toISOString(),
            });
          }
        }

        processedSinceFlush++;
        if (processedSinceFlush >= FLUSH_EVERY_N_ARTICLES) {
          processedSinceFlush = 0;
          await flushPartial();
        }
      }

      // Finalize flush for this chunk
      await flushPartial();

      const completedOrTripped =
        outletCircuitTripped ||
        (records.length >= items.length && !abortController.signal.aborted && Date.now() - startedAt < maxRuntimeMs);

      if (completedOrTripped) {
        const doneMarker: DoneMarker = {
          chunkId: claimedChunk.chunkId,
          outlet: claimedChunk.outlet,
          workerId,
          scraped: chunkScraped,
          failed: chunkFailed,
          blocked: chunkBlocked,
          completedAt: new Date().toISOString(),
        };
        await gcs.putObjectJson(bucket, `${runPrefix}/done/${claimedChunk.chunkId}.json`, doneMarker);
        await gcs.deleteObject(bucket, activeLeasePath);
        activeLeasePath = null;
        chunksCompleted++;
        console.log(
          `[${workerId}] Finished ${claimedChunk.chunkId} (+${chunkScraped} scraped, +${chunkFailed} failed, +${chunkBlocked} blocked)`
        );
      } else {
        // Interrupted or near max runtime: release lease so another task can pick up remaining items
        if (activeLeasePath) {
          await gcs.deleteObject(bucket, activeLeasePath);
          activeLeasePath = null;
        }
        break;
      }
    }
  } finally {
    if (activeLeasePath) {
      await gcs.deleteObject(bucket, activeLeasePath).catch(() => {});
    }
    await writeHeartbeat(abortController.signal.aborted ? 'stopped' : 'done');
    await browserPool.close();
  }

  console.log(
    `[${workerId}] Finished (chunksCompleted=${chunksCompleted}, totalScraped=${totalScraped}, totalFailed=${totalFailed})`
  );
}

if (import.meta.main) {
  runGcpScrapeWorker().catch((err) => {
    console.error('[gcp-worker] Fatal error:', err);
    process.exit(1);
  });
}
