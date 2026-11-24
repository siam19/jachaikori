# Jachaikori (যাচাই করি) — Frontend Design & Architecture Brief

**Audience:** Specialized UI/UX & Frontend Engineering Agent  
**Status:** Backend API & Data Models Locked (`Sprint 7`) · Live 211,387-Article Corpus Ready  
**Creative Mandate:** You have **full creative ownership** over visual identity, aesthetic direction, typography, color system, layout structure, and interaction patterns. Use this brief to understand everything Jachaikori does, its non-negotiable journalism principles, its exact live API contracts, and real sample payloads from the 211k database.

---

## 1. What Is Jachaikori (যাচাই করি)?

**Jachaikori** (*Bangla for "Let's Verify"*) is a bilingual (**English + বাংলা**) civic-tech news verification and knowledge-exploration web application built for Bangladesh.

### The Real-World Problem
Bangladeshi Facebook and WhatsApp are flooded with **news photo cards** — an image, a stylized Bangla headline or pull-quote, and a publisher logo. Reputable newsrooms post them with links to full reporting, while hundreds of pages repost them without links — often quietly editing a figure (`Tk 3 crore` → `Tk 30 crore`), changing a date, pasting a 2024 quote onto a 2026 card, attributing a quote to the wrong politician, or stripping out a crucial word like `"গুজব"` (*rumor*).

### What the Backend Already Powers (Live Corpus Scale)
The backend API (`apps/api`, running on Bun locally and Cloudflare Workers in production) is **already built, tested, and backed by a live corpus**:

| Corpus Asset | Live Count | What It Enables in the UI |
| :--- | ---: | :--- |
| Accredited news articles (8 outlets) | **`211,387`** | Hybrid Bangla/English keyword + semantic search & verification |
| Multi-outlet event clusters | **`30,973`** (`25,693` multi-outlet) | Cross-outlet coverage comparison & "who published first" timelines |
| Canonical bilingual entities | **`3,383`** (`100%` with EN/বাংলা bios) | Entity Relationship Explorer dossiers with cited articles |
| Typed directional relationships (17 types) | **`430,231`** (`78,285` LLM + `351,946` det.) | Scannable entity relationships with verbatim evidence quotes |
| Structured verifiable claims | **`116,960`** (`70k` w/ numbers, `51k` w/ dates) | Automated Claim-Level Diff Engine & Cross-Outlet Claim Comparison |

### The 8 Indexed Accredited Outlets (`OutletId`)
| `OutletId` | English Name | বাংলা নাম | Language |
| :--- | :--- | :--- | :--- |
| `prothom-alo` | Prothom Alo | প্রথম আলো | Bangla |
| `daily-star` | The Daily Star | দ্য ডেইলি স্টার | English |
| `business-standard` | The Business Standard | দ্য বিজনেস স্ট্যান্ডার্ড | English |
| `bdnews24` | bdnews24.com | বিডিনিউজ টোয়েন্টিফোর | Bangla |
| `ittefaq` | The Daily Ittefaq | দৈনিক ইত্তেফাক | Bangla |
| `jugantor` | Daily Jugantor | দৈনিক যুগান্তর | Bangla |
| `kaler-kantho` | Kaler Kantho | কালের কণ্ঠ | Bangla |
| `bangladesh-protidin` | Bangladesh Pratidin | বাংলাদেশ প্রতিদিন | Bangla |

*(Note: `dhaka-tribune` also exists in `OutletIdSchema` as a future 9th outlet.)*

---

## 2. Non-Negotiable Product & Editorial Principles

Design decisions must **strictly preserve** these five journalistic guardrails:

1. **NEVER Declare Anything "TRUE", "FALSE", or "FAKE":**
   - Do **not** design green "VERIFIED TRUE" stamps, red "FAKE NEWS" alerts, truth meters, or outlet credibility/bias ratings.
   - Frame every verification result as **evidence comparison**: *"What this card says vs. what accredited outlets reported."*
   - Even when major distortions are found (`overallDiffStatus === "significant_differences"`), use calm, analytical visual cues (e.g., amber/coral highlight chips showing `"Number differs"`, `"Date differs"`, `"Context omitted"`) rather than sensational red banners.
