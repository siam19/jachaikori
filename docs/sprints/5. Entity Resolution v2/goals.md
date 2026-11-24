# Sprint 5 Goals: Entity Resolution v2, Relationship Knowledge Graph & 211k Corpus Materialization

**Created:** 2026-11-24  
**Corpus Target:** `211,387` extracted articles · `30,973` event clusters (`25,693` multi-outlet clusters covering `136,249` articles)  
**GCP Budget Strategy:** Front-load heavy offline batch mining, relation/claim extraction, and bilingual entity dossier generation onto **Vertex AI Batch Prediction** (`gemini-3.5-flash` @ `global`, `thinking_budget = 0`, 50% batch discount — `gemini-2.5-flash` retired Oct 20, 2026) before free credits expire (~7 days). Actual total spend: **`$52.56`** out of **$200+** available.

---

## 1. Strategic Decisions & Architecture

### 1.1 Expanded Relationship Taxonomy (17 Canonical Types + Specific Predicate Labels)
The Sprint 4 regex taxonomy (`quoted_about`, `resigned_from`, `met_with`, `legal_action`, `criticized_or_protested`, `announced_or_agreed`, `located_in`, `co_occurred`) is too narrow and biased toward political/court events.

Sprint 5 upgrades `entity_relation` to a **two-level representation**:
1. **17 canonical `relation_type` values** for graph coloring, filtering, SQL indexing, and aggregation:
   - **Structure & Career:** `holds_role`, `affiliated_with`, `part_of`, `appointed_or_elected`, `resigned_or_removed`
   - **Speech & Stance:** `quoted_about`, `supported_or_endorsed`, `criticized_or_opposed`, `demanded_or_urged`
   - **Economy, Policy & Governance:** `signed_deal_or_agreed`, `funded_or_invested`, `regulated_or_directed`
   - **Law & Accountability:** `investigated_or_charged`, `ruled_or_sentenced`
   - **Diplomacy & Specific Incidents:** `met_with`, `diplomatic_action`, `incident_at`
2. **Concise free-text `predicate_label`** (e.g., `"dissolved board of"`, `"proposed Tk 32,000 minimum wage to"`, `"requested extradition of"`) on LLM-extracted edges, paired with exact `evidence_snippet`, `article_id`, `published_at`, and `source` (`'deterministic'` | `'llm_claim'`).
3. **Drop noisy `co_occurred` and generic `located_in` rows** from `entity_relation`. Event-level co-occurrence is served cleanly via `event_entity` + damped PMI (`associationScore`).

### 1.2 Hub Handling Policy (Why We Keep `Bangladesh`, Not Delete It)
Deleting `ent_bangladesh` would break bilateral/macro relations (`"IMF lends $4.7B to Bangladesh"`, `"India suspends onion export to Bangladesh"`, `"Dhaka seeks extradition from India"`) and break cross-lingual (`বাংলাদেশ` ↔ `Bangladesh`) query expansion during photo-card verification.

Instead, Sprint 5 introduces **three hub controls**:
1. **Dateline Stripping before resolution:** Strip newspaper datelines (`"ঢাকা, ১৪ নভেম্বর:"`, `"নিজস্ব প্রতিবেদক, ঢাকা"`, `"Staff Correspondent, Dhaka"`, `"Dhaka:"`) at the start of leads/bodies so routine datelines never emit false location mentions.
2. **Explicit + Dynamic Hub Tagging (`entity.is_hub = 1`):** Explicitly flag `ent_bangladesh`, `ent_dhaka`, `ent_police`, `ent_government` (and dynamically flag any entity appearing in `> 15%` of all events).
3. **Smart Graph Visibility:**
   - Hub entities remain fully searchable, linkable, and directly inspectable via `/entities/:id`.
   - Default graph/neighbor endpoints (`/entities/:id/ego`, `/events/:id/graph`) **hide passive hub mentions** (`includeHubs=false` by default) *unless* connected via a high-salience bilateral/macro relation (`diplomatic_action`, `funded_or_invested`, `signed_deal_or_agreed`, `regulated_or_directed`).

