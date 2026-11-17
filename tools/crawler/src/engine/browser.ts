/**
 * @file tools/crawler/src/engine/browser.ts
 * Lightweight Playwright browser orchestration with persistent per-outlet sessions,
 * anti-automation masking, DomainRateLimiter integration, and asset blocking.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { abortableSleep, type DomainRateLimiter } from './limiter';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);
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
    const session: PersistentSession = { context, page, navCount: 0 };
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
  ): Promise<{ html: string; status: number }> {
    const signal = options?.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    if (options?.limiter) {
      await options.limiter.acquire(domain, signal);
    }

    const session = await this.getOrCreateSession(sessionKey, options?.maxNavsBeforeRecycle ?? 150);

    try {
      const response = await session.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options?.timeoutMs ?? 25_000,
        referer: `${parsedUrl.origin}/`,
      });

      session.navCount++;
      let status = response?.status() ?? 200;

      if (options?.waitForSelector) {
        await session.page
          .waitForSelector(options.waitForSelector, { timeout: 8_000 })
          .catch(() => {});
      }

      let html = await session.page.content();

      // If Cloudflare passive JS check ("Just a moment...") is finishing, give it a brief window once
      if (
        (html.includes('<title>Just a moment...</title>') ||
          html.includes('cf-browser-verification')) &&
        !signal?.aborted
      ) {
        await abortableSleep(4_000, signal);
        html = await session.page.content();
        if (!html.includes('<title>Just a moment...</title>')) {
          status = 200;
        }
      }

      if (status >= 200 && status < 400) {
        options?.limiter?.reportSuccess(domain);
      } else if (status === 429 || status >= 500) {
        options?.limiter?.reportFailure(domain, status);
      }

      return { html, status };
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
