import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { createPipeline } from '@/lib/pipelines';

// POST { characterId, scenePrompt, finalPrompt?, variants (2–4), referenceAssetIds?, aspectRatio?, imageSize? }
// Step 1 (Shoot): creates a run and generates the variants with Nano Banana Pro.
export const POST = route(async (request) => {
  const env = await getEnv();
  return json(await createPipeline(env, await readJson(request)));
});
