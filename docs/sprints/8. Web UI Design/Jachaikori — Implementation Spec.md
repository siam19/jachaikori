# Jachaikori — Implementation Spec

*v0.2 · companion to UI Plan · 24 Nov 2026 (confirmations folded in)*

This spec covers what the plan left open: corrected contracts, how mixed diffs render, how the lens maps to API calls, desktop layouts, error and edge states, the stack and Cloudflare setup, and measured contrast. All UI strings live in the separate **UI String Table** doc for native-speaker review.

## 1. Contract corrections (applied)

### 1.1 Schema type names

v0.1 used `ClaimDiff`; the exported name is **`ClaimDiffItem`**. Import list used throughout the web app:

```ts
import type {
  ClaimDiffItem, VerificationCheck, VerificationSourceMatch, CardExtraction,
  PopularCheckSummary, EntityProfile, EventComparisonResponse, StoredArticleClaim,
} from '@jachaikori/schema'
```

The matching Zod schemas run in dev and in CI contract tests (to catch drift), not in production bundles.

### 1.2 Language of verbatim text

Article and source payloads carry no language field, so it is derived from the outlet, with a Unicode check for mixed or quoted text. Card text uses `extraction.language`.

```ts
const EN_OUTLETS = new Set(['daily-star', 'business-standard', 'dhaka-tribune'])
export type Script = 'bn' | 'en'
export const outletScript = (outlet?: string): Script => (EN_OUTLETS.has(outlet ?? '') ? 'en' : 'bn')

const isBangla = (ch: string) => { const c = ch.codePointAt(0)!; return c >= 0x0980 && c <= 0x09ff }
const NEUTRAL = '0123456789.,;:!?()-–—%/’“”'
const isNeutral = (ch: string) => ch.trim() === '' || NEUTRAL.includes(ch) || ch.charCodeAt(0) === 34

/** Split mixed text into runs so each run gets the right lang (and font). */
export function scriptRuns(text: string, base: Script) {
  const runs: { text: string; lang: Script }[] = []
  for (const ch of text) {
    const last = runs.at(-1)
    const lang: Script = isBangla(ch) ? 'bn' : isNeutral(ch) ? (last?.lang ?? base) : 'en'
    if (last && last.lang === lang) last.text += ch
    else runs.push({ text: ch, lang })
  }
  return runs
}
```

`<Verbatim text outlet?|base>` sets `lang` to the base script (outlet-derived, or `extraction.language` for card text). It only emits inner `<span lang>` wrappers for runs of the *other* script that are 20 or more characters long (quoted sentences), so one English proper noun inside a Bangla sentence does not fragment the markup.

### 1.3 Client downscale: baseline JPEG

Files of 2 MB or less are sent untouched (keeps the exact-hash cache). Larger files are redrawn to a canvas and exported as **baseline JPEG at quality 0.85**, never WebP, so the backend's baseline-JPEG DC-luminance dHash keeps matching across recompression.

```ts
export async function downscaleIfLarge(file: File, maxBytes = 2 * 1024 * 1024, maxEdge = 1600): Promise<File> {
  if (file.size <= maxBytes) return file
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // flatten PNG transparency
  ctx.drawImage(bmp, 0, 0, w, h)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85))
  return new File([blob], file.name.replace(/[.][^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}
```

Notes: browsers write baseline (non-progressive) JPEG from canvas by default; a Playwright check in CI uploads a known fixture and asserts a `cacheHit: 'perceptual'` response against the local API. An HTMLCanvasElement is used instead of OffscreenCanvas for wider Safari support. iPhone photos: keep the picker's `accept` to `image/jpeg,image/png,image/webp` so iOS converts HEIC on selection.

### 1.4 Event lanes from `outletCoverage`

`cmp.timeline` can hold several articles per outlet (breaking plus update), so a Map keyed by outlet would overwrite the earliest. Lanes are driven by **`cmp.outletCoverage`** (field names confirmed against `EventComparisonResponseSchema` in `@jachaikori/schema`); the timeline only supplies secondary ticks (guarding `leadArticle` and `lagMinutesFromFirst !== null` for strict TypeScript).

