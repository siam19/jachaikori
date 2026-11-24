# Sprint 8: Backend UI Prep & "The Morning Edition" Web App (`apps/web`) — Implementation Log

Tracks the 5 UI-enabling backend polish updates (`packages/verification`, `apps/api`) and the full ground-up build of `apps/web` ("The Morning Edition" bilingual editorial UI, Proof Strip & Lineup diff system, Entity Exploration Layer, 8-outlet Event Coverage Lanes, Omnibox/Search, Local Scrapbook, and PWA Share Target).

---

## 2026-11-24: Design Handoff Finalization & Sprint 8 Initialization

- Finalized and reconciled all three design specification documents in `docs/sprints/8. Web UI Design/` to **v0.2** (after moving `FRONTEND_DESIGN_BRIEF.md` from `docs/`):
  - Completed Sections F–I of `Jachaikori — UI String Table (EN ↔ বাংলা).md`, naturalised `trace.entities`, and added private-photo warning to `cap.notice`.
  - Folded strict-TS `null` guards (`leadArticle`, `lagMinutesFromFirst`), server-side comma-separated `?type=` lens mapping, and confirmed v0.2 decisions into `Jachaikori — Implementation Spec.md`.
  - Synced WCAG-verified palette tokens (`sage #3A6450`, `ochre #7F5200`, `rule-strong #8F8472` / `#766C5D`), default English language, subtle static paper grain (~3%), local-only IndexedDB scrapbook, and Cloudflare Pages hosting into `Jachaikori — Visual Direction & UI Plan.md`.
- **Starting Baseline (from Sprint 7 commit `8e7f92d`):**
  - TypeScript strict check: **0 errors**.
  - `bun test`: **88 pass, 0 fail** (494 assertions across 14 suites).
  - Live SQLite corpus (`data/index/index.sqlite`): `211,387` articles, `422,838` chunks, `30,973` clusters, `3,383` active entities with bilingual dossiers, `430,231` 17-type relations, `116,960` structured claims.

---

## 2026-11-24: WP0 — Backend Polish & New UI Endpoints (`packages/verification`, `apps/api`)

Implemented all 5 backend enhancements required by `Implementation Spec §9`:

| Item | Files | Summary |
| :--- | :--- | :--- |
| **WP0.1** Natural-language `overallDiffSummary` | `packages/verification/src/diff/engine.ts` | Replaced raw enum leaks (`mismatch_number`, etc.) with clean EN & বাংলা category labels (`numbers`, `dates`, `speaker attribution`, `quote wording`, `certainty framing`, `omitted context` / `সংখ্যা`, `তারিখ`, `বক্তার পরিচয়`, `উদ্ধৃতির ভাষা`, `নিশ্চয়তার মাত্রা`, `বাদ পড়া প্রসঙ্গ`). |
| **WP0.2** Bangla numerals (`০–৯`) in generated `bn` copy | `packages/verification/src/diff/numbers.ts`, `dates.ts`, `speaker.ts`, `engine.ts`, `cross-outlet.ts` | Exported `toBanglaDigits()` and localized generated counts, ISO dates, day gaps, and outlet tallies in `explanationBn`/`summaryBn` while keeping verbatim `cardSpan`/`articleSpan` untouched. |
| **WP0.3** Comma-separated `?type=` filter | `apps/api/src/index.ts` | Updated `handleEntityRelations()` to split `?type=` on `,`, normalize via `normalizeRelationType()`, and query `r.relation_type IN (...)` for server-side Lens category filtering. |
| **WP0.4** `GET /events/divergent?limit=6` | `apps/api/src/index.ts` | Registered before `/events/:id/...`; evaluates up to 80 recent multi-outlet clusters with claims via `analyzeCrossOutletDifferences()`, keeps `number_difference` / `hedging_difference`, prioritizes numeric divergences, and returns compact comparison previews. Also added optional `minOutlets` support to `GET /events`. |
| **WP0.5** `GET /entities/random` | `apps/api/src/index.ts` | Registered before `/entities/:id`; picks a random active non-hub entity (`article_count BETWEEN 20 AND 1500` with clean fallbacks) and returns its full `EntityProfile`. |
| **WP0.6** Backend tests & 211k smoke check | `packages/verification/test/diff.test.ts`, `apps/api/test/api.test.ts` | Added assertions for zero raw enum tokens, Bangla digits in `bn` summaries/explanations, comma-separated `?type=`, `/events/divergent`, and `/entities/random`. Verified live against `data/index/index.sqlite` (6 divergent events with 2 `number_difference` prioritized; `৪টি সংবাদমাধ্যম একই সংখ্যা (২৬%) উল্লেখ করেছে।`). |

