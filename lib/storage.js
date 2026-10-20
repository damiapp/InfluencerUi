// R2 helpers. Every upload and every generated output is stored here; the
// browser only ever sees /api/media/<assetId> URLs.

import { newId } from './errors.js';
import { insertAsset } from './db.js';

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export const ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function mediaUrl(assetId) {
  return assetId ? `/api/media/${assetId}` : null;
}

async function toPutBody(body, size) {
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body;
  // In Workers, streams with a known length go straight to R2 without
  // buffering (videos can be large). Elsewhere (local dev) buffer them.
  if (size != null && typeof FixedLengthStream !== 'undefined') {
    const fixed = new FixedLengthStream(size);
    body.pipeTo(fixed.writable).catch((error) => console.error('R2 upload stream failed', error));
    return fixed.readable;
  }
  return new Response(body).arrayBuffer();
}

/**
 * Store bytes in R2 and register an asset row.
 * @returns {Promise<object>} the asset row
 */
export async function storeAsset(env, { body, size = null, mimeType, source, originalName = null, generationId = null }) {
  const id = newId('ast');
  const kind = mimeType.startsWith('video/') ? 'video' : 'image';
  const ext = EXTENSIONS[mimeType] || 'bin';
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  const r2Key = `${source}s/${month}/${id}.${ext}`;

  const putBody = await toPutBody(body, size);
  const stored = await env.MEDIA.put(r2Key, putBody, { httpMetadata: { contentType: mimeType } });

  const asset = {
    id,
    r2_key: r2Key,
    kind,
    mime_type: mimeType,
    size_bytes: stored?.size ?? size ?? (putBody.byteLength || null),
    source,
    original_name: originalName,
    generation_id: generationId,
    created_at: now,
  };
  await insertAsset(env.DB, asset);
  return asset;
}

export async function loadAssetBytes(env, asset) {
  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new Error(`Media ${asset.id} is missing from R2`);
  return object.arrayBuffer();
}
