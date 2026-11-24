# Sprint 7: Claim-Level Diff & Distortion Engine + Event Coverage Comparison + Frontend Handoff — Implementation Log

Tracks deterministic Bangla/English numeric, date, and speaker/role comparators, dual-provider semantic quote/hedging/context diffing, on-demand article claim caching, `GET /events/:id/comparison`, `GET /articles/:id/claims`, live distortion smoke benchmarks, and the Frontend Design Agent context brief.

---

## 2026-11-24: Sprint Initialization

- Committed **Sprint 6 (Core Verification Pipeline & Dual-Provider VLM)** cleanly at commit `f4cfe71` (`52 files changed`, legacy `apps/web` removed, `@jachaikori/verification` shipped with pure-TS JPEG/PNG `dHash`, `GeminiFlashAdapter` + `WorkersAiAdapter`, CTE-optimized 84ms FTS5 search, `POST /verify` + `/checks/*`, and `blog.md`).

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `docs/sprints/7. Claim-Level Diff Engine & Frontend Handoff/goals.md` | Created | Detailed Sprint 7 architecture covering deterministic + semantic diffing, event coverage comparison, and WP1–WP4 checklist. |
| `docs/sprints/7. Claim-Level Diff Engine & Frontend Handoff/log.md` | Created | Implementation audit trail and distortion-detection benchmark log for Sprint 7. |

---

## 2026-11-24: WP1–WP3 & WP4.1–WP4.2 Implemented & Live-Verified on 211k Corpus

### Key Implementation Changes
| Package / App | Files Created / Modified | Summary |
| :--- | :--- | :--- |
| `packages/schema` | [verification.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/verification.ts), [cluster.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/cluster.ts) | Added `ClaimDiffItem`, `OverallDiffStatus`, `StoredArticleClaim`, per-source `diffs`/`diffSummary`/`articleClaimsCount`, `diffMs` timing, and `EventComparisonResponse` contracts. |
| `packages/verification` | [numbers.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/diff/numbers.ts), [dates.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/diff/dates.ts), [speaker.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/diff/speaker.ts), [engine.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/diff/engine.ts), [cross-outlet.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/diff/cross-outlet.ts), [prompts.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/prompts.ts), [pipeline.ts](file:///home/bast0k/projects/jachaikori/packages/verification/src/pipeline.ts), `providers/*.ts` | Implemented pure deterministic Bangla/English numeric, date, and speaker/`role_term` comparators, deterministic denial/hedging shift checks, `ClaimDiffJudge` across all 3 providers (`GeminiFlashAdapter`, `WorkersAiAdapter`, `HeuristicVerificationAdapter`), on-demand claim caching, and cross-outlet comparison analyzer. Bumped `PIPELINE_VERSION = 'verify-v2.0.0'` and `RERANK_PROMPT_VERSION = 'rerank-v1.1.0'`. |
| `apps/api` | [claim-store.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/claim-store.ts), [verify-store.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/verify-store.ts), [index.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/index.ts) | Wired `D1ArticleClaimStore` into `POST /verify` (reusing Sprint 5's `116,960` Stage B claims + on-demand fallback caching), persisted `overallDiffStatus`/`overallDiffSummary`, and exposed `GET /events/:id/comparison` and `GET /articles/:id/claims`. |
| Tests & Probe | [diff.test.ts](file:///home/bast0k/projects/jachaikori/packages/verification/test/diff.test.ts), [api.test.ts](file:///home/bast0k/projects/jachaikori/apps/api/test/api.test.ts), [scripts/probe-diff.ts](file:///home/bast0k/projects/jachaikori/scripts/probe-diff.ts) | Added 9 new diff & comparison tests (**88 pass, 0 fail**, 494 assertions across 14 files) plus live 211k distortion & event-comparison probe. |
| Sprint Write-Up | [blog.md](file:///home/bast0k/projects/jachaikori/docs/sprints/7.%20Claim-Level%20Diff%20Engine%20%26%20Frontend%20Handoff/blog.md) | Plain-English explanation of structured claims, hybrid deterministic + semantic diffing, event coverage comparison, and live 211k results. |
| Frontend Handoff | [FRONTEND_DESIGN_BRIEF.md](file:///home/bast0k/projects/jachaikori/docs/FRONTEND_DESIGN_BRIEF.md) | Self-contained Frontend Design Agent brief with product philosophy, editorial guardrails, 4 UX pillars, full 25-route API contract, and real live 211k JSON fixtures. |

### Three Real-Corpus Subtle Edge Cases Caught & Fixed
1. **Day-of-month numbers parsed as counts:** `"১৮ নভেম্বর ২০২৬"` emitted count `18` before stripping calendar date phrases in `parseQuantities()`. Fixed via `DATE_PHRASE_RE` pre-stripping + unit regression test.
2. **Mixed `+00:00` / `+06:00` outlet timestamps in `GET /events/:id/comparison`:** String-sorting `published_at ASC` inverted chronological publish order between UTC and Dhaka-offset outlets. Sorting by true UTC `Date.parse()` revealed exact publish lags (`kaler-kantho +0m`, `prothom-alo +90m`, `bangladesh-protidin +211m`, `bdnews24 +220m`, `ittefaq +226m`) in **`5 ms`**.
3. **Opposite-polarity debunk scoring in reranker:** Accredited articles calling a viral rumor `"গুজব"` initially got down-scored below the `0.42` match floor. Calibrating `rerank-v1.1.0` to treat denials/clarifications of the exact rumor as high-relevance matches fixed retrieval cleanly.

### Live 211k Distortion Benchmarks (`scripts/probe-diff.ts` with `gemini-3.5-flash` @ `global`)
- **`GET /events/clu_f3f4d047ad0c/comparison` (`5 ms`, HTTP 200):** 5 outlets, 12 Stage B claims, exact UTC first-to-publish (`kaler-kantho`), detected 2 consensus figures (`26%`, `$35B`) + 1 cross-outlet numeric difference (`26%` vs `13%`).
- **Altered Number Distortion (`Tk 3 crore` → `Tk 30 crore` Christmas grant):** `status=matched`, `overallDiff=significant_differences`, `cost=$0.0108`. Matched both *Bangladesh Pratidin* (`0.85`, 3 Stage B claims) and *Ittefaq* (`0.85`, 1 Stage B claim), deterministically flagging `mismatch_number` (`"৩০ কোটি টাকা"` vs `"৩ কোটি টাকা"`).
- **Exaggerated / Recycled Resignation Claim (`"বিএনপির একাধিক সিনিয়র নেতার পদত্যাগ নিশ্চিত হয়েছে — ১৮ নভেম্বর ২০২৬"`):** `status=matched`, `overallDiff=significant_differences`, `cost=$0.0124`. Deterministically flagged `mismatch_date` (`240 days apart`, 2026-03-23 vs 2026-11-18) AND semantically flagged `missing_context` (clarifying that *Kaler Kantho* & *Jugantor* reported only a single upazila leader's resignation, not multiple senior leaders).

### Verification Gate (Pre-Frontend Brief)
- `bunx tsc -p apps/api/tsconfig.json --noEmit && bunx tsc -p packages/verification/tsconfig.json --noEmit && bun run typecheck`: **0 errors**.
- `bun test`: **88 pass, 0 fail** (494 assertions across 14 suites).

---
