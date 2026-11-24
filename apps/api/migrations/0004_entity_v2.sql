-- D1 Migration 0004: Entity Resolution v2 — Registry-as-Data, Role Terms, Hub Flags,
-- Corpus-Grounded Bilingual Descriptions, Governance Logs, 17-Type Relations & Claims

-- 1. Extend `entity` with lifecycle, hub demotion, grounded bilingual descriptions & precomputed stats
ALTER TABLE entity ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE entity ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE entity ADD COLUMN merged_into TEXT;
ALTER TABLE entity ADD COLUMN is_hub INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entity ADD COLUMN description_bn TEXT;
ALTER TABLE entity ADD COLUMN description_en TEXT;
ALTER TABLE entity ADD COLUMN short_tagline_bn TEXT;
ALTER TABLE entity ADD COLUMN short_tagline_en TEXT;
ALTER TABLE entity ADD COLUMN description_sources_json TEXT;
ALTER TABLE entity ADD COLUMN description_updated_at TEXT;
ALTER TABLE entity ADD COLUMN auto_score REAL;
ALTER TABLE entity ADD COLUMN verdict_json TEXT;
ALTER TABLE entity ADD COLUMN article_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entity ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entity ADD COLUMN first_seen TEXT;
ALTER TABLE entity ADD COLUMN last_seen TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_status_articles ON entity(status, article_count DESC);
CREATE INDEX IF NOT EXISTS idx_entity_hub ON entity(is_hub, status);

-- 2. Extend `entity_alias` with kind, case-sensitivity & provenance
ALTER TABLE entity_alias ADD COLUMN kind TEXT NOT NULL DEFAULT 'name';
ALTER TABLE entity_alias ADD COLUMN require_uppercase INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entity_alias ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_alias(entity_id);

-- 3. Extend `article_entity` separating link reliability from salience & headline tracking
ALTER TABLE article_entity ADD COLUMN mention_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE article_entity ADD COLUMN in_headline INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article_entity ADD COLUMN link_method TEXT NOT NULL DEFAULT 'name_exact';
ALTER TABLE article_entity ADD COLUMN link_confidence REAL NOT NULL DEFAULT 0.9;
ALTER TABLE article_entity ADD COLUMN salience REAL NOT NULL DEFAULT 0.5;

CREATE INDEX IF NOT EXISTS idx_article_entity_aid_eid ON article_entity(article_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_article_entity_eid_salience ON article_entity(entity_id, salience DESC);

-- 4. Extend `entity_relation` with specific free-text predicate labels & provenance
ALTER TABLE entity_relation ADD COLUMN predicate_label TEXT;
ALTER TABLE entity_relation ADD COLUMN source TEXT NOT NULL DEFAULT 'deterministic';

CREATE INDEX IF NOT EXISTS idx_rel_source_type ON entity_relation(source_entity_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_rel_target_type ON entity_relation(target_entity_id, relation_type);

-- 5. Temporal office-holder table (`role_term`)
CREATE TABLE IF NOT EXISTS role_term (
  id TEXT PRIMARY KEY,
  role_entity_id TEXT NOT NULL,
  holder_entity_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source_url TEXT,
  FOREIGN KEY (role_entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (holder_entity_id) REFERENCES entity(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_role_term_role ON role_term(role_entity_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_role_term_holder ON role_term(holder_entity_id, valid_from DESC);

-- 6. Registry versioning & per-article resolution tracking
CREATE TABLE IF NOT EXISTS registry_version (
  version INTEGER PRIMARY KEY,
  updated_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS article_resolution (
  article_id TEXT PRIMARY KEY,
  registry_version INTEGER NOT NULL,
  resolver_version TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_article_resolution_ver ON article_resolution(registry_version, resolver_version);

-- 7. Automatic long-tail candidate mining, denylist & auditable merge log
CREATE TABLE IF NOT EXISTS entity_candidate (
  alias_norm TEXT PRIMARY KEY,
  surface_raw TEXT NOT NULL,
  guessed_type TEXT NOT NULL,
  doc_freq INTEGER NOT NULL DEFAULT 1,
  outlet_count INTEGER NOT NULL DEFAULT 1,
  distinct_days INTEGER NOT NULL DEFAULT 1,
  sample_sentences_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  verdict_json TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidate_status_freq ON entity_candidate(status, doc_freq DESC);

CREATE TABLE IF NOT EXISTS entity_denylist (
  alias_norm TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_merge_log (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_merge_log_from ON entity_merge_log(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_merge_log_to ON entity_merge_log(to_entity_id);

-- 8. Structured article claims table (populated via Stage B Vertex Batch & Sprint 7 Diff)
CREATE TABLE IF NOT EXISTS claim (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'factual',
  speaker_entity_id TEXT,
  subject_entity_id TEXT,
  object_entity_id TEXT,
  numbers_json TEXT,
  dates_json TEXT,
  hedging_level TEXT DEFAULT 'reported',
  evidence_snippet TEXT,
  confidence REAL NOT NULL DEFAULT 0.85,
  extractor_version TEXT NOT NULL DEFAULT 'v2',
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_claim_article ON claim(article_id);
CREATE INDEX IF NOT EXISTS idx_claim_subject ON claim(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_claim_speaker ON claim(speaker_entity_id);
