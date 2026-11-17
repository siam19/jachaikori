# Sprint 2: Article Extractors & Fixtures — Implementation Log

This log documents article page structure exploration, shared extractor utilities, per-outlet `extractArticle()` implementations, and fixture tests for Sprint 2.

---

## 2026-11-17: Sprint Initialization

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `docs/sprints/2. Article Extractors/goals.md` | Created | Defined Sprint 2 objectives for exploring article structures, implementing pure extractors for all 8 outlets, and adding fixture tests. |
| `docs/sprints/2. Article Extractors/log.md` | Created | Tracks article DOM/JSON-LD findings, implementation changes, and test results. |

---

## 2026-11-17: Article Structure Exploration & Extractor Implementation

### Per-Outlet Article Page Findings:
| Outlet | Fetch Method | Title Source | Published Time Source | Byline / Author Source | Article Body Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Prothom Alo** | HTTP | `h1` / JSON-LD `headline` | JSON-LD `datePublished` (exact `+06:00`; `<time>` shows update time) | `.author-name-location-wrapper`, `.author-details` | `.story-element-text` (`allContainers: true`) / JSON-LD `articleBody` |
| **Bangladesh Pratidin** | Playwright | `h1.n_head` (strips site suffix) | `meta[property="article:published_time"]` | `i.bi-pen + span` (avoids generic `meta[name="author"]`) | `.mt-3 article, main article, article` |
| **Daily Jugantor** | Playwright | `h1` / JSON-LD `headline` | JSON-LD `datePublished` / `meta[property="article:published_time"]` | JSON-LD `author` | `.desktopDetailBody` |
| **Kaler Kantho** | Playwright | `h1` / JSON-LD `headline` | JSON-LD `datePublished` / `meta[property="article:published_time"]` | JSON-LD `author` (avoids generic `meta[name="author"]`) | JSON-LD `articleBody` preferred (avoids infinite-scroll related articles in `article.news-details-content`) |
| **Daily Ittefaq** | HTTP | `h1` / JSON-LD `headline` | JSON-LD `datePublished` | `.author_n_share .author` / JSON-LD `author` | `.jw_article_body, article.jw_detail_content_holder` |
| **The Daily Star** | HTTP | `h1` / JSON-LD `headline` | First `time.rsi-ago[datetime]` (JSON-LD lacks `datePublished`) | `.block-author-info-block` / JSON-LD `author` | `.block-field-blocknodenewsbody, .field--name-body` |
| **The Business Standard** | HTTP | `h1` / JSON-LD `headline` | JSON-LD `datePublished` / `meta[property="article:published_time"]` | JSON-LD `author` / `.author-name` | `article.node-news .section-content` (extracting `<p>` skips `.hide-for-print` DFP/Google News promos) |
| **bdnews24 (Bangla)** | HTTP | `h1` / JSON-LD `headline` | JSON-LD `datePublished` / `meta[property="article:published_time"]` | `.detail-author-name` / JSON-LD `author` | `.details-brief` / JSON-LD `articleBody` |

### Files Added / Modified:
- Created [extract-utils.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/extract-utils.ts) and exported from [index.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/index.ts).
- Implemented `extractArticle(html, url)` across all 8 outlet modules in `packages/outlets/src/outlets/*.ts`.
- Added 8 real-HTML fixtures in `packages/outlets/test/fixtures/<outlet>.html` and fixture test suite [extractors.test.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/test/extractors.test.ts).

### Verification:
- `bun test`: **32 pass, 0 fail** (123 assertions across 5 suites).
- `bun run typecheck`: **0 errors**.

---

## 2026-11-17: CLI Interactive Fix, Extraction Verifier & Non-Destructive Outlier Skipping

| File | Action | Details |
| :--- | :--- | :--- |
| `packages/schema/src/article.ts` | Modified | Added `'skipped'` to `ArticleStatusSchema` so deprioritized/filtered URLs stay preserved in `catalog.sqlite` without being scraped. |
| `packages/outlets/src/filters.ts` | Modified | Tightened allowlists on `kaler-kantho` (`online/national`, `online/politics`, `online/court`, `online/business`), `bangladesh-protidin` (`national`, `minister-speech`, `economy`, `current-politics`), and `business-standard` (excluded `/economy/corporates` and `/economy/stocks`). |
| `tools/crawler/src/engine/catalog.ts` | Modified | Updated `pruneCatalog()` to mark disallowed rows `status = 'skipped'` by default (reversible; `--delete` optional), added `sampleArticles()`, and scoped active queries/exports to `status != 'skipped'`. |
| `tools/crawler/src/cli.ts` | Modified | Added `verify-extract` command, updated `status` to display active vs skipped counts, and fixed interactive menu subcommand dispatch (`program.parseAsync`). |

