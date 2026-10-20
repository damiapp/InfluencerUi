import { getEnv } from '@/lib/env';
import { HttpError, json, readJson, route } from '@/lib/http';
import { MAX_CHARACTER_REFS, getAssetRow, getCharacter, updateCharacter } from '@/lib/db';
import { validateRefs } from '@/lib/characters';

// POST { assetId, angle?, expression?, lighting? } — "Promote to reference":
// append an approved image to the character's reference library.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  const character = await getCharacter(env.DB, id);
  if (!character) throw new HttpError(404, 'Character not found');
  const { assetId, angle, expression, lighting } = await readJson(request);
  const asset = assetId ? await getAssetRow(env.DB, assetId) : null;
  if (!asset || asset.kind !== 'image') throw new HttpError(400, 'Only images can be references');

  const current = character.refs.map((r) => r.id);
  if (current.includes(assetId)) return json({ character });
  if (current.length >= MAX_CHARACTER_REFS) {
    throw new HttpError(400, `${character.name} already has ${MAX_CHARACTER_REFS} references. Remove one in the Characters tab first.`);
  }
  const refs = await validateRefs(env.DB, [...current, { assetId, angle, expression, lighting }], character.refs);
  return json({ character: await updateCharacter(env.DB, id, { refs }) });
});
