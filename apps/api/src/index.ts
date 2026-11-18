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
import {
  SearchRequestSchema,
  type ClusterGraphResponse,
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
  const expander = new AliasDictionaryExpander();
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
  };

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
         (SELECT COUNT(*) FROM article_similarity_edge) as edges`
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
