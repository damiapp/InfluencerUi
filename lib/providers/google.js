// Google Gemini API provider (Interactions API + Files API), using plain
// fetch so it runs unchanged in Cloudflare Workers and Node.
//
// References (Oct 2026):
//   POST /v1beta/interactions                 create (model, input, response_format, store, background, previous_interaction_id)
//   GET  /v1beta/interactions/{id}            poll status / steps
//   POST /upload/v1beta/files                 resumable upload (reference images)
//   GET  /v1beta/files/{name}                 file metadata (state PROCESSING|ACTIVE|FAILED)
//   GET  /v1beta/files/{name}:download?alt=media
//   POST /v1beta/voices                       Voice Design (stored prompted voice)
//
// Responses use the "steps" schema (steps[].type === 'model_output' with a
// content[] array). The legacy top-level "outputs" array is accepted too.

import { Provider, ProviderError } from './provider.js';
import { pcm16ToWav } from './wav.js';

export const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com';
export const DEFAULT_API_REVISION = '2026-05-20';

const RUNNING_STATES = new Set(['in_progress', 'queued']);
const FAILED_STATES = new Set(['failed', 'cancelled', 'incomplete', 'budget_exceeded', 'requires_action']);
// Re-upload references this long before Google expires the copy (files live 48h).
const URI_SAFETY_MARGIN_MS = 60 * 60 * 1000;

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fileNameFromUri(uri) {
  if (!uri) return null;
  const match = /files\/([A-Za-z0-9_-]+)/.exec(uri);
  return match ? `files/${match[1]}` : null;
}

