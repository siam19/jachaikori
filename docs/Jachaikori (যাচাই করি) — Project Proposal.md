# Jachaikori (যাচাই করি) — Project Proposal

Draft v1 · 14 November 2026 · Portfolio project (software engineering / MLOps)

## 1. Summary

Jachaikori is a web tool that helps people check viral Bangla news photo cards and screenshots. A user uploads an image; the system extracts the claim it makes, finds coverage from accredited news outlets, and shows how the card’s claim compares with what those outlets actually reported (matching, missing, or different in a specific detail such as a number, date, or quote).

The project has two layers:

1. **Claim verification (core):** image → structured claim → retrieval of accredited sources → claim-level diff.
2. **Event coverage comparison (extension):** cluster articles into events and show how different publishers covered the same event.

The system never declares a card “fake” or “true.” It reports what accredited sources say and where the card differs.

## 2. Problem

Bangladeshi Facebook is full of news photo cards: a photo, a headline or quote, and a publisher logo. Reputable outlets post them with a link to the full article. Many other pages repost the card with no source, and sometimes with a changed figure, a changed date, or a quote attributed to the wrong person. Readers have no quick way to trace a card back to its original reporting.

The same gap exists for screenshots of rants or commentary from creators: people want context on the topic but have no easy way to find it.

## 3. Goals and non-goals

**Goals**

- Given a card or screenshot, return the most relevant accredited articles with snippets and links.
- Detect and highlight claim-level differences between the card and those articles.
- Provide a measurable evaluation setup (labeled dataset, retrieval and extraction metrics) so every design change can be compared.
- Run as a deployed, publicly demoable system with a reproducible, documented pipeline.

**Non-goals**

- Labeling content as true or false, or rating outlet credibility or bias.
- Covering all of Bangladeshi media. Coverage is limited to nine hand-picked outlets (see section 14).
- Video or audio verification.
- Real-time coverage of breaking news (minutes). Hourly freshness is enough.

## 4. Features

### MVP (phase 1–2)

- **Upload and analyze:** upload a photo card or screenshot, or paste text.
- **Claim extraction:** a vision-language model returns structured fields: headline, quoted person, attributed statement, numbers, dates, entities, publisher logo (if any).
- **Source search:** hybrid retrieval (keyword and semantic, merged with Reciprocal Rank Fusion) over articles from nine accredited outlets, with reranking.
- **Results view:** ranked sources with snippet, outlet, publication date, and link out to the original article.
- **Honest empty state:** “No accredited coverage found,” with a note that this does not mean the claim is false.
- **Bilingual UI:** an English/Bangla toggle for the whole interface; article text stays in its original language.

### Phase 3

- **Distortion detection:** compare the card’s claim with each source’s claims and flag mismatched numbers, dates, quotes, or hedging (“may” vs “will”).
- **Entity aliases:** an alias and resolution layer so “Zia”, “PM”, and “Prime Minister” resolve to the right person at the right time.
- **Duplicate cache:** perceptual hashing so repeated uploads of the same viral card return instantly and feed an anonymous “most-checked cards” view.

### Phase 4 (stretch)

- **Event coverage comparison:** cluster articles into events; show which outlets covered each event, who published first, and which claims differ between outlets.
- **Graph view:** an explorable graph of events, claims, entities, and articles.

## 5. System overview

### Verification path (online)

1. User uploads an image to the web app.
2. The API stores the image, checks the perceptual-hash cache, and calls the VLM to produce structured claim JSON.
3. The query builder expands entities and aliases and issues a hybrid search.
4. A reranker orders the candidates.
5. (Phase 3) A claim-diff step compares the card’s claim with each top article’s extracted claims.
6. The results view renders matches, differences, and links.

### Ingestion path (offline, continuous)

1. A scheduler polls RSS feeds and sitemaps for each outlet.
2. New URLs are deduplicated and placed on a queue.
3. A fetch-and-extract worker downloads the page, stores raw HTML, and extracts clean article text, title, date, and byline.
4. An enrichment pipeline chunks the text, creates embeddings, extracts entities and claims, and writes everything to the index and database.
5. Failures go to a dead-letter queue with retry and alerting.

## 6. Applications and services

