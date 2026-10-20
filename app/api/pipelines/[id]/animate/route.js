import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { animate } from '@/lib/pipelines';

// POST { mode: 'test' | 'final', motionPrompt, finalPrompt?, singleShot?, durationSeconds?, sameAsTest? }
// Step 3 (Animate): approved still as <FIRST_FRAME> + 1–2 primary refs with Gemini Omni Flash.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json(await animate(env, id, await readJson(request)));
});
