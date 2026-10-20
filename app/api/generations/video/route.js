import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { startVideoGeneration } from '@/lib/generations';

// POST { operation: generate|edit|extend, parentId, model, prompt, finalPrompt, characterId,
//        firstFrameAssetId, lastFrameAssetId, referenceAssetIds, characterRefCount,
//        aspectRatio, resolution, durationSeconds, keepEverythingElse }
// Starts the job and returns the generation; poll GET /api/generations/:id.
export const POST = route(async (request) => {
  const env = await getEnv();
  const generation = await startVideoGeneration(env, await readJson(request));
  return json({ generation });
});
