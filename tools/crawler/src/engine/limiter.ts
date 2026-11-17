/**
 * @file tools/crawler/src/engine/limiter.ts
 * Concurrency-safe, signal-aware per-domain polite rate limiter with jitter and cooldowns.
 */

export interface RateLimiterOptions {
  baseDelayMs?: number;
  minJitterMs?: number;
  jitterMs?: number;
  maxConsecutiveErrors?: number;
}

/**
 * Sleeps for `ms` milliseconds, rejecting immediately with AbortError if `signal` aborts.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class DomainRateLimiter {
  private nextSlotTimes = new Map<string, number>(); // domain -> earliest next timestamp
  private consecutiveErrors = new Map<string, number>();
  private circuitOpenDomains = new Map<string, number>(); // domain -> openUntil timestamp
  private domainDelays = new Map<string, number>(); // domain -> specific base delay in ms

  private baseDelayMs: number;
  private minJitterMs: number;
  private jitterMs: number;
  private maxConsecutiveErrors: number;

  constructor(options: RateLimiterOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.minJitterMs = options.minJitterMs ?? 0;
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
   * Returns remaining rate-limit wait time in ms for a domain (0 if ready immediately).
   */
  getWaitRemainingMs(domain: string): number {
    const nextSlot = this.nextSlotTimes.get(domain) ?? 0;
    return Math.max(0, nextSlot - Date.now());
  }

  /**
   * Returns remaining circuit-breaker / cooldown pause in ms (0 if not cooling down).
   */
  getCooldownRemainingMs(domain: string): number {
    const openUntil = this.circuitOpenDomains.get(domain) ?? 0;
    return Math.max(0, openUntil - Date.now());
  }

  /**
   * Explicitly puts a domain into a polite cooldown window (e.g. on 429 or WAF challenge).
   */
  tripCooldown(domain: string, durationMs: number): void {
    const until = Date.now() + durationMs;
    const existing = this.circuitOpenDomains.get(domain) ?? 0;
    if (until > existing) {
      this.circuitOpenDomains.set(domain, until);
    }
  }

  /**
   * Atomically reserves the next polite time slot for `domain` and waits until that slot arrives.
   * Respects `signal` so Ctrl+C cancels pending waits immediately.
   */
  async acquire(domain: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const now = Date.now();
    const openUntil = this.circuitOpenDomains.get(domain);
    if (openUntil && openUntil > now) {
      const waitSec = Math.ceil((openUntil - now) / 1000);
      throw new Error(
        `Circuit breaker open for "${domain}". Paused for ${waitSec}s due to consecutive server errors.`
      );
    }

    const scheduledAt = Math.max(now, this.nextSlotTimes.get(domain) ?? now);
    const domainDelay = this.domainDelays.get(domain) ?? this.baseDelayMs;
    const jitterSpan = Math.max(0, this.jitterMs - this.minJitterMs);
    const jitter = this.minJitterMs + Math.floor(Math.random() * (jitterSpan + 1));

    // Reserve next slot atomically before awaiting so concurrent callers serialize cleanly
    this.nextSlotTimes.set(domain, scheduledAt + domainDelay + jitter);

    const waitTime = scheduledAt - now;
    if (waitTime > 0) {
      await abortableSleep(waitTime, signal);
    }
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
      const pauseDuration = status === 429 ? 65_000 : 30_000;
      this.tripCooldown(domain, pauseDuration);
    }
  }

  /**
   * Checks if domain circuit breaker is currently tripped.
   */
  isBlocked(domain: string): boolean {
    return this.getCooldownRemainingMs(domain) > 0;
  }
}
