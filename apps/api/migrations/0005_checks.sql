-- D1 Migration 0005: Core Verification Pipeline & Dual-Provider VLM Cache
-- Adds persisted verification checks (exact + perceptual dHash deduplication,
-- popular checks feed) and deterministic versioned VLM response cache.

CREATE TABLE IF NOT EXISTS verification_check (
  id TEXT PRIMARY KEY,
  input_type TEXT NOT NULL,
  image_hash TEXT,
  perceptual_hash TEXT,
  text_hash TEXT,
  r2_key TEXT,
  extracted_claim_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  stage_timings_json TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_hit_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_check_image_hash
  ON verification_check(image_hash, pipeline_version);
CREATE INDEX IF NOT EXISTS idx_check_perceptual_hash
  ON verification_check(pipeline_version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_text_hash
  ON verification_check(text_hash, pipeline_version);
CREATE INDEX IF NOT EXISTS idx_check_popular
  ON verification_check(hit_count DESC, last_hit_at DESC);

CREATE TABLE IF NOT EXISTS vlm_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
