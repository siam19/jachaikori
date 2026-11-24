/**
 * @file tools/backfill/src/entity-cli.ts
 * Sprint 5 Entity Resolution v2 CLI commands registered on the backfill Commander program:
 * - sync-seed                (YAML seed validation + one-way sync into index.sqlite)
 * - mine-candidates          (Stream 211k articles -> UnlinkedMentions -> entity_candidate)
 * - prepare-candidate-batch  / ingest-candidate-batch   (Stage A: Vertex Batch long-tail entity discovery)
 * - resolve-entities         (Streaming v2 resolver over 211k articles with article_resolution stamping)
 * - prepare-merge-batch      / ingest-merge-batch       (Stage A2: Cross-script & variant dedup judge)
 * - prepare-event-batch      / ingest-event-batch       (Stage B: 17-type directional relations + claims)
 * - prepare-dossier-batch    / ingest-dossier-batch     (Stage C: Corpus-grounded bilingual entity bios)
 * - materialize-events       (event_entity + entity stats + dynamic hub flags)
 * - entities-diagnose, entities-prune, entities-merge, entities-unmerge, entities-reject
 */

import * as p from '@clack/prompts';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import color from 'picocolors';
import {
  compileRegistry,
  DEFAULT_MERGE_POLICY,
  DEFAULT_PROMOTION_POLICY,
  evaluateAutoMerge,
  evaluateCandidatePromotion,
  isSafeAutoAlias,
  normalizePhrase,
  normalizeText,
  resolveArticle,
  RESOLVER_VERSION,
  type ExistingAliasRef,
} from '@jachaikori/entities';
import {
  CANONICAL_RELATION_TYPES,
  LlmArticleExtractionSchema,
  LlmCandidateVerdictItemSchema,
  LlmEntityDossierSchema,
  normalizeRelationType,
  type ArticleEntityMention,
  type Entity,
  type EntityAlias,
  type EntityCandidate,
  type EntityRelation,
  type EntityType,
} from '@jachaikori/schema';
import { IndexDatabase } from './db';
import { exportBuiltinSeedToYaml, loadAndValidateSeedYaml } from './seed-yaml';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const DEFAULT_INDEX_DIR = join(REPO_ROOT, 'data/index');
const DEFAULT_INDEX = join(DEFAULT_INDEX_DIR, 'index.sqlite');
const DEFAULT_SEED_YAML = join(REPO_ROOT, 'registry/seed.yaml');

function stableHash(input: string, len = 12): string {
  return createHash('sha1').update(input).digest('hex').slice(0, len);
}

function trigramJaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const clean = normalizePhrase(s);
    const out = new Set<string>();
    if (clean.length < 3) {
      if (clean) out.add(clean);
      return out;
    }
    for (let i = 0; i <= clean.length - 3; i++) {
      out.add(clean.slice(i, i + 3));
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

// ==========================================
// Vertex AI Response Schemas (Strict JSON)
// ==========================================

const STAGE_A_CANDIDATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdicts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          aliasNorm: { type: 'STRING' },
          isNamedEntity: { type: 'BOOLEAN' },
          entityType: {
            type: 'STRING',
            enum: ['person', 'org', 'location', 'role', 'event_topic'],
            nullable: true,
          },
          canonicalBn: { type: 'STRING', nullable: true },
          canonicalEn: { type: 'STRING', nullable: true },
          aliases: { type: 'ARRAY', items: { type: 'STRING' } },
          sameAsEntityId: { type: 'STRING', nullable: true },
          shortTaglineBn: { type: 'STRING', nullable: true },
          shortTaglineEn: { type: 'STRING', nullable: true },
          descriptionBn: { type: 'STRING', nullable: true },
          descriptionEn: { type: 'STRING', nullable: true },
          affiliatedOrg: { type: 'STRING', nullable: true },
          confidence: { type: 'NUMBER' },
        },
        required: ['aliasNorm', 'isNamedEntity', 'confidence'],
      },
    },
  },
  required: ['verdicts'],
};

const STAGE_A2_MERGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    decisions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pairId: { type: 'STRING' },
          sameEntity: { type: 'BOOLEAN' },
          keepEntityId: { type: 'STRING', nullable: true },
          confidence: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
        required: ['pairId', 'sameEntity', 'confidence', 'reason'],
      },
    },
  },
  required: ['decisions'],
};

const STAGE_B_EVENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    relations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sourceName: { type: 'STRING' },
          targetName: { type: 'STRING' },
          relationType: { type: 'STRING', enum: [...CANONICAL_RELATION_TYPES] },
          predicateLabel: { type: 'STRING' },
          evidenceSnippet: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['sourceName', 'targetName', 'relationType', 'predicateLabel', 'evidenceSnippet'],
      },
    },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claimText: { type: 'STRING' },
          claimType: { type: 'STRING' },
          speakerName: { type: 'STRING', nullable: true },
          subjectName: { type: 'STRING', nullable: true },
          objectName: { type: 'STRING', nullable: true },
          numbers: { type: 'ARRAY', items: { type: 'STRING' } },
          dates: { type: 'ARRAY', items: { type: 'STRING' } },
          hedgingLevel: { type: 'STRING', enum: ['certain', 'reported', 'hedged', 'conditional'] },
          evidenceSnippet: { type: 'STRING' },
        },
        required: ['claimText', 'evidenceSnippet'],
      },
    },
  },
  required: ['relations', 'claims'],
};

const STAGE_C_DOSSIER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    shortTaglineBn: { type: 'STRING' },
    shortTaglineEn: { type: 'STRING' },
    descriptionBn: { type: 'STRING' },
    descriptionEn: { type: 'STRING' },
    citingArticleIds: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['shortTaglineBn', 'shortTaglineEn', 'descriptionBn', 'descriptionEn', 'citingArticleIds'],
};

