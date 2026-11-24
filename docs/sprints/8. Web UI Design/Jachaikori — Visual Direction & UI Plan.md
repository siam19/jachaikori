# Jachaikori — Visual Direction & UI Plan

*v0.2 · 24 Nov 2026 · confirmed decisions folded in (companion: `Jachaikori — Implementation Spec.md` v0.2 & `Jachaikori — UI String Table (EN ↔ বাংলা).md` v0.2)*

## 0. The idea in one paragraph

Jachaikori should feel like a quiet reading room, not a dashboard: warm newsprint, hairline rules, serif headlines, generous margins. One rule shapes everything else: **ink is their words, pencil is ours.** Anything an outlet actually published (headline, snippet, evidence quote, OCR text) is set in *ink*: a serif, in its original script, with a thin rule beside it. Anything Jachaikori says (labels, explanations, translations, diff marks) is *pencil*: sans-serif, softer, drawn over the ink like a proofreader’s notes.

That one distinction enforces the no-verdict principle visually, keeps original text untouched, and gives the diff view its look. On top of it sit two big ideas:

1. **A diff where only the differences move** (§2): the card’s own sentence is shown once, unchanged words stay still, and a scrub or tap rolls just the differing spans from “as the card says” to “as the outlet reported”.
2. **An exploration layer** (§5): a shared *lens*, peek sheets and a reading trail, so every name, outlet and event is something you can pull on without losing your place.

## 1. Visual system — “The Morning Edition”

### 1.1 Palette

| Token | Morning (light) | Evening (dark) | Use |
| :-- | :-- | :-- | :-- |
| `paper` | `#F5EFE3` | `#17140F` | page |
| `paper-raised` | `#FBF7EE` | `#1F1B15` | clippings, cards |
| `paper-sunk` | `#EBE3D2` | `#110F0B` | wells, inputs |
| `ink` | `#1E1A16` | `#EFE7D8` | their words, headings |
| `pencil` | `#6B6055` | `#A99D8D` | our voice, secondary text |
| `rule` | `#D8CEBA` | `#3A332A` | decorative hairlines |
| `rule-strong` | `#8F8472` | `#766C5D` | interactive borders, inputs, tracks (≥ 3:1) |
| `sage` | `#3A6450` | `#8DBFA5` | aligned |
| `rust` | `#9C4519` | `#E59A6F` | number, speaker, context omitted |
| `ochre` | `#7F5200` | `#E0B25A` | date, quote wording |
| `violet` | `#5B4B8A` | `#B5A6E6` | certainty shifted |

The four diff hues are WCAG 2.x AA verified at 4.5:1 or better on paper, raised surfaces, and their own 12% washes (see `Implementation Spec` §7 for the full contrast matrix). **No pure red, no green “verified” stamps, and no per-outlet colours**, because colour-coded outlets read as credibility ratings. Outlet nameplates are plain ink small caps.

```css
@import 'tailwindcss';

@theme {
  --color-paper: #f5efe3;
  --color-paper-raised: #fbf7ee;
  --color-paper-sunk: #ebe3d2;
  --color-ink: #1e1a16;
  --color-pencil: #6b6055;
  --color-rule: #d8ceba;
  --color-rule-strong: #8f8472;
  --color-sage: #3a6450;
  --color-rust: #9c4519;
  --color-ochre: #7f5200;
  --color-violet: #5b4b8a;

  --font-display: 'Fraunces Variable', 'Tiro Bangla', serif;
  --font-read: 'Newsreader Variable', 'Noto Serif Bengali', serif;
  --font-ui: 'Hanken Grotesk Variable', 'Hind Siliguri', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  --ease-paper: cubic-bezier(0.2, 0.7, 0.2, 1);
}

/* Evening edition: follows the OS, user can override with data-theme */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --color-paper: #17140f;  --color-paper-raised: #1f1b15;  --color-paper-sunk: #110f0b;
    --color-ink: #efe7d8;    --color-pencil: #a99d8d;
    --color-rule: #3a332a;   --color-rule-strong: #766c5d;
    --color-sage: #8dbfa5;   --color-rust: #e59a6f;           --color-ochre: #e0b25a;
    --color-violet: #b5a6e6;
  }
}
```

