#!/usr/bin/env bun
/**
 * @file tools/crawler/src/cli.ts
 * Main Command Line Interface for Jachaikori's local catalog harvester.
 */

import { Command } from 'commander';
import { CatalogDatabase } from './engine/catalog';
import { PoliteHttpClient } from './engine/http';
import { runCrawlJob } from './engine/runner';
import { getAllOutlets, getOutlet } from '@jachaikori/outlets';
import type { OutletId } from '@jachaikori/schema';

const program = new Command();

program
  .name('crawler')
  .description('Jachaikori news catalog harvester CLI')
  .version('0.1.0');

// Command: status
program
  .command('status')
  .description('Displays current catalog statistics and progress per outlet')
  .action(() => {
    const catalog = new CatalogDatabase();
    const stats = catalog.getOutletStats();

    console.log('\n📊 Jachaikori Catalog Summary:\n');
    if (stats.length === 0) {
      console.log('No articles harvested yet. Run `bun run crawler run` to start.');
    } else {
      console.table(stats);
    }
    catalog.close();
  });

// Command: plan
program
  .command('plan')
  .description('Prints the crawl jobs and targets configured across outlets')
  .action(() => {
    const outlets = getAllOutlets();
    console.log(`\n📋 Configured Outlets (${outlets.length}):\n`);
    for (const outlet of outlets) {
      console.log(`• ${outlet.name} (${outlet.id})`);
      console.log(`  Delay: ${outlet.policy.crawlDelayMs}ms`);
      console.log(`  Sources: ${outlet.defaultSources.map((s) => `${s.key} [${s.mode}]`).join(', ')}`);
    }
  });

// Command: run
program
  .command('run')
  .description('Executes catalog harvesting jobs')
  .option('-o, --outlet <outletId>', 'Target outlet ID (e.g. business-standard)')
  .option('-s, --source <sourceKey>', 'Specific source key within outlet')
  .option('-p, --pages <number>', 'Safety limit on number of pages/batches to fetch', (val) => parseInt(val, 10))
  .option('-c, --cutoff <date>', 'Cutoff publication date (YYYY-MM-DD)', '2026-01-01')
  .action(async (opts) => {
    const catalog = new CatalogDatabase();
    const httpClient = new PoliteHttpClient();

    const outlets = opts.outlet ? [getOutlet(opts.outlet as OutletId)] : getAllOutlets();

    if (outlets.length === 0) {
      console.error('No registered outlets found to crawl.');
      process.exit(1);
    }

    console.log(`\n🚀 Starting crawler run... (Cutoff: ${opts.cutoff}, Max Batches: ${opts.pages ?? 'unlimited'})\n`);

    for (const outlet of outlets) {
      const sources = opts.source
        ? outlet.defaultSources.filter((s) => s.key === opts.source)
        : outlet.defaultSources;

      for (const source of sources) {
        console.log(`\n--- Running [${outlet.id} : ${source.key}] ---`);
        const result = await runCrawlJob({
          outlet,
          source,
          catalog,
          httpClient,
          cutoffDate: opts.cutoff,
          maxPages: opts.pages,
        });

        console.log(`Result for ${result.jobId}: Status=${result.status}, Found=${result.itemsFound}, New=${result.newItemsSaved}`);
      }
    }

    catalog.close();
  });

// Command: recon
program
  .command('recon <url>')
  .description('Quickly inspect an outlet URL: fetch sample HTML and print metadata/links')
  .action(async (url: string) => {
    console.log(`\n🔍 Running recon on ${url}...`);
    const httpClient = new PoliteHttpClient();
    try {
      const html = await httpClient.fetchText(url);
      console.log(`✓ Fetched successfully (${html.length} bytes)`);
      console.log(`Snippet: ${html.slice(0, 500).replace(/\s+/g, ' ')}...`);
    } catch (err: any) {
      console.error(`✗ Recon failed: ${err.message}`);
    }
  });

program.parse(process.argv);
