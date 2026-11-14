# Jachaikori (যাচাই করি)

> Fact-checking and accredited news verification platform for viral Bangladeshi photo cards and screenshots.

## Architecture & Monorepo Structure

This project uses a **Bun Monorepo** workspace layout:

```
jachaikori/
├── apps/                      # Deployed services
│   ├── web/                   # (Cloudflare Pages) Mobile-first verification UI
│   ├── api/                   # (Cloudflare Worker) Search, RRF ranking, verification API
│   ├── ingest/                # (Cloudflare Worker) Cron discovery & queue consumers
│   └── verifier/              # (Cloud Run / Worker) Gemini VLM claim extraction & diff
├── tools/                     # Local developer & ingestion tools (never deployed to edge)
│   ├── crawler/               # Playwright + HTTP catalog harvester
│   ├── backfill/              # Local batch downloader, extractor, embedder, bulk loader
│   └── eval/                  # Retrieval and extraction evaluation harness
├── packages/                  # Shared internal packages
│   ├── schema/                # Canonical Zod schemas (Article, Claim, CrawlJob, Outlet)
│   ├── outlets/               # Pure site extractors, parsers, and outlet crawl contracts
│   ├── db/                    # D1 / SQLite migration files and query helpers
│   ├── search/                # FTS5 query builder, Bangla normalizer, RRF implementation
│   └── llm/                   # Gemini & Workers AI adapters, record-replay cache
├── data/                      # Local data (gitignored): catalog.sqlite, raw HTML cache
└── docs/                      # Project proposals, architecture specifications, and notes
```

## Workspaces
- `@jachaikori/schema`: Central source of truth for all data contracts across crawler, ingest, and API.
- `@jachaikori/outlets`: Pure functional parsers and listing scrapers for the 9 accredited outlets.
- `@jachaikori/crawler`: Local catalog harvester producing `data/catalog.sqlite`.

## Prerequisites
- [Bun](https://bun.sh) (v1.2+)
- Node.js 22+ (for Playwright browser execution if needed)
