# Sprint 5: Entity Resolution v2, Relationship Knowledge Graph & 211k Corpus Materialization — Implementation Log

Tracks schema & resolver v2 upgrades, hub handling, 17-type directional relationships, Vertex AI Batch mining/extraction/dossiers across the 211,387-article corpus, and AI/Explorer API endpoints.

---

## 2026-11-24: Sprint Initialization & Audit Baseline

### Pre-Sprint Audit Findings (`211,387` articles in `data/index/index.sqlite`)
- **Corpus Snapshot:** `211,387` extracted articles (`422,838` chunks + BGE-M3 vectors; `30,973` event clusters: `13,575` with `3+` outlets [`106,460` articles], `12,118` with `2` outlets [`29,789` articles], `5,280` single-outlet [`15,579` articles], `59,559` unclustered).
- **Pre-Sprint Entity State:** Stale `41.8k`-era entity tables (`348` entities, `735` aliases, `226,699` mentions, `139,123` relations, `0` `event_entity` rows, `0` `event_redirect` rows).
- **Baseline Issues Identified:**
  1. `11` PM false positives in `eval_128.jsonl` due to 1-token lookbehind guard and missing apposition/article-topic checks.
  2. Closed vocabulary (`188` deterministic entities) + un-thresholded/un-deduplicated LLM entity hashing causing spelling splits (`হোসেন`/`হোসাইন`, `ন্যূনতম`/`নিম্নতম`).
  3. 5 narrow regex relation types (`co_occurred` & `located_in` dominating) unable to express career/org structure, finance/policy, regulation, court rulings, or diplomacy.
  4. Synchronous single-threaded online Gemini script instead of real async Vertex AI Batch Prediction.
  5. Substring matching bug in `AliasDictionaryExpander`, un-damped `associationScore`, hub hairballs (`Bangladesh`, `Dhaka`, datelines), and per-request full-table scans in `apps/api`.

| File / Directory | Action | Reason |
| :--- | :--- | :--- |
| `docs/sprints/5. Entity Resolution v2/goals.md` | Created | Detailed Sprint 5 architecture, 17-type relation taxonomy, hub demotion policy, 3-stage Vertex AI Batch plan, and WP1–WP5 task breakdown. |
| `docs/sprints/5. Entity Resolution v2/log.md` | Created | Implementation audit trail and before/after metric tracking for Sprint 5. |

---

## 2026-11-24: WP1–WP4 Implemented & Verified

