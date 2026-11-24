#!/usr/bin/env bun
/**
 * @file scripts/probe-vlm.ts
 * Sprint 6 Dual-Provider Capability Probe:
 * 1. Probes GCP Vertex AI (`gemini-3.5-flash` @ `global`) or `GEMINI_API_KEY` on a
 *    synthetic Bangla news photo card (generated PNG!) + pasted claim text.
 * 2. Probes Cloudflare Workers AI (`CF_ACCOUNT_ID` + `CF_API_TOKEN`) to discover which
 *    vision, text, embedding (`@cf/baai/bge-m3`), and reranker (`@cf/baai/bge-reranker-base`)
 *    models are accessible on the current Cloudflare account.
 * 3. Runs a live end-to-end `POST /verify` smoke check against `data/index/index.sqlite`.
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GeminiFlashAdapter,
  WorkersAiAdapter,
} from '../packages/verification/src/index';
import { createSqliteD1Adapter } from '../apps/api/src/local-dev';
import { handleApiRequest, type ApiEnv } from '../apps/api/src/index';

async function getGcloudProjectAndToken(): Promise<{ projectId: string; token: string } | null> {
  const gcloudBin =
    process.env.GCLOUD_BIN ??
    (existsSync('/home/bast0k/google-cloud-sdk/bin/gcloud')
      ? '/home/bast0k/google-cloud-sdk/bin/gcloud'
      : 'gcloud');

  try {
    const p1 = Bun.spawn([gcloudBin, 'config', 'get-value', 'project'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const projectId = (await new Response(p1.stdout).text()).trim();
    if ((await p1.exited) !== 0 || !projectId) return null;

    const p2 = Bun.spawn([gcloudBin, 'auth', 'print-access-token'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const token = (await new Response(p2.stdout).text()).trim();
    if ((await p2.exited) !== 0 || !token) return null;

    return { projectId, token };
  } catch {
    return null;
  }
}

async function probeCloudflareModels(): Promise<void> {
  const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

  console.log('\n=== 1. Cloudflare Workers AI Probe ===');
  if (!accountId || !apiToken) {
    console.log(
      '  SKIPPED: Set CF_ACCOUNT_ID and CF_API_TOKEN env vars (or run `wrangler login` + Sprint 8 binding) to probe Cloudflare Workers AI REST.'
    );
    return;
  }

  const candidateModels = [
    { role: 'embed', model: '@cf/baai/bge-m3', payload: { text: ['বাংলাদেশ ব্যাংক'] } },
    {
      role: 'rerank',
      model: '@cf/baai/bge-reranker-base',
      payload: { query: 'Bangladesh Bank governor', contexts: [{ text: 'Bangladesh Bank governor Mostakur Rahman' }] },
    },
    {
      role: 'text',
      model: '@cf/meta/llama-3.1-8b-instruct-fast',
      payload: { messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }], max_tokens: 20 },
    },
    {
      role: 'vision',
      model: '@cf/meta/llama-3.2-11b-vision-instruct',
      payload: { messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }], max_tokens: 20 },
    },
    {
      role: 'vision',
      model: '@cf/google/gemma-3-12b-it',
      payload: { messages: [{ role: 'user', content: 'Reply with JSON {"ok":true}' }], max_tokens: 20 },
    },
  ];

  for (const c of candidateModels) {
    const t0 = performance.now();
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${c.model}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(c.payload),
        }
      );
      const ms = Math.round(performance.now() - t0);
      if (res.ok) {
        console.log(`  [OK]   ${c.role.padEnd(6)} ${c.model} (${ms} ms)`);
      } else {
        const body = (await res.text()).slice(0, 140);
        console.log(`  [FAIL] ${c.role.padEnd(6)} ${c.model} -> HTTP ${res.status}: ${body}`);
      }
    } catch (err: any) {
      console.log(`  [ERR]  ${c.role.padEnd(6)} ${c.model} -> ${err?.message ?? err}`);
    }
  }
}

async function probeGeminiAndLiveVerify(): Promise<void> {
  console.log('\n=== 2. Gemini Flash (Vertex AI / API) & Live 211k POST /verify Probe ===');
  const gcloud = await getGcloudProjectAndToken();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!gcloud && !apiKey) {
    console.log('  SKIPPED: Neither gcloud auth nor GEMINI_API_KEY found.');
    return;
  }

  const adapter = new GeminiFlashAdapter(
    gcloud
      ? { vertexProjectId: gcloud.projectId, vertexLocation: 'global', vertexAccessToken: gcloud.token, model: 'gemini-3.5-flash' }
      : { apiKey, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }
  );

  const sampleBanglaClaim =
    'বাংলাদেশ ব্যাংক বিডা-নিবন্ধিত কোম্পানির জন্য বৈদেশিক ঋণ নেওয়ার নিয়ম শিথিল করেছে — প্রথম আলো';
  const t0 = performance.now();
  const ext = await adapter.extractFromText(sampleBanglaClaim);
  console.log(`  Text extraction (${Math.round(performance.now() - t0)} ms, $${ext.usage.costUsd.toFixed(6)}):`);
  console.log(' ', JSON.stringify(ext.extraction));

  const repoRoot = resolve(import.meta.dir, '..');
  const dbPath = resolve(repoRoot, 'data/index/index.sqlite');
  if (!existsSync(dbPath)) {
    console.log('  index.sqlite not found; skipping live POST /verify test.');
    return;
  }

  const sqlite = new Database(dbPath);
  sqlite.run('PRAGMA journal_mode = WAL;');
  const migPath = resolve(repoRoot, 'apps/api/migrations/0005_checks.sql');
  sqlite.run(readFileSync(migPath, 'utf8'));

  const env: ApiEnv = {
    DB: createSqliteD1Adapter(sqlite),
    VLM_PROVIDER: 'gemini',
    GCP_PROJECT_ID: gcloud?.projectId,
    GCP_LOCATION: 'global',
    GCP_ACCESS_TOKEN: gcloud?.token,
    GEMINI_API_KEY: apiKey,
    GEMINI_MODEL: gcloud ? 'gemini-3.5-flash' : 'gemini-2.5-flash',
  };

  // Run 1: Live POST /verify against 211k DB
  const r1 = await handleApiRequest(
    new Request('http://localhost/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sampleBanglaClaim, bypassCache: true }),
    }),
    env
  );
  const b1 = (await r1.json()) as any;
  console.log(
    `\n  Live POST /verify (211k DB): HTTP ${r1.status} | status=${b1.status} | latency=${b1.latencyMs}ms | cost=$${b1.costUsd} | sources=${b1.sources?.length}`
  );
  console.log('  Stage timings:', JSON.stringify(b1.stageTimingsMs));
  console.log('  Resolved entities:', (b1.resolvedEntities ?? []).map((e: any) => `${e.entityId}(${e.linkMethod})`));
  for (const s of (b1.sources ?? []).slice(0, 3)) {
    console.log(`    - [${s.rerankScore}] (${s.outlet}) ${s.title}`);
    if (s.matchSummary) console.log(`      ${s.matchSummary}`);
  }

  // Run 2: Verify exact cache hit (`hitCount` increments, `costUsd === 0`)
  const r2 = await handleApiRequest(
    new Request('http://localhost/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sampleBanglaClaim }),
    }),
    env
  );
  const b2 = (await r2.json()) as any;
  console.log(
    `  Repeat POST /verify (cache check): HTTP ${r2.status} | cacheHit=${b2.cacheHit} | hitCount=${b2.hitCount} | latency=${b2.latencyMs}ms | cost=$${b2.costUsd}`
  );

  // Run 3: Verify honest empty state (`no_coverage`) on a fictional claim
  const r3 = await handleApiRequest(
    new Request('http://localhost/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'মঙ্গল গ্রহে বাংলাদেশ রেলওয়ে বুলেট ট্রেন উদ্বোধন করেছে ২০৩৫ সালে — দৈনিক কাল্পনিক',
        bypassCache: true,
      }),
    }),
    env
  );
  const b3 = (await r3.json()) as any;
  console.log(
    `  Fictional claim POST /verify: HTTP ${r3.status} | status=${b3.status} | sources=${b3.sources?.length} | notice="${b3.emptyStateNotice?.en?.slice(0, 80)}..."`
  );

  // Optional: Live multipart JPEG photo-card upload + recompressed perceptual dHash hit
  const imgIdx = process.argv.indexOf('--image');
  const repostIdx = process.argv.indexOf('--repost-image');
  const imgPath = imgIdx >= 0 ? process.argv[imgIdx + 1] : undefined;
  const repostPath = repostIdx >= 0 ? process.argv[repostIdx + 1] : undefined;
  let imgCheckId: string | undefined;

  if (imgPath && existsSync(imgPath)) {
    const b1 = new Uint8Array(readFileSync(imgPath));
    const f1 = new FormData();
    f1.append('image', new File([b1], 'card.jpg', { type: 'image/jpeg' }));
    f1.append('bypassCache', 'true');
    const ir1 = await handleApiRequest(
      new Request('http://localhost/verify', { method: 'POST', body: f1 }),
      env
    );
    const ib1 = (await ir1.json()) as any;
    imgCheckId = ib1.id;
    console.log(
      `\n  Live IMAGE POST /verify (${imgPath}): HTTP ${ir1.status} | status=${ib1.status} | dHash=${ib1.perceptualHash} | latency=${ib1.latencyMs}ms | cost=$${ib1.costUsd} | sources=${ib1.sources?.length}`
    );
    console.log('  VLM OCR extraction:', JSON.stringify(ib1.extraction));
    for (const s of (ib1.sources ?? []).slice(0, 3)) {
      console.log(`    - [${s.rerankScore}] (${s.outlet}) ${s.title}`);
    }

    if (repostPath && existsSync(repostPath)) {
      const b2 = new Uint8Array(readFileSync(repostPath));
      const f2 = new FormData();
      f2.append('image', new File([b2], 'repost.jpg', { type: 'image/jpeg' }));
      const ir2 = await handleApiRequest(
        new Request('http://localhost/verify', { method: 'POST', body: f2 }),
        env
      );
      const ib2 = (await ir2.json()) as any;
      console.log(
        `  Recompressed JPEG POST /verify (${repostPath}): HTTP ${ir2.status} | cacheHit=${ib2.cacheHit} | matchedId=${ib2.id === ib1.id} | hitCount=${ib2.hitCount} | latency=${ib2.latencyMs}ms | cost=$${ib2.costUsd}`
      );
    }
  }

  // Clean up probe rows from local index.sqlite so production DB stays pristine
  for (const id of [b1.id, b3.id, imgCheckId].filter(Boolean)) {
    sqlite.prepare('DELETE FROM verification_check WHERE id = ?').run(id);
  }
  sqlite.close();
}

await probeCloudflareModels();
await probeGeminiAndLiveVerify();
