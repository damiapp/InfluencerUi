import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { autoTagRefs } from '@/lib/bibles';

// POST — tag angle / expression / lighting of every reference with the text model.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json({ character: await autoTagRefs(env, id) });
});
