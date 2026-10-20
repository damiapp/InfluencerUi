import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { sweepUnfinished } from '@/lib/sweep';

// POST — finalise any unfinished jobs (the gallery calls this on load).
export const POST = route(async () => {
  const env = await getEnv();
  return json({ results: await sweepUnfinished(env, { limit: 10 }) });
});
