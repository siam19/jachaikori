/**
 * @file packages/verification/src/cache.ts
 * Deterministic versioned response cache (`sha256(inputHash|promptVersion|modelId)`)
 * supporting both in-memory testing and D1 / SQLite (`vlm_cache` table).
 */

import { sha256Hex } from './image-hash';

export interface VlmCacheEntry {
  cacheKey: string;
  provider: string;
  modelVersion: string;
  promptVersion: string;
  responseJson: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface VlmResponseCache {
  get(cacheKey: string): Promise<VlmCacheEntry | null>;
  set(entry: VlmCacheEntry): Promise<void>;
}

export async function makeVlmCacheKey(
  inputHash: string,
  promptVersion: string,
  modelId: string
): Promise<string> {
  return sha256Hex(`${inputHash}|${promptVersion}|${modelId}`);
}

export class InMemoryVlmCache implements VlmResponseCache {
  private readonly store = new Map<string, VlmCacheEntry>();

  async get(cacheKey: string): Promise<VlmCacheEntry | null> {
    return this.store.get(cacheKey) ?? null;
  }

  async set(entry: VlmCacheEntry): Promise<void> {
    this.store.set(entry.cacheKey, entry);
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Minimal structural subset of D1Database so `packages/verification` stays free
 * of `@cloudflare/workers-types` coupling while working seamlessly with D1 & SQLite adapters.
 */
export interface MinimalSqlDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

export class SqlVlmCache implements VlmResponseCache {
  constructor(private readonly db: MinimalSqlDb) {}

  async get(cacheKey: string): Promise<VlmCacheEntry | null> {
    try {
      const row = await this.db
        .prepare(
          `SELECT cache_key as cacheKey, provider, model_version as modelVersion,
                  prompt_version as promptVersion, response_json as responseJson,
                  input_tokens as inputTokens, output_tokens as outputTokens,
                  cost_usd as costUsd, created_at as createdAt
           FROM vlm_cache WHERE cache_key = ?`
        )
        .bind(cacheKey)
        .first<VlmCacheEntry>();
      return row ?? null;
    } catch {
      return null;
    }
  }

  async set(entry: VlmCacheEntry): Promise<void> {
    try {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO vlm_cache (
             cache_key, provider, model_version, prompt_version, response_json,
             input_tokens, output_tokens, cost_usd, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          entry.cacheKey,
          entry.provider,
          entry.modelVersion,
          entry.promptVersion,
          entry.responseJson,
          entry.inputTokens,
          entry.outputTokens,
          entry.costUsd,
          entry.createdAt
        )
        .run();
    } catch {
      // Cache write failure is non-fatal
    }
  }
}
