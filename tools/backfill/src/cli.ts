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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  buildFtsMatchQuery,
  buildTemporalSimilarityEdgesAsync,
  chunkArticle,
  clusterArticlesBySimilarityAsync,
  computeArticleCentroid,
  normalizeBanglaForFts,
  type ArticleVectorRecord,
} from '@jachaikori/retrieval';
import {
  buildSeedRegistry,
  discoverRecurringHeadlineEntities,
  EntityHypergraphResolver,
  normalizeText,
} from '@jachaikori/entities';
import {
  LlmArticleExtractionSchema,
  type ArticleEntityMention,
  type Entity,
  type EntityAlias,
  type EntityRelation,
  type OutletId,
} from '@jachaikori/schema';
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
  .description('Imports binary float32 vectors from single or sharded GCP GPU runs and computes article centroids')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--shards-dir <path>', 'Directory containing sharded part-*.manifest.json & part-*.f32.bin files', join(DEFAULT_INDEX_DIR, 'shards/latest'))
  .option('--manifest <path>', 'Path to single manifest.json (fallback when no shards present)', join(DEFAULT_INDEX_DIR, 'manifest.json'))
  .option('--bin <path>', 'Path to single vectors.f32.bin (fallback when no shards present)', join(DEFAULT_INDEX_DIR, 'vectors.f32.bin'))
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Import BGE-M3 Vectors ')));

    const s = p.spinner();
    s.start('Locating manifest and binary Float32Array vectors...');

    const pairs: Array<{ label: string; manifestPath: string; binPath: string }> = [];
    if (opts.shardsDir && existsSync(opts.shardsDir)) {
      const shardManifests = readdirSync(opts.shardsDir)
        .filter((f) => /^part-\d+\.manifest\.json$/.test(f))
        .sort();
      for (const mf of shardManifests) {
        const binName = mf.replace(/\.manifest\.json$/, '.f32.bin');
        const binPath = join(opts.shardsDir, binName);
        if (!existsSync(binPath)) {
          s.stop(color.red(`Missing binary file for shard ${mf}: ${binPath}`));
          process.exit(1);
        }
        pairs.push({
          label: mf.replace(/\.manifest\.json$/, ''),
          manifestPath: join(opts.shardsDir, mf),
          binPath,
        });
      }
    }

    if (pairs.length === 0) {
      if (!existsSync(opts.manifest) || !existsSync(opts.bin)) {
        s.stop(color.red(`No vector shards found in ${opts.shardsDir} and missing ${opts.manifest} / ${opts.bin}`));
        process.exit(1);
      }
      pairs.push({ label: 'single', manifestPath: opts.manifest, binPath: opts.bin });
    }

    const idx = new IndexDatabase(opts.index);
    const batchSize = 2000;
    let totalImported = 0;
    let detectedDims = 1024;
    let detectedVer = 'bge-m3-v1';

    for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
      const pair = pairs[pIdx]!;
      const manifest = JSON.parse(readFileSync(pair.manifestPath, 'utf8')) as {
        dims: number;
        embeddingVersion: string;
        chunkIds: string[];
      };
      const binBuf = readFileSync(pair.binPath);
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
      detectedDims = dims;
      detectedVer = manifest.embeddingVersion;
      const expectedLen = manifest.chunkIds.length * dims;
      if (floats.length !== expectedLen) {
        s.stop(color.red(`Vector length mismatch in ${pair.label}: got ${floats.length}, expected ${expectedLen}`));
        process.exit(1);
      }

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
        totalImported += batch.length;
        s.message(
          `[${pair.label} ${pIdx + 1}/${pairs.length}] Imported ${totalImported.toLocaleString()} chunk vectors...`
        );
      }
    }

    s.message('Computing weighted article centroid vectors...');
    const rows = idx.getArticleChunksWithVectors();
    let currentArticleId: string | null = null;
    let currentVecs: Float32Array[] = [];
    let currentVer = detectedVer;
    let articleCount = 0;

    for (const r of rows) {
      const vec = new Float32Array(
        r.vectorBlob.buffer,
        r.vectorBlob.byteOffset,
        r.vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      if (currentArticleId && r.articleId !== currentArticleId) {
        const centroid = computeArticleCentroid(currentVecs);
        idx.saveArticleVector(currentArticleId, detectedDims, currentVer, centroid);
        articleCount++;
        currentVecs = [];
      }
      currentArticleId = r.articleId;
      currentVer = r.embeddingVersion;
      currentVecs.push(vec);
    }
    if (currentArticleId && currentVecs.length > 0) {
      const centroid = computeArticleCentroid(currentVecs);
      idx.saveArticleVector(currentArticleId, detectedDims, currentVer, centroid);
      articleCount++;
    }

    idx.close();
    s.stop(
      color.green(
        `Imported ${totalImported.toLocaleString()} chunk vectors (${pairs.length} shard${pairs.length === 1 ? '' : 's'}) & ${articleCount.toLocaleString()} article centroids.`
      )
    );
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

// ==========================================
// Command: resolve-entities
// ==========================================
program
  .command('resolve-entities')
  .description('Resolves canonical entities, temporal roles, and sentence-level hypergraph relations across all articles')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--min-discovered <number>', 'Minimum headline speaker mentions to auto-promote emergent entities', (v) => parseInt(v, 10), 8)
  .option('--seed-only', 'Only use curated entity registry without dynamic title-speaker discovery', false)
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Entity Resolution & Hypergraph Builder ')));
    const totalStart = Date.now();

    const loadSpinner = p.spinner();
    loadSpinner.start('Loading articles and compiling entity registry...');
    const idx = new IndexDatabase(opts.index);
    const articles = idx.getAllArticlesForEntities();

    if (articles.length === 0) {
      loadSpinner.stop(color.yellow('No articles in index.sqlite. Run `bun run backfill chunk` first.'));
      idx.close();
      return;
    }

    const seed = buildSeedRegistry();
    const discovered = opts.seedOnly
      ? { entities: [], aliases: [] }
      : discoverRecurringHeadlineEntities(
          articles.map((a) => a.title),
          { minMentions: opts.minDiscovered, existingAliases: seed.aliases }
        );

    const allEntities = [...seed.entities, ...discovered.entities];
    const allAliases = [...seed.aliases, ...discovered.aliases];
    idx.replaceEntityRegistryAndClearHypergraph(allEntities, allAliases);
    const resolver = new EntityHypergraphResolver(allEntities, allAliases);

    loadSpinner.stop(
      color.green(
        `Loaded ${articles.length.toLocaleString()} articles · ${allEntities.length} entities (${seed.entities.length} curated + ${discovered.entities.length} discovered)`
      )
    );

    const bar = p.progress({ style: 'block', max: articles.length, size: 28 });
    bar.start(`Resolving entities & hypergraph edges (0/${articles.length.toLocaleString()})`);

    let mentionBatch: ArticleEntityMention[] = [];
    let relationBatch: EntityRelation[] = [];
    let totalMentions = 0;
    let totalRelations = 0;
    let articlesWithEntities = 0;
    let lastUpdated = 0;
    let lastYieldAt = Date.now();
    const resolveStart = Date.now();

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i]!;
      const res = resolver.resolveArticle(art);

      if (res.mentions.length > 0) {
        articlesWithEntities++;
        totalMentions += res.mentions.length;
        totalRelations += res.relations.length;
        for (const m of res.mentions) mentionBatch.push(m);
        for (const r of res.relations) relationBatch.push(r);
      }

      if (mentionBatch.length >= 4000 || relationBatch.length >= 4000 || i === articles.length - 1) {
        if (mentionBatch.length > 0 || relationBatch.length > 0) {
          idx.saveEntityHypergraphBatch(mentionBatch, relationBatch);
          mentionBatch = [];
          relationBatch = [];
        }
      }

      const processed = i + 1;
      const isLast = processed === articles.length;
      if (isLast || (processed % 250 === 0 && Date.now() - lastYieldAt >= 80)) {
        const delta = processed - lastUpdated;
        lastUpdated = processed;
        const elapsedSec = Math.max((Date.now() - resolveStart) / 1000, 0.001);
        const rate = processed / elapsedSec;
        const eta = Math.max(0, (articles.length - processed) / Math.max(rate, 1));
        const pct = ((processed / articles.length) * 100).toFixed(1);
        bar.advance(
          delta,
          `${pct}% · ${processed.toLocaleString()}/${articles.length.toLocaleString()} · ${Math.round(rate).toLocaleString()} art/s · ETA ${Math.ceil(eta)}s · ${totalMentions.toLocaleString()} mentions · ${totalRelations.toLocaleString()} relations`
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldAt = Date.now();
      }
    }

    bar.stop(
      color.green(
        `Resolved ${totalMentions.toLocaleString()} entity mentions & ${totalRelations.toLocaleString()} relations in ${((Date.now() - resolveStart) / 1000).toFixed(1)}s`
      )
    );
    idx.close();

    p.note(
      [
        `${color.dim('Canonical entities:')}       ${color.white(allEntities.length.toLocaleString())} (${discovered.entities.length} auto-discovered)`,
        `${color.dim('Articles linked:')}          ${color.cyan(articlesWithEntities.toLocaleString())} / ${articles.length.toLocaleString()}`,
        `${color.dim('Entity mentions:')}          ${color.white(totalMentions.toLocaleString())}`,
        `${color.dim('Hypergraph relations:')}     ${color.green(totalRelations.toLocaleString())}`,
        `${color.dim('Total elapsed:')}            ${color.white(`${((Date.now() - totalStart) / 1000).toFixed(1)}s`)}`,
      ].join('\n'),
      'Entity Hypergraph Summary'
    );
    p.outro(color.dim('Explore in the Web UI under the "Entity Hypergraph" mode!'));
  });

