/**
 * @file tools/crawler/src/engine/limiter.ts
 * Per-domain polite rate limiter with random jitter and circuit breaker protection.
 */

export interface RateLimiterOptions {
  baseDelayMs?: number;
  jitterMs?: number;
  maxConsecutiveErrors?: number;
}

export class DomainRateLimiter {
  private lastRequestTimes = new Map<string, number>();
  private consecutiveErrors = new Map<string, number>();
  private circuitOpenDomains = new Map<string, number>(); // domain -> openUntil timestamp
  private domainDelays = new Map<string, number>(); // domain -> specific base delay in ms

  private baseDelayMs: number;
  private jitterMs: number;
  private maxConsecutiveErrors: number;

  constructor(options: RateLimiterOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.jitterMs = options.jitterMs ?? 500;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 5;
  }

  /**
   * Overrides base delay for a specific domain (e.g. from outlet policy).
   */
  setDomainDelay(domain: string, delayMs: number): void {
    this.domainDelays.set(domain, delayMs);
  }

  /**
   * Retrieves configured delay for a domain or default base delay.
   */
  getDomainDelay(domain: string): number {
    return this.domainDelays.get(domain) ?? this.baseDelayMs;
  }

  /**
   * Waits for the domain-specific delay and checks circuit breaker.
   */
  async acquire(domain: string): Promise<void> {
    const now = Date.now();
    const openUntil = this.circuitOpenDomains.get(domain);
    if (openUntil && openUntil > now) {
      const waitSec = Math.ceil((openUntil - now) / 1000);
      throw new Error(`Circuit breaker open for "${domain}". Paused for ${waitSec}s due to consecutive server errors.`);
    }

    const lastTime = this.lastRequestTimes.get(domain) ?? 0;
    const jitter = Math.floor(Math.random() * this.jitterMs);
    const domainDelay = this.domainDelays.get(domain) ?? this.baseDelayMs;
    const requiredDelay = domainDelay + jitter;
    const elapsed = now - lastTime;

    if (elapsed < requiredDelay) {
      const waitTime = requiredDelay - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTimes.set(domain, Date.now());
  }

  /**
   * Reports a successful request to reset error counters.
   */
  reportSuccess(domain: string): void {
    this.consecutiveErrors.delete(domain);
    this.circuitOpenDomains.delete(domain);
  }

  /**
   * Reports a failure (429 or 5xx). If failures exceed threshold, trips circuit breaker.
   */
  reportFailure(domain: string, status?: number): void {
    const current = (this.consecutiveErrors.get(domain) ?? 0) + 1;
    this.consecutiveErrors.set(domain, current);

    // Trip circuit breaker if 429 (Too Many Requests) or too many consecutive 5xx errors
    if (status === 429 || current >= this.maxConsecutiveErrors) {
      const pauseDuration = status === 429 ? 60_000 : 30_000; // 60s for 429, 30s for 5xx
      this.circuitOpenDomains.set(domain, Date.now() + pauseDuration);
    }
  }

  /**
   * Checks if domain circuit breaker is currently tripped.
   */
  isBlocked(domain: string): boolean {
    const openUntil = this.circuitOpenDomains.get(domain);
    return Boolean(openUntil && openUntil > Date.now());
  }
}