```tsx
function Lanes({ cmp, lang }: { cmp: EventComparisonResponse; lang: Lang }) {
  const maxLag = Math.max(
    1,
    ...cmp.outletCoverage.map(c => c.lagMinutesFromFirst ?? 0),
    ...cmp.timeline.map(t => t.lagMinutesFromFirst ?? 0)
  )
  const pct = (m: number) => `${(m / maxLag) * 100}%`
  return (
    <ol className='lanes'>
      {OUTLETS.map(o => {
        const c = cmp.outletCoverage.find(x => x.outlet === o)
        const extra = cmp.timeline
          .filter(t => t.outlet === o && t.lagMinutesFromFirst !== null)
          .slice(1) // later articles with timestamps
        if (!c || !c.covered || !c.leadArticle) {
          return (
            <li key={o} className='lane lane--empty'>
              <OutletName id={o} />
              <span className='pencil'>{tt('lanes.none', lang)}</span>
            </li>
          )
        }
        return (
          <li key={o} className='lane'>
            <OutletName id={o} />
            {c.lagMinutesFromFirst === null
              ? <a className='pill' href={c.leadArticle.canonicalUrl}>{tt('lanes.noTime', lang)}</a>
              : <a className='dot' href={c.leadArticle.canonicalUrl}
                   style={{ insetInlineStart: pct(c.lagMinutesFromFirst) }}>+{c.lagMinutesFromFirst}m</a>}
            {extra.map((t, i) => (
              <i key={i} className='tick' title={t.title}
                 style={{ insetInlineStart: pct(t.lagMinutesFromFirst!) }} />
            ))}
            {c.articleCount > 1 && <span className='more pencil'>{tt('lanes.more', lang, { n: c.articleCount - 1 })}</span>}
          </li>
        )
      })}
    </ol>
  )
}
```

A `null` lag never draws a dot at +0, which would falsely suggest “first”. It shows a “Time unavailable” pill at the lane start instead.

## 2. Mixed flags in the Proof Strip: the “Strip + Rack”

One source often returns an inline-matchable span (`mismatch_number`) *and* flags with no substring in the headline (`missing_context`, `hedging_shift`, a synthetic date span such as a “breaking / today” framing). Rule: **nothing is dropped.** Every non-`match` diff is either rolled inline in the **Strip** or listed as a row in the **Rack** directly beneath it, and both are driven by the same scrubber.

```text
 CARD WORDING, WITH THE OUTLET'S FIGURE        As on card --o-- As reported
 ...card sentence in ink, with the differing span marked [1]...
 +---------------------------------------------------------------------+
 | 2  Context omitted    not on the card:  [ ghost chip fades in ]     |
 | 3  Certainty shifted  cautious |--o--------->--| certain            |
 | 4  Date framing       card: "today"  <->  article: 18 Nov           |
 +---------------------------------------------------------------------+
   each row: marker . flag chip . insert . one-line pencil explanation
```

```ts
const INLINE = new Set(['mismatch_number', 'mismatch_date', 'mismatch_speaker', 'mismatch_quote'])
const sev = (d: ClaimDiffItem) => (d.severity === 'major' ? 2 : 1)

export function partitionDiffs(headline: string, diffs: ClaimDiffItem[]) {
  const real = diffs.filter(d => d.flag !== 'match')
  const cands = real.map(d => ({
    d, at: d.cardSpan && d.articleSpan && INLINE.has(d.flag) ? headline.indexOf(d.cardSpan) : -1,
  }))
  const rack: ClaimDiffItem[] = cands.filter(c => c.at < 0).map(c => c.d)
  const inline: typeof cands = []
  let end = 0
  for (const c of cands.filter(c => c.at >= 0).sort((a, b) => a.at - b.at)) {
    if (c.at < end) { rack.push(c.d); continue } // overlap: demote to the rack, never drop
    inline.push(c); end = c.at + c.d.cardSpan!.length
  }
  rack.sort((a, b) => sev(b) - sev(a))
  if (import.meta.env.DEV) console.assert(inline.length + rack.length === real.length, 'diff dropped')
  return { inline, rack }
}
```

| Rack insert | At t = 0 (as on card) | At t = 1 (as reported) |
| :-- | :-- | :-- |
| `missing_context` ghost chip | dotted empty outline (space reserved, no layout jump) | chip fills with the article’s word |
| `hedging_shift` gauge | hollow ring at the card’s certainty notch | filled dot slides to the article’s notch |
| Date gap (both spans parse as dates) | pointer on card date | pointer slides to article date; “240 days apart” |
| Date framing (spans don’t parse) | card phrase | phrase rolls to article date text (same `.swap` roll) |
| Non-substring number, speaker or quote | card span | span rolls to article span (same `.swap` roll) |

