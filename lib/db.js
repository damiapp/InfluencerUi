// D1 data access. Rows are mapped to the camelCase objects the UI uses.

import { MAX_CHARACTER_REFS, MAX_PRIMARY_REFS } from 'studio/refs';

export { MAX_CHARACTER_REFS, MAX_PRIMARY_REFS };

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
    voiceDescription: row.voice_description || '',
    voiceId: row.voice_id || null,
    voicePreview: row.voice_preview_asset_id ? { id: row.voice_preview_asset_id, kind: 'audio', url: mediaUrl(row.voice_preview_asset_id) } : null,
    bibleData: parseJson(row.bible_data, null),
    bibleVersion: row.bible_version || 0,
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
      `SELECT a.*, r.character_id, r.position, r.angle, r.expression, r.lighting, r.is_primary
       FROM character_refs r JOIN assets a ON a.id = r.asset_id
       WHERE r.character_id IN (${placeholders}) ORDER BY r.character_id, r.position`,
    )
    .bind(...characterIds)
    .all();
  const map = new Map();
  for (const row of results) {
    if (!map.has(row.character_id)) map.set(row.character_id, []);
    map.get(row.character_id).push({
      ...toAsset(row),
      angle: row.angle || null,
      expression: row.expression || null,
      lighting: row.lighting || null,
      primary: !!row.is_primary,
    });
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

/**
 * Normalise a reference list: [{ assetId, angle, expression, lighting, primary }].
 * At most MAX_CHARACTER_REFS refs and MAX_PRIMARY_REFS primaries (first ones win).
 */
export function normalizeRefs(refs) {
  const seen = new Set();
  let primaries = 0;
  const out = [];
  for (const ref of refs || []) {
    const assetId = typeof ref === 'string' ? ref : ref?.assetId || ref?.id;
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    const primary = !!ref?.primary && primaries < MAX_PRIMARY_REFS;
    if (primary) primaries += 1;
    const tag = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);
    out.push({ assetId, angle: tag(ref?.angle), expression: tag(ref?.expression), lighting: tag(ref?.lighting), primary });
  }
  return out.slice(0, MAX_CHARACTER_REFS);
}

function refStatements(db, characterId, refs, now) {
  return normalizeRefs(refs).map((ref, position) =>
    db
      .prepare(
        `INSERT INTO character_refs (character_id, asset_id, position, angle, expression, lighting, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(characterId, ref.assetId, position, ref.angle, ref.expression, ref.lighting, ref.primary ? 1 : 0, now),
  );
}

export async function createCharacter(db, { id, name, bible = '', styleNotes = '', voiceDescription = '', refs = [] }) {
  const now = Date.now();
  await db.batch([
    db
      .prepare('INSERT INTO characters (id, name, bible, style_notes, voice_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, bible, styleNotes, voiceDescription, now, now),
    ...refStatements(db, id, refs, now),
  ]);
  return getCharacter(db, id);
}

export async function updateCharacter(db, id, { name, bible, styleNotes, voiceDescription, refs }) {
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
  if (voiceDescription !== undefined) {
    sets.push('voice_description = ?');
    binds.push(voiceDescription);
  }
  const statements = [db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id)];
  if (refs !== undefined) {
    statements.push(db.prepare('DELETE FROM character_refs WHERE character_id = ?').bind(id));
    statements.push(...refStatements(db, id, refs, now));
  }
  await db.batch(statements);
  return getCharacter(db, id);
}

/** Store the designed voice id and its preview clip. */
export async function setCharacterVoice(db, id, { voiceId, previewAssetId }) {
  await db
    .prepare('UPDATE characters SET voice_id = ?, voice_preview_asset_id = ?, updated_at = ? WHERE id = ?')
    .bind(voiceId, previewAssetId, Date.now(), id)
    .run();
  return getCharacter(db, id);
}

// ── Character bibles (versioned) ───────────────────────────────────────────

function toBibleVersion(row) {
  return {
    id: row.id,
    version: row.version,
    data: parseJson(row.data, null),
    source: row.source,
    model: row.model,
    refAssetIds: parseJson(row.ref_asset_ids, []),
    costEstimate: row.cost_estimate,
    createdAt: row.created_at,
  };
}

/** Save a new bible version and make it the character's current bible. */
export async function saveBibleVersion(db, characterId, { id, data, source, model = null, refAssetIds = [], costEstimate = null }) {
  const now = Date.now();
  const row = await db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM character_bibles WHERE character_id = ?').bind(characterId).first();
  const version = (row?.v || 0) + 1;
  const json = JSON.stringify(data);
  await db.batch([
    db
      .prepare(
        `INSERT INTO character_bibles (id, character_id, version, data, source, model, ref_asset_ids, cost_estimate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, characterId, version, json, source, model, JSON.stringify(refAssetIds), costEstimate, now),
    db.prepare('UPDATE characters SET bible_data = ?, bible_version = ?, updated_at = ? WHERE id = ?').bind(json, version, now, characterId),
  ]);
  return version;
}