---

## 2026-11-24: WP1–WP5 — "The Morning Edition" Web App (`apps/web`)

Built `@jachaikori/web` from scratch following `Visual Direction & UI Plan v0.2`, `Implementation Spec v0.2`, and `UI String Table v0.2`:

### WP1 — Scaffold, Theme, Typography, i18n & API Layer
- Scaffolded `apps/web` with React 19, TypeScript (`strict: true`), Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), React Router v7 (`createBrowserRouter`), TanStack Query v5, `@jachaikori/schema` (`workspace:*`), `lucide-react`, Fontsource subsets, `idb-keyval`, `vite-plugin-pwa`, and Vitest.
- Updated root `package.json` (`"web": "bun --filter @jachaikori/web dev"`) and `scripts/dev.ts` to launch both API and Web dev servers concurrently.
- Implemented WCAG-verified Morning & Evening palette in `src/theme/tokens.css`, per-script font stacks with Bangla `line-height: 1.72` in `src/theme/fonts.css`, and static ~3% 128px tiled paper grain (dropped under `prefers-reduced-data`), hairline rules, double masthead rule, and Proof Strip `.swap` motion in `src/theme/paper.css`.
- Generated complete EN ↔ বাংলা dictionaries (`src/i18n/en.ts`, `bn.ts`), `tt()` with `{placeholder}` + ICU-lite plural + Bangla digit formatting (`src/i18n/tt.ts`, `format.ts`), `useLang()` (English default, `localStorage` + `<html lang>`), `useTheme()`, `Asia/Dhaka` date/lag formatters (`src/lib/dates.ts`), `scriptRuns()` + `<Verbatim>` (`src/lib/scripts.ts`, `src/ui/Verbatim.tsx`), and baseline-JPEG `downscaleIfLarge()` (`src/lib/downscale.ts`).
- Built typed API client (`src/api/client.ts`), error classifier (`src/api/errors.ts`), TanStack Query factories (`src/api/queries.ts`), editorial Shell with Masthead & Mobile Bottom Nav (`src/ui/Shell.tsx`), and `/gallery` (`src/features/gallery/GalleryPage.tsx`).

### WP2 — Pillar A: Verification Flow, Proof Strip, Rack, Lineup & Receipt
- `src/diff/partition.ts` (`partitionDiffs()` guaranteeing nothing-dropped invariant), `src/diff/amount.ts` (`parseAmount()` for Bangla/English & South Asian scales + `rulerX()`).
- `src/diff/ProofStrip.tsx` (unchanged sentence words stay still; only differing spans roll via `--t` native range scrubber + segmented toggle, clearly labelled *"Card wording, with the outlet's figure"*), `src/diff/Rack.tsx` (ghost chip for `missing_context`, 3-notch certainty gauge for `hedging_shift`, date gap axis bar, fallback span pairs), `src/diff/Lineup.tsx` (log-scale numeric ruler with chip fallback), and `src/diff/Receipt.tsx` (verbatim highlighted snippet in ink, *"Checked by rule"* vs *"Judged by model"* badge, bilingual explanations, *"Also matched"* row, tucked confidence/relevance details).
- `src/features/verify/Capture.tsx` (Photo / Paste / Text tabs, drag-drop, global `Ctrl/Cmd+V`, `navigator.clipboard.read()`, baseline JPEG downscale `> 2 MB`, visible `cap.notice`, PWA `/?shared=1` inbox pickup, upstream retry up to 2x), `PressRun.tsx` (5-stage editorial progress with scanning pencil line & `aria-live="polite"`), `CheckPage.tsx` (sticky Exhibit rail, What We Found tally, Lineup, All/Only differences filter, Proof Strips, Receipts, Copy link/Share/Scrapbook pin, cache-hit banner with Re-check, collapsible pipeline trace, honest empty state), and `PopularRail.tsx`.

