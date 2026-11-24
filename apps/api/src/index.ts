/**
 * @file apps/api/src/index.ts
 * Cloudflare Worker API for Jachaikori:
 * - Hybrid Search (D1 Bangla FTS5 + Vectorize BGE-M3 + RRF k=60 + isolate-cached temporal QueryExpander)
 * - Entity Resolution v2 Registry Snapshot (`GET /registry/snapshot`) & Ad-Hoc Resolver (`POST /resolve`)
 * - Entity Relationship Explorer & AI Knowledge Graph (`GET /entities/:id`, `/articles`, `/relations`, `/ego`, `/activity`, `/suggest`)
 * - Cross-Outlet Event Clusters & Similarity / Event Entity Graphs
 */

import {
  buildFtsMatchQuery,
  reciprocalRankFuse,
  AliasDictionaryExpander,
  type RankedChunkCandidate,
} from '@jachaikori/retrieval';
import {
  associationScore,
  compileRegistry,
  resolveArticle,
  type CompiledRegistry,
} from '@jachaikori/entities';
import {
  analyzeCrossOutletDifferences,
  base64ToBytes,
  createVerificationProviders,
  MAX_IMAGE_BYTES,
  runVerificationPipeline,
  SqlVlmCache,
  type CandidateReranker,
  type ClaimDiffJudge,
  type VerificationImageStore,
  type VerificationPipelineInput,
  type VerificationRetriever,
  type VlmExtractor,
} from '@jachaikori/verification';
import {
  normalizeRelationType,
  SearchRequestSchema,
  type ClusterGraphResponse,
  type Entity,
  type EntityAlias,
  type EntityGraphEdge,
  type EntityGraphNode,
  type EntityGraphResponse,
  type EntityHyperedge,
  type EntityProfile,
  type EntityRelationEvidence,
  type EntityRelationType,
  type EntityRole,
  type EntitySummary,
  type EntityType,
  type EventCluster,
  type EventComparisonResponse,
  type EventOutletCoverageItem,
  type GraphEdge,
  type GraphNode,
  type OutletId,
  type RegistrySnapshot,
  type RoleTerm,
  type VlmProviderPreference,
} from '@jachaikori/schema';
import { D1ArticleClaimStore } from './claim-store';
import { D1VerificationCheckStore } from './verify-store';

export interface LocalImageStoreAdapter {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

export interface ApiEnv {
  DB: D1Database;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  CARDS_BUCKET?: R2Bucket;
  VLM_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GCP_PROJECT_ID?: string;
  GCP_LOCATION?: string;
  GCP_ACCESS_TOKEN?: string;
  GET_GCP_ACCESS_TOKEN?: () => Promise<string>;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WORKERS_AI_VISION_MODEL?: string;
  WORKERS_AI_TEXT_MODEL?: string;
  WORKERS_AI_RERANKER_MODEL?: string;
  VERIFY_EXTRACTOR?: VlmExtractor;
  VERIFY_RERANKER?: CandidateReranker;
  VERIFY_DIFF_JUDGE?: ClaimDiffJudge;
  LOCAL_SEMANTIC_SEARCH?: (queryText: string, limit: number) => Promise<RankedChunkCandidate[]>;
  LOCAL_IMAGE_STORE?: LocalImageStoreAdapter;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
};

const HIGH_SALIENCE_HUB_RELATIONS = new Set<string>([
  'diplomatic_action',
  'funded_or_invested',
  'signed_deal_or_agreed',
  'regulated_or_directed',
  'holds_role',
  'affiliated_with',
  'part_of',
]);

interface CachedRegistryEntry {
  version: number;
  checkedAt: number;
  snapshot: RegistrySnapshot;
  compiled: CompiledRegistry;
  expander: AliasDictionaryExpander;
}

const REGISTRY_CACHE = new WeakMap<D1Database, CachedRegistryEntry>();
const CACHE_RECHECK_MS = 5_000;

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function makeSnippet(text: string, maxLen = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
}

/**
 * Loads & caches the Entity Resolution v2 registry snapshot per D1 handle,
 * only recompiling when `registry_version` advances. Gracefully falls back on pre-0004 schemas.
 */
async function getCachedRegistry(db: D1Database): Promise<CachedRegistryEntry> {
  const now = Date.now();
  const existing = REGISTRY_CACHE.get(db);
  if (existing && now - existing.checkedAt < CACHE_RECHECK_MS) {
    return existing;
  }

  let dbVersion = 1;
  try {
    const row = await db.prepare('SELECT MAX(version) as v FROM registry_version').first<{ v: number | null }>();
    dbVersion = Math.max(1, Number(row?.v ?? 1));
  } catch {
    dbVersion = 1;
  }

  if (existing && existing.version === dbVersion) {
    existing.checkedAt = now;
    return existing;
  }

  let entities: Entity[] = [];
  let aliases: EntityAlias[] = [];
  let roleTerms: RoleTerm[] = [];

  try {
    const entRes = await db
      .prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
                status, source, merged_into as mergedInto, is_hub as isHub, metadata_json as metadataJson
         FROM entity`
      )
      .all<any>();
    entities = (entRes.results ?? []).map((r) => ({
      ...r,
      status: r.status ?? 'active',
      source: r.source ?? 'seed',
      isHub: Boolean(r.isHub),
    }));
  } catch {
    const entRes = await db
      .prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType, metadata_json as metadataJson
         FROM entity`
      )
      .all<any>();
    entities = (entRes.results ?? []).map((r) => ({ ...r, status: 'active', source: 'seed', isHub: false }));
  }

  try {
    const aliasRes = await db
      .prepare(
        `SELECT alias_norm as aliasNorm, alias_raw as aliasRaw, entity_id as entityId,
                valid_from as validFrom, valid_to as validTo, kind, require_uppercase as requireUppercase, source
         FROM entity_alias`
      )
      .all<any>();
    aliases = (aliasRes.results ?? []).map((r) => ({
      ...r,
      requireUppercase: Boolean(r.requireUppercase),
    }));
  } catch {
    try {
      const aliasRes = await db
        .prepare(
          `SELECT alias_norm as aliasNorm, alias_raw as aliasRaw, entity_id as entityId,
                  valid_from as validFrom, valid_to as validTo
           FROM entity_alias`
        )
        .all<any>();
      aliases = aliasRes.results ?? [];
    } catch {
      aliases = [];
    }
  }

  try {
    const rtRes = await db
      .prepare(
        `SELECT id, role_entity_id as roleEntityId, holder_entity_id as holderEntityId,
                valid_from as validFrom, valid_to as validTo, source_url as sourceUrl
         FROM role_term`
      )
      .all<RoleTerm>();
    roleTerms = rtRes.results ?? [];
  } catch {
    roleTerms = [];
  }

  const snapshot: RegistrySnapshot = {
    version: dbVersion,
    generatedAt: new Date(now).toISOString(),
    entities,
    aliases,
    roleTerms,
  };
  const compiled = compileRegistry(snapshot);
  const expander = new AliasDictionaryExpander(aliases, roleTerms);

  const entry: CachedRegistryEntry = {
    version: dbVersion,
    checkedAt: now,
    snapshot,
    compiled,
    expander,
  };
  REGISTRY_CACHE.set(db, entry);
  return entry;
}

/**
 * Resolves `entity.merged_into` chain (max 5 hops) so legacy/merged entity URLs redirect seamlessly.
 */
async function resolveCanonicalEntityId(
  db: D1Database,
  rawEntityId: string
): Promise<{ id: string; redirectedFrom?: string }> {
  let cur = rawEntityId;
  for (let hop = 0; hop < 5; hop++) {
    try {
      const row = await db
        .prepare('SELECT id, merged_into as mergedInto FROM entity WHERE id = ?')
        .bind(cur)
        .first<{ id: string; mergedInto: string | null }>();
      if (!row || !row.mergedInto || row.mergedInto === cur) break;
      cur = row.mergedInto;
    } catch {
      break;
    }
  }
  return cur !== rawEntityId ? { id: cur, redirectedFrom: rawEntityId } : { id: cur };
}

async function runKeywordSearch(
  db: D1Database,
  ftsQuery: string,
  opts: { outlet?: string; fromDate?: string; toDate?: string; limit: number }
): Promise<RankedChunkCandidate[]> {
  if (!ftsQuery) return [];

  const filters: string[] = [];
  const params: unknown[] = [ftsQuery];

  if (opts.outlet) {
    filters.push('a.outlet = ?');
    params.push(opts.outlet);
  }
  if (opts.fromDate) {
    filters.push('a.published_at >= ?');
    params.push(opts.fromDate);
  }
  if (opts.toDate) {
    filters.push('a.published_at <= ?');
    params.push(`${opts.toDate}T23:59:59Z`);
  }

  const hasExtraFilters = filters.length > 0;
  const whereExtra = hasExtraFilters ? `WHERE ${filters.join(' AND ')}` : '';
  const ftsPreLimit = hasExtraFilters ? Math.min(500, opts.limit * 8) : opts.limit;

  // CTE restricts chunk/article/cluster JOINs strictly to the top BM25 FTS5 rowids
  // (avoids joining 150k+ rows before LIMIT on broad Bangla/English OR queries!).
  const sql = `
    WITH hits AS (
      SELECT rowid, bm25(chunk_fts) as rank
      FROM chunk_fts
      WHERE chunk_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    )
    SELECT
      c.id as chunkId,
      c.article_id as articleId,
      c.outlet as outlet,
      c.text as text,
      a.title as title,
      a.canonical_url as canonicalUrl,
      a.published_at as publishedAt,
      ac.cluster_id as clusterId,
      ec.outlet_count as clusterOutletCount
    FROM hits h
    JOIN chunk c ON c.rowid = h.rowid
    JOIN article a ON a.id = c.article_id
    LEFT JOIN article_cluster ac ON ac.article_id = a.id
    LEFT JOIN event_cluster ec ON ec.id = ac.cluster_id
    ${whereExtra}
    ORDER BY h.rank ASC
    LIMIT ?
  `;

  const boundParams = [ftsQuery, ftsPreLimit, ...params.slice(1), opts.limit];
  const res = await db.prepare(sql).bind(...boundParams).all<any>();
  return (res.results ?? []).map((r) => ({
    chunkId: r.chunkId,
    articleId: r.articleId,
    outlet: r.outlet as OutletId,
    title: r.title,
    canonicalUrl: r.canonicalUrl,
    publishedAt: r.publishedAt,
    snippet: makeSnippet(r.text),
    clusterId: r.clusterId ?? null,
    clusterOutletCount: r.clusterOutletCount ?? null,
  }));
}

