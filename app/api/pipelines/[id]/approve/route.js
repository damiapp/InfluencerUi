import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { approveStill } from '@/lib/pipelines';

// POST { stillId } — Step 2 (Approve): only the approved still can be animated.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  const { stillId } = await readJson(request);
  return json(await approveStill(env, id, stillId));
});
