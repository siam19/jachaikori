-- Sprint 4: Entity Resolution & Sentence-Anchored Hypergraph Relations

ALTER TABLE article_entity ADD COLUMN role TEXT NOT NULL DEFAULT 'mentioned';
CREATE INDEX IF NOT EXISTS idx_article_entity_aid ON article_entity(article_id);

CREATE TABLE IF NOT EXISTS entity_relation (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL,
  published_at TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  FOREIGN KEY (article_id) REFERENCES article(id) ON DELETE CASCADE,
  FOREIGN KEY (source_entity_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (target_entity_id) REFERENCES entity(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rel_article ON entity_relation(article_id);
CREATE INDEX IF NOT EXISTS idx_rel_source ON entity_relation(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON entity_relation(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON entity_relation(relation_type);
