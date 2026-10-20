import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Cloudflare bindings (DB, MEDIA) and config for the current request.
 * String config falls back to process.env so `.env.local` also works in dev.
 */
export async function getEnv() {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const pick = (name) => env[name] ?? process.env[name];
  return {
    DB: env.DB,
    MEDIA: env.MEDIA,
    ctx,
    AI_PROVIDER: pick('AI_PROVIDER'),
    GEMINI_API_KEY: pick('GEMINI_API_KEY'),
    GEMINI_API_REVISION: pick('GEMINI_API_REVISION'),
    GEMINI_VIDEO_BACKGROUND: pick('GEMINI_VIDEO_BACKGROUND'),
    SESSION_SECRET: pick('SESSION_SECRET'),
    APP_PASSWORD: pick('APP_PASSWORD'),
  };
}
