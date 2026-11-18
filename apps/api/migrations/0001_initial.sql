-- D1 Migration 0001: Search index, Bangla FTS5, Event Clusters, Similarity Graph & Entity Resolution foundations

CREATE TABLE IF NOT EXISTS article (
  id TEXT PRIMARY KEY,
  outlet TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published_at TEXT,
  byline TEXT,
  lead TEXT,
  clean_text TEXT,
  pipeline_version TEXT NOT NULL DEFAULT 'v1'
);

CREATE INDEX IF NOT EXISTS idx_article_outlet_date ON article(outlet, published_at DESC);

CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  outlet TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  published_at TEXT,
  embedding_version TEXT NOT NULL DEFAULT 'bge-m3-v1',
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunk_article ON chunk(article_id);
CREATE INDEX IF NOT EXISTS idx_chunk_outlet_date ON chunk(outlet, published_at DESC);

-- Bangla-safe FTS5 virtual table: preserves vowel signs (matras), hasanta, and nukta
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  article_id UNINDEXED,
  outlet UNINDEXED,
  text,
  content='chunk',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 0 tokenchars 'ঁংঃ়ািীুূৃৄেৈোৌ্ৗৢৣ'"
);

CREATE TRIGGER IF NOT EXISTS chunk_ai AFTER INSERT ON chunk BEGIN
  INSERT INTO chunk_fts(rowid, article_id, outlet, text)
  VALUES (new.rowid, new.article_id, new.outlet, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON chunk BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, article_id, outlet, text)
  VALUES ('delete', old.rowid, old.article_id, old.outlet, old.text);
END;

-- Cross-outlet event clusters & similarity graph
CREATE TABLE IF NOT EXISTS event_cluster (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  lead_snippet TEXT,
  first_seen TEXT,
  last_seen TEXT,
  article_count INTEGER NOT NULL,
  outlet_count INTEGER NOT NULL,
  outlets_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cluster_outlets_date ON event_cluster(outlet_count DESC, last_seen DESC);

CREATE TABLE IF NOT EXISTS article_cluster (
  article_id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES event_cluster(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_cluster_cid ON article_cluster(cluster_id);

CREATE TABLE IF NOT EXISTS article_similarity_edge (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  similarity REAL NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_source ON article_similarity_edge(source_id);
CREATE INDEX IF NOT EXISTS idx_edge_target ON article_similarity_edge(target_id);

-- Forward-compatible Entity Resolution tables (populated in Phase 3)
CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  canonical_bn TEXT,
  canonical_en TEXT,
  entity_type TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS entity_alias (
  alias_norm TEXT NOT NULL,
  alias_raw TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (alias_norm, entity_id),
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alias_norm ON entity_alias(alias_norm);

CREATE TABLE IF NOT EXISTS article_entity (
  article_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  chunk_id TEXT,
  surface_form TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (article_id, entity_id, surface_form),
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_entity_eid ON article_entity(entity_id);