### 1.2 Typography

| Role | Latin | Bangla | Where |
| :-- | :-- | :-- | :-- |
| Display | Fraunces (variable, soft axis) | Tiro Bangla | masthead, page titles, section heads |
| Reading (**ink**) | Newsreader | Noto Serif Bengali | outlet headlines, snippets, quotes, OCR text |
| UI (**pencil**) | Hanken Grotesk | Hind Siliguri | labels, chips, explanations, nav |
| Data | IBM Plex Mono | digits only | pipeline trace, lags, counts |

Each stack lists the Latin face first and the Bangla face second, so the browser picks per glyph and we never have to switch families by language. Rules:

- Bangla line-height 1.7 to 1.75 (matras never clip), Latin 1.5. Tune the Bangla `@font-face` with `size-adjust` so x-heights agree when scripts mix on one line.
- Every text node carries a correct `lang`. The UI toggle changes `<html lang>` for chrome only. Verbatim text is wrapped in `<Verbatim lang={article.language}>` and never changes with the toggle.
- `text-wrap: balance` for headlines, `pretty` for snippets.
- Numerals follow the UI language (০১২ in বাংলা, 012 in EN) for our own text. Verbatim text keeps its published digits.
- Font budget: use Fontsource per-script subsets, `font-display: swap`, and preload only the Latin display face. Bangla fonts are heavy, so the system Bangla font shows first on slow connections.

### 1.3 Paper, rules, motion

- **Rules, not boxes.** 1px hairlines separate content; a double rule sits under the masthead; on desktop, thin vertical rules separate columns like a broadsheet.
- **Grain.** A 128px tiled noise at about 3% opacity on `paper`. Static, never animated, dropped under `prefers-reduced-data`.
- **Small radii (2–4px)**: paper cut, not pills. One soft “paper on a desk” shadow for raised clippings. Torn-edge masks only on evidence clippings, never on whole pages.
- **Motion is slow and paper-like**: 200–350ms with `--ease-paper`, slides of 8px or less. The only signature move is the flip in §2. Reduced motion becomes a plain crossfade.
- **Icons**: 1.5px monoline, no fills.

## 2. The diff system — “Proof Strip”

### 2.1 Why not plain side-by-side

Two columns of Bangla on a 360px screen gives 4 to 6 words per line, the eye ping-pongs, and the user has to hunt for the difference. An inline red/green diff is a code-review idiom: it says “wrong/right”, and it has nothing to show for semantic flags (hedging, missing context) that have no character range.

### 2.2 Principle: only the differences move

Show the **card’s own sentence once**. Unchanged words stay perfectly still. The differing spans carry a pencil mark. Drag the scrubber (or tap “As reported”) and *only those spans* roll from the card’s wording to the outlet’s. The reader’s eye does the diff in about a second, in one place, with one thumb.

### 2.3 Three zoom levels

1. **Glance** (lists, source headers): margin-note chips like `৩০ কোটি → ৩ কোটি` with flag glyph and label.
2. **Proof Strip** (default inside each source card): the sentence plus scrubber.
3. **Receipt** (expand): the verbatim snippet in ink with the article span highlighted, outlet, date, link, a “Checked by rule” or “Judged by model” badge, the bilingual explanation, and confidence tucked under “Details”.

### 2.4 Flag vocabulary (colour is never the only signal)

