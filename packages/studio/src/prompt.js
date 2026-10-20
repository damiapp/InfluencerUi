import { bibleLines } from './bible.js';

// Prompt assembly shared by the studios. The browser builds the final prompt
// with these helpers and shows it for editing; the server sends whatever
// final prompt the user approved, with media inputs ordered the same way the
// builders assume: first frame, last frame, character refs, extra refs.

export const KEEP_SAME_SUFFIX = 'Keep everything else the same.';
export const SINGLE_SHOT_TEXT = 'In a single continuous shot. No scene cuts.';
export const DEFAULT_EXTEND_PROMPT = 'Extend this video. The scene continues in a single continuous shot.';

export const PROMPT_PRESETS = [
  {
    id: 'reels',
    group: 'Format',
    label: '9:16 Reels',
    kinds: ['image', 'video'],
    text: 'Vertical 9:16 framing for Instagram Reels, subject centered with headroom for captions.',
    settings: { aspectRatio: '9:16' },
  },
  {
    id: 'single-shot',
    group: 'Format',
    label: 'Single continuous shot',
    kinds: ['video'],
    text: SINGLE_SHOT_TEXT,
  },
  {
    id: 'no-dialogue',
    group: 'Format',
    label: 'No dialogue',
    kinds: ['video'],
    text: 'No dialogue.',
  },
  { id: 'snd-no-music', group: 'Sound', label: 'No music', kinds: ['video'], text: 'No background music.' },
  { id: 'snd-ambience', group: 'Sound', label: 'Natural ambience', kinds: ['video'], text: 'Only natural ambient sound of the location.' },
  { id: 'snd-calm', group: 'Sound', label: 'Calm music', kinds: ['video'], text: 'Calm, soft background music at low volume.' },
  { id: 'snd-upbeat', group: 'Sound', label: 'Upbeat music', kinds: ['video'], text: 'Upbeat trendy background music.' },
  { id: 'cam-push', group: 'Camera', label: 'Slow push-in', kinds: ['video'], text: 'The camera slowly pushes in toward the subject.' },
  { id: 'cam-handheld', group: 'Camera', label: 'Handheld', kinds: ['video'], text: 'Handheld smartphone camera with subtle natural shake.' },
  { id: 'cam-orbit', group: 'Camera', label: 'Orbit', kinds: ['video'], text: 'The camera orbits slowly around the subject.' },
  { id: 'cam-static', group: 'Camera', label: 'Locked-off tripod', kinds: ['image', 'video'], text: 'Static locked-off tripod shot at eye level.' },
  { id: 'cam-selfie', group: 'Camera', label: 'Selfie angle', kinds: ['image', 'video'], text: 'Front-facing selfie angle at arm\'s length.' },
  { id: 'cam-low', group: 'Camera', label: 'Low angle', kinds: ['image', 'video'], text: 'Low camera angle looking slightly up at the subject.' },
  { id: 'lens-85', group: 'Camera', label: '85mm portrait', kinds: ['image'], text: 'Shot on an 85mm lens at f/1.8, shallow depth of field, creamy bokeh.' },
  { id: 'light-golden', group: 'Lighting', label: 'Golden hour', kinds: ['image', 'video'], text: 'Warm golden-hour sunlight backlighting the hair.' },
  { id: 'light-window', group: 'Lighting', label: 'Soft window light', kinds: ['image', 'video'], text: 'Soft diffused window light from the side.' },
  { id: 'light-ring', group: 'Lighting', label: 'Ring light', kinds: ['image', 'video'], text: 'Even ring-light illumination with catchlights in the eyes.' },
  { id: 'light-neon', group: 'Lighting', label: 'Neon night', kinds: ['image', 'video'], text: 'Night scene lit by pink and blue neon signs.' },
  { id: 'light-overcast', group: 'Lighting', label: 'Overcast daylight', kinds: ['image', 'video'], text: 'Soft overcast daylight, no harsh shadows.' },
  { id: 'look-ugc', group: 'Look', label: 'Natural UGC', kinds: ['image', 'video'], text: 'Authentic user-generated look, natural skin texture, no heavy retouching.' },
];

export function presetsFor(kind) {
  return PROMPT_PRESETS.filter((preset) => preset.kinds.includes(kind));
}

/** Append a snippet to a prompt, separated by a space, without duplicating it. */
export function appendSnippet(prompt, snippet) {
  const base = (prompt || '').trim();
  if (!snippet) return base;
  if (base.includes(snippet)) return base;
  return base ? `${base} ${snippet}` : snippet;
}


function styleLine(character, extraStyle) {
  const parts = [character?.styleNotes, extraStyle].map((s) => (s || '').trim()).filter(Boolean);
  return parts.length ? `Style: ${parts.join(' ')}` : null;
}

