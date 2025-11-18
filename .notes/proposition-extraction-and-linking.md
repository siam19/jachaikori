# Jachaikori: Proposition Extraction and Linking (Concept Spec)

This document consolidates our current working model for extracting information atoms (propositions) from news and linking them to canonical entities—without human frame labels—so consensus and narrative contrast emerge from data, not editorial categories.

## 1) Purpose and Scope
- Provide a pragmatic, label-free blueprint for:
  - Extracting structured propositions from unstructured Bangla/English articles using an LLM.
  - Linking propositions to stable entity IDs in a canonical registry.
  - Clustering semantically similar statements without pre-defined frame labels.
  - Supporting time-aware snapshots and consensus computation as simple queries.
- Implementation-agnostic; suitable for MVP planning and research.

## 2) Core Concepts
- **Proposition-centric universe:** The universal atom is a proposition with typed slots and provenance.
- **Atoms (Propositions):** Minimal units extracted from articles: facts, statements, statistics.
- **Clusters:** Label-free groups of semantically similar propositions that target the same topic/episode/case/decision.
- **Canonical Entities:** Stable IDs for people, orgs, courts, cases, decisions, episodes, locations, time windows, and statistic definitions.
- **Snapshots:** Views of the system “as of time T” by filtering `time_asserted`.

## 3) Proposition Schema (MVP)
Common fields (all kinds):
- `prop_id`
- `kind ∈ {fact, statement, statistic}`
- `language`
- `source_article_id`, `publisher_id`
- `time_about` (what the proposition is about: event/decision time)
- `time_asserted` (when the proposition was asserted/published)
- `quote_span{start,end}` (anchors in the article text)
- `confidence` (overall extraction confidence)

Structured slots:
- Core targeting: `about_ids[]` (episode/case/decision/event IDs)
- Participants: `participants[{entity_id, role}]`
- Predicate: `predicate_norm`, `polarity`, `modality` (e.g., alleged/found/reported)
- Evidentials: `evidentials[]` (e.g., cites UNHRC)
- Statement-specific: `speaker_id` (entity who spoke), `addressee_id?`
- Statistic-specific: `statistic{value, unit, scope_id: E:TIMEWINDOW:..., definition_id: E:STATDEF:..., uncertainty?}`

Linking metadata:
- `link_confidence_per_slot`
- `link_rationale`
- `provisional_refs[]` (temporary cluster IDs when canonical uncertain)

## 4) Label-Free Statement Clustering
Similarity signals (no human labels):
- Semantic embeddings: proposition-level and predicate-only similarity.
- Argument overlap: entity/slot alignment (speaker type, target event/case/decision, referenced orgs).
- Lexical anchors: shared phrases, n-grams, negation/antonym cues.
- Discourse intent cues: assert vs accuse vs defend; direct quote vs paraphrase (as features, not labels).

Composite score (conceptual):
- `S = w1*semantic + w2*argument + w3*lexical + w4*discourse`, capped if arguments conflict.

Clustering approach:
- Build a candidate graph over propositions with `S ≥ τ_link` and compatible scopes/targets.
- Apply density/community clustering; split clusters if internal contradiction is high (e.g., opposite polarity) or multi-modal predicates emerge.
- Keep outliers as singletons; do not force-fit.

Temporal dynamics:
- Store `time_about` and `time_asserted` per atom.
- Snapshots: filter by `time_asserted ≤ T` then recluster.
- Track cluster lifecycle (birth, merge, split, drift) and compute stability scores.

Cluster representation (UX, label-free):
- Name by exemplar: use top central quotes to auto-generate short headings (descriptive, not categorical).
- Show representative quotes with sources and timestamps, plus diversity/independence indicators.

## 5) Extraction Engine: LLM-Based Proposition Extractor
Guardrailed, two-pass pattern:
- Retrieval-first candidate pack:
  - Before extraction, fetch candidate canonical entities for each slot (people, courts, cases, decisions, episodes, locations, time windows, stat defs) using hybrid search; pass in candidate lists with minimal descriptions.
- Pass 1 (slot extraction):
  - Extract propositions and fill slots (no IDs yet); normalize predicates, polarity, times; anchor quote spans.
- Pass 2 (ID selection):
  - Choose IDs from candidate menus per slot; allow `PROVISIONAL(name, context)` when uncertain.
  - Emit per-slot confidence and brief rationale.
- Constrained decoding:
  - Output strict JSON; disallow free-form IDs; choose from candidate IDs or emit provisional markers.
- Confidence calibration:
  - Low-confidence links remain provisional; they are included in clusters but not counted toward high-confidence consensus.
- Hallucination guard:
  - If constraints fail, the linker downgrades to provisional; never invents unvetted canonical IDs.

## 6) Canonical Entity Database
Types:
- `Person`, `Org`, `Court`, `Case`, `Decision`, `Episode`, `Location`, `TimeWindow`, `StatDefinition`.