| # | Application | Responsibility |
| --- | --- | --- |
| 1 | **Web frontend** | Upload, results view, diff view, and (later) graph and coverage pages. Mobile-first, since most users will arrive from Facebook on phones. |
| 2 | **API service** | Auth-free public endpoints, rate limiting, image handling, orchestration of the verification path, result caching. |
| 3 | **Source discovery scheduler** | Periodically polls feeds and sitemaps per outlet and enqueues new article URLs. |
| 4 | **Fetch-and-extract worker** | Respects robots.txt and rate limits, downloads articles, extracts text and metadata, stores raw HTML. Handles JS-rendered sites when needed. |
| 5 | **Enrichment pipeline** | Chunking, embeddings, entity extraction, claim extraction, and writes to search index and database. Re-runnable when models change. |
| 6 | **Search and index layer** | Hybrid retrieval: D1 FTS5 keyword search and Vectorize vector search, merged with Reciprocal Rank Fusion in the Worker. |
| 7 | **Verification service** | VLM claim extraction, query building, reranking, claim diff. |
| 8 | **Evaluation harness** | Runs the labeled dataset against any pipeline version and reports metrics. Runs in CI. |
| 9 | **Observability and admin** | Logs, traces, per-query latency and cost, ingestion health dashboard, outlet management. |

## 7. Data model (sketch)

- **outlet:** id, name, domain, feed URLs, crawl settings, accreditation notes.
- **article:** id, outlet, URL, title, published\_at, fetched\_at, raw HTML pointer, clean text, content hash, pipeline version.
- **chunk:** id, article, position, text, embedding version.
- **entity:** id, canonical name (Bangla and English), type, aliases, validity period for role-based aliases (for example “PM”).
- **claim:** id, article or card, subject, predicate, object, quote or paraphrase flag, number, date, attribution, confidence.
- **event (phase 4):** id, label, first\_seen, linked articles and claims.
- **check:** id, image hash, extracted claim JSON, results, pipeline version, timestamp.

Edges such as `reports`, `mentions`, `same_as`, and `conflicts_with` can live in plain relational tables. A graph database is optional.

## 8. Technology options

You have Cloudflare Pro and roughly one month of free GCP credits. The credits expire, so the plan should front-load GCP-heavy work and avoid depending on GCP for the always-on parts. Running costs after the credits end must stay at or under 5 USD per month.

### Vision-language model / OCR

| Option | Pros | Cons |
| --- | --- | --- |
| **Gemini Flash (Vertex AI or API)** | Strong Bangla OCR, structured JSON output, one call does OCR and claim extraction, covered by credits | Credits end; per-call cost afterwards |
| Google Cloud Vision OCR + LLM | Reliable OCR, separate extraction step | Two steps, more glue |
| Tesseract (Bangla) | Free, self-hosted | Noticeably weaker on Bangla stylized fonts and overlays |

**Lean:** Gemini Flash for the main path, with Tesseract or Cloud Vision kept as a fallback adapter.

### Embeddings

| Option | Notes |
| --- | --- |
| **BGE-M3** | Multilingual, good on Bangla, can also produce sparse vectors, available on Workers AI |
| multilingual-e5 | Solid multilingual alternative, easy to self-host |

**Lean:** BGE-M3, with the model name and version stored on every vector so re-indexing is explicit.

### Search and storage

| Component | Role |
| --- | --- |
| **D1 with FTS5** | Keyword search (BM25 ranking) over article chunks, plus article metadata: outlet, date, URL. |
| **Vectorize** | Semantic nearest-neighbor search over BGE-M3 chunk vectors. |
| **Worker (fusion)** | Runs both queries and merges the two ranked lists with Reciprocal Rank Fusion: each chunk scores the sum of 1 / (k + rank) across the lists. k starts at 60, the usual default, and is tuned on the evaluation set. |
| **R2** | Raw article HTML and uploaded images. |

**Decision:** D1 (FTS5) plus Vectorize, fused with Reciprocal Rank Fusion. Elasticsearch is not used in this project. One thing to test first: FTS5’s default tokenizer may split Bangla words at vowel signs, so check keyword recall on Bangla text in phase 1 and, if needed, change the tokenizer settings or pre-tokenize text before indexing.

### Queue and orchestration

