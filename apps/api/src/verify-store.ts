/**
 * @file apps/api/src/verify-store.ts
 * D1 / SQLite persistence adapter for `verification_check` (Sprint 6 Migration 0005).
 */

import type {
  CardExtraction,
  OutletId,
  PopularCheckSummary,
  ResolvedCardEntity,
  StageTimings,
  VerificationCheck,
  VerificationSourceMatch,
} from '@jachaikori/schema';
import type { VerificationCheckStore } from '@jachaikori/verification';

interface RawCheckRow {
  id: string;
  inputType: 'image' | 'text';
  imageHash: string | null;
  perceptualHash: string | null;
  textHash: string | null;
  r2Key: string | null;
  extractedClaimJson: string;
  resultsJson: string;
  status: VerificationCheck['status'];
  provider: VerificationCheck['provider'];
  modelVersion: string;
  pipelineVersion: string;
  hitCount: number;
  latencyMs: number;
  stageTimingsJson: string | null;
  costUsd: number;
  createdAt: string;
  lastHitAt: string;
}

interface StoredResultsPayload {
  resolvedEntities?: ResolvedCardEntity[];
  queryTerms?: string[];
  sources?: VerificationSourceMatch[];
  overallDiffStatus?: VerificationCheck['overallDiffStatus'];
  overallDiffSummary?: VerificationCheck['overallDiffSummary'];
  emptyStateNotice?: VerificationCheck['emptyStateNotice'];
}

function hydrateCheckRow(row: RawCheckRow): VerificationCheck {
  const extraction = JSON.parse(row.extractedClaimJson) as CardExtraction;
  const res = JSON.parse(row.resultsJson) as StoredResultsPayload;
  const rawTimings = row.stageTimingsJson
    ? (JSON.parse(row.stageTimingsJson) as Partial<StageTimings>)
    : {};
  const stageTimingsMs: StageTimings = {
    cacheLookupMs: Number(rawTimings.cacheLookupMs ?? 0),
    extractMs: Number(rawTimings.extractMs ?? 0),
    entityResolveMs: Number(rawTimings.entityResolveMs ?? 0),
    retrievalMs: Number(rawTimings.retrievalMs ?? 0),
    rerankMs: Number(rawTimings.rerankMs ?? 0),
    diffMs: Number(rawTimings.diffMs ?? 0),
    persistMs: Number(rawTimings.persistMs ?? 0),
  };

  return {
    id: row.id,
    status: row.status,
    cacheHit: 'none',
    provider: row.provider,
    modelVersion: row.modelVersion,
    pipelineVersion: row.pipelineVersion,
    inputType: row.inputType,
    imageHash: row.imageHash ?? null,
    perceptualHash: row.perceptualHash ?? null,
    r2Key: row.r2Key ?? null,
    imageUrl: row.r2Key ? `/checks/${row.id}/image` : null,
    extraction,
    resolvedEntities: res.resolvedEntities ?? [],
    queryTerms: res.queryTerms ?? [],
    sources: res.sources ?? [],
    overallDiffStatus: res.overallDiffStatus ?? null,
    overallDiffSummary: res.overallDiffSummary ?? null,
    emptyStateNotice: res.emptyStateNotice ?? null,
    hitCount: Number(row.hitCount ?? 1),
    latencyMs: Number(row.latencyMs ?? 0),
    stageTimingsMs,
    costUsd: Number(row.costUsd ?? 0),
    createdAt: row.createdAt,
    lastHitAt: row.lastHitAt ?? row.createdAt,
  };
}

const SELECT_CHECK_COLUMNS = `
  id,
  input_type as inputType,
  image_hash as imageHash,
  perceptual_hash as perceptualHash,
  text_hash as textHash,
  r2_key as r2Key,
  extracted_claim_json as extractedClaimJson,
  results_json as resultsJson,
  status,
  provider,
  model_version as modelVersion,
  pipeline_version as pipelineVersion,
  hit_count as hitCount,
  latency_ms as latencyMs,
  stage_timings_json as stageTimingsJson,
  cost_usd as costUsd,
  created_at as createdAt,
  last_hit_at as lastHitAt
`;

export class D1VerificationCheckStore implements VerificationCheckStore {
  constructor(private readonly db: D1Database) {}

