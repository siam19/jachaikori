#!/usr/bin/env bun
/**
 * @file tools/backfill/src/cli.ts
 * Backfill CLI: Bangla FTS5 verifier, article chunker, GCP BGE-M3 vector importer,
 * cross-outlet event clusterer, and Cloudflare D1 / Vectorize exporter.
 */

import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildFtsMatchQuery,
  buildTemporalSimilarityEdgesAsync,
  chunkArticle,
  clusterArticlesBySimilarityAsync,
  computeArticleCentroid,
  normalizeBanglaForFts,
  type ArticleVectorRecord,
} from '@jachaikori/retrieval';
import type { OutletId } from '@jachaikori/schema';
import { IndexDatabase } from './db';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const DEFAULT_CATALOG = join(REPO_ROOT, 'data/catalog.sqlite');
const DEFAULT_INDEX = join(REPO_ROOT, 'data/index/index.sqlite');
const DEFAULT_INDEX_DIR = join(REPO_ROOT, 'data/index');

const program = new Command();

program
  .name('backfill')
  .description('Jachaikori indexing, GCP BGE-M3 embedding import, clustering, and Cloudflare D1/Vectorize loader')
  .version('0.1.0');

// ==========================================
// Command: verify-fts
// ==========================================
program
  .command('verify-fts')
  .description('Verifies Bangla FTS5 word integrity and keyword recall against real catalog.sqlite articles')
  .option('--catalog <path>', 'Path to catalog.sqlite', DEFAULT_CATALOG)
  .option('-n, --sample <number>', 'Sample size per outlet', (v) => parseInt(v, 10), 25)
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Bangla FTS5 Verifier ')));

    const cat = new Database(opts.catalog, { readonly: true });
    const samples = cat
      .query(
        `SELECT id, outlet, title, clean_text
         FROM article
         WHERE status = 'extracted' AND clean_text IS NOT NULL AND length(clean_text) > 100
         ORDER BY RANDOM()
         LIMIT ?`
      )
      .all(opts.sample * 8) as Array<{ id: string; outlet: string; title: string; clean_text: string }>;
    cat.close();

    const idx = new IndexDatabase(':memory:');
    for (const s of samples) {
      const chunks = chunkArticle({
        id: s.id,
        outlet: s.outlet as OutletId,
        title: s.title,
        cleanText: s.clean_text,
      });
      idx.upsertArticleAndChunks(
        {
          id: s.id,
          outlet: s.outlet as OutletId,
          canonicalUrl: `https://example.com/${s.id}`,
          title: s.title,
          publishedAt: null,
          byline: null,
          lead: null,
          cleanText: s.clean_text,
        },
        chunks
      );
    }

    const db = idx.getRawDb();
    let passed = 0;
    let failed = 0;

    for (const s of samples) {
      const ftsQ = buildFtsMatchQuery(s.title, 'AND');
      if (!ftsQ) continue;
      const hits = db
        .query('SELECT article_id FROM chunk_fts WHERE chunk_fts MATCH ? LIMIT 20')
        .all(ftsQ) as Array<{ article_id: string }>;
      if (hits.some((h) => h.article_id === s.id)) {
        passed++;
      } else {
        failed++;
      }
    }

    const counts = idx.getCounts();
    idx.close();

    p.note(
      [
        `${color.dim('Sampled articles:')} ${color.white(samples.length)}`,
        `${color.dim('Indexed chunks:')}   ${color.white(counts.chunks)}`,
        `${color.dim('Title recall:')}     ${color.green(`${passed}/${passed + failed}`)} (${failed} missed)`,
      ].join('\n'),
      'Bangla FTS5 Verification'
    );

    p.outro(failed === 0 ? color.green('100% FTS5 recall on sampled articles!') : color.yellow('Completed with misses'));
  });

