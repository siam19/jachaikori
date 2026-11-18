-- Event-Entity projection table and event redirect table for event-centric hypergraph API

CREATE TABLE IF NOT EXISTS event_entity (
  event_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mentioned',
  article_count INTEGER NOT NULL DEFAULT 0,
  outlet_count INTEGER NOT NULL DEFAULT 0,
  headline_count INTEGER NOT NULL DEFAULT 0,
  salience REAL NOT NULL DEFAULT 0,
  event_start TEXT NOT NULL,
  event_end TEXT NOT NULL,
  PRIMARY KEY (event_id, entity_id),
  FOREIGN KEY (event_id) REFERENCES event_cluster(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_entity_entity_start ON event_entity(entity_id, event_start);
CREATE INDEX IF NOT EXISTS idx_event_entity_start ON event_entity(event_start);

CREATE TABLE IF NOT EXISTS event_redirect (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL
);
