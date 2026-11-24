# Sprint 7 Goals: Claim-Level Diff & Distortion Engine + Event Coverage Comparison + Frontend Handoff

**Created:** 2026-11-24  
**Prerequisite Completed:** Sprint 6 (`f4cfe71`) — `POST /verify`, `GET /checks/:id`, `GET /checks/:id/image`, `GET /checks/popular`, pure-TS JPEG/PNG `dHash`, dual-provider VLM (`GeminiFlashAdapter` + `WorkersAiAdapter` + `HeuristicVerificationAdapter`), CTE-optimized 84ms FTS5 retrieval over 422k chunks, and Sprint 5's `116,960` pre-extracted Stage B claims + `3,383` entities + `role_term` graph.  
**Core Rule (Project Proposal §1 & §3):** Jachaikori **never** declares a card *"true"*, *"false"*, or *"fake"*. The Diff Engine pinpoints concrete, verifiable differences (numbers, dates, speaker attribution, quote wording, hedging strength, omitted context) side-by-side against accredited reporting in strictly neutral language.

---

## 1. Strategic Architecture & Design Decisions

### 1.1 Hybrid Deterministic + Semantic Claim Diff Engine (`packages/verification/src/diff/`)
LLMs are great at catching paraphrased distortions, sarcasm, and omitted context — and notoriously sloppy at arithmetic and South Asian scale conversions (`৫০০ কোটি` vs `৫০ কোটি`, `Tk 5 billion` vs `৫০০ কোটি টাকা`, Bangla relative dates). Sprint 7 combines **authoritative deterministic comparators** with a **dual-provider semantic judge**:

1. **Deterministic Bangla/English Numeric Comparator (`diff/numbers.ts`):**
   - Normalizes Bangla digits (`০-৯` → `0-9`), commas, ranges (`১০-১২%`), and South Asian + international scale units:
     - `হাজার`/`thousand`/`k` (`1e3`), `লাখ`/`লক্ষ`/`lakh`/`lac` (`1e5`), `মিলিয়ন`/`million`/`m` (`1e6`), `কোটি`/`crore`/`cr` (`1e7`), `বিলিয়ন`/`billion`/`b`/`bn` (`1e9`).
   - Normalizes unit families (`currency_bdt`, `currency_usd`, `percent`, `count`) so `"৫০০ কোটি টাকা"` == `"Tk 500 crore"` == `"Tk 5 billion"` (`match`, within 2% rounding tolerance), while `"৫০০ কোটি টাকা"` vs `"৫০ কোটি টাকা"` deterministically flags **`mismatch_number`** with exact values and ratio/delta.
2. **Deterministic Bangla/English Date Comparator (`diff/dates.ts`):**
   - Parses English Gregorian dates (`18 Nov 2026`, `2026-11-18`), Bangla Gregorian dates (`১৮ নভেম্বর ২০২৬`, `১৭ ফেব্রুয়ারি ২০২৬` with orthographic variants), and relative Bangla/English markers (`আজ`/`গতকাল`/`আগামীকাল`/`yesterday`) resolved against each article's `published_at` in `Asia/Dhaka` (`UTC+6`).
   - Detects both **altered dates** (card date ≠ article event date) and **recycled old-news cards** (card cites a current date or recent framing while the matched reporting is months/years older).
3. **Speaker Attribution & Knowledge-Graph Role Guard (`diff/speaker.ts`):**
   - Resolves both the card's `quotedSpeaker` and each article's `claim.speaker_entity_id` / quoted entities through Sprint 5's compiled resolver (`compileRegistry` + `role_term`).
   - Deterministically flags **`mismatch_speaker`** when a quote attributed to Entity A on the card is attributed to Entity B in accredited reporting, and cross-checks office titles (`PM` / `Chief Adviser` / minister roles) against `role_term` windows & `holds_role` edges.
4. **Dual-Provider Semantic Quote, Hedging & Context Judge (`diff/semantic.ts`):**
   - Compares the card's statement against each top matched article's structured `claim` rows (reusing our `116,960` Stage B rows at `$0` extra extraction cost!).
   - When a top matched article lacks rows in `claim`, extracts structured claims **on demand** and persists them into `claim` (`extractor_version = 'v2-ondemand'`) for future reuse.
   - Evaluates **`mismatch_quote`**, **`hedging_shift`** (`"may"` / `"সম্ভাব্য"` / `"reportedly"` / `"alleged"` escalated into `"will"` / `"নিশ্চিত"` / certainty), and **`missing_context`** (e.g. article says `"পদত্যাগের খবর গুজব"` while card omits `"গুজব"`!).
   - Runs behind our existing dual-provider interface (`GeminiFlashAdapter` / `WorkersAiAdapter` / `HeuristicDiffJudge`) with deterministic `vlm_cache` keys, merging deterministic numeric/date/speaker findings authoritatively on top of semantic findings.

