/**
 * @file tools/crawler/src/engine/browser.ts
 * Lightweight Playwright browser orchestration with resource blocking (images, fonts, ads).
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);
const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.net',
];

export class BrowserPool {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    }
    return this.browser;
  }

  /**
   * Creates an optimized Page that blocks bandwidth-heavy assets and trackers.
   */
  async createPolitePage(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale: 'bn-BD',
      timezoneId: 'Asia/Dhaka',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // Block unnecessary assets
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
   * Fetches rendered HTML using a lightweight headless browser page.
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
      });

      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10_000 }).catch(() => {});
      }

      return await page.content();
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
