import { HttpError } from './errors.js';
import { MAX_CHARACTER_REFS, MAX_PRIMARY_REFS, getAssetRows, normalizeRefs } from './db.js';

/**
 * Validate a reference list from the client. Accepts tagged refs
 * ([{ assetId, angle, expression, lighting, primary }]) or plain asset ids;
 * plain ids keep the tags they already have on `existing` refs.
 */
export async function validateRefs(db, refs, existing = []) {
  if (!Array.isArray(refs)) throw new HttpError(400, 'refs must be an array');
  const byId = new Map(existing.map((r) => [r.id, r]));
  const expanded = refs.map((ref) => {
    if (typeof ref !== 'string') return ref;
    const old = byId.get(ref);
    return old ? { assetId: ref, angle: old.angle, expression: old.expression, lighting: old.lighting, primary: old.primary } : { assetId: ref };
  });
  const unique = new Set(expanded.map((r) => r?.assetId || r?.id).filter(Boolean));
  if (unique.size > MAX_CHARACTER_REFS) throw new HttpError(400, `A character can have at most ${MAX_CHARACTER_REFS} reference images`);
  if (expanded.filter((r) => r?.primary).length > MAX_PRIMARY_REFS) throw new HttpError(400, `Mark at most ${MAX_PRIMARY_REFS} references as primary`);
  const normalized = normalizeRefs(expanded);
  const rows = await getAssetRows(db, normalized.map((r) => r.assetId));
  if (rows.length !== normalized.length || rows.some((r) => r.kind !== 'image')) throw new HttpError(400, 'References must be existing images');
  return normalized;
}