| Flag | Label | Hue | Underline | Behaviour in the Strip |
| :-- | :-- | :-- | :-- | :-- |
| `match` | Aligned | sage | none | no roll, quiet tick |
| `mismatch_number` | Number differs | rust | solid | span rolls; Lineup in Receipt |
| `mismatch_date` | Date differs | ochre | dashed | span rolls; gap bar (“240 days apart”) |
| `mismatch_speaker` | Different speaker | rust | wavy | name span rolls; name-tag insert |
| `mismatch_quote` | Quote wording differs | ochre | dotted | word-level roll |
| `hedging_shift` | Certainty shifted | violet | double | 3-notch gauge: cautious ↔ certain |
| `missing_context` | Context omitted | rust | ghost dotted | ghost chip appended: “not on the card: …” |

### 2.5 Type-specific inserts (inside the Receipt)

- **Lineup (numbers).** A log-scale ruler. The card’s figure is a hollow ring above the line; each outlet’s reported figure is a filled dot below, labelled with the outlet, and equal values stack. It reads as “where this figure sits among outlets”, with no verdict word. Parsing is for drawing only (the backend decides the diff); if parsing fails we fall back to chips.
- **Date gap.** Two ticks on a time axis with a bridge between them and “240 days apart”.
- **Certainty gauge.** Three notches (*may / reportedly → states → will*); a hollow ring for the card, a filled dot for the article.
- **Ghost chip.** The omitted word (e.g. “গুজব”) is drawn as a dotted, see-through chip after the sentence: visible by its absence.

### 2.6 Code

```ts
// diff/model.ts — turn one source’s diffs into a renderable sentence
import type { ClaimDiff } from '@jachaikori/schema'

export type Seg =
  | { kind: 'same'; text: string }
  | { kind: 'swap'; text: string; reported: string; diff: ClaimDiff }

export function buildSegments(headline: string, diffs: ClaimDiff[]): Seg[] | null {
  const hits = diffs
    .filter(d => d.flag !== 'match' && d.cardSpan && d.articleSpan)
    .map(d => ({ d, i: headline.indexOf(d.cardSpan!) }))
    .filter(h => h.i >= 0)
    .sort((a, b) => a.i - b.i)
  if (!hits.length) return null // caller falls back to <SpanPairs/>

  const out: Seg[] = []
  let cur = 0
  for (const { d, i } of hits) {
    if (i < cur) continue // overlapping spans: keep the first
    if (i > cur) out.push({ kind: 'same', text: headline.slice(cur, i) })
    out.push({ kind: 'swap', text: d.cardSpan!, reported: d.articleSpan!, diff: d })
    cur = i + d.cardSpan!.length
  }
  if (cur < headline.length) out.push({ kind: 'same', text: headline.slice(cur) })
  return out
}
```

```tsx
// diff/ProofStrip.tsx
import { useMemo, useState, type CSSProperties } from 'react'
import { buildSegments } from './model'

export function ProofStrip({ headline, diffs, scriptLang, uiLang }: Props) {
  const segs = useMemo(() => buildSegments(headline, diffs), [headline, diffs])
  const [t, setT] = useState(0) // 0 = as on the card, 1 = as reported
  if (!segs) return <SpanPairs diffs={diffs} uiLang={uiLang} />

  return (
    <figure className='proof' style={{ '--t': t } as CSSProperties}>
      <p className='ink' lang={scriptLang}>
        {segs.map((s, i) =>
          s.kind === 'same' ? (
            <span key={i}>{s.text}</span>
          ) : (
            <span key={i} className='swap' data-flag={s.diff.flag}>
              <span className='swap-card'>{s.text}</span>
              <span className='swap-reported' aria-hidden={t < 0.5}>{s.reported}</span>
            </span>
          ),
        )}
      </p>
      <input
        type='range' min={0} max={1} step={0.01} value={t} className='scrub'
        aria-label={tt('strip.scrub', uiLang)}
        onChange={e => setT(+e.target.value)}
        onPointerUp={() => setT(t < 0.5 ? 0 : 1)} // snap like a page settling
      />
      <figcaption className='pencil' aria-live='polite'>
        {tt(t < 0.5 ? 'strip.asCard' : 'strip.asReported', uiLang)}
      </figcaption>
    </figure>
  )
}
```