### WP3 — Pillar B: Entity Explorer, Dossier, Lens, Peeks, Trail & Orbit
- `src/features/explore/`: URL-synced `LensBar` (`src/lib/useLens.ts`), stacked `PeekProvider` + `EntityPeek` + `EventPeek` sheets, and `sessionStorage` `TrailBar` with shareable encoded trail URL.
- `src/features/entities/`: `Directory.tsx` (type/search/hub filters + **"Surprise me"** button wired to `GET /entities/random`), `Dossier.tsx` (3-column broadsheet, drop-cap bilingual bio with inline article citations, aliases, `roleTerms` tenure ribbon, merge-redirect banner), `Relations.tsx` (5 category segmented filter querying server-side comma-separated `?type=`, directional sentences, expandable verbatim evidence clippings), `Activity.tsx` (full-series SVG brushable bar chart + single-day headline peek), `Associated.tsx` + lazy-loaded `Orbit.tsx` (fixed-ring SVG orbit, 0.84 KB gzipped), and `Articles.tsx`.

### WP4 — Pillar C & D: Front Page, Events, 8-Outlet Lanes, Omnibox & Search
- `src/features/front/FrontPage.tsx` (Capture hero, Most checked rail, Where outlets differ 3-across rail, In the news entity strip, Recent multi-outlet events).
- `src/features/events/`: `EventList.tsx`, `Lanes.tsx` (8 accredited outlets with strict `null` guards on `leadArticle` and `lagMinutesFromFirst`, neutral *"No matching article in our index"* copy, click-to-filter claims), and `EventPage.tsx` (merge-redirect banner, cross-outlet agreement/difference cards, claims by outlet tabs, expandable entity connections, Keep Reading rails).
- `src/features/search/`: `Omnibox.tsx` (`/` and `Cmd/Ctrl+K` modal with instant `/entities/suggest` + debounced `/search` + keyboard navigation) and `SearchPage.tsx` (newspaper-index results, *"Also searched"* alias expansion pills, outlet & date filters).

### WP5 — Local Scrapbook, PWA Share Target, Cloudflare Pages & Verification Gate
- `src/features/scrapbook/`: `ScrapbookStore` interface backed by `idb-keyval`, `useScrapbook()` hook, and `/scrapbook` page (no auth UI).
- `src/sw.ts` + `vite.config.ts`: `vite-plugin-pwa` (`injectManifest`) with `#F5EFE3` theme/background, SVG icons, and `POST /share-target` handler storing shared photos/text in Cache Storage (`share-inbox`) and redirecting `303` to `/?shared=1`.
- `public/_headers`: Cloudflare Pages cache & security headers (confirmed **no** `_redirects` file).
- 7 Vitest suites (`19 tests`): `partitionDiffs`, `parseAmount`, `scriptRuns` & `<Verbatim>`, `useLens`, `classify`, EN ↔ বাংলা i18n parity, and automated WCAG 2.x contrast verification on `tokens.css` (both Morning and Evening palettes including 12% oklab washes and `rule-strong`).

---

## Verification Metrics

- **Strict TypeScript (`tsc --noEmit` across `apps/web`, `apps/api`, `packages/verification`, root):** `0` errors.
- **Backend + Workspace Tests (`bun test`):** `108 pass / 0 fail` across `21` files.
- **Frontend Unit Tests (`bun --filter @jachaikori/web test`):** `7 files / 19 tests passed` (including i18n parity and WCAG 2.x contrast).
- **Production Vite Build (`bun --filter @jachaikori/web build`):**
  - Initial route gzipped JS: **`141.33 KB`** (`react-vendor` 32.72 KB + `query-vendor` 13.88 KB + `index` 94.73 KB) — under the `~150 KB` budget.
  - Lazy route chunks: `Orbit.js` 0.84 KB, `ScrapbookPage.js` 1.08 KB, `EventList.js` 1.37 KB, `Directory.js` 2.05 KB, `SearchPage.js` 2.29 KB, `EventPage.js` 3.43 KB, `CheckPage.js` 4.80 KB, `Lineup.js` 5.54 KB, `Dossier.js` 6.26 KB (all gzipped).
  - PWA Service Worker: `dist/sw.js` (`5.88 KB` gzipped), `dist/manifest.webmanifest`, `dist/_headers` verified; no `_redirects` file.
- **Live 211k DB Contract Smoke Check (`data/index/index.sqlite`):** All new & existing endpoints (`/events/divergent`, `/entities/random`, `/entities/:id/relations?type=...`, `/events/:id/comparison`, `/search`, `/checks/popular`) validated against live `@jachaikori/schema` Zod schemas.

---

## 2026-11-24: Post-Review Visual Softening, Centered Search Hero & D3 Ego Graph

- **Fixed local VLM auto-detection & `/entities/:id/ego` shape:**
  - Updated `apps/api/src/local-dev.ts` to auto-detect `gcloud config get-value project` and accept `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` aliases.
  - Updated `EntityEgoNeighbor` (`client.ts`, `Associated.tsx`, `Orbit.tsx`, `Dossier.tsx`) to match the flat `/entities/:id/ego` response shape and added `RouteErrorBoundary.tsx`.
