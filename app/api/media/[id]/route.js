import { getEnv } from '@/lib/env';
import { getAssetRow } from '@/lib/db';
import { HttpError, route } from '@/lib/http';

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

// Streams an asset from R2. Supports Range requests so videos can seek.
export const GET = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  const asset = await getAssetRow(env.DB, id);
  if (!asset) throw new HttpError(404, 'Not found');

  const headers = new Headers({
    'Content-Type': asset.mime_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  if (request.nextUrl.searchParams.get('download')) {
    const ext = asset.r2_key.split('.').pop();
    headers.set('Content-Disposition', `attachment; filename="${asset.id}.${ext}"`);
  }
  if (asset.mime_type === 'image/svg+xml') {
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  }

  const rangeHeader = request.headers.get('range');
  const head = rangeHeader ? await env.MEDIA.head(asset.r2_key) : null;
  const range = head ? parseRange(rangeHeader, head.size) : null;
  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${head.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    const object = await env.MEDIA.get(asset.r2_key, { range: { offset: range.start, length: range.end - range.start + 1 } });
    if (!object) throw new HttpError(404, 'Missing from storage');
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.MEDIA.get(asset.r2_key);
  if (!object) throw new HttpError(404, 'Missing from storage');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
});
