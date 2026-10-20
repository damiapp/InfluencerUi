-- Media files stored in R2 (uploads and generated outputs).
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  source TEXT NOT NULL CHECK (source IN ('upload', 'generation')),
  original_name TEXT,
  generation_id TEXT,
  -- Gemini Files API copy used when the asset is sent as a reference.
  google_file_uri TEXT,
  google_file_expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_assets_created ON assets (created_at DESC);
CREATE INDEX idx_assets_source ON assets (source, kind, created_at DESC);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bible TEXT NOT NULL DEFAULT '',
  style_notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Locked reference images of a character, in prompt order.
CREATE TABLE character_refs (
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets (id),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, asset_id)
);
CREATE INDEX idx_character_refs_order ON character_refs (character_id, position);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  operation TEXT NOT NULL DEFAULT 'generate' CHECK (operation IN ('generate', 'edit', 'extend')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'finalizing', 'completed', 'failed')),
  prompt TEXT NOT NULL DEFAULT '',
  final_prompt TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  inputs TEXT NOT NULL DEFAULT '{}',
  character_id TEXT REFERENCES characters (id) ON DELETE SET NULL,
  -- Provider job id; for Gemini this is the interaction id used for edits and extensions.
  interaction_id TEXT,
  parent_id TEXT REFERENCES generations (id),
  root_id TEXT,
  output_asset_id TEXT REFERENCES assets (id),
  duration_seconds REAL,
  total_duration_seconds REAL,
  cost_estimate REAL,
  usage TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_generations_created ON generations (created_at DESC);
CREATE INDEX idx_generations_status ON generations (status);
CREATE INDEX idx_generations_root ON generations (root_id, created_at);
CREATE INDEX idx_generations_character ON generations (character_id, created_at DESC);