```css
/* both layers share one grid cell: constant width, so the sentence never reflows while scrubbing */
.swap { display: inline-grid; }
.swap > span { grid-area: 1 / 1; }
.swap-card     { opacity: calc(1 - var(--t)); transform: translateY(calc(var(--t) * -0.5em)); }
.swap-reported { opacity: var(--t);           transform: translateY(calc((1 - var(--t)) * 0.5em)); }

.swap {
  text-decoration: underline var(--flag-line, solid) var(--flag);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.22em;
  background: var(--flag-wash);
}
[data-flag] { --flag-wash: color-mix(in oklab, var(--flag) 12%, transparent); }
[data-flag='mismatch_number']  { --flag: var(--color-rust);   --flag-line: solid;  }
[data-flag='mismatch_date']    { --flag: var(--color-ochre);  --flag-line: dashed; }
[data-flag='mismatch_speaker'] { --flag: var(--color-rust);   --flag-line: wavy;   }
[data-flag='mismatch_quote']   { --flag: var(--color-ochre);  --flag-line: dotted; }
[data-flag='hedging_shift']    { --flag: var(--color-violet); --flag-line: double; }

@media (prefers-reduced-motion: reduce) { .swap > span { transform: none; } }
```

```ts
// diff/amount.ts — for drawing the Lineup only; the backend still decides the diff
const BN = '০১২৩৪৫৬৭৮৯'
const SCALE: Record<string, number> = {
  হাজার: 1e3, লাখ: 1e5, কোটি: 1e7, মিলিয়ন: 1e6, বিলিয়ন: 1e9,
  thousand: 1e3, lakh: 1e5, crore: 1e7, cr: 1e7, million: 1e6, billion: 1e9, bn: 1e9, m: 1e6, b: 1e9,
}

export function parseAmount(raw: string): number | null {
  const s = [...raw.replace(/,/g, '')].map(c => (BN.includes(c) ? String(BN.indexOf(c)) : c)).join('')
  const i = [...s].findIndex(c => c >= '0' && c <= '9')
  if (i < 0) return null
  const rest = s.slice(i)
  const n = parseFloat(rest)
  const unit = rest.replace(/[0-9.]/g, '').trim().toLowerCase()
  const key = Object.keys(SCALE).find(k => unit.startsWith(k))
  return Number.isFinite(n) ? n * (key ? SCALE[key] : 1) : null
}

// Lineup x position on a log ruler, 0..1
export const rulerX = (v: number, lo: number, hi: number) =>
  (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1)
```

### 2.7 Guardrails

- The rolled-in text is labelled **“Card wording, with the outlet’s figure”**. It is never presented as article text. Real article text appears only in the Receipt, in ink.
- If `cardSpan` isn’t found in the headline (semantic flags), fall back to a stacked `SpanPairs` view: card span above, article span below.
- Source order stays by relevance. An **Only differences** filter is the one reordering tool.
- The summary is a **tally of differing details** (“1 detail differs · 3 align”), never a score or meter.
- Explanations switch with the EN/বাংলা toggle; the spans never do.

## 3. Layout & navigation

- **Grid:** 4 columns on mobile (16px gutters), 8 on tablet, 12 on desktop (max 1200px). Reading measure about 62ch.
- **Masthead:** the Bangla wordmark in Tiro Bangla with “Jachaikori” in small caps beside it, an edition date line (`Intl.DateTimeFormat('bn-BD')` or `en-GB` by language), and the EN | বাংলা toggle. Collapses to a slim bar on scroll.
- **Mobile nav:** a bottom bar with Check · Events · People · Search. Check is the centre action. **Desktop:** the same four as a text nav under the masthead.
- Plain section names in the UI (Check, Events, People & organisations, Search). Newspaper wit stays in decorative kickers only, which keeps Bangla copy unambiguous.

