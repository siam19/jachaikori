/**
 * @file tools/crawler/src/engine/scraper.ts
 * Concurrent across outlets, strictly serial & polite per outlet full-article scraper
 * with immediate SQLite WAL persistence and live static dashboard updates.
 */

import type { OutletCrawler } from '@jachaikori/outlets';
import type { OutletId } from '@jachaikori/schema';
import { CatalogDatabase } from './catalog';
import { PoliteHttpClient } from './http';
import { BrowserPool } from './browser';
import { abortableSleep, DomainRateLimiter } from './limiter';
import { ScrapeDashboard, type OutletScrapeState } from '../ui/scrape-dashboard';

/**
 * Outlets behind Cloudflare JS protection where plain HTTP always 403s.
 * Routing directly to persistent Playwright contexts avoids firing guaranteed-403 WAF probes.
 */
const PLAYWRIGHT_NATIVE_OUTLETS = new Set<OutletId>([
  'bangladesh-protidin',
  'jugantor',
  'kaler-kantho',
]);

const MIN_VALID_BODY_CHARS = 60;

export interface ScrapeRunnerOptions {
  outlets: OutletCrawler[];
  catalog: CatalogDatabase;
  limitPerOutlet?: number;
  concurrency?: number;
  retryFailed?: boolean;
  signal?: AbortSignal;
  onShutdownTriggered?: (dashboard: ScrapeDashboard) => void;
}

export interface OutletScrapeResult {
  outlet: OutletId;
  scraped: number;
  failed: number;
  remainingPending: number;
  stoppedReason?: string;
}