### Balanced Active Catalog Summary:
- **Active (`status = 'discovered'`):** **38,068 articles** (0 missing days across `2026-08-01` → `2026-11-14`)
  - `business-standard`: 8,139 *(2,495 skipped)*
  - `kaler-kantho`: 7,500 *(19,221 skipped)*
  - `bangladesh-protidin`: 6,353 *(20,425 skipped)*
  - `bdnews24`: 4,250
  - `daily-star`: 3,946
  - `prothom-alo`: 3,320
  - `jugantor`: 2,373
  - `ittefaq`: 2,187
- **Skipped (`status = 'skipped'`):** **42,141 articles** retained on disk.

---

## 2026-11-17: Concurrent Polite Article Scraper & Static Live CLI

| File | Action | Details |
| :--- | :--- | :--- |
| [article.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/article.ts) | Modified | Added optional `lead` and `lastError` fields to `ArticleSchema`. |
| [catalog.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/catalog.ts) | Modified | Added idempotent `lead` and `last_error` column migrations + `idx_article_outlet_status`, `getPendingArticlesForOutlet()`, `getScrapeProgressByOutlet()`, `saveExtractedArticle()`, `markArticleFailed()`, `getArticleById()`, and WAL `checkpoint()`. |
| [limiter.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/limiter.ts) | Modified | Implemented atomic slot reservation, `abortableSleep()`, and explicit per-domain cooldown windows so `Ctrl+C` wakes sleeping workers immediately. |
| [http.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/http.ts) | Modified | Replaced bot-suffixed User-Agent with standard Chrome 131 navigation headers (`Sec-Fetch-*`, domain `Referer`, `Accept-Language: bn-BD`) and signal-aware backoff. |
| [browser.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/browser.ts) | Modified | Fixed concurrent Chromium launch race, masked `navigator.webdriver`, and added sticky per-outlet browser sessions (`fetchWithSession`) with periodic context recycling (every 150 pages). |
| [scrape-dashboard.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/ui/scrape-dashboard.ts) | Created | Built fixed-height ANSI in-place live dashboard styled with Clack framing (`│`, `◇`, `└`), 1/8th fractional Unicode progress bars (`▏▎▍▌▋▊▉█`), width clipping to prevent line wrap, cursor hide/restore hooks, and non-TTY fallback. |
| [scraper.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/scraper.ts) | Created | Built `runArticleScraper()` running 8 concurrent outlet workers (1 strictly serial human-paced loop per domain: 5 HTTP + 3 Playwright-native, per-URL clean context recycling on `kaler-kantho` to avoid sticky `AWSALB` cookie 403s, equalized Playwright/HTTP pacing, Wi-Fi disconnect auto-retry, and 65–90s cooldowns) with immediate SQLite WAL commits. |
| [cli.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/cli.ts) | Modified | Added `crawler scrape` (`-o`, `-l`, `-j`, `--retry-failed`), added **📰 Scrape Full Articles** wizard to interactive menu, and updated `crawler status` to display `scraped / active` progress. |
| [daily-star.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/outlets/daily-star.ts) | Modified | Fixed duplicate mobile/desktop author name concatenation in `.block-author-info-block`. |
| [catalog.test.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/test/catalog.test.ts) | Modified | Added unit tests for legacy SQLite schema migration, newest-first scrape queue & resume, `saveExtractedArticle()`, `markArticleFailed()`, and `AbortSignal` rate-limiter cancellation. |

### Verification:
- `bun test`: **34 pass, 0 fail** (142 assertions).
- `bun run typecheck`: **0 errors**.
- Live smoke tests (`bun run crawler scrape --limit 2` followed by `--limit 1` resume): **24 / 24** articles scraped cleanly across all 8 outlets (`3` per outlet, `0` failed) and persisted in `data/catalog.sqlite`.
