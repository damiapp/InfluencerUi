import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { startImageGeneration } from '@/lib/generations';

// POST { model, prompt, finalPrompt, characterId, referenceAssetIds, characterRefCount, aspectRatio, imageSize, count }
// Runs synchronously and returns the finished (or failed) generations.
export const POST = route(async (request) => {
  const env = await getEnv();
  const generations = await startImageGeneration(env, await readJson(request));
  return json({ generations });
});