export interface ScrapeSummary {
  totalScrapedThisSession: number;
  totalFailedThisSession: number;
  aborted: boolean;
  durationMs: number;
  perOutlet: OutletScrapeResult[];
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isChallengeOrCaptchaHtml(html: string): boolean {
  if (html.length < 15_000) {
    if (
      html.includes('<title>Just a moment...</title>') ||
      html.includes('Attention Required! | Cloudflare') ||
      html.includes('cf-browser-verification') ||
      html.includes('challenges.cloudflare.com/turnstile') ||
      html.includes('Verify you are human')
    ) {
      return true;
    }
  }
  return false;
}

function resolvePrimaryDomain(outlet: OutletCrawler): string {
  const firstSource = outlet.defaultSources[0];
  if (firstSource) {
    try {
      return new URL(firstSource.url).hostname;
    } catch {
      // ignore
    }
  }
  return outlet.id;
}

export async function runArticleScraper(options: ScrapeRunnerOptions): Promise<ScrapeSummary> {
  const {
    outlets,
    catalog,
    limitPerOutlet,
    concurrency = 8,
    retryFailed = false,
    signal,
  } = options;

  const startedAt = Date.now();
  const limiter = new DomainRateLimiter({
    baseDelayMs: 1500,
    minJitterMs: 200,
    jitterMs: 600,
  });

  const httpClient = new PoliteHttpClient({
    limiter,
    maxRetries: 2,
    timeoutMs: 18_000,
  });
  const browserPool = new BrowserPool();

  // Read initial progress from SQLite
  const progressRows = catalog.getScrapeProgressByOutlet();
  const progressMap = new Map(progressRows.map((r) => [r.outlet, r]));

  // Pre-load pending queues per outlet
  const queues = new Map<
    OutletId,
    Array<{ id: string; canonicalUrl: string; title: string; publishedAt: string | null }>
  >();
  const waitDeadlines = new Map<OutletId, number>();

  const initialStates: OutletScrapeState[] = outlets.map((outlet) => {
    const domain = resolvePrimaryDomain(outlet);
    // Safety floor on limiter (worker loop performs the primary human-paced sleep)
    limiter.setDomainDelay(domain, Math.max(800, Math.floor(outlet.policy.crawlDelayMs * 0.6)));

    const pendingQueue = catalog.getPendingArticlesForOutlet(outlet.id, {
      limit: limitPerOutlet,
      retryFailed,
    });
    queues.set(outlet.id, pendingQueue);

    const prog = progressMap.get(outlet.id);
    const activeTotal = prog?.activeTotal ?? pendingQueue.length;
    const extractedCount = prog?.extractedCount ?? 0;
    const failedCount = prog?.failedCount ?? 0;

    return {
      outlet: outlet.id,
      domain,
      transport: PLAYWRIGHT_NATIVE_OUTLETS.has(outlet.id) ? 'playwright' : 'http',
      activeTotal,
      extractedCount,
      sessionScraped: 0,
      failedCount,
      sessionFailed: 0,
      targetThisSession: pendingQueue.length,
      phase: pendingQueue.length === 0 ? 'done' : 'queued',
      waitMsRemaining: 0,
    };
  });

  const dashboard = new ScrapeDashboard(initialStates);
  options.onShutdownTriggered?.(dashboard);

  const refreshWaitDynamic = (st: OutletScrapeState) => {
    const deadline = waitDeadlines.get(st.outlet) ?? 0;
    const limiterWait = limiter.getWaitRemainingMs(st.domain);
    st.waitMsRemaining = Math.max(0, deadline - Date.now(), limiterWait);
  };

  dashboard.start(refreshWaitDynamic);

  const results = new Map<OutletId, OutletScrapeResult>();

  async function sleepWithPhase(
    outletId: OutletId,
    phase: 'waiting' | 'breather' | 'cooldown',
    durationMs: number
  ): Promise<void> {
    waitDeadlines.set(outletId, Date.now() + durationMs);
    dashboard.updateOutlet(outletId, { phase, waitMsRemaining: durationMs });
    try {
      await abortableSleep(durationMs, signal);
    } finally {
      waitDeadlines.delete(outletId);
    }
  }

  async function scrapeOutletSerial(outlet: OutletCrawler): Promise<void> {
    const pending = queues.get(outlet.id) ?? [];
    const state = dashboard.getState(outlet.id)!;

    if (pending.length === 0) {
      dashboard.updateOutlet(outlet.id, { phase: 'done' });
      results.set(outlet.id, {
        outlet: outlet.id,
        scraped: 0,
        failed: 0,
        remainingPending: 0,
      });
      return;
    }

    if (!outlet.extractArticle) {
      dashboard.updateOutlet(outlet.id, { phase: 'stopped' });
      results.set(outlet.id, {
        outlet: outlet.id,
        scraped: 0,
        failed: 0,
        remainingPending: pending.length,
        stoppedReason: 'No extractArticle() implemented',
      });
      return;
    }

    const usePlaywrightNative = PLAYWRIGHT_NATIVE_OUTLETS.has(outlet.id);
    // Playwright page loads naturally take ~500ms longer than HTTP fetch, so slightly tighter
    // post-load jitter keeps PW outlets advancing at the exact same ~20/min cadence as HTTP outlets.
    const baseDelayMs = Math.max(outlet.policy.crawlDelayMs, usePlaywrightNative ? 1500 : 1600);
    // Kaler Kantho sets sticky AWSALB/telemetry cookies after the 1st load that trigger 403 on reuse;
    // using a fresh lightweight BrowserContext per URL inside the shared Browser avoids 403s completely (~430ms/page).
    const maxNavsBeforeRecycle = outlet.id === 'kaler-kantho' ? 1 : 40;
    let nextBreatherAt = randomInt(35, 45);
    let processedInOutlet = 0;
    let consecutiveBlocks = 0;
    let consecutiveNetDrops = 0;
    let stoppedReason: string | undefined;

    // Stagger initial startup slightly (150–900ms) so all 8 outlets don't fire on the exact same tick
    try {
      const initialStagger = randomInt(150, 900);
      await sleepWithPhase(outlet.id, 'waiting', initialStagger);
    } catch {
      // Aborted during initial stagger
    }

    for (let i = 0; i < pending.length; i++) {
      if (signal?.aborted) {
        break;
      }

      const item = pending[i]!;

      // Inter-request human pacing before 2nd+ articles
      if (processedInOutlet > 0) {
        try {
          if (processedInOutlet >= nextBreatherAt) {
            const breatherMs = randomInt(7_000, 12_000);
            nextBreatherAt = processedInOutlet + randomInt(35, 45);
            await sleepWithPhase(outlet.id, 'breather', breatherMs);
          } else {
            const jitterMs = usePlaywrightNative ? randomInt(400, 1100) : randomInt(600, 1600);
            const politeMs = baseDelayMs + jitterMs;
            await sleepWithPhase(outlet.id, 'waiting', politeMs);
          }
        } catch {
          // Aborted cleanly during sleep — row hasn't been touched, stays 'discovered'
          break;
        }
      }

      if (signal?.aborted) break;

      dashboard.updateOutlet(outlet.id, { phase: 'scraping', waitMsRemaining: 0 });

      let html: string | null = null;
      let httpStatus = 200;

      try {
        if (usePlaywrightNative) {
          const res = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
            limiter,
            signal,
            timeoutMs: 28_000,
            maxNavsBeforeRecycle,
          });
          html = res.html;
          httpStatus = res.status;
        } else {
          const response = await httpClient.fetch(item.canonicalUrl, { signal });
          httpStatus = response.status;

          if (response.ok) {
            const bodyText = await response.text();
            if (isChallengeOrCaptchaHtml(bodyText)) {
              // Unexpected Cloudflare challenge on HTTP outlet -> try Playwright once
              const pwRes = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
                limiter,
                signal,
                timeoutMs: 28_000,
                maxNavsBeforeRecycle,
              });
              html = pwRes.html;
              httpStatus = pwRes.status;
            } else {
              html = bodyText;
            }
          } else if (httpStatus === 403) {
            // Try Playwright fallback on 403
            const pwRes = await browserPool.fetchWithSession(outlet.id, item.canonicalUrl, {
              limiter,
              signal,
              timeoutMs: 28_000,
              maxNavsBeforeRecycle,
            });
            html = pwRes.html;
            httpStatus = pwRes.status;
          }
        }
        consecutiveNetDrops = 0;
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') {
          // User interrupted mid-fetch: leave row as 'discovered' for clean resume
          break;
        }

        const msg = String(err?.message ?? err);
        const isLocalNetBlip =
          msg.includes('ERR_INTERNET_DISCONNECTED') ||
          msg.includes('ERR_NETWORK_CHANGED') ||
          msg.includes('ERR_NAME_NOT_RESOLVED') ||
          msg.includes('EAI_AGAIN');

        if (isLocalNetBlip && consecutiveNetDrops < 6) {
          consecutiveNetDrops++;
          try {
            await sleepWithPhase(outlet.id, 'waiting', 6_000);
            i--; // Retry same article once connection returns
            continue;
          } catch {
            break;
          }
        }

        catalog.markArticleFailed(item.id, `Network error: ${msg}`);
        dashboard.updateOutlet(outlet.id, {
          failedCount: state.failedCount + 1,
          sessionFailed: state.sessionFailed + 1,
        });
        processedInOutlet++;
        continue;
      }

      // Handle 404 / 410 dead links immediately
      if (httpStatus === 404 || httpStatus === 410) {
        catalog.markArticleFailed(item.id, `HTTP ${httpStatus} Not Found`);
        dashboard.updateOutlet(outlet.id, {
          failedCount: state.failedCount + 1,
          sessionFailed: state.sessionFailed + 1,
        });
        processedInOutlet++;
        continue;
      }

      // Handle rate-limiting (429) or persistent WAF/CAPTCHA block without attempting any bypass
      if (
        httpStatus === 429 ||
        httpStatus === 403 ||
        !html ||
        isChallengeOrCaptchaHtml(html)
      ) {
        consecutiveBlocks++;
        if (usePlaywrightNative) {
          await browserPool.disposeSession(outlet.id);
        }

        if (consecutiveBlocks >= 3) {
          // Leave article 'discovered' and halt this outlet cleanly to respect anti-bot gate
          stoppedReason = `Paused after ${consecutiveBlocks} consecutive WAF/rate-limit responses (HTTP ${httpStatus})`;
          break;
        }

        // Cool down this outlet for 65–90s while other outlets continue, then retry this item once
        try {
          const cooldownMs = randomInt(65_000, 90_000);
          limiter.tripCooldown(state.domain, cooldownMs);
          await sleepWithPhase(outlet.id, 'cooldown', cooldownMs);
          i--; // Retry same article after cooldown
          continue;
        } catch {
          break;
        }
      }

      if (httpStatus >= 500) {
        catalog.markArticleFailed(item.id, `Server error HTTP ${httpStatus}`);
        dashboard.updateOutlet(outlet.id, {
          failedCount: state.failedCount + 1,
          sessionFailed: state.sessionFailed + 1,
        });
        processedInOutlet++;
        continue;
      }

      // Reset block counter on clean response
      consecutiveBlocks = 0;

      // Extract & commit atomically to SQLite immediately (even if signal just fired!)
      try {
        const extracted = outlet.extractArticle(html, item.canonicalUrl);
        const bodyLen = extracted.cleanText.trim().length;

        if (bodyLen < MIN_VALID_BODY_CHARS) {
          catalog.markArticleFailed(
            item.id,
            `Extracted body too short (${bodyLen} chars)`
          );
          dashboard.updateOutlet(outlet.id, {
            failedCount: state.failedCount + 1,
            sessionFailed: state.sessionFailed + 1,
          });
        } else {
          catalog.saveExtractedArticle(item.id, extracted);
          dashboard.updateOutlet(outlet.id, {
            extractedCount: state.extractedCount + 1,
            sessionScraped: state.sessionScraped + 1,
          });
        }
      } catch (err: any) {
        catalog.markArticleFailed(item.id, `Parse error: ${err?.message ?? String(err)}`);
        dashboard.updateOutlet(outlet.id, {
          failedCount: state.failedCount + 1,
          sessionFailed: state.sessionFailed + 1,
        });
      }

      processedInOutlet++;
    }

    const finalPhase =
      signal?.aborted || stoppedReason
        ? 'stopped'
        : 'done';
    dashboard.updateOutlet(outlet.id, { phase: finalPhase, waitMsRemaining: 0 });

    const remainingRows = catalog.getPendingArticlesForOutlet(outlet.id, { retryFailed: false });
    results.set(outlet.id, {
      outlet: outlet.id,
      scraped: state.sessionScraped,
      failed: state.sessionFailed,
      remainingPending: remainingRows.length,
      stoppedReason,
    });
  }

  try {
    const outletQueue = [...outlets];
    const workerCount = Math.max(1, Math.min(concurrency, outletQueue.length));

    const workers = Array.from({ length: workerCount }, async () => {
      while (outletQueue.length > 0 && !signal?.aborted) {
        const nextOutlet = outletQueue.shift();
        if (nextOutlet) {
          await scrapeOutletSerial(nextOutlet);
        }
      }
    });

    await Promise.all(workers);

    // Mark any queued outlets that never started due to early Ctrl+C
    for (const outlet of outlets) {
      const st = dashboard.getState(outlet.id)!;
      if (st.phase === 'queued') {
        dashboard.updateOutlet(outlet.id, { phase: 'stopped' });
      }
      if (!results.has(outlet.id)) {
        const rem = catalog.getPendingArticlesForOutlet(outlet.id, { retryFailed: false });
        results.set(outlet.id, {
          outlet: outlet.id,
          scraped: st.sessionScraped,
          failed: st.sessionFailed,
          remainingPending: rem.length,
        });
      }
    }
  } finally {
    catalog.checkpoint();
    dashboard.stop(refreshWaitDynamic);
    await browserPool.close();
  }

  const perOutlet = outlets.map((o) => results.get(o.id)!);
  const totalScrapedThisSession = perOutlet.reduce((acc, r) => acc + r.scraped, 0);
  const totalFailedThisSession = perOutlet.reduce((acc, r) => acc + r.failed, 0);

  return {
    totalScrapedThisSession,
    totalFailedThisSession,
    aborted: Boolean(signal?.aborted),
    durationMs: Date.now() - startedAt,
    perOutlet,
  };
}