| Route | Screen |
| :-- | :-- |
| `/` | Front page: verify + feeds |
| `/checks/:id` | Result (shareable) |
| `/entities`, `/entities/:id` | Directory, dossier |
| `/events`, `/events/:id` | Event list, comparison |
| `/search` | Search results |

```text
FRONT PAGE (mobile)             RESULT (mobile)
┌────────────────────────────┐  ┌────────────────────────────┐
│ Jachaikori · যাচাই   EN|বাং │  │ ←                  Share ⎘ │
│════════════════════════════│  │ EXHIBIT · the card         │
│ Tuesday, 24 November 2026  │  │ ┌──────┐ Headline (ink)    │
│                            │  │ │image │ Numbers · People  │
│ Compare the card           │  │ └──────┘                   │
│ to the record.             │  │────────────────────────────│
│ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ │  │ WHAT WE FOUND              │
│ ╎  Add a photo card      ╎ │  │ 4 reports · 1 detail differs│
│ ╎ [Photo] [Paste] [Text] ╎ │  │────────────────────────────│
│ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ │  │ Bangladesh Pratidin · 18 Nov│
│ MOST CHECKED          →    │  │ ▮▮▮▮▮▯▯▯  scrub            │
│ WHERE OUTLETS DIFFER  →    │  │ # Number differs  ৩০ → ৩   │
│ IN THE NEWS           →    │  │ ▾ Receipt                  │
│ [Check][Events][People][⌕] │  │ [Check][Events][People][⌕] │
└────────────────────────────┘  └────────────────────────────┘
```

## 4. Pillar A — the verify flow

### 4.1 Capture

One large dashed “paper slip” dropzone with three equal options: **Photo** (camera-roll picker), **Paste** (a button using `navigator.clipboard.read()`, plus a global Ctrl/Cmd+V listener), and **Text**. On a cache hit, show a small “Seen before, instant result” note and a quiet “Re-check from scratch” link (`bypassCache`).

Uploads over 2MB are downscaled client-side to about 1600px on the long edge before sending, which helps on mobile data. Trade-off: this breaks the exact-hash cache, but the perceptual hash still hits.

### 4.2 Share straight from Facebook or the gallery (PWA share target)

The fastest path on Android is Share → Jachaikori, with no file picker. It needs an installed PWA and a tiny service worker. iOS doesn’t support share targets, so the picker stays as the fallback.

```json
{
  "name": "Jachaikori · যাচাই করি",
  "short_name": "যাচাই",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F5EFE3",
  "theme_color": "#F5EFE3",
  "share_target": {
    "action": "/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "text": "text",
      "url": "url",
      "files": [{ "name": "image", "accept": ["image/jpeg", "image/png", "image/webp"] }]
    }
  }
}
```

```js
// sw.js — park the shared file, then let the app pick it up
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'POST' || url.pathname !== '/share-target') return
  e.respondWith((async () => {
    const form = await e.request.formData()
    const file = form.get('image')
    const text = String(form.get('text') || form.get('url') || '')
    const inbox = await caches.open('share-inbox')
    if (file instanceof File) {
      await inbox.put('/inbox/image', new Response(file, { headers: { 'content-type': file.type } }))
    }
    await inbox.put('/inbox/text', new Response(text))
    return Response.redirect('/?shared=1', 303)
  })())
})
```

On load with `?shared=1`, the app reads the inbox, clears it, and starts the check immediately.

### 4.3 The press run (progress, 5 to 12 seconds)

The card image sits still while a thin pencil line scans down it; five stages are listed below as a typeset checklist. `/verify` returns in one response, so the pacing is an honest estimate: it holds on the last stage until the API answers and never fakes completion. Reveal fields as they arrive if we get streaming (§8).

