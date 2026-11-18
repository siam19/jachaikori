/**
 * @file apps/api/src/index.ts
 * Cloudflare Worker API for Jachaikori:
 * - Hybrid Search (D1 Bangla FTS5 + Vectorize BGE-M3 + RRF k=60 + QueryExpander hook)
 * - Cross-Outlet Event Clusters & Similarity Graph endpoints for the Cluster Visualizer
 */

import {
  buildFtsMatchQuery,
  reciprocalRankFuse,
  AliasDictionaryExpander,
  type RankedChunkCandidate,
} from '@jachaikori/retrieval';
import { associationScore } from '@jachaikori/entities';
import {
  SearchRequestSchema,
  type ClusterGraphResponse,
  type EntityAlias,
  type EntityGraphEdge,
  type EntityGraphNode,
  type EntityGraphResponse,
  type EntityHyperedge,
  type EntityRelationEvidence,
  type EntityRelationType,
  type EntityRole,
  type EntitySummary,
  type EntityType,
  type EventCluster,
  type GraphEdge,
  type GraphNode,
  type OutletId,
} from '@jachaikori/schema';

export interface ApiEnv {
  DB: D1Database;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function makeSnippet(text: string, maxLen = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
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

  const whereExtra = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  params.push(opts.limit);

  const sql = `
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
    FROM chunk_fts f
    JOIN chunk c ON c.rowid = f.rowid
    JOIN article a ON a.id = c.article_id
    LEFT JOIN article_cluster ac ON ac.article_id = a.id
    LEFT JOIN event_cluster ec ON ec.id = ac.cluster_id
    WHERE chunk_fts MATCH ?
    ${whereExtra}
    ORDER BY bm25(chunk_fts) ASC
    LIMIT ?
  `;

  const res = await db.prepare(sql).bind(...params).all<any>();
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
  let aliases: EntityAlias[] = [];
  try {
    const aliasRes = await env.DB.prepare(
      `SELECT alias_norm as aliasNorm, alias_raw as aliasRaw, entity_id as entityId,
              valid_from as validFrom, valid_to as validTo
       FROM entity_alias`
    ).all<EntityAlias>();
    aliases = aliasRes.results ?? [];
  } catch {
    aliases = [];
  }

  const expander = new AliasDictionaryExpander(aliases);
  const expansion = expander.expand(params.query, params.toDate);

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
    mode: params.mode,
    fusionK,
    latencyMs: Date.now() - startedAt,
    hits,
  });
}