- **Numbered markers** (① ② ③) tie each inline mark and each rack row together, in reading order, so the pairing survives screen readers and colour-blindness.
- The `--t` custom property sits on the `.proof` root, so the Strip and Rack move together from one scrubber. Rack insets read it, e.g. `left: calc((var(--a) + (var(--b) - var(--a)) * var(--t)) * 1%)`.
- **`match` diffs** (aligned details; spans are returned) never appear in the Strip. They show as a quiet “Also matched” row in the Receipt and feed the tally and the Lineup.
- If nothing is inline, the Strip falls back to showing `extraction.headline` with no marks, and the Rack carries everything.

## 3. Lens to API mapping

| Panel | Endpoint | Server-queried | Client-side |
| :-- | :-- | :-- | :-- |
| Relationships | `/entities/:id/relations` | `from`, `to`, `includeHubs`, `source`, `type` (supports comma-separated category lists!) | `with` → filter by `otherEntity.id` |
| Closely associated | `/entities/:id/ego` | `from`, `to`, `includeHubs` | `with` only highlights the neighbour |
| Activity chart | `/entities/:id/activity` | none: always the full series | brush is an overlay; it sets the lens but does not refetch |
| Articles | `/entities/:id/articles` | `with`, `role`, `from`, `to`, `sort`, `limit`, `offset` | none |
| Day-bar peek | `/entities/:id/articles?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=5` | that single day | none |
| Event: People in this story | `/events/:id/graph` (`nodes[]`, `includeHubs=false`) | none | drop hub nodes; rank by article count |
| Event: Also in the news that day | `/events?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=6` | the event’s `firstSeen` day (Asia/Dhaka) | drop the current event id |

The activity chart ignores the date lens on purpose: if it refetched, bars outside the window would vanish and the brush could never be widened again. The category filter on relationships sends comma-separated canonical types (e.g. `?type=holds_role,affiliated_with,part_of,appointed_or_elected,resigned_or_removed`) directly to the backend so each category returns a full ranked page server-side.

```ts
export type Lens = { from?: string; to?: string; with?: string; role?: string; sort?: 'recent' | 'salience'; hubs: boolean }

export const lensQuery = {
  articles:  (l: Lens) => ({ with: l.with, role: l.role, from: l.from, to: l.to, sort: l.sort }),
  relations: (l: Lens) => ({ from: l.from, to: l.to, includeHubs: l.hubs }),
  ego:       (l: Lens) => ({ from: l.from, to: l.to, includeHubs: l.hubs }),
  activity:  () => ({}), // full series; the lens is drawn on top
}

export const withNeighbour = <R extends { otherEntity: { id: string } }>(rows: R[], l: Lens) =>
  l.with ? rows.filter(r => r.otherEntity.id === l.with) : rows

// query keys include only the params the panel actually sends:
// ['relations', id, lensQuery.relations(lens)]  (so brushing never refetches the chart)
```

## 4. Desktop layouts (12 columns, max 1200px)

All four share one masthead (wordmark, four-item nav, omnibox hint, EN | BN, theme) and a double rule beneath it. Column spans are noted in each frame.