/**
 * Final prompt for Nano Banana image generation.
 * Image inputs are sent as: character refs, then extra refs.
 */
export function buildImagePrompt({ character = null, characterRefCount = 0, extraRefCount = 0, prompt = '' }) {
  const lines = [...bibleLines(character)];

  if (character && characterRefCount > 0) {
    const range = characterRefCount === 1 ? 'The first reference image shows' : `The first ${characterRefCount} reference images show`;
    lines.push(
      `${range} ${character.name}. Keep the face, hair and signature details exactly as in those images; this must clearly be the same person.`,
    );
  }
  if (extraRefCount > 0) {
    const start = characterRefCount + 1;
    const end = characterRefCount + extraRefCount;
    const which = start === end ? `Reference image ${start} is` : `Reference images ${start}–${end} are`;
    lines.push(`${which} additional references for outfit, objects or setting.`);
  }

  if (prompt.trim()) lines.push(prompt.trim());
  const style = styleLine(character);
  if (style) lines.push(style);
  return lines.join('\n');
}

/**
 * Final prompt for Gemini Omni Flash using media role tags.
 * Media inputs are sent as: first frame, last frame, then references
 * (character refs first). References are bound to <IMAGE_REF_N>.
 */
export function buildVideoPrompt({
  character = null,
  hasFirstFrame = false,
  hasLastFrame = false,
  characterRefCount = 0,
  extraRefCount = 0,
  prompt = '',
  dialogue = '',
}) {
  const refCount = characterRefCount + extraRefCount;
  const lines = [];
  const lastFrame = hasFirstFrame && hasLastFrame;

  if (hasFirstFrame && refCount > 0) {
    // Mixed frames + references: declare sources explicitly (docs: "Declaring
    // sources and references").
    const sources = ['<FIRST_FRAME>@Image1'];
    if (lastFrame) sources.push('<LAST_FRAME>@Image2');
    const offset = lastFrame ? 2 : 1;
    const refs = Array.from({ length: refCount }, (_, i) => `<IMAGE_REF_${i}>@Image${offset + i + 1}`);
    lines.push(`[# Sources ${sources.join(' ')}] [# References ${refs.join(' ')}]`);
  } else if (hasFirstFrame) {
    lines.push(lastFrame ? '<FIRST_FRAME> <LAST_FRAME>' : '<FIRST_FRAME>');
  }

  if (character) {
    const tags = Array.from({ length: characterRefCount }, (_, i) => `<IMAGE_REF_${i}>`).join(' ');
    lines.push(...bibleLines(character, { tags }));
  }
  if (extraRefCount > 0) {
    const tags = Array.from({ length: extraRefCount }, (_, i) => `<IMAGE_REF_${characterRefCount + i}>`).join(' ');
    lines.push(`Additional references: ${tags}.`);
  }

  if (prompt.trim()) lines.push(prompt.trim());
  lines.push(...buildDialogueLines(character, dialogue));
  const style = styleLine(character);
  if (style) lines.push(style);

  if (hasFirstFrame && refCount > 0) {
    lines.push(
      lastFrame
        ? 'Use Image1 as the starting frame and Image2 as the final frame. Use the reference images as character references for video generation; they should not be used as literal frames.'
        : 'Use Image1 as the starting frame. Use the reference images as character references for video generation; they should not be used as literal frames.',
    );
  }
  return lines.join('\n');
}

/**
 * Lines that make Omni speak a given line in the character's described voice.
 * Omni cannot take a stored voice, so the voice is pinned with the same
 * fixed description every time.
 */
export function buildDialogueLines(character, dialogue) {
  const line = (dialogue || '').trim().replace(/"/g, '”');
  if (!line) return [];
  const speaker = character?.name || 'The person';
  const lines = [`${speaker} says to the camera: "${line}"`];
  const voice = (character?.voiceDescription || '').trim();
  if (voice) lines.push(`Voice: ${voice}`);
  lines.push('No other dialogue or voiceover.');
  return lines;
}

/** Rough spoken length of a script, for cost estimates (~2.6 words per second). */
export function estimateSpeechSeconds(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round((words / 2.6 + 0.5) * 10) / 10) : 0;
}

export function buildEditPrompt(prompt, keepEverythingElse = true) {
  const base = (prompt || '').trim();
  if (!keepEverythingElse) return base;
  if (base.toLowerCase().includes(KEEP_SAME_SUFFIX.toLowerCase())) return base;
  const sep = base && !/[.!?]$/.test(base) ? '. ' : ' ';
  return base ? `${base}${sep}${KEEP_SAME_SUFFIX}` : KEEP_SAME_SUFFIX;
}
