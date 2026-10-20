import { GoogleProvider } from './google.js';
import { MockProvider } from './mock.js';
import { ProviderError } from './provider.js';

export { ProviderError };

/**
 * Pick the provider for this request from server-side config.
 * AI_PROVIDER: "google" | "mock". Without it, Google is used when a key is
 * set; otherwise mock in development and an error in production.
 */
export function resolveProviderId(env) {
  const explicit = (env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (env.GEMINI_API_KEY) return 'google';
  return process.env.NODE_ENV === 'production' ? 'google' : 'mock';
}

export function getProvider(env, id = resolveProviderId(env)) {
  switch (id) {
    case 'google':
      return new GoogleProvider({
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_BASE_URL || undefined,
        apiRevision: env.GEMINI_API_REVISION === 'none' ? null : env.GEMINI_API_REVISION || undefined,
        videoBackground: env.GEMINI_VIDEO_BACKGROUND !== 'false',
      });
    case 'mock':
      return new MockProvider();
    default:
      throw new ProviderError(`Unknown AI_PROVIDER "${id}"`, { status: 500 });
  }
}