```text
FRONT PAGE
+----------------------------------------------------------------------+
| Jachaikori | Check  Events  People  Search   [ / search ]  EN|BN  Mode |
|======================================================================|
| Tuesday, 24 November 2026                                            |
+---------------------------------------+------------------------------+
| cols 1-7                              | cols 9-12                    |
| Compare the card to the record.       | MOST CHECKED THIS WEEK       |
| +- - - - - - - - - - - - - - - - - +  | 1  headline ...  [status]    |
| |  Drop a photo card, or paste it  |  | 2  headline ...  [status]    |
| |  [Photo]   [Paste]   [Text]      |  | 3  headline ...  [status]    |
| +- - - - - - - - - - - - - - - - - +  | See all                      |
+---------------------------------------+------------------------------+
| WHERE OUTLETS DIFFER (cols 1-12): three clippings across             |
| [event . 26% vs 13%]   [event . ...]   [event . ...]                 |
+-------------------------------+--------------------------------------+
| IN THE NEWS (cols 1-6)        | RECENT MULTI-OUTLET EVENTS (cols 7-12)|
| people chips + taglines       | label . 5 of 8 outlets . time         |
+-------------------------------+--------------------------------------+

VERIFY RESULT
+----------------------------------------------------------------------+
| masthead                                                             |
+-----------------------+----------------------------------------------+
| cols 1-4  (sticky)    | cols 5-12                                    |
| EXHIBIT               | WHAT WE FOUND                                |
| [card image]          | sentence + tally dots       [Copy link][Share]|
| Headline (ink)        |----------------------------------------------|
| Speaker               | LINEUP  (log ruler across the column)        |
| Numbers   [chips]     |----------------------------------------------|
| Dates     [chips]     | SOURCES        [ All | Only differences ]   |
| Claimed publisher     | +------------------------------------------+ |
| People    [chip][chip]| | Outlet . date . original headline (link) | |
|                       | | Proof Strip + scrubber                   | |
| Pipeline trace        | | Rack: 2 ...  3 ...                       | |
| (collapsed)           | | v Receipt                                | |
+-----------------------+----------------------------------------------+

ENTITY DOSSIER
+----------------------------------------------------------------------+
| TYPE  Name EN / Name BN   tagline                  [Pin] [Share]     |
| Bio with drop cap (cols 1-8)        | Stats (cols 9-12)              |
| source citations . aliases          | articles . events . relations  |
+----------------------------------------------------------------------+
| LENS: [Nov 2026 x] [with: ... x] [hubs: off]            (sticky)     |
+--------------------+-------------------------+-----------------------+
| cols 1-3 (sticky)  | cols 4-9                | cols 10-12            |
| On this page       | RELATIONSHIPS           | ACTIVITY              |
|  Relationships     | [category segmented]    | bars + brush          |
|  Activity          | sentence rows           |-----------------------|
|  Associated        |  v clippings fan out    | CLOSELY ASSOCIATED    |
|  Articles          |-------------------------| list  |  orbit        |
| Tenure ribbon      | ARTICLES  sort . role   |                       |
+--------------------+-------------------------+-----------------------+

EVENT COMPARISON
+----------------------------------------------------------------------+
| EVENT  label (display)     5 of 8 outlets . 5 articles . 2 Jul 2026  |
+----------------------------------------------------------------------+
| LANES (cols 1-12)           +0m ............................ +226m   |
| Outlet 1   ----o------------                                         |
| Outlet 2   -----------o-----   (empty lanes are dashed)              |
+-------------------------+--------------------------------------------+
| cols 1-4                | cols 5-12                                  |
| WHERE OUTLETS AGREE     | CLAIMS BY OUTLET   [ tabs ]                |
| WHERE THEY DIFFER       | numbers . dates . certainty badge . snippet|
| certainty differences   | optional: entity graph toggle              |
+-------------------------+--------------------------------------------+
| KEEP READING:  People in this story | Also in the news that day      |
+----------------------------------------------------------------------+
```

Breakpoints: below 768px everything stacks to a single column with the bottom nav; 768 to 1100px uses 8 columns and the sticky rails become collapsible sections.

## 5. Edge, error & redirect states

Principles: errors are calm and blame-free. They use an ink-outlined `StateCard` with a pencil glyph and **never rust**, because rust means “differs”. Each state has one primary action. Copy keys are in the string table.

| Trigger | Detected by | What the user sees | Primary action |
| :-- | :-- | :-- | :-- |
| Unsupported type (400) | client pre-check, API 400 | “Unsupported format” card in the capture area | Choose another image (text tab stays visible) |
| Over 8 MB (413) | still over 8 MB after downscale, or API 413 | “Image too large” | Try a screenshot instead |
| Upstream VLM failure or timeout (502) | API 502, or 30s abort | “The reading service didn’t respond. That is on our side, not your card.” | Try again |
| Offline | fetch `TypeError` | “You appear to be offline” | Retry; the image stays in memory |
| Check not found (404) | `GET /checks/:id` | “This check couldn’t be found” | Check a new card |
| `status: 'non_claim'` | response | `emptyStateNotice[lang]` beside the Exhibit (card image plus what was read) | Try the text tab |
| `status: 'no_coverage'` | response | `emptyStateNotice[lang]` plus a dotted empty clipping | Search the archive (query prefilled from the headline) |
| `insufficient_claims` | `overallDiffStatus` | pill “Not enough checkable details”, sources still listed | none |
| `checks: []` on popular | `GET /checks/popular` | cold-start card “Nothing checked yet” plus three dashed ghost clippings and an arrow to the dropzone | Add a photo card |
| Empty panel | relations, articles, ego or events empty | one pencil line; “Clear filters” when a lens is active | Clear filters |
| Search with 0 hits | `/search` | “No results for …”, alias chips, entity autocomplete suggestions | Clear filters |
| Followed redirect | `redirectedFrom` | slim dismissible banner (below) | none |

