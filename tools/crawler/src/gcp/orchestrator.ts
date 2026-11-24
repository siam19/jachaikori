/**
 * @file tools/crawler/src/gcp/orchestrator.ts
 * Local orchestrator for coordinated GCP Cloud Run Jobs scraping:
 * - Exports non-skipped 'discovered' articles into outlet chunks
 * - Launches simultaneous HTTP & Playwright Cloud Run Jobs (--async)
 * - Displays live progress across all running jobs/tasks (safe to Ctrl+C and re-attach)
 * - Automatically downloads & imports results into data/catalog.sqlite on completion
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutletId } from '@jachaikori/schema';
import color from 'picocolors';
import { CatalogDatabase } from '../engine/catalog';
import { PLAYWRIGHT_NATIVE_OUTLETS } from '../engine/scraper';
import { GcsClient } from './gcs';
import type {
  DoneMarker,
  LatestRunPointer,
  ScrapeChunkItem,
  ScrapeChunkMeta,
  ScrapeJobRef,
  ScrapeResultRecord,
  ScrapeRunManifest,
  TaskHeartbeat,
} from './types';

export interface GcpScrapeOptions {
  projectId: string;
  region: string;
  bucket: string;
  httpJobName: string;
  browserJobName: string;
  httpTasks: number;
  browserTasks: number;
  chunkSize: number;
  retryFailed?: boolean;
  outlets?: OutletId[];
  excludeOutlets?: OutletId[];
  forceNew?: boolean;
  detach?: boolean;
  pollIntervalMs?: number;
  dbPath?: string;
}

interface ExecStatus {
  name: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  taskCount: number;
}

async function runCmd(
  args: string[],
  options: { inheritStderr?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: options.inheritStderr ? 'inherit' : 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = options.inheritStderr ? '' : await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function getExecutionStatus(
  projectId: string,
  region: string,
  executionName: string | null
): Promise<ExecStatus | null> {
  if (!executionName) return null;
  const res = await runCmd([
    'gcloud',
    'run',
    'jobs',
    'executions',
    'describe',
    executionName,
    '--project',
    projectId,
    '--region',
    region,
    '--format=json',
  ]);
  if (res.exitCode !== 0 || !res.stdout.trim()) {
    return {
      name: executionName,
      state: 'UNKNOWN',
      runningCount: 0,
      succeededCount: 0,
      failedCount: 0,
      taskCount: 0,
    };
  }
  try {
    const data = JSON.parse(res.stdout) as any;
    const conditions: Array<{ type: string; status: string }> = data.status?.conditions ?? [];
    const completedCond = conditions.find((c) => c.type === 'Completed');
    let state: ExecStatus['state'] = 'RUNNING';
    if (completedCond?.status === 'True') {
      state = (data.status?.failedCount ?? 0) > 0 ? 'FAILED' : 'SUCCEEDED';
    } else if (completedCond?.status === 'False' && data.status?.completionTime) {
      state = 'FAILED';
    }
    if (data.metadata?.deletionTimestamp) {
      state = 'CANCELLED';
    }
    return {
      name: executionName,
      state,
      runningCount: Number(data.status?.runningCount ?? 0),
      succeededCount: Number(data.status?.succeededCount ?? 0),
      failedCount: Number(data.status?.failedCount ?? 0),
      taskCount: Number(data.spec?.taskCount ?? 0),
    };
  } catch {
    return {
      name: executionName,
      state: 'UNKNOWN',
      runningCount: 0,
      succeededCount: 0,
      failedCount: 0,
      taskCount: 0,
    };
  }
}

async function launchJobAsync(
  projectId: string,
  region: string,
  jobName: string,
  runId: string,
  tasks: number
): Promise<string> {
  const res = await runCmd([
    'gcloud',
    'run',
    'jobs',
    'execute',
    jobName,
    '--project',
    projectId,
    '--region',
    region,
    '--tasks',
    String(tasks),
    '--update-env-vars',
    `RUN_ID=${runId}`,
    '--async',
    '--format=json',
  ]);
  if (res.exitCode !== 0) {
    throw new Error(`Failed executing Cloud Run Job ${jobName}: ${res.stderr}`);
  }
  const parsed = JSON.parse(res.stdout) as any;
  const fullName: string = parsed.metadata?.name ?? '';
  if (!fullName) {
    throw new Error(`Unexpected gcloud execute output for ${jobName}: ${res.stdout}`);
  }
  return fullName;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function makeBar(fraction: number, width = 28): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}

export async function runGcpScrapeOrchestrator(options: GcpScrapeOptions): Promise<void> {
  const {
    projectId,
    region,
    bucket,
    httpJobName,
    browserJobName,
    httpTasks,
    browserTasks,
    chunkSize,
    retryFailed = false,
    outlets,
    excludeOutlets,
    forceNew = false,
    detach = false,
    pollIntervalMs = 5000,
    dbPath,
  } = options;

  const gcs = new GcsClient({ authMode: 'gcloud' });
  const latestPath = 'scrape-runs/latest.json';

  let latest = await gcs.getObjectJson<LatestRunPointer>(bucket, latestPath);
  let manifest: ScrapeRunManifest | null = null;

  if (latest && !latest.imported && !forceNew) {
    manifest = await gcs.getObjectJson<ScrapeRunManifest>(
      bucket,
      `scrape-runs/${latest.runId}/manifest.json`
    );
    if (manifest) {
      console.log(
        color.cyan(
          `\nResuming monitor for active GCP run ${color.bold(manifest.runId)} (${manifest.totalArticles.toLocaleString()} articles across ${manifest.totalChunks} chunks)`
        )
      );
    }
  }

  if (!manifest) {
    const catalog = new CatalogDatabase(dbPath);
    const counts = catalog.getStatusCounts();
    const rawPending = catalog.getPendingArticlesForGcpExport({ retryFailed, outlets });
    catalog.close();

    const excludedSet = new Set(excludeOutlets ?? []);
    const pending =
      excludedSet.size > 0 ? rawPending.filter((row) => !excludedSet.has(row.outlet)) : rawPending;

    const skippedCount = counts['skipped'] ?? 0;
    const extractedCount = counts['extracted'] ?? 0;

    console.log(color.bold('\nCatalog export summary:'));
    console.log(`  Eligible to scrape : ${color.green(pending.length.toLocaleString())}`);
    console.log(`  Excluded (skipped) : ${color.yellow(skippedCount.toLocaleString())}`);
    console.log(`  Excluded (extracted): ${color.dim(extractedCount.toLocaleString())}`);

    if (pending.length === 0) {
      console.log(color.green('\nNo pending articles to scrape. Exiting.'));
      return;
    }

    const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const runPrefix = `scrape-runs/${runId}`;
    const stagingDir = join('data', 'gcp-staging', runId);
    const chunksDir = join(stagingDir, 'chunks');
    mkdirSync(chunksDir, { recursive: true });

    // Group by outlet and split into chunkSize JSONL files
    const byOutlet = new Map<OutletId, ScrapeChunkItem[]>();
    for (const row of pending) {
      const list = byOutlet.get(row.outlet) ?? [];
      list.push(row);
      byOutlet.set(row.outlet, list);
    }

    const chunks: ScrapeChunkMeta[] = [];
    for (const [outletId, rows] of byOutlet.entries()) {
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const seq = String(Math.floor(i / chunkSize)).padStart(4, '0');
        const chunkId = `${outletId}-${seq}`;
        const localPath = join(chunksDir, `${chunkId}.jsonl`);
        const objectPath = `${runPrefix}/chunks/${chunkId}.jsonl`;
        writeFileSync(localPath, slice.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        chunks.push({
          chunkId,
          outlet: outletId,
          count: slice.length,
          objectPath,
        });
      }
    }

    const httpChunkCount = chunks.filter((c) => !PLAYWRIGHT_NATIVE_OUTLETS.has(c.outlet)).length;
    const browserChunkCount = chunks.filter((c) => PLAYWRIGHT_NATIVE_OUTLETS.has(c.outlet)).length;

    manifest = {
      runId,
      createdAt: new Date().toISOString(),
      bucket,
      chunkSize,
      totalArticles: pending.length,
      totalChunks: chunks.length,
      excludedSkipped: skippedCount,
      excludedExtracted: extractedCount,
      retryFailed,
      chunks,
    };

    writeFileSync(join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log(
      color.cyan(
        `\nUploading ${chunks.length} chunks (${httpChunkCount} HTTP, ${browserChunkCount} browser) to gs://${bucket}/${runPrefix}/...`
      )
    );

    const uploadRes = await runCmd(
      [
        'gcloud',
        'storage',
        'cp',
        '-r',
        chunksDir,
        `gs://${bucket}/${runPrefix}/`,
        `--project=${projectId}`,
      ],
      { inheritStderr: true }
    );
    if (uploadRes.exitCode !== 0) {
      throw new Error('Failed uploading chunks to GCS');
    }

    const jobs: NonNullable<ScrapeRunManifest['jobs']> = {};
    if (httpChunkCount > 0) {
      const effectiveTasks = Math.min(httpTasks, httpChunkCount);
      console.log(
        color.cyan(`Launching ${httpJobName} with ${effectiveTasks} concurrent tasks (--async)...`)
      );
      const execName = await launchJobAsync(projectId, region, httpJobName, runId, effectiveTasks);
      jobs.http = { jobName: httpJobName, executionName: execName, tasks: effectiveTasks };
    }
    if (browserChunkCount > 0) {
      const effectiveTasks = Math.min(browserTasks, browserChunkCount);
      console.log(
        color.cyan(`Launching ${browserJobName} with ${effectiveTasks} concurrent tasks (--async)...`)
      );
      const execName = await launchJobAsync(projectId, region, browserJobName, runId, effectiveTasks);
      jobs.browser = { jobName: browserJobName, executionName: execName, tasks: effectiveTasks };
    }

    manifest.jobs = jobs;
    await gcs.putObjectJson(bucket, `${runPrefix}/manifest.json`, manifest);

    latest = {
      runId,
      bucket,
      createdAt: manifest.createdAt,
      imported: false,
    };
    await gcs.putObjectJson(bucket, latestPath, latest);

    // Clean up local staging directory once uploaded
    rmSync(stagingDir, { recursive: true, force: true });
  }

  if (detach) {
    console.log(
      color.green(
        `\nLaunched GCP run ${manifest.runId} in background (${manifest.totalArticles.toLocaleString()} articles, ${manifest.totalChunks} chunks). Re-run without --detach to watch live progress and import results.`
      )
    );
    return;
  }

  // Live monitoring loop (Ctrl+C detaches cleanly without stopping GCP jobs)
  const runPrefix = `scrape-runs/${manifest.runId}`;
  let detached = false;
  const onSigint = () => {
    detached = true;
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);

  const monitorStartedAt = Date.now();
  let baselineDoneArticles: number | null = null;

  console.log(
    color.dim('\nMonitoring GCP progress (Ctrl+C detaches safely; jobs continue running in GCP)...\n')
  );

  while (!detached) {
    const [doneObjs, hbObjs, leaseObjs, httpExec, browserExec] = await Promise.all([
      gcs.listObjects(bucket, `${runPrefix}/done/`),
      gcs.listObjects(bucket, `${runPrefix}/heartbeats/`),
      gcs.listObjects(bucket, `${runPrefix}/leases/`),
      getExecutionStatus(projectId, region, manifest.jobs?.http?.executionName ?? null),
      getExecutionStatus(projectId, region, manifest.jobs?.browser?.executionName ?? null),
    ]);

    const doneMarkers = await Promise.all(
      doneObjs.map((o) => gcs.getObjectJson<DoneMarker>(bucket, o.name))
    );
    const heartbeats = (
      await Promise.all(hbObjs.map((o) => gcs.getObjectJson<TaskHeartbeat>(bucket, o.name)))
    ).filter((h): h is TaskHeartbeat => h !== null);

    let doneScraped = 0;
    let doneFailed = 0;
    const doneChunkIds = new Set<string>();
    const doneByOutlet = new Map<OutletId, number>();

    for (const m of doneMarkers) {
      if (!m) continue;
      doneChunkIds.add(m.chunkId);
      doneScraped += m.scraped;
      doneFailed += m.failed;
      doneByOutlet.set(m.outlet, (doneByOutlet.get(m.outlet) ?? 0) + 1);
    }

    // Add in-flight progress from active heartbeats
    let inflightProcessed = 0;
    for (const hb of heartbeats) {
      if (hb.status === 'running' && hb.currentChunkId && !doneChunkIds.has(hb.currentChunkId)) {
        inflightProcessed += hb.chunkDone;
      }
    }

    const totalCompletedArticles = doneScraped + doneFailed + inflightProcessed;
    if (baselineDoneArticles === null) {
      baselineDoneArticles = totalCompletedArticles;
    }
    const elapsedMonitorMs = Math.max(1000, Date.now() - monitorStartedAt);
    const deltaArticles = Math.max(0, totalCompletedArticles - baselineDoneArticles);
    const ratePerMin = (deltaArticles / elapsedMonitorMs) * 60_000;
    const remainingArticles = Math.max(0, manifest.totalArticles - totalCompletedArticles);
    const etaMs = ratePerMin > 1 ? (remainingArticles / ratePerMin) * 60_000 : 0;

    const totalByOutlet = new Map<OutletId, number>();
    for (const c of manifest.chunks) {
      totalByOutlet.set(c.outlet, (totalByOutlet.get(c.outlet) ?? 0) + 1);
    }

    const lines: string[] = [];
    const frac = manifest.totalChunks > 0 ? doneChunkIds.size / manifest.totalChunks : 1;
    lines.push(
      `${color.bold(color.cyan(`GCP Scrape Run ${manifest.runId}`))}  ${color.dim(`elapsed ${formatDuration(Date.now() - Date.parse(manifest.createdAt))}`)}`
    );
    lines.push(
      `${makeBar(frac)} ${(frac * 100).toFixed(1)}%  Chunks: ${doneChunkIds.size}/${manifest.totalChunks}  Active leases: ${leaseObjs.length}`
    );
    lines.push(
      `Articles: ${color.green(`${doneScraped.toLocaleString()} scraped`)} | ${color.red(`${doneFailed.toLocaleString()} failed`)} | ${color.cyan(`~${inflightProcessed.toLocaleString()} in-flight`)} | ${remainingArticles.toLocaleString()} left` +
        (ratePerMin > 1 ? ` | ${ratePerMin.toFixed(0)} art/min | ETA ${formatDuration(etaMs)}` : '')
    );
    lines.push('');

    if (httpExec) {
      lines.push(
        `  HTTP Job   (${httpExec.name.split('/').pop()}): ${color.bold(httpExec.state)}  running=${httpExec.runningCount} done=${httpExec.succeededCount}/${httpExec.taskCount} failed=${httpExec.failedCount}`
      );
    }
    if (browserExec) {
      lines.push(
        `  Browser Job(${browserExec.name.split('/').pop()}): ${color.bold(browserExec.state)}  running=${browserExec.runningCount} done=${browserExec.succeededCount}/${browserExec.taskCount} failed=${browserExec.failedCount}`
      );
    }

    lines.push('');
    lines.push(color.bold('Outlets (chunks done/total):'));
    const outletSummary = Array.from(totalByOutlet.entries())
      .map(([out, tot]) => `${out}: ${doneByOutlet.get(out) ?? 0}/${tot}`)
      .join('  |  ');
    lines.push(`  ${outletSummary}`);

    const activeHbs = heartbeats
      .filter((h) => h.status === 'running')
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .slice(0, 16);

    if (activeHbs.length > 0) {
      lines.push('');
      lines.push(color.bold(`Active Workers (${activeHbs.length} shown):`));
      for (const hb of activeHbs) {
        const ageSec = Math.max(0, Math.round((Date.now() - Date.parse(hb.updatedAt)) / 1000));
        lines.push(
          `  ${hb.workerId.padEnd(32)} ${String(hb.currentOutlet ?? '-').padEnd(20)} ${String(hb.currentChunkId ?? '-').padEnd(24)} ${hb.chunkDone}/${hb.chunkTotal}  (${ageSec}s ago)`
        );
      }
    }

    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n') + '\n');
    } else {
      console.log(lines.slice(0, 5).join('\n'));
    }

    const allChunksDone = doneChunkIds.size >= manifest.totalChunks;
    const httpFinished = !httpExec || (httpExec.state !== 'RUNNING' && httpExec.state !== 'UNKNOWN');
    const browserFinished =
      !browserExec || (browserExec.state !== 'RUNNING' && browserExec.state !== 'UNKNOWN');

    if (allChunksDone || (httpFinished && browserFinished)) {
      break;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigint);

  if (detached) {
    console.log(
      color.yellow(
        `\nDetached from live monitor. GCP jobs for run ${manifest.runId} are still running.\nRe-run this script anytime to check progress and import results when finished.`
      )
    );
    return;
  }

  // Download results/*.jsonl and import into local data/catalog.sqlite
  const localResultsDir = join('data', 'gcp-results', manifest.runId);
  mkdirSync(localResultsDir, { recursive: true });

  console.log(color.cyan(`\nDownloading results from gs://${bucket}/${runPrefix}/results/ ...`));
  const dlRes = await runCmd(
    [
      'gcloud',
      'storage',
      'cp',
      '-r',
      `gs://${bucket}/${runPrefix}/results/*`,
      localResultsDir,
      `--project=${projectId}`,
    ],
    { inheritStderr: true }
  );

  if (dlRes.exitCode !== 0) {
    console.warn(color.yellow('Warning: Some or no result files could be downloaded.'));
  }

  const files = readdirSync(localResultsDir).filter((f) => f.endsWith('.jsonl'));
  const records: ScrapeResultRecord[] = [];
  for (const file of files) {
    const raw = readFileSync(join(localResultsDir, file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as ScrapeResultRecord);
      } catch {
        // skip malformed line
      }
    }
  }

  console.log(color.cyan(`Importing ${records.length.toLocaleString()} scraped records into ${dbPath}...`));
  const catalog = new CatalogDatabase(dbPath);
  const imported = catalog.importGcpResults(records);
  catalog.close();

  await gcs.putObjectJson(bucket, latestPath, {
    runId: manifest.runId,
    bucket,
    createdAt: manifest.createdAt,
    imported: true,
    importedAt: new Date().toISOString(),
  } satisfies LatestRunPointer);

  console.log(color.green('\nGCP scrape import complete!'));
  console.log(`  Extracted updated       : ${color.green(imported.extracted.toLocaleString())}`);
  console.log(`  Failed updated          : ${color.red(imported.failed.toLocaleString())}`);
  console.log(
    `  Blocked left discovered : ${color.yellow(imported.blockedLeftDiscovered.toLocaleString())}`
  );
  console.log(`  Skipped preserved       : ${color.yellow(imported.skippedPreserved.toLocaleString())}`);
}

export interface GcpInspectOptions {
  bucket?: string;
  runId?: string;
  outlet?: OutletId;
  samplesPerOutlet?: number;
  maxFiles?: number;
}

/**
 * Inspects partial or completed GCP scrape results directly from GCS (safe to run mid-job)
 * to verify extracted article quality, success rate per outlet, and top failure reasons.
 */
