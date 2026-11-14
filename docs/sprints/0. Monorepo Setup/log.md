# Sprint 0: Monorepo Setup & Crawler Engine — Implementation Log

This log documents all file changes, additions, and architectural decisions made during Sprint 0.

---

## 2026-11-14: Initial Archive & Cleanup

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `.old.repo/` | Created (Moved from root) | Archived the previous exploratory Python-based prototype and early notes to keep git history intact while starting fresh. |
| `.gitignore` | Modified | Updated to exclude the archive and agent skills from standard commit cycles. |
| `docs/Jachaikori (যাচাই করি) — Project Proposal.md` | Added | Detailed project proposal covering problem statement, system architecture, budget ceiling ($5/mo), and roadmap. |
| `docs/sprints/0. Monorepo Setup/Monorepo & Crawler architechture.md` | Added | Sprint 0 architecture specification for the Bun monorepo, local Playwright crawler, and Cloudflare D1/Vectorize integration. |
| `docs/newspapers/Where-to-get-headlines.md` | Added | Research guide on headline and archive endpoints for the 9 accredited Bangladeshi news outlets. |

---

## 2026-11-14: Bun Monorepo Scaffolding

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `package.json` | Created | Configures Bun workspaces (`packages/*`, `tools/*`, `apps/*`), root CLI scripts (`crawler`, `test`, `typecheck`), and shared types. |
| `tsconfig.base.json` | Created | Strict TypeScript base compiler configuration (ESNext, Bundler module resolution, declaration emit). Extended by all workspaces. |
| `tsconfig.json` | Created | Root solution TypeScript config referencing sub-projects for IDE support and project-wide type checking. |
| `.gitignore` | Modified | Added ignores for `node_modules/`, `data/*` (except `.gitkeep`), `*.sqlite*`, `dist/`, `.turbo/`, test artifacts, and environment files. |
| `data/.gitkeep` | Created | Tracks the `data/` directory in git while ignoring local SQLite databases (`catalog.sqlite`) and crawl artifacts. |
| `README.md` | Created | High-level repository documentation detailing the architecture, monorepo structure, and workspace boundaries. |

---

## 2026-11-14: Shared Schema Package (`packages/schema`)

Source of truth for Zod data contracts shared across crawler, ingestion Workers, and public API.

| File | Action | Reason |
| :--- | :--- | :--- |
| `packages/schema/package.json` | Created | Workspace package configuration for `@jachaikori/schema`. |
| `packages/schema/tsconfig.json` | Created | Composite TypeScript configuration for schema compilation. |
| `packages/schema/src/outlet.ts` | Created | Defines `OutletIdSchema` (9 target outlets), `TopicSchema` (normalized categories), and `OutletPolicySchema`. |
| `packages/schema/src/crawler.ts` | Created | Defines `SourceDefSchema`, `ListItemSchema` (harvested article reference), `JobStatusSchema`, and `CrawlJobSchema` (cursor state). |
| `packages/schema/src/article.ts` | Created | Defines canonical `ArticleSchema` (matches Cloudflare D1 schema), `ArticleStatusSchema`, and `ArticleSourceSchema`. |
| `packages/schema/src/claim.ts` | Created | Defines structured `ClaimSchema` for VLM/LLM extraction (subject, predicate, object, speaker, numbers, dates). |
| `packages/schema/src/index.ts` | Created | Barrel export for schemas and inferred TypeScript types. |

---

## 2026-11-14: Outlets Package & TBS Crawler (`packages/outlets`)

Pure extraction functions, listing parsers, and site crawler contracts.

| File | Action | Reason |
| :--- | :--- | :--- |
| `packages/outlets/package.json` | Created | Workspace package configuration for `@jachaikori/outlets` (depends on `@jachaikori/schema` and `cheerio`). |
| `packages/outlets/tsconfig.json` | Created | Composite TypeScript configuration. |
| `packages/outlets/src/types.ts` | Created | Defines `OutletCrawler` interface, `CrawlContext` (polite fetchers, logging, cursors), and `ExtractedArticle`. |
| `packages/outlets/src/registry.ts` | Created | Central registry mapping `OutletId` to crawler instances. |
| `packages/outlets/src/outlets/business-standard.ts` | Created | Implementation for *The Business Standard* (TBS) walking `/archive/<year>/<month>/<date>` backwards and extracting list items via Cheerio. |
| `packages/outlets/src/index.ts` | Created | Barrel export for outlet contracts, registry, and implementations. |
| `packages/outlets/test/business-standard.test.ts` | Created | Unit tests verifying TBS listing parsing and canonical URL cleaning. |

---

## 2026-11-14: Crawler Tool (`tools/crawler`)

Local catalog harvester, rate limiter, SQLite catalog storage, and CLI.