/** Pull image/video/audio content and any text from an interaction response. */
export function extractOutputs(interaction) {
  const outputs = [];
  const texts = [];
  const errors = [];

  const take = (item) => {
    if (!item || typeof item !== 'object') return;
    if (item.type === 'image' || item.type === 'video' || item.type === 'audio') {
      const fallback = { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' }[item.type];
      outputs.push({
        kind: item.type,
        mimeType: item.mime_type || item.mimeType || fallback,
        data: item.data || undefined,
        uri: item.uri || undefined,
        sampleRate: item.sample_rate || undefined,
        channels: item.channels || undefined,
      });
    } else if (item.type === 'text' && item.text) {
      texts.push(item.text);
    }
  };

  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  // Only look at the model output after the last user input step: on GET the
  // response may include earlier turns.
  let start = 0;
  steps.forEach((step, index) => {
    if (step?.type === 'user_input') start = index + 1;
  });
  for (const step of steps.slice(start)) {
    if (step?.type !== 'model_output') continue;
    if (step.error?.message) errors.push(step.error.message);
    (step.content || []).forEach(take);
  }
  if (Array.isArray(interaction?.outputs)) interaction.outputs.forEach(take);
  if (Array.isArray(interaction?.errors)) {
    interaction.errors.forEach((e) => e?.message && errors.push(e.message));
  }

  return { outputs, text: texts.join('\n').trim(), errors };
}

export class GoogleProvider extends Provider {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl]
   * @param {string} [options.apiVersion]
   * @param {string|null} [options.apiRevision]   Api-Revision header for REST
   * @param {boolean} [options.videoBackground]   run video jobs as background interactions
   * @param {typeof fetch} [options.fetch]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({
    apiKey,
    baseUrl = GOOGLE_API_BASE,
    apiVersion = 'v1beta',
    apiRevision = DEFAULT_API_REVISION,
    videoBackground = true,
    fetch: fetchImpl = (...args) => globalThis.fetch(...args),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    super();
    if (!apiKey) throw new ProviderError('GEMINI_API_KEY is not configured on the server.', { status: 500 });
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiVersion = apiVersion;
    this.apiRevision = apiRevision;
    this.videoBackground = videoBackground;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  get id() {
    return 'google';
  }

  headers(extra = {}) {
    const headers = { 'x-goog-api-key': this.apiKey, ...extra };
    if (this.apiRevision) headers['Api-Revision'] = this.apiRevision;
    return headers;
  }

  async request(path, { method = 'GET', body, headers = {}, query } = {}) {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const init = { method, headers: this.headers(headers) };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await this.fetch(url.toString(), init);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message = json?.error?.message || text.slice(0, 500) || `HTTP ${response.status}`;
      throw new ProviderError(`Gemini API error (${response.status}): ${message}`, {
        status: response.status >= 500 ? 502 : response.status,
        details: json?.error || null,
      });
    }
    return json;
  }

  // ── Files API ────────────────────────────────────────────────────────────

  async uploadFile({ bytes, mimeType, displayName }) {
    const size = bytes.byteLength;
    const start = await this.fetch(`${this.baseUrl}/upload/${this.apiVersion}/files`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      }),
      body: JSON.stringify({ file: { display_name: displayName || 'reference' } }),
    });
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!start.ok || !uploadUrl) {
      const text = await start.text().catch(() => '');
      throw new ProviderError(`Gemini file upload could not start (${start.status}): ${text.slice(0, 300)}`, { status: 502 });
    }
    const finish = await this.fetch(uploadUrl, {
      method: 'POST',
      // fetch sets Content-Length from the body; setting it by hand makes
      // Node's fetch reject some ArrayBuffers (e.g. from the local R2 proxy).
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    });
    const json = await finish.json().catch(() => null);
    if (!finish.ok || !json?.file) {
      throw new ProviderError(`Gemini file upload failed (${finish.status}): ${json?.error?.message || 'no file in response'}`, { status: 502 });
    }
    return json.file;
  }

  async getFile(name) {
    return this.request(name);
  }

  async waitForFileActive(name, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let delay = intervalMs;
    for (;;) {
      const file = await this.getFile(name);
      const state = file?.state || 'STATE_UNSPECIFIED';
      if (state === 'ACTIVE') return file;
      if (state === 'FAILED') {
        throw new ProviderError(`Gemini file ${name} failed processing: ${file?.error?.message || 'unknown error'}`, { status: 502 });
      }
      if (Date.now() + delay > deadline) {
        throw new ProviderError(`Timed out waiting for Gemini file ${name} to become ACTIVE (state ${state}).`, { status: 504 });
      }
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, 10_000);
    }
  }

  /** Turn a stored asset into an Interactions content part, uploading it once and reusing the URI until it expires. */
  async mediaPart(media) {
    const now = Date.now();
    let uri = media.cachedUri;
    if (!uri || (media.cachedUriExpiresAt && media.cachedUriExpiresAt - URI_SAFETY_MARGIN_MS < now)) {
      const bytes = await media.load();
      let file = await this.uploadFile({ bytes, mimeType: media.mimeType, displayName: media.assetId });
      if (file.state && file.state !== 'ACTIVE') file = await this.waitForFileActive(file.name);
      uri = file.uri;
      const expiration = file.expirationTime || file.expiration_time;
      const expiresAt = expiration ? Date.parse(expiration) : now + 47 * 60 * 60 * 1000;
      // Reuse within this request too (e.g. several images with the same refs).
      media.cachedUri = uri;
      media.cachedUriExpiresAt = expiresAt;
      await media.onUploaded?.(uri, expiresAt);
    }
    const type = media.mimeType.startsWith('video/') ? 'video' : 'image';
    return { type, uri, mime_type: media.mimeType };
  }

  async buildInput(prompt, media = []) {
    if (!media.length) return prompt;
    const parts = [];
    for (const item of media) parts.push(await this.mediaPart(item));
    parts.push({ type: 'text', text: prompt });
    return parts;
  }

  toJobResult(interaction) {
    const raw = interaction?.status || 'completed';
    const { outputs, text, errors } = extractOutputs(interaction);
    const base = { jobId: interaction?.id, usage: interaction?.usage || null, outputs };
    if (RUNNING_STATES.has(raw)) return { ...base, status: 'running' };
    if (FAILED_STATES.has(raw)) {
      return { ...base, status: 'failed', error: errors[0] || text || `Interaction ${raw}.` };
    }
    if (!outputs.length) {
      // Keep Google's exact wording; the caller decides whether it is a block.
      return { ...base, status: 'failed', error: errors[0] || text || 'No media was returned and Google gave no reason.', noMedia: true };
    }
    return { ...base, status: 'completed' };
  }

  // ── Images ───────────────────────────────────────────────────────────────

  async generateImage({ model, prompt, media = [], aspectRatio, imageSize }) {
    const responseFormat = { type: 'image' };
    if (aspectRatio) responseFormat.aspect_ratio = aspectRatio;
    if (imageSize) responseFormat.image_size = imageSize;
    const interaction = await this.request('interactions', {
      method: 'POST',
      body: {
        model,
        input: await this.buildInput(prompt, media),
        response_format: responseFormat,
        store: true,
      },
    });
    const result = this.toJobResult(interaction);
    return { ...result, outputs: (result.outputs || []).filter((o) => o.kind === 'image') };
  }

  // ── Video (Gemini Omni Flash) ────────────────────────────────────────────

  videoFormat({ aspectRatio, resolution, durationSeconds }) {
    const format = { type: 'video', delivery: 'uri' };
    if (aspectRatio) format.aspect_ratio = aspectRatio;
    if (resolution) format.resolution = resolution;
    if (durationSeconds) format.duration = `${Math.round(durationSeconds)}s`;
    return format;
  }

  async createVideoInteraction(body) {
    // store must stay on: edits and extensions reference this interaction.
    const payload = { ...body, store: true };
    if (this.videoBackground) payload.background = true;
    try {
      return await this.request('interactions', { method: 'POST', body: payload });
    } catch (error) {
      // Some models reject background mode; fall back to a blocking call.
      if (payload.background && error.status === 400 && /background/i.test(error.message)) {
        delete payload.background;
        return this.request('interactions', { method: 'POST', body: payload });
      }
      throw error;
    }
  }

  async generateVideo({ model, prompt, media = [], aspectRatio, resolution, durationSeconds }) {
    const interaction = await this.createVideoInteraction({
      model,
      input: await this.buildInput(prompt, media),
      response_format: this.videoFormat({ aspectRatio, resolution, durationSeconds }),
    });
    return this.toJobResult(interaction);
  }

  async editVideo({ model, previousJobId, prompt, aspectRatio, resolution }) {
    if (!previousJobId) throw new ProviderError('Editing needs the previous interaction id.', { status: 400 });
    const interaction = await this.createVideoInteraction({
      model,
      previous_interaction_id: previousJobId,
      input: prompt,
      response_format: this.videoFormat({ aspectRatio, resolution }),
    });
    return this.toJobResult(interaction);
  }

  async extendVideo({ model, previousJobId, prompt, media = [], aspectRatio, resolution, durationSeconds }) {
    if (!previousJobId) throw new ProviderError('Extending needs the previous interaction id.', { status: 400 });
    const interaction = await this.createVideoInteraction({
      model,
      previous_interaction_id: previousJobId,
      input: await this.buildInput(prompt, media),
      response_format: this.videoFormat({ aspectRatio, resolution, durationSeconds }),
    });
    return this.toJobResult(interaction);
  }

  async getStatus(jobId) {
    const interaction = await this.request(`interactions/${encodeURIComponent(jobId)}`);
    return this.toJobResult({ id: jobId, ...interaction });
  }

  // ── Structured text (character bible, reference tags) ───────────────────

  /** Multimodal prompt → JSON matching `schema` (structured output). */
  async generateStructured({ model, prompt, media = [], schema }) {
    const interaction = await this.request('interactions', {
      method: 'POST',
      body: {
        model,
        input: await this.buildInput(prompt, media),
        response_format: { type: 'text', mime_type: 'application/json', schema },
        store: false,
      },
    });
    const { text, errors } = extractOutputs(interaction);
    if (FAILED_STATES.has(interaction?.status) || !text) {
      throw new ProviderError(errors[0] || text || `Gemini returned no text (status ${interaction?.status || 'unknown'}).`, { status: 502 });
    }
    let data;
    try {
      data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new ProviderError(`Gemini returned invalid JSON: ${text.slice(0, 200)}`, { status: 502 });
    }
    return { data, usage: interaction?.usage || null, jobId: interaction?.id || null };
  }

  // ── Voices and speech ────────────────────────────────────────────────────

  /** Voice Design: create a stored voice from a text description. */
  async designVoice({ name, description, languageCode }) {
    const voice = { type: 'prompted', display_name: name.slice(0, 60), description, prompted: { input: description } };
    if (languageCode) voice.language_code = languageCode;
    const response = await this.request('voices', { method: 'POST', body: { store: true, voice } });
    const created = response?.voice || response || {};
    const voiceId = created.id || (created.name || '').replace(/^voices\//, '');
    if (!voiceId) throw new ProviderError('Voice Design did not return a voice id.', { status: 502 });
    return { voiceId, expiresAt: created.expire_time ? Date.parse(created.expire_time) : null };
  }

  /** Text-to-speech with a stored voice. Returns WAV audio. */
  async generateSpeech({ model, voiceId, text, style }) {
    const part = { type: 'text', text };
    if (style) part.annotations = [{ type: 'speech_metadata', style }];
    const interaction = await this.request('interactions', {
      method: 'POST',
      body: {
        model,
        input: [part],
        generation_config: { speech_config: [{ voice: voiceId }] },
        response_format: { type: 'audio', mime_type: 'audio/wav' },
        store: false,
      },
    });
    const result = this.toJobResult(interaction);
    const outputs = (result.outputs || []).filter((o) => o.kind === 'audio');
    // Wrap raw PCM so it plays in the browser.
    for (const output of outputs) {
      if (output.data && /l16|pcm/i.test(output.mimeType)) {
        const wav = pcm16ToWav(base64ToBytes(output.data), { sampleRate: output.sampleRate || 24000, channels: output.channels || 1 });
        output.data = bytesToBase64(wav);
        output.mimeType = 'audio/wav';
      }
    }
    return { ...result, outputs };
  }

  // ── Output download ──────────────────────────────────────────────────────

  async fetchOutput(output) {
    if (output.data) {
      const bytes = base64ToBytes(output.data);
      return { body: bytes, mimeType: output.mimeType, size: bytes.byteLength };
    }
    const name = fileNameFromUri(output.uri);
    let response;
    if (name) {
      const file = await this.waitForFileActive(name, { timeoutMs: 180_000 });
      response = await this.fetch(`${this.baseUrl}/${this.apiVersion}/${name}:download?alt=media`, {
        headers: this.headers(),
      });
      if (!output.mimeType && file?.mimeType) output.mimeType = file.mimeType;
    } else if (output.uri) {
      response = await this.fetch(output.uri, { headers: this.headers() });
    } else {
      throw new ProviderError('Output has neither inline data nor a URI.', { status: 502 });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(`Downloading the generated file failed (${response.status}): ${text.slice(0, 300)}`, { status: 502 });
    }
    const length = response.headers.get('content-length');
    return {
      body: response.body,
      mimeType: output.mimeType || response.headers.get('content-type')?.split(';')[0],
      size: length ? Number(length) : null,
    };
  }
}