| Option | Notes |
| --- | --- |
| **Cloudflare Cron Triggers + Queues** | Native, simple, cheap; good for fetch and enrich jobs |
| Cloud Run Jobs + Pub/Sub | More flexible for heavy batch work, GCP-dependent |
| Workflow engine (Temporal, Airflow) | Overkill for MVP; consider only if the pipeline grows |

**Lean:** Cron Triggers + Queues for ingestion; Cloud Run Jobs for heavy one-off batch work (initial backfill, re-embedding, evaluation runs) while credits last.

### Compute and hosting

- **Workers + Pages:** frontend and API.
- **R2:** raw HTML and uploaded images.
- **Browser Rendering or a small Cloud Run service:** JS-heavy outlet pages.
- **Cloud Run:** claim-diff service and batch jobs, if Workers limits get in the way.

### Claim diff and reranking

- Reranker: a multilingual cross-encoder or an LLM rerank on the top \~20 candidates.
- Contradiction signal: an NLI model or LLM judge, combined with deterministic checks for numbers and dates (these are more reliable than models).

### Graph

Relational edge tables first. Neo4j Aura Free only if you want a graph database on the résumé; it is not required for any feature.

## 9. Evaluation and MLOps

This is the part that distinguishes the project from a standard RAG demo.

- **Labeled dataset:** 100+ real photo cards, each labeled with the expected source article(s) and, for a subset, the claim fields and any distortion.
- **Metrics:** retrieval recall@k and MRR; claim-extraction field accuracy; distortion detection precision and recall; “no coverage” correctness.
- **CI evaluation:** every pull request that touches retrieval code, prompts, or evaluation data runs the dataset, posts the metric deltas on the pull request, and fails if quality drops (see section 10).
- **Versioning:** embeddings, prompts, and pipeline configs carry version IDs; re-index and rollback paths are documented.
- **Observability:** per-stage latency, VLM and embedding cost per check, ingestion lag per outlet, dead-letter queue depth.
- **Drift checks:** monitor outlet HTML structure changes (extraction failures) and embedding score distributions over time.
- **Write-up:** a public document with numbers, failure cases, and what you would change next.

## 10. CI/CD pipeline

The pipeline runs on GitHub Actions and blocks any change that breaks a test, lowers retrieval quality, or fails a smoke test. It is built in phase 0 and extended in every phase, because it is the part of this project that shows delivery skills.

&#91;embedded content: CI/CD pipelines · 3 lanes\]

A pull request must pass static checks, tests, and the evaluation gate; a merge deploys to staging, and production needs a manual approval.

### Workflows

| Workflow | Trigger | What it does | Gate or output |
| --- | --- | --- | --- |
| `pr.yml` | Pull request | Lint and typecheck; unit tests in the Workers runtime; extractor tests against saved HTML for each outlet; D1 migrations applied to a fresh database; build and dry-run deploy; secret scan and dependency audit; evaluation run when retrieval code, prompts, or evaluation data change | All checks required to merge; metric table posted as a PR comment; preview deploy URL |
| `main.yml` | Push to `main` | Re-run the checks; apply migrations and deploy to staging; smoke test that uploads a known card and expects its source article | Staging must pass before production |
| `release.yml` | Manual approval (GitHub Environment) | Deploy the same build to production; production smoke test; roll back to the previous Worker version if it fails | Approval required; automatic rollback |
| `nightly.yml` | Schedule | Full evaluation on the live index; outlet health check that fetches the newest article per outlet and runs its extractor; ingestion freshness check | Opens an issue on a metric drop or extraction failure; metrics history updated |
| `reindex.yml` | Manual | Re-embed the corpus with a new model into a new Vectorize index, run the evaluation, and promote the index only if the metrics beat the current one | Promotion is a config change; the old index is kept for rollback |

### Quality gates

- **Required checks:** `main` is protected; every change goes through a pull request with squash merge.
- **Evaluation gate:** the pull request fails if recall@k or MRR falls more than a set tolerance below the baseline stored from `main`. The tolerance is chosen after the first baseline run.
- **Outlet fixtures:** one saved HTML sample per outlet (nine), so a layout change at an outlet fails a test instead of silently breaking ingestion.
- **Record and replay for model calls:** VLM and embedding responses are cached by input hash plus prompt and model version, so CI is deterministic and cheap. The cache refreshes only when the prompt or model version changes.
- **Speed and cost:** path filters skip the evaluation job when unrelated files change, concurrency groups cancel superseded runs, and dependencies are cached. Actions minutes are free on public repositories, which keeps CI inside the 5 USD budget.

