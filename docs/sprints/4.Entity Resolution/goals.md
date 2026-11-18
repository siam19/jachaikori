# Sprint 4 Goals: Entity Resolution & Entity-Relation Hypergraph

## Objectives
1. **Canonical Entity & Temporal Alias Layer (`packages/entities`):**
   - Curated bilingual (`bn` ↔ `en`) canonical registry for Bangladeshi politicians, constitutional roles, parties, ministries/institutions, districts/countries, and recurring topics.
   - Temporal validity window resolution (`validFrom..validTo`) for role titles (`PM` / `প্রধানমন্ত্রী`, `Chief Adviser` / `প্রধান উপদেষ্টা`, `President`, etc.).
   - Bangla morphological suffix normalization (`-এর`, `-র`, `-কে`, `-তে`, `-য়`, `-য়ে`, `-দের`, `-রা`) and English `'s` normalization.
2. **Hypergraph Extraction & Local Backfill (`tools/backfill`):**
   - Model every article as a hyperedge of resolved entities (`article_entity` with roles: `quoted_speaker`, `actor`, `subject`, `location`, `mentioned`).
   - Materialize sentence-level typed projections (`entity_relation` with evidence snippets).
   - Add `bun run backfill resolve-entities` with live Clack progress bar across all 41,841 articles.
3. **Hybrid Search & Hypergraph Visualizer (`apps/api`, `apps/web`):**
   - Load live `entity_alias` rows into `/search` `AliasDictionaryExpander` for date-aware cross-lingual expansion.
   - Add `/entities`, `/entities/:id/graph`, and `/clusters/:id/entities`.
   - Add an **Article Network ↔ Entity Hypergraph** view toggle in `apps/web`, with interactive entity/relation graphs, clickable canonical entity chips, and evidence sentence drilldowns.
