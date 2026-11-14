/**
 * @file tools/crawler/src/engine/http.ts
 * Polite HTTP client with exponential backoff, rate limiting, and transparent error handling.
 */

import { DomainRateLimiter } from './limiter';

export interface HttpClientOptions {
  userAgent?: string;
  limiter?: DomainRateLimiter;
  maxRetries?: number;
  timeoutMs?: number;
}

export class PoliteHttpClient {
  private userAgent: string;
  private limiter: DomainRateLimiter;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    this.userAgent =
      options.userAgent ??
      'Jachaikori-Crawler/1.0 (+https://github.com/jachaikori/jachaikori; contact: research@jachaikori.org)';
    this.limiter = options.limiter ?? new DomainRateLimiter();
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Executes a polite fetch with rate limiting, timeouts, and automatic retries.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const domain = new URL(url).hostname;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      attempt++;
      await this.limiter.acquire(domain);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      const combinedSignal = init.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal;

      try {
        const response = await fetch(url, {
          ...init,
          signal: combinedSignal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
            'Accept-Language': 'bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7',
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
          if (attempt <= this.maxRetries) {
            const backoffMs = Math.min(1000 * 2 ** attempt, 10_000);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
        }

        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (init.signal?.aborted) {
          throw err;
        }
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise((r) => setTimeout(r, backoffMs));
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
      throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    }
    return res.text();
  }

  async fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(url, init);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    }
    return res.json() as Promise<T>;
  }
}
