import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleProvider, extractOutputs, fileNameFromUri } from '../lib/providers/google.js';
import { MockProvider } from '../lib/providers/mock.js';

const BASE = 'https://generativelanguage.googleapis.com';

/** Minimal fake of the Gemini REST surface the provider uses. */
function fakeGemini(handlers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ key, url: u, headers: init.headers || {}, body });
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no handler for ${key}` } }), { status: 404 });
    return handler({ url: u, body, headers: init.headers || {}, calls });
  };
  return { fetch, calls };
}

const json = (data, init = {}) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, ...init });

function provider(fetch, extra = {}) {
  return new GoogleProvider({ apiKey: 'test-key', fetch, sleep: async () => {}, ...extra });
}

function media(id, uploads) {
  return {
    assetId: id,
    mimeType: 'image/png',
    load: async () => new Uint8Array([1, 2, 3]).buffer,
    cachedUri: null,
    cachedUriExpiresAt: null,
    onUploaded: async (uri, expiresAt) => uploads.push({ id, uri, expiresAt }),
  };
}

const fileHandlers = {
  'POST /upload/v1beta/files': () => new Response('{}', { headers: { 'x-goog-upload-url': `${BASE}/upload-session/1` } }),
  'POST /upload-session/1': ({ calls }) => {
    const n = calls.filter((c) => c.key === 'POST /upload-session/1').length;
    return json({ file: { name: `files/ref${n}`, uri: `${BASE}/v1beta/files/ref${n}`, state: 'ACTIVE', expirationTime: '2026-10-22T00:00:00Z' } });
  },
};

test('generateImage sends refs as uploaded file parts then text, with response_format', async () => {
  const uploads = [];
  const { fetch, calls } = fakeGemini({
    ...fileHandlers,
    'POST /v1beta/interactions': () => json({
      id: 'int_img',
      status: 'completed',
      steps: [
        { type: 'user_input', content: [] },
        { type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'image', mime_type: 'image/png', data: 'AQID' }] },
      ],
    }),
  });
  const p = provider(fetch);
  const result = await p.generateImage({
    model: 'gemini-3-pro-image',
    prompt: 'hello',
    media: [media('a1', uploads), media('a2', uploads)],
    aspectRatio: '9:16',
    imageSize: '2K',
  });
  const create = calls.find((c) => c.key === 'POST /v1beta/interactions');
  assert.equal(create.headers['x-goog-api-key'], 'test-key');
  assert.equal(create.headers['Api-Revision'], '2026-05-20');
  assert.deepEqual(create.body, {
    model: 'gemini-3-pro-image',
    input: [
      { type: 'image', uri: `${BASE}/v1beta/files/ref1`, mime_type: 'image/png' },
      { type: 'image', uri: `${BASE}/v1beta/files/ref2`, mime_type: 'image/png' },
      { type: 'text', text: 'hello' },
    ],
    response_format: { type: 'image', aspect_ratio: '9:16', image_size: '2K' },
    store: true,
  });
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].expiresAt, Date.parse('2026-10-22T00:00:00Z'));
  assert.equal(result.status, 'completed');
  assert.equal(result.outputs.length, 1);
  const out = await p.fetchOutput(result.outputs[0]);
  assert.deepEqual([...out.body], [1, 2, 3]);
});

test('cached reference URIs are reused', async () => {
  const { fetch, calls } = fakeGemini({
    'POST /v1beta/interactions': () => json({ id: 'x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', data: 'AA==' }] }] }),
  });
  await provider(fetch).generateImage({
    model: 'm',
    prompt: 'p',
    media: [{ assetId: 'a', mimeType: 'image/jpeg', cachedUri: 'files/cached', cachedUriExpiresAt: Date.now() + 10 * 3600_000, load: async () => { throw new Error('should not load'); } }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.input[0].uri, 'files/cached');
});

test('generateVideo runs in background with uri delivery and store', async () => {
  const { fetch, calls } = fakeGemini({
    'POST /v1beta/interactions': () => json({ id: 'v1_abc', status: 'in_progress' }),
  });
  const result = await provider(fetch).generateVideo({
    model: 'gemini-omni-1.1-flash',
    prompt: '<FIRST_FRAME> she smiles',
    media: [],
    aspectRatio: '9:16',
    resolution: '720p',
    durationSeconds: 8,
  });
  assert.deepEqual(calls[0].body, {
    model: 'gemini-omni-1.1-flash',
    input: '<FIRST_FRAME> she smiles',
    response_format: { type: 'video', delivery: 'uri', aspect_ratio: '9:16', resolution: '720p', duration: '8s' },
    store: true,
    background: true,
  });
  assert.deepEqual(result, { jobId: 'v1_abc', usage: null, outputs: [], status: 'running' });
});

test('background rejection falls back to a blocking call', async () => {
  let n = 0;
  const { fetch, calls } = fakeGemini({
    'POST /v1beta/interactions': () => {
      n += 1;
      if (n === 1) return json({ error: { message: 'background is not supported for this model' } }, { status: 400 });
      return json({ id: 'v1_sync', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: 'files/vid1', mime_type: 'video/mp4' }] }] });
    },
  });
  const result = await provider(fetch).generateVideo({ model: 'm', prompt: 'p' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.background, undefined);
  assert.equal(result.status, 'completed');
  assert.equal(result.outputs[0].uri, 'files/vid1');
});

test('edit and extend chain with previous_interaction_id', async () => {
  const { fetch, calls } = fakeGemini({
    'POST /v1beta/interactions': ({ body }) => json({ id: `next_${body.previous_interaction_id}`, status: 'in_progress' }),
  });
  const p = provider(fetch);
  const edit = await p.editVideo({ model: 'gemini-omni-1.1-flash', previousJobId: 'v1_a', prompt: 'Make it rain. Keep everything else the same.', aspectRatio: '9:16', resolution: '720p' });
  assert.equal(edit.jobId, 'next_v1_a');
  assert.deepEqual(calls[0].body, {
    model: 'gemini-omni-1.1-flash',
    previous_interaction_id: 'v1_a',
    input: 'Make it rain. Keep everything else the same.',
    response_format: { type: 'video', delivery: 'uri', aspect_ratio: '9:16', resolution: '720p' },
    store: true,
    background: true,
  });
  await p.extendVideo({ model: 'gemini-omni-1.1-flash', previousJobId: 'next_v1_a', prompt: 'Extend this video.', resolution: '1080p', durationSeconds: 10 });
  assert.equal(calls[1].body.previous_interaction_id, 'next_v1_a');
  assert.equal(calls[1].body.response_format.duration, '10s');
  assert.equal(calls[1].body.response_format.resolution, '1080p');
});

test('getStatus maps states and waits for ACTIVE before download', async () => {
  let fileChecks = 0;
  const { fetch, calls } = fakeGemini({
    'GET /v1beta/interactions/v1_done': () => json({
      status: 'completed',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'old turn' }] },
        { type: 'model_output', content: [{ type: 'video', uri: `${BASE}/v1beta/files/old`, mime_type: 'video/mp4' }] },
        { type: 'user_input', content: [{ type: 'text', text: 'edit' }] },
        { type: 'model_output', content: [{ type: 'video', uri: `${BASE}/v1beta/files/out1`, mime_type: 'video/mp4' }] },
      ],
      usage: { total_output_tokens: 57920 },
    }),
    'GET /v1beta/interactions/v1_run': () => json({ status: 'in_progress' }),
    'GET /v1beta/interactions/v1_bad': () => json({ status: 'failed', errors: [{ message: 'Safety block' }] }),
    'GET /v1beta/files/out1': () => {
      fileChecks += 1;
      return json({ name: 'files/out1', state: fileChecks < 3 ? 'PROCESSING' : 'ACTIVE', mimeType: 'video/mp4' });
    },
    'GET /v1beta/files/out1:download': ({ url }) => {
      assert.equal(url.searchParams.get('alt'), 'media');
      return new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'video/mp4', 'content-length': '2' } });
    },
  });
  const p = provider(fetch);
  assert.equal((await p.getStatus('v1_run')).status, 'running');
  const bad = await p.getStatus('v1_bad');
  assert.equal(bad.status, 'failed');
  assert.equal(bad.error, 'Safety block');
  const done = await p.getStatus('v1_done');
  assert.equal(done.status, 'completed');
  assert.equal(done.outputs.length, 1, 'only the latest turn output');
  assert.equal(done.usage.total_output_tokens, 57920);
  const file = await p.fetchOutput(done.outputs[0]);
  assert.equal(fileChecks, 3);
  assert.equal(file.size, 2);
  assert.equal(file.mimeType, 'video/mp4');
  assert.ok(calls.some((c) => c.key === 'GET /v1beta/files/out1:download'));
});

test('completed with no media is reported as failure with model text', async () => {
  const r = provider(async () => json({})).toJobResult({ id: 'x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot help with that.' }] }] });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /I cannot help with that/);
});

test('legacy outputs array and helpers', () => {
  const { outputs } = extractOutputs({ outputs: [{ type: 'image', data: 'AA==', mime_type: 'image/jpeg' }] });
  assert.equal(outputs[0].mimeType, 'image/jpeg');
  assert.equal(fileNameFromUri('https://generativelanguage.googleapis.com/v1beta/files/abc-1?x=1'), 'files/abc-1');
  assert.equal(fileNameFromUri('nope'), null);
});

test('HTTP errors carry the API message', async () => {
  const { fetch } = fakeGemini({ 'POST /v1beta/interactions': () => json({ error: { message: 'API key not valid' } }, { status: 403 }) });
  await assert.rejects(provider(fetch).generateImage({ model: 'm', prompt: 'p' }), /API key not valid/);
});

test('mock provider completes video after delay', async () => {
  let now = 1000;
  const p = new MockProvider({ now: () => now });
  const job = await p.generateVideo({ aspectRatio: '9:16', durationSeconds: 8 });
  assert.equal((await p.getStatus(job.jobId)).status, 'running');
  now += 5000;
  const done = await p.getStatus(job.jobId);
  assert.equal(done.status, 'completed');
  const file = await p.fetchOutput(done.outputs[0]);
  assert.ok(file.size > 1000);
  const img = await p.generateImage({ prompt: 'Café ✨', aspectRatio: '9:16', media: [] });
  const svg = await p.fetchOutput(img.outputs[0]);
  assert.match(new TextDecoder().decode(svg.body), /Café ✨/);
});
