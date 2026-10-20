import { getEnv } from '@/lib/env';
import { HttpError, json, readJson, route } from '@/lib/http';
import { deleteCharacter, getCharacter, updateCharacter } from '@/lib/db';
import { validateRefs } from '@/lib/characters';

async function load(env, params) {
  const { id } = await params;
  const character = await getCharacter(env.DB, id);
  if (!character) throw new HttpError(404, 'Character not found');
  return character;
}

export const GET = route(async (request, { params }) => {
  const env = await getEnv();
  return json({ character: await load(env, params) });
});

export const PATCH = route(async (request, { params }) => {
  const env = await getEnv();
  const existing = await load(env, params);
  const body = await readJson(request);
  const changes = {};
  if (body.name !== undefined) {
    changes.name = String(body.name).trim();
    if (!changes.name) throw new HttpError(400, 'Name is required');
  }
  if (body.bible !== undefined) changes.bible = String(body.bible);
  if (body.styleNotes !== undefined) changes.styleNotes = String(body.styleNotes);
  if (body.voiceDescription !== undefined) changes.voiceDescription = String(body.voiceDescription);
  if (body.refAssetIds !== undefined) changes.refAssetIds = await validateRefs(env.DB, body.refAssetIds);
  return json({ character: await updateCharacter(env.DB, existing.id, changes) });
});

export const DELETE = route(async (request, { params }) => {
  const env = await getEnv();
  const existing = await load(env, params);
  await deleteCharacter(env.DB, existing.id);
  return json({ ok: true });
});
