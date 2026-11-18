#!/usr/bin/env bun
/**
 * @file tools/crawler/src/cli.ts
 * Interactive and scriptable Command Line Interface for Jachaikori's news catalog harvester.
 * Powered by @clack/prompts and picocolors.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { CatalogDatabase } from './engine/catalog';
import { PoliteHttpClient } from './engine/http';
import { BrowserPool } from './engine/browser';
import { runCrawlJob } from './engine/runner';
import { runArticleScraper } from './engine/scraper';
import { evaluateHeadlineForPrune } from './engine/prune';
import type { ScrapeDashboard } from './ui/scrape-dashboard';
import { getAllOutlets, getOutlet, isAllowedArticleUrl } from '@jachaikori/outlets';
import type { OutletCrawler } from '@jachaikori/outlets';
import type { OutletId } from '@jachaikori/schema';
import { writeFileSync, mkdirSync } from 'node:fs';

const program = new Command();

program
  .name('crawler')
  .description('Jachaikori news catalog harvester CLI')
  .version('0.1.0');

// ==========================================
// Command: status
// ==========================================
program
  .command('status')
  .description('Displays current catalog statistics and progress per outlet')
  .action(() => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Catalog Status ')));

    const catalog = new CatalogDatabase();
    const total = catalog.getTotalArticleCount();
    const totalAll = catalog.getTotalArticleCount(true);
    const totalSkipped = totalAll - total;
    const stats = catalog.getOutletStats();

    if (stats.length === 0) {
      p.log.warn('No articles harvested yet. Run `bun run crawler run` to start.');
    } else {
      let totalExtracted = 0;
      const summaryLines = stats.map((s) => {
        totalExtracted += s.extractedArticles;
        const oldest = s.oldestArticle ? s.oldestArticle.split('T')[0] : 'unknown';
        const newest = s.newestArticle ? s.newestArticle.split('T')[0] : 'unknown';
        const nameCol = color.bold(color.cyan(s.outlet.padEnd(19)));
        const scrapedCol =
          color.green(s.extractedArticles.toLocaleString().padStart(5)) +
          color.dim('/') +
          color.yellow(s.totalArticles.toLocaleString().padEnd(6)) +
          ' scraped';
        const skipCol =
          s.skippedArticles > 0
            ? color.dim(` (${s.skippedArticles.toLocaleString()} skip)`.padEnd(15))
            : ' '.repeat(15);
        const datesCol = color.dim(`${oldest} → ${newest}`);
        return `${nameCol} ${scrapedCol}${skipCol} ${datesCol}`;
      });

      const pct = total > 0 ? ((totalExtracted / total) * 100).toFixed(1) : '0.0';
      const skipBadge = totalSkipped > 0 ? ` · ${color.dim(totalSkipped.toLocaleString() + ' skipped')}` : '';
      const header = `Scraped: ${color.bold(color.green(totalExtracted.toLocaleString()))} / ${color.bold(color.yellow(total.toLocaleString()))} Active (${pct}%)${skipBadge}`;

      p.note(summaryLines.join('\n'), header);
    }

    p.outro(color.dim('Database: data/catalog.sqlite · URL exports: data/urls/'));
    catalog.close();
  });

// ==========================================
// Command: plan
// ==========================================
program
  .command('plan')
  .description('Prints the crawl jobs and targets configured across outlets')
  .action(() => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Crawl Targets ')));

    const outlets = getAllOutlets();
    const planLines: string[] = [];

    for (const outlet of outlets) {
      const delayBadge = color.yellow(`${outlet.policy.crawlDelayMs}ms delay`);
      const sources = outlet.defaultSources
        .map((s) => `${color.cyan(s.key)} ${color.dim(`[${s.mode}]`)}`)
        .join(', ');

      planLines.push(
        `${color.bold(color.white(outlet.name))} ${color.dim(`(${outlet.id})`)} • ${delayBadge}\n  ${color.dim('Sources:')} ${sources}`
      );
    }

    p.note(planLines.join('\n\n'), `${outlets.length} Accredited News Outlets Configured`);
    p.outro(color.dim('Ready to harvest. Run `bun run crawler run` to start.'));
  });

// ==========================================
// Command: run
// ==========================================
program
  .command('run')
  .description('Executes catalog harvesting jobs')
  .option('-o, --outlet <outletId>', 'Target outlet ID (e.g. business-standard)')
  .option('-s, --source <sourceKey>', 'Specific source key within outlet')
  .option('-p, --pages <number>', 'Safety limit on number of pages/batches to fetch', (val) => parseInt(val, 10))
  .option('-c, --cutoff <date>', 'Cutoff publication date (YYYY-MM-DD)', '2026-11-01')
  .option('-j, --concurrency <number>', 'Concurrent outlets to crawl simultaneously', (val) => parseInt(val, 10), 4)
  .option('-r, --resume', 'Resume from previous checkpoint cursor instead of checking from latest', false)
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Catalog Harvester ')));

    const catalog = new CatalogDatabase();
    const httpClient = new PoliteHttpClient();
    const browserPool = new BrowserPool();
    const abortController = new AbortController();

    const cleanup = () => {
      p.log.warn('Gracefully shutting down crawler...');
      abortController.abort();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const outlets = opts.outlet ? [getOutlet(opts.outlet as OutletId)] : getAllOutlets();

    if (outlets.length === 0) {
      p.log.error('No registered outlets found to crawl.');
      catalog.close();
      process.exit(1);
    }

    const concurrency = Math.max(1, opts.concurrency ?? 4);

    p.note(
      [
        `${color.dim('Cutoff Date:')}    ${color.bold(color.yellow(opts.cutoff))}`,
        `${color.dim('Concurrency:')}    ${color.bold(color.cyan(`${concurrency} outlets in parallel`))}`,
        `${color.dim('Harvest Mode:')}   ${color.bold(opts.resume ? color.magenta('Resume from cursor') : color.green('Latest to Cutoff (Skips existing)'))}`,
        `${color.dim('Target Outlets:')} ${color.white(outlets.map((o) => o.id).join(', '))}`,
      ].join('\n'),
      'Run Configuration'
    );

    try {
      const queue: OutletCrawler[] = [...outlets];
      let totalNewSaved = 0;

      async function processOutlet(outlet: OutletCrawler) {
        const sources = opts.source
          ? outlet.defaultSources.filter((s) => s.key === opts.source)
          : outlet.defaultSources;

        for (const source of sources) {
          if (abortController.signal.aborted) break;

          p.log.step(`${color.bold(color.cyan(`[${outlet.id}:${source.key}]`))} Starting harvest...`);

          const result = await runCrawlJob({
            outlet,
            source,
            catalog,
            httpClient,
            browserPool,
            cutoffDate: opts.cutoff,
            maxPages: opts.pages,
            resume: opts.resume,
            signal: abortController.signal,
          });

          totalNewSaved += result.newItemsSaved;

          if (result.status === 'done') {
            p.log.success(
              `${color.bold(color.green(`[${outlet.id}:${source.key}]`))} Completed: ${color.yellow(String(result.itemsFound))} in catalog (+${color.green(String(result.newItemsSaved))} new)`
            );
          } else {
            p.log.warn(
              `${color.bold(color.yellow(`[${outlet.id}:${source.key}]`))} Finished with status: ${result.status} (${result.lastError ?? result.stopReason ?? 'no details'})`
            );
          }
        }
      }

      // Parallel across outlets, strictly serial within each outlet
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0 && !abortController.signal.aborted) {
          const outlet = queue.shift();
          if (outlet) {
            await processOutlet(outlet);
          }
        }
      });

      await Promise.all(workers);

      // Print final summary report
      const finalTotal = catalog.getTotalArticleCount();
      const stats = catalog.getOutletStats();

      const summaryLines = stats.map((s) => {
        const oldest = s.oldestArticle ? s.oldestArticle.split('T')[0] : 'unknown';
        const newest = s.newestArticle ? s.newestArticle.split('T')[0] : 'unknown';
        return `${color.bold(color.cyan(s.outlet.padEnd(20)))} ${color.yellow(String(s.totalArticles).padStart(6))} articles    ${color.dim(`${oldest} → ${newest}`)}`;
      });

      p.note(
        summaryLines.join('\n'),
        `Crawl Finished · Catalog: ${color.bold(color.green(finalTotal.toLocaleString()))} (+${color.green(totalNewSaved.toLocaleString())} added this run)`
      );

      p.outro(color.green('Harvest complete! Discovered URLs and headlines updated in data/urls/'));
    } finally {
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      await browserPool.close();
      catalog.close();
    }
  });

// ==========================================
// Command: scrape
// ==========================================
program
  .command('scrape')
  .description('Concurrently scrapes full article bodies across outlets with polite pacing and static UI')
  .option('-o, --outlet <outletId>', 'Target a single outlet ID (e.g. prothom-alo)')
  .option('-l, --limit <number>', 'Max articles to scrape per outlet in this session', (val) => parseInt(val, 10))
  .option(
    '-j, --concurrency <number>',
    'Max outlets to scrape concurrently (1 polite serial stream per outlet)',
    (val) => parseInt(val, 10),
    8
  )
  .option('--retry-failed', 'Include previously failed articles in the scrape queue', false)
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Polite Article Scraper ')));

    const outlets = opts.outlet ? [getOutlet(opts.outlet as OutletId)] : getAllOutlets();
    if (outlets.length === 0) {
      p.log.error('No registered outlets found to scrape.');
      process.exitCode = 1;
      return;
    }

    const catalog = new CatalogDatabase();
    const abortController = new AbortController();
    let dashboardRef: ScrapeDashboard | null = null;
    let sigintCount = 0;

    const onSignal = () => {
      sigintCount++;
      if (sigintCount === 1) {
        dashboardRef?.setShuttingDown(true);
        abortController.abort();
      } else {
        // Second Ctrl+C: restore terminal cursor, checkpoint DB, and exit immediately
        process.stdout.write('\x1b[?25h');
        try {
          catalog.close();
        } catch {
          // ignore
        }
        process.exit(130);
      }
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
      const summary = await runArticleScraper({
        outlets,
        catalog,
        limitPerOutlet: opts.limit,
        concurrency: Math.max(1, opts.concurrency ?? 8),
        retryFailed: Boolean(opts.retryFailed),
        signal: abortController.signal,
        onShutdownTriggered: (dash) => {
          dashboardRef = dash;
        },
      });

      for (const res of summary.perOutlet) {
        if (res.stoppedReason) {
          p.log.warn(`${color.bold(color.yellow(res.outlet))}: ${res.stoppedReason}`);
        }
      }

      const totalRemaining = summary.perOutlet.reduce((acc, r) => acc + r.remainingPending, 0);

      if (summary.aborted) {
        p.outro(
          color.yellow(
            `Paused cleanly · Saved +${summary.totalScrapedThisSession.toLocaleString()} articles to data/catalog.sqlite (${totalRemaining.toLocaleString()} pending to resume)`
          )
        );
      } else {
        p.outro(
          color.green(
            `Scrape finished · Saved +${summary.totalScrapedThisSession.toLocaleString()} articles to data/catalog.sqlite (${totalRemaining.toLocaleString()} remaining pending)`
          )
        );
      }
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      catalog.close();
    }
  });

// ==========================================
// Command: export
// ==========================================
program
  .command('export')
  .description('Exports harvested article URLs and titles from catalog.sqlite into text and jsonl files')
  .option('-o, --outlet <outletId>', 'Target outlet ID (e.g. business-standard)')
  .option('-f, --format <format>', 'Export format: "txt" (URL | Headline) or "jsonl"', 'txt')
  .option('--output <filePath>', 'Destination file path (defaults to data/urls/<outlet>.txt)')
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Export URLs & Headlines ')));

    const s = p.spinner();
    s.start('Reading catalog from SQLite and writing exports...');

    const catalog = new CatalogDatabase();
    mkdirSync('data/urls', { recursive: true });

    const exportLogs: string[] = [];

    if (opts.outlet) {
      const articles = catalog.getArticles(opts.outlet as OutletId);
      if (articles.length === 0) {
        s.stop(color.yellow(`No articles found for ${opts.outlet}.`));
        catalog.close();
        p.outro('Export cancelled');
        return;
      }
      const targetFile =
        opts.output ?? `data/urls/${opts.outlet}.${opts.format === 'jsonl' ? 'jsonl' : 'txt'}`;
      const content =
        opts.format === 'jsonl'
          ? articles.map((a) => JSON.stringify(a)).join('\n') + '\n'
          : articles.map((a) => `${a.canonicalUrl} | ${a.title.replace(/\s+/g, ' ').trim()}`).join('\n') + '\n';
      writeFileSync(targetFile, content, 'utf8');
      exportLogs.push(`${color.cyan(opts.outlet)}: ${color.yellow(articles.length)} articles → ${color.dim(targetFile)}`);
    } else {
      const allArticles = catalog.getArticles();
      if (allArticles.length === 0) {
        s.stop(color.yellow('No articles found in catalog to export.'));
        catalog.close();
        p.outro('Export cancelled');
        return;
      }

      const allTarget =
        opts.output ?? `data/urls/all-articles.${opts.format === 'jsonl' ? 'jsonl' : 'txt'}`;
      const allContent =
        opts.format === 'jsonl'
          ? allArticles.map((a) => JSON.stringify(a)).join('\n') + '\n'
          : allArticles.map((a) => `${a.canonicalUrl} | ${a.title.replace(/\s+/g, ' ').trim()}`).join('\n') + '\n';
      writeFileSync(allTarget, allContent, 'utf8');
      exportLogs.push(`${color.bold(color.green('all-articles'))}: ${color.yellow(allArticles.length.toLocaleString())} total → ${color.dim(allTarget)}`);

      if (!opts.output) {
        const outlets = catalog.getOutletStats().map((stat) => stat.outlet as OutletId);
        for (const outlet of outlets) {
          const outletArticles = catalog.getArticles(outlet);
          const outletFile = `data/urls/${outlet}.${opts.format === 'jsonl' ? 'jsonl' : 'txt'}`;
          const outletContent =
            opts.format === 'jsonl'
              ? outletArticles.map((a) => JSON.stringify(a)).join('\n') + '\n'
              : outletArticles.map((a) => `${a.canonicalUrl} | ${a.title.replace(/\s+/g, ' ').trim()}`).join('\n') + '\n';
          writeFileSync(outletFile, outletContent, 'utf8');
          exportLogs.push(`${color.cyan(outlet)}: ${color.yellow(outletArticles.length.toLocaleString())} articles → ${color.dim(outletFile)}`);
        }
      }
    }

    s.stop(color.green('Export successfully completed!'));
    p.note(exportLogs.join('\n'), 'Exported Files (data/urls/)');
    p.outro(color.dim('Exports up to date.'));
    catalog.close();
  });

// ==========================================
// Command: prune
// ==========================================
program
  .command('prune')
  .description('Marks disallowed articles as skipped (or deletes with --delete) and cleans orphaned jobs')
  .option('--delete', 'Hard-delete disallowed articles instead of marking status="skipped"', false)
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Catalog Prune & Hygiene ')));

    const catalog = new CatalogDatabase();
    const validJobIds = new Set<string>();
    for (const outlet of getAllOutlets()) {
      for (const source of outlet.defaultSources) {
        validJobIds.add(`${outlet.id}:${source.key}`);
      }
    }

    const s = p.spinner();
    s.start('Applying strict URL allowlists and reconciling catalog...');
    const res = catalog.pruneCatalog(isAllowedArticleUrl, validJobIds, { hardDelete: opts.delete });
    s.stop(color.green('Catalog updated!'));

    const lines = opts.delete
      ? [`${color.dim('Off-topic articles deleted:')}  ${color.yellow(res.deletedArticles.toLocaleString())}`]
      : [
          `${color.dim('Newly marked skipped:')}        ${color.yellow(res.skippedArticles.toLocaleString())}`,
          `${color.dim('Restored to discovered:')}      ${color.cyan(res.restoredArticles.toLocaleString())}`,
          `${color.dim('Total skipped in DB:')}         ${color.dim(res.totalSkipped.toLocaleString())}`,
        ];
    lines.push(
      `${color.dim('Orphaned jobs removed:')}       ${color.yellow(res.deletedJobs.toLocaleString())}`,
      `${color.dim('Active articles remaining:')}   ${color.bold(color.green(res.remainingArticles.toLocaleString()))}`
    );

    p.note(lines.join('\n'), 'Prune Summary');

    catalog.close();
    p.outro(color.dim('Run `bun run crawler export` to sync data/urls/ exports.'));
  });

// ==========================================
// Command: gaps
// ==========================================
program
  .command('gaps')
  .description('Audits daily coverage density and zero-article date gaps per outlet')
  .option('--from <date>', 'Start date (YYYY-MM-DD)', '2026-08-01')
  .option('--to <date>', 'End date (YYYY-MM-DD)', '2026-11-14')
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Daily Coverage & Gap Report ')));

    const catalog = new CatalogDatabase();
    const rows = catalog.getDailyCounts(opts.from, opts.to);

    const byOutlet = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!byOutlet.has(row.outlet)) byOutlet.set(row.outlet, new Map());
      byOutlet.get(row.outlet)!.set(row.day, row.count);
    }

    // Build expected calendar days [from, to]
    const expectedDays: string[] = [];
    const cur = new Date(`${opts.from}T00:00:00Z`);
    const end = new Date(`${opts.to}T00:00:00Z`);
    while (cur <= end) {
      expectedDays.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const lines: string[] = [];
    for (const outlet of getAllOutlets()) {
      const dayMap = byOutlet.get(outlet.id) ?? new Map<string, number>();
      let totalInWindow = 0;
      const missingDays: string[] = [];
      for (const day of expectedDays) {
        const cnt = dayMap.get(day) ?? 0;
        totalInWindow += cnt;
        if (cnt === 0) missingDays.push(day);
      }
      const avg = expectedDays.length > 0 ? (totalInWindow / expectedDays.length).toFixed(1) : '0.0';
      const gapBadge =
        missingDays.length === 0
          ? color.green('0 gaps')
          : color.yellow(`${missingDays.length} missing days (${missingDays.slice(0, 3).join(', ')}${missingDays.length > 3 ? '…' : ''})`);
      lines.push(
        `${color.bold(color.cyan(outlet.id.padEnd(20)))} ${color.white(totalInWindow.toLocaleString().padStart(6))} articles (${avg.padStart(5)}/day)  •  ${gapBadge}`
      );
    }

    p.note(lines.join('\n'), `Window: ${opts.from} → ${opts.to} (${expectedDays.length} days)`);
    catalog.close();
    p.outro(color.dim('Coverage audit complete.'));
  });

// ==========================================
// Command: verify-extract
// ==========================================
program
  .command('verify-extract')
  .description('Fetches sample live articles from catalog.sqlite and verifies extractArticle() output')
  .option('-o, --outlet <outletId>', 'Target outlet ID (e.g. prothom-alo)')
  .option('-n, --sample <number>', 'Random articles to sample per outlet', (val) => parseInt(val, 10), 2)
  .option('-u, --url <url>', 'Test extraction on a specific URL (requires --outlet)')
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Article Extraction Verifier ')));

    const catalog = new CatalogDatabase();
    const httpClient = new PoliteHttpClient();
    const browserPool = new BrowserPool();

    let passed = 0;
    let warned = 0;

    async function fetchHtml(url: string): Promise<{ html: string; via: 'http' | 'playwright' }> {
      try {
        const html = await httpClient.fetchText(url);
        if (html.includes('Just a moment') || html.length < 5000) {
          throw new Error('Challenge or short HTML');
        }
        return { html, via: 'http' };
      } catch {
        const html = await browserPool.fetchRenderedHtml(url);
        return { html, via: 'playwright' };
      }
    }

    function checkWarnings(res: ReturnType<NonNullable<OutletCrawler['extractArticle']>>): string[] {
      const warnings: string[] = [];
      if (!res.title) warnings.push('EMPTY_TITLE');
      if (!res.publishedAtIso) warnings.push('BAD_DATE');
      if (res.cleanText.length < 200) warnings.push(`SHORT_BODY(${res.cleanText.length})`);
      if (/googletag|<script|<div/i.test(res.cleanText)) warnings.push('HTML_OR_AD_LEAK');
      return warnings;
    }

    try {
      if (opts.url) {
        if (!opts.outlet) {
          p.log.error('Please specify --outlet <outletId> when testing a single --url.');
          process.exitCode = 1;
          return;
        }
        const outlet = getOutlet(opts.outlet as OutletId);
        if (!outlet.extractArticle) {
          p.log.error(`Outlet ${outlet.id} does not implement extractArticle().`);
          process.exitCode = 1;
          return;
        }

        const s = p.spinner();
        s.start(`Fetching ${color.cyan(opts.url)}...`);
        const { html, via } = await fetchHtml(opts.url);
        const res = outlet.extractArticle(html, opts.url);
        const warnings = checkWarnings(res);
        s.stop(
          warnings.length === 0
            ? color.green(`Extracted cleanly via ${via}`)
            : color.yellow(`Extracted with warnings via ${via}: ${warnings.join(', ')}`)
        );

        p.note(
          [
            `${color.dim('Title:')}    ${res.title}`,
            `${color.dim('Date:')}     ${res.publishedAtIso ?? res.publishedAtRaw}`,
            `${color.dim('Byline:')}   ${res.byline ?? '(none)'}`,
            `${color.dim('Length:')}   ${res.cleanText.length} chars`,
            `${color.dim('Lead:')}     ${res.lead?.slice(0, 140) ?? '(none)'}`,
          ].join('\n'),
          outlet.id
        );
        return;
      }

      const outlets = opts.outlet ? [getOutlet(opts.outlet as OutletId)] : getAllOutlets();
      const sampleSize = Math.max(1, opts.sample ?? 2);

      for (const outlet of outlets) {
        if (!outlet.extractArticle) {
          p.log.warn(`${outlet.id}: no extractArticle() implemented`);
          continue;
        }

        const samples = catalog.sampleArticles(outlet.id, sampleSize);
        if (samples.length === 0) {
          p.log.warn(`${outlet.id}: no articles in catalog.sqlite`);
          continue;
        }

        p.log.step(color.bold(color.cyan(`=== ${outlet.id} (${samples.length} samples) ===`)));

        for (const row of samples) {
          try {
            const { html, via } = await fetchHtml(row.canonicalUrl);
            const res = outlet.extractArticle(html, row.canonicalUrl);
            const warnings = checkWarnings(res);

            if (warnings.length === 0) {
              passed++;
              p.log.success(
                `${color.green('OK')} ${color.dim(`[${via}]`)} ${color.cyan(row.canonicalUrl)}\n` +
                  `   ${color.dim('Title:')}  ${res.title}\n` +
                  `   ${color.dim('Date:')}   ${res.publishedAtIso} ${color.dim('| Byline:')} ${res.byline ?? '(none)'}\n` +
                  `   ${color.dim('Body:')}   ${res.cleanText.length} chars — ${res.lead?.slice(0, 90) ?? ''}`
              );
            } else {
              warned++;
              p.log.warn(
                `${color.yellow(warnings.join(', '))} ${color.dim(`[${via}]`)} ${color.cyan(row.canonicalUrl)}\n` +
                  `   ${color.dim('Catalog:')}   ${row.title}\n` +
                  `   ${color.dim('Extracted:')} ${res.title || '(empty)'}\n` +
                  `   ${color.dim('Date:')}      ${res.publishedAtIso ?? res.publishedAtRaw ?? '(none)'} ${color.dim('| Body:')} ${res.cleanText.length} chars`
              );
            }
          } catch (err: any) {
            warned++;
            p.log.error(`Failed fetching ${row.canonicalUrl}: ${err.message}`);
          }
        }
      }

      p.outro(
        warned === 0
          ? color.green(`All ${passed} sampled articles extracted cleanly!`)
          : color.yellow(`Finished: ${passed} OK, ${warned} with warnings/errors`)
      );
    } finally {
      await browserPool.close();
      catalog.close();
    }
  });

// ==========================================
// Command: recon
// ==========================================
program
  .command('recon <url>')
  .description('Quickly inspect an outlet URL: fetch sample HTML and print metadata/links')
  .action(async (url: string) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Recon Probe ')));

    const s = p.spinner();
    s.start(`Fetching probe for ${color.cyan(url)}...`);

    const httpClient = new PoliteHttpClient();
    try {
      const html = await httpClient.fetchText(url);
      s.stop(color.green(`Fetched successfully (${html.length.toLocaleString()} bytes)`));
      p.note(html.slice(0, 600).replace(/\s+/g, ' ') + '...', 'HTML Snippet');
      p.outro(color.green('Recon finished'));
    } catch (err: any) {
      s.stop(color.red(`Recon failed: ${err.message}`));
      p.outro(color.red('Failed'));
    }
  });

// ==========================================
// Command: prune-headlines
// ==========================================
program
  .command('prune-headlines')
  .description('Optionally reactivates skipped rows and marks low-signal headlines as skipped before scraping')
  .option('--reactivate-skipped', 'Convert currently skipped articles back to discovered before pruning', false)
  .option('--dry-run', 'Preview prune counts without modifying data/catalog.sqlite', false)
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Headline Low-Signal Pruner ')));

    const catalog = new CatalogDatabase();
    const db = (catalog as unknown as { db: import('bun:sqlite').Database }).db;

    try {
      let reactivated = 0;
      if (opts.reactivateSkipped) {
        const countRow = db
          .query<{ cnt: number }, []>("SELECT COUNT(*) AS cnt FROM article WHERE status = 'skipped'")
          .get();
        reactivated = countRow?.cnt ?? 0;
        if (!opts.dryRun && reactivated > 0) {
          db.query("UPDATE article SET status = 'discovered' WHERE status = 'skipped'").run();
        }
        p.log.info(
          opts.dryRun
            ? `Would reactivate ${reactivated.toLocaleString()} skipped articles -> discovered`
            : `Reactivated ${reactivated.toLocaleString()} skipped articles -> discovered`
        );
      }

      const candidates = db
        .query<{ id: string; outlet: string; canonical_url: string; title: string }, []>(
          "SELECT id, outlet, canonical_url, title FROM article WHERE status = 'discovered'"
        )
        .all();

      const byReason = new Map<string, number>();
      const byOutlet = new Map<string, number>();
      const toSkipIds: string[] = [];

      for (const row of candidates) {
        const decision = evaluateHeadlineForPrune({
          outlet: row.outlet,
          canonicalUrl: row.canonical_url,
          title: row.title,
        });
        if (decision.skip && decision.reason) {
          toSkipIds.push(row.id);
          byReason.set(decision.reason, (byReason.get(decision.reason) ?? 0) + 1);
          byOutlet.set(row.outlet, (byOutlet.get(row.outlet) ?? 0) + 1);
        }
      }

      if (!opts.dryRun && toSkipIds.length > 0) {
        const update = db.prepare("UPDATE article SET status = 'skipped' WHERE id = ?");
        const tx = db.transaction((ids: string[]) => {
          for (const id of ids) update.run(id);
        });
        tx(toSkipIds);
      }

      const reasonLines = Array.from(byReason.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${reason.padEnd(32)} ${count.toLocaleString()}`);
      const outletLines = Array.from(byOutlet.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([outlet, count]) => `${outlet.padEnd(24)} ${count.toLocaleString()}`);

      p.note(
        [
          `Evaluated: ${candidates.length.toLocaleString()} discovered articles`,
          `Pruned:    ${toSkipIds.length.toLocaleString()} low-signal articles`,
          `Remaining: ${(candidates.length - toSkipIds.length).toLocaleString()} active pending scrape`,
          '',
          'By Reason:',
          ...(reasonLines.length > 0 ? reasonLines : ['  (none)']),
          '',
          'By Outlet:',
          ...(outletLines.length > 0 ? outletLines : ['  (none)']),
        ].join('\n'),
        opts.dryRun ? 'Dry-Run Summary' : 'Prune Applied'
      );

      p.outro(
        opts.dryRun
          ? color.yellow('Dry-run complete (database unchanged)')
          : color.green(`Marked ${toSkipIds.length.toLocaleString()} low-signal articles as skipped`)
      );
    } finally {
      catalog.close();
    }
  });

// ==========================================
// Interactive Dashboard (When no args passed)
// ==========================================
async function runInteractiveMenu() {
  console.clear();
  p.intro(color.bgCyan(color.black(' Jachaikori (যাচাই করি) — News Harvester ')));

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'scrape', label: '📰 Scrape Full Articles', hint: 'Concurrent polite body scraper with static live UI' },
      { value: 'run', label: '🚀 Start URL Crawl Harvest', hint: 'Harvest article URLs down to cutoff date' },
      { value: 'status', label: '📊 View Catalog Status', hint: 'Scraped counts, active URLs & database stats' },
      { value: 'plan', label: '📋 View Crawl Targets & Plans', hint: 'Inspect configured outlets & source categories' },
      { value: 'export', label: '💾 Export URLs & Headlines', hint: 'Regenerate text and jsonl files in data/urls/' },
      { value: 'verify-extract', label: '🔍 Verify Article Extractors', hint: 'Spot-check live article extraction per outlet' },
      { value: 'exit', label: '🚪 Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.cancel('Goodbye!');
    process.exit(0);
  }

  if (action === 'status' || action === 'plan' || action === 'export' || action === 'verify-extract') {
    await program.parseAsync([action], { from: 'user' });
    return;
  }

  if (action === 'scrape') {
    const allOutlets = getAllOutlets();
    const scrapeConfig = await p.group(
      {
        scope: () =>
          p.select({
            message: 'Which outlets would you like to scrape?',
            initialValue: 'all',
            options: [
              { value: 'all', label: 'All 8 outlets concurrently', hint: 'Recommended — 1 polite serial worker per domain' },
              ...allOutlets.map((o) => ({ value: o.id, label: o.name, hint: o.id })),
            ],
          }),
        concurrency: ({ results }) =>
          results.scope === 'all'
            ? p.select({
                message: 'How many outlets concurrently?',
                initialValue: 8,
                options: [
                  { value: 8, label: '8 outlets', hint: 'Recommended (1 polite stream per domain)' },
                  { value: 4, label: '4 outlets', hint: 'Moderate parallel' },
                  { value: 2, label: '2 outlets', hint: 'Light parallel' },
                  { value: 1, label: '1 outlet', hint: 'Strictly sequential' },
                ],
              })
            : Promise.resolve(1),
        limitStr: () =>
          p.text({
            message: 'Max articles per outlet this session? (Leave empty for all pending)',
            placeholder: 'all pending',
            validate: (v) => {
              if (!v || v.trim() === '') return undefined;
              const n = Number(v);
              if (!Number.isInteger(n) || n <= 0) return 'Enter a positive integer or leave blank';
            },
          }),
        retryFailed: () =>
          p.confirm({
            message: 'Retry previously failed articles?',
            initialValue: false,
          }),
      },
      {
        onCancel: () => {
          p.cancel('Scrape cancelled');
          process.exit(0);
        },
      }
    );

    const args = ['scrape', '-j', String(scrapeConfig.concurrency)];
    if (scrapeConfig.scope !== 'all') {
      args.push('-o', String(scrapeConfig.scope));
    }
    if (scrapeConfig.limitStr && scrapeConfig.limitStr.trim() !== '') {
      args.push('-l', scrapeConfig.limitStr.trim());
    }
    if (scrapeConfig.retryFailed) {
      args.push('--retry-failed');
    }

    await program.parseAsync(args, { from: 'user' });
    return;
  }

  if (action === 'run') {
    const config = await p.group(
      {
        cutoff: () =>
          p.text({
            message: 'Cutoff date (YYYY-MM-DD):',
            initialValue: '2026-11-01',
            placeholder: '2026-11-01',
            validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : 'Format must be YYYY-MM-DD'),
          }),
        concurrency: () =>
          p.select({
            message: 'How many outlets to crawl in parallel?',
            initialValue: 4,
            options: [
              { value: 1, label: '1 worker', hint: 'Conservative / Serial' },
              { value: 2, label: '2 workers', hint: 'Light parallel' },
              { value: 4, label: '4 workers', hint: 'Recommended default' },
              { value: 8, label: '8 workers', hint: 'High throughput (All outlets)' },
            ],
          }),
        resume: () =>
          p.confirm({
            message: 'Resume from saved cursor? (No = fresh latest down to cutoff)',
            initialValue: false,
          }),
      },
      {
        onCancel: () => {
          p.cancel('Crawl cancelled');
          process.exit(0);
        },
      }
    );

    const args = ['run', '-c', config.cutoff, '-j', String(config.concurrency)];
    if (config.resume) args.push('-r');

    await program.parseAsync(args, { from: 'user' });
  }
}

// If no CLI subcommand was given, launch interactive menu
if (process.argv.length <= 2) {
  runInteractiveMenu().catch(console.error);
} else {
  program.parse(process.argv);
}
