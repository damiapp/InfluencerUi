import { getEnv } from '@/lib/env';
import { HttpError, json, route } from '@/lib/http';
import { MAX_VIDEO_UPLOAD_BYTES } from '@/lib/storage';
import { saveVoiceover } from '@/lib/voice';

// POST multipart { file: muxed mp4, speechGenerationId, mix: JSON } — save a voiceover version of clip :id.
export const POST = route(async (request, { params }) => {
  const { id } = await params;
  const env = await getEnv();
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file !== 'object') throw new HttpError(400, 'No video uploaded');
  if (!['video/mp4', 'video/webm'].includes(file.type)) throw new HttpError(400, `Unsupported video type ${file.type}`);
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) throw new HttpError(400, 'Video is too large');
  let mix = null;
  try {
    mix = JSON.parse(form.get('mix') || 'null');
  } catch {
    mix = null;
  }
  const generation = await saveVoiceover(env, id, { file, speechGenerationId: form.get('speechGenerationId'), mix });
  return json({ generation });
});