2. **Honest Empty State (`status === "no_coverage"`):**
   - When no accredited article clears the confidence floor, render the API's neutral bilingual `emptyStateNotice` (`en` / `bn`) prominently and calmly: *"No matching coverage found across the 8 indexed outlets. This does not mean the claim is false."*
3. **Bilingual EN / বাংলা Interface Toggle (Original Article Text Untouched):**
   - Provide a persistent, effortless **EN / বাংলা** toggle for all UI navigation, headings, buttons, diff explanations (`explanationEn`/`explanationBn`, `diffSummary.en`/`bn`), empty-state notices, and entity dossiers (`shortTaglineEn`/`Bn`, `descriptionEn`/`Bn`).
   - **Never translate or alter** original article headlines, verbatim `snippet`s, `evidenceSnippet`s, or `ocrText` — show them in their authentic published script.
4. **Mobile-First for Facebook/WhatsApp Referrals:**
   - Most Bangladeshi users will open Jachaikori on a **mid-range smartphone (`360–414px` width)** immediately after screenshotting a Facebook photo card.
   - The image upload / paste flow and the side-by-side Claim Diff view must feel effortless with one thumb.
5. **Avoid Clanky, Hairball Graph UX:**
   - A previous prototype exposed a dense, overloaded raw D3 force-canvas that felt overwhelming and hard to navigate.
   - For the **Entity Relationship Explorer**, prioritize **structured, scannable, human-readable browsing** (clean dossier cards, grouped directional relationship rows with expandable quote receipts, filterable articles, and compact optional visual ego/timeline views) instead of dumping an unreadable hairball graph on the user.

---

## 3. Core Capabilities & User Journeys to Design

You have full freedom over information architecture and navigation, but the experience should gracefully cover these **four core pillars**:

### Pillar A — Verify a Photo Card or Claim *(Hero / Primary Entry Point)*
- **Inputs:**
  - Drag-and-drop / mobile camera-roll image picker (JPEG, PNG, WebP up to **8 MB**) OR clipboard paste (`Ctrl+V`) OR switch to **"Paste Text / Quote"** tab.
  - Optional subtle indicator when an upload hits the perceptual `dHash` cache (`cacheHit: "exact" | "perceptual"` → instant repeat check!).
- **Loading UX:** Verification on a fresh image takes ~5–12 seconds (VLM OCR → Entity Resolution → Hybrid Search → Reranking → Claim Diff). Design an informative, calm multi-step progress state (and surface `stageTimingsMs` optionally in a subtle collapsible "Pipeline trace" drawer for curious technical users!).
- **Result View (`GET /checks/:id` — Shareable Permalink!):**
  1. **Card Breakdown Panel:** Uploaded card preview (`imageUrl` if image) alongside structured fields read from the card (`headline`, `quotedSpeaker`, `claimedNumbers`, `claimedDates`, detected `publisherLogo`, clickable `resolvedEntities` chips linking straight into the Entity Explorer!).
  2. **Overall Comparison Banner:** Neutral summary driven by `overallDiffStatus` (`aligned`, `minor_differences`, `significant_differences`, `insufficient_claims`) + `overallDiffSummary[lang]` — OR honest `emptyStateNotice[lang]` when `status === "no_coverage"` / `"non_claim"`.
  3. **Ranked Accredited Sources with Side-by-Side Diffs (`sources[]`):**
     - Each source card shows: Outlet badge, publication date, original clickable headline (`canonicalUrl`), verbatim snippet, relevance score / cluster coverage badge (link to Event Comparison if `clusterId` is present!), and **Claim-Level Diff Callouts (`diffs[]`)**:
       - Each diff item clearly contrasts `cardSpan` vs `articleSpan`, shows whether it was verified deterministically (`deterministic: true` → e.g. subtle `"Verified by rule"` badge) or semantically, and displays `explanationEn` / `explanationBn`.
  4. **Copy Shareable Link** (`/checks/:id`).
- **Popular Checked Cards Feed (`GET /checks/popular`):**
  - Clean horizontal rail or secondary section showing anonymous, most-checked viral cards (`hitCount`, headline/speaker, source count, top outlet, status pill) so first-time visitors immediately see real examples and can click any card to inspect its check.