export async function inspectGcpScrapeResults(options: GcpInspectOptions = {}): Promise<void> {
  const gcs = new GcsClient({ authMode: 'gcloud' });

  let bucket = options.bucket;
  if (!bucket) {
    const proj = await runCmd(['gcloud', 'config', 'get-value', 'project']);
    const projectId = process.env.GCP_PROJECT_ID || proj.stdout.trim();
    if (!projectId || projectId === '(unset)') {
      throw new Error('Pass --bucket <name> or configure default gcloud project.');
    }
    bucket = process.env.GCP_BUCKET || `jachaikori-backfill-${projectId}`;
  }

  let runId = options.runId;
  if (!runId) {
    const latest = await gcs.getObjectJson<LatestRunPointer>(bucket, 'scrape-runs/latest.json');
    if (!latest) {
      throw new Error(`No scrape run found at gs://${bucket}/scrape-runs/latest.json`);
    }
    runId = latest.runId;
  }

  const runPrefix = `scrape-runs/${runId}`;
  const allResultObjs = await gcs.listObjects(bucket, `${runPrefix}/results/`);
  const filteredObjs = options.outlet
    ? allResultObjs.filter((o) => o.name.includes(`/${options.outlet}-`))
    : allResultObjs;

  if (filteredObjs.length === 0) {
    console.log(
      color.yellow(
        `No result files flushed yet under gs://${bucket}/${runPrefix}/results/ (workers flush every 20 articles).`
      )
    );
    return;
  }

  // Spread sampling evenly across outlets (up to maxFiles total)
  const byOutletObjs = new Map<string, string[]>();
  for (const obj of filteredObjs) {
    const base = obj.name.split('/').pop() ?? obj.name;
    const outletMatch = base.replace(/-\d+\.jsonl$/, '');
    const arr = byOutletObjs.get(outletMatch) ?? [];
    arr.push(obj.name);
    byOutletObjs.set(outletMatch, arr);
  }

  const maxFiles = options.maxFiles ?? 24;
  const selectedPaths: string[] = [];
  let idx = 0;
  while (selectedPaths.length < maxFiles) {
    let added = false;
    for (const arr of byOutletObjs.values()) {
      if (idx < arr.length && selectedPaths.length < maxFiles) {
        selectedPaths.push(arr[idx]!);
        added = true;
      }
    }
    if (!added) break;
    idx++;
  }

  console.log(
    color.cyan(
      `\nInspecting ${selectedPaths.length}/${filteredObjs.length} result files from gs://${bucket}/${runPrefix}/...\n`
    )
  );

  const rawFiles = await Promise.all(selectedPaths.map((p) => gcs.getObjectText(bucket!, p)));

  const statsByOutlet = new Map<
    string,
    {
      extracted: number;
      failed: number;
      blocked: number;
      totalChars: number;
      errors: Map<string, number>;
      samples: ScrapeResultRecord[];
    }
  >();

  const samplesLimit = options.samplesPerOutlet ?? 1;

  for (const raw of rawFiles) {
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let rec: ScrapeResultRecord;
      try {
        rec = JSON.parse(line) as ScrapeResultRecord;
      } catch {
        continue;
      }
      let st = statsByOutlet.get(rec.outlet);
      if (!st) {
        st = { extracted: 0, failed: 0, blocked: 0, totalChars: 0, errors: new Map(), samples: [] };
        statsByOutlet.set(rec.outlet, st);
      }
      if (rec.status === 'extracted') {
        st.extracted++;
        st.totalChars += rec.cleanText?.length ?? 0;
        if (st.samples.length < samplesLimit) {
          st.samples.push(rec);
        }
      } else if (rec.status === 'blocked') {
        st.blocked++;
        const errKey = rec.errorMessage ?? 'blocked';
        st.errors.set(errKey, (st.errors.get(errKey) ?? 0) + 1);
      } else {
        st.failed++;
        const errKey = rec.errorMessage ?? 'unknown';
        st.errors.set(errKey, (st.errors.get(errKey) ?? 0) + 1);
      }
    }
  }

  for (const [outletId, st] of Array.from(statsByOutlet.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const total = st.extracted + st.failed + st.blocked;
    const rate = total > 0 ? ((st.extracted / total) * 100).toFixed(1) : '0.0';
    const avgChars = st.extracted > 0 ? Math.round(st.totalChars / st.extracted) : 0;

    console.log(
      `${color.bold(color.cyan(outletId.padEnd(20)))}  OK: ${color.green(`${st.extracted}/${total} (${rate}%)`)}  Blocked: ${color.yellow(String(st.blocked))}  Failed: ${color.red(String(st.failed))}  AvgBody: ${avgChars} chars`
    );

    if (st.errors.size > 0) {
      const topErrs = Array.from(st.errors.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([msg, cnt]) => `${msg} (${cnt})`)
        .join(', ');
      console.log(`  ${color.red('Top errors:')} ${topErrs}`);
    }

    for (const s of st.samples) {
      const snippet = (s.cleanText ?? '').replace(/\s+/g, ' ').slice(0, 180);
      console.log(
        `  ${color.dim('Sample:')} ${s.title ?? '(no title)'} ${color.dim(`[${s.publishedAtIso ?? 'no-date'} | byline: ${s.byline ?? 'none'} | ${s.cleanText?.length ?? 0} chars]`)}`
      );
      console.log(`  ${color.dim('Body  :')} ${snippet}...`);
    }
    console.log('');
  }
}