// ==========================================
// Command: chunk
// ==========================================
program
  .command('chunk')
  .description('Chunks extracted articles into data/index/index.sqlite and exports chunks.jsonl for GCP GPU embedding')
  .option('--catalog <path>', 'Path to catalog.sqlite', DEFAULT_CATALOG)
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--max-chars <number>', 'Max chars per chunk', (v) => parseInt(v, 10), 1600)
  .option('--overlap <number>', 'Overlap chars between chunks', (v) => parseInt(v, 10), 200)
  .option('-l, --limit <number>', 'Optional limit on articles to chunk', (v) => parseInt(v, 10))
  .option('--rebuild', 'Re-chunk even if article already exists in index.sqlite', false)
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Article Chunker & FTS5 Builder ')));

    const s = p.spinner();
    s.start('Reading extracted articles from catalog.sqlite...');

    const cat = new Database(opts.catalog, { readonly: true });
    let sql = `
      SELECT id, outlet, canonical_url as canonicalUrl, title, published_at as publishedAt,
             byline, lead, clean_text as cleanText
      FROM article
      WHERE status = 'extracted' AND clean_text IS NOT NULL AND length(clean_text) > 0
      ORDER BY published_at DESC
    `;
    if (opts.limit && opts.limit > 0) {
      sql += ` LIMIT ${opts.limit}`;
    }
    const articles = cat.query(sql).all() as Array<{
      id: string;
      outlet: OutletId;
      canonicalUrl: string;
      title: string;
      publishedAt: string | null;
      byline: string | null;
      lead: string | null;
      cleanText: string;
    }>;
    cat.close();

    const idx = new IndexDatabase(opts.index);
    const existingIds = opts.rebuild ? new Set<string>() : idx.getExistingArticleIds();

    let addedArticles = 0;
    let totalNewChunks = 0;
    const t0 = Date.now();

    for (const art of articles) {
      if (existingIds.has(art.id)) continue;

      const chunks = chunkArticle(
        {
          id: art.id,
          outlet: art.outlet,
          title: art.title,
          lead: art.lead,
          cleanText: art.cleanText,
          publishedAt: art.publishedAt,
        },
        { maxChars: opts.maxChars, overlapChars: opts.overlap }
      );

      idx.upsertArticleAndChunks(
        {
          ...art,
          title: normalizeBanglaForFts(art.title),
        },
        chunks
      );
      addedArticles++;
      totalNewChunks += chunks.length;

      if (addedArticles % 2000 === 0) {
        s.message(`Chunked ${addedArticles.toLocaleString()} new articles (${totalNewChunks.toLocaleString()} chunks)...`);
      }
    }

    s.message('Exporting data/index/chunks.jsonl for GCP GPU BGE-M3 batch...');
    mkdirSync(DEFAULT_INDEX_DIR, { recursive: true });
    const allChunks = idx.getAllChunksForExport();
    const stream = createWriteStream(join(DEFAULT_INDEX_DIR, 'chunks.jsonl'), { encoding: 'utf8' });
    for (const ch of allChunks) {
      stream.write(`${JSON.stringify(ch)}\n`);
    }
    await new Promise<void>((res, rej) => {
      stream.on('finish', () => res());
      stream.on('error', rej);
      stream.end();
    });

    const counts = idx.getCounts();
    idx.close();

    s.stop(color.green(`Chunking & FTS5 indexing complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`));
    p.note(
      [
        `${color.dim('Newly chunked articles:')} ${color.green(addedArticles.toLocaleString())} (+${totalNewChunks.toLocaleString()} chunks)`,
        `${color.dim('Total indexed articles:')} ${color.white(counts.articles.toLocaleString())}`,
        `${color.dim('Total indexed chunks:')}   ${color.white(counts.chunks.toLocaleString())}`,
        `${color.dim('GCP input file:')}         ${color.cyan('data/index/chunks.jsonl')}`,
      ].join('\n'),
      'Index Summary'
    );
    p.outro(color.dim('Next: run tools/backfill/gcp/run-gcp-embed.sh to embed chunks on GCP GPU.'));
  });

