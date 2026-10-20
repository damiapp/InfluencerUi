import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { bibleHistory, saveBible } from '@/lib/bibles';

// GET — version history of the character bible.
export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json({ versions: await bibleHistory(env, id) });
});

// PUT { data } saves hand edits; PUT { restoreVersion } restores an old version. Both create a new version.
export const PUT = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  return json(await saveBible(env, id, await readJson(request)));
});
