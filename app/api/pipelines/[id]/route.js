import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { refreshPipeline } from '@/lib/pipelines';

// GET — the run with its stills, videos and total cost (polls unfinished videos).
export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json(await refreshPipeline(env, id));
});
