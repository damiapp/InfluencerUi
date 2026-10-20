-- Character voices (Gemini Voice Design), speech generations and voiceover
-- versions of clips. SQLite cannot alter CHECK constraints, so assets,
-- generations and character_refs are rebuilt; kinds and operations are now
-- validated in app code. Children are dropped before parents so no foreign
-- key is ever violated (D1 enforces them per statement).

ALTER TABLE characters ADD COLUMN voice_description TEXT NOT NULL DEFAULT '';
-- Stored Gemini voice id (e.g. voice_abc123), passed as speech_config voice.
ALTER TABLE characters ADD COLUMN voice_id TEXT;
ALTER TABLE characters ADD COLUMN voice_preview_asset_id TEXT;

CREATE TABLE assets_v2 (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,              -- image | video | audio
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  source TEXT NOT NULL,            -- upload | generation
  original_name TEXT,
  generation_id TEXT,
  google_file_uri TEXT,
  google_file_expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE generations_v2 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- image | video | audio
  operation TEXT NOT NULL DEFAULT 'generate', -- generate | edit | extend | voiceover | speech
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,            -- running | finalizing | completed | failed
  prompt TEXT NOT NULL DEFAULT '',
  final_prompt TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  inputs TEXT NOT NULL DEFAULT '{}',
  character_id TEXT REFERENCES characters (id) ON DELETE SET NULL,
  interaction_id TEXT,
  parent_id TEXT REFERENCES generations_v2 (id),
  root_id TEXT,
  output_asset_id TEXT REFERENCES assets_v2 (id),
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

CREATE TABLE character_refs_v2 (
  character_id TEXT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets_v2 (id),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, asset_id)
);

INSERT INTO assets_v2 SELECT id, r2_key, kind, mime_type, size_bytes, source, original_name, generation_id,
  google_file_uri, google_file_expires_at, created_at FROM assets;
-- Parents before children so parent_id references resolve.
INSERT INTO generations_v2 SELECT id, kind, operation, provider, model, status, prompt, final_prompt, settings, inputs,
  character_id, interaction_id, parent_id, root_id, output_asset_id, duration_seconds, total_duration_seconds,
  cost_estimate, usage, favorite, error, created_at, updated_at, completed_at
  FROM generations ORDER BY parent_id IS NOT NULL, created_at;
INSERT INTO character_refs_v2 SELECT character_id, asset_id, position, created_at FROM character_refs;

DROP TABLE character_refs;
DROP TABLE generations;
DROP TABLE assets;

-- Renaming also rewrites the foreign keys that point at the *_v2 names.
ALTER TABLE assets_v2 RENAME TO assets;
ALTER TABLE generations_v2 RENAME TO generations;
ALTER TABLE character_refs_v2 RENAME TO character_refs;

CREATE INDEX idx_assets_created ON assets (created_at DESC);
CREATE INDEX idx_assets_source ON assets (source, kind, created_at DESC);
CREATE INDEX idx_generations_created ON generations (created_at DESC);
CREATE INDEX idx_generations_status ON generations (status);
CREATE INDEX idx_generations_root ON generations (root_id, created_at);
CREATE INDEX idx_generations_character ON generations (character_id, created_at DESC);
CREATE INDEX idx_character_refs_order ON character_refs (character_id, position);