```ts
const STAGES = [
  { key: 'read',    eta: 3200, en: 'Reading the card',            bn: 'কার্ড পড়া হচ্ছে' },
  { key: 'who',     eta: 400,  en: 'Finding who is mentioned',    bn: 'কার নাম আছে তা খোঁজা হচ্ছে' },
  { key: 'search',  eta: 900,  en: 'Searching the archive',       bn: 'আর্কাইভে খোঁজা হচ্ছে' },
  { key: 'rank',    eta: 2800, en: 'Choosing the closest reports', bn: 'সবচেয়ে কাছের প্রতিবেদন বাছাই হচ্ছে' },
  { key: 'compare', eta: 2200, en: 'Comparing claim by claim',    bn: 'দাবি ধরে ধরে তুলনা হচ্ছে' },
] as const

export function usePressRun(done: boolean) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (done) {
      const id = setInterval(() => setStep(s => Math.min(s + 1, STAGES.length)), 120)
      return () => clearInterval(id) // fast-forward, never skip silently
    }
    if (step >= STAGES.length - 1) return // hold until the API answers
    const id = setTimeout(() => setStep(s => s + 1), STAGES[step].eta)
    return () => clearTimeout(id)
  }, [step, done])
  return step
}
```

The list sits in an `aria-live='polite'` region. A collapsible **Pipeline trace** below it shows `stageTimingsMs` in mono type.

### 4.4 Result page order

1. **Exhibit**: the card image beside the fields read from it (headline, speaker, numbers, dates, claimed publisher, resolved-entity chips that open peeks).
2. **What we found**: one calm sentence from `overallDiffSummary[lang]` (or `emptyStateNotice[lang]`), then the tally strip of dots, one per source.
3. **Sources**: clippings, each with outlet nameplate, date, original headline link, a Proof Strip, and a Receipt. Number diffs add the Lineup above the list.
4. **Share**: copy link plus `navigator.share` where available.
5. **Pipeline trace** (collapsed).

The empty state (`no_coverage`) is the same layout with an empty clipping: a dotted outline, the neutral notice in pencil, and “Try the text tab”, “Search the archive” as next steps.

## 5. The exploration engine

The goal is a rabbit hole with a floor under it: every step is cheap, reversible and visible.

### 5.1 Everything is a thread, and threads open as peeks

Entity chips, outlet names, event labels and dates are all tappable. A tap opens a **peek**: a bottom sheet on mobile, a right-hand drawer on desktop, holding a condensed dossier or event summary and an “Open full page” link. You can stack peeks without losing the page underneath. Implementation: react-router’s background-location pattern, so a peek is a real URL and is shareable.

### 5.2 The lens

On a dossier, one sticky **lens bar** holds the active filters as removable chips (date range, co-entity, role, hubs). The same lens drives the relations list, ego neighbours, activity chart and article feed. Brushing the activity chart sets the date range; tapping a neighbour sets `with`. Everything is synced to the URL, so a lens is a shareable link.

```ts
// lib/useLens.ts
import { useSearchParams } from 'react-router'

export function useLens() {
  const [sp, setSp] = useSearchParams()
  const lens = {
    from: sp.get('from'), to: sp.get('to'),
    with: sp.get('with'), role: sp.get('role'),
    hubs: sp.get('hubs') === '1',
  }
  const set = (patch: Partial<Record<keyof typeof lens, string | boolean | null>>) =>
    setSp(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === false || v === '') next.delete(k)
        else next.set(k, v === true ? '1' : String(v))
      }
      return next
    }, { replace: true })
  return [lens, set] as const
}
// every query key includes the lens: ['relations', id, lens] — panels refetch together
```

### 5.3 The trail

A slim tray at the bottom remembers where you’ve been this session: dots for each stop, tap to jump back, long-press to clear. It is stored in `sessionStorage`, and “Copy trail as link” encodes the stops so a whole exploration can be shared.

```ts
type TrailStop = {
  kind: 'entity' | 'event' | 'check' | 'search'
  id: string
  label: { en: string; bn: string }
  at: number
}
```