### Pillar B — Entity Relationship Explorer *(Bilingual Knowledge Graph)*
- **Discovery:** Instant bilingual autocomplete (`GET /entities/suggest?q=`, `~13 ms`) + filterable directory (`GET /entities?type=person|org|location|event_topic&includeHubs=false`).
- **Entity Dossier Page (`/entities/:id` via `GET /entities/:id`):**
  - **Header & Encyclopedic Bio:** Bilingual name (`canonicalEn` + `canonicalBn`), entity type badge, hub indicator if `isHub`, `shortTagline[lang]`, neutral 1–2 sentence `description[lang]`, clickable inline source citations (`descriptionSources[]`), aliases, and stats (`articleCount`, `eventCount`, `relationCount`, date span).
  - **Office / Tenure Timeline (`roleTerms[]`):** When present (e.g., Prime Ministers, Chief Advisers), show a crisp chronological tenure strip (`2024-08-08 → 2026-02-16`).
  - **Typed Directional Relationships (`GET /entities/:id/relations`):**
    - Grouped or filterable across the **5 relationship categories** (17 canonical types — see §5.2 below).
    - Render human-readable directional statements (e.g., *`Arif Hossain Khan` — **executive director and spokesperson of** → `Bangladesh Bank` · `103 articles`*; *`Bangladesh Bank` — **dissolved the board of** → `Islami Bank Bangladesh PLC` · `22 articles`*).
    - Clicking any relationship expands verbatim `evidence[]` quotes with outlet, date, and article link — and clicking the target entity navigates smoothly to that entity's dossier!
    - Include a clean `"Include background hubs (Bangladesh, Dhaka, Police)"` toggle (`includeHubs=true|false`, default `false`).
  - **Related Entities & Activity (`GET /entities/:id/ego` + `GET /entities/:id/activity`):**
    - Clean visual **Activity Sparkline / Bar Chart** over time (optionally brushable to filter date range `from` / `to`).
    - Clean **Closely Associated Entities** grid/list or lightweight radial/ego view (`neighbors[]` ranked by damped PMI, zero hub clutter by default!) where clicking a neighbor filters **Co-Mentioned Articles** (`GET /entities/:id/articles?with=<neighborId>`).
  - **Articles Mentioning This Entity (`GET /entities/:id/articles`):**
    - Paginated feed filterable by co-entity (`with=`), role (`quoted_speaker`, `actor`, `subject`), date range (`from`/`to`), and sort (`recent` vs `salience`).

### Pillar C — Event Coverage Comparison *(Cross-Outlet Journalism Lens)*
- **Browse Events (`GET /events` or `GET /clusters?minOutlets=2`):**
  - Filterable by entity (`?entity=ent_bangladesh_bank`), date range, or search term. Shows headline label, outlet count pills (`5 of 8 outlets`), article count, and timeframe.
- **Event Comparison Page (`/events/:id` via `GET /events/:id/comparison`):**
  - **"Who Published First?" Chronological Timeline:** Highlights `firstToPublish` (`+0m`) and plots each subsequent outlet's article with `lagMinutesFromFirst` (`+90m`, `+211m`, `+226m`).
  - **8-Outlet Coverage Matrix:** Visual grid of all 8 accredited outlets showing clearly which outlets covered the event (`covered: true`, article count, lead headline link) and which did not (`covered: false`).
  - **Cross-Outlet Consensus & Differences (`crossOutletDifferences[]`):**
    - Clean callout cards contrasting `consensus_number` (*"4 outlets report 26%"*), `number_difference` (*"26% vs 13%"*), and `hedging_difference` (*"Outlet A states definitively vs Outlet B uses cautious framing"*).
  - **Claims by Outlet:** Tabbed or side-by-side list of extracted claims (`numbers`, `dates`, `hedgingLevel` badge, `evidenceSnippet`) per outlet.
  - Optional toggle to view the **Event Entity Graph** (`GET /events/:id/graph`).

### Pillar D — Bilingual News Search (`GET / POST /search`)
- Clean, fast hybrid search bar across all `211,387` articles with outlet & date-range filters.
- Shows subtle **"Also searched aliases:"** chips (`expandedTerms`) when Sprint 5's temporal alias expander enriches a query (e.g., searching `"বাংলাদেশ ব্যাংক"` also searches `"কেন্দ্রীয় ব্যাংক"` and `"Bangladesh Bank"`).
- Each hit links directly to the original accredited article AND (if `clusterId` is present) to its **Event Coverage Comparison** page.

