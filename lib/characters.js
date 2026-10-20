import { HttpError } from './errors.js';
import { MAX_CHARACTER_REFS, getAssetRows } from './db.js';

export async function validateRefs(db, refAssetIds) {
  if (!Array.isArray(refAssetIds)) throw new HttpError(400, 'refAssetIds must be an array');
  const unique = [...new Set(refAssetIds)];
  if (unique.length > MAX_CHARACTER_REFS) throw new HttpError(400, `A character can have at most ${MAX_CHARACTER_REFS} reference images`);
  const rows = await getAssetRows(db, unique);
  if (rows.length !== unique.length || rows.some((r) => r.kind !== 'image')) throw new HttpError(400, 'References must be existing images');
  return unique;
}