### 5.4 Keep reading

Every page ends with three rails: **Same event, other outlets**, **People in this story**, **Also in the news that day**. Entity pages end with their top neighbours and most recent events. There are no dead ends.

### 5.5 One omnibox

`/` or Cmd/Ctrl+K opens a single box. Entity suggestions appear instantly (`/entities/suggest`, about 13ms), event and article hits stream in after (`/search`, about 250ms), each group labelled. Alias chips (“Also searched: …”) sit under the input.

### 5.6 Later: scrapbook and surprise

A local-only **scrapbook** (IndexedDB) to pin checks, entities and events, shown as a corkboard of clippings, plus a **Surprise me** button that opens a random mid-sized entity. No accounts needed.

### 5.7 Small delights

- Event lanes light up one by one when the page opens.
- Hovering or tapping an activity bar peeks that day’s headlines.
- Relationship rows fan out their evidence as overlapping clippings.
- Hovering an entity chip anywhere highlights the same entity elsewhere on the page.
- Shared-element transitions via the View Transitions API (a clipping grows into its page).

**Not doing:** streaks, notifications, infinite scroll without an end marker, or any engagement trick. “Addictive” here means curiosity pulls, not manipulation.

## 6. The other pillars

### 6.1 Entity dossier (Pillar B)

Order on the page: header (names in both scripts, type badge, tagline, bio with a drop cap, inline source citations, aliases, stats) → tenure ribbon if `roleTerms[]` exists → lens bar → **Relationships** → **Activity** → **Closely associated** → **Articles**.

- **Relationships** are sentences, not edges: *Arif Hossain Khan — executive director and spokesperson of → Bangladesh Bank · 103 articles*, with a thin ink bar for weight. A segmented control filters the five categories, and a toggle handles background hubs. Expanding a row fans out verbatim evidence clippings.
- **Closely associated** is a ranked list by default. An optional **Orbit** view places the top 8 to 12 neighbours on a fixed ring (no force simulation, so it can’t become a hairball); size follows PMI, and tapping a neighbour sets the lens.

### 6.2 Event comparison (Pillar C)

The coverage matrix and the “who published first” timeline become one picture: **eight lanes, one per outlet**, on a shared time axis from the first publication. Covered outlets get a dot at their lag (the first one flagged “First”); uncovered lanes stay dashed and empty. Since each outlet has its own lane, dots can never overlap, so the axis stays linear and honest.

Copy for empty lanes must say **“No matching article in our index”**, not “did not cover”.

```tsx
const OUTLETS = ['prothom-alo', 'daily-star', 'business-standard', 'bdnews24',
                 'ittefaq', 'jugantor', 'kaler-kantho', 'bangladesh-protidin'] as const

function Lanes({ cmp }: { cmp: EventComparisonResponse }) {
  const maxLag = Math.max(1, ...cmp.timeline.map(t => t.lagMinutesFromFirst))
  const hits = new Map(cmp.timeline.map(t => [t.outlet, t]))
  return (
    <ol className='lanes'>
      {OUTLETS.map(o => {
        const hit = hits.get(o)
        return (
          <li key={o} className={hit ? 'lane' : 'lane lane--empty'}>
            <OutletName id={o} />
            {hit ? (
              <a className='dot' href={hit.canonicalUrl}
                 style={{ insetInlineStart: `${(hit.lagMinutesFromFirst / maxLag) * 100}%` }}>
                +{hit.lagMinutesFromFirst}m
              </a>
            ) : (
              <span className='pencil'>{tt('lane.none', lang)}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
```

Below the lanes: `crossOutletDifferences[]` as three card styles (consensus, number difference, hedging difference), then claims by outlet as tabs. The lanes’ outlets can be tapped to filter those claims.

### 6.3 Search (Pillar D)

