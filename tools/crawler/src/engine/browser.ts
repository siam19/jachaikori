/**
 * @file tools/crawler/src/engine/browser.ts
 * Lightweight Playwright browser orchestration with persistent per-outlet sessions,
 * anti-automation masking, DomainRateLimiter integration, and asset blocking.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { abortableSleep, type DomainRateLimiter } from './limiter';

const BLOCKED_RESOURCE_TYPES = new Set(['media', 'font']);
const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.net',
];

interface PersistentSession {
  context: BrowserContext;
  page: Page;
  navCount: number;
  warmedOrigins: Set<string>;
}

function isPassiveJsChallenge(html: string): boolean {
  if (html.length > 120_000) return false;
  if (html.includes('challenges.cloudflare.com/turnstile') || html.includes('Verify you are human')) {
    return false;
  }
  return (
    html.includes('<title>Just a moment...</title>') ||
    html.includes('id="cf-browser-verification"') ||
    html.includes('class="cf-browser-verification"') ||
    html.includes('id="challenge-form"') ||
    html.includes('Enable JavaScript and cookies to continue')
  );
}

export class BrowserPool {
  private browser: Browser | null = null;
  private browserLaunchPromise: Promise<Browser> | null = null;
  private sessions = new Map<string, PersistentSession>();

  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    if (!this.browserLaunchPromise) {
      this.browserLaunchPromise = chromium
        .launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
          ],
        })
        .then((b) => {
          this.browser = b;
          this.browserLaunchPromise = null;
          return b;
        })
        .catch((err) => {
          this.browserLaunchPromise = null;
          throw err;
        });
    }
    return this.browserLaunchPromise;
  }

  /**
   * Creates an optimized Page that blocks bandwidth-heavy assets/trackers and hides webdriver flags.
   */
  async createPolitePage(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'bn-BD',
      timezoneId: 'Asia/Dhaka',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        'Accept-Language': 'bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();

    // Block unnecessary assets while preserving HTML & JS challenges
    await page.route('**/*', (route) => {
      const req = route.request();
      const resourceType = req.resourceType();
      const url = req.url();

      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        return route.abort();
      }

      if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
        return route.abort();
      }

      return route.continue();
    });

    return { context, page };
  }

  /**
   * Gets or creates a sticky BrowserContext + Page for an outlet so session/CF cookies persist,
   * recycling every `maxNavs` navigations to keep Chromium memory bounded.
   */
  private async getOrCreateSession(
    sessionKey: string,
    maxNavs: number = 150
  ): Promise<PersistentSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing && !existing.page.isClosed() && existing.navCount < maxNavs) {
      return existing;
    }

    if (existing) {
      await existing.context.close().catch(() => {});
      this.sessions.delete(sessionKey);
    }

    const { context, page } = await this.createPolitePage();
    const session: PersistentSession = { context, page, navCount: 0, warmedOrigins: new Set() };
    this.sessions.set(sessionKey, session);
    return session;
  }

  /**
   * Disposes a single sticky session (e.g. after a target crash or hard block).
   */
  async disposeSession(sessionKey: string): Promise<void> {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      this.sessions.delete(sessionKey);
      await existing.context.close().catch(() => {});
    }
  }

  /**
   * Fetches rendered HTML using a persistent per-outlet session, honoring DomainRateLimiter & AbortSignal.
   */
  async fetchWithSession(
    sessionKey: string,
    url: string,
    options?: {
      limiter?: DomainRateLimiter;
      signal?: AbortSignal;
      waitForSelector?: string;
      timeoutMs?: number;
      maxNavsBeforeRecycle?: number;
    }
  ): Promise<{ html: string; status: number; serverHeader?: string }> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const origin = parsedUrl.origin;

    if (options?.limiter) {
      await options.limiter.acquire(domain, signal);
    }

    const session = await this.getOrCreateSession(sessionKey, options?.maxNavsBeforeRecycle ?? 150);

    try {
      // Warm homepage once per persistent browser session so origin/clearance cookies settle cleanly
      // (skip when maxNavsBeforeRecycle === 1, e.g. kaler-kantho, to avoid setting sticky WAF cookies)
      const shouldWarm = (options?.maxNavsBeforeRecycle ?? 150) > 1;
      if (shouldWarm && !session.warmedOrigins.has(origin)) {
        session.warmedOrigins.add(origin);
        try {
          await session.page.goto(`${origin}/`, {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(18_000, options?.timeoutMs ?? 25_000),
          });
          const warmHtml = await session.page.content();
          if (isPassiveJsChallenge(warmHtml) && !signal?.aborted) {
            await abortableSleep(4_000, signal);
          }
        } catch {
          // Non-fatal; proceed directly to target article URL
        }
        if (options?.limiter) {
          await options.limiter.acquire(domain, signal);
        }
      }

      const response = await session.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options?.timeoutMs ?? 25_000,
        referer: `${origin}/`,
      });

      session.navCount++;
      let status = response?.status() ?? 200;
      const serverHeader = response?.headers()['server'];

      if (options?.waitForSelector) {
        await session.page
          .waitForSelector(options.waitForSelector, { timeout: 8_000 })
          .catch(() => {});
      }

      let html = await session.page.content();

      // If Cloudflare passive JS check ("Just a moment...") is auto-redirecting, wait up to 2 short cycles
      for (let w = 0; w < 2 && isPassiveJsChallenge(html) && !signal?.aborted; w++) {
        await abortableSleep(4_000, signal);
        html = await session.page.content();
        if (!isPassiveJsChallenge(html)) {
          status = 200;
          break;
        }
      }

      if (status >= 200 && status < 400) {
        options?.limiter?.reportSuccess(domain);
      } else if (status === 429 || status >= 500) {
        options?.limiter?.reportFailure(domain, status);
      }

      return { html, status, serverHeader };
    } catch (err: any) {
      if (!signal?.aborted) {
        // Recycle crashed/hung page on unexpected navigation error
        await this.disposeSession(sessionKey);
      }
      throw err;
    }
  }

  /**
   * One-off rendered HTML fetch (used by list crawlers and single-URL verifier).
   */
  async fetchRenderedHtml(
    url: string,
    options?: { waitForSelector?: string; timeoutMs?: number }
  ): Promise<string> {
    const { context, page } = await this.createPolitePage();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options?.timeoutMs ?? 25_000,
        referer: `${new URL(url).origin}/`,
      });

      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10_000 }).catch(() => {});
      }

      return await page.content();
    } finally {
      await context.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    const closingSessions = Array.from(this.sessions.values()).map((s) =>
      s.context.close().catch(() => {})
    );
    this.sessions.clear();
    await Promise.all(closingSessions);

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.browserLaunchPromise = null;
  }
}
