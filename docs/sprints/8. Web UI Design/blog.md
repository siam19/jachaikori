# Sprint 8: Building "The Morning Edition" — A Quiet Reading Room for News Verification (`apps/web`)

After seven sprints of crawling 211,387 articles across eight accredited Bangladeshi outlets, building a 3,383-entity bilingual knowledge graph, and shipping a hybrid claim-level diff engine, Jachaikori finally has a face: **`apps/web` — "The Morning Edition"**.

Instead of a dashboard full of red "FAKE" badges and green "VERIFIED" checkmarks, we built a calm, broadsheet-inspired reading room guided by one foundational design rule:

> **Ink is their words, pencil is ours.**

Every headline, article snippet, evidence quote, and card OCR line stays verbatim in its original published script (`<Verbatim>`) set in warm editorial serif ink (`Newsreader` / `Noto Serif Bengali`). Every Jachaikori explanation, label, and diff mark sits in softer sans-serif pencil (`Hanken Grotesk` / `Hind Siliguri`). Outlet nameplates are plain ink small caps — never colour-coded — because colour-coding outlets reads like a credibility score.

---

## 1. Finishing the Backend Polish First (WP0)

Before scaffolding a single React component, we shipped five targeted improvements across `packages/verification` and `apps/api`:

1. **Human-readable `overallDiffSummary`:** Eliminated raw enum leaks like `(mismatch_number)` in favour of natural English and Bangla category lists (`numbers, omitted context` / `সংখ্যা, বাদ পড়া প্রসঙ্গ`).
2. **Bangla numerals (`০–৯`) in generated `bn` copy:** Exported `toBanglaDigits()` and localized generated day gaps, dates, and outlet tallies (`৪টি সংবাদমাধ্যম একই সংখ্যা (২৬%) উল্লেখ করেছে।`) while keeping verbatim `cardSpan` / `articleSpan` quotes untouched.
3. **Server-side Lens category filtering:** Updated `GET /entities/:id/relations` to accept comma-separated `?type=` lists (`holds_role,affiliated_with,part_of,...`) normalized through `normalizeRelationType()`.
4. **`GET /events/divergent?limit=6`:** Powers the front-page *"Where outlets differ"* rail by scanning recent multi-outlet clusters with extracted claims, prioritizing numeric divergences alongside hedging shifts.
5. **`GET /entities/random`:** Powers *"Surprise me"* in the Entity Directory by surfacing a random active, non-hub entity (`20–1,500` articles) from the live 211k corpus.

---

## 2. The Signature Diff Interaction: Proof Strip, Rack & Lineup

Traditional side-by-side diffs break down on 360px Bangladeshi smartphones: Bangla lines wrap to four words and readers ping-pong left and right hunting for what changed.

Our **Proof Strip** (`src/diff/ProofStrip.tsx`) prints the card's sentence **once**. Unchanged words stay completely still. Differing spans sit inside an `inline-grid` `.swap` cell (preventing layout reflow) marked by hue, underline pattern (`solid`, `dashed`, `wavy`, `dotted`, `double`), and a circled numeral (`① ② ③`). Dragging the native `<input type="range">` scrubber — or tapping *"As on the card"* / *"As reported"* — rolls **only the differing spans**, clearly framed as *"Card wording, with the outlet's figure"*.

Directly beneath it sits the **Rack** (`src/diff/Rack.tsx`), driven by the exact same `--t` CSS custom property so non-span diffs (`missing_context` ghost chips, `hedging_shift` 3-notch certainty gauges, date-gap bars) animate in lockstep. Our `partitionDiffs()` algorithm enforces the **nothing-dropped invariant**: every non-`match` diff either rolls inline or appears in the Rack, with overlapping spans demoted cleanly rather than discarded.

When numeric mismatches appear across sources, **Lineup** (`src/diff/Lineup.tsx`) plots the card's figure as a hollow ring above a log-scale ruler and each outlet's reported figure as a filled dot below — answering *"where does this figure sit?"* without ever printing a verdict.

---

## 3. Turning a 211k Corpus into an Explorable Reading Room

- **Exploration Layer (`Lens`, `Peeks`, `Trail`):** Tapping any entity or event opens a stackable slide-over **Peek** drawer without losing scroll position. On an Entity Dossier, one sticky URL-synced **Lens** bar drives Relationships (server-side 5-category filter), Closely Associated entities (list + lazy-loaded 0.84 KB SVG **Orbit** view), a brushable full-series **Activity** bar chart with single-day headline peeks, and paginated **Articles**. A floating `sessionStorage` **Reading Trail** lets readers jump back or copy their whole exploration as a link.
- **8-Outlet Event Lanes (`src/features/events/Lanes.tsx`):** Combines coverage matrix and "who published first?" timeline into eight linear lanes with strict `null` guards for missing timestamps (*"Time unavailable"*) and neutral empty lanes (*"No matching article in our index"*).
- **Mobile Reach & Privacy:** Large uploads (`> 2 MB`) are downscaled client-side to **baseline JPEG** (`1600px`, quality `0.85`) so the backend's DC-luminance perceptual `dHash` keeps hitting cache, while `<= 2 MB` images upload untouched to preserve exact SHA-256 hits. An installed PWA exposes an Android **Share Target** (`POST /share-target` → Cache Storage `share-inbox` → `/?shared=1`), and a local-only IndexedDB **Scrapbook** sits behind a clean `ScrapbookStore` interface with zero auth friction.

---

## 4. Verification & Production Budget

| Check | Result |
| :--- | :--- |
| TypeScript strict checks (`apps/web`, `apps/api`, `packages/verification`, root) | **0 errors** |
| Workspace test suite (`bun test`) | **108 pass / 0 fail** (21 files) |
| Frontend Vitest suite (`@jachaikori/web`) | **7 files / 19 tests pass** (incl. i18n parity & WCAG 2.x contrast) |
| Initial route gzipped JS (`apps/web/dist`) | **141.33 KB** (under 150 KB target; lazy `Orbit` is 0.84 KB) |
| WCAG 2.x contrast (Morning & Evening + 12% oklab washes + `rule-strong`) | **Verified automatically in CI test (`>= 4.5:1` text, `>= 3:1` borders)** |
| Cloudflare Pages deployment readiness | `dist/_headers`, `dist/sw.js`, `dist/manifest.webmanifest`; no catch-all `_redirects` |

Next up: connecting the built `apps/web/dist` bundle to Cloudflare Pages with `VITE_API_BASE_URL` pointing to the deployed Jachaikori Worker API.