// ==========================================
// Command: prepare-llm-extract
// ==========================================
program
  .command('prepare-llm-extract')
  .description('Prepares Vertex AI Batch requests.jsonl for LLM entity & claim extraction, prioritizing multi-outlet clusters')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--out <path>', 'Output requests.jsonl path', join(DEFAULT_INDEX_DIR, 'requests.jsonl'))
  .option('--limit <number>', 'Optional max number of articles to export', (v) => parseInt(v, 10))
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Prepare LLM Extraction Batch ')));
    const idx = new IndexDatabase(opts.index);
    const articles = idx.getArticlesForLlmExtract(opts.limit);

    if (articles.length === 0) {
      p.log.warn('No articles found in index.sqlite.');
      idx.close();
      return;
    }

    mkdirSync(dirname(opts.out), { recursive: true });
    const stream = createWriteStream(opts.out, { encoding: 'utf8' });

    let totalInputChars = 0;
    let multiOutletCount = 0;

    for (const art of articles) {
      if (art.outletCount >= 2) multiOutletCount++;
      const candidates = idx.getKnownCandidatesForArticle(art.id, art.clusterId);
      const rawBody = (art.cleanText || art.lead || '').trim();
      const truncatedBody = rawBody.length > 1800 ? `${rawBody.slice(0, 1800)}...` : rawBody;

      const prompt = [
        'Extract canonical entities (with bilingual canonicalBn/canonicalEn) and factual claims from this news article.',
        'Match against KNOWN_CANDIDATES when possible (set entityId to the matching id, otherwise null).',
        `KNOWN_CANDIDATES: ${JSON.stringify(candidates)}`,
        `ARTICLE_ID: ${art.id}`,
        `PUBLISHED_AT: ${art.publishedAt ?? 'unknown'}`,
        `TITLE: ${art.title}`,
        `BODY: ${truncatedBody}`,
      ].join('\n');

      totalInputChars += prompt.length;

      const batchLine = {
        custom_id: art.id,
        request: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        },
      };
      stream.write(`${JSON.stringify(batchLine)}\n`);
    }

    await new Promise<void>((resolveStream) => stream.end(resolveStream));
    idx.close();

    const estInputTokens = Math.ceil(totalInputChars / 4);
    const estOutputTokens = articles.length * 350;
    const estCostUsd = (estInputTokens / 1_000_000) * 0.075 + (estOutputTokens / 1_000_000) * 0.30;

    p.note(
      [
        `${color.dim('Articles exported:')}        ${color.white(articles.length.toLocaleString())} (${multiOutletCount.toLocaleString()} in outlet_count >= 2 clusters)`,
        `${color.dim('Output file:')}              ${color.cyan(opts.out)}`,
        `${color.dim('Est. input tokens:')}        ${color.white(estInputTokens.toLocaleString())}`,
        `${color.dim('Est. output tokens:')}       ${color.white(estOutputTokens.toLocaleString())}`,
        `${color.dim('Est. Batch cost (USD):')}    ${color.green(`$${estCostUsd.toFixed(4)}`)}`,
      ].join('\n'),
      'Vertex Batch Export Summary'
    );
    p.outro(color.dim('Run tools/backfill/gcp/run-gcp-extract.sh --pilot 200 to execute.'));
  });