async function runSemanticSearch(
  env: ApiEnv,
  query: string,
  opts: { outlet?: string; limit: number }
): Promise<RankedChunkCandidate[]> {
  if (!env.VECTORIZE || !env.AI) return [];

  const aiResult = (await env.AI.run('@cf/baai/bge-m3', {
    text: [query],
  })) as { data?: number[][] };

  const vector = aiResult?.data?.[0];
  if (!vector || vector.length === 0) return [];

  const vecMatches = await env.VECTORIZE.query(vector, {
    topK: opts.limit,
    filter: opts.outlet ? { outlet: opts.outlet } : undefined,
    returnMetadata: 'none',
  });

  const ids = (vecMatches.matches ?? []).map((m) => m.id);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT
       c.id as chunkId,
       c.article_id as articleId,
       c.outlet as outlet,
       c.text as text,
       a.title as title,
       a.canonical_url as canonicalUrl,
       a.published_at as publishedAt,
       ac.cluster_id as clusterId,
       ec.outlet_count as clusterOutletCount
     FROM chunk c
     JOIN article a ON a.id = c.article_id
     LEFT JOIN article_cluster ac ON ac.article_id = a.id
     LEFT JOIN event_cluster ec ON ec.id = ac.cluster_id
     WHERE c.id IN (${placeholders})`
  )
    .bind(...ids)
    .all<any>();

  const rowById = new Map((rows.results ?? []).map((r) => [r.chunkId, r]));
  const ordered: RankedChunkCandidate[] = [];
  for (const id of ids) {
    const r = rowById.get(id);
    if (!r) continue;
    ordered.push({
      chunkId: r.chunkId,
      articleId: r.articleId,
      outlet: r.outlet as OutletId,
      title: r.title,
      canonicalUrl: r.canonicalUrl,
      publishedAt: r.publishedAt,
      snippet: makeSnippet(r.text),
      clusterId: r.clusterId ?? null,
      clusterOutletCount: r.clusterOutletCount ?? null,
    });
  }
  return ordered;
}

async function handleSearch(req: Request, env: ApiEnv): Promise<Response> {
  const startedAt = Date.now();
  let rawBody: Record<string, unknown> = {};

  if (req.method === 'POST') {
    try {
      rawBody = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400);
    }
  } else {
    const url = new URL(req.url);
    rawBody = {
      query: url.searchParams.get('q') ?? url.searchParams.get('query') ?? '',
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
      outlet: url.searchParams.get('outlet') || undefined,
      fromDate: url.searchParams.get('fromDate') || undefined,
      toDate: url.searchParams.get('toDate') || undefined,
      mode: url.searchParams.get('mode') || undefined,
    };
  }

  const parsed = SearchRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const params = parsed.data;
  const cached = await getCachedRegistry(env.DB);
  const expansion = cached.expander.expand(params.query, params.toDate);

  const ftsQuery = buildFtsMatchQuery(
    expansion.expandedTerms.length > 0
      ? `${params.query} ${expansion.expandedTerms.join(' ')}`
      : params.query,
    expansion.expandedTerms.length > 0 ? 'OR' : 'AND'
  );

  const candidateLimit = Math.max(30, params.limit * 3);

  const [kwHits, semHits] = await Promise.all([
    params.mode === 'semantic'
      ? Promise.resolve([])
      : runKeywordSearch(env.DB, ftsQuery, {
          outlet: params.outlet,
          fromDate: params.fromDate,
          toDate: params.toDate,
          limit: candidateLimit,
        }),
    params.mode === 'keyword'
      ? Promise.resolve([])
      : runSemanticSearch(env, params.query, {
          outlet: params.outlet,
          limit: candidateLimit,
        }),
  ]);

  const fusionK = 60;
  const hits = reciprocalRankFuse(kwHits, semHits, {
    k: fusionK,
    limit: params.limit,
  });

  return json({
    query: params.query,
    expandedTerms: expansion.expandedTerms,
    matchedEntityIds: expansion.matchedEntityIds,
    mode: params.mode,
    fusionK,
    latencyMs: Date.now() - startedAt,
    hits,
  });
}

async function handleRegistrySnapshot(req: Request, env: ApiEnv): Promise<Response> {
  const cached = await getCachedRegistry(env.DB);
  const etag = `"v${cached.version}"`;
  if (req.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, ...CORS_HEADERS },
    });
  }
  return json(cached.snapshot, 200, {
    ETag: etag,
    'Cache-Control': 'public, max-age=60',
  });
}

async function handleAdHocResolve(req: Request, env: ApiEnv): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON request body' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title : typeof body.text === 'string' ? body.text : '';
  const lead = typeof body.lead === 'string' ? body.lead : null;
  const cleanText = typeof body.cleanText === 'string' ? body.cleanText : null;
  const publishedAt = typeof body.publishedAt === 'string' ? body.publishedAt : new Date().toISOString();
  const emitUnlinked = Boolean(body.emitUnlinked ?? false);

  if (!title.trim() && !cleanText?.trim()) {
    return json({ error: 'Provide `text` or `title` to resolve' }, 400);
  }

  const cached = await getCachedRegistry(env.DB);
  const result = resolveArticle(
    {
      id: 'adhoc',
      title: title || '',
      lead,
      cleanText,
      publishedAt,
    },
    cached.compiled,
    { emitUnlinked }
  );

  return json({
    registryVersion: cached.version,
    resolverVersion: result.resolverVersion,
    mentions: result.mentions.map((m) => {
      const ent = cached.compiled.entityMap.get(m.entityId);
      return {
        ...m,
        canonicalBn: ent?.canonicalBn ?? null,
        canonicalEn: ent?.canonicalEn ?? null,
        entityType: ent?.entityType ?? null,
        isHub: Boolean(ent?.isHub),
      };
    }),
    relations: result.relations,
    unlinked: result.unlinked,
  });
}

async function handleListClusters(url: URL, env: ApiEnv): Promise<Response> {
  const minOutlets = Math.max(1, Number(url.searchParams.get('minOutlets') ?? 2));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const q = url.searchParams.get('q')?.trim() ?? '';
  const outlet = url.searchParams.get('outlet')?.trim() ?? '';
  const sort =
    url.searchParams.get('sort') === 'recent'
      ? 'last_seen DESC, outlet_count DESC'
      : 'outlet_count DESC, last_seen DESC';

  const where: string[] = ['outlet_count >= ?'];
  const params: unknown[] = [minOutlets];

  if (q) {
    where.push('(label LIKE ? OR lead_snippet LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (outlet) {
    where.push('outlets_json LIKE ?');
    params.push(`%"${outlet}"%`);
  }

  params.push(limit, offset);

  const rows = await env.DB.prepare(
    `SELECT id, label, lead_snippet as leadSnippet, first_seen as firstSeen, last_seen as lastSeen,
            article_count as articleCount, outlet_count as outletCount, outlets_json as outletsJson
     FROM event_cluster
     WHERE ${where.join(' AND ')}
     ORDER BY ${sort}
     LIMIT ? OFFSET ?`
  )
    .bind(...params)
    .all<any>();

  const clusters: EventCluster[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    leadSnippet: r.leadSnippet ?? null,
    firstSeen: r.firstSeen ?? null,
    lastSeen: r.lastSeen ?? null,
    articleCount: r.articleCount,
    outletCount: r.outletCount,
    outlets: JSON.parse(r.outletsJson || '[]'),
  }));

  return json({ clusters });
}

async function handleClusterGraph(clusterId: string, env: ApiEnv): Promise<Response> {
  const cluRow = await env.DB.prepare(
    `SELECT id, label, lead_snippet as leadSnippet, first_seen as firstSeen, last_seen as lastSeen,
            article_count as articleCount, outlet_count as outletCount, outlets_json as outletsJson
     FROM event_cluster WHERE id = ?`
  )
    .bind(clusterId)
    .first<any>();

  if (!cluRow) {
    return json({ error: 'Cluster not found' }, 404);
  }

  const nodeRows = await env.DB.prepare(
    `SELECT a.id, a.outlet, a.title, a.canonical_url as canonicalUrl, a.published_at as publishedAt, a.lead
     FROM article_cluster ac
     JOIN article a ON a.id = ac.article_id
     WHERE ac.cluster_id = ?
     ORDER BY a.published_at ASC`
  )
    .bind(clusterId)
    .all<any>();

  const memberIds = (nodeRows.results ?? []).map((n) => n.id);
  const edges: GraphEdge[] = [];
  const degreeMap = new Map<string, number>();

  if (memberIds.length > 1) {
    const placeholders = memberIds.map(() => '?').join(',');
    const edgeRows = await env.DB.prepare(
      `SELECT source_id as source, target_id as target, similarity
       FROM article_similarity_edge
       WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`
    )
      .bind(...memberIds, ...memberIds)
      .all<any>();

    for (const e of edgeRows.results ?? []) {
      edges.push({ source: e.source, target: e.target, similarity: e.similarity });
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = (nodeRows.results ?? []).map((n) => ({
    id: n.id,
    outlet: n.outlet as OutletId,
    title: n.title,
    canonicalUrl: n.canonicalUrl,
    publishedAt: n.publishedAt ?? null,
    lead: n.lead ?? null,
    degree: degreeMap.get(n.id) ?? 0,
    clusterId,
  }));

  let entities: EntitySummary[] = [];
  if (memberIds.length > 0) {
    try {
      const placeholders = memberIds.map(() => '?').join(',');
      const entRows = await env.DB.prepare(
        `SELECT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn,
                e.entity_type as entityType, COUNT(DISTINCT ae.article_id) as articleCount
         FROM article_entity ae
         JOIN entity e ON e.id = ae.entity_id
         WHERE ae.article_id IN (${placeholders})
         GROUP BY e.id
         ORDER BY articleCount DESC
         LIMIT 25`
      )
        .bind(...memberIds)
        .all<any>();
      entities = (entRows.results ?? []).map((r) => ({
        id: r.id,
        canonicalBn: r.canonicalBn ?? null,
        canonicalEn: r.canonicalEn ?? null,
        entityType: r.entityType as EntityType,
        articleCount: r.articleCount,
        relationCount: 0,
      }));
    } catch {
      entities = [];
    }
  }

  const payload: ClusterGraphResponse = {
    cluster: {
      id: cluRow.id,
      label: cluRow.label,
      leadSnippet: cluRow.leadSnippet ?? null,
      firstSeen: cluRow.firstSeen ?? null,
      lastSeen: cluRow.lastSeen ?? null,
      articleCount: cluRow.articleCount,
      outletCount: cluRow.outletCount,
      outlets: JSON.parse(cluRow.outletsJson || '[]'),
    },
    nodes,
    edges,
    entities,
  };

  return json(payload);
}

/**
 * Shared builder projecting SQLite/D1 relation + mention rows into an Entity Hypergraph response.
 */
async function buildEntityHypergraphPayload(
  db: D1Database,
  opts: {
    articleIds?: string[];
    centerEntityId?: string;
    clusterLabel?: string | null;
    maxRelations?: number;
  }
): Promise<EntityGraphResponse> {
  const maxRelations = opts.maxRelations ?? 180;
  let relRows: any[] = [];

  if (opts.centerEntityId) {
    try {
      const res = await db
        .prepare(
          `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
                  r.relation_type as relationType, r.predicate_label as predicateLabel, r.source,
                  r.evidence_snippet as snippet, r.published_at as publishedAt,
                  a.title, a.outlet, a.canonical_url as canonicalUrl
           FROM entity_relation r
           JOIN article a ON a.id = r.article_id
           WHERE r.source_entity_id = ? OR r.target_entity_id = ?
           ORDER BY CASE WHEN r.source = 'llm_claim' THEN 0 ELSE 1 END, r.published_at DESC
           LIMIT ?`
        )
        .bind(opts.centerEntityId, opts.centerEntityId, maxRelations)
        .all<any>();
      relRows = res.results ?? [];
    } catch {
      const res = await db
        .prepare(
          `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
                  r.relation_type as relationType, r.evidence_snippet as snippet, r.published_at as publishedAt,
                  a.title, a.outlet, a.canonical_url as canonicalUrl
           FROM entity_relation r
           JOIN article a ON a.id = r.article_id
           WHERE r.source_entity_id = ? OR r.target_entity_id = ?
           ORDER BY r.published_at DESC
           LIMIT ?`
        )
        .bind(opts.centerEntityId, opts.centerEntityId, maxRelations)
        .all<any>();
      relRows = res.results ?? [];
    }
  } else if (opts.articleIds && opts.articleIds.length > 0) {
    const placeholders = opts.articleIds.map(() => '?').join(',');
    try {
      const res = await db
        .prepare(
          `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
                  r.relation_type as relationType, r.predicate_label as predicateLabel, r.source,
                  r.evidence_snippet as snippet, r.published_at as publishedAt,
                  a.title, a.outlet, a.canonical_url as canonicalUrl
           FROM entity_relation r
           JOIN article a ON a.id = r.article_id
           WHERE r.article_id IN (${placeholders})
           ORDER BY r.published_at DESC
           LIMIT ?`
        )
        .bind(...opts.articleIds, maxRelations)
        .all<any>();
      relRows = res.results ?? [];
    } catch {
      const res = await db
        .prepare(
          `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
                  r.relation_type as relationType, r.evidence_snippet as snippet, r.published_at as publishedAt,
                  a.title, a.outlet, a.canonical_url as canonicalUrl
           FROM entity_relation r
           JOIN article a ON a.id = r.article_id
           WHERE r.article_id IN (${placeholders})
           ORDER BY r.published_at DESC
           LIMIT ?`
        )
        .bind(...opts.articleIds, maxRelations)
        .all<any>();
      relRows = res.results ?? [];
    }
  }

  const edgeAgg = new Map<
    string,
    {
      source: string;
      target: string;
      relationType: EntityRelationType;
      predicateLabels: Set<string>;
      weight: number;
      evidence: EntityRelationEvidence[];
      articleIds: Set<string>;
    }
  >();

  const neighborScores = new Map<string, number>();
  const relevantArticleIds = new Set<string>(opts.articleIds ?? []);

  for (const r of relRows) {
    const normRel = normalizeRelationType(r.relationType);
    if (!normRel) continue;
    relevantArticleIds.add(r.articleId);
    const key = `${r.sourceId}|${r.targetId}|${normRel}`;
    let agg = edgeAgg.get(key);
    if (!agg) {
      agg = {
        source: r.sourceId,
        target: r.targetId,
        relationType: normRel,
        predicateLabels: new Set<string>(),
        weight: 0,
        evidence: [],
        articleIds: new Set<string>(),
      };
      edgeAgg.set(key, agg);
    }
    if (r.predicateLabel) agg.predicateLabels.add(String(r.predicateLabel));
    if (!agg.articleIds.has(r.articleId)) {
      agg.articleIds.add(r.articleId);
      agg.weight++;
      if (agg.evidence.length < 6) {
        agg.evidence.push({
          articleId: r.articleId,
          title: r.title,
          outlet: r.outlet as OutletId,
          publishedAt: r.publishedAt ?? null,
          canonicalUrl: r.canonicalUrl,
          snippet: r.snippet,
          relationType: normRel,
          predicateLabel: r.predicateLabel ?? null,
          source: r.source ?? 'deterministic',
        });
      }
    }
    if (opts.centerEntityId) {
      const other = r.sourceId === opts.centerEntityId ? r.targetId : r.sourceId;
      if (other !== opts.centerEntityId) {
        neighborScores.set(other, (neighborScores.get(other) ?? 0) + 1);
      }
    }
  }

  let allowedEntityIds: Set<string> | null = null;
  if (opts.centerEntityId) {
    const topNeighbors = Array.from(neighborScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([id]) => id);
    allowedEntityIds = new Set([opts.centerEntityId, ...topNeighbors]);
  }

  const edges: EntityGraphEdge[] = [];
  const entityIdsInGraph = new Set<string>();
  if (opts.centerEntityId) entityIdsInGraph.add(opts.centerEntityId);

  for (const agg of edgeAgg.values()) {
    if (allowedEntityIds && (!allowedEntityIds.has(agg.source) || !allowedEntityIds.has(agg.target))) {
      continue;
    }
    entityIdsInGraph.add(agg.source);
    entityIdsInGraph.add(agg.target);
    edges.push({
      source: agg.source,
      target: agg.target,
      relationType: agg.relationType,
      predicateLabels: Array.from(agg.predicateLabels).slice(0, 5),
      weight: agg.weight,
      evidence: agg.evidence,
    });
  }

  const scopedArticles = Array.from(relevantArticleIds).slice(0, 40);
  const mentionMapByEntity = new Map<string, { articles: Set<string>; roles: Set<EntityRole> }>();
  const hyperedgeMap = new Map<string, EntityHyperedge>();

  if (scopedArticles.length > 0) {
    const ph = scopedArticles.map(() => '?').join(',');
    const mentionRows = await db
      .prepare(
        `SELECT ae.article_id as articleId, ae.entity_id as entityId, ae.role,
                a.title, a.outlet, a.published_at as publishedAt, a.canonical_url as canonicalUrl
         FROM article_entity ae
         JOIN article a ON a.id = ae.article_id
         WHERE ae.article_id IN (${ph})`
      )
      .bind(...scopedArticles)
      .all<any>();

    for (const m of mentionRows.results ?? []) {
      if (allowedEntityIds && !allowedEntityIds.has(m.entityId)) continue;
      if (opts.articleIds) entityIdsInGraph.add(m.entityId);

      let entStat = mentionMapByEntity.get(m.entityId);
      if (!entStat) {
        entStat = { articles: new Set<string>(), roles: new Set<EntityRole>() };
        mentionMapByEntity.set(m.entityId, entStat);
      }
      entStat.articles.add(m.articleId);
      entStat.roles.add((m.role || 'mentioned') as EntityRole);

      let he = hyperedgeMap.get(m.articleId);
      if (!he) {
        he = {
          articleId: m.articleId,
          title: m.title,
          outlet: m.outlet as OutletId,
          publishedAt: m.publishedAt ?? null,
          canonicalUrl: m.canonicalUrl,
          entityIds: [],
          roleByEntity: {},
        };
        hyperedgeMap.set(m.articleId, he);
      }
      if (!he.entityIds.includes(m.entityId)) {
        he.entityIds.push(m.entityId);
      }
      he.roleByEntity[m.entityId] = (m.role || 'mentioned') as EntityRole;
    }
  }

  const allNodeIds = Array.from(entityIdsInGraph);
  const nodes: EntityGraphNode[] = [];
  if (allNodeIds.length > 0) {
    const ph = allNodeIds.map(() => '?').join(',');
    let entityRows: any[] = [];
    try {
      const res = await db
        .prepare(
          `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
                  is_hub as isHub, short_tagline_bn as shortTaglineBn, short_tagline_en as shortTaglineEn
           FROM entity
           WHERE id IN (${ph})`
        )
        .bind(...allNodeIds)
        .all<any>();
      entityRows = res.results ?? [];
    } catch {
      const res = await db
        .prepare(
          `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
           FROM entity
           WHERE id IN (${ph})`
        )
        .bind(...allNodeIds)
        .all<any>();
      entityRows = res.results ?? [];
    }

    for (const er of entityRows) {
      const stat = mentionMapByEntity.get(er.id);
      nodes.push({
        id: er.id,
        canonicalBn: er.canonicalBn ?? null,
        canonicalEn: er.canonicalEn ?? null,
        entityType: er.entityType as EntityType,
        isHub: Boolean(er.isHub),
        shortTaglineBn: er.shortTaglineBn ?? null,
        shortTaglineEn: er.shortTaglineEn ?? null,
        mentionCount: Math.max(1, stat?.articles.size ?? 1),
        roles: stat ? Array.from(stat.roles) : [],
        isCenter: opts.centerEntityId ? er.id === opts.centerEntityId : undefined,
      });
    }
  }

  const centerEntity = opts.centerEntityId
    ? nodes.find((n) => n.id === opts.centerEntityId) ?? null
    : null;

  const hyperedges = Array.from(hyperedgeMap.values())
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 30);

  return {
    centerEntity,
    clusterLabel: opts.clusterLabel ?? null,
    nodes,
    edges,
    hyperedges,
  };
}

async function handleListEntities(url: URL, env: ApiEnv): Promise<Response> {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const type = url.searchParams.get('type')?.trim() ?? '';
  const includeHubs = url.searchParams.get('includeHubs') !== 'false';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

  const where: string[] = [];
  const params: unknown[] = [];

  if (type) {
    where.push('e.entity_type = ?');
    params.push(type);
  }
  if (q) {
    where.push(
      `(e.canonical_bn LIKE ? OR e.canonical_en LIKE ? OR EXISTS (SELECT 1 FROM entity_alias ea WHERE ea.entity_id = e.id AND ea.alias_raw LIKE ?))`
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  // Fast path using v2 precomputed `entity.article_count` & `status = 'active'` (avoids 1M-row GROUP BY!)
  try {
    const v2Where = ["e.status = 'active'", ...where];
    if (!includeHubs) v2Where.push('e.is_hub = 0');
    const hasPrecomputed = await env.DB.prepare(
      "SELECT 1 as ok FROM entity WHERE status = 'active' AND article_count > 0 LIMIT 1"
    ).first<{ ok: number }>();

    if (hasPrecomputed) {
      const rows = await env.DB.prepare(
        `SELECT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn,
                e.entity_type as entityType, e.is_hub as isHub,
                e.short_tagline_bn as shortTaglineBn, e.short_tagline_en as shortTaglineEn,
                e.article_count as articleCount, e.event_count as eventCount
         FROM entity e
         WHERE ${v2Where.join(' AND ')} AND e.article_count > 0
         ORDER BY e.article_count DESC, e.event_count DESC
         LIMIT ? OFFSET ?`
      )
        .bind(...params, limit, offset)
        .all<any>();

      const entities: EntitySummary[] = (rows.results ?? []).map((r) => ({
        id: r.id,
        canonicalBn: r.canonicalBn ?? null,
        canonicalEn: r.canonicalEn ?? null,
        entityType: r.entityType as EntityType,
        isHub: Boolean(r.isHub),
        shortTaglineBn: r.shortTaglineBn ?? null,
        shortTaglineEn: r.shortTaglineEn ?? null,
        articleCount: r.articleCount,
        eventCount: r.eventCount ?? 0,
        relationCount: 0,
      }));
      return json({ entities });
    }
  } catch {
    // Fall through to legacy live GROUP BY on pre-0004 schemas
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await env.DB.prepare(
    `SELECT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn,
            e.entity_type as entityType,
            COUNT(DISTINCT ae.article_id) as articleCount
     FROM entity e
     LEFT JOIN article_entity ae ON ae.entity_id = e.id
     ${whereSql}
     GROUP BY e.id
     HAVING articleCount > 0
     ORDER BY articleCount DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<any>();

  const entities: EntitySummary[] = (rows.results ?? []).map((r) => ({
    id: r.id,
    canonicalBn: r.canonicalBn ?? null,
    canonicalEn: r.canonicalEn ?? null,
    entityType: r.entityType as EntityType,
    articleCount: r.articleCount,
    relationCount: 0,
  }));

  return json({ entities });
}

