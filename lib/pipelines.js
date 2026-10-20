// Fixed "shoot → approve → animate" pipeline.
//
// A run is one generations row (kind 'pipeline') that the gallery shows as a
// single item. Its stills and videos are ordinary generations with
// pipeline_id pointing at the run, so they keep their own prompts,
// interaction ids, costs and blocked flags.

import { getModel } from 'studio/models';
import { buildImagePrompt, buildVideoPrompt, SINGLE_SHOT_TEXT } from 'studio/prompt';
import { primaryRefs, selectRefs } from 'studio/refs';
import { HttpError, newId } from './errors.js';
import { getCharacter, getGeneration, getGenerationRow, insertGeneration, listGenerations, updateGeneration } from './db.js';
import { resolveProviderId } from './providers/index.js';
import { refreshGeneration, startImageGeneration, startVideoGeneration } from './generations.js';

export const SHOOT_MODEL = 'gemini-3-pro-image';
export const ANIMATE_MODEL = 'gemini-omni-1.1-flash';
export const TEST_SETTINGS = { resolution: '360p', durationSeconds: 4 };
export const FINAL_RESOLUTION = '720p';
const ANIMATE_REFS = 2;

async function loadRun(env, id) {
  const row = await getGenerationRow(env.DB, id);
  if (!row || row.kind !== 'pipeline') throw new HttpError(404, 'Pipeline run not found');
  return row;
}

async function requireCharacter(env, id) {
  const character = id ? await getCharacter(env.DB, id) : null;
  if (!character) throw new HttpError(400, 'Pick a character');
  return character;
}

/** Validate a client-chosen reference subset (it must come from the character). */
function shootRefs(character, requested) {
  const model = getModel(SHOOT_MODEL);
  if (!requested?.length) return selectRefs(character.refs, model.maxReferenceImages).map((r) => r.id);
  const own = new Set(character.refs.map((r) => r.id));
  const ids = [...new Set(requested)].filter((id) => own.has(id));
  if (ids.length > model.maxReferenceImages) throw new HttpError(400, `${model.name} accepts at most ${model.maxReferenceImages} references`);
  return ids;
}

async function shoot(env, run, character, body) {
  const settings = JSON.parse(run.settings || '{}');
  const variants = Math.min(4, Math.max(2, Number(body.variants) || 4));
  const referenceAssetIds = shootRefs(character, body.referenceAssetIds);
  const scenePrompt = String(body.scenePrompt ?? settings.scenePrompt ?? '').trim();
  if (!scenePrompt) throw new HttpError(400, 'Write a scene prompt');
  const finalPrompt =
    String(body.finalPrompt || '').trim() ||
    buildImagePrompt({ character, characterRefCount: referenceAssetIds.length, prompt: scenePrompt });
  await startImageGeneration(
    env,
    {
      model: SHOOT_MODEL,
      prompt: scenePrompt,
      finalPrompt,
      characterId: character.id,
      referenceAssetIds,
      characterRefCount: referenceAssetIds.length,
      aspectRatio: settings.aspectRatio,
      imageSize: settings.imageSize,
      count: variants,
    },
    { pipelineId: run.id },
  );
  await updateGeneration(env.DB, run.id, { settings: { ...settings, scenePrompt }, finalPrompt });
}

/** Step 1: create a run and shoot 2–4 variants with Nano Banana Pro. */
export async function createPipeline(env, body) {
  const character = await requireCharacter(env, body.characterId);
  const id = newId('run');
  const settings = { aspectRatio: body.aspectRatio || '9:16', imageSize: body.imageSize || '2K', scenePrompt: String(body.scenePrompt || '').trim() };
  await insertGeneration(env.DB, {
    id,
    kind: 'pipeline',
    operation: 'pipeline',
    provider: resolveProviderId(env),
    model: SHOOT_MODEL,
    status: 'completed',
    prompt: settings.scenePrompt,
    settings,
    characterId: character.id,
  });
  try {
    await shoot(env, await loadRun(env, id), character, body);
  } finally {
    await syncPipeline(env, id);
  }
  return getPipeline(env, id);
}

/** Shoot more variants into an existing run. */
export async function shootMore(env, id, body) {
  const run = await loadRun(env, id);
  await shoot(env, run, await requireCharacter(env, run.character_id), body);
  await syncPipeline(env, id);
  return getPipeline(env, id);
}

/** Step 2: approve one still (one click). Blocked or failed stills can't be approved. */
export async function approveStill(env, id, stillId) {
  const run = await loadRun(env, id);
  const still = await getGenerationRow(env.DB, stillId);
  if (!still || still.pipeline_id !== run.id || still.kind !== 'image') throw new HttpError(400, 'That still is not part of this run');
  if (still.blocked) throw new HttpError(400, 'This still was blocked by Google and cannot be animated');
  if (still.status !== 'completed' || !still.output_asset_id) throw new HttpError(400, 'Only finished stills can be approved');
  const settings = JSON.parse(run.settings || '{}');
  await updateGeneration(env.DB, id, { settings: { ...settings, approvedStillId: stillId } });
  await syncPipeline(env, id);
  return getPipeline(env, id);
}

/** Prompt and media for animating the approved still (shared by preview and run). */
export function animateInputs(character, approvedAssetId, { motionPrompt, singleShot = true }) {
  const refs = primaryRefs(character.refs, ANIMATE_REFS);
  const motion = [String(motionPrompt || '').trim(), singleShot ? SINGLE_SHOT_TEXT : ''].filter(Boolean).join(' ');
  return {
    firstFrameAssetId: approvedAssetId,
    referenceAssetIds: refs.map((r) => r.id),
    finalPrompt: buildVideoPrompt({ character, hasFirstFrame: true, characterRefCount: refs.length, prompt: motion }),
    motion,
  };
}

