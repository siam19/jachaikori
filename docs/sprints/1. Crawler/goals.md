# Sprint 1: Multi-Outlet Crawler & Initial 2-Week Harvest — Goals

**Sprint Focus:** Complete the crawler engine orchestration, implement crawlers for all target news outlets, and harvest the initial 2-week catalog (2026-11-01 to 2026-11-15) safely without getting IP-banned.

---

## 1. Objectives

### A. Orchestration & Anti-Ban Protections
- [x] **Per-Domain Rate Limiter**: Upgrade `DomainRateLimiter` to register and enforce per-outlet `policy.crawlDelayMs` (e.g. 10s for TBS, 1–2s for others).
- [x] **Parallel Multi-Outlet Orchestration**: Update the engine and CLI to crawl multiple outlets concurrently (parallel across outlets, strictly serial within any single outlet).
- [x] **Anti-Ban Defenses**: Random jitter (±300–800ms), circuit breaker on 429/5xx with 60s cooldown, realistic browser headers, and headless Playwright with resource blocking (blocking images, media, CSS, fonts).

### B. Outlet Crawler Implementations (`packages/outlets`)
Implement crawlers using the blueprints and selectors documented in `docs/newspapers/`:
- [x] **The Business Standard** (`business-standard`): Daily archive `/archive/YYYY/MM/DD` (Implemented in Sprint 0).
- [x] **Daily Ittefaq** (`ittefaq`): Direct HTTP archive `/archive/YYYY-MM-DD` + AJAX pagination `/api/theme_engine/get_ajax_contents`.
- [x] **bdnews24 (Bangla)** (`bdnews24`): Direct REST endpoint `/archive/fetch` with category sections.
- [x] **The Daily Star** (`daily-star`): Drupal category pagination (`?page=N`).
- [x] **Prothom Alo** (`prothom-alo`): Search range filtering with Unix millisecond timestamps.
- [x] **Daily Jugantor** (`jugantor`): Date archive search via Playwright.
- [x] **Bangladesh Pratidin** (`bangladesh-protidin`): Category pages via Playwright, instant date extraction from URL (`/YYYY/MM/DD/`).
- [x] **Kaler Kantho** (`kaler-kantho`): Category stream via Playwright, instant date extraction from URL (`/YYYY/MM/DD/`).

### C. 2-Week Pilot Harvest (2026-11-01 to 2026-11-15) & Extended Backfill
- [x] Run crawler with `--cutoff 2026-11-01` (extended back to late July 2026: **80,209 clean in-scope articles** after strict section allowlisting, **0 missing days** across all 8 outlets from `2026-08-01` to `2026-11-14`).
- [x] Verify article metadata populated into `data/catalog.sqlite` (65 MB vacuumed) and flat-file URL/JSONL streams synced in `data/urls/`.
- [x] Verify zero rate-limit blocks (no 429s or tripped circuit breakers).

### D. Quality & Testing
- [x] Add unit tests and fixtures for each new outlet crawler in `packages/outlets/test/`.
- [x] Ensure `bun test` passes and `bun run typecheck` remains completely clean.