/**
 * Full Entity Profile / AI Knowledge Graph Dossier (`GET /entities/:id`).
 */
async function handleEntityProfile(rawEntityId: string, env: ApiEnv): Promise<Response> {
  const { id: entityId, redirectedFrom } = await resolveCanonicalEntityId(env.DB, rawEntityId);

  let entRow: any = null;
  try {
    entRow = await env.DB.prepare(
      `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
              status, source, is_hub as isHub,
              short_tagline_bn as shortTaglineBn, short_tagline_en as shortTaglineEn,
              description_bn as descriptionBn, description_en as descriptionEn,
              description_sources_json as descriptionSourcesJson, description_updated_at as descriptionUpdatedAt,
              article_count as articleCount, event_count as eventCount,
              first_seen as firstSeen, last_seen as lastSeen
       FROM entity WHERE id = ?`
    )
      .bind(entityId)
      .first<any>();
  } catch {
    entRow = await env.DB.prepare(
      `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
       FROM entity WHERE id = ?`
    )
      .bind(entityId)
      .first<any>();
  }

  if (!entRow) {
    return json({ error: 'Entity not found' }, 404);
  }

  // Aliases
  let aliases: Array<{ aliasRaw: string; kind: any }> = [];
  try {
    const aRes = await env.DB.prepare(
      'SELECT alias_raw as aliasRaw, kind FROM entity_alias WHERE entity_id = ? ORDER BY alias_raw ASC LIMIT 40'
    )
      .bind(entityId)
      .all<any>();
    aliases = aRes.results ?? [];
  } catch {
    const aRes = await env.DB.prepare(
      'SELECT alias_raw as aliasRaw FROM entity_alias WHERE entity_id = ? LIMIT 40'
    )
      .bind(entityId)
      .all<any>();
    aliases = (aRes.results ?? []).map((r) => ({ aliasRaw: r.aliasRaw, kind: null }));
  }

  // Role terms (both offices held by this person and historical holders if this entity is a role)
  let roleTerms: EntityProfile['roleTerms'] = [];
  try {
    const rtRes = await env.DB.prepare(
      `SELECT rt.id, rt.role_entity_id as roleEntityId,
              re.canonical_bn as roleNameBn, re.canonical_en as roleNameEn,
              rt.holder_entity_id as holderEntityId,
              he.canonical_bn as holderNameBn, he.canonical_en as holderNameEn,
              rt.valid_from as validFrom, rt.valid_to as validTo
       FROM role_term rt
       LEFT JOIN entity re ON re.id = rt.role_entity_id
       LEFT JOIN entity he ON he.id = rt.holder_entity_id
       WHERE rt.holder_entity_id = ? OR rt.role_entity_id = ?
       ORDER BY rt.valid_from DESC`
    )
      .bind(entityId, entityId)
      .all<any>();
    roleTerms = (rtRes.results ?? []).map((r) => ({
      id: r.id,
      roleEntityId: r.roleEntityId,
      roleNameBn: r.roleNameBn ?? null,
      roleNameEn: r.roleNameEn ?? null,
      holderEntityId: r.holderEntityId,
      holderNameBn: r.holderNameBn ?? null,
      holderNameEn: r.holderNameEn ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
    }));
  } catch {
    roleTerms = [];
  }

  // Resolve citing article IDs for description
  let descriptionSources: EntityProfile['descriptionSources'] = [];
  if (entRow.descriptionSourcesJson) {
    try {
      const sourceIds = (JSON.parse(entRow.descriptionSourcesJson) as string[]).slice(0, 10);
      if (sourceIds.length > 0) {
        const ph = sourceIds.map(() => '?').join(',');
        const srcRows = await env.DB.prepare(
          `SELECT id as articleId, title, outlet, published_at as publishedAt, canonical_url as canonicalUrl
           FROM article WHERE id IN (${ph})`
        )
          .bind(...sourceIds)
          .all<any>();
        descriptionSources = (srcRows.results ?? []).map((s) => ({
          articleId: s.articleId,
          title: s.title,
          outlet: s.outlet as OutletId,
          publishedAt: s.publishedAt ?? null,
          canonicalUrl: s.canonicalUrl,
        }));
      }
    } catch {
      descriptionSources = [];
    }
  }

  const relCountRow = await env.DB.prepare(
    'SELECT COUNT(*) as c FROM entity_relation WHERE source_entity_id = ? OR target_entity_id = ?'
  )
    .bind(entityId, entityId)
    .first<{ c: number }>();

  let articleCount = Number(entRow.articleCount ?? 0);
  if (articleCount === 0) {
    const acRow = await env.DB.prepare('SELECT COUNT(DISTINCT article_id) as c FROM article_entity WHERE entity_id = ?')
      .bind(entityId)
      .first<{ c: number }>();
    articleCount = Number(acRow?.c ?? 0);
  }

  let eventCount = Number(entRow.eventCount ?? 0);
  if (eventCount === 0) {
    const ecRow = await env.DB.prepare('SELECT COUNT(DISTINCT event_id) as c FROM event_entity WHERE entity_id = ?')
      .bind(entityId)
      .first<{ c: number }>();
    eventCount = Number(ecRow?.c ?? 0);
  }

  const profile: EntityProfile = {
    id: entRow.id,
    canonicalBn: entRow.canonicalBn ?? null,
    canonicalEn: entRow.canonicalEn ?? null,
    entityType: entRow.entityType as EntityType,
    status: (entRow.status ?? 'active') as EntityProfile['status'],
    source: (entRow.source ?? 'seed') as EntityProfile['source'],
    isHub: Boolean(entRow.isHub),
    ...(redirectedFrom ? { redirectedFrom } : {}),
    shortTaglineBn: entRow.shortTaglineBn ?? null,
    shortTaglineEn: entRow.shortTaglineEn ?? null,
    descriptionBn: entRow.descriptionBn ?? null,
    descriptionEn: entRow.descriptionEn ?? null,
    descriptionUpdatedAt: entRow.descriptionUpdatedAt ?? null,
    descriptionSources,
    aliases,
    roleTerms,
    stats: {
      articleCount,
      eventCount,
      relationCount: Number(relCountRow?.c ?? 0),
      firstSeen: entRow.firstSeen ?? null,
      lastSeen: entRow.lastSeen ?? null,
    },
  };

  return json(profile);
}