### Environments and deployments

- **Three environments:** preview (per pull request), staging, and production. Each has its own D1 database, Vectorize index, queues, and R2 bucket, defined in the Wrangler config.
- **Secrets:** stored as GitHub Environment secrets, scoped per environment. While the credits last, access to GCP uses Workload Identity Federation (OIDC) instead of long-lived keys.
- **Rollback:** production rollback means redeploying the previous Worker version. D1 migrations are forward-only and written to work with both the old and the new Worker version.
- **Visibility:** README status badges, the evaluation table on each pull request, and a metrics history from the nightly runs.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Scraping legality and ToS** | Check robots.txt and terms per outlet, rate-limit, store only what you need for search and snippets, always link out, consider reaching out to outlets, and prefer RSS and sitemaps. |
| **Bangla NLP quality** (OCR, entities, claims) | Build the evaluation set early, keep a human-labeled sample, use structured outputs, and keep deterministic checks for numbers and dates. |
| **Misleading output** (users read “no match” as “fake”) | Neutral wording, explicit empty-state explanation, no truth labels. |
| **Time-dependent entities** (“PM”, “Minister”) | Alias table with validity periods and date-aware resolution. |
| **Cost and abuse** (VLM calls on a public endpoint) | Rate limits, caching by image hash, daily budget cap sized to the 5 USD per month ceiling, Turnstile on upload. |
| **Scope creep** | Strict phases; phase 3 and 4 only start after phase 2 meets its evaluation targets. |
| **GCP credits ending** | Front-load batch and evaluation work, keep the always-on stack on Cloudflare, and keep model calls behind adapters. |

## 12. Roadmap

| Phase | Deliverables |
| --- | --- |
| **0. Foundations** | Repo, CI skeleton (lint, types, tests, required checks), crawl policy for the nine outlets, claim schema, first 30 labeled cards. |
| **1. Ingestion and text search** | Scheduler, queue, extractor with per-outlet fixture tests, embeddings, D1 FTS5 and Vectorize search with RRF, evaluation harness, and the evaluation gate on pull requests. |
| **2. Image verification** | Upload flow, VLM claim extraction, query builder, reranking, results UI with the English/Bangla toggle, staging and production deploy pipelines with smoke tests, labeled set grown to 100+. |
| **3. Distortion and entities** | Claim diff, alias table, duplicate cache, observability dashboard, nightly evaluation and outlet health checks, reindex-and-promote workflow. |
| **4. Events and polish** | Event clustering, coverage comparison view, write-up and demo video. |

Each phase starts once the previous one meets its evaluation targets. Because the GCP credits last about a month, do the heavy VLM labeling help, the initial backfill, and the first evaluation runs as early as possible.

## 13. Success criteria

- Recall@5 of at least 0.8 on the labeled card set for outlets in scope (adjust after the baseline).
- Distortion detection flags altered numbers and dates with high precision on the labeled subset.
- A public demo that works on a phone, with a real viral example walked through end to end.
- A public repository with architecture diagram, evaluation report, and runbook.
- A short write-up explaining design decisions and trade-offs.

## 14. Decisions

**Decided**

1. **Outlets:** Prothom Alo, Bangladesh Protidin, Daily Jugantor, Kaler Kantho, Ittefaq, The Daily Star, Dhaka Tribune, The Business Standard, and bdnews24.
2. **Search:** D1 with FTS5 plus Vectorize, merged with Reciprocal Rank Fusion.
3. **Elasticsearch:** not used in this project; it is kept for a separate project.
4. **UI language:** English/Bangla toggle.
5. **Budget:** at most 5 USD per month for running costs.

**Still open**

1. Check each outlet’s robots.txt and terms, and whether it offers RSS or a sitemap.
2. Confirm which Cloudflare plan the Workers, Queues, Vectorize, and D1 usage falls under, and that it fits the 5 USD ceiling.
3. Decide whether the claim-diff service runs on Workers or on a small separate host once the GCP credits end.
