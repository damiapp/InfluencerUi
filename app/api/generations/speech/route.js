import { getEnv } from '@/lib/env';
import { json, readJson, route } from '@/lib/http';
import { generateCharacterSpeech } from '@/lib/voice';

// POST { characterId, text, style } — speak a script with the character's stored voice.
export const POST = route(async (request) => {
  const env = await getEnv();
  return json({ generation: await generateCharacterSpeech(env, await readJson(request)) });
});
