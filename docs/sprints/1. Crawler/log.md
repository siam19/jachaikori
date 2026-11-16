# Sprint 1: Multi-Outlet Crawler & Initial 2-Week Harvest — Implementation Log

This log documents all file changes, additions, and architectural decisions made during Sprint 1.

---

## 2026-11-15: Sprint Initialization

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `docs/sprints/1. Crawler /goals.md` | Created | Defined objectives for multi-outlet parallel orchestration, anti-ban protections, outlet crawler implementations, and 2-week pilot harvest. |
| `docs/sprints/1. Crawler /log.md` | Created | Tracks implementation progress, decisions, and verification steps throughout Sprint 1. |

---

## 2026-11-15: Orchestration Engine & Anti-Ban Upgrades

| File | Action | Reason |
| :--- | :--- | :--- |
| `tools/crawler/src/engine/limiter.ts` | Modified | Added `setDomainDelay(domain, delayMs)` and `getDomainDelay(domain)` to enforce per-outlet delay policies. |
| `tools/crawler/src/engine/http.ts` | Modified | Exposed `getLimiter()` on `PoliteHttpClient` and updated default User-Agent with browser-like headers. |
| `packages/outlets/src/types.ts` | Modified | Added optional `fetchPageHtml?(url, options)` to `CrawlContext` to keep outlet parsers runtime-agnostic while enabling browser rendering. |
| `tools/crawler/src/engine/browser.ts` | Modified | Added `--disable-blink-features=AutomationControlled`, modern Chrome UA, Asia/Dhaka timezone, and `fetchRenderedHtml()` helper. |
| `tools/crawler/src/engine/runner.ts` | Modified | Binds outlet crawl delay to domain rate limiter automatically and wires browser rendering into `CrawlContext`. |
| `tools/crawler/src/cli.ts` | Modified | Implemented parallel multi-outlet worker pool (`-j, --concurrency <number>`, default 4), graceful SIGINT handling via `AbortController`, and resource cleanup. |

---

## 2026-11-15: All 8 Outlet Crawlers & Parsers Implemented

Implemented the complete set of in-scope Bangladeshi news outlet crawlers based on the research in `docs/newspapers/`:

| File | Action | Key Architectural Features |
| :--- | :--- | :--- |
| `packages/outlets/src/outlets/ittefaq.ts` | Created | Daily archive `/archive/YYYY-MM-DD` day stepping + AJAX `/api/theme_engine/get_ajax_contents` batch pagination (1500ms delay). |
| `packages/outlets/src/outlets/bdnews24.ts` | Created | Direct JSON REST endpoint `/archive/fetch` with category sections (National 39002, Politics 37846, Economy 39123) and offset pagination. |
| `packages/outlets/src/outlets/daily-star.ts` | Created | Clean Drupal Views category pagination (`?page=N`) with `h5.card-title` and exact ISO `time[datetime]`. |
| `packages/outlets/src/outlets/prothom-alo.ts` | Created | Backward day stepping using exact Unix millisecond timestamp windows in `/search?published-after=...&published-before=...`. |
| `packages/outlets/src/outlets/jugantor.ts` | Created | Daily archive search form query (`dateFrom=YYYY-MM-DD+00:00`, `dateTo=YYYY-MM-DD+23:59`, `page=N`). |
| `packages/outlets/src/outlets/bangladesh-protidin.ts` | Created | Official daily sitemaps (`/daily-sitemap/YYYY-MM-DD/sitemap.xml`) with instant dates and Bangla headlines. |
| `packages/outlets/src/outlets/kaler-kantho.ts` | Created | Official daily sitemaps (`/daily-sitemap/YYYY-MM-DD/sitemap.xml`) with instant dates and Bangla headlines. |
| `packages/outlets/src/registry.ts` | Modified | Registered all 8 crawlers into the central registry. |
| `packages/outlets/src/index.ts` | Modified | Barrel-exported all outlet crawler classes. |

---

## 2026-11-15: Kaler Kantho Page 89 Investigation & Hardening

