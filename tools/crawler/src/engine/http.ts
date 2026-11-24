/**
 * @file tools/crawler/src/engine/http.ts
 * Polite HTTP client with realistic browser headers, rate limiting, and signal-aware backoff.
 */

import { abortableSleep, DomainRateLimiter } from './limiter';

export interface HttpClientOptions {
  userAgent?: string;
  limiter?: DomainRateLimiter;
  maxRetries?: number;
  timeoutMs?: number;
}

const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class PoliteHttpClient {
  private userAgent: string;
  private limiter: DomainRateLimiter;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_BROWSER_UA;
    this.limiter = options.limiter ?? new DomainRateLimiter();
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  getLimiter(): DomainRateLimiter {
    return this.limiter;
  }

  /**
   * Executes a polite fetch with rate limiting, timeouts, and automatic signal-aware retries.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const callerSignal = init.signal ?? undefined;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      attempt++;
      await this.limiter.acquire(domain, callerSignal);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      const combinedSignal = callerSignal
        ? AbortSignal.any([controller.signal, callerSignal])
        : controller.signal;

      try {
        const response = await fetch(url, {
          ...init,
          signal: combinedSignal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'max-age=0',
            'Sec-CH-UA': '"Chromium";v="131", "Not_A Brand";v="24"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Linux"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            ...init.headers,
          },
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          this.limiter.reportSuccess(domain);
          return response;
        }

        // Handle 429 Too Many Requests or 5xx Server Errors
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          this.limiter.reportFailure(domain, response.status);
          if (response.status !== 429 && attempt <= this.maxRetries) {
            const backoffMs = Math.min(1500 * 2 ** (attempt - 1), 10_000);
            await abortableSleep(backoffMs, callerSignal);
            continue;
          }
        }

        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (callerSignal?.aborted) {
          throw err;
        }
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.min(1500 * 2 ** (attempt - 1), 8_000);
          await abortableSleep(backoffMs, callerSignal);
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Exceeded max retries (${this.maxRetries}) fetching ${url}`);
  }

  async fetchText(url: string, init?: RequestInit): Promise<string> {
    const res = await this.fetch(url, init);
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`) as Error & {
        status?: number;
      };
      error.status = res.status;
      throw error;
    }
    return res.text();
  }

  async fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(url, init);
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`) as Error & {
        status?: number;
      };
      error.status = res.status;
      throw error;
    }
    return res.json() as Promise<T>;
  }
}
