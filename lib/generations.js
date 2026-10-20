// Generation orchestration: validate a request, call the provider, record
// everything in D1, and copy every output into R2 as soon as it exists.

import { getModel } from 'studio/models';
import { estimateCost } from 'studio/pricing';
import pricing from '../config/pricing.json' with { type: 'json' };
import { getProvider } from './providers/index.js';
import { HttpError, newId } from './errors.js';
import { storeAsset, loadAssetBytes } from './storage.js';
import {
  claimFinalize,
  getAssetRows,
  getCharacter,
  getGeneration,
  getGenerationRow,
  insertGeneration,
  setAssetGoogleFile,
  updateGeneration,
} from './db.js';

export { pricing };

function requireModel(id, kind) {
  const model = getModel(id);
  if (!model || model.kind !== kind) throw new HttpError(400, `Unknown ${kind} model "${id}"`);
  return model;
}

function oneOf(value, allowed, label) {
  if (value == null) return undefined;
  if (!allowed.includes(value)) throw new HttpError(400, `Unsupported ${label} "${value}"`);
  return value;
}

/** Load asset rows (keeping order) and wrap them as provider media inputs. */
async function mediaInputs(env, assetIds) {
  if (!assetIds.length) return [];
  const rows = await getAssetRows(env.DB, assetIds);
  if (rows.length !== assetIds.length) throw new HttpError(400, 'One or more reference images no longer exist');
  return rows.map((row) => {
    if (row.kind !== 'image') throw new HttpError(400, 'References and frames must be images');
    return {
      assetId: row.id,
      mimeType: row.mime_type,
      cachedUri: row.google_file_uri,
      cachedUriExpiresAt: row.google_file_expires_at,
      load: () => loadAssetBytes(env, row),
      onUploaded: (uri, expiresAt) => setAssetGoogleFile(env.DB, row.id, uri, expiresAt),
    };
  });
}

async function saveOutput(env, provider, generationId, output) {
  const file = await provider.fetchOutput(output);
  return storeAsset(env, {
    body: file.body,
    size: file.size,
    mimeType: file.mimeType || output.mimeType,
    source: 'generation',
    generationId,
  });
}

async function fail(env, id, error) {
  await updateGeneration(env.DB, id, { status: 'failed', error: String(error?.message || error).slice(0, 2000) });
}

// ── Images ─────────────────────────────────────────────────────────────────

export async function startImageGeneration(env, body) {
  const model = requireModel(body.model, 'image');
  const prompt = String(body.prompt || '');
  const finalPrompt = String(body.finalPrompt || prompt).trim();
  if (!finalPrompt) throw new HttpError(400, 'Prompt is empty');

  const referenceAssetIds = (body.referenceAssetIds || []).filter(Boolean);
  if (referenceAssetIds.length > model.maxReferenceImages) {
    throw new HttpError(400, `${model.name} accepts at most ${model.maxReferenceImages} reference images`);
  }
  const aspectRatio = oneOf(body.aspectRatio, model.aspectRatios, 'aspect ratio');
  const imageSize = oneOf(body.imageSize, model.imageSizes, 'image size') || model.defaultImageSize;
  const count = Math.min(4, Math.max(1, Number(body.count) || 1));
  const characterId = body.characterId || null;
  if (characterId && !(await getCharacter(env.DB, characterId))) throw new HttpError(400, 'Character not found');

  const provider = getProvider(env);
  const media = await mediaInputs(env, referenceAssetIds);
  const costEach = estimateCost(pricing, { kind: 'image', model: model.id, imageSize, count: 1, inputImages: media.length });
  const settings = { aspectRatio, imageSize };
  const inputs = { referenceAssetIds, characterRefCount: Number(body.characterRefCount) || 0 };

  const runOne = async () => {
    const id = newId('gen');
    await insertGeneration(env.DB, {
      id,
      kind: 'image',
      provider: provider.id,
      model: model.id,
      status: 'running',
      prompt,
      finalPrompt,
      settings,
      inputs,
      characterId,
      costEstimate: costEach,
    });
    try {
      const result = await provider.generateImage({ model: model.id, prompt: finalPrompt, media, aspectRatio, imageSize });
      if (result.status !== 'completed' || !result.outputs?.length) {
        await updateGeneration(env.DB, id, { status: 'failed', interactionId: result.jobId || null, error: result.error || 'No image returned', usage: result.usage });
      } else {
        const asset = await saveOutput(env, provider, id, result.outputs[0]);
        await updateGeneration(env.DB, id, {
          status: 'completed',
          interactionId: result.jobId || null,
          outputAssetId: asset.id,
          usage: result.usage,
          completedAt: Date.now(),
        });
      }
    } catch (error) {
      await fail(env, id, error);
    }
    return getGeneration(env.DB, id);
  };

  // Uploads of shared references are cached after the first call, so run the
  // first image alone and the rest in parallel.
  const first = await runOne();
  const rest = await Promise.all(Array.from({ length: count - 1 }, runOne));
  return [first, ...rest];
}