---

## 4. Technical Stack & Monorepo Integration

The redesigned frontend will live in **`apps/web/`** inside this Bun monorepo:
- **Recommended Stack (flexible if you prefer minor adjustments):** **React 19 + TypeScript + Vite + Tailwind CSS** (deploys cleanly as a static SPA to **Cloudflare Pages** in Sprint 8 with zero Node server dependency).
- **Direct Shared Types:** You can import Zod schemas & TypeScript types directly from `@jachaikori/schema` (`workspace:*`).
- **API Base URL:** Read from `import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787'` (local dev runs `bun run api` on `http://127.0.0.1:8787` with permissive CORS headers already enabled!).
- **Bangla Typography Recommendation:** Pair a crisp modern Bengali web font (e.g. **Hind Siliguri**, **Noto Sans Bengali**, or **Anek Bangla** / **Tiro Bangla** for editorial headlines) with a strong Latin editorial/UI pair, ensuring generous `line-height` (`1.6–1.75`) so Bangla matras (`ি`, `ী`, `ু`, `ূ`, `ে`, `ো`) never clip!

---

## 5. Complete API Contract & Taxonomies

### 5.1 Endpoints Summary
| Route | Method | Query / Body | Response Shape |
| :--- | :--- | :--- | :--- |
| `/verify` | `POST` | `multipart/form-data` (`image`, `provider?`, `bypassCache?`) **OR** JSON (`{ text?, imageBase64?, provider?, bypassCache? }`) | `VerificationCheck` (`400` bad input, `413` > 8 MB, `502` upstream VLM error) |
| `/checks/:id` | `GET` | — | `VerificationCheck` (`404` if missing) |
| `/checks/:id/image` | `GET` | — | Binary image (`image/jpeg\|png\|webp`, immutable cache) |
| `/checks/popular` | `GET` | `?limit=20&status=matched\|no_coverage` | `{ checks: PopularCheckSummary[] }` |
| `/entities` | `GET` | `?q=&type=&includeHubs=true\|false&limit=50&offset=0` | `{ entities: EntitySummary[] }` |
| `/entities/suggest` | `GET` | `?q=&limit=10` | `{ entities: Array<{ id, canonicalBn, canonicalEn, entityType, isHub, shortTaglineBn, shortTaglineEn, articleCount }> }` |
| `/entities/:id` | `GET` | — | `EntityProfile` (follows `merged_into` automatically) |
| `/entities/:id/articles` | `GET` | `?with=&role=&from=&to=&sort=recent\|salience&limit=25&offset=0` | `{ entityId, withEntityId, total, articles: [...] }` |
| `/entities/:id/relations` | `GET` | `?type=&source=llm_claim\|deterministic&from=&to=&includeHubs=false&limit=40` | `{ entityId, relations: [...] }` |
| `/entities/:id/ego` | `GET` | `?from=&to=&includeHubs=false&limit=20` | `{ centerEntity, nMe, nAll, neighbors, events, incidence }` |
| `/entities/:id/activity` | `GET` | `?from=&to=` | `{ entityId, series: Array<{ date, eventCount, articleCount, outletCount }> }` |
| `/events` | `GET` | `?entity=<id>&from=&to=&limit=30` | `{ events: EventCluster[] }` |
| `/events/:id/comparison` | `GET` | — | `EventComparisonResponse` |
| `/events/:id/graph` | `GET` | `?includeHubs=false` | `{ event, nodes, edges, articles }` |
| `/clusters` | `GET` | `?minOutlets=2&q=&outlet=&sort=outlets\|recent&limit=30&offset=0` | `{ clusters: EventCluster[] }` |
| `/articles/:id` | `GET` | — | `{ article }` |
| `/articles/:id/claims` | `GET` | — | `{ article, claims: StoredArticleClaim[] }` |
| `/search` | `GET`/`POST` | `q`/`query`, `outlet?`, `fromDate?`, `toDate?`, `mode=hybrid\|keyword\|semantic`, `limit=10` | `{ query, expandedTerms, matchedEntityIds, mode, latencyMs, hits }` |
| `/resolve` | `POST` | `{ text, title?, publishedAt?, emitUnlinked? }` | `{ registryVersion, resolverVersion, mentions, relations, unlinked }` |
| `/health` | `GET` | — | `{ ok: true, counts: { articles, chunks, clusters, edges, entities, entityRelations } }` |