### 1.3 Grounded Bilingual Entity Descriptions (Human Explorer + AI Knowledge Source)
Every promoted entity gets a neutral, **strictly corpus-grounded** bilingual profile (`description_bn`, `description_en`, `short_tagline_bn`, `short_tagline_en`, `description_sources_json`, `description_updated_at`):
- **Never generated from LLM parametric memory alone** (avoids outdated offices or hallucinated bios).
- **Tier 1 (Long-tail candidates):** Piggybacked into the Vertex Batch candidate-verification prompt using 3–5 real sample sentences from the corpus.
- **Tier 2 (Top ~4,000 entities + all curated seed entities):** Dedicated Vertex Batch dossier pass over each entity's top 8 salient headlines/leads + top typed relationships + `role_term` timeline, producing a crisp 1–2 sentence neutral bio with citing article IDs.
- **Tier 3 (Fallback):** Deterministic synthesis from `entityType` + `role_term` + extracted apposition title.

### 1.4 True Async Vertex AI Batch Pipeline (3 Stages, ~$35–$45 Total)
Replaces the old synchronous one-by-one `generate_content()` loop in `tools/backfill/gcp/extract_gemini.py` with **real GCS + Vertex AI Batch Prediction Jobs** (`gemini-2.5-flash`, `thinking_budget = 0`, strict `response_schema`, `--report-only` dry-run cost estimator, and hard `--max-usd` guard):

| Stage | Input Scope | Batch Requests | Est. Cost (Batch 50% off) | Output |
| :--- | :--- | :--- | :--- | :--- |
| **Stage A — Long-Tail Candidate Mining** | Top ~15k–25k recurring `UnlinkedMention`s from all 211k articles (`articles >= 4`, `outlets >= 2`), grouped 25/prompt | ~600–1,000 | **~$3** | Verified bilingual entities, aliases, entity types, initial descriptions, denylist rejects |
| **Stage A2 — Cross-Script Dedup Judge** | Borderline candidate/entity pairs surfaced by BGE-M3 name cosine + cluster co-occurrence | ~100–250 | **~$0.50** | Auditable auto-merges (`entity_merge_log`, reversible via `unmerge`) |
| **Stage B — Multi-Outlet Event Relations & Claims** | 1–2 richest representative articles per multi-outlet cluster (`25,693` clusters → ~36k–40k articles: longest Bangla + longest English if bilingual) | ~38,000 | **~$28–$32** | Directional 17-type `entity_relation` edges with `predicate_label` + structured `claim` rows (numbers, dates, quotes, hedging) |
| **Stage C — Grounded Entity Dossiers** | Top ~4,000–5,000 entities (≥ 5 articles or ≥ 2 events + all seed entities) with curated evidence packets | ~4,500 | **~$1.50–$2.50** | Neutral bilingual `description_bn`/`en`, `short_tagline_bn`/`en`, `description_sources_json` |

---

## 2. Work Packages & Detailed Tasks

### WP1 — Schema v2, Relation Taxonomy & Pure Resolver Engine (`packages/schema`, `packages/entities`, `packages/retrieval`)
- [x] **WP1.1 Schema contracts (`packages/schema/src/entity.ts`):**
  - Upgrade `EntityRelationTypeSchema` to the 17 canonical relation types (retaining backwards compatibility where needed during migration).
  - Add `predicateLabel`, `source` (`'deterministic' | 'llm_claim'`), and `isHub` fields.
  - Add `EntityStatusSchema` (`active | rejected | merged`), `EntitySourceSchema` (`seed | auto | manual`), `LinkMethodSchema` (`name_exact | alias_stem | role_dated | role_inferred | article_coref | llm_linked`).
  - Add `RoleTermSchema`, `UnlinkedMentionSchema`, `EntityCandidateSchema`, `EntityMergeLogSchema`, `EntityProfileSchema` (full dossier with `descriptionBn`, `descriptionEn`, `shortTaglineBn`, `shortTaglineEn`, `descriptionSources`, `roleTerms`, `stats`), and `LlmClusterExtractionSchema`.