| File | Action | Reason |
| :--- | :--- | :--- |
| `tools/crawler/package.json` | Created | Tool package configuration for `@jachaikori/crawler` (depends on `commander`, `playwright`, `yaml`). |
| `tools/crawler/tsconfig.json` | Created | Composite TypeScript configuration. |
| `tools/crawler/src/dates/bangla-numerals.ts` | Created | Utilities `banglaToAsciiDigits` and `asciiToBanglaDigits` for numeral conversions. |
| `tools/crawler/src/dates/parser.ts` | Created | Date parser handling Bangla & English months, absolute timestamps, and relative phrases ("৩ ঘণ্টা আগে"), outputting ISO in `Asia/Dhaka` (+06:00). |
| `tools/crawler/src/engine/url.ts` | Created | `canonicalizeUrl` utility stripping marketing parameters (`utm_*`, `fbclid`), trailing slashes, and normalizing protocols. |
| `tools/crawler/src/engine/catalog.ts` | Created | SQLite storage using `bun:sqlite`. Manages `article`, `crawl_job`, and `article_source` tables with Cloudflare D1 parity. |
| `tools/crawler/src/engine/limiter.ts` | Created | `DomainRateLimiter` managing per-domain delay with random jitter and circuit breaker on repeated 429/5xx responses. |
| `tools/crawler/src/engine/http.ts` | Created | `PoliteHttpClient` with timeout enforcement, exponential backoff retries, and crawler identification header. |
| `tools/crawler/src/engine/stop.ts` | Created | `StopEvaluator` enforcing cutoff rules (30 consecutive items before cutoff date, empty page limits, max page bounds). |
| `tools/crawler/src/engine/browser.ts` | Created | `BrowserPool` for Playwright with request interception blocking images, media, fonts, stylesheets, and ad trackers. |
| `tools/crawler/src/engine/runner.ts` | Created | `runCrawlJob` coordinating crawler iteration, catalog upserting, checkpoint cursor persistence, and stop rules. |
| `tools/crawler/src/cli.ts` | Created | CLI interface implementing commands: `status`, `plan`, `run`, and `recon`. |
| `tools/crawler/test/dates.test.ts` | Created | Unit tests for numeral conversion and date parsing. |
| `tools/crawler/test/catalog.test.ts` | Created | Unit tests for canonical URL handling and SQLite catalog upserts/jobs. |

---

## 2026-11-14: URL File Export & Live Stream

| File | Action | Reason |
| :--- | :--- | :--- |
| `tools/crawler/src/engine/runner.ts` | Modified | Automatically creates `data/urls/` and streams newly discovered clean URLs into `data/urls/<outlet>.txt` in real time. |
| `tools/crawler/src/engine/catalog.ts` | Modified | Added `getArticles(outlet?)` query helper for exporting articles by outlet. |
| `tools/crawler/src/cli.ts` | Modified | Added `export` command (`crawler export`) supporting `--format txt` (plain URLs) and `--format jsonl` (structured rows). |

---

## 2026-11-15: Individual Outlet Site Guides & Exploration

Researched and documented comprehensive crawling specifications for all 8 in-scope outlets (omitting Dhaka Tribune) in `docs/newspapers/`:

| File | Action | Key Findings & Content |
| :--- | :--- | :--- |
| `docs/newspapers/prothom-alo.md` | Populated | Search range via Unix ms timestamps, Next.js hydration, `.news_item_content`, `time.published-time` |
| `docs/newspapers/bangladesh-protidin.md` | Populated | Cloudflare-protected (requires Playwright), `?page=N`, discovered date in article URL `/YYYY/MM/DD/` (no detail fetch needed) |
| `docs/newspapers/jugantor.md` | Populated | Archive search form (`dateFrom`, `dateTo`, `page=N`), `.media.positionRelative`, exact timestamps in `p.desktopTime` |
| `docs/newspapers/kaler-kantho.md` | Populated | Infinite stream with `button:has-text("আরও সংবাদ")`, discovered date in article URL `/YYYY/MM/DD/` |
| `docs/newspapers/ittefaq.md` | Populated | Discovered direct AJAX endpoint `GET /api/theme_engine/get_ajax_contents?widget=565&start=20&archive_time=YYYY-MM-DD` (no Playwright needed) |
| `docs/newspapers/the-daily-star.md` | Populated | Drupal views paginated with clean `?page=N` returning HTML, `.view-content .card`, English date parsing |
| `docs/newspapers/the-business-standard.md` | Populated | Single-page daily archive `/archive/YYYY/MM/DD` (120-160 articles/day), `.card-list`, high-throughput generator |
| `docs/newspapers/bdnews24-bangla.md` | Populated | Discovered public REST endpoint `GET /archive/fetch?section_id=...&limit=12&offset=N` returning JSON with HTML chunks |

---

## 2026-11-15: robots.txt Verification & Policy Audit

Verified `robots.txt` availability, disallow rules, and sitemaps across all 8 outlets:
- Added dedicated `Robots.txt & Crawling Policy` sections to all 8 outlet guides in `docs/newspapers/*.md`.
- Confirmed target harvesting paths (`/search` for Prothom Alo, `/archive` for Jugantor, Ittefaq, TBS, and bdnews24, category streams for Daily Star, Bangladesh Pratidin, and Kaler Kantho) are completely allowed.
- Recorded `Crawl-delay: 10` for TBS and sitemaps for all outlets.

---

## Verification & Status

- **Typecheck**: `bun run typecheck` passed (0 errors).
- **Unit Tests**: `bun test` passed (11 tests across 3 suites, ~195ms).
- **Smoke Crawl**: Successfully executed `bun run tools/crawler/src/cli.ts run --outlet business-standard --pages 1`, harvesting **142 articles** for 2026-11-14 into `data/catalog.sqlite`.