export function registerEntityV2Commands(program: Command): void {
  // ==========================================
  // Command: sync-seed
  // ==========================================
  program
    .command('sync-seed')
    .description('Validates registry/seed.yaml (exporting default seed if needed) and syncs seed rows one-way into index.sqlite')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--seed <path>', 'Path to seed YAML', DEFAULT_SEED_YAML)
    .option('--export', 'Export built-in curated seed into registry/seed.yaml first', false)
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Sync Seed Registry (v2) ')));
      if (opts.export || !existsSync(opts.seed)) {
        const exp = exportBuiltinSeedToYaml(opts.seed);
        p.log.success(
          `Exported seed YAML -> ${opts.seed} (${exp.entitiesCount} entities, ${exp.aliasesCount} aliases, ${exp.roleTermsCount} role_terms)`
        );
      }

      const loaded = loadAndValidateSeedYaml(opts.seed);
      if (loaded.errors.length > 0) {
        p.log.error(`Seed validation failed with ${loaded.errors.length} error(s):`);
        for (const err of loaded.errors) {
          console.error(`  [${err.code}] ${err.message}`);
        }
        process.exit(1);
      }

      const idx = new IndexDatabase(opts.index);
      const version = idx.syncSeedRegistry(loaded.entities, loaded.aliases, loaded.roleTerms);
      idx.close();

      p.note(
        [
          `${color.dim('Seed YAML:')}        ${color.cyan(opts.seed)}`,
          `${color.dim('Entities:')}         ${color.white(loaded.entities.length.toLocaleString())}`,
          `${color.dim('Aliases:')}          ${color.white(loaded.aliases.length.toLocaleString())}`,
          `${color.dim('Role Terms:')}       ${color.white(loaded.roleTerms.length.toLocaleString())}`,
          `${color.dim('Registry Version:')} ${color.green(`v${version}`)}`,
        ].join('\n'),
        'Seed Sync Complete'
      );
      p.outro(color.dim('Auto-discovered entities and merge history were preserved untouched.'));
    });

  // ==========================================
  // Command: mine-candidates (Stage A Step 1 — Local CPU across 211k articles)
  // ==========================================
  program
    .command('mine-candidates')
    .description('Streams all articles, extracts UnlinkedMentions, and aggregates recurring entity candidates into entity_candidate')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--min-articles <number>', 'Minimum document frequency to keep candidate', (v) => parseInt(v, 10), 4)
    .option('--min-outlets <number>', 'Minimum distinct outlets to keep candidate', (v) => parseInt(v, 10), 2)
    .option('--max-candidates <number>', 'Maximum candidates to persist', (v) => parseInt(v, 10), 25000)
    .option('--report-only', 'Only print stats and projected Vertex Batch cost without writing to DB', false)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Mine Long-Tail Entity Candidates (211k) ')));
      const started = Date.now();
      const idx = new IndexDatabase(opts.index);

      // Ensure seed is synced before mining so we don't mine already-seeded entities
      if (idx.getCurrentRegistryVersion() === 0) {
        const seed = loadAndValidateSeedYaml(DEFAULT_SEED_YAML);
        idx.syncSeedRegistry(seed.entities, seed.aliases, seed.roleTerms);
      }

      const snapshot = idx.getRegistrySnapshot();
      const compiled = compileRegistry(snapshot);
      const denylist = idx.getDenylistSet();
      const totalArticles = idx.getTotalArticleCount();

      const bar = p.progress({ style: 'block', max: totalArticles, size: 28 });
      bar.start(`Streaming ${totalArticles.toLocaleString()} articles for UnlinkedMentions...`);

      interface CandAgg {
        surfaceRaw: string;
        surfaceCounts: Map<string, number>;
        typeCounts: Map<EntityType, number>;
        docFreq: number;
        outlets: Set<string>;
        days: Set<string>;
        samples: string[];
      }

      const aggMap = new Map<string, CandAgg>();
      let processed = 0;
      let lastReported = 0;
      let lastYield = Date.now();

      for (const batch of idx.streamArticlesForEntities(2000)) {
        for (const art of batch) {
          const out = resolveArticle(art, compiled, { emitUnlinked: true, maxBodySentences: 20 });
          const seenInArticle = new Set<string>();
          const day = art.publishedAt ? art.publishedAt.slice(0, 10) : 'unknown';

          for (const u of out.unlinked) {
            if (!u.normalized || denylist.has(u.normalized)) continue;
            if (seenInArticle.has(u.normalized)) continue;
            seenInArticle.add(u.normalized);

            let agg = aggMap.get(u.normalized);
            if (!agg) {
              agg = {
                surfaceRaw: u.surface,
                surfaceCounts: new Map(),
                typeCounts: new Map(),
                docFreq: 0,
                outlets: new Set(),
                days: new Set(),
                samples: [],
              };
              aggMap.set(u.normalized, agg);
            }
            agg.docFreq++;
            agg.outlets.add(art.outlet);
            agg.days.add(day);
            agg.surfaceCounts.set(u.surface, (agg.surfaceCounts.get(u.surface) ?? 0) + 1);
            agg.typeCounts.set(u.guessedType, (agg.typeCounts.get(u.guessedType) ?? 0) + 1);
            if (agg.samples.length < 4 && !agg.samples.includes(u.contextSnippet)) {
              agg.samples.push(u.contextSnippet);
            }
          }
        }

        processed += batch.length;
        if (processed === totalArticles || Date.now() - lastYield >= 120) {
          const delta = processed - lastReported;
          lastReported = processed;
          const elapsed = Math.max((Date.now() - started) / 1000, 0.1);
          const rate = processed / elapsed;
          const eta = Math.max(0, (totalArticles - processed) / Math.max(rate, 1));
          bar.advance(
            delta,
            `${((processed / totalArticles) * 100).toFixed(1)}% · ${processed.toLocaleString()}/${totalArticles.toLocaleString()} · ${Math.round(rate).toLocaleString()} art/s · ETA ${Math.ceil(eta)}s · ${aggMap.size.toLocaleString()} raw cands`
          );
          await new Promise<void>((r) => setTimeout(r, 0));
          lastYield = Date.now();
        }
      }

      bar.stop(color.green(`Scanned ${processed.toLocaleString()} articles in ${((Date.now() - started) / 1000).toFixed(1)}s`));

      const qualified: EntityCandidate[] = [];
      for (const [aliasNorm, agg] of aggMap) {
        if (agg.docFreq < opts.minArticles || agg.outlets.size < opts.minOutlets) continue;
        let bestSurface = agg.surfaceRaw;
        let bestSurfaceCnt = 0;
        for (const [s, c] of agg.surfaceCounts) {
          if (c > bestSurfaceCnt) {
            bestSurfaceCnt = c;
            bestSurface = s;
          }
        }
        let bestType: EntityType = 'person';
        let bestTypeCnt = 0;
        for (const [t, c] of agg.typeCounts) {
          if (c > bestTypeCnt) {
            bestTypeCnt = c;
            bestType = t;
          }
        }
        qualified.push({
          aliasNorm,
          surfaceRaw: bestSurface,
          guessedType: bestType,
          docFreq: agg.docFreq,
          outletCount: agg.outlets.size,
          distinctDays: agg.days.size,
          sampleSentencesJson: JSON.stringify(agg.samples),
          status: 'pending',
        });
      }

      qualified.sort((a, b) => b.docFreq - a.docFreq || b.outletCount - a.outletCount);
      const topCandidates = qualified.slice(0, opts.maxCandidates);

      if (!opts.reportOnly && topCandidates.length > 0) {
        idx.upsertEntityCandidates(topCandidates);
      }
      idx.close();

      const batchRequests = Math.ceil(topCandidates.length / 25);
      const estInTok = batchRequests * 4200;
      const estOutTok = batchRequests * 2200;
      const estBatchUsd = (estInTok / 1_000_000) * 0.15 + (estOutTok / 1_000_000) * 1.25;

      p.note(
        [
          `${color.dim('Raw unique spans:')}          ${color.white(aggMap.size.toLocaleString())}`,
          `${color.dim('Qualified candidates:')}      ${color.green(topCandidates.length.toLocaleString())} (docFreq >= ${opts.minArticles}, outlets >= ${opts.minOutlets})`,
          `${color.dim('Grouped prompts (25/req):')}  ${color.cyan(batchRequests.toLocaleString())}`,
          `${color.dim('Est. Vertex Batch cost:')}    ${color.green(`$${estBatchUsd.toFixed(2)}`)}`,
          `${color.dim('Top 10 candidates:')}         ${topCandidates.slice(0, 10).map((c) => `${c.surfaceRaw}(${c.docFreq})`).join(', ')}`,
        ].join('\n'),
        opts.reportOnly ? 'Candidate Mining Report (Dry Run)' : 'Candidate Mining Complete'
      );
      p.outro(color.dim('Next: `bun run backfill prepare-candidate-batch`'));
    });

  // ==========================================
  // Command: prepare-candidate-batch (Stage A Step 2)
  // ==========================================
  program
    .command('prepare-candidate-batch')
    .description('Prepares grouped (25/prompt) Vertex AI Batch JSONL to verify mined long-tail candidates and generate initial bilingual descriptions')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--out <path>', 'Output JSONL path', join(DEFAULT_INDEX_DIR, 'batch-stage-a-candidates.jsonl'))
    .option('--min-articles <number>', 'Minimum doc_freq', (v) => parseInt(v, 10), 6)
    .option('--min-outlets <number>', 'Minimum outlet_count', (v) => parseInt(v, 10), 2)
    .option('--group-size <number>', 'Candidates per LLM request', (v) => parseInt(v, 10), 25)
    .option('--limit <number>', 'Max candidates to export', (v) => parseInt(v, 10), 15000)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Prepare Stage A Candidate Verification Batch ')));
      const idx = new IndexDatabase(opts.index);
      const candidates = idx.getPendingCandidates({
        minDocFreq: opts.minArticles,
        minOutlets: opts.minOutlets,
        limit: opts.limit,
      });
      const snapshot = idx.getRegistrySnapshot();
      const seedSummary = snapshot.entities
        .filter((e) => e.status === 'active')
        .slice(0, 150)
        .map((e) => `${e.id}:${e.canonicalBn ?? ''}/${e.canonicalEn ?? ''}(${e.entityType})`);
      idx.close();

      if (candidates.length === 0) {
        p.log.warn('No pending candidates found. Run `bun run backfill mine-candidates` first.');
        return;
      }

      mkdirSync(dirname(opts.out), { recursive: true });
      const stream = createWriteStream(opts.out, { encoding: 'utf8' });
      let reqCount = 0;
      let totalChars = 0;

      for (let i = 0; i < candidates.length; i += opts.groupSize) {
        const group = candidates.slice(i, i + opts.groupSize);
        const key = `cand_grp_${String(reqCount).padStart(5, '0')}`;
        const itemsJson = group.map((c) => ({
          aliasNorm: c.aliasNorm,
          surface: c.surfaceRaw,
          guessedType: c.guessedType,
          articles: c.docFreq,
          outlets: c.outletCount,
          samples: JSON.parse(c.sampleSentencesJson || '[]').slice(0, 3),
        }));

        const prompt = [
          'You are curating a high-precision bilingual (Bangla & English) Bangladeshi news knowledge graph.',
          'Evaluate each candidate below strictly from the provided news sample sentences:',
          '- Set isNamedEntity=false for generic nouns, job titles without a person name (e.g. "অ্যাটর্নি জেনারেল", "স্বরাষ্ট্র উপদেষ্টা", "বিশেষ প্রতিনিধি"), news desks, boilerplate phrases, news-outlet mastheads/wire services (The Daily Star, The Business Standard, Prothom Alo, Jugantor, Kaler Kantho, Ittefaq, Bangladesh Pratidin, bdnews24, UNB, BSS), or malformed/truncated fragments.',
          '- Set isNamedEntity=true ONLY for specific real named people, organizations, institutions, companies, locations, or named recurring events/policies.',
          '- Provide clean canonicalBn AND canonicalEn (transliterating/translating accurately across scripts) and useful aliases (strip honorifics like ড./ডা./মো./ব্যারিস্টার from canonical name, put titled forms in aliases).',
          '- If the candidate clearly refers to an entity in EXISTING_ENTITIES, set sameAsEntityId to that exact ID.',
          '- Provide neutral 1-sentence descriptionBn/descriptionEn and crisp shortTaglineBn/shortTaglineEn grounded ONLY in the sample sentences (never guess from outside memory if not supported).',
          `EXISTING_ENTITIES: ${seedSummary.join(' | ')}`,
          `CANDIDATES: ${JSON.stringify(itemsJson)}`,
        ].join('\n');

        totalChars += prompt.length;
        const line = {
          key,
          request: {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: STAGE_A_CANDIDATE_SCHEMA,
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        };
        stream.write(`${JSON.stringify(line)}\n`);
        reqCount++;
      }

      await new Promise<void>((r) => stream.end(r));
      const estIn = Math.ceil(totalChars / 3.2);
      const estOut = reqCount * 2200;
      const estUsd = (estIn / 1_000_000) * 0.15 + (estOut / 1_000_000) * 1.25;

      p.note(
        [
          `${color.dim('Candidates exported:')} ${color.white(candidates.length.toLocaleString())}`,
          `${color.dim('Batch requests:')}      ${color.cyan(reqCount.toLocaleString())}`,
          `${color.dim('Output JSONL:')}        ${color.cyan(opts.out)}`,
          `${color.dim('Est. Batch USD:')}      ${color.green(`$${estUsd.toFixed(3)}`)}`,
        ].join('\n'),
        'Stage A Batch Ready'
      );
      p.outro(
        color.dim(
          `Submit via: ./tools/backfill/gcp/run-vertex-batch.sh --tag candidates --input ${opts.out} --output data/index/batch-stage-a-results.jsonl`
        )
      );
    });

  // ==========================================
  // Command: ingest-candidate-batch (Stage A Step 3)
  // ==========================================
  program
    .command('ingest-candidate-batch')
    .description('Applies promotion policy to Stage A Vertex Batch verdicts, promoting verified long-tail entities & denylisting rejects')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--input <path>', 'Stage A results JSONL', join(DEFAULT_INDEX_DIR, 'batch-stage-a-results.jsonl'))
    .option('--min-person-articles <number>', 'Override person min articles', (v) => parseInt(v, 10), DEFAULT_PROMOTION_POLICY.person.minArticles)
    .option('--min-other-articles <number>', 'Override org/loc/topic min articles', (v) => parseInt(v, 10), DEFAULT_PROMOTION_POLICY.other.minArticles)
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Ingest Stage A Candidate Verdicts ')));
      if (!existsSync(opts.input)) {
        p.log.error(`Results file not found: ${opts.input}`);
        process.exit(1);
      }

      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();
      const snapshot = idx.getRegistrySnapshot();
      const denylist = idx.getDenylistSet();

      const existingAliasMap = new Map<string, ExistingAliasRef>();
      const activeEntityTypeById = new Map<string, EntityType>();
      for (const e of snapshot.entities) {
        if (e.status === 'active') activeEntityTypeById.set(e.id, e.entityType);
      }
      for (const a of snapshot.aliases) {
        const etype = activeEntityTypeById.get(a.entityId);
        if (etype) {
          existingAliasMap.set(normalizePhrase(a.aliasNorm || a.aliasRaw), {
            entityId: a.entityId,
            entityType: etype,
          });
        }
      }

      const candRows = db
        .prepare(
          `SELECT alias_norm as aliasNorm, surface_raw as surfaceRaw, guessed_type as guessedType,
                  doc_freq as docFreq, outlet_count as outletCount, distinct_days as distinctDays
           FROM entity_candidate`
        )
        .all() as Array<{
        aliasNorm: string;
        surfaceRaw: string;
        guessedType: EntityType;
        docFreq: number;
        outletCount: number;
        distinctDays: number;
      }>;
      const candByNorm = new Map(candRows.map((c) => [c.aliasNorm, c]));

      const policy = {
        person: { ...DEFAULT_PROMOTION_POLICY.person, minArticles: opts.minPersonArticles },
        other: { ...DEFAULT_PROMOTION_POLICY.other, minArticles: opts.minOtherArticles },
      };

      const lines = readFileSync(opts.input, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);

      // Collect all parsed verdicts and sort by candidate docFreq DESC so major entities
      // ("Dhaka University", "Ziaur Rahman") are promoted cleanly before niche compounds!
      const verdictPairs: Array<{
        cand: typeof candRows[0];
        verdict: ReturnType<typeof LlmCandidateVerdictItemSchema.parse>;
      }> = [];
      for (const line of lines) {
        let row: any;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const verdicts = row?.parsed?.verdicts;
        if (!Array.isArray(verdicts)) continue;
        for (const rawVerdict of verdicts) {
          const parsedV = LlmCandidateVerdictItemSchema.safeParse(rawVerdict);
          if (!parsedV.success) continue;
          const cand = candByNorm.get(parsedV.data.aliasNorm);
          if (!cand) continue;
          verdictPairs.push({ cand, verdict: parsedV.data });
        }
      }
      verdictPairs.sort((a, b) => b.cand.docFreq - a.cand.docFreq || b.cand.outletCount - a.cand.outletCount);

      let promotedCount = 0;
      let mergedAliasCount = 0;
      let rejectedCount = 0;
      let deferredCount = 0;
      let blockedUnsafeAliases = 0;
      const nowIso = new Date().toISOString();

      const tx = db.transaction(() => {
        const insertEntity = db.prepare(`
          INSERT OR IGNORE INTO entity (
            id, canonical_bn, canonical_en, entity_type, status, source, is_hub,
            short_tagline_bn, short_tagline_en, description_bn, description_en,
            auto_score, verdict_json, description_updated_at
          ) VALUES (?, ?, ?, ?, 'active', 'auto', 0, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAlias = db.prepare(`
          INSERT OR IGNORE INTO entity_alias (alias_norm, alias_raw, entity_id, kind, require_uppercase, source)
          VALUES (?, ?, ?, ?, ?, 'auto')
        `);
        const updateCand = db.prepare(
          'UPDATE entity_candidate SET status = ?, verdict_json = ?, updated_at = ? WHERE alias_norm = ?'
        );
        const insertDeny = db.prepare(
          'INSERT OR REPLACE INTO entity_denylist (alias_norm, reason, created_at) VALUES (?, ?, ?)'
        );

        const registerCleanAliases = (
          entityId: string,
          entityType: EntityType,
          rawAliases: Array<string | null | undefined>
        ) => {
          for (const rawAlias of rawAliases) {
            if (!rawAlias) continue;
            const trimmed = normalizeText(rawAlias);
            const check = isSafeAutoAlias(trimmed, entityType);
            if (!check.safe) {
              blockedUnsafeAliases++;
              continue;
            }
            if (existingAliasMap.has(check.norm)) continue;
            insertAlias.run(
              check.norm,
              trimmed,
              entityId,
              check.requireUppercase ? 'acronym' : 'name',
              check.requireUppercase ? 1 : 0
            );
            existingAliasMap.set(check.norm, { entityId, entityType });
          }
        };

        for (const { cand, verdict: v } of verdictPairs) {
          // Validate sameAsEntityId exists AND has the exact same entityType!
          const resolvedType: EntityType = v.entityType ?? cand.guessedType;
          if (v.sameAsEntityId) {
            const targetType = activeEntityTypeById.get(v.sameAsEntityId);
            if (!targetType || targetType !== resolvedType) {
              v.sameAsEntityId = null;
            }
          }

          const decision = evaluateCandidatePromotion(cand, v, existingAliasMap, denylist, policy);

          if (decision.decision === 'reject') {
            rejectedCount++;
            insertDeny.run(cand.aliasNorm, decision.reason, nowIso);
            updateCand.run('rejected', JSON.stringify(v), nowIso, cand.aliasNorm);
            denylist.add(cand.aliasNorm);
            continue;
          }

          if (decision.decision === 'merge_proposal' && decision.targetEntityId) {
            const targetType = activeEntityTypeById.get(decision.targetEntityId);
            if (targetType && targetType === (decision.resolvedType ?? cand.guessedType)) {
              mergedAliasCount++;
              registerCleanAliases(decision.targetEntityId, targetType, [
                v.canonicalBn,
                v.canonicalEn,
                ...(v.aliases ?? []),
              ]);
              updateCand.run(
                'merged',
                JSON.stringify({ ...v, mergedInto: decision.targetEntityId, reason: decision.reason }),
                nowIso,
                cand.aliasNorm
              );
              continue;
            }
          }

          if (decision.decision === 'defer') {
            deferredCount++;
            updateCand.run('pending', JSON.stringify({ ...v, deferredReason: decision.reason }), nowIso, cand.aliasNorm);
            continue;
          }

          // Promote as a new canonical auto entity!
          const entType = decision.resolvedType ?? cand.guessedType;
          const primaryKey = normalizePhrase(v.canonicalEn || v.canonicalBn || cand.surfaceRaw);
          const entId = `ent_auto_${stableHash(`${entType}|${primaryKey}`, 12)}`;

          insertEntity.run(
            entId,
            v.canonicalBn?.trim() || null,
            v.canonicalEn?.trim() || null,
            entType,
            v.shortTaglineBn?.trim() || null,
            v.shortTaglineEn?.trim() || null,
            v.descriptionBn?.trim() || null,
            v.descriptionEn?.trim() || null,
            v.confidence,
            JSON.stringify(v),
            v.descriptionEn || v.descriptionBn ? nowIso : null
          );
          activeEntityTypeById.set(entId, entType);

          // Register ONLY clean canonical forms + LLM aliases passing strict alias hygiene
          // (skip raw inflected surfaceRaw so trie stemming handles inflections cleanly)
          registerCleanAliases(entId, entType, [
            v.canonicalBn,
            v.canonicalEn,
            ...(v.aliases ?? []),
          ]);

          updateCand.run('promoted', JSON.stringify({ ...v, entityId: entId }), nowIso, cand.aliasNorm);
          promotedCount++;
        }

        if (promotedCount > 0 || mergedAliasCount > 0) {
          idx.bumpRegistryVersion(`stage-a ingest: +${promotedCount} promoted, +${mergedAliasCount} merged aliases`);
        }
      });

      tx();
      idx.close();

      p.note(
        [
          `${color.dim('Promoted entities:')}      ${color.green(promotedCount.toLocaleString())}`,
          `${color.dim('Merged to existing:')}     ${color.cyan(mergedAliasCount.toLocaleString())}`,
          `${color.dim('Rejected/denylist:')}      ${color.yellow(rejectedCount.toLocaleString())}`,
          `${color.dim('Deferred:')}               ${color.dim(deferredCount.toLocaleString())}`,
          `${color.dim('Unsafe aliases blocked:')} ${color.magenta(blockedUnsafeAliases.toLocaleString())}`,
        ].join('\n'),
        'Stage A Ingest Complete'
      );
      p.outro(color.dim('Next: `bun run backfill resolve-entities` to link all 211k articles!'));
    });

  // ==========================================
  // Command: resolve-entities (Streaming v2 across all 211k articles)
  // ==========================================
  program
    .command('resolve-entities')
    .description('Streams all articles using the current registry snapshot, resolves entities & deterministic 17-type relations, and stamps article_resolution')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--batch-size <number>', 'SQLite streaming batch size', (v) => parseInt(v, 10), 2000)
    .option('--preserve-llm-relations', 'Keep existing source="llm_claim" relations untouched', true)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(` Jachaikori · Entity Resolution ${RESOLVER_VERSION} (Streaming) `)));
      const totalStart = Date.now();
      const idx = new IndexDatabase(opts.index);

      if (idx.getCurrentRegistryVersion() === 0) {
        const seed = loadAndValidateSeedYaml(DEFAULT_SEED_YAML);
        idx.syncSeedRegistry(seed.entities, seed.aliases, seed.roleTerms);
      }

      const snapshot = idx.getRegistrySnapshot();
      const compiled = compileRegistry(snapshot);
      const totalArticles = idx.getTotalArticleCount();

      if (totalArticles === 0) {
        p.log.warn('No articles in index.sqlite.');
        idx.close();
        return;
      }

      const activeCount = snapshot.entities.filter((e) => e.status === 'active').length;
      p.log.info(
        `Registry v${snapshot.version}: ${activeCount.toLocaleString()} active entities, ${snapshot.aliases.length.toLocaleString()} aliases, ${snapshot.roleTerms.length} role_terms`
      );

      idx.clearDeterministicResolutionData(opts.preserveLlmRelations);

      const bar = p.progress({ style: 'block', max: totalArticles, size: 28 });
      bar.start(`Resolving ${totalArticles.toLocaleString()} articles...`);

      let mentionBatch: ArticleEntityMention[] = [];
      let relationBatch: EntityRelation[] = [];
      let stampBatch: Array<{ articleId: string; registryVersion: number; resolverVersion: string; mentionCount: number }> = [];
      let processed = 0;
      let lastReported = 0;
      let lastYield = Date.now();
      let totalMentions = 0;
      let totalRelations = 0;
      let linkedArticles = 0;

      for (const batch of idx.streamArticlesForEntities(opts.batchSize)) {
        for (const art of batch) {
          const res = resolveArticle(art, compiled, { emitUnlinked: false, maxBodySentences: 35 });
          if (res.mentions.length > 0) {
            linkedArticles++;
            totalMentions += res.mentions.length;
            for (const m of res.mentions) mentionBatch.push(m);
          }
          if (res.relations.length > 0) {
            totalRelations += res.relations.length;
            for (const r of res.relations) relationBatch.push(r);
          }
          stampBatch.push({
            articleId: art.id,
            registryVersion: snapshot.version,
            resolverVersion: res.resolverVersion,
            mentionCount: res.mentions.length,
          });
        }

        if (mentionBatch.length >= 6000 || relationBatch.length >= 4000 || stampBatch.length >= 2000) {
          idx.saveArticleResolutionBatch(mentionBatch, relationBatch, stampBatch);
          mentionBatch = [];
          relationBatch = [];
          stampBatch = [];
        }

        processed += batch.length;
        if (processed === totalArticles || Date.now() - lastYield >= 120) {
          const delta = processed - lastReported;
          lastReported = processed;
          const elapsed = Math.max((Date.now() - totalStart) / 1000, 0.1);
          const rate = processed / elapsed;
          const eta = Math.max(0, (totalArticles - processed) / Math.max(rate, 1));
          bar.advance(
            delta,
            `${((processed / totalArticles) * 100).toFixed(1)}% · ${processed.toLocaleString()}/${totalArticles.toLocaleString()} · ${Math.round(rate).toLocaleString()} art/s · ETA ${Math.ceil(eta)}s · ${totalMentions.toLocaleString()} mentions · ${totalRelations.toLocaleString()} rels`
          );
          await new Promise<void>((r) => setTimeout(r, 0));
          lastYield = Date.now();
        }
      }

      if (mentionBatch.length > 0 || relationBatch.length > 0 || stampBatch.length > 0) {
        idx.saveArticleResolutionBatch(mentionBatch, relationBatch, stampBatch);
      }

      bar.stop(
        color.green(
          `Resolved ${totalMentions.toLocaleString()} mentions & ${totalRelations.toLocaleString()} deterministic relations in ${((Date.now() - totalStart) / 1000).toFixed(1)}s`
        )
      );
      idx.close();

      p.note(
        [
          `${color.dim('Active entities:')}          ${color.white(activeCount.toLocaleString())}`,
          `${color.dim('Articles linked:')}          ${color.cyan(linkedArticles.toLocaleString())} / ${totalArticles.toLocaleString()}`,
          `${color.dim('Deduplicated mentions:')}    ${color.white(totalMentions.toLocaleString())}`,
          `${color.dim('Deterministic relations:')}  ${color.green(totalRelations.toLocaleString())}`,
          `${color.dim('Total elapsed:')}            ${color.white(`${((Date.now() - totalStart) / 1000).toFixed(1)}s`)}`,
        ].join('\n'),
        `Entity Resolution ${RESOLVER_VERSION} Summary`
      );
      p.outro(color.dim('Next: `bun run backfill materialize-events` or Stage B `prepare-event-batch`'));
    });

  // ==========================================
  // Command: prepare-merge-batch / ingest-merge-batch (Stage A2)
  // ==========================================
  program
    .command('prepare-merge-batch')
    .description('Finds borderline duplicate entity pairs sharing >= 3 events + high lexical similarity and writes Stage A2 Vertex Batch JSONL')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--out <path>', 'Output JSONL path', join(DEFAULT_INDEX_DIR, 'batch-stage-a2-merges.jsonl'))
    .option('--min-shared-clusters <number>', 'Minimum shared events', (v) => parseInt(v, 10), DEFAULT_MERGE_POLICY.minSharedClusters)
    .option('--min-sim <number>', 'Minimum lexical trigram similarity', (v) => parseFloat(v), 0.45)
    .option('--group-size <number>', 'Pairs per prompt', (v) => parseInt(v, 10), 20)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Prepare Stage A2 Duplicate Merge Judge Batch ')));
      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();

      const entities = db
        .prepare(
          `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn,
                  entity_type as entityType, source, article_count as articleCount,
                  short_tagline_en as taglineEn
           FROM entity WHERE status = 'active' AND is_hub = 0`
        )
        .all() as Array<{
        id: string;
        canonicalBn: string | null;
        canonicalEn: string | null;
        entityType: EntityType;
        source: string;
        articleCount: number;
        taglineEn: string | null;
      }>;
      const byId = new Map(entities.map((e) => [e.id, e]));

      // Find same-type entity pairs sharing >= minSharedClusters events
      const sharedRows = db
        .prepare(
          `SELECT a.entity_id as idA, b.entity_id as idB, COUNT(DISTINCT a.event_id) as sharedClusters
           FROM event_entity a
           JOIN event_entity b ON b.event_id = a.event_id AND a.entity_id < b.entity_id
           JOIN entity ea ON ea.id = a.entity_id AND ea.status = 'active' AND ea.is_hub = 0
           JOIN entity eb ON eb.id = b.entity_id AND eb.status = 'active' AND eb.is_hub = 0 AND eb.entity_type = ea.entity_type
           GROUP BY a.entity_id, b.entity_id
           HAVING sharedClusters >= ?`
        )
        .all(opts.minSharedClusters) as Array<{ idA: string; idB: string; sharedClusters: number }>;
      idx.close();

      const candidatePairs: Array<{
        pairId: string;
        a: typeof entities[0];
        b: typeof entities[0];
        sharedClusters: number;
        sim: number;
      }> = [];

      for (const r of sharedRows) {
        const a = byId.get(r.idA);
        const b = byId.get(r.idB);
        if (!a || !b) continue;
        // Never propose merging two curated seed entities automatically
        if (a.source === 'seed' && b.source === 'seed') continue;

        const simEn = a.canonicalEn && b.canonicalEn ? trigramJaccard(a.canonicalEn, b.canonicalEn) : 0;
        const simBn = a.canonicalBn && b.canonicalBn ? trigramJaccard(a.canonicalBn, b.canonicalBn) : 0;
        const sim = Math.max(simEn, simBn);
        if (sim < opts.minSim) continue;

        candidatePairs.push({
          pairId: `${a.id}__${b.id}`,
          a,
          b,
          sharedClusters: r.sharedClusters,
          sim: Number(sim.toFixed(3)),
        });
      }

      if (candidatePairs.length === 0) {
        p.log.info('No borderline duplicate pairs found above threshold!');
        return;
      }

      mkdirSync(dirname(opts.out), { recursive: true });
      const stream = createWriteStream(opts.out, { encoding: 'utf8' });
      let reqCount = 0;

      for (let i = 0; i < candidatePairs.length; i += opts.groupSize) {
        const group = candidatePairs.slice(i, i + opts.groupSize);
        const key = `merge_grp_${String(reqCount).padStart(4, '0')}`;
        const prompt = [
          'Judge whether each pair of Bangladeshi news entities refers to the EXACT SAME real-world entity.',
          'Be conservative: if unsure, or if they are two different people with similar names, set sameEntity=false.',
          'If sameEntity=true, set keepEntityId to the cleaner/seed/higher-articleCount ID.',
          `PAIRS: ${JSON.stringify(group)}`,
        ].join('\n');

        stream.write(
          `${JSON.stringify({
            key,
            request: {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.0,
                responseMimeType: 'application/json',
                responseSchema: STAGE_A2_MERGE_SCHEMA,
                thinkingConfig: { thinkingBudget: 0 },
              },
            },
          })}\n`
        );
        reqCount++;
      }

      await new Promise<void>((r) => stream.end(r));
      p.log.success(`Exported ${candidatePairs.length} candidate pairs across ${reqCount} batch requests -> ${opts.out}`);
    });

  program
    .command('ingest-merge-batch')
    .description('Applies evaluateAutoMerge() to Stage A2 judge verdicts with auditable entity_merge_log')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--input <path>', 'Stage A2 results JSONL', join(DEFAULT_INDEX_DIR, 'batch-stage-a2-results.jsonl'))
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Ingest Stage A2 Merge Decisions ')));
      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();
      const activeRows = db
        .prepare("SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType, source, article_count as articleCount FROM entity WHERE status = 'active'")
        .all() as Array<{ id: string; canonicalBn: string | null; canonicalEn: string | null; entityType: EntityType; source: string; articleCount: number }>;
      const byId = new Map(activeRows.map((e) => [e.id, e]));

      const lines = readFileSync(opts.input, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      let merged = 0;
      let skipped = 0;

      for (const line of lines) {
        let row: any;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        for (const d of row?.parsed?.decisions ?? []) {
          if (!d?.sameEntity || typeof d.pairId !== 'string') {
            skipped++;
            continue;
          }
          const [idA, idB] = d.pairId.split('__');
          if (!idA || !idB) continue;
          const a = byId.get(idA);
          const b = byId.get(idB);
          if (!a || !b) continue;

          const sim = Math.max(
            a.canonicalEn && b.canonicalEn ? trigramJaccard(a.canonicalEn, b.canonicalEn) : 0,
            a.canonicalBn && b.canonicalBn ? trigramJaccard(a.canonicalBn, b.canonicalBn) : 0
          );
          const evalRes = evaluateAutoMerge(
            a,
            b,
            {
              sharedClusters: DEFAULT_MERGE_POLICY.minSharedClusters,
              nameCosine: Math.max(sim, 0.85),
              llmSameEntity: true,
              llmConfidence: Number(d.confidence ?? 0),
            }
          );
          if (!evalRes.shouldMerge) {
            skipped++;
            continue;
          }

          // Prefer keeping seed entity, otherwise keepEntityId or higher articleCount
          let keepId = d.keepEntityId === idA || d.keepEntityId === idB ? d.keepEntityId : a.articleCount >= b.articleCount ? idA : idB;
          if (a.source === 'seed' && b.source !== 'seed') keepId = idA;
          if (b.source === 'seed' && a.source !== 'seed') keepId = idB;
          const dropId = keepId === idA ? idB : idA;

          idx.mergeEntities(dropId, keepId, `auto-stage-a2: ${d.reason}`, Number(d.confidence ?? 0));
          byId.delete(dropId);
          merged++;
        }
      }
      idx.close();
      p.log.success(`Applied ${merged} auditable merges (${skipped} skipped/blocked by surname guard).`);
    });

  // ==========================================
  // Command: prepare-event-batch / ingest-event-batch (Stage B — 25,693 Multi-Outlet Clusters)
  // ==========================================
  program
    .command('prepare-event-batch')
    .description('Prepares Stage B Vertex AI Batch JSONL over 1-2 representative articles per multi-outlet cluster for 17-type directional relations + structured claims')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--out <path>', 'Output JSONL path', join(DEFAULT_INDEX_DIR, 'batch-stage-b-events.jsonl'))
    .option('--min-outlets <number>', 'Minimum outlet_count for event clusters', (v) => parseInt(v, 10), 2)
    .option('--max-per-cluster <number>', 'Max representative articles per cluster (1-2)', (v) => parseInt(v, 10), 2)
    .option('--limit-clusters <number>', 'Optional cap on clusters exported', (v) => parseInt(v, 10))
    .option('--skip-extracted', 'Skip articles already extracted with extractor_version=v2', true)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Prepare Stage B Multi-Outlet Event Batch ')));
      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();

      const reps = idx.getEventRepresentativeArticles({
        minOutlets: opts.minOutlets,
        maxPerCluster: opts.maxPerCluster,
        limitClusters: opts.limitClusters,
        skipAlreadyExtracted: opts.skipExtracted,
      });

      if (reps.length === 0) {
        p.log.warn('No representative cluster articles found.');
        idx.close();
        return;
      }

      // Preload known entities per article in bulk (ZERO N+1 queries!)
      const entByArticle = new Map<string, string[]>();
      const aeStmt = db.prepare(
        `SELECT ae.article_id as articleId,
                COALESCE(e.canonical_en, e.canonical_bn) || CASE WHEN e.canonical_bn IS NOT NULL AND e.canonical_en IS NOT NULL THEN ' (' || e.canonical_bn || ')' ELSE '' END as label
         FROM article_entity ae
         JOIN entity e ON e.id = ae.entity_id
         WHERE ae.article_id = ? AND e.status = 'active'
         ORDER BY ae.salience DESC
         LIMIT 15`
      );

      mkdirSync(dirname(opts.out), { recursive: true });
      const stream = createWriteStream(opts.out, { encoding: 'utf8' });
      let totalChars = 0;

      for (const art of reps) {
        const knownRows = aeStmt.all(art.articleId) as Array<{ label: string }>;
        const knownLabels = knownRows.map((r) => r.label);
        entByArticle.set(art.articleId, knownLabels);

        const body = (art.cleanText || art.lead || '').trim();
        const truncatedBody = body.length > 2200 ? `${body.slice(0, 2200)}...` : body;

        const prompt = [
          'Extract directional entity-to-entity relationships AND verifiable factual claims from this Bangladeshi news article.',
          'Rules for relations (max 10 most important, directional sourceName -> targetName):',
          `- Use ONLY canonical relationType from: ${CANONICAL_RELATION_TYPES.join(', ')}.`,
          '- Set predicateLabel to a concise, specific 2-6 word English verb phrase (e.g., "dissolved board of", "approved $4.7B loan to", "requested extradition of", "president of").',
          '- Prefer entity names from KNOWN_ENTITIES when they match; otherwise use exact full proper name.',
          '- evidenceSnippet must be a verbatim short sentence/clause from the article (<= 220 chars).',
          '- Skip generic datelines or trivial co-mentions with no substantive relationship.',
          'Rules for claims (max 6 most verifiable factual/quoted claims):',
          '- Extract exact numbers (with units, e.g. "32,000 টাকা", "$4.7B") and dates mentioned in each claim.',
          '- Set hedgingLevel: "certain" (confirmed fact), "reported" (attributed/alleged), "hedged" (may/likely/সম্ভাব্য), or "conditional".',
          `ARTICLE_ID: ${art.articleId}`,
          `KNOWN_ENTITIES: ${knownLabels.join('; ')}`,
          `OUTLET: ${art.outlet} | PUBLISHED_AT: ${art.publishedAt ?? 'unknown'}`,
          `TITLE: ${art.title}`,
          `BODY: ${truncatedBody}`,
        ].join('\n');

        totalChars += prompt.length;
        stream.write(
          `${JSON.stringify({
            key: art.articleId,
            request: {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseSchema: STAGE_B_EVENT_SCHEMA,
                thinkingConfig: { thinkingBudget: 0 },
              },
            },
          })}\n`
        );
      }

      await new Promise<void>((r) => stream.end(r));
      idx.close();

      const estIn = Math.ceil(totalChars / 3.2);
      const estOut = reps.length * 520;
      const estUsd = (estIn / 1_000_000) * 0.15 + (estOut / 1_000_000) * 1.25;

      p.note(
        [
          `${color.dim('Representative articles:')} ${color.white(reps.length.toLocaleString())}`,
          `${color.dim('Output JSONL:')}            ${color.cyan(opts.out)}`,
          `${color.dim('Est. input tokens:')}       ${color.white(estIn.toLocaleString())}`,
          `${color.dim('Est. output tokens:')}      ${color.white(estOut.toLocaleString())}`,
          `${color.dim('Est. Vertex Batch USD:')}   ${color.green(`$${estUsd.toFixed(2)}`)}`,
        ].join('\n'),
        'Stage B Multi-Outlet Event Batch Ready'
      );
      p.outro(
        color.dim(
          `Submit via: ./tools/backfill/gcp/run-vertex-batch.sh --tag events --input ${opts.out} --output data/index/batch-stage-b-results.jsonl --max-usd 60`
        )
      );
    });

  program
    .command('ingest-event-batch')
    .description('Validates Stage B Vertex Batch results, resolves names to canonical entity IDs, and upserts directional 17-type entity_relation + claim rows')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--input <path>', 'Stage B results JSONL', join(DEFAULT_INDEX_DIR, 'batch-stage-b-results.jsonl'))
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Ingest Stage B Event Relations & Claims ')));
      if (!existsSync(opts.input)) {
        p.log.error(`Results file not found: ${opts.input}`);
        process.exit(1);
      }

      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();
      const snapshot = idx.getRegistrySnapshot();
      const compiled = compileRegistry(snapshot);

      // Build fast exact/normalized lookup + fallback to compileRegistry resolver
      const aliasLookup = new Map<string, string>();
      for (const e of snapshot.entities) {
        if (e.status !== 'active') continue;
        if (e.canonicalBn) aliasLookup.set(normalizePhrase(e.canonicalBn), e.id);
        if (e.canonicalEn) aliasLookup.set(normalizePhrase(e.canonicalEn), e.id);
      }
      for (const a of snapshot.aliases) {
        const norm = normalizePhrase(a.aliasNorm || a.aliasRaw);
        if (norm && compiled.entityMap.has(a.entityId)) {
          aliasLookup.set(norm, a.entityId);
        }
      }

      const artDates = new Map<string, string | null>();
      for (const row of db.prepare('SELECT id, published_at as publishedAt FROM article').all() as Array<{
        id: string;
        publishedAt: string | null;
      }>) {
        artDates.set(row.id, row.publishedAt);
      }

      const TITLE_PREFIX_RE =
        /^(?:(?:সাবেক|ভারপ্রাপ্ত|অন্তর্বর্তীকালীন|প্রধান|মাননীয়|জনাব|ড\.|ডা\.|অধ্যাপক|ব্যারিস্টার|অ্যাডভোকেট|বিচারপতি|মেজর|জেনারেল|ব্রিগেডিয়ার|কর্নেল|প্রধানমন্ত্রী|রাষ্ট্রপতি|উপদেষ্টা|মন্ত্রী|প্রতিমন্ত্রী|উপমন্ত্রী|মেয়র|চেয়ারম্যান|মহাসচিব|সভাপতি|সাধারণ সম্পাদক|পরিচালক|সচিব|former|acting|interim|chief|hon\.?|dr\.?|prof\.?|professor|barrister|advocate|justice|president|prime minister|pm|minister|mayor|chairman|chairperson|secretary|director|general|major)\s+)+/i;

      const resolveNameToEntityId = (rawName: string | null | undefined, publishedAt: string | null): string | null => {
        if (!rawName || !rawName.trim()) return null;
        // 1. Try stripped outer text ("Tarique Rahman (তারেক রহমান)" -> "Tarique Rahman")
        const cleaned = rawName.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
        const tryDirect = (candidate: string): string | null => {
          const norm = normalizePhrase(candidate);
          if (!norm) return null;
          const direct = aliasLookup.get(norm);
          if (direct) return direct;
          const stripped = candidate.replace(TITLE_PREFIX_RE, '').trim();
          if (stripped && stripped !== candidate) {
            const directStripped = aliasLookup.get(normalizePhrase(stripped));
            if (directStripped) return directStripped;
          }
          return null;
        };

        const directOuter = tryDirect(cleaned);
        if (directOuter) return directOuter;

        // 2. Try parenthetical bilingual alias ("Bangladesh Nationalist Party (বিএনপি)" -> "বিএনপি")
        for (const m of rawName.matchAll(/\(([^)]+)\)/g)) {
          const inner = m[1]?.trim();
          if (!inner) continue;
          const directInner = tryDirect(inner);
          if (directInner) return directInner;
        }

        // 3. Fallback to trie/temporal-role resolver with strict coverage guard so
        //    "Dhaka Unknown Agency" never falsely links to hub/location ent_dhaka.
        const probeText = cleaned || rawName;
        const sub = resolveArticle(
          { id: '_tmp', title: probeText, publishedAt },
          compiled,
          { emitUnlinked: false, maxBodySentences: 0 }
        );
        if (sub.mentions.length === 0) return null;

        const probeNormLen = Math.max(normalizePhrase(probeText).length, 1);
        const candidates = sub.mentions
          .map((m) => {
            const ent = compiled.entityMap.get(m.entityId);
            const surfLen = normalizePhrase(m.surfaceForm).length;
            const coverage = surfLen / probeNormLen;
            return { m, ent, coverage };
          })
          .filter(({ ent, coverage }) => {
            if (!ent) return false;
            const isStrict = ent.isHub || ent.entityType === 'location';
            return isStrict ? coverage >= 0.85 : coverage >= 0.6;
          })
          .sort((a, b) => b.coverage - a.coverage);

        return candidates[0]?.m.entityId ?? null;
      };

      const lines = readFileSync(opts.input, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      let relBatch: EntityRelation[] = [];
      let claimBatch: Parameters<IndexDatabase['upsertLlmExtractionBatch']>[0]['claims'] = [];
      let totalRels = 0;
      let totalClaims = 0;
      let validArticles = 0;
      let unresolvedRelEndpoints = 0;

      const flush = () => {
        if (relBatch.length === 0 && claimBatch.length === 0) return;
        idx.upsertLlmExtractionBatch({
          entities: [],
          aliases: [],
          mentions: [],
          relations: relBatch,
          claims: claimBatch,
        });
        relBatch = [];
        claimBatch = [];
      };

      for (const line of lines) {
        let row: any;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const articleId: string = row.key ?? row.articleId ?? '';
        if (!articleId || !artDates.has(articleId) || !row.parsed) continue;
        const publishedAt = artDates.get(articleId) ?? null;

        const sanitizedRels = (row.parsed.relations ?? [])
          .map((r: any) => ({
            ...r,
            sourceName: typeof r?.sourceName === 'string' ? r.sourceName.trim() : '',
            targetName: typeof r?.targetName === 'string' ? r.targetName.trim() : '',
            relationType: normalizeRelationType(r?.relationType),
            predicateLabel: typeof r?.predicateLabel === 'string' ? r.predicateLabel.trim().slice(0, 80) : '',
            evidenceSnippet: typeof r?.evidenceSnippet === 'string' ? r.evidenceSnippet.trim().slice(0, 320) : '',
          }))
          .filter(
            (r: any) =>
              r.relationType !== null &&
              r.sourceName.length > 0 &&
              r.targetName.length > 0 &&
              r.predicateLabel.length > 0 &&
              r.evidenceSnippet.length > 0
          );

        const sanitizedClaims = (row.parsed.claims ?? [])
          .map((c: any) => ({
            ...c,
            claimText: typeof c?.claimText === 'string' ? c.claimText.trim() : '',
            evidenceSnippet: typeof c?.evidenceSnippet === 'string' ? c.evidenceSnippet.trim().slice(0, 400) : null,
          }))
          .filter((c: any) => c.claimText.length > 0);

        const parsed = LlmArticleExtractionSchema.safeParse({
          articleId,
          relations: sanitizedRels,
          claims: sanitizedClaims,
        });
        if (!parsed.success) continue;
        validArticles++;

        for (const r of parsed.data.relations) {
          const srcId = resolveNameToEntityId(r.sourceName, publishedAt);
          const tgtId = resolveNameToEntityId(r.targetName, publishedAt);
          if (!srcId || !tgtId || srcId === tgtId) {
            unresolvedRelEndpoints++;
            continue;
          }
          const relId = `rel_llm_${stableHash(`${articleId}|${srcId}|${tgtId}|${r.relationType}|${r.predicateLabel}`, 14)}`;
          relBatch.push({
            id: relId,
            articleId,
            sourceEntityId: srcId,
            targetEntityId: tgtId,
            relationType: r.relationType,
            predicateLabel: r.predicateLabel.slice(0, 80),
            source: 'llm_claim',
            evidenceSnippet: r.evidenceSnippet.slice(0, 300),
            publishedAt,
            confidence: r.confidence ?? 0.88,
          });
          totalRels++;
        }

        for (let ci = 0; ci < parsed.data.claims.length; ci++) {
          const c = parsed.data.claims[ci]!;
          const speakerId = resolveNameToEntityId(c.speakerName, publishedAt);
          const subjId = resolveNameToEntityId(c.subjectName, publishedAt);
          const objId = resolveNameToEntityId(c.objectName, publishedAt);
          claimBatch.push({
            id: `clm_${stableHash(`${articleId}|${ci}|${c.claimText}`, 14)}`,
            articleId,
            claimText: c.claimText,
            claimType: c.claimType ?? 'factual',
            speakerEntityId: speakerId,
            subjectEntityId: subjId,
            objectEntityId: objId,
            numbersJson: c.numbers && c.numbers.length > 0 ? JSON.stringify(c.numbers) : null,
            datesJson: c.dates && c.dates.length > 0 ? JSON.stringify(c.dates) : null,
            hedgingLevel: c.hedgingLevel ?? 'reported',
            evidenceSnippet: c.evidenceSnippet ?? null,
            confidence: c.confidence ?? 0.88,
            extractorVersion: 'v2',
          });
          totalClaims++;
        }

        if (relBatch.length >= 4000 || claimBatch.length >= 4000) {
          flush();
        }
      }
      flush();
      idx.close();

      p.note(
        [
          `${color.dim('Articles ingested:')}          ${color.green(validArticles.toLocaleString())}`,
          `${color.dim('17-type LLM relations:')}      ${color.cyan(totalRels.toLocaleString())} (${unresolvedRelEndpoints.toLocaleString()} skipped unresolved endpoints)`,
          `${color.dim('Structured claims saved:')}    ${color.white(totalClaims.toLocaleString())}`,
        ].join('\n'),
        'Stage B Ingest Complete'
      );
      p.outro(color.dim('Next: `bun run backfill prepare-dossier-batch` for Stage C entity descriptions!'));
    });

  // ==========================================
  // Command: prepare-dossier-batch / ingest-dossier-batch (Stage C — Grounded Entity Descriptions)
  // ==========================================
  program
    .command('prepare-dossier-batch')
    .description('Prepares Stage C Vertex AI Batch JSONL to generate corpus-grounded bilingual entity descriptions & taglines')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--out <path>', 'Output JSONL path', join(DEFAULT_INDEX_DIR, 'batch-stage-c-dossiers.jsonl'))
    .option('--min-articles <number>', 'Min article count for non-seed entities', (v) => parseInt(v, 10), 5)
    .option('--limit <number>', 'Max entities to enrich', (v) => parseInt(v, 10), 5000)
    .option('--only-missing', 'Skip entities that already have descriptions', false)
    .action(async (opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Prepare Stage C Grounded Entity Dossiers ')));
      const idx = new IndexDatabase(opts.index);
      const packets = idx.getTopEntitiesForDossier({
        minArticles: opts.minArticles,
        limit: opts.limit,
        onlyMissing: opts.onlyMissing,
      });
      idx.close();

      if (packets.length === 0) {
        p.log.warn('No entities matched dossier criteria. Run `materialize-events` first so article_count/event_count are populated.');
        return;
      }

      mkdirSync(dirname(opts.out), { recursive: true });
      const stream = createWriteStream(opts.out, { encoding: 'utf8' });
      let totalChars = 0;

      for (const pkt of packets) {
        const prompt = [
          'Write a neutral, encyclopedic, journalist-grade bilingual (Bangla + English) profile for this entity in a Bangladeshi news knowledge graph.',
          'STRICT GROUNDING RULES:',
          '- Base ALL offices, roles, affiliations, and recent context strictly on the PROVIDED_EVIDENCE (ROLE_TERMS, TOP_RELATIONS, SAMPLE_ARTICLES).',
          '- Never editorialize, never assign truth/bias labels, and never state outdated offices if ROLE_TERMS shows a newer office holder.',
          '- shortTaglineEn / shortTaglineBn: crisp 4-10 word subtitle (e.g., "Prime Minister of Bangladesh · BNP Chairman").',
          '- descriptionEn / descriptionBn: 1-2 concise neutral sentences explaining who/what this entity is and its primary role in the news corpus.',
          '- citingArticleIds: list 1-4 articleId values from SAMPLE_ARTICLES that directly support the description.',
          `ENTITY: ${JSON.stringify({ id: pkt.id, canonicalBn: pkt.canonicalBn, canonicalEn: pkt.canonicalEn, entityType: pkt.entityType, aliases: pkt.aliases, articleCount: pkt.articleCount, eventCount: pkt.eventCount })}`,
          `ROLE_TERMS: ${JSON.stringify(pkt.roleTerms)}`,
          `TOP_RELATIONS: ${JSON.stringify(pkt.topRelations)}`,
          `SAMPLE_ARTICLES: ${JSON.stringify(pkt.sampleArticles)}`,
        ].join('\n');

        totalChars += prompt.length;
        stream.write(
          `${JSON.stringify({
            key: pkt.id,
            request: {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseSchema: STAGE_C_DOSSIER_SCHEMA,
                thinkingConfig: { thinkingBudget: 0 },
              },
            },
          })}\n`
        );
      }

      await new Promise<void>((r) => stream.end(r));
      const estIn = Math.ceil(totalChars / 3.2);
      const estOut = packets.length * 220;
      const estUsd = (estIn / 1_000_000) * 0.15 + (estOut / 1_000_000) * 1.25;

      p.note(
        [
          `${color.dim('Entities exported:')}      ${color.white(packets.length.toLocaleString())}`,
          `${color.dim('Output JSONL:')}           ${color.cyan(opts.out)}`,
          `${color.dim('Est. Vertex Batch USD:')}  ${color.green(`$${estUsd.toFixed(3)}`)}`,
        ].join('\n'),
        'Stage C Dossier Batch Ready'
      );
      p.outro(
        color.dim(
          `Submit via: ./tools/backfill/gcp/run-vertex-batch.sh --tag dossiers --input ${opts.out} --output data/index/batch-stage-c-results.jsonl --max-usd 10`
        )
      );
    });

  program
    .command('ingest-dossier-batch')
    .description('Validates Stage C dossier results and writes bilingual descriptions, taglines & citation article IDs to entity')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--input <path>', 'Stage C results JSONL', join(DEFAULT_INDEX_DIR, 'batch-stage-c-results.jsonl'))
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Ingest Stage C Grounded Entity Dossiers ')));
      if (!existsSync(opts.input)) {
        p.log.error(`Results file not found: ${opts.input}`);
        process.exit(1);
      }

      const lines = readFileSync(opts.input, 'utf8').split(/\r?\n/).filter((l) => l.trim());
      const valid: Array<{
        entityId: string;
        shortTaglineBn: string;
        shortTaglineEn: string;
        descriptionBn: string;
        descriptionEn: string;
        citingArticleIds: string[];
      }> = [];

      for (const line of lines) {
        let row: any;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const entityId = row.key;
        if (!entityId || !row.parsed) continue;
        const parsed = LlmEntityDossierSchema.safeParse({
          entityId,
          shortTaglineBn: String(row.parsed.shortTaglineBn ?? '').trim().slice(0, 120),
          shortTaglineEn: String(row.parsed.shortTaglineEn ?? '').trim().slice(0, 120),
          descriptionBn: String(row.parsed.descriptionBn ?? '').trim().slice(0, 500),
          descriptionEn: String(row.parsed.descriptionEn ?? '').trim().slice(0, 500),
          citingArticleIds: Array.isArray(row.parsed.citingArticleIds) ? row.parsed.citingArticleIds : [],
        });
        if (parsed.success) {
          valid.push(parsed.data);
        }
      }

      const idx = new IndexDatabase(opts.index);
      const updated = idx.saveEntityDossiers(valid);
      idx.close();

      p.log.success(`Updated bilingual corpus-grounded dossiers for ${updated.toLocaleString()} entities!`);
    });

  // ==========================================
  // Command: materialize-events
  // ==========================================
  program
    .command('materialize-events')
    .description('Aggregates article_entity + article_cluster into event_entity, precomputes entity stats, and sets dynamic is_hub flags')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Materialize Event-Entity Hypergraph ')));
      const s = p.spinner();
      s.start('Materializing event_entity, entity stats & dynamic hub flags...');

      const startedAt = Date.now();
      const idx = new IndexDatabase(opts.index);
      const stats = idx.materializeEventEntities();
      idx.close();

      s.stop(
        color.green(
          `Materialized ${stats.eventEntityRows.toLocaleString()} event_entity rows across ${stats.eventsCovered.toLocaleString()} events (${stats.hubCount} hubs flagged) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
        )
      );
      p.outro(color.dim('Ready for /entities/:id, /entities/:id/ego, /entities/:id/relations, and /events/:id/graph!'));
    });

  // ==========================================
  // Governance & Diagnostic Commands
  // ==========================================
  program
    .command('entities-diagnose')
    .description('Prints comprehensive entity resolution diagnostics: totals, top 30 entities, relation & link_method histograms, and random relation samples')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .action((opts) => {
      p.intro(color.bgCyan(color.black(' Jachaikori · Entity Resolution Diagnostics ')));
      const idx = new IndexDatabase(opts.index);
      const diag = idx.getEntityDiagnostics();
      idx.close();

      console.log('\n=== Totals ===');
      console.table(diag.totals);
      console.log('\n=== Top 30 Active Entities ===');
      console.table(diag.topEntities);
      console.log('\n=== Relation Type Histogram ===');
      console.table(diag.relationHistogram);
      console.log('\n=== Link Method Histogram ===');
      console.table(diag.linkMethodHistogram);
      console.log('\n=== 15 Random Sample Relations ===');
      for (const r of diag.sampleRelations.slice(0, 15)) {
        console.log(
          `  [${r.source}] ${r.sourceName} --(${r.relationType}${r.predicateLabel ? `: ${r.predicateLabel}` : ''})--> ${r.targetName}\n    "${r.snippet.slice(0, 150)}"`
        );
      }
      p.outro(color.dim('Diagnostics complete.'));
    });

  program
    .command('entities-prune')
    .description('Lists (or rejects without --dry-run) stale low-frequency auto entities and colliding aliases')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--dry-run', 'Preview candidates without modifying database', true)
    .option('--apply', 'Actually reject pruned auto entities', false)
    .action((opts) => {
      const idx = new IndexDatabase(opts.index);
      const db = idx.getRawDb();
      const stale = db
        .prepare(
          `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType, article_count as articleCount, last_seen as lastSeen
           FROM entity
           WHERE status = 'active' AND source = 'auto' AND article_count < 8
           ORDER BY article_count ASC
           LIMIT 100`
        )
        .all() as any[];

      const collidingAliases = db
        .prepare(
          `SELECT alias_norm as aliasNorm, COUNT(DISTINCT entity_id) as entityCount
           FROM entity_alias
           GROUP BY alias_norm
           HAVING entityCount >= 3
           ORDER BY entityCount DESC
           LIMIT 30`
        )
        .all() as any[];

      console.log(`Stale low-frequency auto entities (< 8 articles): ${stale.length}`);
      if (stale.length > 0) console.table(stale.slice(0, 25));
      console.log(`Aliases shared by >= 3 entities: ${collidingAliases.length}`);
      if (collidingAliases.length > 0) console.table(collidingAliases);

      if (opts.apply) {
        let count = 0;
        for (const e of stale) {
          idx.rejectEntity(e.id, 'pruned_low_frequency_auto');
          count++;
        }
        console.log(`Rejected ${count} stale auto entities.`);
      }
      idx.close();
    });

  program
    .command('entities-merge <fromId> <toId>')
    .description('Merges fromId into toId with an auditable, reversible entity_merge_log entry')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--reason <text>', 'Reason for merge', 'manual_cli_merge')
    .action((fromId: string, toId: string, opts) => {
      const idx = new IndexDatabase(opts.index);
      const logId = idx.mergeEntities(fromId, toId, opts.reason);
      idx.close();
      console.log(`Merged ${fromId} -> ${toId} (logId: ${logId}). Undo via: bun run backfill entities-unmerge ${logId}`);
    });

  program
    .command('entities-unmerge <logId>')
    .description('Reverses a previously logged entity merge cleanly')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .action((logId: string, opts) => {
      const idx = new IndexDatabase(opts.index);
      const res = idx.unmergeEntities(logId);
      idx.close();
      if (!res) {
        console.error(`Merge log ${logId} not found or already undone.`);
        process.exit(1);
      }
      console.log(`Unmerged ${logId}: restored ${res.fromEntityId} (split back from ${res.toEntityId}).`);
    });

  program
    .command('entities-reject <entityId>')
    .description('Marks an entity rejected, adds its aliases to entity_denylist, and cleans its mentions/relations')
    .option('--index <path>', 'Path to index.sqlite', DEFAULT_INDEX)
    .option('--reason <text>', 'Reason for rejection', 'manual_cli_reject')
    .action((entityId: string, opts) => {
      const idx = new IndexDatabase(opts.index);
      const denied = idx.rejectEntity(entityId, opts.reason);
      idx.close();
      console.log(`Rejected ${entityId} and added ${denied} aliases to entity_denylist.`);
    });
}