// ==========================================
// Command: import-vectors
// ==========================================
program
  .command('import-vectors')
  .description('Imports binary float32 vectors from GCP GPU run and computes article centroid vectors')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--manifest <path>', 'Path to manifest.json', join(DEFAULT_INDEX_DIR, 'manifest.json'))
  .option('--bin <path>', 'Path to vectors.f32.bin', join(DEFAULT_INDEX_DIR, 'vectors.f32.bin'))
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Import BGE-M3 Vectors ')));

    const s = p.spinner();
    s.start('Loading manifest and binary Float32Array vectors...');

    const manifest = JSON.parse(readFileSync(opts.manifest, 'utf8')) as {
      dims: number;
      embeddingVersion: string;
      chunkIds: string[];
    };
    const binBuf = readFileSync(opts.bin);
    const alignedBuf =
      binBuf.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
        ? binBuf
        : new Uint8Array(binBuf);
    const floats = new Float32Array(
      alignedBuf.buffer,
      alignedBuf.byteOffset,
      alignedBuf.byteLength / Float32Array.BYTES_PER_ELEMENT
    );

    const dims = manifest.dims;
    const expectedLen = manifest.chunkIds.length * dims;
    if (floats.length !== expectedLen) {
      s.stop(color.red(`Vector length mismatch: got ${floats.length}, expected ${expectedLen}`));
      process.exit(1);
    }

    const idx = new IndexDatabase(opts.index);
    const batchSize = 2000;

    for (let i = 0; i < manifest.chunkIds.length; i += batchSize) {
      const batch: Array<{
        chunkId: string;
        dims: number;
        embeddingVersion: string;
        vector: Float32Array;
      }> = [];
      const end = Math.min(i + batchSize, manifest.chunkIds.length);
      for (let j = i; j < end; j++) {
        const vec = floats.subarray(j * dims, (j + 1) * dims);
        batch.push({
          chunkId: manifest.chunkIds[j]!,
          dims,
          embeddingVersion: manifest.embeddingVersion,
          vector: vec,
        });
      }
      idx.saveChunkVectorsBatch(batch);
      s.message(`Imported ${end.toLocaleString()} / ${manifest.chunkIds.length.toLocaleString()} chunk vectors...`);
    }

    s.message('Computing weighted article centroid vectors...');
    const rows = idx.getArticleChunksWithVectors();
    let currentArticleId: string | null = null;
    let currentVecs: Float32Array[] = [];
    let currentVer = manifest.embeddingVersion;
    let articleCount = 0;

    for (const r of rows) {
      const vec = new Float32Array(
        r.vectorBlob.buffer,
        r.vectorBlob.byteOffset,
        r.vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      if (currentArticleId && r.articleId !== currentArticleId) {
        const centroid = computeArticleCentroid(currentVecs);
        idx.saveArticleVector(currentArticleId, dims, currentVer, centroid);
        articleCount++;
        currentVecs = [];
      }
      currentArticleId = r.articleId;
      currentVer = r.embeddingVersion;
      currentVecs.push(vec);
    }
    if (currentArticleId && currentVecs.length > 0) {
      const centroid = computeArticleCentroid(currentVecs);
      idx.saveArticleVector(currentArticleId, dims, currentVer, centroid);
      articleCount++;
    }

    idx.close();
    s.stop(color.green(`Imported ${manifest.chunkIds.length.toLocaleString()} chunk vectors & ${articleCount.toLocaleString()} article centroids.`));
    p.outro(color.dim('Next: run `bun run backfill cluster` to build cross-outlet event clusters.'));
  });

// ==========================================
// Command: cluster
// ==========================================
program
  .command('cluster')
  .description('Builds ±4 day cross-outlet similarity edges and centroid-guarded event clusters')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--window-days <number>', 'Time window in days', (v) => parseInt(v, 10), 4)
  .option('--edge-threshold <number>', 'Minimum cosine similarity for graph edge', (v) => parseFloat(v), 0.78)
  .option('--centroid-threshold <number>', 'Minimum cosine similarity to cluster centroid', (v) => parseFloat(v), 0.80)
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Cross-Outlet Event Clustering ')));
    const totalStart = Date.now();

    const loadSpinner = p.spinner();
    loadSpinner.start('Loading article centroid vectors from index.sqlite...');

    const idx = new IndexDatabase(opts.index);
    const rows = idx.getEmbeddedArticles();
    if (rows.length === 0) {
      loadSpinner.stop(color.yellow('No article vectors found. Run `import-vectors` first.'));
      idx.close();
      return;
    }

    const records: ArticleVectorRecord[] = rows.map((r) => ({
      articleId: r.articleId,
      outlet: r.outlet,
      title: r.title,
      lead: r.lead,
      publishedAt: r.publishedAt,
      vector: new Float32Array(
        r.vectorBlob.buffer,
        r.vectorBlob.byteOffset,
        r.vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
      ),
    }));
    loadSpinner.stop(
      color.green(`Loaded ${records.length.toLocaleString()} article centroid vectors in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`)
    );

    // Stage 2: Similarity edge construction
    const edgeStart = Date.now();
    const edgeBar = p.progress({ style: 'block', max: records.length, size: 28 });
    let lastEdgeProcessed = 0;
    edgeBar.start(`Building ±${opts.windowDays}d similarity edges (0/${records.length.toLocaleString()})`);

    const edges = await buildTemporalSimilarityEdgesAsync(records, {
      windowDays: opts.windowDays,
      minSimilarity: opts.edgeThreshold,
      topKPerArticle: 8,
      onProgress: ({ processed, total, matchedPairs }) => {
        const delta = Math.max(0, processed - lastEdgeProcessed);
        lastEdgeProcessed = processed;
        const elapsedSec = Math.max((Date.now() - edgeStart) / 1000, 0.001);
        const rate = processed / elapsedSec;
        const etaSec = Math.max(0, (total - processed) / Math.max(rate, 0.1));
        const pct = ((processed / total) * 100).toFixed(1);
        edgeBar.advance(
          delta,
          `${pct}% · ${processed.toLocaleString()}/${total.toLocaleString()} · ${Math.round(rate).toLocaleString()} art/s · ETA ${Math.ceil(etaSec)}s · ${matchedPairs.toLocaleString()} hits`
        );
      },
    });
    edgeBar.stop(
      color.green(
        `Built ${edges.length.toLocaleString()} similarity edges in ${((Date.now() - edgeStart) / 1000).toFixed(1)}s`
      )
    );

    // Stage 3: Centroid-guarded event clustering
    const clusterStart = Date.now();
    const clusterBar = p.progress({ style: 'block', max: 100, size: 28 });
    let lastPct = 0;
    clusterBar.start(`Clustering graph nodes (centroid >= ${opts.centroidThreshold})...`);

    const { clusters, articleToCluster } = await clusterArticlesBySimilarityAsync(records, edges, {
      centroidThreshold: opts.centroidThreshold,
      minClusterSize: 2,
      onProgress: ({ processed, total, clustersFormed, clusteredArticles }) => {
        const pct = total > 0 ? Math.min(100, Math.floor((processed / total) * 100)) : 100;
        const delta = Math.max(0, pct - lastPct);
        lastPct = pct;
        clusterBar.advance(
          delta,
          `${pct}% · ${processed.toLocaleString()}/${total.toLocaleString()} nodes · ${clustersFormed.toLocaleString()} clusters (${clusteredArticles.toLocaleString()} articles)`
        );
      },
    });
    clusterBar.stop(
      color.green(
        `Formed ${clusters.length.toLocaleString()} event clusters (${articleToCluster.size.toLocaleString()} articles) in ${((Date.now() - clusterStart) / 1000).toFixed(1)}s`
      )
    );

    // Stage 4: Persist to SQLite
    const saveStart = Date.now();
    const saveSpinner = p.spinner();
    saveSpinner.start(
      `Writing ${edges.length.toLocaleString()} edges & ${clusters.length.toLocaleString()} clusters to index.sqlite...`
    );
    idx.saveClustersAndEdges(edges, clusters, articleToCluster);
    idx.close();
    saveSpinner.stop(
      color.green(`Saved clusters & edges to index.sqlite in ${((Date.now() - saveStart) / 1000).toFixed(1)}s`)
    );

    const multiOutletClusters = clusters.filter((c) => c.outlets.length >= 2).length;
    p.note(
      [
        `${color.dim('Similarity edges:')}      ${color.white(edges.length.toLocaleString())}`,
        `${color.dim('Event clusters:')}        ${color.white(clusters.length.toLocaleString())}`,
        `${color.dim('Multi-outlet events:')}   ${color.green(multiOutletClusters.toLocaleString())}`,
        `${color.dim('Clustered articles:')}    ${color.cyan(articleToCluster.size.toLocaleString())}`,
        `${color.dim('Total elapsed:')}         ${color.white(`${((Date.now() - totalStart) / 1000).toFixed(1)}s`)}`,
      ].join('\n'),
      'Cluster Summary'
    );
    p.outro(color.dim('Ready to explore locally via `apps/api` + `apps/web` or export to Cloudflare D1.'));
  });