  async findByExactHash(
    inputType: 'image' | 'text',
    hash: string,
    pipelineVersion: string
  ): Promise<VerificationCheck | null> {
    const col = inputType === 'image' ? 'image_hash' : 'text_hash';
    try {
      const row = await this.db
        .prepare(
          `SELECT ${SELECT_CHECK_COLUMNS}
           FROM verification_check
           WHERE ${col} = ? AND pipeline_version = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .bind(hash, pipelineVersion)
        .first<RawCheckRow>();
      return row ? hydrateCheckRow(row) : null;
    } catch {
      return null;
    }
  }

  async findRecentPerceptualHashes(
    pipelineVersion: string,
    limit = 400
  ): Promise<Array<{ id: string; perceptualHash: string }>> {
    try {
      const res = await this.db
        .prepare(
          `SELECT id, perceptual_hash as perceptualHash
           FROM verification_check
           WHERE pipeline_version = ? AND perceptual_hash IS NOT NULL
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .bind(pipelineVersion, limit)
        .all<{ id: string; perceptualHash: string }>();
      return res.results ?? [];
    } catch {
      return [];
    }
  }

  async getById(id: string): Promise<VerificationCheck | null> {
    try {
      const row = await this.db
        .prepare(`SELECT ${SELECT_CHECK_COLUMNS} FROM verification_check WHERE id = ?`)
        .bind(id)
        .first<RawCheckRow>();
      return row ? hydrateCheckRow(row) : null;
    } catch {
      return null;
    }
  }

  async incrementHitCount(id: string, nowIso: string): Promise<number> {
    try {
      await this.db
        .prepare('UPDATE verification_check SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?')
        .bind(nowIso, id)
        .run();
      const row = await this.db
        .prepare('SELECT hit_count as hitCount FROM verification_check WHERE id = ?')
        .bind(id)
        .first<{ hitCount: number }>();
      return Number(row?.hitCount ?? 1);
    } catch {
      return 1;
    }
  }

  async save(check: VerificationCheck, textHash: string | null = null): Promise<void> {
    const resultsPayload: StoredResultsPayload = {
      resolvedEntities: check.resolvedEntities,
      queryTerms: check.queryTerms,
      sources: check.sources,
      overallDiffStatus: check.overallDiffStatus ?? null,
      overallDiffSummary: check.overallDiffSummary ?? null,
      emptyStateNotice: check.emptyStateNotice,
    };

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO verification_check (
           id, input_type, image_hash, perceptual_hash, text_hash, r2_key,
           extracted_claim_json, results_json, status, provider, model_version,
           pipeline_version, hit_count, latency_ms, stage_timings_json, cost_usd,
           created_at, last_hit_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        check.id,
        check.inputType,
        check.imageHash,
        check.perceptualHash,
        textHash,
        check.r2Key,
        JSON.stringify(check.extraction),
        JSON.stringify(resultsPayload),
        check.status,
        check.provider,
        check.modelVersion,
        check.pipelineVersion,
        check.hitCount,
        check.latencyMs,
        JSON.stringify(check.stageTimingsMs),
        check.costUsd,
        check.createdAt,
        check.lastHitAt ?? check.createdAt
      )
      .run();
  }

  async listPopular(opts: {
    limit?: number;
    status?: VerificationCheck['status'];
  } = {}): Promise<PopularCheckSummary[]> {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
    const where = opts.status ? 'WHERE status = ?' : "WHERE status != 'non_claim'";
    const params = opts.status ? [opts.status, limit] : [limit];

    try {
      const res = await this.db
        .prepare(
          `SELECT ${SELECT_CHECK_COLUMNS}
           FROM verification_check
           ${where}
           ORDER BY hit_count DESC, last_hit_at DESC
           LIMIT ?`
        )
        .bind(...params)
        .all<RawCheckRow>();

      return (res.results ?? []).map((row) => {
        const hydrated = hydrateCheckRow(row);
        return {
          id: hydrated.id,
          status: hydrated.status,
          inputType: hydrated.inputType,
          headline: hydrated.extraction.headline ?? hydrated.extraction.attributedStatement,
          quotedSpeaker: hydrated.extraction.quotedSpeaker,
          publisherLogo: hydrated.extraction.publisherLogo,
          imageUrl: hydrated.imageUrl,
          sourceCount: hydrated.sources.length,
          topOutlet: (hydrated.sources[0]?.outlet ?? null) as OutletId | null,
          hitCount: hydrated.hitCount,
          createdAt: hydrated.createdAt,
          lastHitAt: hydrated.lastHitAt ?? null,
        };
      });
    } catch {
      return [];
    }
  }
}