### 1.2 Event Coverage Comparison (`GET /events/:id/comparison`)
Delivers Project Proposal §4 Phase 4 ("Event coverage comparison: show which outlets covered each event, who published first, and which claims differ between outlets"):
- Resolves `event_redirect` automatically.
- Orders member articles chronologically to compute **`firstToPublish`** and **`lagMinutesFromFirst`** per outlet.
- Shows the **8-outlet coverage matrix** (which accredited outlets covered the event vs. had no indexed article in the cluster).
- Aggregates structured `claim` rows per outlet (`numbers`, `dates`, `hedgingLevel`, `speakerEntity`) and runs our deterministic numeric/hedging comparator across outlets to highlight **consensus facts** vs. **cross-outlet differences** (e.g., Outlet A reports `"certain"` while Outlet B reports `"reported"`, or Outlet A cites `"৫০০ কোটি"` while Outlet B cites `"৫২০ কোটি"`).

### 1.3 Frontend Design Agent Context Handoff (`docs/FRONTEND_DESIGN_BRIEF.md`)
Once the diff engine and event comparison endpoints are locked, tested, and verified against live 211k data, we incorporate your UI/UX vision into a single self-contained handoff brief containing:
- Product philosophy, neutral journalism copy guidelines, bilingual EN/বাংলা switching rules, and mobile-first ergonomics.
- Full finalized REST API contract across Verification + Diff, Entity Relationship Explorer, Event Coverage Comparison, and Hybrid Search — paired with **real live JSON payloads** captured straight from `data/index/index.sqlite`.

---

## 2. Work Packages & Detailed Tasks

### WP1 — Diff & Event Comparison Schemas (`packages/schema`)
- [x] **WP1.1 Claim-Level Diff Schemas (`packages/schema/src/verification.ts`):**
  - Added `ClaimDiffSeveritySchema`, `ClaimDiffItemSchema`, `OverallDiffStatusSchema`, `StoredArticleClaimSchema`, per-source `diffs` / `diffSummary` / `articleClaimsCount` on `VerificationSourceMatchSchema`, `diffMs` on `StageTimingsSchema`, and `overallDiffStatus` / `overallDiffSummary` on `VerificationCheckSchema`.
- [x] **WP1.2 Event Coverage Comparison Schemas (`packages/schema/src/cluster.ts`):**
  - Added `EventOutletCoverageItemSchema`, `CrossOutletDifferenceSchema`, and `EventComparisonResponseSchema`.

### WP2 — Deterministic + Dual-Provider Diff Engine (`packages/verification/src/diff/`)
- [x] **WP2.1 Deterministic Numeric Comparator (`src/diff/numbers.ts`):**
  - Bangla/ASCII digit normalization, South Asian (`হাজার`/`লাখ`/`কোটি`) & international (`K`/`M`/`B`/`crore`/`lakh`) scaling, currency & percent unit normalization, calendar date phrase stripping, 2% tolerance matching, and authoritative `mismatch_number` / `match` emission.
- [x] **WP2.2 Deterministic Date Comparator (`src/diff/dates.ts`):**
  - Bangla + English absolute date parser, relative Bangla/English date resolution against `published_at` (`Asia/Dhaka`), altered-date detection, and recycled-old-news detection (`>= 30 days` gap / breaking framing on >180-day-old articles).
- [x] **WP2.3 Speaker & Role-Term Comparator (`src/diff/speaker.ts`):**
  - Canonical entity comparison between card `quotedSpeaker` and article claim speakers + `role_term` office-tenure validity checks (`mismatch_speaker` / `missing_context`).