- [x] **WP1.2 Bangla/English normalization & dateline stripping (`packages/entities/src/normalize.ts`):**
  - Eliminate triple `normalizeText()` calls per token (single-pass normalization).
  - Add newspaper dateline stripper (`stripDateline()`) for Bangla & English wire/correspondent prefixes.
  - Support hyphenated Bangla case suffixes (`"বিএনপি-র"`, `"বিজিএমইএ-এর"`, `"ইউনূস-কে"`) and orthographic folding (`হোসেন`/`হোসাইন`, `ন্যূনতম`/`নিম্নতম`, honorific normalization).
  - Stem comparison on **every token position** of multi-word aliases, not just the last token.
- [x] **WP1.3 Pure Resolver v2 (`packages/entities/src/resolver.ts`):**
  - Refactor into pure `compileRegistry(snapshot)` (prefix trie / zero-alloc lookup, no per-token `Set` allocation) + `resolveArticle(article, compiled, opts)` returning `{ mentions, relations, unlinked, resolverVersion }`.
  - **Multi-token role guard** (2–3 token lookbehind across *all* role entities, not just `PM`) + **apposition lookahead** (`<role> <Name>` emits apposition link or unlinked mention instead of binding to the current Bangladeshi holder) + **article-topic guard** (suppress bare `PM` binding to current PM when headline explicitly names a former/foreign leader).
  - Separate `role_term` temporal lookup (`alias -> role_entity -> role_term(holder, valid_from, valid_to)`).
  - Separate `linkMethod` + `linkConfidence` from `salience` + `inHeadline` + `mentionCount`; deduplicate mentions per `(articleId, entityId)`.
  - **Unambiguous article-local coreference** (surname / partial-name coreference after full name is linked in the same article; no pronouns).
  - **Deterministic high-precision relations:** `quoted_about` (with widened Bangla verb-final window), apposition-extracted `holds_role` / `affiliated_with`, and clause-scoped typed patterns; drop `co_occurred` & generic `located_in`.
  - **Rule-based `UnlinkedMention[]` emitter:** Bangla `<title> <Name>` triggers, `<Name>, <description>` appositions, `: <Speaker>` headline tails, and multi-token Capitalized English proper nouns.
- [x] **WP1.4 Damped PMI & Fixed Query Expander (`packages/entities/src/association.ts`, `packages/retrieval/src/query-expander.ts`):**
  - Restore `Math.log(1 + together)` damping factor in `associationScore()`.
  - Rewrite `AliasDictionaryExpander` to use token/phrase boundary matching (fixing `"us"` inside `"business"`), honor `requireUppercase` and role guards, default missing date to today for `role_term`s, and run in $O(\text{query tokens})$ instead of $O(A^2)$.
- [x] **WP1.5 Unit Tests:** Cover foreign/former multi-token PM guards, apposition lookahead, `role_term` resolution, hyphenated Bangla suffixes, dateline stripping, article-local coreference, `UnlinkedMention` emission, damped PMI, and token-safe query expansion. Verify PM FPs on `eval_128.jsonl` drop from `11` to `~0` (`0` achieved!).

### WP2 — Registry-as-Data, YAML Seed & Migrations (`registry/`, `apps/api/migrations/`, `tools/backfill/src/db.ts`)
- [x] **WP2.1 Migration `0004_entity_v2.sql` (forward-only, D1-compatible):**
  - Extend `entity`: `status`, `source`, `merged_into`, `is_hub`, `description_bn`, `description_en`, `short_tagline_bn`, `short_tagline_en`, `description_sources_json`, `description_updated_at`, `auto_score`, `verdict_json`, `article_count`, `event_count`, `first_seen`, `last_seen`.
  - Extend `entity_alias`: `kind`, `require_uppercase`, `source`, plus `idx_alias_entity`.
  - Extend `article_entity`: migrate/rebuild with `(article_id, entity_id)` uniqueness, `mention_count`, `in_headline`, `link_method`, `link_confidence`, `salience`.
  - Extend `entity_relation`: `predicate_label`, `source` (`deterministic` | `llm_claim`).
  - Extend `claim`: `speaker_entity_id`, `numbers_json`, `dates_json`, `hedging_level`, `extractor_version`.
  - New tables: `role_term`, `registry_version`, `article_resolution`, `entity_candidate`, `entity_denylist`, `entity_merge_log`.