```ts
export class ApiError extends Error {
  constructor(public status: number, public body?: unknown) { super(String(status)) }
}
export type Failure = 'bad_format' | 'too_large' | 'upstream' | 'offline' | 'not_found' | 'unknown'

export function classify(e: unknown): Failure {
  if (e instanceof ApiError) {
    if (e.status === 400) return 'bad_format'
    if (e.status === 413) return 'too_large'
    if (e.status === 404) return 'not_found'
    if (e.status >= 500) return 'upstream' // includes 502
  }
  if (e instanceof DOMException && e.name === 'AbortError') return 'upstream'
  if (e instanceof TypeError) return 'offline' // fetch network failure
  return 'unknown'
}

// verify mutation: retry only upstream failures, twice, never with bypassCache
useMutation({
  mutationFn: verify,
  retry: (n, e) => classify(e) === 'upstream' && n < 2,
  retryDelay: n => 2000 * (n + 1),
})
```

The UI shows “Trying again (1/3)…” during retries. The 8 MB check runs *after* downscale, so most 413s never reach the user.

**Redirect banner.** `/entities/:id` and `/events/:id` follow merges server-side and return `redirectedFrom`. The page heals the URL and keeps a one-time notice:

```tsx
const loc = useLocation(), navigate = useNavigate()
useEffect(() => {
  if (data.redirectedFrom && data.redirectedFrom !== id)
    navigate(`/entities/${data.id}${loc.search}`, { replace: true, state: { redirectedFrom: data.redirectedFrom } })
}, [data.id])
const notice = loc.state?.redirectedFrom && <Banner onDismiss={clearState}>{tt('redirect.entity', lang, { name })}</Banner>
```

## 6. Stack, folders and Cloudflare Pages

### 6.1 Dependencies (`apps/web`)

| Concern | Choice | Notes |
| :-- | :-- | :-- |
| UI | React 19 + TypeScript | strict mode |
| Build | Vite + `@vitejs/plugin-react` |  |
| Styling | Tailwind v4 via `@tailwindcss/vite` | tokens live in CSS `@theme`; no `tailwind.config.js` |
| Routing | React Router v7, declarative `createBrowserRouter` | framework mode not needed; peeks use the background-location pattern |
| Server state | TanStack Query v5 |  |
| Types | `@jachaikori/schema` (`workspace:*`) + `zod` |  |
| Icons | `lucide-react` | stroke width 1.5, tree-shaken |
| Fonts | Fontsource: `@fontsource-variable/fraunces`, `@fontsource-variable/newsreader`, `@fontsource-variable/hanken-grotesk`, `@fontsource/ibm-plex-mono`, `@fontsource/tiro-bangla`, `@fontsource/hind-siliguri`, `@fontsource/noto-serif-bengali` | per-script subsets; use static weights for any Bengali face without a variable build |
| PWA | `vite-plugin-pwa` (injectManifest) + `workbox-precaching`, `workbox-routing` |  |
| Local storage | `idb-keyval` | scrapbook, behind an interface |
| Dates, numbers | native `Intl` | no dayjs or moment |
| Tests | Vitest, Testing Library, Playwright |  |

Install current majors at scaffold time and let the lockfile pin them; I have not verified today’s latest versions.

### 6.2 Folder structure

```text
apps/web/
  index.html
  vite.config.ts
  public/            _headers, icons/, favicon.svg
  src/
    main.tsx  routes.tsx  sw.ts
    api/             client.ts  queries.ts  errors.ts
    i18n/            en.ts  bn.ts  tt.ts  format.ts   (generated from the string table)
    theme/           tokens.css  fonts.css  paper.css
    ui/              Chip  Clipping  Verbatim  Sheet  StateCard  Banner
    diff/            ProofStrip  Rack  Receipt  Lineup  partition.ts  amount.ts
    features/
      verify/        Capture  PressRun  CheckPage  PopularRail
      entities/      Directory  Dossier  Relations  Activity  Associated  Articles
      events/        EventList  Lanes  EventPage
      search/        SearchPage  Omnibox
      explore/       peek/  lens/  trail/  keepReading/
      scrapbook/     store.ts  ScrapbookPage
    lib/             useLang  useLens  dates  scripts  downscale
```

