// Google models available in the studio.
//
// IDs, limits and options were checked against the Gemini API docs
// (Oct 2026). Notes:
// - `gemini-3.1-flash-image` (the original Nano Banana 2) is deprecated and
//   shuts down on 29 Oct 2026; `gemini-nano-banana-2.1` replaces it.
// - Nano Banana Pro is GA as `gemini-3-pro-image` (no `-preview` suffix).
// - Video uses Gemini Omni Flash through the Interactions API. Veo preview
//   model IDs are intentionally absent (shut down 22 Oct 2026).

const COMMON_IMAGE_RATIOS = ['9:16', '3:4', '4:5', '1:1', '4:3', '3:2', '2:3', '5:4', '16:9', '21:9'];

export const IMAGE_MODELS = [
  {
    id: 'gemini-3-pro-image',
    name: 'Nano Banana Pro',
    provider: 'google',
    kind: 'image',
    description: 'Highest quality; best identity fidelity and text rendering.',
    maxReferenceImages: 14,
    aspectRatios: COMMON_IMAGE_RATIOS,
    imageSizes: ['1K', '2K', '4K'],
    defaultImageSize: '2K',
  },
  {
    id: 'gemini-nano-banana-2.1',
    name: 'Nano Banana 2.1',
    provider: 'google',
    kind: 'image',
    description: 'Fast and cheaper; up to 14 references (4 characters / 10 objects).',
    maxReferenceImages: 14,
    aspectRatios: [...COMMON_IMAGE_RATIOS, '1:4', '4:1'],
    imageSizes: ['1K', '2K', '4K'],
    defaultImageSize: '1K',
  },
];

export const VIDEO_MODELS = [
  {
    id: 'gemini-omni-1.1-flash',
    name: 'Gemini Omni Flash',
    provider: 'google',
    kind: 'video',
    description: 'Conversational video generation, editing and extension.',
    aspectRatios: ['9:16', '16:9'],
    defaultAspectRatio: '9:16',
    // The API also accepts 360p and 4k; add them here to expose them.
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    minDurationSeconds: 3,
    maxDurationSeconds: 10,
    defaultDurationSeconds: 8,
    // Image references bound with <IMAGE_REF_N>. Frames are separate.
    maxReferenceImages: 5,
    extendStepSeconds: 10,
    maxTotalSeconds: 40,
    // Edits operate on clips of up to 10 seconds.
    maxEditSeconds: 10,
  },
];

export const ALL_MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS];

export function getModel(id) {
  return ALL_MODELS.find((model) => model.id === id) || null;
}

export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0].id;
export const DEFAULT_VIDEO_MODEL = VIDEO_MODELS[0].id;