### 5.2 The 7 Claim-Level Diff Flags (`ClaimDiffFlag`)
| Flag | Plain Meaning | Suggested Neutral Tone / Badge |
| :--- | :--- | :--- |
| `match` | Card detail aligns with accredited reporting | Neutral sage/teal (`Aligned`) |
| `mismatch_number` | Figure/currency/percent differs (e.g., `Tk 30 cr` vs `Tk 3 cr`) | Prominent amber/rust (`Number differs`) |
| `mismatch_date` | Date altered or recycled old news (`240 days apart`) | Amber/orange (`Date differs`) |
| `mismatch_speaker` | Quote attributed to a different person/org | Prominent amber/rust (`Different speaker`) |
| `mismatch_quote` | Quoted wording substantially altered | Amber/orange (`Quote wording differs`) |
| `hedging_shift` | Cautious/alleged report turned into certainty (`"may"` → `"will"`) | Slate/violet (`Certainty shifted`) |
| `missing_context` | Crucial denial (`"গুজব"`), scope, or tenure context omitted | Prominent amber/rust (`Context omitted`) |

### 5.3 The 17 Canonical Directional Relation Types (`EntityRelationType`)
Grouped into **5 clean UI filter categories**:
1. **Structure & Career:** `holds_role`, `affiliated_with`, `part_of`, `appointed_or_elected`, `resigned_or_removed`
2. **Speech & Stance:** `quoted_about`, `supported_or_endorsed`, `criticized_or_opposed`, `demanded_or_urged`
3. **Economy, Policy & Governance:** `signed_deal_or_agreed`, `funded_or_invested`, `regulated_or_directed`
4. **Law & Accountability:** `investigated_or_charged`, `ruled_or_sentenced`
5. **Diplomacy & Incidents:** `met_with`, `diplomatic_action`, `incident_at`

---

## 6. Real Live JSON Fixtures (Captured from the 211k Corpus)