- [x] **WP2.2 YAML Seed Registry (`registry/seed.yaml`):**
  - Export curated seed entities + explicit `role_term` entries (Tarique Rahman PM `2026-02-17..`, Muhammad Yunus Chief Adviser `2024-08-08..2026-02-16`, Sheikh Hasina PM `2009-01-06..2024-08-05`, President, cabinet roles, hubs) into `registry/seed.yaml`.
  - Add validator (`validate-seed`: checks overlapping `role_term` windows, duplicate/colliding aliases, missing canonical names) and one-way sync into `index.sqlite` / D1.
- [x] **WP2.3 Streaming SQLite I/O (`tools/backfill/src/db.ts`):**
  - Replace full-RAM `getAllArticlesForEntities()` with keyset-paginated streaming iterator (`streamArticlesForEntities(batchSize = 2000)`).
  - Fix `materializeEventEntities()` to use true `ae.in_headline`, enforce minimum participation/salience thresholds, precompute `entity.article_count` / `event_count` / `first_seen` / `last_seen`, and compute `event_redirect` via `buildRedirects()` whenever clustering runs.
  - Eliminate the N+1 `OR` query in candidate lookup.

### WP3 — Vertex AI Batch Mining, Dedup, Relationship/Claim Extraction & Dossiers (`tools/backfill`)
- [x] **WP3.1 Local Candidate Miner (`bun run backfill mine-candidates`):**
  - Stream all `211,387` articles → emit `UnlinkedMention`s → aggregate into `entity_candidate` (`doc_freq`, `outlet_count`, `distinct_days`, `sample_sentences_json`, `guessed_type`).
  - Support `--report-only` to print candidate counts, distribution, and projected Vertex Batch token/USD cost.
- [x] **WP3.2 True Vertex AI Batch Runner (`tools/backfill/gcp/vertex_batch.py` + `run-vertex-batch.sh`):**
  - Uploads JSONL to GCS, submits an official **Vertex AI Batch Prediction Job** (`gemini-3.5-flash` @ `global`, `thinking_budget = 0`, strict `response_schema`), polls with automatic OAuth refresh until complete, and downloads output shards.
  - Supports 4 job modes: `verify-candidates` (Stage A), `judge-merges` (Stage A2), `extract-events` (Stage B), and `generate-dossiers` (Stage C), each with `--dry-run` / `--pilot N` / `--max-usd` / `--resume-job`.
- [x] **WP3.3 Auto-Promotion, Cross-Script Dedup & Governance Policy (`packages/entities/src/policy.ts`, `tools/backfill/src/entity-cli.ts`):**
  - Pure, unit-tested promotion thresholds + strict `isSafeAutoAlias()` hygiene gate (blocking Bangla homograph acronyms, generic administrative nouns, single-token person aliases).
  - Stage A2 LLM dedup judge over co-occurring lexically similar pairs (`confidence >= 0.8`, conflicting-surname guard), writing reversible `entity_merge_log` + `merged_into`.
  - Governance CLI commands: `backfill entities-prune --dry-run`, `entities-merge`, `entities-unmerge <logId>`, `entities-reject`, and `entities-diagnose`.
- [x] **WP3.4 Stage B Multi-Outlet Cluster Relation & Claim Extraction (`prepare-event-batch` / `ingest-event-batch`):**
  - Select 1–2 richest representative articles per multi-outlet cluster (`25,693` clusters → `33,220` articles), submit Vertex Batch job, validate with Zod, resolve extracted subject/object/speaker names with hub/location coverage guard, and upsert directional 17-type `entity_relation` rows + structured `claim` rows.
- [x] **WP3.5 Stage C Grounded Entity Dossiers (`prepare-dossier-batch` / `ingest-dossier-batch`):**
  - Build corpus-grounded evidence packets for all seed entities + entities with `>= 5` articles or `>= 2` events (`3,328` entities), submit Vertex Batch job, and store bilingual `description_bn`/`en`, `short_tagline_bn`/`en`, and citing `description_sources_json`.

