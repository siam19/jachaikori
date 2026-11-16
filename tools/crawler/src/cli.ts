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
    const stats = catalog.getOutletStats();

    if (stats.length === 0) {
      p.log.warn('No articles harvested yet. Run `bun run crawler run` to start.');
    } else {
      const summaryLines = stats.map((s) => {
        const oldest = s.oldestArticle ? s.oldestArticle.split('T')[0] : 'unknown';
        const newest = s.newestArticle ? s.newestArticle.split('T')[0] : 'unknown';
        const nameCol = color.bold(color.cyan(s.outlet.padEnd(20)));
        const countCol = color.yellow(s.totalArticles.toLocaleString().padStart(6)) + ' articles';
        const datesCol = color.dim(`${oldest}  →  ${newest}`);
        return `${nameCol} ${countCol}    ${datesCol}`;
      });

      p.note(summaryLines.join('\n'), `Catalog Total: ${color.bold(color.green(total.toLocaleString()))} Unique Articles`);
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
  .description('Prunes off-topic articles and orphaned crawl_job entries according to strict outlet allowlists')
  .action(() => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Catalog Prune & Hygiene ')));

    const catalog = new CatalogDatabase();
    const validJobIds = new Set<string>();
    for (const outlet of getAllOutlets()) {
      for (const source of outlet.defaultSources) {
        validJobIds.add(`${outlet.id}:${source.key}`);
      }
    }

    const s = p.spinner();
    s.start('Applying strict URL allowlists and cleaning orphaned jobs...');
    const res = catalog.pruneCatalog(isAllowedArticleUrl, validJobIds);
    s.stop(color.green('Catalog pruned and vacuumed!'));

    p.note(
      [
        `${color.dim('Off-topic articles removed:')} ${color.yellow(res.deletedArticles.toLocaleString())}`,
        `${color.dim('Orphaned jobs removed:')}      ${color.yellow(res.deletedJobs.toLocaleString())}`,
        `${color.dim('Clean articles remaining:')}   ${color.bold(color.green(res.remainingArticles.toLocaleString()))}`,
      ].join('\n'),
      'Prune Summary'
    );

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
// Interactive Dashboard (When no args passed)
// ==========================================
async function runInteractiveMenu() {
  console.clear();
  p.intro(color.bgCyan(color.black(' Jachaikori (যাচাই করি) — News Harvester ')));

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'run', label: '🚀 Start Crawl Harvest', hint: 'Harvest articles down to cutoff date' },
      { value: 'status', label: '📊 View Catalog Status', hint: 'Article counts, dates & database stats' },
      { value: 'plan', label: '📋 View Crawl Targets & Plans', hint: 'Inspect configured outlets & source categories' },
      { value: 'export', label: '💾 Export URLs & Headlines', hint: 'Regenerate text and jsonl files in data/urls/' },
      { value: 'exit', label: '🚪 Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.cancel('Goodbye!');
    process.exit(0);
  }

  if (action === 'status') {
    program.commands.find((c) => c.name() === 'status')?.parse(['status'], { from: 'user' });
    return;
  }

  if (action === 'plan') {
    program.commands.find((c) => c.name() === 'plan')?.parse(['plan'], { from: 'user' });
    return;
  }

  if (action === 'export') {
    program.commands.find((c) => c.name() === 'export')?.parse(['export'], { from: 'user' });
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

    program.commands.find((c) => c.name() === 'run')?.parse(args, { from: 'user' });
  }
}

// If no CLI subcommand was given, launch interactive menu
if (process.argv.length <= 2) {
  runInteractiveMenu().catch(console.error);
} else {
  program.parse(process.argv);
}
