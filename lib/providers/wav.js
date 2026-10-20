// Minimal WAV helpers (16-bit PCM). Gemini TTS returns WAV by default, but
// raw audio/l16 PCM is wrapped so browsers can play and decode it.

export function pcm16ToWav(pcm, { sampleRate = 24000, channels = 1 } = {}) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcm.buffer ?? pcm, pcm.byteOffset ?? 0, pcm.byteLength), 44);
  return out;
}

/** Duration in seconds of a 16-bit PCM WAV, or null if it isn't one. */
export function wavDurationSeconds(bytes) {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  if (tag !== 'RIFF') return null;
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  // Find the data chunk (there may be extra chunks before it).
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') return Math.min(size, bytes.byteLength - offset - 8) / (sampleRate * channels * (bits / 8));
    offset += 8 + size;
  }
  return null;
}