Scrapbook storage sits behind one small interface so accounts can replace it later without touching UI code. No auth UI is built.

```ts
export type Pin = { id: string; kind: 'check' | 'entity' | 'event'; label: { en: string; bn: string }; at: number }

export interface ScrapbookStore {
  list(): Promise<Pin[]>
  add(pin: Pin): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}
// the only line that changes when a remote store arrives:
export const scrapbook: ScrapbookStore = createIdbScrapbook()
```

### 6.3 Vite config and the service worker

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(), tailwindcss(),
    VitePWA({
      strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
      registerType: 'autoUpdate',
      devOptions: { enabled: !!process.env.VITE_SW_DEV, type: 'module' },
      manifest: {
        name: 'Jachaikori', short_name: 'Jachaikori', start_url: '/', display: 'standalone',
        background_color: '#F5EFE3', theme_color: '#F5EFE3',
        share_target: {
          action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
          params: { text: 'text', url: 'url',
            files: [{ name: 'image', accept: ['image/jpeg', 'image/png', 'image/webp'] }] },
        },
      },
    }),
  ],
})
```

```ts
// src/sw.ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))

registerRoute(({ url }) => url.pathname === '/share-target', async ({ request }) => {
  const form = await request.formData()
  const file = form.get('image')
  const text = String(form.get('text') || form.get('url') || '')
  const inbox = await caches.open('share-inbox')
  if (file instanceof File) await inbox.put('/inbox/image', new Response(file, { headers: { 'content-type': file.type } }))
  await inbox.put('/inbox/text', new Response(text))
  return Response.redirect('/?shared=1', 303)
}, 'POST')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))
```

- **Dev:** the service worker is off during normal `vite dev` (HMR). Set `VITE_SW_DEV=1` to enable it.
- **Testing the share target** needs an installed PWA on Android. Either use a Pages preview URL (HTTPS), or run `vite build && vite preview --host` and reach it from Chrome via USB port forwarding (`localhost` counts as secure).
- The share target works only once the worker controls the page, which is always true by the time the OS offers an installed PWA as a target.

### 6.4 Cloudflare Pages setup

- **Build:** root directory = repo root, command `bun run --filter web build` (adjust to the workspace name), output `apps/web/dist`.
- **Env:** `VITE_API_BASE_URL` per environment (production → API Worker URL, preview → staging API if any).
- **SPA fallback:** with no top-level `404.html`, Pages serves `index.html` for unknown paths, so **no `_redirects` fallback is needed**. A catch-all `/* /index.html 200` rule is known to trip Wrangler’s infinite-loop validation. To verify on the first preview deploy: load `/entities/ent_bangladesh_bank` cold. If we later move to Workers Static Assets, the equivalent is `not_found_handling: 'single-page-application'` in the Wrangler config. `_redirects` stays unused in v1.
- **CORS:** the API must allow the production domain and the preview origins (`*.pages.dev`).

```text
# public/_headers
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: microphone=(), geolocation=()
```

## 7. Contrast verification

Method: WCAG 2.x relative luminance, reproducible with a short script (it will become a CI test). A “wash” is `color-mix(in oklab, hue 12%, surface)`, the background of diff chips. Target: 4.5:1 for text, 3:1 for non-text marks and control borders.

**Changes from the plan:** in Morning, `sage` goes `#3F6B55` → **`#3A6450`** and `ochre` `#8A5A00` → **`#7F5200`**, because ochre text on its own wash measured 4.39 and sage was borderline at 4.50. Rust and violet keep their values. Evening values are unchanged.

**Morning**

| Colour | on paper | on raised | on sunk | on own wash (paper / raised) |
| :-- | --: | --: | --: | :-- |
| ink `#1E1A16` | 15.10 | 16.17 | 13.54 | n/a |
| pencil `#6B6055` | 5.35 | 5.73 | 4.80 | n/a |
| sage `#3A6450` | 5.88 | 6.30 | 5.28 | 4.93 / 5.26 |
| rust `#9C4519` | 5.59 | 5.99 | 5.02 | 4.71 / 5.02 |
| ochre `#7F5200` | 5.90 | 6.32 | 5.29 | 4.95 / 5.27 |
| violet `#5B4B8A` | 6.51 | 6.97 | 5.84 | 5.41 / 5.77 |

**Evening**

| Colour | on paper | on raised | on sunk | on own wash (paper / raised) |
| :-- | --: | --: | --: | :-- |
| ink `#EFE7D8` | 14.95 | 13.94 | 15.58 | n/a |
| pencil `#A99D8D` | 6.90 | 6.44 | 7.20 | n/a |
| sage `#8DBFA5` | 8.86 | 8.26 | 9.23 | 7.45 / 6.81 |
| rust `#E59A6F` | 8.03 | 7.49 | 8.37 | 6.82 / 6.24 |
| ochre `#E0B25A` | 9.35 | 8.72 | 9.74 | 7.81 / 7.14 |
| violet `#B5A6E6` | 8.36 | 7.80 | 8.72 | 7.07 / 6.47 |

Rules that follow from the numbers:

- **Diff chips and strips never sit directly on `paper-sunk` in Morning** (rust on a rust wash over sunk measures 4.26). Inside inputs and wells they sit on a `paper-raised` inset.
- **`rule` hairlines (1.36 Morning, 1.48 Evening) are decorative only.** Anything interactive (inputs, segmented controls, the scrubber track, chip outlines) uses a stronger token: `rule-strong` **`#8F8472`** in Morning (3.21 on paper, 3.44 on raised) and **`#766C5D`** in Evening (3.56 on paper, 3.32 on raised).
- Underline marks use the hue itself, so they clear 3:1 comfortably (5.2:1 or more on paper).
- Not covered by ratios: colour-blind simulation. The underline vocabulary, glyphs and numbered markers carry meaning without colour; add a Playwright pass with `forced-colors: active` (where marks fall back to system `Highlight` and underlines still show).

## 8. CI checks

1. Typecheck, ESLint, Prettier.
2. Vitest unit tests: `partitionDiffs` (the “nothing dropped” invariant, overlaps), `parseAmount`, `scriptRuns`, `lensQuery`, `classify`.
3. **i18n parity:** `en` and `bn` have identical key sets and matching `{placeholders}`; no empty values.
4. **Contrast test:** reads the tokens, asserts 4.5:1 for text pairs and 3:1 for non-text pairs in both themes.
5. Contract tests against the local API (Zod parse of real fixtures).
6. Playwright: golden-path verify with a fixture image (including a `perceptual` cache hit after downscale), scrub interaction, empty and error states, Bangla and English snapshots of the flag vocabulary.
7. Bundle budget (about 150 KB gzipped on the first route) and Lighthouse CI on a throttled mobile profile (accessibility 95 or better).

## 9. Confirmed Decisions (v0.2)

1. **`outletCoverage` field names:** Confirmed exact match (`covered`, `leadArticle`, `lagMinutesFromFirst`, `articleCount`, `firstPublishedAt`, `claims`), with strict-TS `null` guards applied in §1.4.
2. **Comma-separated `type=` on `/entities/:id/relations`:** Confirmed for Sprint 8 backend prep (`apps/api/src/index.ts`) so category filtering runs server-side.
3. **Uploaded card storage & privacy notice:** Cards are stored in R2 (`/checks/:id/image`) for shareable links and "Most checked"; `cap.notice` stays visible directly under the dropzone (with a brief note against uploading private/personal photos), backed by a 90-day R2 retention rule in production deployment.
4. **SPA Hosting:** **Cloudflare Pages** (`apps/web/dist`, `bun --filter @jachaikori/web build`, `public/_headers`, no catch-all `_redirects`).
5. **Backend Polish Endpoints (Queued for Sprint 8 Prep):** Clean human copy in `overallDiffSummary` (no raw enum names), Bangla numerals (`০–৯`) in all `bn` summaries/explanations, `GET /events/divergent?limit=6` for *"Where outlets differ"*, and `GET /entities/random` for *"Surprise me"*.
6. **Default Language & Visual Preferences:** English (`en`) default with persistent EN/বাংলা toggle; rolled-in Proof Strip wording approved; subtle static paper grain (~3%) kept; scrapbook local-only (IndexedDB behind `ScrapbookStore`) with no auth UI in v1.