export async function listBibleVersions(db, characterId) {
  const { results } = await db
    .prepare('SELECT * FROM character_bibles WHERE character_id = ? ORDER BY version DESC LIMIT 50')
    .bind(characterId)
    .all();
  return results.map(toBibleVersion);
}

export async function getBibleVersion(db, characterId, version) {
  const row = await db.prepare('SELECT * FROM character_bibles WHERE character_id = ? AND version = ?').bind(characterId, version).first();
  return row ? toBibleVersion(row) : null;
}

export async function deleteCharacter(db, id) {
  await db.batch([
    db.prepare('DELETE FROM character_bibles WHERE character_id = ?').bind(id),
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
    pipelineId: row.pipeline_id || null,
    blocked: !!row.blocked,
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
         error, pipeline_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      g.pipelineId || null,
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
  blocked: 'blocked',
  settings: 'settings',
  inputs: 'inputs',
  finalPrompt: 'final_prompt',
  costEstimate: 'cost_estimate',
  completedAt: 'completed_at',
};

export async function updateGeneration(db, id, fields) {
  const sets = ['updated_at = ?'];
  const binds = [Date.now()];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] === undefined) continue;
    let value = fields[key];
    if (key === 'usage') value = value == null ? null : JSON.stringify(value);
    if (key === 'favorite' || key === 'blocked') value = value ? 1 : 0;
    if (key === 'settings' || key === 'inputs') value = JSON.stringify(value || {});
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

export async function listGenerations(db, { kind = null, favorite = false, characterId = null, rootId = null, pipelineId = null, before = null, limit = 40 } = {}) {
  const where = [];
  const binds = [];
  // Stills and videos of a pipeline run are shown inside the run's item.
  if (pipelineId) {
    where.push('g.pipeline_id = ?');
    binds.push(pipelineId);
  } else if (!rootId) {
    where.push('g.pipeline_id IS NULL');
  }
  // Bookkeeping rows (reference tagging) have no media to show.
  if (!kind) where.push("g.kind != 'text'");
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
    ORDER BY g.created_at ${rootId || pipelineId ? 'ASC' : 'DESC'} LIMIT ?`;
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
  // Pipeline rows are containers (no cost of their own); bible writing is billed too.
  const [gens, bibles] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(cost_estimate), 0) AS total, COUNT(*) AS count FROM generations
         WHERE created_at >= ? AND status != 'failed' AND kind != 'pipeline'`,
      )
      .bind(sinceMs),
    db.prepare('SELECT COALESCE(SUM(cost_estimate), 0) AS total FROM character_bibles WHERE created_at >= ?').bind(sinceMs),
  ]);
  const g = gens.results?.[0] || {};
  const b = bibles.results?.[0] || {};
  return { total: (g.total || 0) + (b.total || 0), count: g.count || 0 };
}
