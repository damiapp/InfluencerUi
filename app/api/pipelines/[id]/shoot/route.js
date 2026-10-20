import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { shootMore } from '@/lib/pipelines';

// POST { scenePrompt?, finalPrompt?, variants, referenceAssetIds? } — shoot more variants into the run.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json(await shootMore(env, id, await readJson(request)));
});