// ==========================================
// Command: ingest-llm-extract
// ==========================================
program
  .command('ingest-llm-extract')
  .description('Zod-validates llm-extractions.jsonl, consolidates bilingual entities, and upserts entities, aliases, mentions, and claims')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .option('--input <path>', 'Input llm-extractions.jsonl path', join(DEFAULT_INDEX_DIR, 'llm-extractions.jsonl'))
  .action(async (opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Ingest LLM Extractions ')));
    const raw = readFileSync(opts.input, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const idx = new IndexDatabase(opts.index);
    const existingEntityTypes = new Map<string, Entity['entityType']>();
    for (const row of idx.getRawDb().prepare('SELECT id, entity_type as entityType FROM entity').all() as Array<{ id: string; entityType: Entity['entityType'] }>) {
      existingEntityTypes.set(row.id, row.entityType);
    }

    const inferEntityType = (rawType: unknown, bn?: string | null, en?: string | null): Entity['entityType'] => {
      if (rawType === 'person' || rawType === 'org' || rawType === 'location' || rawType === 'role' || rawType === 'event_topic') {
        return rawType;
      }
      const combined = `${en ?? ''} ${bn ?? ''}`;
      if (/\b(?:bank|police|court|tribunal|ministry|commission|committee|party|limited|ltd|corp|university|hospital|association|council|league)\b|ব্যাংক|পুলিশ|আদালত|কোর্ট|মন্ত্রণালয়|কমিশন|কমিটি|পার্টি|লীগ|দল|লিমিটেড|বিশ্ববিদ্যালয়|হাসপাতাল/i.test(combined)) {
        return 'org';
      }
      return 'person';
    };

    const promotedEntities = new Map<string, Entity>();
    const promotedAliases = new Map<string, EntityAlias>();
    const mentions: ArticleEntityMention[] = [];
    const claims: Array<{
      id: string;
      articleId: string;
      claimText: string;
      claimType: string;
      subjectEntityId: string | null;
      objectEntityId: string | null;
      evidenceSnippet: string | null;
      confidence: number;
    }> = [];

    let validRows = 0;
    let invalidRows = 0;

    for (const line of lines) {
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(line);
      } catch {
        invalidRows++;
        continue;
      }

      const articleId = parsedJson.articleId ?? parsedJson.custom_id;
      let payload = parsedJson.extraction ?? parsedJson;
      if (Array.isArray(payload)) {
        payload = payload[0] ?? {};
      }
      if (!payload || typeof payload !== 'object') {
        invalidRows++;
        continue;
      }

      const rawEntities = Array.isArray(payload.entities) ? payload.entities : [];
      const normalizedEntities = rawEntities
        .filter((e: any) => e && typeof e === 'object')
        .map((e: any) => {
          const rawId = typeof e.entityId === 'string' ? e.entityId : typeof e.id === 'string' ? e.id : null;
          const validExistingId = rawId && existingEntityTypes.has(rawId) ? rawId : null;
          const canonicalBn = typeof e.canonicalBn === 'string' && e.canonicalBn.trim() ? e.canonicalBn.trim() : null;
          const canonicalEn = typeof e.canonicalEn === 'string' && e.canonicalEn.trim() ? e.canonicalEn.trim() : null;
          const surfaceForm =
            (typeof e.surfaceForm === 'string' && e.surfaceForm.trim()) ||
            canonicalBn ||
            canonicalEn ||
            '';
          return {
            entityId: validExistingId,
            canonicalBn,
            canonicalEn,
            entityType: validExistingId
              ? existingEntityTypes.get(validExistingId)!
              : inferEntityType(e.entityType, canonicalBn, canonicalEn),
            surfaceForm,
            role: e.role ?? 'mentioned',
            confidence: typeof e.confidence === 'number' ? e.confidence : 0.85,
          };
        })
        .filter((e: any) => e.surfaceForm.length > 0);

      const rawClaims = Array.isArray(payload.claims) ? payload.claims : [];
      const normalizedClaims = rawClaims
        .map((c: any) => {
          if (typeof c === 'string') {
            return c.trim() ? { claimText: c.trim() } : null;
          }
          if (!c || typeof c !== 'object') return null;
          const claimText = [c.claimText, c.claimTextBn, c.claimBn, c.claim, c.statement, c.fact, c.claimSentence, c.claimEn]
            .find((v) => typeof v === 'string' && v.trim().length > 0);
          if (!claimText) return null;
          const evidenceSnippet = [c.evidenceSnippet, c.evidence, c.supportingQuote, c.supportingText, c.supporting_text, c.sourceText]
            .find((v) => typeof v === 'string' && v.trim().length > 0) ?? null;
          const subjId = typeof c.subjectEntityId === 'string' && existingEntityTypes.has(c.subjectEntityId) ? c.subjectEntityId : null;
          const objId = typeof c.objectEntityId === 'string' && existingEntityTypes.has(c.objectEntityId) ? c.objectEntityId : null;
          return {
            claimText: claimText.trim(),
            claimType: typeof c.claimType === 'string' ? c.claimType : typeof c.category === 'string' ? c.category : 'factual',
            subjectEntityId: subjId,
            objectEntityId: objId,
            evidenceSnippet,
            confidence: typeof c.confidence === 'number' ? c.confidence : 0.85,
          };
        })
        .filter(Boolean);

      const validated = LlmArticleExtractionSchema.safeParse({
        articleId,
        entities: normalizedEntities,
        claims: normalizedClaims,
      });
      if (!validated.success || !articleId) {
        invalidRows++;
        continue;
      }

      validRows++;
      const data = validated.data;

      for (const ent of data.entities) {
        let resolvedId = ent.entityId;
        if (!resolvedId) {
          const keySource = `${ent.entityType}|${(ent.canonicalEn || ent.canonicalBn || ent.surfaceForm).trim().toLowerCase()}`;
          const hash = createHash('sha1').update(keySource).digest('hex').slice(0, 12);
          resolvedId = `ent_llm_${hash}`;

          if (!promotedEntities.has(resolvedId)) {
            promotedEntities.set(resolvedId, {
              id: resolvedId,
              canonicalBn: ent.canonicalBn ?? null,
              canonicalEn: ent.canonicalEn ?? null,
              entityType: ent.entityType,
              metadataJson: JSON.stringify({ source: 'llm-extract' }),
            });
          }

          for (const rawAlias of [ent.canonicalBn, ent.canonicalEn, ent.surfaceForm]) {
            if (!rawAlias) continue;
            const norm = normalizeText(rawAlias).toLowerCase();
            if (!norm) continue;
            const aliasKey = `${norm}|${resolvedId}`;
            if (!promotedAliases.has(aliasKey)) {
              promotedAliases.set(aliasKey, {
                aliasNorm: norm,
                aliasRaw: rawAlias,
                entityId: resolvedId,
                validFrom: null,
                validTo: null,
              });
            }
          }
        }

        mentions.push({
          articleId,
          entityId: resolvedId,
          chunkId: null,
          surfaceForm: ent.surfaceForm,
          role: ent.role,
          confidence: ent.confidence,
        });
      }

      for (let ci = 0; ci < data.claims.length; ci++) {
        const c = data.claims[ci]!;
        const claimHash = createHash('sha1').update(`${articleId}|${ci}|${c.claimText}`).digest('hex').slice(0, 14);
        claims.push({
          id: `clm_${claimHash}`,
          articleId,
          claimText: c.claimText,
          claimType: c.claimType,
          subjectEntityId: c.subjectEntityId ?? null,
          objectEntityId: c.objectEntityId ?? null,
          evidenceSnippet: c.evidenceSnippet ?? null,
          confidence: c.confidence,
        });
      }
    }

    idx.upsertLlmExtractionBatch({
      entities: Array.from(promotedEntities.values()),
      aliases: Array.from(promotedAliases.values()),
      mentions,
      claims,
    });
    idx.close();

    p.note(
      [
        `${color.dim('Valid articles:')}           ${color.green(validRows.toLocaleString())} (${invalidRows} skipped)`,
        `${color.dim('Promoted entities:')}        ${color.white(promotedEntities.size.toLocaleString())}`,
        `${color.dim('Entity mentions:')}          ${color.white(mentions.length.toLocaleString())}`,
        `${color.dim('Claims upserted:')}          ${color.cyan(claims.length.toLocaleString())}`,
      ].join('\n'),
      'LLM Extraction Ingest Summary'
    );
    p.outro(color.dim('Done!'));
  });

// ==========================================
// Command: materialize-events
// ==========================================
program
  .command('materialize-events')
  .description('Aggregates article_entity + article_cluster into event_entity for the event-centric visualizer')
  .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
  .action((opts) => {
    p.intro(color.bgCyan(color.black(' Jachaikori · Materialize Event-Entity Hypergraph ')));
    const s = p.spinner();
    s.start('Materializing event_entity incidence rows...');

    const startedAt = Date.now();
    const idx = new IndexDatabase(opts.index);
    const stats = idx.materializeEventEntities();
    idx.close();

    s.stop(
      color.green(
        `Materialized ${stats.eventEntityRows.toLocaleString()} event_entity rows across ${stats.eventsCovered.toLocaleString()} events in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
      )
    );
    p.outro(color.dim('Ready for /entities/:id/ego, /entities/:id/activity, and /events/:id/graph!'));
  });

await program.parseAsync(process.argv);