// ==========================================
// Command: export-vectorize
// ==========================================
program
  .command('export-vectorize')
  .description('Exports chunk vectors to Vectorize-ready NDJSON batches in data/index/vectorize/')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--batch-size <number>', 'Vectors per NDJSON file', (v) => parseInt(v, 10), 5000)
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Export Vectorize NDJSON ')));
    const s = p.spinner();
    s.start('Reading chunk vectors from index.sqlite...');

    const outDir = join(DEFAULT_INDEX_DIR, 'vectorize');
    mkdirSync(outDir, { recursive: true });

    const idx = new IndexDatabase(opts.index);
    const db = idx.getRawDb();
    const rows = db
      .prepare(
        `SELECT cv.chunk_id as id, c.outlet, c.article_id as articleId, cv.vector_blob as blob
         FROM chunk_vector cv
         JOIN chunk c ON c.id = cv.chunk_id`
      )
      .all() as Array<{ id: string; outlet: string; articleId: string; blob: Uint8Array }>;

    let fileIdx = 0;
    let lines: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const vec = Array.from(
        new Float32Array(r.blob.buffer, r.blob.byteOffset, r.blob.byteLength / Float32Array.BYTES_PER_ELEMENT)
      ).map((v) => Number(v.toFixed(6)));
      lines.push(
        JSON.stringify({
          id: r.id,
          values: vec,
          metadata: { outlet: r.outlet, articleId: r.articleId },
        })
      );

      if (lines.length >= opts.batchSize || i === rows.length - 1) {
        const file = join(outDir, `batch-${String(fileIdx).padStart(4, '0')}.ndjson`);
        writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
        fileIdx++;
        lines = [];
      }
    }

    idx.close();
    s.stop(color.green(`Exported ${rows.length.toLocaleString()} vectors across ${fileIdx} NDJSON files in ${outDir}/`));
    p.outro(color.dim('Upload with: wrangler vectorize insert jachaikori-chunks --file=<batch.ndjson>'));
  });

await program.parseAsync(process.argv);
