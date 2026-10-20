// Character voices (Gemini Voice Design + TTS) and voiceover versions of clips.
//
// Omni cannot take a stored voice, so for an exact, repeatable voice the
// script is spoken by TTS with the character's voice id and muxed onto the
// clip in the browser; the result is uploaded back as a "voiceover" version.

import { DEFAULT_SPEECH_MODEL } from 'studio/models';
import { estimateCost } from 'studio/pricing';
import pricing from '../config/pricing.json' with { type: 'json' };
import { getProvider } from './providers/index.js';
import { wavDurationSeconds } from './providers/wav.js';
import { HttpError, newId } from './errors.js';
import { storeAsset } from './storage.js';
import {
  getCharacter,
  getGeneration,
  getGenerationRow,
  insertGeneration,
  setCharacterVoice,
  updateCharacter,
  updateGeneration,
} from './db.js';

const MAX_SCRIPT_CHARS = 1500;

async function speak(env, provider, character, { text, style = '', purpose = 'line' }) {
  const id = newId('gen');
  await insertGeneration(env.DB, {
    id,
    kind: 'audio',
    operation: 'speech',
    provider: provider.id,
    model: DEFAULT_SPEECH_MODEL,
    status: 'running',
    prompt: text,
    finalPrompt: text,
    settings: { voiceId: character.voiceId, style: style || undefined, purpose },
    characterId: character.id,
  });
  try {
    const result = await provider.generateSpeech({ model: DEFAULT_SPEECH_MODEL, voiceId: character.voiceId, text, style: style || undefined });
    const output = result.outputs?.[0];
    if (result.status !== 'completed' || !output) {
      await updateGeneration(env.DB, id, { status: 'failed', error: result.error || 'No audio returned' });
      return getGeneration(env.DB, id);
    }
    const file = await provider.fetchOutput(output);
    const bytes = file.body instanceof Uint8Array ? file.body : new Uint8Array(await new Response(file.body).arrayBuffer());
    const seconds = wavDurationSeconds(bytes);
    const asset = await storeAsset(env, { body: bytes, size: bytes.byteLength, mimeType: file.mimeType || 'audio/wav', source: 'generation', generationId: id });
    await env.DB.prepare('UPDATE generations SET duration_seconds = ?, total_duration_seconds = ?, cost_estimate = ? WHERE id = ?')
      .bind(seconds, seconds, estimateCost(pricing, { kind: 'audio', model: DEFAULT_SPEECH_MODEL, durationSeconds: seconds || 0 }), id)
      .run();
    await updateGeneration(env.DB, id, { status: 'completed', outputAssetId: asset.id, usage: result.usage, completedAt: Date.now() });
  } catch (error) {
    await updateGeneration(env.DB, id, { status: 'failed', error: String(error.message || error).slice(0, 2000) });
  }
  return getGeneration(env.DB, id);
}

/** Voice Design from the character's voice description, plus a preview line. */
export async function designCharacterVoice(env, characterId, { voiceDescription }) {
  const character = await getCharacter(env.DB, characterId);
  if (!character) throw new HttpError(404, 'Character not found');
  const description = String(voiceDescription ?? character.voiceDescription ?? '').trim();
  if (description.length < 10) throw new HttpError(400, 'Describe the voice first (age, pitch, accent, pace, energy).');
  await updateCharacter(env.DB, characterId, { voiceDescription: description });

  const provider = getProvider(env);
  const { voiceId } = await provider.designVoice({ name: character.name, description });
  const preview = await speak(env, provider, { ...character, voiceId }, {
    text: `Hi, I'm ${character.name}. This is my voice — let's make something fun today!`,
    purpose: 'preview',
  });
  return setCharacterVoice(env.DB, characterId, {
    voiceId,
    previewAssetId: preview.status === 'completed' ? preview.outputAssetId : null,
  });
}

/** Speak a script with the character's stored voice. */
export async function generateCharacterSpeech(env, { characterId, text, style }) {
  const character = characterId ? await getCharacter(env.DB, characterId) : null;
  if (!character) throw new HttpError(400, 'Choose a character for the voiceover');
  if (!character.voiceId) throw new HttpError(400, `${character.name} has no designed voice yet. Design one in Characters.`);
  const script = String(text || '').trim();
  if (!script) throw new HttpError(400, 'The script is empty');
  if (script.length > MAX_SCRIPT_CHARS) throw new HttpError(400, `Keep the script under ${MAX_SCRIPT_CHARS} characters`);
  return speak(env, getProvider(env), character, { text: script, style: String(style || '').trim() });
}

/** Store a browser-muxed clip + voiceover as a new version of the clip. */
export async function saveVoiceover(env, clipId, { file, speechGenerationId, mix }) {
  const clip = await getGenerationRow(env.DB, clipId);
  if (!clip || clip.kind !== 'video' || clip.status !== 'completed') throw new HttpError(400, 'Pick a finished clip');
  const speech = speechGenerationId ? await getGenerationRow(env.DB, speechGenerationId) : null;
  if (!speech || speech.kind !== 'audio' || speech.status !== 'completed') throw new HttpError(400, 'Generate the voiceover audio first');

  const id = newId('gen');
  const clipSettings = JSON.parse(clip.settings || '{}');
  await insertGeneration(env.DB, {
    id,
    kind: 'video',
    operation: 'voiceover',
    provider: clip.provider,
    model: clip.model,
    status: 'running',
    prompt: speech.prompt,
    finalPrompt: speech.final_prompt,
    settings: { aspectRatio: clipSettings.aspectRatio, resolution: clipSettings.resolution, mix },
    inputs: { sourceClipId: clip.id, speechGenerationId: speech.id, audioAssetId: speech.output_asset_id },
    characterId: speech.character_id || clip.character_id,
    parentId: clip.id,
    rootId: clip.root_id || clip.id,
    durationSeconds: clip.total_duration_seconds,
    totalDurationSeconds: clip.total_duration_seconds,
    // The speech was already counted when it was generated; muxing is free.
    costEstimate: 0,
  });
  const asset = await storeAsset(env, {
    body: await file.arrayBuffer(),
    size: file.size,
    mimeType: file.type || 'video/mp4',
    source: 'generation',
    generationId: id,
  });
  await updateGeneration(env.DB, id, { status: 'completed', outputAssetId: asset.id, completedAt: Date.now() });
  return getGeneration(env.DB, id);
}
