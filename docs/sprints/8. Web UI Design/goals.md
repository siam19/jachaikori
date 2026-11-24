# Sprint 8 Goals: Backend UI Prep & "The Morning Edition" Web App (`apps/web`)

**Created:** 2026-11-24  
**Status:** Ready for Implementation (Fresh Session Handoff)  
**Prerequisite Baseline:** Commit `8e7f92d` on `main` (Sprint 7 complete — Claim-Level Diff & Distortion Engine, `GET /events/:id/comparison`, `GET /articles/:id/claims`, `88 pass / 0 fail` across 14 test suites with 494 assertions, `0` strict TypeScript errors, live 211k SQLite corpus at `data/index/index.sqlite`).

---

## 0. Fresh Session Context & Source-of-Truth Documents

Before writing any code, read the finalized **v0.2** design specifications in this folder. All open questions from the UI design phase have been resolved and folded into them:

1. **[Jachaikori — Visual Direction & UI Plan.md](file:///home/bast0k/projects/jachaikori/docs/sprints/8.%20Web%20UI%20Design/Jachaikori%20%E2%80%94%20Visual%20Direction%20%26%20UI%20Plan.md)** (`v0.2`): Aesthetic system ("The Morning Edition"), **ink vs. pencil** rule, Proof Strip interaction, Lineup ruler, Exploration layer (Lens, Peeks, Trail, Orbit), 8-outlet Lanes, and build order.
2. **[Jachaikori — Implementation Spec.md](file:///home/bast0k/projects/jachaikori/docs/sprints/8.%20Web%20UI%20Design/Jachaikori%20%E2%80%94%20Implementation%20Spec.md)** (`v0.2`): Exact schema imports (`ClaimDiffItem`, etc.), `<Verbatim>` script-run rules, baseline JPEG downscaling, `partitionDiffs()` algorithm, Lens-to-API mapping, desktop broadsheet layouts, error states, Vite/PWA/Cloudflare Pages setup, and WCAG 2.x contrast verification tables.
3. **[Jachaikori — UI String Table (EN ↔ বাংলা).md](file:///home/bast0k/projects/jachaikori/docs/sprints/8.%20Web%20UI%20Design/Jachaikori%20%E2%80%94%20UI%20String%20Table%20(EN%20%E2%86%94%20%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE).md)** (`v0.2`): Complete EN ↔ বাংলা copy dictionary (Sections A–I) for generating `apps/web/src/i18n/en.ts` and `bn.ts`.
4. **[FRONTEND_DESIGN_BRIEF.md](file:///home/bast0k/projects/jachaikori/docs/sprints/8.%20Web%20UI%20Design/FRONTEND_DESIGN_BRIEF.md)**: Full 25-route API contract, entity/relation/diff taxonomies, and real live 211k JSON payloads.

### Non-Negotiable Product & Editorial Guardrails
- **Never render verdicts:** Never label any card *"true"*, *"false"*, *"fake"*, *"verified"*, or *"misleading"*. Never use pure red/green verdict stamps or per-outlet colors (colors read as credibility ratings).
- **Ink is their words, pencil is ours:** Outlet headlines, snippets, evidence quotes, and card OCR text stay verbatim in their original published script (`<Verbatim>`) with serif typography. Jachaikori UI chrome, explanations, and diff marks sit in sans-serif pencil.
- **Confirmed Product Decisions (v0.2):**
  - **Default language:** **English (`en`)** by default, with persistent one-tap `EN / বাংলা` toggle in the masthead (`localStorage` + `<html lang>`). Numerals localize (`০–৯` in `bn`, `0–9` in `en`) in our copy only — never inside verbatim outlet text.
  - **Proof Strip:** Rolled-in *"card wording with the outlet's figure"* approved for v1 (with framing labels per Plan §2.7).
  - **Paper grain:** Keep subtle static ~3% opacity 128px noise grain on `paper`, dropped under `prefers-reduced-data`.
  - **Theming:** Morning (light) default; Evening (dark) follows OS `prefers-color-scheme` with manual override (`data-theme`). Use the WCAG-verified Morning tokens (`sage #3A6450`, `ochre #7F5200`, `rule-strong #8F8472` / Evening `#766C5D`).
  - **Scrapbook:** Local-only in v1 (`idb-keyval` behind `ScrapbookStore` interface); no auth UI.
  - **Hosting:** Cloudflare Pages (`apps/web/dist`, `public/_headers`, **no** catch-all `_redirects` rule).

### Known Technical Gotchas to Avoid
- **Route Registration Order (`apps/api/src/index.ts`):** Register `/entities/random` **before** `/entities/:id`, and `/events/divergent` **before** `/events/:id/comparison` & `/events/:id/graph`.
- **Strict-TS `null` Guards (`EventComparisonResponse`):** `outletCoverage[i].leadArticle` can be `null` (when `covered: false`) and `lagMinutesFromFirst` can be `null` (when timestamps are missing) — guard both explicitly (Implementation Spec §1.4).
- **Client Downscaling:** Send files `<= 2 MB` untouched (preserves exact SHA-256 cache hits). Downscale larger files to **baseline JPEG** (`quality: 0.85`, max edge `1600px`), **never WebP**, so the backend's baseline-JPEG DC-luminance `dHash` keeps hitting perceptual cache.
- **Timezones:** Corpus fixtures mix `+00:00` and `+06:00` offsets — always format UI timestamps with `timeZone: 'Asia/Dhaka'`.
- **Workspace & Sandbox:** Root `package.json` already has `"workspaces": ["packages/*", "tools/*", "apps/*"]`. If `bun install` needs network/cache access outside the sandbox, retry only that install command with `BypassSandbox: true`. Always verify against the live local 211k DB (`data/index/index.sqlite`).

---

## 1. Work Packages & Detailed Breakdown

### WP0 — Backend Polish & New UI Endpoints (`packages/verification`, `apps/api`)
Ship the 5 confirmed backend enhancements required by `Implementation Spec §9` before building the frontend against them:

- [ ] **WP0.1 Natural-Language `overallDiffSummary` (No Raw Enum Leaks):**
  - Update `summarizeOverallDiff()` in `packages/verification/src/diff/engine.ts` to map diff flags (`mismatch_number`, `mismatch_date`, `mismatch_speaker`, `mismatch_quote`, `hedging_shift`, `missing_context`) to clean natural English & Bangla category labels (e.g., `numbers, dates, omitted context` / `সংখ্যা, তারিখ, বাদ পড়া প্রসঙ্গ`) instead of leaking `(mismatch_number)`.
- [ ] **WP0.2 Bangla Numerals (`০–৯`) in All Generated `bn` Copy:**
  - Export a small helper `toBanglaDigits(input: string): string` (e.g., in `packages/verification/src/diff/numbers.ts`) and apply it to generated numeric counts, day gaps, and outlet tallies in `explanationBn` / `summaryBn` across `numbers.ts`, `dates.ts`, `speaker.ts`, `engine.ts`, and `cross-outlet.ts`.
  - **Constraint:** Never mutate verbatim `cardSpan` / `articleSpan` strings when quoting published text.
- [ ] **WP0.3 Comma-Separated `?type=` Filter on `GET /entities/:id/relations`:**
  - Update `handleEntityRelations()` in `apps/api/src/index.ts` so `?type=holds_role,affiliated_with,part_of` splits on `,`, normalizes each canonical relation type via `normalizeRelationType()`, and queries `r.relation_type IN (?, ?, ...)`, enabling server-side Lens category filtering (`Implementation Spec §3`).
- [ ] **WP0.4 `GET /events/divergent?limit=6` ("Where outlets differ" Front-Page Rail):**
  - Add `handleDivergentEvents(url, env)` in `apps/api/src/index.ts` (registered before `/events/:id/...`).
  - Query recent multi-outlet clusters (`outlet_count >= 3`) that have `claim` rows (~35 candidates ordered by `last_seen DESC`), run `analyzeCrossOutletDifferences()` on each, keep events containing `number_difference` or `hedging_difference`, sort (`number_difference` prioritized, then `last_seen DESC`), and return up to `limit` (default `6`, max `20`) compact comparison previews (`{ events: [...] }`).
- [ ] **WP0.5 `GET /entities/random` ("Surprise me" Feature):**
  - Add `handleRandomEntity(env)` in `apps/api/src/index.ts` (registered before `/entities/:id`).
  - Select a random rich, non-hub active entity (`WHERE status = 'active' AND is_hub = 0 AND article_count BETWEEN 20 AND 1500 ORDER BY RANDOM() LIMIT 1`, with fallback to any active non-hub entity) and return its `EntityProfile` (or delegate to `handleEntityProfile()`).
- [ ] **WP0.6 Backend Tests & Live 211k Smoke Check:**
  - Add unit tests in `packages/verification/test/diff.test.ts` (assert no raw `mismatch_*` strings in `overallDiffSummary`, assert Bangla digits in `bn` summaries/explanations).
  - Add API tests in `apps/api/test/api.test.ts` (comma-separated `?type=`, `GET /events/divergent`, `GET /entities/random`).
  - Run `bunx tsc --noEmit` across workspace + `bun test` + live curl/script check against `data/index/index.sqlite`.

---

### WP1 — Frontend Scaffold, Design System & Foundations (`apps/web`)
Follow `Implementation Spec §6–§7` and `Visual Direction & UI Plan §1, §7`:

- [ ] **WP1.1 Monorepo Package Scaffold (`apps/web/`):**
  - Create `apps/web/package.json` (`@jachaikori/web`) with React 19, Vite, TypeScript (`strict: true`), Tailwind v4 (`@tailwindcss/vite`), React Router v7 (`createBrowserRouter`), TanStack Query v5, `@jachaikori/schema` (`workspace:*`), `zod`, `lucide-react`, Fontsource packages (`@fontsource-variable/fraunces`, `@fontsource-variable/newsreader`, `@fontsource-variable/hanken-grotesk`, `@fontsource/ibm-plex-mono`, `@fontsource/tiro-bangla`, `@fontsource/hind-siliguri`, `@fontsource/noto-serif-bengali`), `vite-plugin-pwa`, `workbox-precaching`, `workbox-routing`, `idb-keyval`, Vitest + Testing Library + jsdom.
  - Configure `apps/web/vite.config.ts`, `tsconfig.json`, `index.html`, and root `package.json` convenience script (`"web": "bun --filter @jachaikori/web dev"`) + update `scripts/dev.ts` if appropriate.
- [ ] **WP1.2 Visual Tokens, Typography & Paper Surface (`src/theme/`):**
  - `tokens.css`: Exact WCAG-verified Morning & Evening CSS variables (`paper`, `paper-raised`, `paper-sunk`, `ink`, `pencil`, `rule`, `rule-strong`, `sage`, `rust`, `ochre`, `violet`, 12% `color-mix(in oklab, ...)` washes, `--ease-paper`). Enforce rule: diff chips/strips never sit directly on `paper-sunk` in Morning.
  - `fonts.css`: Per-script Fontsource imports, font stacks (`--font-display`, `--font-read`, `--font-ui`, `--font-mono`), `size-adjust` tuning for Bangla/Latin x-height harmony, Bangla `line-height: 1.72` vs Latin `1.5`.
  - `paper.css`: Subtle static 128px tiled noise grain (~3% opacity on `paper`), disabled on `prefers-reduced-data`, hairline rules, double masthead rule, torn-edge clipping utility, `prefers-reduced-motion` crossfade fallbacks.
- [ ] **WP1.3 Complete Bilingual i18n & Formatting (`src/i18n/`, `src/lib/`):**
  - Populate `en.ts` and `bn.ts` directly from every key in Sections A–I of `UI String Table v0.2`.
  - Implement `tt(key, lang, vars)` with `{placeholder}` substitution and English `{n, plural, one {...} other {...}}` support.
  - Implement `useLang()` (`useSyncExternalStore`, default `'en'`, persisted in `localStorage`, synced to `document.documentElement.lang`), `formatNumber(n, lang)` (`০–৯` in `bn`), and `formatDhakaDate()` / `formatLag()` (`Asia/Dhaka` always).
  - Implement `scripts.ts` (`outletScript()`, `scriptRuns()`) and `<Verbatim>` component (never changes with UI language toggle; emits inner `<span lang>` only for opposite-script runs `>= 20` chars).
- [ ] **WP1.4 Typed API Client & Error Classifier (`src/api/`):**
  - `client.ts`: Base URL from `import.meta.env.VITE_API_BASE_URL` (defaulting to local API proxy/port), typed wrappers for all endpoints, dev-only Zod contract validation.
  - `errors.ts`: `classify()` mapping HTTP/network/timeout errors into user-facing error buckets (`badFormat`, `tooLarge`, `upstream`, `offline`, `notFound`, `unknown`) + automatic retry helpers.
  - `queries.ts`: TanStack Query key factories & query options for checks, popular checks, entities, relations, ego, activity, events, divergent events, comparison, search, and suggestions.
- [ ] **WP1.5 Shell & Core Primitives (`src/ui/`, `src/routes.tsx`):**
  - Build Masthead (double rule, Jachaikori wordmark, desktop nav, Omnibox trigger `/`, EN/বাংলা toggle, Morning/Evening/Auto theme switcher, Scrapbook link with count badge), Mobile Bottom Nav, Skip-to-content link.
  - Build core primitives: `<OutletName>` (plain ink small caps, localized), `<Chip>`, `<Clipping>`, `<Sheet>` (accessible dialog/drawer with Escape + focus management), `<StateCard>`, `<Banner>`.
  - Include a dev-accessible `/gallery` (or test page) displaying the full 7-flag vocabulary (`match`, `mismatch_number`, `mismatch_date`, `mismatch_speaker`, `mismatch_quote`, `hedging_shift`, `missing_context`) in Morning & Evening + EN & বাংলা.

---

### WP2 — Pillar A: Verification Flow, Proof Strip & Receipt (`src/diff/`, `src/features/verify/`)
Follow `Visual Direction & UI Plan §2–§3` and `Implementation Spec §1.3, §2, §4–§5`:

- [ ] **WP2.1 Diff Model & Parsers (`src/diff/`):**
  - `partition.ts`: Implement `partitionDiffs()` guaranteeing the **nothing-dropped invariant** (every diff either maps to a non-overlapping span in the card sentence OR lands cleanly in the non-span Rack; overlapping spans handled deterministically without silent drops).
  - `amount.ts`: Implement `parseAmount()` for drawing the **Lineup** log-scale numeric ruler (Bangla & English digits + South Asian `হাজার/লাখ/কোটি` & `K/M/B` scales; graceful fallback to chips when unparseable).
- [ ] **WP2.2 Proof Strip, Rack, Receipt & Lineup Components (`src/diff/`):**
  - **Proof Strip (`ProofStrip.tsx`):** Renders card sentence once; unchanged words stay still; differing spans carry distinct hue + underline style (`solid` / `dashed` / `wavy` / `dotted` / `double` / `ghost`) + glyph; native `<input type="range">` scrubber + *"As on the card" / "As reported"* segmented toggle rolls only differing spans.
  - **Non-span Rack (`Rack.tsx`):** Renders certainty gauge (3 notches: *cautious → states → certain*) for `hedging_shift` and dotted ghost chips (*"not on the card: ..."*) for `missing_context` / non-span diffs.
  - **Receipt (`Receipt.tsx`):** Expandable source clipping in ink showing verbatim snippet with highlighted `articleSpan`, outlet nameplate, Dhaka-formatted date, external article link, *"Checked by rule"* vs. *"Judged by model"* badge, bilingual explanation, type-specific inserts (**Lineup** log-scale ruler for numbers, **Date gap** axis bar for dates, **Certainty gauge**, **Ghost chip**), and confidence tucked under *"Details"*.
- [ ] **WP2.3 Capture Zone, Press Run & Check Result Page (`src/features/verify/`):**
  - `Capture.tsx`: Drag-and-drop / file picker / clipboard paste image dropzone + *"Paste text instead"* mode, `downscaleIfLarge()` baseline JPEG conversion (`> 2 MB`, max edge `1600px`), visible `cap.notice` privacy copy, client-side format/size guards.
  - `PressRun.tsx`: Calm editorial progress state (`400ms / 2.2s / 6s` staged steps with `aria-live="polite"`, retry indicator on transient upstream errors).
  - `CheckPage.tsx` (`/check/:id`): Desktop 2-column broadsheet (sticky Exhibit rail on left + matched source clippings with Glance chips, Proof Strips, and Receipts on right) & single-column mobile layout; Exhibit shows uploaded card image (`/checks/:id/image`), extracted OCR/claims/entities (clickable to open Entity Peek), cache-hit notice (`exact`/`perceptual`), copyable link, Scrapbook pin, collapsible `pipelineTrace` drawer, and clean unmatched empty state with *"Search the archive"* escape hatch.
  - `PopularRail.tsx`: Renders `GET /checks/popular` with empty state when no checks exist yet.

---

### WP3 — Pillar B: Entity Knowledge Graph & Exploration Layer (`src/features/explore/`, `src/features/entities/`)
Follow `Visual Direction & UI Plan §5` and `Implementation Spec §3–§4`:

- [ ] **WP3.1 Exploration Primitives (`src/features/explore/`):**
  - **Lens (`useLens.ts`, `LensBar.tsx`):** URL-synchronized filter state (`?q=&type=&from=&to=&dir=&with=`) mapping the 5 user-friendly relation categories to server-side comma-separated `?type=` queries on `/entities/:id/relations`, plus date window, direction, and co-mention (`with=`) filters.
  - **Peek Sheets (`PeekProvider.tsx`, `EntityPeek.tsx`, `EventPeek.tsx`):** Lightweight slide-over/bottom sheets triggered when clicking an entity chip or event link anywhere in the app — shows tagline, key stats, top relations/coverage, and *"Open full page"* without losing current scroll position.
  - **Reading Trail (`TrailBar.tsx`):** Compact breadcrumb strip tracking visited checks, entities, and events with copy-as-link and clear actions.
- [ ] **WP3.2 Entities Directory & Entity Dossier (`src/features/entities/`):**
  - `Directory.tsx` (`/entities`): Filterable by entity type (`person`, `org`, `party`, `location`, `role`, `institution`, `policy`), search box, sortable by mentions/relations, plus **"Surprise me"** button wired to `GET /entities/random`.
  - `Dossier.tsx` (`/entities/:id`): Displays canonical EN/বাংলা name, type badge, bilingual corpus-grounded description with clickable article citations, aliases list, `roleTerms` tenure timeline, merge-redirect banner when `redirectedFrom` is present, Scrapbook pin, and Lens bar.
  - Sub-panels: `Relations.tsx` (grouped/filterable directional 17-type relations with evidence snippets & article links), `Activity.tsx` (SVG time-series bar/sparkline of monthly coverage volume), `Associated.tsx` (`/ego` ranked co-mentioned & directly linked entities with click-to-peek and click-to-filter `with=`), `Articles.tsx` (paginated newspaper-index mentions with `with=` co-mention filtering), and `Orbit.tsx` (lightweight focused SVG ego-orbit visualization — lazy-loaded, no heavy graph runtime).

---

### WP4 — Pillar C & D: Events, Coverage Comparison, Search & Front Page (`src/features/events/`, `src/features/search/`)
Follow `Visual Direction & UI Plan §4, §6` and `Implementation Spec §1.4, §4`:

- [ ] **WP4.1 Front Page (`/`):**
  - Editorial broadsheet home page combining:
    1. Hero **Capture Zone** (image upload / text paste).
    2. **"Where outlets differ"** rail (`GET /events/divergent?limit=6`) showcasing live cross-outlet numeric/hedging divergences.
    3. **"Most checked"** rail (`GET /checks/popular`).
    4. **"In the news"** entity strip (`GET /entities?sort=articles&limit=8`) & recent multi-outlet events (`GET /events?minOutlets=3&limit=6`).
- [ ] **WP4.2 Events Index & Coverage Comparison (`src/features/events/`):**
  - `EventList.tsx` (`/events`): Filterable multi-outlet event clusters with outlet count badges, date range, and *"Compare coverage"* links.
  - `Lanes.tsx`: 8-outlet linear timeline (all 8 accredited outlets shown; covered outlets plot first-published position `+0m`, `+90m`, etc. with strict `null` guards on `leadArticle` and `lagMinutesFromFirst`; uncovered outlets render neutral *"No matching article in our index"*). Tapping an outlet filters the claims below.
  - `EventPage.tsx` (`/events/:id`): Event header, merge-redirect banner, `Lanes`, `crossOutletDifferences[]` cards (consensus / number difference / hedging difference), per-outlet structured claims tabs (`GET /events/:id/comparison`), and expandable *"View entity connections"* panel (`GET /events/:id/graph`).
- [ ] **WP4.3 Global Omnibox & Search Page (`src/features/search/`):**
  - `Omnibox.tsx`: Accessible `/` shortcut modal/popover searching `GET /entities/suggest` and routing to `/search?q=...`, with keyboard arrow navigation and Escape dismiss.
  - `SearchPage.tsx` (`/search`): Newspaper-index result list (`GET /search`), *"Also searched"* expanded-query pills, outlet & date-range filters (sidebar on desktop, sheet on mobile), highlighted matching snippets in `<Verbatim>`, and *"Compare coverage · N outlets"* links when `clusterId` exists.

---

### WP5 — PWA Share Target, Scrapbook, Cloudflare Pages & Verification Gate
Follow `Implementation Spec §6.2–§6.4, §8`:

- [ ] **WP5.1 Local-Only Scrapbook (`src/features/scrapbook/`):**
  - Implement `ScrapbookStore` interface backed by `idb-keyval` (`createIdbScrapbook()`), React hook for live pin state, pin/unpin buttons on checks, entities, and events, and `/scrapbook` page with clear-all and empty state.
- [ ] **WP5.2 PWA & Android Share Target (`src/sw.ts`, `vite.config.ts`):**
  - Configure `vite-plugin-pwa` (`injectManifest`) with web app manifest (`#F5EFE3` theme/background, icons, `share_target` `POST /share-target`).
  - Implement `src/sw.ts` storing shared image/text in Cache Storage (`share-inbox`) and redirecting `303` to `/?shared=1`, plus client pickup in `Capture.tsx` that automatically loads the shared image/text and clears the inbox.
- [ ] **WP5.3 Cloudflare Pages Config (`apps/web/public/_headers`):**
  - Add `public/_headers` (immutable `/assets/*`, `no-cache` for `/sw.js` & `/manifest.webmanifest`, security headers), SVG favicon & PWA icons. Confirm **no** catch-all `_redirects` file.
- [ ] **WP5.4 Automated Tests, Bundle & Live 211k Verification:**
  - **Vitest Unit Tests (`apps/web/src/**/__tests__`):**
    1. `partitionDiffs` (nothing-dropped invariant, overlapping spans, empty/match cases).
    2. `parseAmount` (Bangla/English numbers, South Asian units, fallback on non-numeric strings).
    3. `scriptRuns` & `<Verbatim>` (script switching, 20-char threshold, neutral punctuation).
    4. `lensQuery` (category-to-comma-separated `type=` mapping, URL round-trip).
    5. `classify` error mapper.
    6. **i18n parity test:** `en.ts` and `bn.ts` have identical key sets, matching `{placeholders}`, and zero empty values.
    7. **WCAG contrast test:** Parses `tokens.css` and asserts `>= 4.5:1` for all text/wash pairs and `>= 3:1` for `rule-strong` & underlines in both Morning and Evening themes.
  - **Contract & Build Checks:**
    - `bun run typecheck` + `bunx tsc --noEmit` across `apps/web`, `apps/api`, `packages/verification` (`0` errors).
    - `bun test` (backend suites) + `bun --filter @jachaikori/web test` (frontend Vitest suites) all pass.
    - `bun --filter @jachaikori/web build` succeeds cleanly; check initial route gzipped JS budget (~150 KB target).
    - Live smoke check against running local API (`data/index/index.sqlite`): verify `/`, `/check/:id`, `/entities`, `/entities/:id`, `/events`, `/events/:id`, `/search`, `/scrapbook`, EN ↔ বাংলা toggle, Morning ↔ Evening theme toggle.
  - **Sprint 8 Write-Up:** Update `log.md` throughout and write `docs/sprints/8. Web UI Design/blog.md` once all checks pass.

---

## 2. Definition of Done
1. All 5 WP0 backend polish items (`overallDiffSummary` clean copy, Bangla digits in `bn` copy, comma-separated `?type=`, `GET /events/divergent`, `GET /entities/random`) are implemented, tested, and verified on the 211k DB.
2. `apps/web` implements all four product pillars (Verify + Proof Strip/Receipt/Lineup, Entity Dossier + Lens/Peeks/Trail/Orbit, Event Lanes + Cross-Outlet Comparison, Omnibox + Hybrid Search) plus Local Scrapbook and PWA Share Target in both **English (default)** and **বাংলা**, and both **Morning** and **Evening** themes.
3. Zero editorial neutrality violations (no verdicts, no per-outlet colors, verbatim outlet text untouched).
4. All backend (`bun test`), frontend (`vitest` including i18n parity & WCAG contrast), strict `tsc --noEmit`, and production Vite build (`apps/web/dist`) checks pass with 0 errors.
5. `log.md` and `blog.md` document the implementation, metrics, bundle size, and live verification results.
