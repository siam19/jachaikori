#!/usr/bin/env bun
/**
 * @file scripts/probe-diff.ts
 * Sprint 7 Live 211k Claim-Level Diff & Event Coverage Comparison Smoke Benchmark:
 * 1. Tests deliberately distorted Bangla/English claims against `data/index/index.sqlite`
 *    (altered currency figure, omitted "গুজব" denial context, recycled date) via live
 *    Vertex AI `gemini-3.5-flash` (`thinkingLevel: 'MINIMAL'`) + deterministic comparators.
 * 2. Tests live `GET /events/:id/comparison` and `GET /articles/:id/claims` on a real
 *    multi-outlet event cluster from our 211k corpus.
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSqliteD1Adapter } from '../apps/api/src/local-dev';
import { handleApiRequest, type ApiEnv } from '../apps/api/src/index';

async function getGcloudCreds(): Promise<{ projectId: string; token: string } | null> {
  const gcloudBin =
    process.env.GCLOUD_BIN ??
    (existsSync('/home/bast0k/google-cloud-sdk/bin/gcloud')
      ? '/home/bast0k/google-cloud-sdk/bin/gcloud'
      : 'gcloud');
  try {
    const p1 = Bun.spawn([gcloudBin, 'config', 'get-value', 'project'], { stdout: 'pipe', stderr: 'pipe' });
    const projectId = (await new Response(p1.stdout).text()).trim();
    if ((await p1.exited) !== 0 || !projectId) return null;
    const p2 = Bun.spawn([gcloudBin, 'auth', 'print-access-token'], { stdout: 'pipe', stderr: 'pipe' });
    const token = (await new Response(p2.stdout).text()).trim();
    if ((await p2.exited) !== 0 || !token) return null;
    return { projectId, token };
  } catch {
    return null;
  }
}

const repoRoot = resolve(import.meta.dir, '..');
const dbPath = resolve(repoRoot, 'data/index/index.sqlite');
const sqlite = new Database(dbPath);
sqlite.run('PRAGMA journal_mode = WAL;');
sqlite.run(readFileSync(resolve(repoRoot, 'apps/api/migrations/0005_checks.sql'), 'utf8'));

const gcloud = await getGcloudCreds();
const env: ApiEnv = {
  DB: createSqliteD1Adapter(sqlite),
  VLM_PROVIDER: gcloud ? 'gemini' : 'auto',
  GCP_PROJECT_ID: gcloud?.projectId,
  GCP_LOCATION: 'global',
  GCP_ACCESS_TOKEN: gcloud?.token,
  GEMINI_MODEL: 'gemini-3.5-flash',
};

console.log(`=== Sprint 7 Live Diff & Comparison Probe (Provider: ${gcloud ? 'gemini-3.5-flash @ Vertex' : 'heuristic'}) ===`);

// 1. Live Event Coverage Comparison on a rich 5+ outlet cluster with Stage B claims
const richCluster = sqlite
  .prepare(
    `SELECT ec.id, ec.label, ec.outlet_count, COUNT(c.id) as claimCount
     FROM event_cluster ec
     JOIN article_cluster ac ON ac.cluster_id = ec.id
     JOIN claim c ON c.article_id = ac.article_id
     WHERE ec.outlet_count >= 5 AND c.numbers_json IS NOT NULL
     GROUP BY ec.id
     ORDER BY claimCount DESC
     LIMIT 1`
  )
  .get() as { id: string; label: string; outlet_count: number; claimCount: number };

const tComp = performance.now();
const compRes = await handleApiRequest(new Request(`http://localhost/events/${richCluster.id}/comparison`), env);
const comp = (await compRes.json()) as any;
console.log(
  `\n1) GET /events/${richCluster.id}/comparison (${Math.round(performance.now() - tComp)} ms, HTTP ${compRes.status}):`
);
console.log(`   Event: "${comp.event.label}" (${comp.event.outletCount} outlets, ${comp.totalClaimsAnalyzed} claims)`);
console.log(
  `   First to publish: ${comp.firstToPublish?.outlet} @ ${comp.firstToPublish?.publishedAt} ("${comp.firstToPublish?.title?.slice(0, 65)}")`
);
console.log(
  '   Coverage matrix:',
  comp.outletCoverage.map((o: any) => `${o.outlet}:${o.covered ? `+${o.lagMinutesFromFirst ?? 0}m(${o.claims.length}c)` : 'no'}`).join(' | ')
);
console.log('   Cross-outlet differences:', comp.crossOutletDifferences.length);
for (const d of comp.crossOutletDifferences.slice(0, 3)) {
  console.log(`     - [${d.kind}] ${d.summaryEn}`);
}

// 2. Live GET /articles/:id/claims
const sampleArtId = comp.firstToPublish?.articleId;
if (sampleArtId) {
  const clmRes = await handleApiRequest(new Request(`http://localhost/articles/${sampleArtId}/claims`), env);
  const clm = (await clmRes.json()) as any;
  console.log(`\n2) GET /articles/${sampleArtId}/claims: HTTP ${clmRes.status} | claims=${clm.claims?.length}`);
}

// 3. Deliberately distorted Bangla photo-card claims through live POST /verify
const distortedCases = [
  {
    name: 'Altered Number Distortion (Tk 3 crore -> Tk 30 crore Christmas grant)',
    text: 'বড়দিন উপলক্ষে খ্রিস্টান সম্প্রদায়ের জন্য ৩০ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান — প্রথম আলো',
  },
  {
    name: 'Omitted Denial Context (stripped "গুজব" from BNP resignation denial)',
    text: 'বিএনপির একাধিক সিনিয়র নেতার পদত্যাগ নিশ্চিত হয়েছে — ১৮ নভেম্বর ২০২৬',
  },
];

const createdCheckIds: string[] = [];
for (const tc of distortedCases) {
  const res = await handleApiRequest(
    new Request('http://localhost/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: tc.text, bypassCache: true }),
    }),
    env
  );
  const body = (await res.json()) as any;
  if (body.id) createdCheckIds.push(body.id);
  console.log(`\n3) ${tc.name}:`);
  console.log(
    `   HTTP ${res.status} | status=${body.status} | overallDiff=${body.overallDiffStatus} | latency=${body.latencyMs}ms (diffMs=${body.stageTimingsMs?.diffMs}) | cost=$${body.costUsd}`
  );
  console.log(`   Overall summary EN: ${body.overallDiffSummary?.en}`);
  for (const s of (body.sources ?? []).slice(0, 2)) {
    console.log(`   - [${s.rerankScore}] (${s.outlet}) ${s.title}`);
    console.log(`     flags=${JSON.stringify(s.diffFlags)} | claimsUsed=${s.articleClaimsCount}`);
    for (const d of (s.diffs ?? []).slice(0, 2)) {
      console.log(`       * [${d.flag}${d.deterministic ? ', det' : ', llm'}] ${d.explanationEn}`);
    }
  }
}

for (const id of createdCheckIds) {
  sqlite.prepare('DELETE FROM verification_check WHERE id = ?').run(id);
}
sqlite.close();