// ── Video ──────────────────────────────────────────────────────────────────

export async function startVideoGeneration(env, body) {
  const operation = body.operation || 'generate';
  if (!['generate', 'edit', 'extend'].includes(operation)) throw new HttpError(400, `Unknown operation "${operation}"`);

  const prompt = String(body.prompt || '');
  const finalPrompt = String(body.finalPrompt || prompt).trim();
  if (!finalPrompt) throw new HttpError(400, 'Prompt is empty');

  let parent = null;
  if (operation !== 'generate') {
    parent = await getGenerationRow(env.DB, body.parentId);
    if (!parent || parent.kind !== 'video') throw new HttpError(400, 'Choose a finished clip to continue from');
    if (parent.status !== 'completed' || !parent.interaction_id) throw new HttpError(400, 'That clip has not finished yet');
  }

  const model = requireModel(parent?.model || body.model, 'video');
  const parentSettings = parent ? JSON.parse(parent.settings || '{}') : {};
  const aspectRatio = oneOf(parentSettings.aspectRatio || body.aspectRatio || model.defaultAspectRatio, model.aspectRatios, 'aspect ratio');
  const resolution = oneOf(body.resolution || parentSettings.resolution || model.defaultResolution, model.resolutions, 'resolution');

  let durationSeconds;
  let totalDurationSeconds;
  if (operation === 'generate') {
    durationSeconds = Math.round(Number(body.durationSeconds) || model.defaultDurationSeconds);
    if (durationSeconds < model.minDurationSeconds || durationSeconds > model.maxDurationSeconds) {
      throw new HttpError(400, `Duration must be ${model.minDurationSeconds}–${model.maxDurationSeconds} seconds`);
    }
    totalDurationSeconds = durationSeconds;
  } else if (operation === 'edit') {
    totalDurationSeconds = parent.total_duration_seconds || parent.duration_seconds || model.maxEditSeconds;
    if (totalDurationSeconds > model.maxEditSeconds) {
      throw new HttpError(400, `Edits work on clips of up to ${model.maxEditSeconds} seconds; this one is ${totalDurationSeconds} s`);
    }
    durationSeconds = totalDurationSeconds;
  } else {
    durationSeconds = model.extendStepSeconds;
    totalDurationSeconds = (parent.total_duration_seconds || parent.duration_seconds || 0) + durationSeconds;
    if (totalDurationSeconds > model.maxTotalSeconds) {
      throw new HttpError(400, `Clips can be extended up to ${model.maxTotalSeconds} seconds in total`);
    }
  }

  const firstFrameAssetId = operation === 'generate' ? body.firstFrameAssetId || null : null;
  const lastFrameAssetId = firstFrameAssetId ? body.lastFrameAssetId || null : null;
  const referenceAssetIds = operation === 'edit' ? [] : (body.referenceAssetIds || []).filter(Boolean);
  if (referenceAssetIds.length > model.maxReferenceImages) {
    throw new HttpError(400, `${model.name} accepts at most ${model.maxReferenceImages} reference images`);
  }
  const characterId = body.characterId || parent?.character_id || null;
  if (body.characterId && !(await getCharacter(env.DB, body.characterId))) throw new HttpError(400, 'Character not found');

  const orderedMediaIds = [firstFrameAssetId, lastFrameAssetId, ...referenceAssetIds].filter(Boolean);
  const media = await mediaInputs(env, orderedMediaIds);
  const provider = getProvider(env);
  if (parent && parent.provider !== provider.id) {
    throw new HttpError(400, `This clip was made with the "${parent.provider}" provider; switch back to it to continue the clip`);
  }

  const id = newId('gen');
  const costEstimate = estimateCost(pricing, { kind: 'video', model: model.id, resolution, durationSeconds, inputImages: media.length });
  await insertGeneration(env.DB, {
    id,
    kind: 'video',
    operation,
    provider: provider.id,
    model: model.id,
    status: 'running',
    prompt,
    finalPrompt,
    settings: { aspectRatio, resolution, durationSeconds, keepEverythingElse: operation === 'edit' ? !!body.keepEverythingElse : undefined },
    inputs: { firstFrameAssetId, lastFrameAssetId, referenceAssetIds, characterRefCount: Number(body.characterRefCount) || 0 },
    characterId,
    parentId: parent?.id || null,
    rootId: parent ? parent.root_id || parent.id : id,
    durationSeconds,
    totalDurationSeconds,
    costEstimate,
  });

  try {
    let result;
    if (operation === 'generate') {
      result = await provider.generateVideo({ model: model.id, prompt: finalPrompt, media, aspectRatio, resolution, durationSeconds });
    } else if (operation === 'edit') {
      result = await provider.editVideo({ model: model.id, previousJobId: parent.interaction_id, prompt: finalPrompt, aspectRatio, resolution });
    } else {
      result = await provider.extendVideo({
        model: model.id,
        previousJobId: parent.interaction_id,
        prompt: finalPrompt,
        media,
        aspectRatio,
        resolution,
        durationSeconds,
      });
    }
    await updateGeneration(env.DB, id, { interactionId: result.jobId || null, usage: result.usage || null });
    await applyJobResult(env, provider, id, result);
  } catch (error) {
    await fail(env, id, error);
  }
  return getGeneration(env.DB, id);
}