### 6.1 `POST /verify` — Matched Card with Deterministic `mismatch_number`
```json
{
  "id": "chk_9f3c2a1b8e4d70",
  "status": "matched",
  "cacheHit": "none",
  "provider": "gemini",
  "modelVersion": "gemini-3.5-flash",
  "pipelineVersion": "verify-v2.0.0",
  "inputType": "image",
  "imageUrl": "/checks/chk_9f3c2a1b8e4d70/image",
  "extraction": {
    "inputKind": "photo_card",
    "language": "bn",
    "headline": "বড়দিন উপলক্ষে খ্রিস্টান সম্প্রদায়ের জন্য ৩০ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান",
    "ocrText": "বড়দিন উপলক্ষে খ্রিস্টান সম্প্রদায়ের জন্য ৩০ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান — প্রথম আলো",
    "quotedSpeaker": null,
    "attributedStatement": "বড়দিন উপলক্ষে খ্রিস্টান সম্প্রদায়ের জন্য ৩০ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান",
    "isQuote": false,
    "claimedNumbers": ["৩০ কোটি টাকা"],
    "claimedDates": [],
    "claimedEntities": ["তারেক রহমান"],
    "publisherLogo": "প্রথম আলো",
    "publisherLogoOutletId": "prothom-alo",
    "hasVerifiableClaim": true,
    "confidence": 0.95
  },
  "resolvedEntities": [
    {
      "entityId": "ent_tareque_rahman",
      "canonicalBn": "তারেক রহমান",
      "canonicalEn": "Tarique Rahman",
      "entityType": "person",
      "isHub": false,
      "surfaceForm": "তারেক রহমান",
      "linkMethod": "name_exact"
    }
  ],
  "overallDiffStatus": "significant_differences",
  "overallDiffSummary": {
    "en": "Notable differences detected between the card and matched accredited reporting (mismatch_number). Review the side-by-side citations below.",
    "bn": "কার্ডের দাবি ও মূলধারার প্রতিবেদনের মধ্যে উল্লেখযোগ্য পার্থক্য পাওয়া গেছে (mismatch_number)। নিচে প্রতিবেদনভিত্তিক তুলনা দেখুন।"
  },
  "sources": [
    {
      "articleId": "art_bp_xmas",
      "outlet": "bangladesh-protidin",
      "title": "খ্রিস্টান সম্প্রদায়ের বড়দিন উদযাপনে ৩ কোটি টাকার অনুদান হস্তান্তর",
      "canonicalUrl": "https://www.bd-pratidin.com/national/2026/11/18/...",
      "publishedAt": "2026-11-18T14:20:00+06:00",
      "snippet": "বড়দিন উদযাপনে খ্রিস্টান সম্প্রদায়ের প্রতিনিধিদের হাতে ৩ কোটি টাকার অনুদানের চেক হস্তান্তর করেছেন প্রধানমন্ত্রী তারেক রহমান।",
      "clusterId": "clu_xmas_grant",
      "clusterOutletCount": 4,
      "rerankScore": 0.85,
      "matchSummary": "Directly reports on PM Tarique Rahman handing over the Christmas grant cheque, with a different grant amount.",
      "matchedEntityIds": ["ent_tareque_rahman"],
      "diffFlags": ["mismatch_number"],
      "articleClaimsCount": 3,
      "diffSummary": {
        "en": "Card states \"৩০ কোটি টাকা\" (Tk 30 crore), whereas the accredited article reports \"৩ কোটি টাকা\" (Tk 3 crore).",
        "bn": "কার্ডে উল্লেখ করা হয়েছে \"৩০ কোটি টাকা\", তবে মূলধারার প্রতিবেদনে রয়েছে \"৩ কোটি টাকা\"।"
      },
      "diffs": [
        {
          "flag": "mismatch_number",
          "severity": "major",
          "deterministic": true,
          "cardSpan": "৩০ কোটি টাকা",
          "articleSpan": "৩ কোটি টাকা",
          "explanationEn": "Card states \"৩০ কোটি টাকা\" (Tk 30 crore), whereas the accredited article reports \"৩ কোটি টাকা\" (Tk 3 crore).",
          "explanationBn": "কার্ডে উল্লেখ করা হয়েছে \"৩০ কোটি টাকা\", তবে মূলধারার প্রতিবেদনে রয়েছে \"৩ কোটি টাকা\"।",
          "confidence": 0.96
        }
      ]
    }
  ],
  "emptyStateNotice": null,
  "hitCount": 1,
  "latencyMs": 8293,
  "stageTimingsMs": {
    "cacheLookupMs": 1,
    "extractMs": 3200,
    "entityResolveMs": 15,
    "retrievalMs": 84,
    "rerankMs": 2800,
    "diffMs": 2180,
    "persistMs": 13
  },
  "costUsd": 0.01078,
  "createdAt": "2026-11-24T07:55:00.000Z"
}
```

### 6.2 `GET /entities/ent_bangladesh_bank` — Bilingual Corpus-Cited Entity Dossier
```json
{
  "id": "ent_bangladesh_bank",
  "canonicalBn": "বাংলাদেশ ব্যাংক",
  "canonicalEn": "Bangladesh Bank",
  "entityType": "org",
  "status": "active",
  "source": "seed",
  "isHub": false,
  "shortTaglineBn": "বাংলাদেশের কেন্দ্রীয় ব্যাংক",
  "shortTaglineEn": "Central Bank of Bangladesh",
  "descriptionBn": "বাংলাদেশ ব্যাংক হচ্ছে বাংলাদেশের কেন্দ্রীয় ব্যাংক যা দেশের আর্থিক খাত নিয়ন্ত্রণ, মুদ্রানীতি প্রণয়ন এবং তফসিলি ব্যাংকসমূহের কার্যক্রম তদারকি করে থাকে। এটি দেশের আমদানি মূল্য ঝুঁকি হ্রাস, ইসলামিক ক্রেডিট কার্ডের নীতিমালা প্রণয়ন এবং বৈদেশিক ঋণ সহজীকরণের মতো বিভিন্ন আর্থিক নির্দেশনা জারি করে।",
  "descriptionEn": "Bangladesh Bank is the central bank of Bangladesh, responsible for regulating the country's financial sector, formulating monetary policies, and supervising scheduled banks. It issues key directives on financial regulations, including commodity price risk hedging, Islamic credit card guidelines, and foreign borrowing rules.",
  "descriptionUpdatedAt": "2026-11-24T05:30:56.535Z",
  "descriptionSources": [
    {
      "articleId": "41d5c8c434d329c08059041380fc01af",
      "title": "BB eases foreign borrowing rules for BIDA-registered firms",
      "outlet": "daily-star",
      "publishedAt": "2026-11-17T00:06:00+06:00",
      "canonicalUrl": "https://www.thedailystar.net/business/news/bb-eases-foreign-borrowing-rules-bida-registered-firms-4272696"
    }
  ],
  "aliases": [
    { "aliasRaw": "BB", "kind": "acronym" },
    { "aliasRaw": "Bangladesh Bank", "kind": "name" },
    { "aliasRaw": "কেন্দ্রীয় ব্যাংক", "kind": "name" },
    { "aliasRaw": "বাংলাদেশ ব্যাংক", "kind": "name" }
  ],
  "roleTerms": [],
  "stats": {
    "articleCount": 7918,
    "eventCount": 1246,
    "relationCount": 4626,
    "firstSeen": "2025-06-02T10:47:17+00:00",
    "lastSeen": "2026-11-18T14:08:49+06:00"
  }
}
```