/**
 * Step 3: animate the approved still with Gemini Omni Flash.
 * mode 'test' → 360p / 4 s. mode 'final' → 720p; by default it reuses the
 * latest test's exact prompt and inputs ("same inputs").
 */
export async function animate(env, id, body) {
  const run = await loadRun(env, id);
  const settings = JSON.parse(run.settings || '{}');
  if (!settings.approvedStillId) throw new HttpError(400, 'Approve a still first');
  const still = await getGenerationRow(env.DB, settings.approvedStillId);
  const character = await requireCharacter(env, run.character_id);
  const mode = body.mode === 'final' ? 'final' : 'test';

  let request;
  const test = settings.testVideoId ? await getGenerationRow(env.DB, settings.testVideoId) : null;
  if (mode === 'final' && test && body.sameAsTest !== false) {
    const inputs = JSON.parse(test.inputs || '{}');
    request = {
      prompt: test.prompt,
      finalPrompt: test.final_prompt,
      firstFrameAssetId: inputs.firstFrameAssetId,
      referenceAssetIds: inputs.referenceAssetIds || [],
      characterRefCount: inputs.characterRefCount || 0,
      durationSeconds: Number(body.durationSeconds) || test.duration_seconds || TEST_SETTINGS.durationSeconds,
    };
  } else {
    const built = animateInputs(character, still.output_asset_id, { motionPrompt: body.motionPrompt, singleShot: body.singleShot !== false });
    if (!built.motion) throw new HttpError(400, 'Write a motion prompt');
    request = {
      prompt: built.motion,
      finalPrompt: String(body.finalPrompt || '').trim() || built.finalPrompt,
      firstFrameAssetId: built.firstFrameAssetId,
      referenceAssetIds: built.referenceAssetIds,
      characterRefCount: built.referenceAssetIds.length,
      durationSeconds: mode === 'test' ? TEST_SETTINGS.durationSeconds : Number(body.durationSeconds) || TEST_SETTINGS.durationSeconds,
    };
  }

  const generation = await startVideoGeneration(
    env,
    {
      operation: 'generate',
      model: ANIMATE_MODEL,
      characterId: character.id,
      aspectRatio: '9:16',
      resolution: mode === 'test' ? TEST_SETTINGS.resolution : FINAL_RESOLUTION,
      ...request,
    },
    { pipelineId: run.id },
  );
  const key = mode === 'test' ? 'testVideoId' : 'finalVideoId';
  const fresh = JSON.parse((await loadRun(env, id)).settings || '{}');
  await updateGeneration(env.DB, id, { settings: { ...fresh, [key]: generation.id, motionPrompt: request.prompt } });
  await syncPipeline(env, id);
  return getPipeline(env, id);
}

/** Recompute the run's stage and cover image after any change. */
export async function syncPipeline(env, id) {
  const row = await getGenerationRow(env.DB, id);
  if (!row || row.kind !== 'pipeline') return;
  const settings = JSON.parse(row.settings || '{}');
  const children = await listGenerations(env.DB, { pipelineId: id, limit: 200 });
  const byId = new Map(children.map((g) => [g.id, g]));
  const done = (gid) => (byId.get(gid)?.status === 'completed' ? byId.get(gid) : null);
  const stills = children.filter((g) => g.kind === 'image');
  const finalVideo = byId.get(settings.finalVideoId);
  const testVideo = byId.get(settings.testVideoId);

  let stage = 'shoot';
  if (stills.length) stage = 'approve';
  if (settings.approvedStillId) stage = 'animate';
  if (testVideo) stage = testVideo.status === 'completed' ? 'tested' : testVideo.status === 'failed' ? 'test failed' : 'testing';
  if (finalVideo) stage = finalVideo.status === 'completed' ? 'done' : finalVideo.status === 'failed' ? 'final failed' : 'rendering final';

  const cover =
    done(settings.finalVideoId)?.outputAssetId ||
    done(settings.testVideoId)?.outputAssetId ||
    done(settings.approvedStillId)?.outputAssetId ||
    stills.find((s) => s.status === 'completed')?.outputAssetId ||
    null;
  await updateGeneration(env.DB, id, { settings: { ...settings, stage }, outputAssetId: cover });
}

/** Poll the provider for the run's unfinished videos, then resync. */
export async function refreshPipeline(env, id) {
  await loadRun(env, id);
  const children = await listGenerations(env.DB, { pipelineId: id, limit: 200 });
  for (const child of children) {
    if (child.status === 'running' || child.status === 'finalizing') await refreshGeneration(env, child.id);
  }
  await syncPipeline(env, id);
  return getPipeline(env, id);
}

export async function getPipeline(env, id) {
  await loadRun(env, id);
  const children = await listGenerations(env.DB, { pipelineId: id, limit: 200 });
  const run = await getGeneration(env.DB, id);
  const totalCost = children.filter((g) => g.status !== 'failed').reduce((sum, g) => sum + (g.costEstimate || 0), 0);
  return {
    run,
    stills: children.filter((g) => g.kind === 'image'),
    videos: children.filter((g) => g.kind === 'video'),
    totalCost: Math.round(totalCost * 10000) / 10000,
  };
}
