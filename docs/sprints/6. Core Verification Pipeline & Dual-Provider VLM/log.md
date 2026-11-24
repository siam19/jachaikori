# Sprint 6: Core Verification Pipeline & Dual-Provider VLM — Implementation Log

Tracks removal of legacy `apps/web`, verification schemas, `@jachaikori/verification` dual-provider VLM/reranker adapters (`GeminiFlashAdapter` + `WorkersAiAdapter`), perceptual hashing cache, entity-expanded hybrid verification pipeline, `0005_checks.sql`, and `/verify` + `/checks` API routes.

---

## 2026-11-24: Sprint Initialization

- Committed **Sprint 5 (Entity Resolution v2 & 211k Knowledge Graph)** cleanly at commit `dbfff29` (`29 files changed`, `3,383` active entities with bilingual corpus-grounded dossiers, `430,231` 17-type directional relations, `116,960` structured claims, `0` PM false positives on `eval_128.jsonl`, `$52.56` total GCP Vertex AI spend).
- Confirmed from [future-sprints.md](file:///home/bast0k/.gemini/antigravity-cli/brain/7292478b-5b2b-4c30-a302-6076d41b6eff/future-sprints.md) that the external Frontend Design Agent context doc will be delivered immediately after **Sprint 7** once `POST /verify`, `GET /checks/*`, claim-level diffs, and `GET /events/:id/comparison` are finalized against live 211k data.

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `docs/sprints/6. Core Verification Pipeline & Dual-Provider VLM/goals.md` | Created | Detailed Sprint 6 architecture, dual-provider VLM design, perceptual hash cache, local hybrid vector search, and WP1–WP4 task checklist. |
| `docs/sprints/6. Core Verification Pipeline & Dual-Provider VLM/log.md` | Created | Implementation audit trail, provider probe results, and verification benchmarks for Sprint 6. |

---

## 2026-11-24: WP1–WP4 Implementation, Real-World Fixes & Live 211k Verification

### Key Implementation Changes
| Package / App | Files Created / Modified | Summary |
| :--- | :--- | :--- |
| Legacy Cleanup | Deleted `apps/web/`, updated [package.json](file:///home/bast0k/projects/jachaikori/package.json), [scripts/dev.ts](file:///home/bast0k/projects/jachaikori/scripts/dev.ts) | Removed clunky legacy web prototype (preserved in commit `dbfff29`) ahead of the post-Sprint-7 frontend design agent handoff. |
| `packages/schema` | [verification.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/verification.ts), [cluster.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/cluster.ts), [index.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/index.ts) | Added `CardExtraction`, `ResolvedCardEntity`, `ClaimDiffFlag` (reserved for Sprint 7), `VerificationSourceMatch`, `VerificationCheck`, `VerifyResponse`, and `PopularCheckSummary` schemas. |
| `packages/retrieval` | [bangla.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/bangla.ts) | Exported shared `tokenizeBangla()` helper preserving Bangla matras/hasanta/nukta. |
| `packages/verification` | [image-hash.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/image-hash.ts), [prompts.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/prompts.ts), [cache.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/cache.ts), [query-builder.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/query-builder.ts), [pipeline.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/pipeline.ts), [providers/](file:///home/bast0k/projects/jachaikori/packages/verification/src/providers/factory.ts) | Built pure Web-Standard verification package: magic-byte validation + 8 MB cap, SHA-256 + pure-TS PNG & Baseline JPEG DC-luminance 64-bit `dHash`, `GeminiFlashAdapter` (Vertex AI REST + Gemini API), `WorkersAiAdapter` (`env.AI` binding + REST + `@cf/baai/bge-reranker-base`), `HeuristicVerificationAdapter`, `VLM_PROVIDER` failover factory, entity/role_term-aware query builder, and calibrated verification orchestrator. |
| `apps/api` & `tools/backfill` | [0005_checks.sql](file:///home/bast0k/projects/jachaikori/apps/api/migrations/0005_checks.sql), [verify-store.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/verify-store.ts), [local-vector-search.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/local-vector-search.ts), [local-dev.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/local-dev.ts), [index.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/index.ts), [wrangler.jsonc](file:///home/bast0k/projects/jachaikori/apps/api/wrangler.jsonc), [db.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/db.ts) | Added `verification_check` + `vlm_cache` migration, `POST /verify`, `GET /checks/:id`, `GET /checks/popular`, `GET /checks/:id/image`, `CARDS_BUCKET` R2 binding + local disk store, local SQLite `chunk_vector` semantic search adapter, and CTE-optimized FTS5 `runKeywordSearch()`. |
| Probe & Tests | [scripts/probe-vlm.ts](file:///home/bast0k/projects/jachaikori/scripts/probe-vlm.ts), [verification.test.ts](file:///home/bast0k/projects/jachaikori/packages/verification/test/verification.test.ts), [api.test.ts](file:///home/bast0k/projects/jachaikori/apps/api/test/api.test.ts) | Added unified dual-provider probe CLI (`--image`, `--repost-image`) and 9 new unit + API integration tests. |
| Sprint Write-Up | [blog.md](file:///home/bast0k/projects/jachaikori/docs/sprints/6.%20Core%20Verification%20Pipeline%20%26%20Dual-Provider%20VLM/blog.md) | Technical blog post explaining pure-TS JPEG DC `dHash`, dual-provider VLM failover, CTE FTS5 optimization, and live 211k verification benchmarks. |

### Two Production Issues Caught & Fixed During Live 211k Testing
1. **FTS5 Broad `OR` Full-Table Join Bottleneck:** On 422,838 chunks, joining `chunk`/`article`/`article_cluster`/`event_cluster` *before* `ORDER BY bm25(chunk_fts) LIMIT 30` caused broad Bangla `OR` queries (`"বাংলাদেশ" OR ...`) to join 150k+ rows. Rewriting `runKeywordSearch()` with a top-BM25 CTE (`WITH hits AS (...)`) and keeping multi-word canonical entities as intact FTS5 phrases cut 211k verification retrieval latency to **`84 ms`**.
2. **Gemini 3.x Multimodal `thinkingConfig` Behavior:** Live JPEG testing caught that `gemini-3.5-flash` rejects `thinkingConfig: { thinkingBudget: 0 }` on multimodal image payloads (`HTTP 400 INVALID_ARGUMENT`), whereas omitting `thinkingConfig` defaults Gemini 3.x to slow deep reasoning (>30s timeout). Switching Gemini 3.x calls to `thinkingConfig: { thinkingLevel: 'MINIMAL' }` (and gating `thinkingBudget: 0` to Gemini 2.5 with automatic retry fallback) fixed both speed and multimodal compatibility cleanly.

### Live Provider Probe & 211k Verification Results (`scripts/probe-vlm.ts`)
- **GCP Vertex AI (`gemini-3.5-flash` @ `global`, `thinkingLevel: 'MINIMAL'`):**
  - **Multipart JPEG Photo Card (`54.4 KB`, Q=92):** `HTTP 200`, `status=matched`, `dHash=a000d4c8a0d08000` (`dhash_jpeg_dc`), `latency=8,293 ms`, `cost=$0.005837` — OCR extracted headline, date (`18 November 2026`), entities (`Bangladesh Bank`, `BIDA`), and normalized publisher logo (`business-standard`), matching `[0.95] (daily-star) BB eases foreign borrowing rules for BIDA-registered firms` + `[0.50] (business-standard)`.
  - **Recompressed JPEG Repost (`29.7 KB`, Q=60, different SHA-256):** `HTTP 200`, **`cacheHit=perceptual`**, **`hamming=0`**, `hitCount=2`, **`latency=36 ms`**, **`cost=$0`** (zero VLM calls!).
  - **Bangla Pasted Claim:** `HTTP 200`, `status=matched`, `entityResolveMs=19 ms` (`ent_bangladesh_bank` + `BIDA`), `retrievalMs=84 ms` across 422,838 chunks, matched `[0.95] (prothom-alo)` + `[0.92] (kaler-kantho)`, `cost=$0.005589`. Repeat call: `cacheHit=exact`, **`latency=8 ms`**, **`cost=$0`**.
  - **Fictional Claim (`মঙ্গল গ্রহে বাংলাদেশ রেলওয়ে বুলেট ট্রেন...`):** `HTTP 200`, **`status=no_coverage`**, `sources=0`, neutral bilingual explanation preserved.
- **Cloudflare Workers AI Probe:** `wrangler whoami` confirmed this machine is not yet logged in (`CF_ACCOUNT_ID` / `CF_API_TOKEN` unset). `WorkersAiAdapter` is fully tested with mocked `env.AI` binding + `@cf/baai/bge-reranker-base`, and `scripts/probe-vlm.ts` is ready to run live as soon as Cloudflare credentials are configured in Sprint 8.

### Verification Gate
- `bunx tsc -p apps/api/tsconfig.json --noEmit && bunx tsc -p packages/verification/tsconfig.json --noEmit && bun run typecheck`: **0 errors**.
- `bun test`: **79 pass, 0 fail** (443 assertions across 13 files).

---
