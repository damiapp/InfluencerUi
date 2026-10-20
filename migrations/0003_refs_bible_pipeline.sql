-- Tagged reference library, structured character bible with history, and
-- shoot → approve → animate pipeline runs.

-- Reference tags (angle: front | three-quarter | profile | full-body).
ALTER TABLE character_refs ADD COLUMN angle TEXT;
ALTER TABLE character_refs ADD COLUMN expression TEXT;
ALTER TABLE character_refs ADD COLUMN lighting TEXT;
ALTER TABLE character_refs ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;

-- Current structured bible (JSON) and its version number.
ALTER TABLE characters ADD COLUMN bible_data TEXT;
ALTER TABLE characters ADD COLUMN bible_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE character_bibles (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  source TEXT NOT NULL,            -- generated | edited | restored
  model TEXT,
  ref_asset_ids TEXT,              -- references the model looked at
  cost_estimate REAL,
  created_at INTEGER NOT NULL,
  UNIQUE (character_id, version)
);
CREATE INDEX idx_character_bibles ON character_bibles (character_id, version DESC);

-- Stills and videos that belong to a pipeline run point at the run's
-- generation row (kind 'pipeline'), which is the single gallery item.
ALTER TABLE generations ADD COLUMN pipeline_id TEXT;
-- 1 when the provider refused the request for policy reasons.
ALTER TABLE generations ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_generations_pipeline ON generations (pipeline_id, created_at);
