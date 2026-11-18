# Sprint 3: Hybrid Retrieval, GCP Batch Embeddings, Event Clustering & Visualizer — Goals

**Sprint Focus:** Build the search, chunking, embedding, cross-outlet clustering, and exploration layer on top of the **41,841** scraped articles in [catalog.sqlite](file:///home/bast0k/projects/jachaikori/data/catalog.sqlite), with forward-compatible Entity Resolution foundations.

---

## 1. Objectives

### A. Bangla FTS5 Tokenization Fix & Verification
- [x] Configure SQLite/D1 FTS5 `unicode61` with explicit Bangla combining marks (`tokenchars 'ঁংঃ়ািীুূৃৄেৈোৌ্ৗৢৣ'` and `remove_diacritics 0`) so Bangla words are never split at vowel signs (*matras*) or *hasanta*.
- [x] Implement shared `normalizeBanglaForFts()` (`NFC` + strip ZWJ/ZWNJ) and `buildFtsMatchQuery()` in [bangla.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/bangla.ts).
- [x] Verify Bangla keyword precision and recall against real articles in `data/catalog.sqlite` via `bun run backfill verify-fts` (`200/200` title recall) and unit tests.

### B. Chunking, Local Vector Store & GCP BGE-M3 Batch Pipeline (`tools/backfill`)
- [x] Define `ArticleChunkSchema`, `EntitySchema`, `EntityAliasSchema`, `EventClusterSchema`, and `SearchRequestSchema` / `SearchResponseSchema` in `packages/schema`.
- [x] Implement paragraph-aware chunker (`maxChars: 1600`, `overlapChars: 200`, headline prepended on chunk `0`) in [chunker.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/chunker.ts).
- [x] Build [cli.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/cli.ts) (`data/index/index.sqlite`) with resumable commands: `verify-fts`, `chunk`, `import-vectors`, `cluster`, and `export-vectorize`. Executed `chunk` across all **41,841** articles (**92,073 chunks**).
- [x] Create GCP GPU batch embedding job ([embed_bge_m3.py](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/embed_bge_m3.py), [Dockerfile](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/Dockerfile), [run-gcp-embed.sh](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/run-gcp-embed.sh)) using `BAAI/bge-m3` (`fp16`) to leverage free GCP credits.

### C. Cross-Outlet Event Clustering & Entity Resolution Foundations
- [x] Implement `Float32Array` article centroid pooling, `±4 day` temporal similarity edge builder (`cosine >= 0.78`), and centroid-guarded event clustering (`cosine >= 0.80`) in [clustering.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/clustering.ts).
- [x] Include `entity`, time-bounded `entity_alias`, and `article_entity` tables in D1 schema ([0001_initial.sql](file:///home/bast0k/projects/jachaikori/apps/api/migrations/0001_initial.sql)) plus a `QueryExpander` hook in [query-expander.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/query-expander.ts) for Phase 3 Entity Resolution.

### D. Hybrid Search & Cluster Graph API (`apps/api`)
- [x] Create Cloudflare Worker ([index.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/index.ts)) with D1 FTS5 + Vectorize `@cf/baai/bge-m3` + Reciprocal Rank Fusion (`k = 60`).
- [x] Expose `/health`, `/search`, `/clusters`, `/clusters/:id/graph`, `/articles/:id/graph`, and `/articles/:id`, plus a local Bun dev server ([local-dev.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/local-dev.ts)) backed by `data/index/index.sqlite`.

### E. Interactive Cluster Visualizer (`apps/web`)
- [x] Build React + TypeScript + Vite web app ([App.tsx](file:///home/bast0k/projects/jachaikori/apps/web/src/App.tsx), [ForceGraph.tsx](file:///home/bast0k/projects/jachaikori/apps/web/src/components/ForceGraph.tsx)) with Hybrid Search bar, Event Cluster Feed, Force-Directed Network Graph (nodes colored by outlet, interactive similarity threshold slider), Cross-Outlet Timeline Inspector, and EN/বাংলা UI toggle.

### F. Quality Gates
- [x] `bun test` (**41 pass, 0 fail**) and `bun run typecheck` (**0 errors**).
- [x] `apps/web` builds cleanly (`vite build`) and local `backfill` + `apps/api` smoke tests pass against the **41,841** article / **92,073** chunk index (**5ms** FTS5 query latency).
