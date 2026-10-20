// D1 data access. Rows are mapped to the camelCase objects the UI uses.

export const MAX_CHARACTER_REFS = 8;
export const MIN_CHARACTER_REFS = 3;

const mediaUrl = (id) => (id ? `/api/media/${id}` : null);

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ── Assets ─────────────────────────────────────────────────────────────────

export function toAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    source: row.source,
    originalName: row.original_name,
    generationId: row.generation_id,
    url: mediaUrl(row.id),
    createdAt: row.created_at,
  };
}

export async function insertAsset(db, a) {
  await db
    .prepare(
      `INSERT INTO assets (id, r2_key, kind, mime_type, size_bytes, source, original_name, generation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(a.id, a.r2_key, a.kind, a.mime_type, a.size_bytes, a.source, a.original_name, a.generation_id, a.created_at)
    .run();
}

export async function getAssetRow(db, id) {
  return db.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first();
}

export async function getAssetRows(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT * FROM assets WHERE id IN (${placeholders})`).bind(...unique).all();
  const byId = new Map(results.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function listAssets(db, { kind = null, source = null, before = null, limit = 60 } = {}) {
  const where = [];
  const binds = [];
  if (kind) {
    where.push('kind = ?');
    binds.push(kind);
  }
  if (source) {
    where.push('source = ?');
    binds.push(source);
  }
  if (before) {
    where.push('created_at < ?');
    binds.push(Number(before));
  }
  const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, Math.min(limit, 200)).all();
  return results.map(toAsset);
}

export async function setAssetGoogleFile(db, id, uri, expiresAt) {
  await db.prepare('UPDATE assets SET google_file_uri = ?, google_file_expires_at = ? WHERE id = ?').bind(uri, expiresAt, id).run();
}

// ── Characters ─────────────────────────────────────────────────────────────

function toCharacter(row, refs = []) {
  return {
    id: row.id,
    name: row.name,
    bible: row.bible,
    styleNotes: row.style_notes,
    refs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function refsByCharacter(db, characterIds) {
  if (!characterIds.length) return new Map();
  const placeholders = characterIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT r.character_id, r.position, a.* FROM character_refs r JOIN assets a ON a.id = r.asset_id
       WHERE r.character_id IN (${placeholders}) ORDER BY r.character_id, r.position`,
    )
    .bind(...characterIds)
    .all();
  const map = new Map();
  for (const row of results) {
    if (!map.has(row.character_id)) map.set(row.character_id, []);
    map.get(row.character_id).push(toAsset(row));
  }
  return map;
}

export async function listCharacters(db) {
  const { results } = await db.prepare('SELECT * FROM characters ORDER BY updated_at DESC').all();
  const refs = await refsByCharacter(db, results.map((r) => r.id));
  return results.map((row) => toCharacter(row, refs.get(row.id) || []));
}

export async function getCharacter(db, id) {
  const row = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(id).first();
  if (!row) return null;
  const refs = await refsByCharacter(db, [id]);
  return toCharacter(row, refs.get(id) || []);
}

export async function createCharacter(db, { id, name, bible = '', styleNotes = '', refAssetIds = [] }) {
  const now = Date.now();
  const statements = [
    db
      .prepare('INSERT INTO characters (id, name, bible, style_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, bible, styleNotes, now, now),
    ...refAssetIds.slice(0, MAX_CHARACTER_REFS).map((assetId, position) =>
      db
        .prepare('INSERT INTO character_refs (character_id, asset_id, position, created_at) VALUES (?, ?, ?, ?)')
        .bind(id, assetId, position, now),
    ),
  ];
  await db.batch(statements);
  return getCharacter(db, id);
}

export async function updateCharacter(db, id, { name, bible, styleNotes, refAssetIds }) {
  const now = Date.now();
  const sets = ['updated_at = ?'];
  const binds = [now];
  if (name !== undefined) {
    sets.push('name = ?');
    binds.push(name);
  }
  if (bible !== undefined) {
    sets.push('bible = ?');
    binds.push(bible);
  }
  if (styleNotes !== undefined) {
    sets.push('style_notes = ?');
    binds.push(styleNotes);
  }
  const statements = [db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id)];
  if (refAssetIds !== undefined) {
    statements.push(db.prepare('DELETE FROM character_refs WHERE character_id = ?').bind(id));
    [...new Set(refAssetIds)].slice(0, MAX_CHARACTER_REFS).forEach((assetId, position) => {
      statements.push(
        db
          .prepare('INSERT INTO character_refs (character_id, asset_id, position, created_at) VALUES (?, ?, ?, ?)')
          .bind(id, assetId, position, now),
      );
    });
  }
  await db.batch(statements);
  return getCharacter(db, id);
}

export async function deleteCharacter(db, id) {
  await db.batch([
    db.prepare('DELETE FROM character_refs WHERE character_id = ?').bind(id),
    db.prepare('UPDATE generations SET character_id = NULL WHERE character_id = ?').bind(id),
    db.prepare('DELETE FROM characters WHERE id = ?').bind(id),
  ]);
}

// ── Generations ────────────────────────────────────────────────────────────

export function toGeneration(row, outputAsset = null) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    status: row.status,
    prompt: row.prompt,
    finalPrompt: row.final_prompt,
    settings: parseJson(row.settings, {}),
    inputs: parseJson(row.inputs, {}),
    characterId: row.character_id,
    interactionId: row.interaction_id,
    parentId: row.parent_id,
    rootId: row.root_id,
    outputAssetId: row.output_asset_id,
    output: outputAsset ? toAsset(outputAsset) : row.output_asset_id ? { id: row.output_asset_id, url: mediaUrl(row.output_asset_id) } : null,
    durationSeconds: row.duration_seconds,
    totalDurationSeconds: row.total_duration_seconds,
    costEstimate: row.cost_estimate,
    usage: parseJson(row.usage, null),
    favorite: !!row.favorite,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function insertGeneration(db, g) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO generations (id, kind, operation, provider, model, status, prompt, final_prompt, settings, inputs,
         character_id, interaction_id, parent_id, root_id, duration_seconds, total_duration_seconds, cost_estimate,
         error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      g.id,
      g.kind,
      g.operation || 'generate',
      g.provider,
      g.model,
      g.status,
      g.prompt || '',
      g.finalPrompt || '',
      JSON.stringify(g.settings || {}),
      JSON.stringify(g.inputs || {}),
      g.characterId || null,
      g.interactionId || null,
      g.parentId || null,
      g.rootId || g.id,
      g.durationSeconds ?? null,
      g.totalDurationSeconds ?? null,
      g.costEstimate ?? null,
      g.error || null,
      now,
      now,
    )
    .run();
}

const UPDATABLE = {
  status: 'status',
  interactionId: 'interaction_id',
  outputAssetId: 'output_asset_id',
  usage: 'usage',
  error: 'error',
  favorite: 'favorite',
  completedAt: 'completed_at',
};

export async function updateGeneration(db, id, fields) {
  const sets = ['updated_at = ?'];
  const binds = [Date.now()];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] === undefined) continue;
    let value = fields[key];
    if (key === 'usage') value = value == null ? null : JSON.stringify(value);
    if (key === 'favorite') value = value ? 1 : 0;
    sets.push(`${column} = ?`);
    binds.push(value);
  }
  await db.prepare(`UPDATE generations SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
}

/**
 * Atomically move a running job to "finalizing" so only one request copies
 * its output to R2. Stale claims (crashed request) can be retaken.
 */
export async function claimFinalize(db, id, staleAfterMs = 10 * 60 * 1000) {
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE generations SET status = 'finalizing', updated_at = ?
       WHERE id = ? AND (status = 'running' OR (status = 'finalizing' AND updated_at < ?))`,
    )
    .bind(now, id, now - staleAfterMs)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function getGenerationRow(db, id) {
  return db.prepare('SELECT * FROM generations WHERE id = ?').bind(id).first();
}

export async function getGeneration(db, id) {
  const row = await getGenerationRow(db, id);
  if (!row) return null;
  const asset = row.output_asset_id ? await getAssetRow(db, row.output_asset_id) : null;
  return toGeneration(row, asset);
}

export async function listGenerations(db, { kind = null, favorite = false, characterId = null, rootId = null, before = null, limit = 40 } = {}) {
  const where = [];
  const binds = [];
  if (kind) {
    where.push('g.kind = ?');
    binds.push(kind);
  }
  if (favorite) where.push('g.favorite = 1');
  if (characterId) {
    where.push('g.character_id = ?');
    binds.push(characterId);
  }
  if (rootId) {
    where.push('g.root_id = ?');
    binds.push(rootId);
  }
  if (before) {
    where.push('g.created_at < ?');
    binds.push(Number(before));
  }
  const sql = `SELECT g.*, a.id AS a_id, a.kind AS a_kind, a.mime_type AS a_mime_type, a.size_bytes AS a_size_bytes,
      a.source AS a_source, a.created_at AS a_created_at
    FROM generations g LEFT JOIN assets a ON a.id = g.output_asset_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY g.created_at ${rootId ? 'ASC' : 'DESC'} LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, Math.min(limit, 200)).all();
  return results.map((row) =>
    toGeneration(
      row,
      row.a_id
        ? { id: row.a_id, kind: row.a_kind, mime_type: row.a_mime_type, size_bytes: row.a_size_bytes, source: row.a_source, created_at: row.a_created_at }
        : null,
    ),
  );
}

export async function listUnfinishedGenerations(db, limit = 20) {
  const { results } = await db
    .prepare(`SELECT id FROM generations WHERE status IN ('running', 'finalizing') ORDER BY created_at ASC LIMIT ?`)
    .bind(limit)
    .all();
  return results.map((r) => r.id);
}

export async function spendSince(db, sinceMs) {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(cost_estimate), 0) AS total, COUNT(*) AS count FROM generations WHERE created_at >= ? AND status != 'failed'`)
    .bind(sinceMs)
    .first();
  return { total: row?.total || 0, count: row?.count || 0 };
}
