/**
 * @file apps/api/src/local-dev.ts
 * Local Bun HTTP server running the exact same `handleApiRequest` Worker logic
 * directly against `data/index/index.sqlite` (no Cloudflare login required).
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleApiRequest, type ApiEnv } from './index';

export function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let bound: unknown[] = [];

      const prepared: any = {
        bind(...values: unknown[]) {
          bound = values;
          return prepared;
        },
        async first<T = unknown>() {
          return (stmt.get(...(bound as any[])) as T) ?? null;
        },
        async all<T = unknown>() {
          const results = stmt.all(...(bound as any[])) as T[];
          return { results, success: true, meta: {} };
        },
        async run() {
          const info = stmt.run(...(bound as any[]));
          return { success: true, meta: { changes: info.changes } };
        },
      };
      return prepared;
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((s) => s.all()));
    },
    async exec(sql: string) {
      db.run(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

if (import.meta.main) {
  const dbPath =
    process.env.INDEX_DB_PATH ??
    resolve(import.meta.dir, '../../../data/index/index.sqlite');
  if (!existsSync(dbPath)) {
    console.error(`Index SQLite not found at ${dbPath}. Run "bun run backfill chunk" first.`);
    process.exit(1);
  }

  const sqlite = new Database(dbPath, { readonly: true });
  const env: ApiEnv = {
    DB: createSqliteD1Adapter(sqlite),
  };

  const hostname = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  Bun.serve({
    hostname,
    port,
    fetch(req) {
      return handleApiRequest(req, env);
    },
  });

  console.log(`Jachaikori local API listening at http://${hostname}:${port} (DB: ${dbPath})`);
}
