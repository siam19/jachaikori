# Sprint 3: Hybrid Retrieval, GCP Batch Embeddings, Event Clustering & Visualizer — Implementation Log

This log tracks Sprint 3 implementation, Bangla FTS5 tokenization fixes, chunking/embedding backfill tooling, cross-outlet clustering, `apps/api`, and `apps/web`.

---

## 2026-11-17: Sprint Initialization & Bangla FTS5 Discovery

| Item | Finding / Action |
| :--- | :--- |
| Corpus Snapshot | **41,841 / 42,053** active articles extracted (`99.5%`), totaling **99,579,214 chars** (`~2,380` avg chars/article). |
| Bangla FTS5 Bug | Verified on `bun:sqlite`: default `unicode61` treats Bangla vowel signs (`া ি ী ু ূ ৃ ে ৈ ো ৌ`), *hasanta* (`্`), `ং`, `ঃ`, `ঁ`, and `়` as separators—breaking `"বাংলাদেশ"` into `["ব", "ল", "দ", "শ"]` and `"কক্সবাজার"` into `["কক", "সব", "জ", "র"]`. |
| Bangla FTS5 Fix | Verified `tokenize="unicode61 remove_diacritics 0 tokenchars 'ঁংঃ়ািীুূৃৄেৈোৌ্ৗৢৣ'"` + `NFC` + ZWJ/ZWNJ stripping + quoted `MATCH` terms yields 100% word integrity and 0 false positives. |
| Sprint Docs | Created [goals.md](file:///home/bast0k/projects/jachaikori/docs/sprints/3.Chunking%20&%20embeddings/goals.md) and `log.md`. |

---

## 2026-11-18: Retrieval Package, Backfill Pipeline, Hybrid API & Cluster Visualizer

| Package / App | Files Created / Modified | Summary |
| :--- | :--- | :--- |
| `packages/schema` | [chunk.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/chunk.ts), [entity.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/entity.ts), [cluster.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/cluster.ts), [search.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/search.ts), [index.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/index.ts) | Added chunk, temporal entity/alias, event cluster/graph, and search request/response Zod schemas. |
| `packages/retrieval` | [bangla.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/bangla.ts), [chunker.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/chunker.ts), [rrf.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/rrf.ts), [query-expander.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/query-expander.ts), [clustering.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/clustering.ts) | Pure runtime-agnostic Bangla FTS5 normalization, paragraph-aware chunking, RRF (`k=60`) with article rollup, temporal `AliasDictionaryExpander`, and `±4 day` centroid-guarded similarity clustering. |
| `tools/backfill` | [db.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/db.ts), [cli.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/cli.ts), [embed_bge_m3.py](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/embed_bge_m3.py), [Dockerfile](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/Dockerfile), [run-gcp-embed.sh](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/run-gcp-embed.sh) | Built local `index.sqlite` store, `verify-fts`, `chunk`, `import-vectors`, `cluster`, `export-vectorize`, and GCP Cloud Run `nvidia-l4` `BAAI/bge-m3` batch embedder. |
| `apps/api` | [0001_initial.sql](file:///home/bast0k/projects/jachaikori/apps/api/migrations/0001_initial.sql), [wrangler.jsonc](file:///home/bast0k/projects/jachaikori/apps/api/wrangler.jsonc), [index.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/index.ts), [local-dev.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/local-dev.ts) | Built Cloudflare Worker for `/health`, `/search`, `/clusters`, `/clusters/:id/graph`, `/articles/:id/graph` + local Bun SQLite adapter. |
| `apps/web` | [App.tsx](file:///home/bast0k/projects/jachaikori/apps/web/src/App.tsx), [ForceGraph.tsx](file:///home/bast0k/projects/jachaikori/apps/web/src/components/ForceGraph.tsx), [styles.css](file:///home/bast0k/projects/jachaikori/apps/web/src/styles.css) | Built interactive React + Vite Cluster Explorer with `d3-force` Canvas graph, similarity threshold slider, Event Cluster Feed, Hybrid Search, and EN/বাংলা toggle. |

### Verification Results:
- `bun run backfill verify-fts`: **200/200** title recall (`0 missed`).
- `bun run backfill chunk`: **41,841 articles** → **92,073 chunks** indexed in `data/index/index.sqlite` & exported to `data/index/chunks.jsonl` (`108.6s`).
- `bun test`: **42 pass, 0 fail** (190 assertions across 8 files).
- `bun run typecheck`: **0 errors**.
- `bun --filter @jachaikori/web build`: built cleanly.
- **GCP GPU `BAAI/bge-m3` Batch Embedding (`nvidia-l4`):** Embedded all **92,073 chunks**, imported `vectors.f32.bin` + weighted article centroids for **41,841 articles** into `data/index/index.sqlite`.
- **Event Clustering (`bun run backfill cluster`):** Built **60,330** `±4d` similarity edges and **6,305** centroid-guarded event clusters (with Clack live progress bars & ETA).
- **Local Cluster Visualizer (`bun run dev`):** Verified `apps/api` (`127.0.0.1:8787`) + `apps/web` (`localhost:5173`) serving live clusters and interactive scroll-to-zoom / drag-to-pan / node-drag similarity graphs.