/**
 * Paginated articles mentioning an entity (`GET /entities/:id/articles?with=&role=&from=&to=&sort=&limit=&offset=`).
 */
async function handleEntityArticles(rawEntityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const { id: entityId, redirectedFrom } = await resolveCanonicalEntityId(env.DB, rawEntityId);
  const exists = await env.DB.prepare('SELECT id FROM entity WHERE id = ?').bind(entityId).first<{ id: string }>();
  if (!exists) return json({ error: 'Entity not found' }, 404);

  const withEntityRaw = url.searchParams.get('with')?.trim() || undefined;
  const withEntityId = withEntityRaw ? (await resolveCanonicalEntityId(env.DB, withEntityRaw)).id : undefined;
  const role = url.searchParams.get('role')?.trim() || undefined;
  const fromDate = url.searchParams.get('from')?.trim() || undefined;
  const toDateRaw = url.searchParams.get('to')?.trim() || undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;
  const sort = url.searchParams.get('sort') === 'salience' ? 'salience' : 'recent';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

  const where: string[] = ['ae.entity_id = ?'];
  const params: unknown[] = [entityId];
  let joinExtra = '';

  if (withEntityId && withEntityId !== entityId) {
    joinExtra = 'JOIN article_entity ae2 ON ae2.article_id = a.id AND ae2.entity_id = ?';
    params.unshift(withEntityId);
  }
  if (role) {
    where.push('ae.role = ?');
    params.push(role);
  }
  if (fromDate) {
    where.push('a.published_at >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    where.push('a.published_at <= ?');
    params.push(toDate);
  }

  const whereSql = where.join(' AND ');
  let total = 0;
  if (!withEntityId && !role && !fromDate && !toDate) {
    try {
      const preRow = await env.DB.prepare('SELECT article_count as total FROM entity WHERE id = ?')
        .bind(entityId)
        .first<{ total: number }>();
      total = Number(preRow?.total ?? 0);
    } catch {
      total = 0;
    }
  }
  if (total === 0) {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(DISTINCT a.id) as total
       FROM article_entity ae
       JOIN article a ON a.id = ae.article_id
       ${joinExtra}
       WHERE ${whereSql}`
    )
      .bind(...params)
      .first<{ total: number }>();
    total = Number(countRow?.total ?? 0);
  }

  let rows: any[] = [];
  try {
    const orderSql =
      sort === 'salience'
        ? 'ae.in_headline DESC, ae.salience DESC, a.published_at DESC'
        : 'a.published_at DESC, ae.in_headline DESC';
    const res = await env.DB.prepare(
      `SELECT DISTINCT a.id, a.outlet, a.title, a.lead, a.canonical_url as canonicalUrl,
              a.published_at as publishedAt, ae.role, ae.surface_form as surfaceForm,
              ae.in_headline as inHeadline, ae.mention_count as mentionCount, ae.salience,
              ac.cluster_id as clusterId
       FROM article_entity ae
       JOIN article a ON a.id = ae.article_id
       ${joinExtra}
       LEFT JOIN article_cluster ac ON ac.article_id = a.id
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
      .bind(...params, limit, offset)
      .all<any>();
    rows = res.results ?? [];
  } catch {
    const res = await env.DB.prepare(
      `SELECT DISTINCT a.id, a.outlet, a.title, a.lead, a.canonical_url as canonicalUrl,
              a.published_at as publishedAt, ae.role, ae.surface_form as surfaceForm,
              ac.cluster_id as clusterId
       FROM article_entity ae
       JOIN article a ON a.id = ae.article_id
       ${joinExtra}
       LEFT JOIN article_cluster ac ON ac.article_id = a.id
       WHERE ${whereSql}
       ORDER BY a.published_at DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...params, limit, offset)
      .all<any>();
    rows = res.results ?? [];
  }

  return json({
    entityId,
    ...(redirectedFrom ? { redirectedFrom } : {}),
    withEntityId: withEntityId ?? null,
    total,
    articles: rows.map((r) => ({
      id: r.id,
      outlet: r.outlet,
      title: r.title,
      lead: r.lead ?? null,
      canonicalUrl: r.canonicalUrl,
      publishedAt: r.publishedAt ?? null,
      role: r.role,
      surfaceForm: r.surfaceForm,
      inHeadline: Boolean(r.inHeadline),
      mentionCount: Number(r.mentionCount ?? 1),
      salience: Number(r.salience ?? 0.5),
      clusterId: r.clusterId ?? null,
    })),
  });
}

/**
 * Aggregated directional typed relationships for an entity (`GET /entities/:id/relations`).
 */
async function handleEntityRelations(rawEntityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const { id: entityId, redirectedFrom } = await resolveCanonicalEntityId(env.DB, rawEntityId);
  const exists = await env.DB.prepare('SELECT id FROM entity WHERE id = ?').bind(entityId).first<{ id: string }>();
  if (!exists) return json({ error: 'Entity not found' }, 404);

  const relTypeFilter = url.searchParams.get('type')?.trim() || undefined;
  const sourceFilter = url.searchParams.get('source')?.trim() || undefined;
  const fromDate = url.searchParams.get('from')?.trim() || undefined;
  const toDateRaw = url.searchParams.get('to')?.trim() || undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;
  const includeHubs = url.searchParams.get('includeHubs') === 'true';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 40)));

  const where: string[] = ['(r.source_entity_id = ? OR r.target_entity_id = ?)'];
  const params: unknown[] = [entityId, entityId];
  if (relTypeFilter) {
    where.push('r.relation_type = ?');
    params.push(relTypeFilter);
  }
  if (fromDate) {
    where.push('r.published_at >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    where.push('r.published_at <= ?');
    params.push(toDate);
  }

  let rows: any[] = [];
  try {
    const v2Where = [...where, "other.status = 'active'"];
    const v2Params = [...params];
    if (sourceFilter === 'llm_claim' || sourceFilter === 'deterministic') {
      v2Where.push('r.source = ?');
      v2Params.push(sourceFilter);
    }
    const res = await env.DB.prepare(
      `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
              r.relation_type as relationType, r.predicate_label as predicateLabel, r.source,
              r.evidence_snippet as snippet, r.published_at as publishedAt, r.confidence,
              a.title, a.outlet, a.canonical_url as canonicalUrl,
              other.id as otherId, other.canonical_bn as otherBn, other.canonical_en as otherEn,
              other.entity_type as otherType, other.is_hub as otherIsHub,
              other.short_tagline_bn as otherTaglineBn, other.short_tagline_en as otherTaglineEn
       FROM entity_relation r
       JOIN article a ON a.id = r.article_id
       JOIN entity other ON other.id = CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END
       WHERE ${v2Where.join(' AND ')}
       ORDER BY CASE WHEN r.source = 'llm_claim' THEN 0 ELSE 1 END, r.published_at DESC
       LIMIT 1500`
    )
      .bind(entityId, ...v2Params)
      .all<any>();
    rows = res.results ?? [];
  } catch {
    const res = await env.DB.prepare(
      `SELECT r.article_id as articleId, r.source_entity_id as sourceId, r.target_entity_id as targetId,
              r.relation_type as relationType, r.evidence_snippet as snippet, r.published_at as publishedAt, r.confidence,
              a.title, a.outlet, a.canonical_url as canonicalUrl,
              other.id as otherId, other.canonical_bn as otherBn, other.canonical_en as otherEn,
              other.entity_type as otherType
       FROM entity_relation r
       JOIN article a ON a.id = r.article_id
       JOIN entity other ON other.id = CASE WHEN r.source_entity_id = ? THEN r.target_entity_id ELSE r.source_entity_id END
       WHERE ${where.join(' AND ')}
       ORDER BY r.published_at DESC
       LIMIT 600`
    )
      .bind(entityId, ...params)
      .all<any>();
    rows = res.results ?? [];
  }

  const grouped = new Map<
    string,
    {
      direction: 'out' | 'in';
      relationType: EntityRelationType;
      otherEntity: {
        id: string;
        canonicalBn: string | null;
        canonicalEn: string | null;
        entityType: EntityType;
        isHub: boolean;
        shortTaglineBn: string | null;
        shortTaglineEn: string | null;
      };
      predicateLabels: Set<string>;
      sources: Set<string>;
      weight: number;
      latestAt: string | null;
      articleIds: Set<string>;
      evidence: EntityRelationEvidence[];
    }
  >();

  for (const r of rows) {
    const normRel = normalizeRelationType(r.relationType);
    if (!normRel) continue;
    const otherIsHub = Boolean(r.otherIsHub);
    // Keep high-salience bilateral/structural relations to hubs, hide passive hub noise unless requested
    if (!includeHubs && otherIsHub && !HIGH_SALIENCE_HUB_RELATIONS.has(normRel)) {
      continue;
    }

    const direction: 'out' | 'in' = r.sourceId === entityId ? 'out' : 'in';
    const key = `${direction}|${normRel}|${r.otherId}`;
    let g = grouped.get(key);
    if (!g) {
      g = {
        direction,
        relationType: normRel,
        otherEntity: {
          id: r.otherId,
          canonicalBn: r.otherBn ?? null,
          canonicalEn: r.otherEn ?? null,
          entityType: r.otherType as EntityType,
          isHub: otherIsHub,
          shortTaglineBn: r.otherTaglineBn ?? null,
          shortTaglineEn: r.otherTaglineEn ?? null,
        },
        predicateLabels: new Set<string>(),
        sources: new Set<string>(),
        weight: 0,
        latestAt: r.publishedAt ?? null,
        articleIds: new Set<string>(),
        evidence: [],
      };
      grouped.set(key, g);
    }

    if (r.predicateLabel) g.predicateLabels.add(String(r.predicateLabel));
    g.sources.add(r.source ?? 'deterministic');
    if (r.publishedAt && (!g.latestAt || r.publishedAt > g.latestAt)) {
      g.latestAt = r.publishedAt;
    }
    if (!g.articleIds.has(r.articleId)) {
      g.articleIds.add(r.articleId);
      g.weight++;
      if (g.evidence.length < 6) {
        g.evidence.push({
          articleId: r.articleId,
          title: r.title,
          outlet: r.outlet as OutletId,
          publishedAt: r.publishedAt ?? null,
          canonicalUrl: r.canonicalUrl,
          snippet: r.snippet,
          relationType: normRel,
          predicateLabel: r.predicateLabel ?? null,
          source: r.source ?? 'deterministic',
        });
      }
    }
  }

  const relations = Array.from(grouped.values())
    .sort((a, b) => b.weight - a.weight || (b.latestAt ?? '').localeCompare(a.latestAt ?? ''))
    .slice(0, limit)
    .map((g) => ({
      direction: g.direction,
      relationType: g.relationType,
      predicateLabels: Array.from(g.predicateLabels).slice(0, 6),
      sources: Array.from(g.sources),
      weight: g.weight,
      latestAt: g.latestAt,
      otherEntity: g.otherEntity,
      evidence: g.evidence,
    }));

  return json({
    entityId,
    ...(redirectedFrom ? { redirectedFrom } : {}),
    relations,
  });
}

async function handleEntityGraph(rawEntityId: string, env: ApiEnv): Promise<Response> {
  const { id: entityId } = await resolveCanonicalEntityId(env.DB, rawEntityId);
  const exists = await env.DB.prepare('SELECT id FROM entity WHERE id = ?').bind(entityId).first<any>();
  if (!exists) {
    return json({ error: 'Entity not found' }, 404);
  }
  const payload = await buildEntityHypergraphPayload(env.DB, {
    centerEntityId: entityId,
    maxRelations: 200,
  });
  return json(payload);
}

async function handleClusterEntities(clusterId: string, env: ApiEnv): Promise<Response> {
  const cluRow = await env.DB.prepare('SELECT id, label FROM event_cluster WHERE id = ?')
    .bind(clusterId)
    .first<any>();
  if (!cluRow) {
    return json({ error: 'Cluster not found' }, 404);
  }
  const memberRows = await env.DB.prepare('SELECT article_id as articleId FROM article_cluster WHERE cluster_id = ?')
    .bind(clusterId)
    .all<any>();
  const articleIds = (memberRows.results ?? []).map((r) => r.articleId);

  const payload = await buildEntityHypergraphPayload(env.DB, {
    articleIds,
    clusterLabel: cluRow.label,
    maxRelations: 200,
  });
  return json(payload);
}

async function handleArticleGraph(articleId: string, env: ApiEnv): Promise<Response> {
  const edgeRows = await env.DB.prepare(
    `SELECT source_id as source, target_id as target, similarity
     FROM article_similarity_edge
     WHERE source_id = ? OR target_id = ?
     ORDER BY similarity DESC
     LIMIT 40`
  )
    .bind(articleId, articleId)
    .all<any>();

  const idSet = new Set<string>([articleId]);
  const edges: GraphEdge[] = [];
  const degreeMap = new Map<string, number>();

  for (const e of edgeRows.results ?? []) {
    idSet.add(e.source);
    idSet.add(e.target);
    edges.push({ source: e.source, target: e.target, similarity: e.similarity });
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }

  const ids = Array.from(idSet);
  const placeholders = ids.map(() => '?').join(',');
  const nodeRows = await env.DB.prepare(
    `SELECT a.id, a.outlet, a.title, a.canonical_url as canonicalUrl, a.published_at as publishedAt, a.lead,
            ac.cluster_id as clusterId
     FROM article a
     LEFT JOIN article_cluster ac ON ac.article_id = a.id
     WHERE a.id IN (${placeholders})`
  )
    .bind(...ids)
    .all<any>();

  const nodes: GraphNode[] = (nodeRows.results ?? []).map((n) => ({
    id: n.id,
    outlet: n.outlet as OutletId,
    title: n.title,
    canonicalUrl: n.canonicalUrl,
    publishedAt: n.publishedAt ?? null,
    lead: n.lead ?? null,
    degree: degreeMap.get(n.id) ?? 0,
    clusterId: n.clusterId ?? null,
  }));

  return json({ cluster: null, nodes, edges } satisfies ClusterGraphResponse);
}

const D1_MAX_PARAMS = 80;

function toDateUpperBound(toDate: string): string {
  return toDate.includes('T') ? toDate : `${toDate}T23:59:59Z`;
}

function chunkArray<T>(items: T[], size = D1_MAX_PARAMS): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function handleSuggestEntities(url: URL, env: ApiEnv): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return json({ entities: [] });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 10) || 10, 1), 50);
  const pattern = `%${q}%`;

  try {
    const rows = await env.DB.prepare(
      `SELECT
         e.id,
         e.canonical_bn as canonicalBn,
         e.canonical_en as canonicalEn,
         e.entity_type as entityType,
         e.is_hub as isHub,
         e.short_tagline_bn as shortTaglineBn,
         e.short_tagline_en as shortTaglineEn,
         e.article_count as articleCount
       FROM entity e
       WHERE e.status = 'active'
         AND (
           e.canonical_bn LIKE ?
           OR e.canonical_en LIKE ?
           OR EXISTS (
             SELECT 1 FROM entity_alias ea
             WHERE ea.entity_id = e.id
               AND (ea.alias_raw LIKE ? OR ea.alias_norm LIKE ?)
           )
         )
       ORDER BY e.article_count DESC, e.canonical_bn ASC
       LIMIT ?`
    )
      .bind(pattern, pattern, pattern, pattern.toLowerCase(), limit)
      .all<any>();

    return json({
      entities: (rows.results ?? []).map((r) => ({
        ...r,
        isHub: Boolean(r.isHub),
      })),
    });
  } catch {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT
         e.id,
         e.canonical_bn as canonicalBn,
         e.canonical_en as canonicalEn,
         e.entity_type as entityType
       FROM entity e
       LEFT JOIN entity_alias ea ON ea.entity_id = e.id
       WHERE e.canonical_bn LIKE ?
          OR e.canonical_en LIKE ?
          OR ea.alias_raw LIKE ?
          OR ea.alias_norm LIKE ?
       ORDER BY e.canonical_bn ASC
       LIMIT ?`
    )
      .bind(pattern, pattern, pattern, pattern.toLowerCase(), limit)
      .all<any>();

    return json({ entities: rows.results ?? [] });
  }
}

async function handleEntityEgo(rawEntityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const { id: entityId, redirectedFrom } = await resolveCanonicalEntityId(env.DB, rawEntityId);

  let centerRow: any = null;
  try {
    centerRow = await env.DB.prepare(
      `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
              is_hub as isHub, short_tagline_bn as shortTaglineBn, short_tagline_en as shortTaglineEn,
              description_bn as descriptionBn, description_en as descriptionEn
       FROM entity WHERE id = ?`
    )
      .bind(entityId)
      .first<any>();
  } catch {
    centerRow = await env.DB.prepare(
      `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
       FROM entity WHERE id = ?`
    )
      .bind(entityId)
      .first<any>();
  }

  if (!centerRow) {
    return json({ error: 'Entity not found' }, 404);
  }
  centerRow = { ...centerRow, isHub: Boolean(centerRow.isHub) };

  const fromDate = url.searchParams.get('from') ?? undefined;
  const toDateRaw = url.searchParams.get('to') ?? undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;
  const includeHubs = url.searchParams.get('includeHubs') === 'true';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20) || 20, 1), 50);

  const dateFilters: string[] = [];
  const dateParams: unknown[] = [];
  if (fromDate) {
    dateFilters.push('event_end >= ?');
    dateParams.push(fromDate);
  }
  if (toDate) {
    dateFilters.push('event_start <= ?');
    dateParams.push(toDate);
  }
  const dateWhere = dateFilters.length > 0 ? `WHERE ${dateFilters.join(' AND ')}` : '';
  const dateAnd = dateFilters.length > 0 ? `AND ${dateFilters.join(' AND ')}` : '';

  const nAllRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT event_id) as cnt FROM event_entity ${dateWhere}`
  )
    .bind(...dateParams)
    .first<{ cnt: number }>();
  const nAll = Number(nAllRow?.cnt ?? 0);

  if (nAll === 0) {
    return json({
      centerEntity: centerRow,
      ...(redirectedFrom ? { redirectedFrom } : {}),
      nMe: 0,
      nAll: 0,
      neighbors: [],
      events: [],
      incidence: [],
    });
  }

  const nMeRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT event_id) as cnt FROM event_entity WHERE entity_id = ? ${dateAnd}`
  )
    .bind(entityId, ...dateParams)
    .first<{ cnt: number }>();
  const nMe = Number(nMeRow?.cnt ?? 0);

  const coFilters: string[] = ['a.entity_id = ?', 'b.entity_id != ?'];
  const coParams: unknown[] = [entityId, entityId];
  if (fromDate) {
    coFilters.push('a.event_end >= ?');
    coParams.push(fromDate);
  }
  if (toDate) {
    coFilters.push('a.event_start <= ?');
    coParams.push(toDate);
  }

  // Over-fetch non-hub co-occurring candidates (4x limit) BEFORE ranking by damped PMI.
  // CROSS JOIN locks SQLite join order (a -> b -> eb) so it never builds a Cartesian product
  // between `entity eb` and `event_entity a` when `a` has thousands of events.
  const candidatePoolLimit = Math.min(200, limit * 4);
  let coList: Array<{ otherId: string; together: number }> = [];
  try {
    const hubClause = includeHubs ? '' : 'AND eb.is_hub = 0';
    const coRows = await env.DB.prepare(
      `SELECT b.entity_id as otherId, COUNT(*) as together
       FROM event_entity a
       CROSS JOIN event_entity b ON b.event_id = a.event_id
       CROSS JOIN entity eb ON eb.id = b.entity_id AND eb.status = 'active' ${hubClause}
       WHERE ${coFilters.join(' AND ')}
       GROUP BY b.entity_id
       ORDER BY together DESC
       LIMIT ?`
    )
      .bind(...coParams, candidatePoolLimit)
      .all<{ otherId: string; together: number }>();
    coList = coRows.results ?? [];
  } catch {
    const coRows = await env.DB.prepare(
      `SELECT b.entity_id as otherId, COUNT(*) as together
       FROM event_entity a
       CROSS JOIN event_entity b ON b.event_id = a.event_id
       WHERE ${coFilters.join(' AND ')}
       GROUP BY b.entity_id
       ORDER BY together DESC
       LIMIT ?`
    )
      .bind(...coParams, candidatePoolLimit)
      .all<{ otherId: string; together: number }>();
    coList = coRows.results ?? [];
  }

  const otherIds = coList.map((r) => r.otherId);
  const otherMetaMap = new Map<string, any>();
  const otherTotalMap = new Map<string, number>();

  for (const chunk of chunkArray(otherIds)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');

    try {
      const metaRows = await env.DB.prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType,
                is_hub as isHub, short_tagline_bn as shortTaglineBn, short_tagline_en as shortTaglineEn
         FROM entity WHERE id IN (${placeholders})`
      )
        .bind(...chunk)
        .all<any>();
      for (const m of metaRows.results ?? []) {
        otherMetaMap.set(m.id, { ...m, isHub: Boolean(m.isHub) });
      }
    } catch {
      const metaRows = await env.DB.prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
         FROM entity WHERE id IN (${placeholders})`
      )
        .bind(...chunk)
        .all<any>();
      for (const m of metaRows.results ?? []) {
        otherMetaMap.set(m.id, { ...m, isHub: false });
      }
    }

    const totRows = await env.DB.prepare(
      `SELECT entity_id as id, COUNT(DISTINCT event_id) as totalOther
       FROM event_entity
       WHERE entity_id IN (${placeholders}) ${dateAnd}
       GROUP BY entity_id`
    )
      .bind(...chunk, ...dateParams)
      .all<{ id: string; totalOther: number }>();
    for (const t of totRows.results ?? []) {
      otherTotalMap.set(t.id, Number(t.totalOther ?? 0));
    }
  }

  const neighbors = coList
    .map((c) => {
      const meta = otherMetaMap.get(c.otherId);
      if (!meta) return null;
      const totalOther = otherTotalMap.get(c.otherId) ?? 0;
      const score = associationScore(c.together, totalOther, nMe, nAll);
      return {
        ...meta,
        together: c.together,
        totalOther,
        score,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score || b.together - a.together)
    .slice(0, limit);

  const evFilters: string[] = ['ee.entity_id = ?'];
  const evParams: unknown[] = [entityId];
  if (fromDate) {
    evFilters.push('ee.event_end >= ?');
    evParams.push(fromDate);
  }
  if (toDate) {
    evFilters.push('ee.event_start <= ?');
    evParams.push(toDate);
  }

  const evRows = await env.DB.prepare(
    `SELECT ec.id, ec.label, ec.lead_snippet as leadSnippet,
            ec.first_seen as firstSeen, ec.last_seen as lastSeen,
            ec.article_count as articleCount, ec.outlet_count as outletCount,
            ec.outlets_json as outletsJson, ee.role, ee.salience
     FROM event_entity ee
     JOIN event_cluster ec ON ec.id = ee.event_id
     WHERE ${evFilters.join(' AND ')}
     ORDER BY ec.last_seen DESC
     LIMIT 20`
  )
    .bind(...evParams)
    .all<any>();

  const events = (evRows.results ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    leadSnippet: r.leadSnippet,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    articleCount: r.articleCount,
    outletCount: r.outletCount,
    outlets: JSON.parse(r.outletsJson || '[]'),
    role: r.role,
    salience: r.salience,
  }));

  const incidence: Array<{ eventId: string; entityId: string; role: string; salience: number }> = [];
  const eventIds = events.map((e) => e.id as string);
  const entityIds = [entityId, ...neighbors.map((n) => n.id as string)];
  if (eventIds.length > 0 && entityIds.length > 0) {
    for (const evChunk of chunkArray(eventIds, 40)) {
      for (const entChunk of chunkArray(entityIds, 40)) {
        const evPlaceholders = evChunk.map(() => '?').join(',');
        const entPlaceholders = entChunk.map(() => '?').join(',');
        const incRows = await env.DB.prepare(
          `SELECT event_id as eventId, entity_id as entityId, role, salience
           FROM event_entity
           WHERE event_id IN (${evPlaceholders}) AND entity_id IN (${entPlaceholders})`
        )
          .bind(...evChunk, ...entChunk)
          .all<{ eventId: string; entityId: string; role: string; salience: number }>();
        incidence.push(...(incRows.results ?? []));
      }
    }
  }

  return json({
    centerEntity: centerRow,
    ...(redirectedFrom ? { redirectedFrom } : {}),
    nMe,
    nAll,
    neighbors,
    events,
    incidence,
  });
}

