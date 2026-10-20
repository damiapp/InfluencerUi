import { getEnv } from '@/lib/env';
import { json, route } from '@/lib/http';
import { listGenerations } from '@/lib/db';

// GET /api/generations?kind=image|video&favorite=1&characterId=&rootId=&before=<ms>&limit=40
export const GET = route(async (request) => {
  const env = await getEnv();
  const params = request.nextUrl.searchParams;
  const generations = await listGenerations(env.DB, {
    kind: params.get('kind'),
    favorite: params.get('favorite') === '1',
    characterId: params.get('characterId'),
    rootId: params.get('rootId'),
    before: params.get('before'),
    limit: Number(params.get('limit')) || 40,
  });
  return json({ generations });
});
