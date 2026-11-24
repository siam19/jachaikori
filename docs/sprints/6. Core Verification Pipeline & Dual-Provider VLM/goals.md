# Sprint 6 Goals: Core Verification Pipeline & Dual-Provider VLM

**Created:** 2026-11-24  
**Prerequisite Completed:** Sprint 5 (`dbfff29`) — `211,387` articles, `422,838` chunks + BGE-M3 vectors, `30,791` event clusters, `3,383` canonical entities with bilingual dossiers, `430,231` 17-type relations, `116,960` structured claims.  
**Core Rule (Project Proposal §1 & §3):** Jachaikori **never** declares a photo card *"true"*, *"false"*, or *"fake"*, and never rates outlet credibility or bias. It extracts the card's claim, retrieves accredited coverage, and reports what accredited outlets actually published — or displays an honest, neutral `"no_coverage"` state.

---

## 1. Strategic Architecture & Design Decisions

### 1.1 Legacy `apps/web` Removal
- Permanently remove the legacy Sprint 3–4 prototype `apps/web` (fully preserved in git commit `dbfff29`) now that Sprint 5 Entity Resolution v2 has been visually verified.
- Update root [package.json](file:///home/bast0k/projects/jachaikori/package.json) and [scripts/dev.ts](file:///home/bast0k/projects/jachaikori/scripts/dev.ts) so `bun run dev` runs the local API cleanly without referencing `@jachaikori/web`, leaving a clean slate for the specialized frontend design agent after Sprint 7.

### 1.2 Dual-Provider VLM & Reranker Architecture (`packages/verification`)
To use GCP free credits while they remain (~$150+ left, expiring in ~7 days) and seamlessly switch to Cloudflare Workers AI afterward (within the `$5/mo` post-credit budget) with zero API rewrites:
- **Worker-native runtime:** `packages/verification` uses **Web Standard APIs only** (`fetch`, `crypto.subtle`, `Uint8Array`, `TextEncoder`) — zero Node-only dependencies — so the exact same code runs inside Cloudflare Workers and local Bun dev.
- **Provider-agnostic interfaces:**
  - `VlmExtractor`: `extractFromImage(imageBytes, mimeType, opts)` and `extractFromText(rawText, opts)` → strictly Zod-validated `CardExtraction` JSON.
  - `CandidateReranker`: `rerank(cardExtraction, candidates, opts)` → calibrated relevance scores `[0..1]` + brief neutral match rationale per article.
- **Two first-class implementations + automatic fallback:**
  1. **`GeminiFlashAdapter`** (GCP Vertex AI REST `gemini-3.5-flash` @ `global` OR Google AI Studio `GEMINI_API_KEY` REST): single-call Bangla stylized-font OCR + structured `CardExtraction` JSON (`responseSchema`, `thinkingBudget: 0`).
  2. **`WorkersAiAdapter`** (Cloudflare `env.AI` Worker binding in production, or Cloudflare REST API in local dev): vision extraction via Workers AI multimodal models (e.g., `@cf/meta/llama-3.2-11b-vision-instruct` / `@cf/google/gemma-3-12b-it` / `@cf/mistralai/mistral-small-3.1-24b-instruct`, configurable via `WORKERS_AI_VISION_MODEL`) and reranking via `@cf/baai/bge-reranker-base` or Workers AI text model.
- **Runtime Switch:** Controlled via `VLM_PROVIDER=gemini | workers-ai | auto` (`auto` prefers `gemini` when credentials are present and gracefully falls back to `workers-ai` if unavailable or quota-exhausted).
- **Deterministic Versioned Cache Key:** Every VLM/reranker response is keyed by `sha256(inputHash + "|" + promptVersion + "|" + modelId)` so repeated calls and future CI record-and-replay tests are deterministic and free.

### 1.3 Perceptual Hashing & Duplicate Card Cache
Viral Facebook photo cards are reposted thousands of times with slight JPEG recompression, resizing, or minor cropping.
- **Exact SHA-256 (`image_hash`)** + **64-bit Difference Hash (`dHash`, `perceptual_hash`)** computed in pure TypeScript (zero native `sharp` / `canvas` deps so it runs identically on Cloudflare Workers and Bun; supports JPEG/PNG/WebP decoding via lightweight pure-JS decoder or raw-byte fallback if an unsupported format arrives).
- On `POST /verify`:
  1. Check exact `image_hash` match first (`0 ms`, `0` VLM cost).
  2. Check recent `perceptual_hash` rows within Hamming distance `<= 6` (out of 64 bits) for same `pipeline_version` → increments `hit_count`, returns cached check immediately with `cacheHit: 'exact' | 'perceptual'`.
  3. Feed anonymous `GET /checks/popular` ordered by `hit_count DESC, created_at DESC`.

### 1.4 Entity-Aware Query Builder + True Local Hybrid Search (FTS5 + BGE-M3 + RRF)
- **Claim-to-Query Builder (`packages/verification/src/query-builder.ts`):**
  - Runs Sprint 5's compiled `resolveArticle()` (`v2.0.0`, `~2.7 ms`) over the card's `headline`, `attributedSpeaker`, `attributedStatement`, and `ocrText` (using the card's `claimedDate` or today's date for `role_term` resolution!).
  - Builds both:
    - **Primary Bangla/English keyword queries** (quoted speaker + top entities + key claim terms + cross-lingual alias expansions via `AliasDictionaryExpander`).
    - **Dense semantic query string** (clean headline + attributed statement + resolved canonical names) for BGE-M3 vector search.
  - Infers an optional **temporal window hint** when the card explicitly cites a date or historical office holder (`role_term`), boosting precision without over-filtering breaking stories.
- **True Local Vector Search (`apps/api/src/local-vector-index.ts`):**
  - Currently `apps/api/src/local-dev.ts` runs keyword-only FTS5 because `env.VECTORIZE` and `env.AI` aren't attached locally.
  - Sprint 6 adds an optional local semantic search adapter reading `chunk_vector` from `data/index/index.sqlite` (using an in-memory Float32 cosine index or SQLite-filtered candidate re-scoring + query embedding via Cloudflare Workers AI REST `@cf/baai/bge-m3` or local Python/ONNX BGE-M3 sidecar) so local `POST /verify` exercises **full hybrid FTS5 + BGE-M3 + RRF (`k = 60`)** retrieval!

### 1.5 Calibrated Reranking & Honest Empty State
- Fuse top FTS5 + semantic chunk candidates with RRF (`k = 60`), collapse to top ~20 unique articles (keeping the highest-scoring chunk snippet per article + event cluster metadata).
- Rerank top ~20 articles via `CandidateReranker` (or deterministic entity+lexical overlap fallback when running offline/no-LLM tests).
- Enforce a **calibrated confidence floor** (`MIN_MATCH_SCORE`, e.g., `0.42`):
  - If no candidate clears the floor (or the card contains no verifiable news claim, e.g., a personal meme/greeting), return `status: 'no_coverage'` with an explicit, neutral bilingual explanation: *"No accredited coverage found across the 8 indexed outlets. This does not mean the claim is false — it may be breaking news, outside the indexed outlets, or unverified commentary."*

---

## 2. Work Packages & Detailed Tasks

### WP1 — Legacy `apps/web` Removal & Verification Schemas (`packages/schema`)
- [x] **WP1.1 Delete Legacy `apps/web`:**
  - Removed `apps/web/` directory cleanly (preserved in git commit `dbfff29`).
  - Updated root [package.json](file:///home/bast0k/projects/jachaikori/package.json) and [scripts/dev.ts](file:///home/bast0k/projects/jachaikori/scripts/dev.ts) to launch the local API cleanly.
  - Verified `bun run typecheck && bun test` passes with zero broken references.
- [x] **WP1.2 Verification & Card Extraction Schemas (`packages/schema/src/verification.ts`, `cluster.ts`, `index.ts`):**
  - Added `CardExtractionSchema`, `ResolvedCardEntitySchema`, `ClaimDiffFlagSchema` (reserved slot for Sprint 7), `VerificationSourceMatchSchema`, `EmptyStateNoticeSchema`, `StageTimingsSchema`, `VerificationCheckSchema`, `VerifyResponseSchema`, and `PopularCheckSummarySchema`.

### WP2 — `packages/verification`: Dual-Provider VLM, Perceptual Hash, Query Builder & Reranker
- [x] **WP2.1 Package Scaffolding (`packages/verification/`):**
  - Created `@jachaikori/verification` using pure Web Standard APIs (`fetch`, `crypto.subtle`, `DecompressionStream`, `Uint8Array`) — zero Node-only deps.
- [x] **WP2.2 Prompt Templates & Response Cache (`src/prompts.ts`, `src/cache.ts`):**
  - Added versioned prompt/pipeline constants (`verify-v1.0.0`, `extract-v1.0.0`, `rerank-v1.0.0`), strict Gemini `responseSchema`, Bangla/English `normalizePublisherLogo()`, neutral bilingual `NEUTRAL_EMPTY_STATE_NOTICE` / `NON_CLAIM_NOTICE`, and deterministic `InMemoryVlmCache` + `SqlVlmCache`.
- [x] **WP2.3 Dual-Provider Adapters (`src/providers/`):**
  - `GeminiFlashAdapter` (Vertex AI REST `gemini-3.5-flash` @ `global` using `thinkingLevel: 'MINIMAL'` for Gemini 3.x / `thinkingBudget: 0` for 2.5 + Google AI Studio `GEMINI_API_KEY`, 30s timeout, USD token accounting).
  - `WorkersAiAdapter` (Cloudflare `env.AI` binding + REST fallback, multimodal vision + `@cf/baai/bge-reranker-base` cross-encoder with LLM fallback).
  - `HeuristicVerificationAdapter` (deterministic zero-LLM text fallback & lexical/entity overlap reranker).
  - `createVerificationProviders()` (`VLM_PROVIDER=gemini|workers-ai|auto` with automatic failover).
- [x] **WP2.4 Image Validation & Perceptual Hashing (`src/image-hash.ts`):**
  - Magic-byte JPEG/PNG/WebP validation + 8 MB hard cap, SHA-256 `imageHash`, pure-TS PNG pixel `dHash` (`DecompressionStream`), pure-TS Baseline JPEG DC-luminance `dHash` (`0`-bit Hamming distance across 92%→60% JPEG recompression!), and SimHash fallback.
- [x] **WP2.5 Entity-Aware Query Builder & Verification Orchestrator (`src/query-builder.ts`, `src/pipeline.ts`):**
  - `buildVerificationQueries()` using Sprint 5's compiled resolver, `role_term` windows, phrase-preserving FTS5 queries, and dense BGE-M3 query construction.
  - `runVerificationPipeline()` orchestrating cache lookup → VLM extraction → entity resolution → hybrid FTS5+semantic RRF → calibrated reranking (`>= 0.42` floor) → honest empty state → persistence.

### WP3 — Migration `0005_checks.sql`, R2 Image Storage & Live API Endpoints (`apps/api`)
- [x] **WP3.1 Forward-Only D1 Migration (`apps/api/migrations/0005_checks.sql` + `tools/backfill/src/db.ts`):**
  - Added `verification_check` + `vlm_cache` tables and indexes (`idx_check_image_hash`, `idx_check_perceptual_hash`, `idx_check_text_hash`, `idx_check_popular`).
- [x] **WP3.2 R2 Storage & Local Dev Vector Adapter (`apps/api/wrangler.jsonc`, `apps/api/src/local-dev.ts`, `local-vector-search.ts`):**
  - Added `CARDS_BUCKET` R2 binding + `observability.traces.enabled: true` + `VLM_PROVIDER` vars to `wrangler.jsonc`.
  - Added local filesystem R2 store (`data/uploads/`) and `LocalSqliteVectorSearch` over `chunk_vector` in `local-dev.ts`.
- [x] **WP3.3 API Endpoints (`apps/api/src/index.ts`, `apps/api/src/verify-store.ts`):**
  - Implemented `POST /verify` (multipart image & JSON text/base64, size/MIME guards, upstream `502` mapping), `GET /checks/:id`, `GET /checks/popular`, and `GET /checks/:id/image`.
  - Rewrote `runKeywordSearch()` with a top-BM25 FTS5 CTE (`84 ms` across 422k chunks instead of full-table joins on broad `OR` queries).

### WP4 — CLI Probe, End-to-End Smoke Verification & Tests
- [x] **WP4.1 Provider Capability Probe CLI (`scripts/probe-vlm.ts`):**
  - Built unified CLI probe supporting live Vertex AI / Gemini API text & multipart `--image` / `--repost-image` verification against the 211k corpus AND Cloudflare Workers AI account model probing (`CF_ACCOUNT_ID` + `CF_API_TOKEN`; Wrangler currently unauthenticated on this machine, ready to probe as soon as Cloudflare credentials are provided in Sprint 8).
- [x] **WP4.2 Unit & Integration Tests (`packages/verification/test/verification.test.ts`, `apps/api/test/api.test.ts`):**
  - Added 9 comprehensive verification test cases covering magic-byte guards, PNG/JPEG `dHash`, `role_term` query building, Gemini + Workers AI adapters, `auto` failover, perceptual dedup, multipart `POST /verify`, `/checks/:id`, `/checks/:id/image`, `/checks/popular`, and honest `no_coverage`.
- [x] **WP4.3 Final Quality Gate:**
  - Strict `tsc --noEmit` across `apps/api`, `packages/verification`, and root (**0 errors**), `bun test` (**79 pass, 0 fail**, 443 assertions), and live Vertex AI + 211k photo-card smoke test logged in `log.md`.

---

## 3. Definition of Done
1. Legacy `apps/web` is cleanly removed with zero broken scripts, imports, or tests.
2. `packages/verification` builds and passes tests with pure Web-Standard code and two working adapters (`GeminiFlashAdapter` + `WorkersAiAdapter`) switchable via `VLM_PROVIDER`.
3. `POST /verify` accepts both photo-card image uploads and pasted Bangla/English text, deduplicates reposts via SHA-256 + 64-bit `dHash`, retrieves ranked accredited sources via entity-expanded hybrid search + reranking, and returns an honest neutral `"no_coverage"` state when below the confidence floor.
4. `GET /checks/:id` and `GET /checks/popular` return persisted results and anonymous popular checks cleanly.
5. Cloudflare Workers AI model compatibility on the user's account is probed and documented alongside live Gemini Flash smoke-test timings & cost in `log.md`.
