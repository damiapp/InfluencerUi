import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { generateBible } from '@/lib/bibles';

// POST — write a new bible version from all reference images (structured JSON output).
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json(await generateBible(env, id));
});
