# Sprint 2: Article Extractors & Fixtures — Goals

**Sprint Focus:** Explore the live article page HTML structures for all 8 active Bangladeshi news outlets, implement pure `extractArticle(html, url)` functions in `packages/outlets`, and verify them with saved HTML fixtures and unit tests.

---

## 1. Objectives

### A. Article Page Exploration & Documentation
- [x] Sample real article pages from `data/catalog.sqlite` across all 8 active outlets (`prothom-alo`, `bangladesh-protidin`, `jugantor`, `kaler-kantho`, `ittefaq`, `daily-star`, `business-standard`, `bdnews24`).
- [x] Inspect JSON-LD (`NewsArticle`), OpenGraph/meta tags, and DOM selectors for:
  - **Title** (`title`)
  - **Published time** (`publishedAtRaw` and normalized `publishedAtIso`)
  - **Author / Byline** (`byline`, optional)
  - **Raw article body** (`cleanText` and `lead` paragraph, stripping ads, related-news widgets, social buttons, and scripts)
- [x] Document the findings in Sprint 2 `log.md`.

### B. Pure Extractors (`packages/outlets`)
- [x] Build shared HTML/JSON-LD extraction utilities ([extract-utils.ts](file:///home/bast0k/projects/jachaikori/packages/outlets/src/extract-utils.ts)) to avoid duplicating JSON-LD parsing, meta fallbacks, and whitespace/boilerplate cleanup.
- [x] Implement `extractArticle(html: string, url: string): ExtractedArticle` on every `OutletCrawler` implementation.
- [x] Ensure extractors remain pure, runtime-agnostic (Cheerio-only, no Node-only APIs) so both local `tools/backfill` and Cloudflare Workers (`apps/ingest`) can share them.

### C. Fixtures & Quality Gates
- [x] Save real HTML fixtures per outlet in `packages/outlets/test/fixtures/`.
- [x] Add unit tests verifying `title`, `publishedAtRaw`, `publishedAtIso`, `byline`, `lead`, and `cleanText` (plus noise/ad stripping) for all 8 outlets.
- [x] Ensure `bun test` and `bun run typecheck` pass with 0 errors.

### D. Concurrent Polite Article Scraper & Static Live CLI
- [x] Upgrade [catalog.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/catalog.ts) with forward-compatible `lead` and `last_error` schema migrations, newest-first pending queues, and immediate per-article SQLite WAL commits (`status = 'extracted'`).
- [x] Upgrade [limiter.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/limiter.ts), [http.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/http.ts), and [browser.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/browser.ts) with realistic browser headers, sticky per-outlet Playwright contexts, human-jittered delays, micro-breathers, per-domain cooldowns, and instant `AbortSignal` cancellation.
- [x] Build a static, non-scrolling live CLI dashboard ([scrape-dashboard.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/ui/scrape-dashboard.ts)) and concurrent scrape orchestrator ([scraper.ts](file:///home/bast0k/projects/jachaikori/tools/crawler/src/engine/scraper.ts)), wired into `bun run crawler scrape` and the interactive Clack menu.