async function applyJobResult(env, provider, id, result) {
  if (result.status === 'running') return;
  if (result.status === 'failed') {
    await updateGeneration(env.DB, id, { status: 'failed', error: result.error || 'Generation failed', usage: result.usage });
    return;
  }
  if (!(await claimFinalize(env.DB, id))) return;
  try {
    const output = result.outputs.find((o) => o.kind === 'video') || result.outputs[0];
    const asset = await saveOutput(env, provider, id, output);
    await updateGeneration(env.DB, id, {
      status: 'completed',
      outputAssetId: asset.id,
      usage: result.usage,
      completedAt: Date.now(),
      error: null,
    });
  } catch (error) {
    // Leave it retryable: the next poll or the cron sweep tries again.
    await updateGeneration(env.DB, id, { status: 'running', error: `Saving output failed, will retry: ${error.message}` });
  }
}

/** Poll the provider for an unfinished job and finalise it when done. */
export async function refreshGeneration(env, id) {
  const row = await getGenerationRow(env.DB, id);
  if (!row) throw new HttpError(404, 'Generation not found');
  if ((row.status === 'running' || row.status === 'finalizing') && row.interaction_id) {
    const provider = getProvider(env, row.provider);
    try {
      const result = await provider.getStatus(row.interaction_id);
      await applyJobResult(env, provider, id, result);
    } catch (error) {
      // Transient polling errors should not kill the job.
      console.error(`refresh ${id} failed`, error);
      if (error.status === 404) await fail(env, id, error);
    }
  }
  return getGeneration(env.DB, id);
}
