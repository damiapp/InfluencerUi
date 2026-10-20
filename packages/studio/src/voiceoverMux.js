// Browser-side muxing of a TTS voiceover onto a generated clip.
//
// The video stream is copied packet-for-packet (no re-encode, no quality
// loss); the clip's own audio and the voice are mixed with Web Audio and
// encoded with WebCodecs (AAC, or Opus where AAC encoding isn't available,
// e.g. Firefox on Linux). Cloudflare Workers can't run ffmpeg, so this runs
// in the browser and the result is uploaded back to R2.

const SAMPLE_RATE = 48000;

async function decodeAudio(arrayBuffer) {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } catch {
    return null; // no audio track, or a codec the browser can't decode
  }
}

/**
 * @param {object} options
 * @param {string} options.videoUrl
 * @param {string} options.speechUrl
 * @param {number} [options.originalVolume]  0–1 gain for the clip's own audio (0 drops it)
 * @param {number} [options.voiceVolume]
 * @param {number} [options.voiceStart]      seconds into the clip when the voice starts
 * @param {(progress: number) => void} [options.onProgress]
 * @returns {Promise<{ blob: Blob, duration: number, voiceTruncated: boolean, audioCodec: string }>}
 */
export async function muxVoiceover({ videoUrl, speechUrl, originalVolume = 0.25, voiceVolume = 1, voiceStart = 0.3, onProgress }) {
  const {
    Input,
    Output,
    BlobSource,
    BufferTarget,
    Mp4OutputFormat,
    ALL_FORMATS,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    AudioBufferSource,
    getFirstEncodableAudioCodec,
    QUALITY_HIGH,
  } = await import('mediabunny');

  const [videoBlob, speechBuffer] = await Promise.all([
    fetch(videoUrl).then((r) => {
      if (!r.ok) throw new Error(`Could not load the clip (${r.status})`);
      return r.blob();
    }),
    fetch(speechUrl).then((r) => {
      if (!r.ok) throw new Error(`Could not load the voiceover audio (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  onProgress?.(0.05);

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoBlob) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('The clip has no video track');
  const duration = await input.computeDuration();

  // ── Mix audio ────────────────────────────────────────────────────────────
  const [original, voice] = await Promise.all([
    originalVolume > 0 ? decodeAudio(await videoBlob.arrayBuffer()) : null,
    decodeAudio(speechBuffer),
  ]);
  if (!voice) throw new Error('Could not decode the voiceover audio');
  const frames = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const mixer = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  const play = (buffer, gainValue, when) => {
    const source = mixer.createBufferSource();
    source.buffer = buffer;
    const gain = mixer.createGain();
    gain.gain.value = gainValue;
    source.connect(gain).connect(mixer.destination);
    source.start(when);
  };
  if (original) play(original, originalVolume, 0);
  play(voice, voiceVolume, Math.max(0, voiceStart));
  const mixed = await mixer.startRendering();
  onProgress?.(0.3);

  // ── Write MP4: copied video packets + encoded mixed audio ────────────────
  const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  if (!audioCodec) throw new Error('This browser cannot encode audio (WebCodecs). Try a current Chrome or Firefox.');

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
  output.addVideoTrack(videoSource, { rotation: videoTrack.rotation });
  const audioSource = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH });
  output.addAudioTrack(audioSource);
  await output.start();

  const decoderConfig = await videoTrack.getDecoderConfig();
  const sink = new EncodedPacketSink(videoTrack);
  let first = true;
  for await (const packet of sink.packets()) {
    await videoSource.add(packet, first ? { decoderConfig } : undefined);
    first = false;
    if (duration) onProgress?.(0.3 + 0.5 * Math.min(1, packet.timestamp / duration));
  }
  await audioSource.add(mixed);
  videoSource.close();
  audioSource.close();
  await output.finalize();
  onProgress?.(1);

  return {
    blob: new Blob([target.buffer], { type: 'video/mp4' }),
    duration,
    voiceTruncated: voiceStart + voice.duration > duration + 0.05,
    audioCodec,
  };
}