### Investigation:
1. **Loop Cause**: Kaler Kantho's web server completely ignores `?page=N` query parameters on category URLs, always returning the same 30 cards from page 1.
2. **Stop Evaluator Gap**: Because those 30 cards were from Nov 12–15 (newer than the cutoff date `2026-11-01`), the date cutoff counter never incremented, causing the crawler to request pages 1 to 89 in an infinite duplicate loop until sleep mode interrupted it.
3. **Apparent Data Loss**: The job log was incrementing `itemsFound += batch.items.length` without checking duplicates (showing 2,640 phantom items). SQLite deduplication correctly saved only the 30 unique rows, making it appear that 2,610 articles were lost upon restart.

### Fixes Applied:
1. **Pagination Loop Detector ([stop.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/stop.ts))**: If 2 consecutive batches return 0 new items (`newItemsInBatch === 0`), `StopEvaluator` immediately halts with `pagination_loop_detected`.
2. **Accurate Unique Accounting ([runner.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/runner.ts))**: `crawl_job.items_found` now tracks only unique newly discovered articles, matching `catalog.sqlite` exactly.
3. **Daily Sitemaps for Kaler Kantho & BD Pratidin**: Switched to official daily sitemaps (`/daily-sitemap/YYYY-MM-DD/sitemap.xml`). Harvests 400+ articles per calendar day in a single request with exact ISO timestamps and Bangla headlines.
4. **Daily Star DOM Fix**: Fixed selector to target `h5.card-title a` and read exact timestamps from `time[datetime]`.

---

## 2026-11-15: Verification & Catalog Milestone

### Current Catalog Summary (`data/catalog.sqlite`):
Total Articles: **6,156** across all 8 outlets:
- `business-standard`: 2,957
- `bdnews24`: 708
- `kaler-kantho`: 562
- `bangladesh-protidin`: 559
- `prothom-alo`: 536
- `jugantor`: 499
- `ittefaq`: 324
- `daily-star`: 11

### Quality:
- `bun test`: All 18 tests passing (~269ms).
- `bun run typecheck`: 0 errors.
- Real-time text exports refreshed in `data/urls/` formatted as `<CanonicalUrl> | <Headline>`.

---

## 2026-11-15: Incremental Crawling & Idempotent History Walking

| File | Action | Reason |
| :--- | :--- | :--- |
| `tools/crawler/src/engine/stop.ts` | Modified | Switched pagination loop detection from `newItemsInBatch === 0` to exact batch URL set comparison (`batchUrls.every(u => lastBatchUrls.has(u))`), allowing the crawler to walk through previously harvested days without false-positive loop aborts. |
| `tools/crawler/src/engine/catalog.ts` | Modified | Added `getArticleCountForSource(outlet, sourceKey)` for accurate job article tracking and verified `ON CONFLICT(canonical_url) RETURNING (created_at = updated_at) AS is_new`. |
| `tools/crawler/src/engine/runner.ts` | Modified | By default, crawls start from latest (today) down to `--cutoff`. Already discovered articles return `isNew = false` and are skipped without duplicate file appends. When older dates are requested, older articles are seamlessly discovered and saved. |
| `tools/crawler/src/cli.ts` | Modified | Added `-r, --resume` flag (default false) to allow users to explicitly choose between fresh top-to-cutoff crawl vs resuming from saved cursors. |

---

## 2026-11-15: The Daily Star Pagination & Target Category Fix

### Problem:
The Daily Star yielded only 41 articles while other outlets yielded hundreds or thousands.

