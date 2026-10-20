import { getEnv } from '@/lib/env';
import { HttpError, json, newId, readJson, route } from '@/lib/http';
import { createCharacter, listCharacters } from '@/lib/db';
import { validateRefs } from '@/lib/characters';

export const GET = route(async () => {
  const env = await getEnv();
  return json({ characters: await listCharacters(env.DB) });
});

export const POST = route(async (request) => {
  const env = await getEnv();
  const body = await readJson(request);
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const refAssetIds = await validateRefs(env.DB, body.refAssetIds || []);
  const character = await createCharacter(env.DB, {
    id: newId('chr'),
    name,
    bible: String(body.bible || ''),
    styleNotes: String(body.styleNotes || ''),
    voiceDescription: String(body.voiceDescription || ''),
    refAssetIds,
  });
  return json({ character }, { status: 201 });
});