async function handleEntityActivity(rawEntityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const { id: entityId } = await resolveCanonicalEntityId(env.DB, rawEntityId);
  const exists = await env.DB.prepare('SELECT id FROM entity WHERE id = ?')
    .bind(entityId)
    .first<{ id: string }>();
  if (!exists) {
    return json({ error: 'Entity not found' }, 404);
  }

  const fromDate = url.searchParams.get('from') ?? undefined;
  const toDateRaw = url.searchParams.get('to') ?? undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;

  const filters: string[] = ['entity_id = ?'];
  const params: unknown[] = [entityId];
  if (fromDate) {
    filters.push('event_end >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    filters.push('event_start <= ?');
    params.push(toDate);
  }

  const rows = await env.DB.prepare(
    `SELECT
       substr(event_start, 1, 10) as date,
       COUNT(DISTINCT event_id) as eventCount,
       SUM(article_count) as articleCount,
       MAX(outlet_count) as outletCount
     FROM event_entity
     WHERE ${filters.join(' AND ')}
     GROUP BY substr(event_start, 1, 10)
     ORDER BY date ASC`
  )
    .bind(...params)
    .all<{ date: string; eventCount: number; articleCount: number; outletCount: number }>();

  return json({ entityId, series: rows.results ?? [] });
}

async function handleListEvents(url: URL, env: ApiEnv): Promise<Response> {
  const entityIds = url.searchParams
    .getAll('entity')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, D1_MAX_PARAMS);
  const fromDate = url.searchParams.get('from') ?? undefined;
  const toDateRaw = url.searchParams.get('to') ?? undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 100);

  const filters: string[] = [];
  const params: unknown[] = [];

  if (fromDate) {
    filters.push('ec.last_seen >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    filters.push('ec.first_seen <= ?');
    params.push(toDate);
  }

  let sql: string;
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => '?').join(', ');
    filters.push(`ee.entity_id IN (${placeholders})`);
    const allParams = [...params, ...entityIds, entityIds.length, limit];
    const whereClause = `WHERE ${filters.join(' AND ')}`;
    sql = `
      SELECT ec.id, ec.label, ec.lead_snippet as leadSnippet,
             ec.first_seen as firstSeen, ec.last_seen as lastSeen,
             ec.article_count as articleCount, ec.outlet_count as outletCount,
             ec.outlets_json as outletsJson
      FROM event_cluster ec
      JOIN event_entity ee ON ee.event_id = ec.id
      ${whereClause}
      GROUP BY ec.id
      HAVING COUNT(DISTINCT ee.entity_id) = ?
      ORDER BY ec.last_seen DESC, ec.outlet_count DESC
      LIMIT ?
    `;
    const rows = await env.DB.prepare(sql).bind(...allParams).all<any>();
    const events = (rows.results ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      leadSnippet: r.leadSnippet,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      articleCount: r.articleCount,
      outletCount: r.outletCount,
      outlets: JSON.parse(r.outletsJson || '[]'),
    }));
    return json({ events });
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  sql = `
    SELECT ec.id, ec.label, ec.lead_snippet as leadSnippet,
           ec.first_seen as firstSeen, ec.last_seen as lastSeen,
           ec.article_count as articleCount, ec.outlet_count as outletCount,
           ec.outlets_json as outletsJson
    FROM event_cluster ec
    ${whereClause}
    ORDER BY ec.last_seen DESC, ec.outlet_count DESC
    LIMIT ?
  `;
  const rows = await env.DB.prepare(sql).bind(...params, limit).all<any>();
  const events = (rows.results ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    leadSnippet: r.leadSnippet,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    articleCount: r.articleCount,
    outletCount: r.outletCount,
    outlets: JSON.parse(r.outletsJson || '[]'),
  }));
  return json({ events });
}