### WP4 — Explorer & AI-Ready API Upgrades (`apps/api/src/index.ts`)
- [x] **WP4.1 Isolate-Cached Registry & Query Expansion:**
  - Cache compiled `AliasDictionaryExpander` / resolver snapshot in module scope keyed by `registry_version` (eliminating per-request full-table scans on `/search`).
  - Add `GET /registry/snapshot` (with `ETag` + `304`) and `POST /resolve` (ad-hoc text resolution for verifier & AI callers).
- [x] **WP4.2 Entity Dossier, Articles & Typed Relations Endpoints:**
  - `GET /entities/:id` — Full bilingual entity dossier (descriptions + source article links, `roleTerms`, aliases, stats, `isHub`, redirect resolution if `merged_into` is set).
  - `GET /entities/:id/articles?with=&role=&from=&to=&limit=&offset=` — Paginated articles mentioning this entity (supporting co-entity intersection & role filtering).
  - `GET /entities/:id/relations?type=&source=&from=&to=&includeHubs=&limit=` — Aggregated directional typed relationships prioritizing `llm_claim` edges with `predicateLabel` samples and exact quoted evidence sentences.
- [x] **WP4.3 Fix Existing Entity/Event Endpoints for 211k Scale:**
  - `/entities` reads precomputed `article_count`/`event_count` directly on `entity` (`1.1 ms`) and returns `shortTaglineBn`/`En`.
  - `/entities/suggest` uses `idx_alias_entity` + `EXISTS` (`13.1 ms`, 202× faster).
  - `/entities/:id/ego` uses `CROSS JOIN` join-order lock + `is_hub = 0` filter *before* damped-PMI ranking (`109–193 ms`, 219× faster).
  - Kept `/entities/:id/activity`, `/events`, `/events/:id/graph` (with `event_redirect` + `predicateLabel` on edges) backwards-compatible with `apps/web`.

### WP5 — Full 211k Execution, Evaluation & Documentation
- [x] Run Stage A candidate mining + Vertex Batch verification + Stage A2 dedup over all `211,387` articles (`3,383` active entities, `99` merges, `5,341` denylisted).
- [x] Stream-resolve all `211,387` articles into `article_entity` (`1,285,082` mentions) + deterministic `entity_relation` (`351,946`) + `article_resolution`.
- [x] Run Stage B Vertex Batch extraction across all `25,693` multi-outlet clusters (`33,218` articles) → `78,285` 17-type LLM relations + `116,960` structured claims.
- [x] Materialize `event_entity` (`240,219` rows across `30,791` clusters) + precomputed entity stats + dynamic hub flags (`5` hubs).
- [x] Run Stage C Vertex Batch dossier generation (`3,328 / 3,328` succeeded, `$2.23`) → `3,383 / 3,383` active entities with bilingual descriptions (`3,318` with article citations).
- [x] Re-run `tools/eval/entities/eval_baseline.ts` + `entities-diagnose` + live 211k API benchmark and record final metrics in `log.md`.
- [x] Write technical blog post explaining the entity engine in `docs/sprints/5. Entity Resolution v2/blog.md`.

---

## 3. Definition of Done
1. `bun run typecheck` passes with 0 errors and all unit + API tests pass.
2. PM false positives on `eval_128.jsonl` drop from `11` to `≤ 1` and entity vocabulary grows from `188` to `2,000+` verified bilingual entities with zero duplicate-ID splits on tested variants.
3. All `211,387` articles resolved, `event_entity` populated across all `30,973` clusters, and `25,693` multi-outlet clusters enriched with 17-type directional relationships + structured claims.
4. Top entities have neutral, corpus-cited bilingual descriptions served by `GET /entities/:id`, `GET /entities/:id/articles`, and `GET /entities/:id/relations`.
5. Hubs (`Bangladesh`, `Dhaka`) stay linked for bilateral/macro facts without turning default entity/event graphs into hairballs.
6. Total GCP Vertex Batch spend tracked and verified well within the `$200` credit window.