ID scheme & key fields:
- Stable UIDs with prefixes (e.g., `E:PERSON:HASINA`, `E:DECISION:ICT1:2025-11-17:v1`).
- `canonical_name`, `aliases[]` (lang/script/transliteration/honorifics), `short_desc`.
- Relations: `same_as[]`, `part_of[]`, `about_case`, `issued_by_court`, `updates`, `replaces`, `replaced_by`.
- Status: `active|merged|deprecated`, `merged_into`.

Fingerprints & lifecycle:
- Deterministic fingerprints for Decisions/Cases from slots (court, parties, date, disposition) to prevent duplicates.
- Allow `MERGE`, `SPLIT`, `DEPRECATE` with audit logs and reference rewrites.

Independence & de-dup:
- Track publisher lineage to detect syndicated wires; discount duplicates in consensus.

## 7) LLM-Facing API (Conceptual)
- `GET /entities/search` → candidate IDs by text/type/time/context.
- `GET /entities/{uid}` → full entity + neighbors (courts→cases→decisions, episode hierarchies).
- `POST /entities/propose` → create `PROV:*` provisional entity with evidence; awaits confirmation/merge.
- `POST /entities/merge` (admin) → merge into canonical; rewrite references; audit trail.
- `GET /entities/suggest_merges` → surface likely duplicates by alias/desc/fingerprint.
- `POST /linker/resolve` (optional) → batch resolution service to reduce round-trips.

## 8) Linking Protocol (Retrieval-First, Constraint-Checked)
Steps:
1) Candidate pack: orchestrator queries `/entities/search` per slot with mention text, type hints, time window, and known context IDs; returns menus to the LLM.
2) Two-pass LLM: extract slots → select IDs (or `PROVISIONAL`), with confidence and ration3le.
3) Linker constraints: enforce type checks, temporal consistency, slot compatibility, uniqueness; downgrade to provisional on violation.
4) Store & cluster: persist propositions; cluster by proposition signatures; promote clusters to canonical when evidence/constraints/admin confirm.

Provisional & do-no-harm:
- Use `CLUSTER:*` provisional IDs when canonical uncertain; they do not power “strong facts.”
- Never escalate low-confidence links into Panel 1; they remain visible but not decisive.

## 9) Time and Versioning
- Dual timestamps for every proposition (`time_about`, `time_asserted`).
- Snapshots are views over `time_asserted`.
- Versioned decisions: `:v1`, `:v2` with `updates` relations; UIs show lineage and current controlling state.
- Statistics require scope objects (`E:TIMEWINDOW:*`, `E:STATDEF:*`) so differing windows/definitions don’t merge incorrectly.

## 10) Evaluation & Metrics (Conceptual)
- Extraction: slot-level F1, predicate normalization accuracy, quote-span correctness on a gold set.
- Linking: accuracy@1 for entity IDs, unresolved rate, false-link rate under constraints.
- Clustering: purity/coverage, silhouette/density on S; contrast quality (human plausibility checks).
- Stability: cluster drift across snapshots for static events (should be low).
- Independence-adjusted consensus: precision when discounting syndication.
- Admin workload: merges per N articles, time-to-resolution for provisional items.

## 11) Edge Cases & Bangla/Multilingual
- Pronouns/ellipsis: rely on full-article context and candidate packs; keep low-confidence links provisional.
- Headline vs body: prefer body-anchored quotes; down-weight headline-only atoms.
- Transliteration/honorifics: alias tables and transliteration maps; strip honorifics from canonical names.
- Mixed statements: multi-proposition containers may populate multiple clusters/targets.
- Negation/sarcasm: polarity detection as features; uncertain items remain low-confidence.
- Cross-lingual: unify Bangla/English via multilingual retrieval and alias mapping; avoid clustering breaks across scripts.

## 12) Mapping to UX Panels (Label-Free)
- Panel 1 (Strongest Facts): high-confidence fact-proposition clusters with robust, independent support; often anchored to procedural facts (decisions, orders).
- Panel 2 (Statements): label-free clusters of statements; show exemplars, sources, timestamps, and diversity.
- Panel 3 (Statistics): statistic-proposition clusters grouped by unit/scope; show competing numbers with explicit scope chips.
- No-consensus mode: display clusters side-by-side without elevating any to “strongest facts.”

## 13) Open Decisions (for later)
- Minimal field requirements per proposition kind and confidence thresholds for Panel 1 elevation.
- Consensus scoring formula (independence weights, source proximity, recency decay, confidence discounting).
- Default thresholds for merging/splitting clusters and promoting provisional to canonical.
- Entity registry governance: who approves merges; audit policies; public vs internal views.

---

This spec remains intentionally label-free for narratives: clusters emerge from proposition similarity and shared targets rather than human or model-assigned frame tags. It keeps hypergraphs as a conceptual model—each proposition connects many arguments—while staying compatible with conventional storage and indexing.
