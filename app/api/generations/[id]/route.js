import { getEnv } from '@/lib/env';
import { HttpError, json, readJson, route } from '@/lib/http';
import { getGenerationRow, getGeneration, updateGeneration } from '@/lib/db';
import { refreshGeneration } from '@/lib/generations';

// GET polls the provider for unfinished jobs and copies finished output to R2.
export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json({ generation: await refreshGeneration(env, id) });
});

// PATCH { favorite }
export const PATCH = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  if (!(await getGenerationRow(env.DB, id))) throw new HttpError(404, 'Generation not found');
  const body = await readJson(request);
  if (body.favorite !== undefined) await updateGeneration(env.DB, id, { favorite: !!body.favorite });
  return json({ generation: await getGeneration(env.DB, id) });
});