### Root Cause:
1. **Drupal 10 Views AJAX**: Standard HTTP `?page=N` on category pages is completely ignored by The Daily Star's Drupal backend; it returns static page 0 (top 10 cards) indefinitely. The crawler's consecutive batch loop detector caught the duplicate URLs on page 1 and halted after 1 batch per category.
2. **Missing Target Categories**: Target categories in `packages/outlets/src/outlets/daily-star.ts` were incomplete compared to the 6 accredited categories in [docs/newspapers/the-daily-star.md](file:///home/bast0k/projects/jachaikori/docs/newspapers/the-daily-star.md).

### Solution:
1. Updated `DailyStarCrawler` to dynamically discover Drupal AJAX settings (`view_name`, `view_display_id`, `view_args`) on initial page load (`page = 0`) and paginate subsequent batches (`page >= 1`) via `https://www.thedailystar.net/views/ajax?...` with `X-Requested-With: XMLHttpRequest`.
2. Aligned `defaultSources` with the 6 verified target categories in [the-daily-star.md](file:///home/bast0k/projects/jachaikori/docs/newspapers/the-daily-star.md): `politics`, `governance`, `crime-justice`, `economy`, `startups`, and `accidents-and-fires`.
3. Ran full crawl down to `2026-11-01`: Daily Star surged from **41** to **778 unique articles**. Total catalog now stands at **19,694 unique articles**.


---

## 2026-11-17: Sprint 1 Wrap-Up — Strict Category Allowlisting, Pagination Fixes & Corpus Audit

### Audit Findings & Fixes Applied:
1. **Strict Per-Outlet Category Allowlists ([filters.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/filters.ts))**:
   - Implemented strict URL section allowlists across all outlets, keeping **National, District/Country, Politics, Court/Governance/Crime, Economy/Business/Commerce, and Print News Pages**, while dropping `world`/`international`, `sports`, `entertainment`, `multimedia`/`videos`, `govt-ad`, `lifestyle`/`islam`, `campus`, and `editorial`.
   - Added `crawler prune` and `crawler gaps` subcommands to [cli.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/cli.ts) and `pruneCatalog()` / `getDailyCounts()` to [catalog.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/catalog.ts).
2. **Under-Harvesting & Pagination Fixes (Verified via Live Smoke Probes, Long Re-Crawl Deferred)**:
   - **[ittefaq.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/outlets/ittefaq.ts)**: Unwrapped JadeWits JSON responses (`{"total":20,"finished":false,"html":"..."}`) from `/api/theme_engine/get_ajax_contents`, added category link slug filtering (`a.category`), and expanded daily offset pagination (single-day yield verified at **97 in-scope articles** on `2026-11-14`, up from 20).
   - **[prothom-alo.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/outlets/prothom-alo.ts)**: Switched daily window harvesting to Quintype `/api/v1/advanced-search` over plain HTTP with `offset`/`limit=50` pagination and added all 11 `commerce` section IDs (single-day `bangladesh` yield verified at **65 in-scope articles** on `2026-11-14`, up from ~15).
   - **[jugantor.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/outlets/jugantor.ts)**: Raised daily archive pagination cap from `page <= 3` to `page <= 25` and evaluated raw page URLs prior to allowlist filtering so off-topic pages do not halt pagination early.
   - **[bdnews24.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/outlets/bdnews24.ts)**: Added missing `commerce` (`39367`) and `court` (`107363`) sources and fixed `offset += limit` advancement when items are filtered.
   - Fixed local calendar date cursor formatting (`YYYY-MM-DD`) across all 6 day-stepping crawlers to avoid UTC midnight drift between `00:00` and `06:00` Asia/Dhaka.
3. **Catalog Prune, Hygiene & Coverage Verification**:
   - Removed **48,895** off-topic rows and **15** orphaned `crawl_job` records; vacuumed `data/catalog.sqlite` from **110.2 MB → 65.0 MB**.
   - Migrated unit tests in [catalog.test.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/test/catalog.test.ts) to `:memory:` and removed leftover `data/test-catalog.sqlite*` files.
   - Renamed `docs/sprints/1. Crawler /` → `docs/sprints/1. Crawler/`.
   - Refreshed all `.txt` and `.jsonl` exports in `data/urls/`.

### Final Clean Catalog Summary (`data/catalog.sqlite`):
- **Total Clean In-Scope Articles:** **80,209** (0 missing days across all 8 outlets between `2026-08-01` and `2026-11-14`)
  - `bangladesh-protidin`: 26,778 (`2026-07-30 → 2026-11-14`)
  - `kaler-kantho`: 26,721 (`2026-07-30 → 2026-11-15`)
  - `business-standard`: 10,634 (`2026-07-30 → 2026-11-15`)
  - `bdnews24`: 4,250 (`2026-07-08 → 2026-11-15`)
  - `daily-star`: 3,946 (`2025-04-07 → 2026-11-14`)
  - `prothom-alo`: 3,320 (`2026-07-27 → 2026-11-14`)
  - `jugantor`: 2,373 (`2026-07-30 → 2026-11-14`)
  - `ittefaq`: 2,187 (`2026-07-29 → 2026-11-15`)
- **Tests & Typecheck:** `bun test` (24 passing across 4 suites) and `bun run typecheck` (0 errors).
