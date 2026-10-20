// Offline provider for local development without a Gemini API key
// (AI_PROVIDER=mock). Images are SVG placeholders showing the prompt; videos
// are tiny bundled clips. Jobs "finish" a few seconds after they start so the
// polling, edit and extend flows can be clicked through end to end.

import { Provider, ProviderError } from './provider.js';
import { MOCK_VIDEO_PORTRAIT_WEBM, MOCK_VIDEO_LANDSCAPE_WEBM } from './mock-media.js';
import { pcm16ToWav } from './wav.js';

const VIDEO_DELAY_MS = 4000;

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function wrap(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function mockSvg(prompt, aspectRatio = '1:1', refCount = 0) {
  const [w, h] = (aspectRatio || '1:1').split(':').map(Number);
  const width = 768;
  const height = Math.round((width * (h || 1)) / (w || 1));
  const hue = hash(prompt) % 360;
  const lines = wrap(prompt.replace(/\n/g, ' '), 38).slice(0, 14);
  const text = lines
    .map((line, i) => `<text x="40" y="${120 + i * 30}" font-size="22" fill="white" font-family="sans-serif">${escapeXml(line)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,35%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,15%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="40" y="70" font-size="30" font-weight="bold" fill="white" font-family="sans-serif">MOCK IMAGE · ${aspectRatio} · ${refCount} refs</text>
${text}
</svg>`;
}

/** Syllable-like tone bursts; the pitch depends only on the voice id. */
export function mockSpeechWav(voiceId, text) {
  const sampleRate = 24000;
  const words = text.trim().split(/\s+/).filter(Boolean).length || 1;
  const seconds = Math.min(30, Math.max(1, words / 2.6 + 0.5));
  const pitch = 160 + (hash(voiceId) % 140);
  const samples = new Int16Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const syllable = Math.sin(Math.PI * ((t * 4) % 1)) ** 2; // 4 syllables per second
    const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 5 * t);
    samples[i] = Math.round(9000 * syllable * Math.sin(2 * Math.PI * pitch * vibrato * t));
  }
  return pcm16ToWav(new Uint8Array(samples.buffer), { sampleRate });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function encodeJob(fields) {
  return `mock_${btoa(JSON.stringify(fields)).replace(/=+$/, '')}`;
}

function decodeJob(jobId) {
  if (!jobId?.startsWith('mock_')) throw new ProviderError(`Unknown mock job ${jobId}`, { status: 404 });
  return JSON.parse(atob(jobId.slice(5)));
}

export class MockProvider extends Provider {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.now = now;
  }

  get id() {
    return 'mock';
  }

  async generateImage({ prompt, media = [], aspectRatio }) {
    // Test hook: include "mock:block" in a prompt to simulate a policy refusal.
    if (prompt.includes('mock:block')) {
      return {
        jobId: encodeJob({ kind: 'image', t: this.now(), n: Math.random() }),
        status: 'failed',
        outputs: [],
        error: 'MOCK: The request was blocked because it may depict a prominent person (finish reason IMAGE_PROHIBITED_CONTENT).',
        noMedia: true,
      };
    }
    const svg = mockSvg(prompt, aspectRatio, media.length);
    return {
      jobId: encodeJob({ kind: 'image', t: this.now(), n: Math.random() }),
      status: 'completed',
      outputs: [{ kind: 'image', mimeType: 'image/svg+xml', data: btoa(unescape(encodeURIComponent(svg))) }],
      usage: null,
    };
  }

  videoJob({ aspectRatio, durationSeconds, op, previous }) {
    const parent = previous ? decodeJob(previous) : null;
    return {
      jobId: encodeJob({
        kind: 'video',
        op,
        t: this.now(),
        ar: aspectRatio || parent?.ar || '9:16',
        d: durationSeconds || parent?.d || 8,
        n: Math.random(),
      }),
      status: 'running',
    };
  }

  async generateVideo({ aspectRatio, durationSeconds }) {
    return this.videoJob({ aspectRatio, durationSeconds, op: 'generate' });
  }

  async editVideo({ previousJobId, aspectRatio }) {
    return this.videoJob({ aspectRatio, op: 'edit', previous: previousJobId });
  }

  async extendVideo({ previousJobId, aspectRatio, durationSeconds }) {
    return this.videoJob({ aspectRatio, durationSeconds, op: 'extend', previous: previousJobId });
  }

  /** Plausible fixed answers for the bible and reference-tag schemas. */
  async generateStructured({ prompt, media = [], schema }) {
    const props = schema?.properties || {};
    if (props.prompt_paragraph) {
      const name = /named ([^.]+)\./.exec(prompt)?.[1] || 'The character';
      return {
        data: {
          face_shape: 'oval with a softly pointed chin',
          eyes: 'almond-shaped, hazel-green, slightly upturned outer corners',
          brows: 'medium-thick, straight with a soft arch, dark brown',
          nose: 'straight bridge, narrow rounded tip',
          lips_and_teeth: 'medium-full lips with a defined cupid\'s bow; straight teeth',
          skin: { tone: 'light warm beige', freckles: 'light freckles across nose and cheeks', marks: 'small mole under the left eye' },
          hair: { color: 'copper red', length: 'chin length', cut: 'blunt bob with side part', texture: 'straight, glossy' },
          build: 'slim, average height',
          signature_accessories: ['small gold nose ring on the left nostril'],
          style_palette: ['cream', 'olive', 'denim blue'],
          never_change: ['copper-red chin-length bob', 'hazel-green eyes', 'freckles across the nose', 'mole under the left eye', 'gold nose ring on the left nostril'],
          prompt_paragraph: `${name} has an oval face with a softly pointed chin, almond-shaped hazel-green eyes with slightly upturned outer corners and straight, softly arched dark brows. Light freckles cover the nose and cheeks, with a small mole under the left eye. A copper-red, chin-length blunt bob with a side part frames the face. The nose is straight with a narrow tip, the lips medium-full with a defined cupid's bow. A small gold ring sits in the left nostril. Slim build.`,
        },
        usage: { total_input_tokens: 1120 * media.length + 400, total_output_tokens: 900 },
        jobId: null,
      };
    }
    if (props.refs) {
      const angles = ['front', 'three-quarter', 'profile', 'full-body'];
      const expressions = ['neutral', 'soft smile', 'laughing', 'serious'];
      const lightings = ['soft daylight', 'studio', 'golden hour', 'indoor warm', 'night'];
      return {
        data: { refs: media.map((_, index) => ({ index, angle: angles[index % 4], expression: expressions[(index >> 1) % 4], lighting: lightings[index % 5] })) },
        usage: { total_input_tokens: 1120 * media.length + 200, total_output_tokens: 40 * media.length },
        jobId: null,
      };
    }
    throw new ProviderError('Mock provider has no answer for this schema', { status: 400 });
  }

  async designVoice({ name, description }) {
    return { voiceId: `voice_mock${hash(`${name}:${description}`).toString(36)}`, expiresAt: null };
  }

  async generateSpeech({ voiceId, text }) {
    return {
      jobId: encodeJob({ kind: 'audio', t: this.now(), n: Math.random() }),
      status: 'completed',
      outputs: [{ kind: 'audio', mimeType: 'audio/wav', data: bytesToBase64(mockSpeechWav(voiceId, text)) }],
      usage: null,
    };
  }

  async getStatus(jobId) {
    const job = decodeJob(jobId);
    if (job.kind !== 'video') return { jobId, status: 'completed', outputs: [] };
    if (this.now() - job.t < VIDEO_DELAY_MS) return { jobId, status: 'running' };
    return {
      jobId,
      status: 'completed',
      outputs: [{ kind: 'video', mimeType: 'video/webm', uri: `mock://${job.ar === '16:9' ? 'landscape' : 'portrait'}` }],
      usage: null,
    };
  }

  async fetchOutput(output) {
    let base64 = output.data;
    if (!base64 && output.uri === 'mock://landscape') base64 = MOCK_VIDEO_LANDSCAPE_WEBM;
    if (!base64 && output.uri === 'mock://portrait') base64 = MOCK_VIDEO_PORTRAIT_WEBM;
    if (!base64) throw new ProviderError('Unknown mock output', { status: 500 });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { body: bytes, mimeType: output.mimeType, size: bytes.byteLength };
  }
}
