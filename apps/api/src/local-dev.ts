/**
 * @file apps/api/src/local-dev.ts
 * Local Bun HTTP server running the exact same `handleApiRequest` Worker logic
 * directly against `data/index/index.sqlite` with local R2 card storage,
 * optional local BGE-M3 semantic search, and dual-provider VLM env wiring.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { handleApiRequest, type ApiEnv } from './index';
import { LocalSqliteVectorSearch } from './local-vector-search';

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

function createLocalImageStore(baseDir: string) {
  return {
    async put(key: string, bytes: Uint8Array, mimeType: string): Promise<void> {
      const safeRel = key.replace(/^\/+/, '').replace(/\.\./g, '');
      const fullPath = join(baseDir, safeRel);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, bytes);
      writeFileSync(`${fullPath}.mime`, mimeType, 'utf8');
    },
    async get(key: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
      const safeRel = key.replace(/^\/+/, '').replace(/\.\./g, '');
      const fullPath = join(baseDir, safeRel);
      if (!existsSync(fullPath)) return null;
      const bytes = new Uint8Array(readFileSync(fullPath));
      const mimeType = existsSync(`${fullPath}.mime`)
        ? readFileSync(`${fullPath}.mime`, 'utf8').trim()
        : 'image/jpeg';
      return { bytes, mimeType };
    },
  };
}

function resolveGcloudBin(): string {
  return (
    process.env.GCLOUD_BIN ??
    (existsSync('/home/bast0k/google-cloud-sdk/bin/gcloud')
      ? '/home/bast0k/google-cloud-sdk/bin/gcloud'
      : 'gcloud')
  );
}

function detectGcloudProject(): string | undefined {
  try {
    const res = Bun.spawnSync([resolveGcloudBin(), 'config', 'get-value', 'project'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (res.exitCode !== 0) return undefined;
    const val = new TextDecoder().decode(res.stdout).trim();
    if (!val || val === '(unset)') return undefined;
    return val;
  } catch {
    return undefined;
  }
}

function createGcloudTokenProvider(): () => Promise<string> {
  let cachedToken = '';
  let expiresAt = 0;
  return async () => {
    if (cachedToken && Date.now() < expiresAt) return cachedToken;
    const gcloudBin = resolveGcloudBin();
    const proc = Bun.spawn([gcloudBin, 'auth', 'print-access-token'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0 || !out.trim()) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`Failed to fetch gcloud access token: ${err.trim()}`);
    }
    cachedToken = out.trim();
    expiresAt = Date.now() + 15 * 60 * 1000;
    return cachedToken;
  };
}

function ensureLocalCheckTables(db: Database): void {
  const migrationPath = resolve(import.meta.dir, '../migrations/0005_checks.sql');
  if (existsSync(migrationPath)) {
    db.run(readFileSync(migrationPath, 'utf8'));
  }
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, '../../..');
  const dbPath = process.env.INDEX_DB_PATH ?? resolve(repoRoot, 'data/index/index.sqlite');
  if (!existsSync(dbPath)) {
    console.error(`Index SQLite not found at ${dbPath}. Run "bun run backfill chunk" first.`);
    process.exit(1);
  }

  const sqlite = new Database(dbPath);
  sqlite.run('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  ensureLocalCheckTables(sqlite);

  const cfAccountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfApiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

  const localVec = new LocalSqliteVectorSearch(sqlite, {
    cfAccountId,
    cfApiToken,
    localEmbedUrl: process.env.LOCAL_EMBED_URL,
  });

  const gcpProject =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || detectGcloudProject();
  const env: ApiEnv = {
    DB: createSqliteD1Adapter(sqlite),
    VLM_PROVIDER: process.env.VLM_PROVIDER ?? 'auto',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL ?? (gcpProject ? 'gemini-3.5-flash' : 'gemini-2.5-flash'),
    GCP_PROJECT_ID: gcpProject,
    GCP_LOCATION: process.env.GCP_LOCATION ?? 'global',
    GCP_ACCESS_TOKEN: process.env.GCP_ACCESS_TOKEN,
    GET_GCP_ACCESS_TOKEN: gcpProject && !process.env.GCP_ACCESS_TOKEN ? createGcloudTokenProvider() : undefined,
    CF_ACCOUNT_ID: cfAccountId,
    CF_API_TOKEN: cfApiToken,
    WORKERS_AI_VISION_MODEL: process.env.WORKERS_AI_VISION_MODEL,
    WORKERS_AI_TEXT_MODEL: process.env.WORKERS_AI_TEXT_MODEL,
    WORKERS_AI_RERANKER_MODEL: process.env.WORKERS_AI_RERANKER_MODEL,
    LOCAL_IMAGE_STORE: createLocalImageStore(resolve(repoRoot, 'data/uploads')),
    LOCAL_SEMANTIC_SEARCH: localVec.isEnabled
      ? (q, limit) => localVec.search(q, limit)
      : undefined,
  };

  const activeVlmLabel = env.GEMINI_API_KEY
    ? `gemini-api (${env.GEMINI_MODEL})`
    : gcpProject
    ? `vertex-ai (${gcpProject}/${env.GEMINI_MODEL})`
    : cfAccountId && cfApiToken
    ? 'workers-ai'
    : 'heuristic (text-only; configure gcloud/GEMINI_API_KEY/CF_API_TOKEN for image OCR)';

  const hostname = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  Bun.serve({
    hostname,
    port,
    fetch(req) {
      return handleApiRequest(req, env);
    },
  });

  console.log(
    `Jachaikori local API listening at http://${hostname}:${port} (DB: ${dbPath} | VLM: ${activeVlmLabel} | LocalVector: ${localVec.isEnabled ? 'enabled' : 'keyword-only'})`
  );
}
