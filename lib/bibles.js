// Character bible (structured JSON written by a multimodal Gemini model from
// the reference images) and reference auto-tagging.

import { BIBLE_MODEL, BIBLE_SCHEMA, bibleInstructions, normalizeBible } from 'studio/bible';
import { TAGS_SCHEMA, tagInstructions } from 'studio/refs';
import { estimateCost, textCostFromUsage } from 'studio/pricing';
import pricing from '../config/pricing.json' with { type: 'json' };
import { getProvider } from './providers/index.js';
import { HttpError, newId } from './errors.js';
import { mediaInputs } from './generations.js';
import { getBibleVersion, getCharacter, insertGeneration, listBibleVersions, saveBibleVersion, updateCharacter } from './db.js';

async function requireCharacter(env, id) {
  const character = await getCharacter(env.DB, id);
  if (!character) throw new HttpError(404, 'Character not found');
  return character;
}

function costOf(usage, imageCount) {
  return textCostFromUsage(pricing, BIBLE_MODEL, usage) ?? estimateCost(pricing, { kind: 'text', model: BIBLE_MODEL, inputImages: imageCount });
}

/** Send every reference to the text model and save the result as a new version. */
export async function generateBible(env, characterId) {
  const character = await requireCharacter(env, characterId);
  if (!character.refs.length) throw new HttpError(400, 'Add reference images first');
  const media = await mediaInputs(env, character.refs.map((r) => r.id));
  const provider = getProvider(env);
  const result = await provider.generateStructured({
    model: BIBLE_MODEL,
    prompt: bibleInstructions(character.name, media.length),
    media,
    schema: BIBLE_SCHEMA,
  });
  const data = normalizeBible(result.data);
  if (!data.prompt_paragraph) throw new HttpError(502, 'The model did not return a prompt paragraph; try again.');
  await saveBibleVersion(env.DB, characterId, {
    id: newId('bib'),
    data,
    source: 'generated',
    model: BIBLE_MODEL,
    refAssetIds: character.refs.map((r) => r.id),
    costEstimate: costOf(result.usage, media.length),
  });
  return { character: await getCharacter(env.DB, characterId), versions: await listBibleVersions(env.DB, characterId) };
}

/** Save hand edits (or restore an older version) as a new version. */
export async function saveBible(env, characterId, { data, restoreVersion }) {
  await requireCharacter(env, characterId);
  let source = 'edited';
  let bible = data;
  if (restoreVersion) {
    const old = await getBibleVersion(env.DB, characterId, Number(restoreVersion));
    if (!old) throw new HttpError(404, 'Version not found');
    bible = old.data;
    source = 'restored';
  }
  const normalized = normalizeBible(bible);
  if (!normalized.prompt_paragraph) throw new HttpError(400, 'The prompt paragraph cannot be empty');
  await saveBibleVersion(env.DB, characterId, { id: newId('bib'), data: normalized, source });
  return { character: await getCharacter(env.DB, characterId), versions: await listBibleVersions(env.DB, characterId) };
}

export async function bibleHistory(env, characterId) {
  await requireCharacter(env, characterId);
  return listBibleVersions(env.DB, characterId);
}

/** Tag angle / expression / lighting of every reference with the text model. */
export async function autoTagRefs(env, characterId) {
  const character = await requireCharacter(env, characterId);
  if (!character.refs.length) throw new HttpError(400, 'Add reference images first');
  const media = await mediaInputs(env, character.refs.map((r) => r.id));
  const provider = getProvider(env);
  const result = await provider.generateStructured({ model: BIBLE_MODEL, prompt: tagInstructions(media.length), media, schema: TAGS_SCHEMA });
  const tags = new Map((result.data?.refs || []).map((t) => [Number(t.index), t]));
  const refs = character.refs.map((ref, index) => {
    const tag = tags.get(index) || {};
    return { assetId: ref.id, angle: tag.angle || ref.angle, expression: tag.expression || ref.expression, lighting: tag.lighting || ref.lighting, primary: ref.primary };
  });
  // Record the spend so it shows up in the monthly total (not in the gallery).
  const id = newId('gen');
  await insertGeneration(env.DB, {
    id,
    kind: 'text',
    operation: 'tag',
    provider: provider.id,
    model: BIBLE_MODEL,
    status: 'completed',
    prompt: `Auto-tag ${media.length} references of ${character.name}`,
    characterId,
    costEstimate: costOf(result.usage, media.length),
  });
  return updateCharacter(env.DB, characterId, { refs });
}