### Key Implementation Changes
| Package / App | Files Created / Modified | Summary |
| :--- | :--- | :--- |
| `packages/schema` | [entity.ts](file:///home/bast0k/projects/jachaikori/packages/schema/src/entity.ts) | Upgraded to 17 canonical directional relation types (`holds_role`, `affiliated_with`, `part_of`, `appointed_or_elected`, `resigned_or_removed`, `quoted_about`, `supported_or_endorsed`, `criticized_or_opposed`, `demanded_or_urged`, `signed_deal_or_agreed`, `funded_or_invested`, `regulated_or_directed`, `investigated_or_charged`, `ruled_or_sentenced`, `met_with`, `diplomatic_action`, `incident_at`), `predicateLabel`, `RoleTermSchema`, `UnlinkedMentionSchema`, `EntityProfileSchema`, `LlmCandidateVerdictItemSchema`, `LlmEntityDossierSchema`. |
| `packages/entities` | [normalize.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/normalize.ts), [seed.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/seed.ts), [resolver.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/resolver.ts), [association.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/association.ts), [policy.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/policy.ts), [redirects.ts](file:///home/bast0k/projects/jachaikori/packages/entities/src/redirects.ts) | Single-pass Bangla/English normalization, hyphenated Bangla suffixes (`বিএনপি-র`), orthographic folding (`হোসেন`/`হোসাইন`), newspaper dateline stripping, prefix-trie `compileRegistry()` + `resolveArticle()` (`v2.0.0`), multi-token role guards + apposition lookahead + headline-topic guard, `role_term` lookup, unambiguous article-local coreference, deduplicated mentions (`in_headline`, `mention_count`, `link_method`, `link_confidence`, `salience`), `UnlinkedMention` mining, damped PPMI, governance policies, and cluster redirects. |
| `packages/retrieval` | [query-expander.ts](file:///home/bast0k/projects/jachaikori/packages/retrieval/src/query-expander.ts) | Replaced substring `.includes()` & $O(A^2)$ loop with prefix-indexed token-boundary matcher honoring `requireUppercase`, role guards, `role_term`s, and today default date. |
| `registry/` & `apps/api` | [seed.yaml](file:///home/bast0k/projects/jachaikori/registry/seed.yaml), [0004_entity_v2.sql](file:///home/bast0k/projects/jachaikori/apps/api/migrations/0004_entity_v2.sql), [index.ts](file:///home/bast0k/projects/jachaikori/apps/api/src/index.ts), [api.test.ts](file:///home/bast0k/projects/jachaikori/apps/api/test/api.test.ts) | Forward-only v2 migration, isolate-cached registry (`WeakMap` keyed by `registry_version`), `GET /registry/snapshot` (`ETag` + `304`), `POST /resolve`, `GET /entities/:id` bilingual dossier, `GET /entities/:id/articles`, `GET /entities/:id/relations`, hub-filtered damped-PMI `/entities/:id/ego`. |
| `tools/backfill` | [db.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/db.ts), [seed-yaml.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/seed-yaml.ts), [entity-cli.ts](file:///home/bast0k/projects/jachaikori/tools/backfill/src/entity-cli.ts), [vertex_batch.py](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/vertex_batch.py), [run-vertex-batch.sh](file:///home/bast0k/projects/jachaikori/tools/backfill/gcp/run-vertex-batch.sh) | Streaming SQLite I/O (`streamArticlesForEntities`), one-way YAML seed sync, zero-dependency REST Vertex AI Batch runner (`gemini-3.5-flash` @ `global`, `thinkingBudget: 0`), full Stage A / A2 / B / C CLI commands, and `entities-diagnose`/`prune`/`merge`/`unmerge`/`reject`. |

### Verification Milestones (WP1–WP4)
- `bun run typecheck`: **0 errors**.
- `bun test`: **70 pass, 0 fail** (364 assertions across 12 suites).
- `bun --filter @jachaikori/web build`: built cleanly (`1.51s`).
- `tools/eval/entities/eval_baseline.ts` (`eval_128.jsonl` before → after):
  - Flagged PM false positives: **`11` → `0`**
  - Mentions (deduplicated): **`811` → `501`** (`-38.2%` row bloat, `127/128` articles still linked)
  - Deterministic relations: **`529` → `160`** (`-69.8%` `co_occurred`/`located_in` noise removed)
- **211k Candidate Mining (`mine-candidates`):** Streamed `211,387` articles in `220.7s` (`958 art/s`), harvesting `286,549` raw spans → **`24,309` qualified candidates** (`14,678` with `docFreq >= 6, outlets >= 2` exported into `588` grouped Vertex Batch requests, est. `$2.24`).

---

## 2026-11-24: WP5 — Stage A, Alias Hygiene Audit, 211k Resolution, Stage A2 Merges & Stage B Launch

### Stage A — Long-Tail Entity Discovery (`gemini-3.5-flash` @ `global`, Vertex AI Batch)
- **Batch Job:** `projects/363767463375/locations/global/batchPredictionJobs/3982362258888982528` (`588/588` succeeded, `0` errors, `input=3,467,875`, `output=2,426,254`, actual cost **`$3.55`**).
- **Post-Ingest Quality Audit & Hygiene Fix (`policy.ts` + `entity-cli.ts`):**
  - First diagnostic pass caught two real-world Bangla NER hazards:
    1. Cross-type token-subset merges (e.g., `জিয়াউর রহমান` (`person`) merging into `শহীদ জিয়াউর রহমান মেডিকেল কলেজ হাসপাতাল` (`org`), and `Dhaka University` into `DUCSU`).
    2. Ambiguous Bangla homograph acronyms (e.g., `বেলা` for BELA colliding with "o'clock" in `10,803` articles; `বিনা`, `নগদ`, `ইউপি`, and single-token names).
  - Replaced loose token-subset merging with same-type exact canonical matching sorted by `docFreq DESC`, added `isSafeAutoAlias()` (blocking Bangla homographs, generic administrative nouns, over-broad 2-token prefixes, and single-token person aliases; enforcing `requireUppercase` on short ASCII acronyms), and re-ingested from cached Stage A JSONL in **`1.75s`** (`$0.00` extra cost):
    - **Promoted:** `3,418` entities (`+96` seed = **`3,482`** active)
    - **Merged to existing:** `3,187`
    - **Rejected to denylist:** `5,342`
    - **Unsafe aliases blocked:** `324` (`10,681` clean active aliases)

### 211k Streaming Resolution & Stage A2 Duplicate Merge Judge
- **`resolve-entities` + `materialize-events` (211,387 articles):**
  - **`1,285,082`** deduplicated article mentions, **`241,373`** `event_entity` rows across **`30,791`** events, **`352,063`** deterministic 17-type relations, **`5`** hubs flagged (`ent_dhaka`, `ent_bangladesh`, `ent_police`, `ent_parliament`, `ent_bnp`).
- **Stage A2 (`41/41` direct requests, `$0.25`):**
  - Judged `816` same-type pairs sharing `>= 3` events → applied **`99` auditable, reversible merges** into `entity_merge_log` (`Fouzul Kabir Khan -> Muhammad Fouzul Kabir Khan`, `Invest Bangladesh Authority -> BIDA`, `Tasqueen Ahmed -> Taskeen Ahmed`, `Sheikh Hasina Burn Institute -> National Institute of Burn and Plastic Surgery`, etc.), conservatively skipping `713` pairs.

### Stage B — Multi-Outlet Event Relations & Structured Claims (Completed)
- **3-Article Smoke Test (`gemini-3.5-flash` @ `global`, `$0.0075`):** `3/3` succeeded, extracting clean directional 17-type relations (`holds_role`, `affiliated_with`, `met_with`, `incident_at`) with specific `predicateLabel`s and structured claims (`numbers`, `dates`, `hedgingLevel`, `speakerName`).
- **Full Stage B Batch Job:** `projects/363767463375/locations/global/batchPredictionJobs/5072796318666063872` (`33,218 / 33,220` parsed OK, `input=51,580,137`, `output=30,999,634`, actual cost **`$46.49`**).
- **Hardened Ingestion (`ingest-event-batch`, `32.05s`):** Added parenthetical bilingual alias matching, Bangla/English title-prefix stripping, and strict surface-coverage guards (`>= 85%` for hubs/locations, `>= 60%` for non-hubs) + snippet truncation so zero articles failed schema validation:
  - **Articles ingested:** `33,218`
  - **17-type directional LLM relations saved:** `78,285` (every one of all 17 canonical types richly populated; `44,174` unresolved long-tail/partial pairs cleanly skipped)
  - **Structured claims saved:** `116,960` (`69,960` with numbers · `50,602` with dates · `32,689` with canonical speaker IDs)

### Stage C — Corpus-Grounded Bilingual Entity Dossiers (Completed)
- **Full Stage C Batch Job:** `projects/363767463375/locations/global/batchPredictionJobs/2429464812376293376` (`3,328 / 3,328` parsed OK, `0` errors, `input=7,501,182`, `output=886,804`, actual cost **`$2.23`**; automatic OAuth `HTTP 401` token refresh verified live during poll).
- **Ingestion (`ingest-dossier-batch`, `304 ms`):** Updated bilingual `short_tagline_bn`/`en`, `description_bn`/`en`, and `description_sources_json` for all `3,328` exported entities (`3,383 / 3,383` active entities now carry bilingual descriptions, `3,318` with direct corpus article citations).

### Live 211k API Benchmark & SQL Optimization (`apps/api/src/index.ts`, `0004_entity_v2.sql`, `db.ts`)
- Caught & fixed two real-scale SQLite planner traps during live 211k API benchmarking:
  1. **Missing `idx_alias_entity ON entity_alias(entity_id)`:** Rewrote `/entities/suggest` with `EXISTS` + added index → **`2,651 ms` → `13.1 ms`** (**202× faster**).
  2. **SQLite Cartesian join trap in `/entities/:id/ego`:** Locking join order via `CROSS JOIN` (`a -> b -> eb`) cut `/entities/ent_tareque_rahman/ego` from **`42,402 ms` → `193.4 ms`** (**219× faster**) and `/entities/ent_bangladesh_bank/ego` from **`10,926 ms` → `109 ms`** with `0` hub nodes in default top-20 neighbors.
  3. **LLM Relation Priority:** Updated `/entities/:id/relations` (added `?source=` filter) and `/entities/:id/graph` to prioritize `source = 'llm_claim'` edges with specific `predicateLabel`s ahead of deterministic edges.

### Final 211k Knowledge Graph Summary & GCP Spend Accounting

| Metric | Sprint 4 Baseline | Sprint 5 Final |
| :--- | ---: | ---: |
| Articles resolved | `41,800` (stale) | **`211,387`** |
| Active canonical entities | `188` det. (`348` mixed) | **`3,383`** (`96` seed + `3,287` verified auto) |
| Auditable merges / Denylist rejects | `0` / `0` | **`99`** (`entity_merge_log`) / **`5,341`** |
| Clean active aliases | `735` | **`10,945`** (`324` unsafe aliases blocked) |
| Bilingual corpus-grounded descriptions | `0` | **`3,383 / 3,383`** (`3,318` cited) |
| Deduplicated article mentions | `226,699` | **`1,285,082`** |
| Event-entity hyperedges (`event_entity`) | `0` | **`240,219`** across **`30,791`** clusters (`5` hubs) |
| Directional 17-type relations | `139,123` (noisy `co_occurred`) | **`430,231`** (`351,946` det. + `78,285` LLM) |
| Structured claims (`claim`) | `0` | **`116,960`** |
| `eval_128.jsonl` PM false positives | `11` | **`0`** |

- **Total GCP Vertex AI Batch Spend (Sprint 5):** Stage A (`$3.55`) + smoke tests (`$0.04`) + Stage A2 (`$0.25`) + Stage B (`$46.49`) + Stage C (`$2.23`) = **`$52.56`** (well under the `$200+` free credit balance).
- **Documentation & Verification:**
  - Authored technical write-up in [blog.md](file:///home/bast0k/projects/jachaikori/docs/sprints/5.%20Entity%20Resolution%20v2/blog.md).
  - Verified `bun run typecheck` (**0 errors**), `bun test` (**70/70 pass, 374 assertions**), and `bun --filter @jachaikori/web build` (clean production build).

---