### 6.3 `GET /entities/ent_bangladesh_bank/relations?limit=3` — Typed Directional Edges
```json
{
  "entityId": "ent_bangladesh_bank",
  "relations": [
    {
      "direction": "in",
      "relationType": "holds_role",
      "predicateLabels": ["executive director and spokesperson of", "spokesperson of"],
      "sources": ["llm_claim"],
      "weight": 103,
      "latestAt": "2026-11-18T09:23:16+06:00",
      "otherEntity": {
        "id": "ent_auto_e612f52038be",
        "canonicalBn": "আরিফ হোসেন খান",
        "canonicalEn": "Arif Hossain Khan",
        "entityType": "person",
        "isHub": false,
        "shortTaglineBn": "বাংলাদেশ ব্যাংকের নির্বাহী পরিচালক ও মুখপাত্র",
        "shortTaglineEn": "Executive Director and Spokesperson of Bangladesh Bank"
      },
      "evidence": [
        {
          "articleId": "5e7b2c...",
          "title": "BB eases foreign borrowing rules",
          "outlet": "daily-star",
          "publishedAt": "2026-11-17T00:06:00+06:00",
          "canonicalUrl": "https://www.thedailystar.net/...",
          "snippet": "Bangladesh Bank Executive Director and Spokesperson Arif Hossain Khan confirmed the circular.",
          "relationType": "holds_role",
          "predicateLabel": "executive director and spokesperson of",
          "source": "llm_claim"
        }
      ]
    }
  ]
}
```

### 6.4 `GET /events/clu_f3f4d047ad0c/comparison` — Cross-Outlet Coverage Comparison
```json
{
  "event": {
    "id": "clu_f3f4d047ad0c",
    "label": "অর্থবছর শেষেও কমল রপ্তানি আয়, লক্ষ্যমাত্রা থেকে পিছিয়ে ১৩%",
    "firstSeen": "2026-07-02T16:24:03+06:00",
    "lastSeen": "2026-07-02T20:10:00+06:00",
    "articleCount": 5,
    "outletCount": 5,
    "outlets": ["kaler-kantho", "prothom-alo", "bangladesh-protidin", "bdnews24", "ittefaq"]
  },
  "firstToPublish": {
    "outlet": "kaler-kantho",
    "articleId": "eb68e05007de6a590b3e195742878f11",
    "title": "জুনে রপ্তানি আয় বেড়েছে ২৫.৯১ শতাংশ",
    "publishedAt": "2026-07-02T16:24:03+06:00",
    "canonicalUrl": "https://www.kalerkantho.com/..."
  },
  "timeline": [
    { "outlet": "kaler-kantho", "lagMinutesFromFirst": 0, "publishedAt": "2026-07-02T16:24:03+06:00", "title": "জুনে রপ্তানি আয় বেড়েছে ২৫.৯১ শতাংশ" },
    { "outlet": "prothom-alo", "lagMinutesFromFirst": 90, "publishedAt": "2026-07-02T17:54:00+06:00", "title": "রপ্তানি আয়ে প্রবৃদ্ধি ২৬ শতাংশ..." },
    { "outlet": "bangladesh-protidin", "lagMinutesFromFirst": 211, "publishedAt": "2026-07-02T19:55:00+06:00", "title": "..." },
    { "outlet": "bdnews24", "lagMinutesFromFirst": 220, "publishedAt": "2026-07-02T14:04:09+00:00", "title": "অর্থবছর শেষেও কমল রপ্তানি আয়, লক্ষ্যমাত্রা থেকে পিছিয়ে ১৩%" },
    { "outlet": "ittefaq", "lagMinutesFromFirst": 226, "publishedAt": "2026-07-02T20:10:00+06:00", "title": "..." }
  ],
  "crossOutletDifferences": [
    {
      "kind": "consensus_number",
      "outlets": ["prothom-alo", "ittefaq", "kaler-kantho", "bangladesh-protidin"],
      "summaryEn": "4 outlets report the same figure (26%).",
      "summaryBn": "4টি সংবাদমাধ্যম একই সংখ্যা (26%) উল্লেখ করেছে।"
    },
    {
      "kind": "number_difference",
      "outlets": ["prothom-alo", "ittefaq", "kaler-kantho", "bdnews24"],
      "summaryEn": "Different percent figures appear across outlets: 26% vs 13%.",
      "summaryBn": "সংবাদমাধ্যমভেদে ভিন্ন সংখ্যা পাওয়া গেছে: ২৬ শতাংশ বনাম ১৩%।"
    },
    {
      "kind": "consensus_number",
      "outlets": ["prothom-alo", "ittefaq"],
      "summaryEn": "2 outlets report the same figure ($35B).",
      "summaryBn": "2টি সংবাদমাধ্যম একই সংখ্যা ($35B) উল্লেখ করেছে।"
    }
  ],
  "totalClaimsAnalyzed": 12
}
```

