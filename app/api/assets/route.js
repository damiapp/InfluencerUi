import { getEnv } from '@/lib/env';
import { HttpError, json, route } from '@/lib/http';
import { listAssets, toAsset } from '@/lib/db';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, storeAsset } from '@/lib/storage';

// GET /api/assets?kind=image&source=upload|generation&before=<ms>&limit=60
// Backs the upload-history picker.
export const GET = route(async (request) => {
  const env = await getEnv();
  const params = request.nextUrl.searchParams;
  const assets = await listAssets(env.DB, {
    kind: params.get('kind'),
    source: params.get('source'),
    before: params.get('before'),
    limit: Number(params.get('limit')) || 60,
  });
  return json({ assets });
});

// POST multipart/form-data with one or more "file" fields.
export const POST = route(async (request) => {
  const env = await getEnv();
  const form = await request.formData();
  const files = form.getAll('file').filter((f) => typeof f === 'object' && f);
  if (!files.length) throw new HttpError(400, 'No file uploaded');

  const assets = [];
  for (const file of files) {
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) throw new HttpError(400, `Unsupported file type ${file.type || '(unknown)'}`);
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, `${file.name} is larger than 20 MB`);
    const row = await storeAsset(env, {
      body: await file.arrayBuffer(),
      size: file.size,
      mimeType: file.type,
      source: 'upload',
      originalName: file.name || null,
    });
    assets.push(toAsset(row));
  }
  return json({ assets });
});