- [x] **WP2.4 On-Demand Article Claim Extractor & Dual-Provider Semantic Diff Judge (`src/diff/engine.ts`, `src/diff/cross-outlet.ts`, `src/providers/`):**
  - Extended `GeminiFlashAdapter`, `WorkersAiAdapter`, `HeuristicVerificationAdapter`, and `factory.ts` with `ClaimDiffJudge` (`extractArticleClaims()` + `compareClaims()`) and deterministic denial (`গুজব`/`ভিত্তিহীন`) + hedging-shift detectors.
  - Built `runClaimDiffEngine()` merging authoritative deterministic diffs + semantic quote/hedging/context diffs + `analyzeCrossOutletDifferences()` for multi-outlet comparison.
- [x] **WP2.5 Integrate into Verification Pipeline (`src/pipeline.ts`):**
  - Bumped `PIPELINE_VERSION = 'verify-v2.0.0'` and `RERANK_PROMPT_VERSION = 'rerank-v1.1.0'` (calibrating accredited rumor denials as high-relevance matches).
  - Integrated `runClaimDiffEngine()` on top matched sources with cached Stage B `claim` reuse and on-demand caching fallback.

### WP3 — API Endpoints (`apps/api`)
- [x] **WP3.1 Wire Claim Store & On-Demand Caching into `POST /verify` (`apps/api/src/index.ts`, `apps/api/src/claim-store.ts`, `verify-store.ts`):**
  - Bulk-reads `claim` rows for top matched articles, persists on-demand extractions (`v2-ondemand`), and persists/hydrates per-source `diffs` + `overallDiffStatus` + `overallDiffSummary` on `POST /verify` and `GET /checks/:id`.
- [x] **WP3.2 Event Coverage Comparison Endpoint (`GET /events/:id/comparison`):**
  - True UTC chronological outlet timeline (`firstToPublish`, `lagMinutesFromFirst`), 8-outlet coverage matrix, structured claims grouped by outlet, and deterministic cross-outlet numeric/hedging comparison (`5 ms` on 211k DB).
- [x] **WP3.3 Article Claims Endpoint (`GET /articles/:id/claims`):**
  - Returns cached structured claims with resolved canonical speaker/subject/object names, numbers, dates, and hedging levels.

### WP4 — Live 211k Distortion Benchmarks, Tests & Frontend Design Context Handoff
- [x] **WP4.1 Unit & Integration Tests (`packages/verification/test/diff.test.ts`, `apps/api/test/api.test.ts`):**
  - Added 9 new unit + API tests (total **88 pass, 0 fail**, 494 assertions across 14 files; strict `tsc --noEmit` 0 errors).
- [x] **WP4.2 Live 211k Distortion Smoke Test (`scripts/probe-diff.ts`):**
  - Verified live Vertex AI `gemini-3.5-flash` + deterministic comparators on distorted Bangla cards (10× numeric distortion, recycled date + omitted context) and live `GET /events/:id/comparison` against the 211k corpus.
- [x] **WP4.3 Frontend Design Agent Context Document (`docs/FRONTEND_DESIGN_BRIEF.md`):**
  - Created self-contained brief with product context, non-negotiable journalism guardrails, 4 core UX pillars, complete API contracts & taxonomies, and live JSON fixtures captured from the 211k corpus.
- [x] **WP4.4 Sprint 7 Write-Up (`docs/sprints/7. Claim-Level Diff Engine & Frontend Handoff/blog.md`) & Quality Gate:**
  - Authored plain-English blog post explaining structured claims, 2-layer deterministic + semantic diffing, and event coverage comparison; verified `tsc --noEmit` (0 errors) and `bun test` (**88 pass, 0 fail**, 494 assertions).

---

## 3. Definition of Done
1. Deterministic numeric & date comparators accurately align cross-script Bangla/English equivalents (`৫০০ কোটি` == `500 crore` == `5 billion`) and catch numeric/date alterations with high precision.
2. `POST /verify` and `GET /checks/:id` return per-source `diffs`, `diffFlags`, `overallDiffStatus`, and neutral bilingual summaries leveraging our `116,960` Stage B claims (with on-demand caching fallback).
3. `GET /events/:id/comparison` and `GET /articles/:id/claims` serve chronological outlet coverage, first-to-publish timing, and cross-outlet claim alignment/differences cleanly on the 211k DB.
4. All unit, diff, and API integration tests pass with 0 TypeScript errors, and live distorted-card smoke tests are documented in `log.md`.
5. `docs/FRONTEND_DESIGN_BRIEF.md` is finalized with the user's UI/UX vision and live API JSON fixtures, ready for the external frontend agent while we proceed to Sprint 8.