- **Softer, rounded visual language & cleaner masthead:**
  - Removed the masthead wordmark, double bottom border, Search button, and Appearance toggle in `Shell.tsx`; kept clean pill navigation + `EN / বাংলা` toggle with a subtle single hairline divider.
  - Upgraded corners across the entire app from `3px` to generous `rounded-xl` / `rounded-2xl` / `rounded-3xl` / `rounded-full` with softer warm elevation (`tokens.css`, `paper.css`, and all feature components).
- **Refocused `/` Home Page (`FrontPage.tsx`, `GET /health`):**
  - Centered **`JachaiKori`** title with a unified rounded search bar underneath supporting typing to search the database, attaching/dropping/pasting photos directly, optional *"Compare as claim"* action, and live entity suggestions.
  - Extended `GET /health` to return `activeEntities`, `outlets`, and `lastUpdatedAt` (`MAX(published_at)`), powering the live stats line below the search bar (*"N articles • N entities • 8 outlets in database. Last update N ... ago"*).
  - Removed *"Most checked"*, *"Where outlets differ"*, and *"In the news"* from `/`; kept a single clean **"Recent Events"** grid displaying article count, outlet count, and date on each card.
- **Interactive Asymmetrical D3 Ego Graph (`EntityGraph.tsx`, `Relations.tsx`, `Dossier.tsx`):**
  - Added lazy-loaded `d3-force` (`12.96 KB` gzipped) asymmetrical force-directed ego graph as the default view on `/entities/:id` (with a `Graph | List` pill toggle).
  - Clicking any neighbor node smoothly reorients the ego graph in-place (`preventScrollReset: true`) with an interactive back button & jumpable history trail (`graphHistory`), viewport node clamping, drag exploration, and curved edge selection loading formatted verbatim accredited source quotes into the side panel.
- **Official Outlet Favicons, Bangla Serif Polish & Trail Overflow Fix (`OutletName.tsx`, `public/favicons/*`, `public/_headers`, `fonts.css`, `TrailBar.tsx`, `i18n/en.ts`, `bn.ts`):**
  - Bundled local official favicons for all 8 indexed accredited outlets under `apps/web/public/favicons/` (with 30-day cache headers in `public/_headers`) and rendered them beside every `OutletName` nameplate.
  - Added `Noto Serif Bengali` (`@fontsource/noto-serif-bengali`) to `fonts.css` alongside `Tiro Bangla` and `Hind Siliguri`, updated EN ↔ বাংলা strings, and capped `TrailBar` to the most recent 4 stops with `… ›` ellipsis truncation.
- **Final Pre-Commit Verification Gate (`2026-11-24 22:42`):**
  - Strict TypeScript (`tsc --noEmit` across root, `apps/api`, `packages/verification`, `apps/web`): **0 errors**.
  - Workspace tests (`bun test`): **108 pass / 0 fail** (`1,463` assertions across `21` files).
  - Frontend Vitest suite (`bun --filter @jachaikori/web test`): **7 files / 19 tests passed** (including EN ↔ বাংলা parity & WCAG contrast).
  - Production build (`bun --filter @jachaikori/web build`): built cleanly in `2.74s` (`140.59 KB` initial gzipped JS + `5.88 KB` PWA `sw.js`).

---

## Implementation Progress

- [x] **WP0:** Backend polish & endpoints (`overallDiffSummary`, Bangla digits in `bn`, comma-separated `?type=`, `GET /events/divergent`, `GET /entities/random`)
- [x] **WP1:** `apps/web` scaffold, WCAG tokens, fonts, paper grain, full EN ↔ বাংলা i18n, `<Verbatim>`, API client, shell
- [x] **WP2:** Pillar A — Capture Zone, Press Run, Check Page, Proof Strip, Rack, Receipt, Lineup, Popular Rail
- [x] **WP3:** Pillar B — Lens, Peek Sheets, Reading Trail, Entities Directory ("Surprise me"), Entity Dossier & Orbit
- [x] **WP4:** Pillar C & D — Front Page broadsheet, Events Index, 8-Outlet Lanes & Comparison, Omnibox & Search
- [x] **WP5:** Local Scrapbook (`idb-keyval`), PWA Share Target (`sw.ts`), Cloudflare Pages `_headers`, unit/i18n/contrast tests, bundle check & `blog.md`