async function handleEventGraph(rawEventId: string, url: URL, env: ApiEnv): Promise<Response> {
  const includeHubs = url.searchParams.get('includeHubs') === 'true';

  const redirect = await env.DB.prepare(
    'SELECT new_id as newId FROM event_redirect WHERE old_id = ?'
  )
    .bind(rawEventId)
    .first<{ newId: string }>();
  const eventId = redirect?.newId ?? rawEventId;

  const eventRow = await env.DB.prepare(
    `SELECT id, label, lead_snippet as leadSnippet,
            first_seen as firstSeen, last_seen as lastSeen,
            article_count as articleCount, outlet_count as outletCount,
            outlets_json as outletsJson
     FROM event_cluster WHERE id = ?`
  )
    .bind(eventId)
    .first<any>();

  if (!eventRow) {
    return json({ error: 'Event not found' }, 404);
  }

  const event = {
    id: eventRow.id,
    label: eventRow.label,
    leadSnippet: eventRow.leadSnippet,
    firstSeen: eventRow.firstSeen,
    lastSeen: eventRow.lastSeen,
    articleCount: eventRow.articleCount,
    outletCount: eventRow.outletCount,
    outlets: JSON.parse(eventRow.outletsJson || '[]'),
    ...(redirect ? { redirectedFrom: rawEventId } : {}),
  };

  let rawNodes: any[] = [];
  try {
    const nodeRows = await env.DB.prepare(
      `SELECT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn,
              e.entity_type as entityType, e.is_hub as isHub,
              e.short_tagline_bn as shortTaglineBn, e.short_tagline_en as shortTaglineEn,
              ee.role, ee.article_count as articleCount,
              ee.outlet_count as outletCount, ee.salience
       FROM event_entity ee
       JOIN entity e ON e.id = ee.entity_id
       WHERE ee.event_id = ? AND e.status = 'active'
       ORDER BY ee.salience DESC, ee.article_count DESC`
    )
      .bind(eventId)
      .all<any>();
    rawNodes = (nodeRows.results ?? []).map((n) => ({ ...n, isHub: Boolean(n.isHub) }));
  } catch {
    const nodeRows = await env.DB.prepare(
      `SELECT e.id, e.canonical_bn as canonicalBn, e.canonical_en as canonicalEn,
              e.entity_type as entityType, ee.role, ee.article_count as articleCount,
              ee.outlet_count as outletCount, ee.salience
       FROM event_entity ee
       JOIN entity e ON e.id = ee.entity_id
       WHERE ee.event_id = ?
       ORDER BY ee.salience DESC, ee.article_count DESC`
    )
      .bind(eventId)
      .all<any>();
    rawNodes = (nodeRows.results ?? []).map((n) => ({ ...n, isHub: false }));
  }

  const articleRows = await env.DB.prepare(
    `SELECT a.id, a.title, a.published_at as publishedAt, a.canonical_url as canonicalUrl, a.outlet
     FROM article_cluster ac
     JOIN article a ON a.id = ac.article_id
     WHERE ac.cluster_id = ?
     ORDER BY a.published_at DESC`
  )
    .bind(eventId)
    .all<any>();

  const rawArticles = articleRows.results ?? [];
  const articleIds = rawArticles.map((a: any) => a.id as string);
  const articleEntityMap = new Map<string, string[]>();
  for (const chunk of chunkArray(articleIds, 80)) {
    const placeholders = chunk.map(() => '?').join(',');
    const aeRows = await env.DB.prepare(
      `SELECT article_id as articleId, entity_id as entityId
       FROM article_entity
       WHERE article_id IN (${placeholders})`
    )
      .bind(...chunk)
      .all<{ articleId: string; entityId: string }>();
    for (const row of aeRows.results ?? []) {
      const list = articleEntityMap.get(row.articleId) ?? [];
      list.push(row.entityId);
      articleEntityMap.set(row.articleId, list);
    }
  }
  const articles = rawArticles.map((a: any) => ({
    ...a,
    entityIds: articleEntityMap.get(a.id) ?? [],
  }));

  const edgeMap = new Map<
    string,
    {
      source: string;
      target: string;
      relationType: string;
      predicateLabels: Set<string>;
      weight: number;
      evidence: Array<{
        articleId: string;
        title: string;
        publishedAt: string | null;
        canonicalUrl: string;
        outlet: string;
        evidenceSnippet: string;
        predicateLabel: string | null;
        confidence: number;
      }>;
    }
  >();

  const edgeParticipantIds = new Set<string>();

  for (const chunk of chunkArray(articleIds)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    let relRows: any[] = [];
    try {
      const res = await env.DB.prepare(
        `SELECT r.source_entity_id as source,
                r.target_entity_id as target,
                r.relation_type as relationType,
                r.predicate_label as predicateLabel,
                r.evidence_snippet as evidenceSnippet,
                r.confidence,
                a.id as articleId,
                a.title,
                a.published_at as publishedAt,
                a.canonical_url as canonicalUrl,
                a.outlet
         FROM entity_relation r
         JOIN article a ON a.id = r.article_id
         WHERE r.article_id IN (${placeholders})`
      )
        .bind(...chunk)
        .all<any>();
      relRows = res.results ?? [];
    } catch {
      const res = await env.DB.prepare(
        `SELECT r.source_entity_id as source,
                r.target_entity_id as target,
                r.relation_type as relationType,
                r.evidence_snippet as evidenceSnippet,
                r.confidence,
                a.id as articleId,
                a.title,
                a.published_at as publishedAt,
                a.canonical_url as canonicalUrl,
                a.outlet
         FROM entity_relation r
         JOIN article a ON a.id = r.article_id
         WHERE r.article_id IN (${placeholders})`
      )
        .bind(...chunk)
        .all<any>();
      relRows = res.results ?? [];
    }

    for (const r of relRows) {
      const normRel = normalizeRelationType(r.relationType);
      if (!normRel) continue;
      edgeParticipantIds.add(r.source);
      edgeParticipantIds.add(r.target);
      const key = `${r.source}::${r.target}::${normRel}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = {
          source: r.source,
          target: r.target,
          relationType: normRel,
          predicateLabels: new Set<string>(),
          weight: 0,
          evidence: [],
        };
        edgeMap.set(key, edge);
      }
      if (r.predicateLabel) edge.predicateLabels.add(String(r.predicateLabel));
      edge.weight += 1;
      edge.evidence.push({
        articleId: r.articleId,
        title: r.title,
        publishedAt: r.publishedAt ?? null,
        canonicalUrl: r.canonicalUrl,
        outlet: r.outlet,
        evidenceSnippet: r.evidenceSnippet,
        predicateLabel: r.predicateLabel ?? null,
        confidence: r.confidence,
      });
    }
  }

  // Keep non-hub nodes + any hub that actually participates in an explicit relationship edge
  const nodes = includeHubs
    ? rawNodes
    : rawNodes.filter((n) => !n.isHub || edgeParticipantIds.has(n.id));

  return json({
    event,
    nodes,
    edges: Array.from(edgeMap.values()).map((e) => ({
      source: e.source,
      target: e.target,
      relationType: e.relationType,
      predicateLabels: Array.from(e.predicateLabels).slice(0, 5),
      weight: e.weight,
      evidence: e.evidence,
    })),
    articles,
  });
}

function parseProviderPreference(raw: string | null | undefined): VlmProviderPreference {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'gemini' || v === 'workers-ai' || v === 'auto') return v;
  return 'auto';
}

async function handleVerify(request: Request, env: ApiEnv): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  let pipelineInput: VerificationPipelineInput;
  let providerOverride: string | undefined;
  let bypassCache = false;

  if (contentType.includes('multipart/form-data')) {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_IMAGE_BYTES + 256 * 1024) {
      return json({ error: `Upload exceeds maximum size of ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` }, 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Invalid multipart/form-data payload' }, 400);
    }

    const rawProvider = form.get('provider');
    if (typeof rawProvider === 'string' && rawProvider.trim()) providerOverride = rawProvider.trim();
    const rawBypass = form.get('bypassCache');
    if (rawBypass === 'true' || rawBypass === '1') bypassCache = true;

    const imageField = form.get('image') ?? form.get('file');
    const textField = form.get('text');

    if (imageField && typeof imageField !== 'string') {
      const file = imageField as File;
      if (file.size > MAX_IMAGE_BYTES) {
        return json({ error: `Image exceeds maximum allowed size of ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` }, 413);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      pipelineInput = { type: 'image', bytes, bypassCache };
    } else if (typeof textField === 'string' && textField.trim()) {
      pipelineInput = { type: 'text', text: textField, bypassCache };
    } else {
      return json({ error: 'Provide either an `image` file or `text` field to verify' }, 400);
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid JSON request body' }, 400);
    }

    if (typeof body.provider === 'string' && body.provider.trim()) {
      providerOverride = body.provider.trim();
    }
    bypassCache = Boolean(body.bypassCache);

    if (typeof body.imageBase64 === 'string' && body.imageBase64.trim()) {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(body.imageBase64);
      } catch {
        return json({ error: 'Invalid base64 image payload' }, 400);
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return json({ error: `Image exceeds maximum allowed size of ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` }, 413);
      }
      pipelineInput = { type: 'image', bytes, bypassCache };
    } else if (typeof body.text === 'string' && body.text.trim()) {
      pipelineInput = { type: 'text', text: body.text, bypassCache };
    } else {
      return json({ error: 'Provide `text` or `imageBase64` (or multipart `image`) to verify' }, 400);
    }
  }

  const cached = await getCachedRegistry(env.DB);
  const preference = parseProviderPreference(providerOverride ?? env.VLM_PROVIDER);
  const createdProviders = createVerificationProviders({
    preference,
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      vertexProjectId: env.GCP_PROJECT_ID,
      vertexLocation: env.GCP_LOCATION ?? 'global',
      vertexAccessToken: env.GCP_ACCESS_TOKEN,
      getVertexAccessToken: env.GET_GCP_ACCESS_TOKEN,
      model: env.GEMINI_MODEL ?? (env.GCP_PROJECT_ID ? 'gemini-3.5-flash' : 'gemini-2.5-flash'),
    },
    workersAi: {
      aiBinding: env.AI ? { run: (m, i) => (env.AI as any).run(m, i) } : undefined,
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_API_TOKEN,
      visionModel: env.WORKERS_AI_VISION_MODEL,
      textModel: env.WORKERS_AI_TEXT_MODEL,
      rerankerModel: env.WORKERS_AI_RERANKER_MODEL,
    },
  });

  const imageStore: VerificationImageStore | undefined = env.CARDS_BUCKET
    ? {
        async put(key, bytes, mimeType) {
          await env.CARDS_BUCKET!.put(key, bytes, { httpMetadata: { contentType: mimeType } });
        },
      }
    : env.LOCAL_IMAGE_STORE
    ? {
        put: (key, bytes, mimeType) => env.LOCAL_IMAGE_STORE!.put(key, bytes, mimeType),
      }
    : undefined;

  const retriever: VerificationRetriever = {
    searchKeyword: (ftsQuery, limit) => runKeywordSearch(env.DB, ftsQuery, { limit }),
    searchSemantic: (queryText, limit) =>
      env.LOCAL_SEMANTIC_SEARCH
        ? env.LOCAL_SEMANTIC_SEARCH(queryText, limit)
        : runSemanticSearch(env, queryText, { limit }),
    async getArticleEntityMatches(articleIds, targetEntityIds) {
      const out = new Map<string, string[]>();
      if (articleIds.length === 0 || targetEntityIds.length === 0) return out;
      try {
        const aPh = articleIds.slice(0, 40).map(() => '?').join(',');
        const ePh = targetEntityIds.slice(0, 30).map(() => '?').join(',');
        const rows = await env.DB.prepare(
          `SELECT article_id as articleId, entity_id as entityId
           FROM article_entity
           WHERE article_id IN (${aPh}) AND entity_id IN (${ePh})`
        )
          .bind(...articleIds.slice(0, 40), ...targetEntityIds.slice(0, 30))
          .all<{ articleId: string; entityId: string }>();
        for (const r of rows.results ?? []) {
          const list = out.get(r.articleId) ?? [];
          if (!list.includes(r.entityId)) list.push(r.entityId);
          out.set(r.articleId, list);
        }
      } catch {
        // Non-fatal
      }
      return out;
    },
  };

  try {
    const check = await runVerificationPipeline(pipelineInput, {
      extractor: env.VERIFY_EXTRACTOR ?? createdProviders.extractor,
      reranker: env.VERIFY_RERANKER ?? createdProviders.reranker,
      diffJudge: env.VERIFY_DIFF_JUDGE ?? createdProviders.diffJudge,
      compiledRegistry: cached.compiled,
      expander: cached.expander,
      retriever,
      checkStore: new D1VerificationCheckStore(env.DB),
      claimStore: new D1ArticleClaimStore(env.DB),
      vlmCache: new SqlVlmCache(env.DB),
      imageStore,
    });
    return json(check, 200);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : 'Verification failed';
    const isUpstream = /gemini http|workers ai http|workers ai error/i.test(msg);
    const statusCode = isUpstream
      ? 502
      : /unsupported image|too small|cannot be empty|invalid/i.test(msg)
      ? 400
      : /exceeds maximum/i.test(msg)
      ? 413
      : 500;
    return json({ error: msg }, statusCode);
  }
}

async function handleGetCheck(checkId: string, env: ApiEnv): Promise<Response> {
  const store = new D1VerificationCheckStore(env.DB);
  const check = await store.getById(checkId);
  if (!check) return json({ error: 'Verification check not found' }, 404);
  return json(check);
}

async function handlePopularChecks(url: URL, env: ApiEnv): Promise<Response> {
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
  const rawStatus = url.searchParams.get('status')?.trim();
  const status =
    rawStatus === 'matched' || rawStatus === 'no_coverage' || rawStatus === 'non_claim'
      ? rawStatus
      : undefined;
  const store = new D1VerificationCheckStore(env.DB);
  const checks = await store.listPopular({ limit, status });
  return json({ checks });
}

async function handleGetCheckImage(checkId: string, env: ApiEnv): Promise<Response> {
  const store = new D1VerificationCheckStore(env.DB);
  const check = await store.getById(checkId);
  if (!check || !check.r2Key) {
    return json({ error: 'Check image not found' }, 404);
  }

  if (env.CARDS_BUCKET) {
    const obj = await env.CARDS_BUCKET.get(check.r2Key);
    if (!obj) return json({ error: 'Stored image object not found' }, 404);
    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { status: 200, headers });
  }

  if (env.LOCAL_IMAGE_STORE) {
    const item = await env.LOCAL_IMAGE_STORE.get(check.r2Key);
    if (!item) return json({ error: 'Stored image object not found' }, 404);
    return new Response(new Uint8Array(item.bytes), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': item.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  return json({ error: 'Image storage not configured' }, 404);
}

const INDEXED_ACCREDITED_OUTLETS: OutletId[] = [
  'prothom-alo',
  'daily-star',
  'business-standard',
  'bdnews24',
  'ittefaq',
  'jugantor',
  'kaler-kantho',
  'bangladesh-protidin',
];

async function handleEventComparison(rawEventId: string, env: ApiEnv): Promise<Response> {
  const redirect = await env.DB.prepare('SELECT new_id as newId FROM event_redirect WHERE old_id = ?')
    .bind(rawEventId)
    .first<{ newId: string }>()
    .catch(() => null);
  const eventId = redirect?.newId ?? rawEventId;

  const eventRow = await env.DB.prepare(
    `SELECT id, label, lead_snippet as leadSnippet,
            first_seen as firstSeen, last_seen as lastSeen,
            article_count as articleCount, outlet_count as outletCount,
            outlets_json as outletsJson
     FROM event_cluster WHERE id = ?`
  )
    .bind(eventId)
    .first<any>();

  if (!eventRow) {
    return json({ error: 'Event not found' }, 404);
  }

  const artRows = await env.DB.prepare(
    `SELECT a.id, a.outlet, a.title, a.lead, a.canonical_url as canonicalUrl, a.published_at as publishedAt
     FROM article_cluster ac
     JOIN article a ON a.id = ac.article_id
     WHERE ac.cluster_id = ?
     ORDER BY CASE WHEN a.published_at IS NULL THEN 1 ELSE 0 END, a.published_at ASC`
  )
    .bind(eventId)
    .all<{
      id: string;
      outlet: OutletId;
      title: string;
      lead: string | null;
      canonicalUrl: string;
      publishedAt: string | null;
    }>();

  // Sort chronologically by true UTC epoch ms (outlets mix +00:00 and +06:00 ISO offsets!)
  const articles = (artRows.results ?? []).slice().sort((a, b) => {
    const ma = a.publishedAt ? Date.parse(a.publishedAt) : Number.POSITIVE_INFINITY;
    const mb = b.publishedAt ? Date.parse(b.publishedAt) : Number.POSITIVE_INFINITY;
    const va = Number.isNaN(ma) ? Number.POSITIVE_INFINITY : ma;
    const vb = Number.isNaN(mb) ? Number.POSITIVE_INFINITY : mb;
    return va - vb;
  });
  const firstDated = articles.find((a) => a.publishedAt && !Number.isNaN(Date.parse(a.publishedAt))) ?? null;
  const firstMs = firstDated?.publishedAt ? Date.parse(firstDated.publishedAt) : null;

  const timeline = articles.map((a) => {
    const ms = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
    const lagMinutesFromFirst =
      firstMs !== null && !Number.isNaN(ms) ? Math.max(0, Math.round((ms - firstMs) / 60_000)) : null;
    return {
      articleId: a.id,
      outlet: a.outlet,
      title: a.title,
      publishedAt: a.publishedAt ?? null,
      lagMinutesFromFirst,
      canonicalUrl: a.canonicalUrl,
    };
  });

  const claimStore = new D1ArticleClaimStore(env.DB);
  const claimsByArticle = await claimStore.getByArticleIds(articles.map((a) => a.id));

  let totalClaimsAnalyzed = 0;
  for (const list of claimsByArticle.values()) totalClaimsAnalyzed += list.length;

  const articlesByOutlet = new Map<OutletId, typeof articles>();
  for (const a of articles) {
    const list = articlesByOutlet.get(a.outlet) ?? [];
    list.push(a);
    articlesByOutlet.set(a.outlet, list);
  }

  const outletCoverage: EventOutletCoverageItem[] = INDEXED_ACCREDITED_OUTLETS.map((outlet) => {
    const list = articlesByOutlet.get(outlet) ?? [];
    const lead = list[0] ?? null;
    const firstPub = lead?.publishedAt ?? null;
    const ms = firstPub ? Date.parse(firstPub) : NaN;
    const lag =
      firstMs !== null && !Number.isNaN(ms) ? Math.max(0, Math.round((ms - firstMs) / 60_000)) : null;
    const claims = list.flatMap((a) => claimsByArticle.get(a.id) ?? []);
    return {
      outlet,
      covered: list.length > 0,
      articleCount: list.length,
      firstPublishedAt: firstPub,
      lagMinutesFromFirst: lag,
      leadArticle: lead
        ? {
            id: lead.id,
            title: lead.title,
            canonicalUrl: lead.canonicalUrl,
            publishedAt: lead.publishedAt,
            lead: lead.lead ?? null,
          }
        : null,
      claims,
    };
  });

  const crossOutletDifferences = analyzeCrossOutletDifferences(
    outletCoverage
      .filter((o) => o.covered && o.leadArticle)
      .map((o) => ({
        outlet: o.outlet,
        articleId: o.leadArticle!.id,
        title: o.leadArticle!.title,
        claims: o.claims,
      }))
  );

  const payload: EventComparisonResponse = {
    event: {
      id: eventRow.id,
      label: eventRow.label,
      leadSnippet: eventRow.leadSnippet ?? null,
      firstSeen: eventRow.firstSeen ?? null,
      lastSeen: eventRow.lastSeen ?? null,
      articleCount: eventRow.articleCount,
      outletCount: eventRow.outletCount,
      outlets: JSON.parse(eventRow.outletsJson || '[]'),
      ...(redirect ? { redirectedFrom: rawEventId } : {}),
    },
    firstToPublish: firstDated
      ? {
          outlet: firstDated.outlet,
          articleId: firstDated.id,
          title: firstDated.title,
          publishedAt: firstDated.publishedAt!,
          canonicalUrl: firstDated.canonicalUrl,
        }
      : null,
    timeline,
    outletCoverage,
    crossOutletDifferences,
    totalClaimsAnalyzed,
  };

  return json(payload);
}

async function handleArticleClaims(articleId: string, env: ApiEnv): Promise<Response> {
  const art = await env.DB.prepare(
    'SELECT id, outlet, title, canonical_url as canonicalUrl, published_at as publishedAt FROM article WHERE id = ?'
  )
    .bind(articleId)
    .first<any>();
  if (!art) return json({ error: 'Article not found' }, 404);

  const claimStore = new D1ArticleClaimStore(env.DB);
  const claimsMap = await claimStore.getByArticleIds([articleId]);
  return json({
    article: art,
    claims: claimsMap.get(articleId) ?? [],
  });
}

export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/verify' && request.method === 'POST') {
    return handleVerify(request, env);
  }

  if (path === '/checks/popular' && request.method === 'GET') {
    return handlePopularChecks(url, env);
  }

  const checkImageMatch = path.match(/^\/checks\/([^/]+)\/image$/);
  if (checkImageMatch && request.method === 'GET') {
    return handleGetCheckImage(decodeURIComponent(checkImageMatch[1]!), env);
  }

  const checkMatch = path.match(/^\/checks\/([^/]+)$/);
  if (checkMatch && request.method === 'GET') {
    return handleGetCheck(decodeURIComponent(checkMatch[1]!), env);
  }

  if (path === '/health' && request.method === 'GET') {
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM article) as articles,
         (SELECT COUNT(*) FROM chunk) as chunks,
         (SELECT COUNT(*) FROM event_cluster) as clusters,
         (SELECT COUNT(*) FROM article_similarity_edge) as edges,
         (SELECT COUNT(*) FROM entity) as entities,
         (SELECT COUNT(*) FROM entity_relation) as entityRelations`
    ).first<any>();
    return json({ ok: true, counts });
  }

  if (path === '/registry/snapshot' && request.method === 'GET') {
    return handleRegistrySnapshot(request, env);
  }

  if (path === '/resolve' && request.method === 'POST') {
    return handleAdHocResolve(request, env);
  }

  if (path === '/search' && (request.method === 'GET' || request.method === 'POST')) {
    return handleSearch(request, env);
  }

  if (path === '/clusters' && request.method === 'GET') {
    return handleListClusters(url, env);
  }

  const clusterGraphMatch = path.match(/^\/clusters\/([^/]+)\/graph$/);
  if (clusterGraphMatch && request.method === 'GET') {
    return handleClusterGraph(decodeURIComponent(clusterGraphMatch[1]!), env);
  }

  const clusterEntitiesMatch = path.match(/^\/clusters\/([^/]+)\/entities$/);
  if (clusterEntitiesMatch && request.method === 'GET') {
    return handleClusterEntities(decodeURIComponent(clusterEntitiesMatch[1]!), env);
  }

  if (path === '/entities/suggest' && request.method === 'GET') {
    return handleSuggestEntities(url, env);
  }

  if (path === '/entities' && request.method === 'GET') {
    return handleListEntities(url, env);
  }

  const entityArticlesMatch = path.match(/^\/entities\/([^/]+)\/articles$/);
  if (entityArticlesMatch && request.method === 'GET') {
    return handleEntityArticles(decodeURIComponent(entityArticlesMatch[1]!), url, env);
  }

  const entityRelationsMatch = path.match(/^\/entities\/([^/]+)\/relations$/);
  if (entityRelationsMatch && request.method === 'GET') {
    return handleEntityRelations(decodeURIComponent(entityRelationsMatch[1]!), url, env);
  }

  const entityEgoMatch = path.match(/^\/entities\/([^/]+)\/ego$/);
  if (entityEgoMatch && request.method === 'GET') {
    return handleEntityEgo(decodeURIComponent(entityEgoMatch[1]!), url, env);
  }

  const entityActivityMatch = path.match(/^\/entities\/([^/]+)\/activity$/);
  if (entityActivityMatch && request.method === 'GET') {
    return handleEntityActivity(decodeURIComponent(entityActivityMatch[1]!), url, env);
  }

  const entityGraphMatch = path.match(/^\/entities\/([^/]+)\/graph$/);
  if (entityGraphMatch && request.method === 'GET') {
    return handleEntityGraph(decodeURIComponent(entityGraphMatch[1]!), env);
  }

  const entityProfileMatch = path.match(/^\/entities\/([^/]+)$/);
  if (entityProfileMatch && request.method === 'GET') {
    return handleEntityProfile(decodeURIComponent(entityProfileMatch[1]!), env);
  }

  if (path === '/events' && request.method === 'GET') {
    return handleListEvents(url, env);
  }

  const eventComparisonMatch = path.match(/^\/events\/([^/]+)\/comparison$/);
  if (eventComparisonMatch && request.method === 'GET') {
    return handleEventComparison(decodeURIComponent(eventComparisonMatch[1]!), env);
  }

  const eventGraphMatch = path.match(/^\/events\/([^/]+)\/graph$/);
  if (eventGraphMatch && request.method === 'GET') {
    return handleEventGraph(decodeURIComponent(eventGraphMatch[1]!), url, env);
  }

  const articleClaimsMatch = path.match(/^\/articles\/([^/]+)\/claims$/);
  if (articleClaimsMatch && request.method === 'GET') {
    return handleArticleClaims(decodeURIComponent(articleClaimsMatch[1]!), env);
  }

  const articleGraphMatch = path.match(/^\/articles\/([^/]+)\/graph$/);
  if (articleGraphMatch && request.method === 'GET') {
    return handleArticleGraph(decodeURIComponent(articleGraphMatch[1]!), env);
  }

  const articleMatch = path.match(/^\/articles\/([^/]+)$/);
  if (articleMatch && request.method === 'GET') {
    const id = decodeURIComponent(articleMatch[1]!);
    const row = await env.DB.prepare(
      `SELECT a.*, ac.cluster_id as clusterId
       FROM article a
       LEFT JOIN article_cluster ac ON ac.article_id = a.id
       WHERE a.id = ?`
    )
      .bind(id)
      .first<any>();
    if (!row) return json({ error: 'Article not found' }, 404);
    return json({ article: row });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    return handleApiRequest(request, env);
  },
};