async function handleListClusters(url: URL, env: ApiEnv): Promise<Response> {
  const minOutlets = Math.max(1, Number(url.searchParams.get('minOutlets') ?? 2));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const q = url.searchParams.get('q')?.trim() ?? '';
  const outlet = url.searchParams.get('outlet')?.trim() ?? '';
  const sort = url.searchParams.get('sort') === 'recent' ? 'last_seen DESC, outlet_count DESC' : 'outlet_count DESC, last_seen DESC';

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
  } else if (opts.articleIds && opts.articleIds.length > 0) {
    const placeholders = opts.articleIds.map(() => '?').join(',');
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

  // Aggregate pairwise relations by (source, target, relationType)
  const edgeAgg = new Map<
    string,
    {
      source: string;
      target: string;
      relationType: EntityRelationType;
      weight: number;
      evidence: EntityRelationEvidence[];
      articleIds: Set<string>;
    }
  >();

  const neighborScores = new Map<string, number>();
  const relevantArticleIds = new Set<string>(opts.articleIds ?? []);

  for (const r of relRows) {
    relevantArticleIds.add(r.articleId);
    const key = `${r.sourceId}|${r.targetId}|${r.relationType}`;
    let agg = edgeAgg.get(key);
    if (!agg) {
      agg = {
        source: r.sourceId,
        target: r.targetId,
        relationType: r.relationType as EntityRelationType,
        weight: 0,
        evidence: [],
        articleIds: new Set<string>(),
      };
      edgeAgg.set(key, agg);
    }
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
          relationType: r.relationType as EntityRelationType,
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

  // Cap ego graph to top 24 neighbors so ForceGraph remains legible
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
      weight: agg.weight,
      evidence: agg.evidence,
    });
  }

  // Also include entities mentioned in scoped cluster articles (even single-entity articles)
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
    const entityRows = await db
      .prepare(
        `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
         FROM entity
         WHERE id IN (${ph})`
      )
      .bind(...allNodeIds)
      .all<any>();

    for (const er of entityRows.results ?? []) {
      const stat = mentionMapByEntity.get(er.id);
      nodes.push({
        id: er.id,
        canonicalBn: er.canonicalBn ?? null,
        canonicalEn: er.canonicalEn ?? null,
        entityType: er.entityType as EntityType,
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
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

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

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

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
     LIMIT ?`
  )
    .bind(...params)
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

async function handleEntityGraph(entityId: string, env: ApiEnv): Promise<Response> {
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

async function handleEntityEgo(entityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const centerRow = await env.DB.prepare(
    `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
     FROM entity WHERE id = ?`
  )
    .bind(entityId)
    .first<any>();

  if (!centerRow) {
    return json({ error: 'Entity not found' }, 404);
  }

  const fromDate = url.searchParams.get('from') ?? undefined;
  const toDateRaw = url.searchParams.get('to') ?? undefined;
  const toDate = toDateRaw ? toDateUpperBound(toDateRaw) : undefined;
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
    return json({ centerEntity: centerRow, nMe: 0, nAll: 0, neighbors: [], events: [] });
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

  const coRows = await env.DB.prepare(
    `SELECT b.entity_id as otherId, COUNT(DISTINCT a.event_id) as together
     FROM event_entity a
     JOIN event_entity b ON b.event_id = a.event_id
     WHERE ${coFilters.join(' AND ')}
     GROUP BY b.entity_id
     ORDER BY together DESC
     LIMIT ?`
  )
    .bind(...coParams, limit)
    .all<{ otherId: string; together: number }>();

  const coList = coRows.results ?? [];
  const otherIds = coList.map((r) => r.otherId);

  const otherMetaMap = new Map<string, any>();
  const otherTotalMap = new Map<string, number>();

  for (const chunk of chunkArray(otherIds)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');

    const metaRows = await env.DB.prepare(
      `SELECT id, canonical_bn as canonicalBn, canonical_en as canonicalEn, entity_type as entityType
       FROM entity WHERE id IN (${placeholders})`
    )
      .bind(...chunk)
      .all<any>();
    for (const m of metaRows.results ?? []) {
      otherMetaMap.set(m.id, m);
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
    .sort((a, b) => b.score - a.score || b.together - a.together);

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

  return json({ centerEntity: centerRow, nMe, nAll, neighbors, events, incidence });
}

async function handleEntityActivity(entityId: string, url: URL, env: ApiEnv): Promise<Response> {
  const exists = await env.DB.prepare(`SELECT id FROM entity WHERE id = ?`)
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
    // Reorder: entityIds are in WHERE, then HAVING COUNT = ?
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

async function handleEventGraph(rawEventId: string, env: ApiEnv): Promise<Response> {
  const redirect = await env.DB.prepare(
    `SELECT new_id as newId FROM event_redirect WHERE old_id = ?`
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
      weight: number;
      evidence: Array<{
        articleId: string;
        title: string;
        publishedAt: string | null;
        canonicalUrl: string;
        outlet: string;
        evidenceSnippet: string;
        confidence: number;
      }>;
    }
  >();

  for (const chunk of chunkArray(articleIds)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    const relRows = await env.DB.prepare(
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

    for (const r of relRows.results ?? []) {
      const key = `${r.source}::${r.target}::${r.relationType}`;
      let edge = edgeMap.get(key);
      if (!edge) {
        edge = {
          source: r.source,
          target: r.target,
          relationType: r.relationType,
          weight: 0,
          evidence: [],
        };
        edgeMap.set(key, edge);
      }
      edge.weight += 1;
      edge.evidence.push({
        articleId: r.articleId,
        title: r.title,
        publishedAt: r.publishedAt ?? null,
        canonicalUrl: r.canonicalUrl,
        outlet: r.outlet,
        evidenceSnippet: r.evidenceSnippet,
        confidence: r.confidence,
      });
    }
  }

  return json({
    event,
    nodes: nodeRows.results ?? [],
    edges: Array.from(edgeMap.values()),
    articles,
  });
}

export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

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

  if (path === '/events' && request.method === 'GET') {
    return handleListEvents(url, env);
  }

  const eventGraphMatch = path.match(/^\/events\/([^/]+)\/graph$/);
  if (eventGraphMatch && request.method === 'GET') {
    return handleEventGraph(decodeURIComponent(eventGraphMatch[1]!), env);
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
