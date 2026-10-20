import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { designCharacterVoice } from '@/lib/voice';

// POST { voiceDescription } — Voice Design: create (or re-create) the character's stored voice.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  const body = await readJson(request);
  return json({ character: await designCharacterVoice(env, id, body) });
});
