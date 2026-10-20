// Offline provider for local development without a Gemini API key
// (AI_PROVIDER=mock). Images are SVG placeholders showing the prompt; videos
// are tiny bundled clips. Jobs "finish" a few seconds after they start so the
// polling, edit and extend flows can be clicked through end to end.

import { Provider, ProviderError } from './provider.js';
import { MOCK_VIDEO_PORTRAIT_MP4, MOCK_VIDEO_LANDSCAPE_MP4 } from './mock-media.js';

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

  async getStatus(jobId) {
    const job = decodeJob(jobId);
    if (job.kind !== 'video') return { jobId, status: 'completed', outputs: [] };
    if (this.now() - job.t < VIDEO_DELAY_MS) return { jobId, status: 'running' };
    return {
      jobId,
      status: 'completed',
      outputs: [{ kind: 'video', mimeType: 'video/mp4', uri: `mock://${job.ar === '16:9' ? 'landscape' : 'portrait'}` }],
      usage: null,
    };
  }

  async fetchOutput(output) {
    let base64 = output.data;
    if (!base64 && output.uri === 'mock://landscape') base64 = MOCK_VIDEO_LANDSCAPE_MP4;
    if (!base64 && output.uri === 'mock://portrait') base64 = MOCK_VIDEO_PORTRAIT_MP4;
    if (!base64) throw new ProviderError('Unknown mock output', { status: 500 });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { body: bytes, mimeType: output.mimeType, size: bytes.byteLength };
  }
}
