/**
 * @file apps/api/src/local-vector-search.ts
 * Local BGE-M3 semantic search adapter over `chunk_vector` in `data/index/index.sqlite`.
 *
 * Uses Cloudflare Workers AI REST (`@cf/baai/bge-m3`) or an optional local HTTP embedder
 * (`LOCAL_EMBED_URL`) to embed the verification query, then scores chunk vectors via
 * exact dot-product cosine similarity over a warm in-memory slice of recent + top-salience
 * chunk vectors so local `POST /verify` runs true hybrid FTS5 + BGE-M3 + RRF retrieval.
 */

import type { Database } from 'bun:sqlite';
import type { RankedChunkCandidate } from '@jachaikori/retrieval';
import type { OutletId } from '@jachaikori/schema';

export interface LocalSemanticConfig {
  cfAccountId?: string;
  cfApiToken?: string;
  localEmbedUrl?: string;
  /** Max chunks to keep warm in RAM (~25k chunks * 4KB = ~100 MB). */
  maxWarmChunks?: number;
}

function l2Normalize(vec: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) normSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(normSq);
  if (norm <= 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i]! / norm;
  return out;
}

function makeSnippet(text: string, maxLen = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
}

export class LocalSqliteVectorSearch {
  private loaded = false;
  private chunkIds: string[] = [];
  private dims = 0;
  private matrix: Float32Array = new Float32Array(0);

  constructor(
    private readonly db: Database,
    private readonly cfg: LocalSemanticConfig
  ) {}

  get isEnabled(): boolean {
    return Boolean(this.cfg.localEmbedUrl || (this.cfg.cfAccountId && this.cfg.cfApiToken));
  }

  private async embedQuery(text: string): Promise<Float32Array | null> {
    if (this.cfg.localEmbedUrl) {
      const res = await fetch(this.cfg.localEmbedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [text] }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: number[][]; embedding?: number[] };
      const arr = body.data?.[0] ?? body.embedding;
      return arr && arr.length > 0 ? l2Normalize(new Float32Array(arr)) : null;
    }

    if (this.cfg.cfAccountId && this.cfg.cfApiToken) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.cfg.cfAccountId)}/ai/run/@cf/baai/bge-m3`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.cfApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [text] }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: { data?: number[][] } };
      const arr = body.result?.data?.[0];
      return arr && arr.length > 0 ? l2Normalize(new Float32Array(arr)) : null;
    }

    return null;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const maxWarm = this.cfg.maxWarmChunks ?? 25_000;
    try {
      // Load headline/lead chunk (chunk_index = 0) of the most recent articles first
      const rows = this.db
        .prepare(
          `SELECT cv.chunk_id as chunkId, cv.vector, cv.dims
           FROM chunk_vector cv
           JOIN chunk c ON c.id = cv.chunk_id
           JOIN article a ON a.id = c.article_id
           WHERE c.chunk_index = 0
           ORDER BY a.published_at DESC
           LIMIT ?`
        )
        .all(maxWarm) as Array<{ chunkId: string; vector: Uint8Array; dims: number }>;

      if (rows.length === 0) return;
      this.dims = rows[0]!.dims;
      this.chunkIds = new Array(rows.length);
      this.matrix = new Float32Array(rows.length * this.dims);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        this.chunkIds[i] = r.chunkId;
        const view = new Float32Array(r.vector.buffer, r.vector.byteOffset, this.dims);
        this.matrix.set(view, i * this.dims);
      }
    } catch {
      this.chunkIds = [];
      this.dims = 0;
      this.matrix = new Float32Array(0);
    }
  }

  async search(queryText: string, limit: number): Promise<RankedChunkCandidate[]> {
    if (!this.isEnabled || !queryText.trim()) return [];
    const qVec = await this.embedQuery(queryText).catch(() => null);
    if (!qVec) return [];

    this.ensureLoaded();
    if (this.chunkIds.length === 0 || this.dims !== qVec.length) return [];

    // Maintain top-K via simple scan (~25k * 1024 = ~30 ms in Bun)
    const top: Array<{ idx: number; score: number }> = [];
    const n = this.chunkIds.length;
    const d = this.dims;
    let minScore = -Infinity;

    for (let i = 0; i < n; i++) {
      let dot = 0;
      const base = i * d;
      for (let j = 0; j < d; j++) {
        dot += this.matrix[base + j]! * qVec[j]!;
      }
      if (top.length < limit) {
        top.push({ idx: i, score: dot });
        if (top.length === limit) {
          top.sort((a, b) => b.score - a.score);
          minScore = top[top.length - 1]!.score;
        }
      } else if (dot > minScore) {
        top[top.length - 1] = { idx: i, score: dot };
        top.sort((a, b) => b.score - a.score);
        minScore = top[top.length - 1]!.score;
      }
    }
    top.sort((a, b) => b.score - a.score);

    const ids = top.map((t) => this.chunkIds[t.idx]!);
    if (ids.length === 0) return [];

    const ph = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT c.id as chunkId, c.article_id as articleId, c.outlet as outlet, c.text as text,
                a.title as title, a.canonical_url as canonicalUrl, a.published_at as publishedAt,
                ac.cluster_id as clusterId, ec.outlet_count as clusterOutletCount
         FROM chunk c
         JOIN article a ON a.id = c.article_id
         LEFT JOIN article_cluster ac ON ac.article_id = a.id
         LEFT JOIN event_cluster ec ON ec.id = ac.cluster_id
         WHERE c.id IN (${ph})`
      )
      .all(...ids) as Array<any>;

    const byId = new Map(rows.map((r) => [r.chunkId, r]));
    const out: RankedChunkCandidate[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      out.push({
        chunkId: r.chunkId,
        articleId: r.articleId,
        outlet: r.outlet as OutletId,
        title: r.title,
        canonicalUrl: r.canonicalUrl,
        publishedAt: r.publishedAt ?? null,
        snippet: makeSnippet(r.text),
        clusterId: r.clusterId ?? null,
        clusterOutletCount: r.clusterOutletCount ?? null,
      });
    }
    return out;
  }
}