Results are typeset like a newspaper index: outlet and date in small caps, headline in ink, snippet with the match softly highlighted, and a “Compare coverage · 4 outlets” link when `clusterId` exists. Filters (outlet, date range) sit in a sheet on mobile.

## 7. Cross-cutting

- **Language:** **English (`en`) by default**, with a persistent EN / বাংলা toggle via a tiny `tt(key, lang)` dictionary plus a `useLang` hook on `useSyncExternalStore`, persisted in `localStorage` and mirrored to `<html lang>`. Numerals are localised in our own text only.
- **Time:** format every timestamp with `timeZone: 'Asia/Dhaka'`. The fixtures mix `+06:00` and `+00:00` offsets, so never rely on the raw offset.
- **Accessibility:** native range input for the scrubber (keyboard and screen-reader friendly), colour plus underline plus glyph for every flag, visible focus rings in `ink`, `aria-live` for progress, 44px touch targets, full keyboard path through peeks.
- **Performance:** about 150KB gzipped JS on the first route, route-level code splitting, chart code lazy-loaded, fonts subset, images decoded async. Targets are a mid-range Android on 4G.
- **Theming:** Morning by default, Evening follows the OS, with a manual switch in the masthead menu.

## 8. Notes on the API and backend prep

Things spotted in the brief and fixtures that affect the UI (see `Implementation Spec` §9 for confirmed Sprint 8 backend prep scope):

1. **Raw flag names leak into copy.** `overallDiffSummary` contains `(mismatch_number)` → **queued for Sprint 8 backend prep** (plus defensive UI stripping).
2. **Mixed digits in summaries.** `summaryBn` has Latin digits (“4টি”) → **queued for Sprint 8 backend prep** (`০–৯` in `bn` copy).
3. **Streaming stages** (SSE or chunked) on `/verify`: deferred beyond v1; client-side staged Press Run (`400ms / 2.2s / 6s` pacing) used in v1.
4. **A “where outlets differ” feed** (`GET /events/divergent?limit=6`) → **queued for Sprint 8 backend prep**.
5. **Spans on `match` diffs.** Deferred beyond v1; current Lineup draws differing figures and falls back cleanly.
6. **Random or “surprise” entity endpoint** (`GET /entities/random`) → **queued for Sprint 8 backend prep** (plus comma-separated `?type=` on `/entities/:id/relations`).
7. **Mixed timezones** in timestamps (see §7): UI always formats in `Asia/Dhaka`.

## 9. Build order

1. **Foundations:** tokens, fonts, `Verbatim`, masthead, nav, i18n, theming, Storybook-style gallery of the flag vocabulary.
2. **Verify:** capture, press run, result page, Proof Strip, Receipt, Lineup, empty state, popular rail.
3. **Explore core:** peeks, lens, trail, dossier (relations, activity, associated, articles).
4. **Events and search:** lanes, cross-outlet cards, omnibox, search results.
5. **Delight and reach:** PWA share target, scrapbook, Orbit view, View Transitions, polish pass.

## 10. Confirmed decisions (resolved from v0.1 open questions)

1. **Default language:** **English (`en`) by default**, with a one-tap persistent EN / বাংলা switcher in the masthead.
2. **Rolled-in “card wording with the outlet’s figure”:** **Approved for v1** (with §2.7 framing labels; can be refined later).
3. **Paper grain:** **Keep subtle static paper grain (~3% opacity)** on `paper`, dropped under `prefers-reduced-data`.
4. **Scrapbook & accounts:** **Local-only in v1** (IndexedDB behind the `ScrapbookStore` interface); accounts deferred to a future phase with no auth UI built now.
5. **Bangla copy:** Complete EN ↔ বাংলা dictionary drafted across Sections A–I in `Jachaikori — UI String Table (EN ↔ বাংলা).md` (v0.2), with `trace.entities` naturalised (`নাম ও প্রতিষ্ঠান শনাক্তকরণ`) and private-photo notice added to `cap.notice`; ready for final native-speaker tweaks as we build.