### 6.5 `GET /search?q=বাংলাদেশ+ব্যাংক+বৈদেশিক+ঋণ` — Hybrid Search with Entity Expansion
```json
{
  "query": "বাংলাদেশ ব্যাংক বৈদেশিক ঋণ",
  "expandedTerms": ["কেন্দ্রীয় ব্যাংক", "Bangladesh Bank"],
  "matchedEntityIds": ["ent_bangladesh_bank"],
  "mode": "hybrid",
  "fusionK": 60,
  "latencyMs": 251,
  "hits": [
    {
      "articleId": "bed2505c22360df09d87ea226678a2d7",
      "outlet": "bangladesh-protidin",
      "title": "কেন্দ্রীয় ব্যাংকের বাধায় আইএফসির ৮০ মিলিয়ন ডলার ঋণ পাচ্ছে না মেঘনা গ্রুপ",
      "canonicalUrl": "https://www.bd-pratidin.com/economy/2026/06/04/1258431",
      "publishedAt": "2026-06-04T22:38:13+06:00",
      "snippet": "তৃপক্ষের (বিডা) আওতাভুক্ত হলে বৈদেশিক ঋণের প্রাথমিক অনুমোদন দেয় বিডা...",
      "score": 0.016393,
      "sources": ["keyword"],
      "clusterId": "clu_bed2505c2236",
      "clusterOutletCount": 2
    }
  ]
}
```

---

## 7. Quick Start for Testing Against Live Local Data

Anyone developing `apps/web` inside this repo can point directly at the real 211,387-article corpus:
1. Run `bun run api` → starts the API on `http://127.0.0.1:8787` backed by `data/index/index.sqlite`.
2. Try live curl/fetch calls immediately:
   - `GET http://127.0.0.1:8787/entities/ent_tareque_rahman`
   - `GET http://127.0.0.1:8787/entities/ent_bangladesh_bank/relations`
   - `GET http://127.0.0.1:8787/entities/ent_bangladesh_bank/ego`
   - `GET http://127.0.0.1:8787/events/clu_f3f4d047ad0c/comparison`
   - `POST http://127.0.0.1:8787/verify` (`{ "text": "বড়দিন উপলক্ষে ৩০ কোটি টাকার অনুদান দিয়েছেন প্রধানমন্ত্রী তারেক রহমান" }`)

**Deliverable Expected from the Frontend Design Agent:** A cohesive, accessible, mobile-first, bilingual (EN/বাংলা) design proposal & implementation in `apps/web` that makes verifying a viral photo card feel effortless in under 10 seconds and turns Jachaikori's 3,383-entity knowledge graph and 30,973 event clusters into a pleasure to explore.
