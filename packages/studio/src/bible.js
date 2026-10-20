// Structured "character bible": written by a multimodal Gemini model from the
// character's references (structured JSON output), editable, versioned.
// prompt_paragraph + never_change are prepended to every prompt.

import { DEFAULT_TEXT_MODEL } from './models.js';

export const BIBLE_MODEL = DEFAULT_TEXT_MODEL;

const TEXT = { type: 'string' };
const LIST = { type: 'array', items: { type: 'string' } };

/** JSON schema sent as response_format.schema. */
export const BIBLE_SCHEMA = {
  type: 'object',
  properties: {
    face_shape: TEXT,
    eyes: TEXT,
    brows: TEXT,
    nose: TEXT,
    lips_and_teeth: TEXT,
    skin: {
      type: 'object',
      properties: { tone: TEXT, freckles: TEXT, marks: TEXT },
      required: ['tone', 'freckles', 'marks'],
    },
    hair: {
      type: 'object',
      properties: { color: TEXT, length: TEXT, cut: TEXT, texture: TEXT },
      required: ['color', 'length', 'cut', 'texture'],
    },
    build: TEXT,
    signature_accessories: LIST,
    style_palette: LIST,
    never_change: LIST,
    prompt_paragraph: TEXT,
  },
  required: [
    'face_shape',
    'eyes',
    'brows',
    'nose',
    'lips_and_teeth',
    'skin',
    'hair',
    'build',
    'signature_accessories',
    'style_palette',
    'never_change',
    'prompt_paragraph',
  ],
};

export const BIBLE_FIELDS = [
  { key: 'face_shape', label: 'Face shape' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'brows', label: 'Brows' },
  { key: 'nose', label: 'Nose' },
  { key: 'lips_and_teeth', label: 'Lips & teeth' },
  { key: 'skin.tone', label: 'Skin tone' },
  { key: 'skin.freckles', label: 'Freckles' },
  { key: 'skin.marks', label: 'Marks' },
  { key: 'hair.color', label: 'Hair colour' },
  { key: 'hair.length', label: 'Hair length' },
  { key: 'hair.cut', label: 'Hair cut' },
  { key: 'hair.texture', label: 'Hair texture' },
  { key: 'build', label: 'Build' },
  { key: 'signature_accessories', label: 'Signature accessories', list: true },
  { key: 'style_palette', label: 'Style palette', list: true },
  { key: 'never_change', label: 'Never change', list: true },
];

export function bibleInstructions(name, count) {
  return [
    `The ${count} images are reference photos of one fictional character named ${name}.`,
    'Write a factual appearance bible for keeping this character consistent in generated images and videos.',
    'Rules:',
    '- Describe only what is clearly visible in the images. If something is not visible or differs between images, say "not visible" or "varies" instead of guessing.',
    '- Never compare the character to, or name, any real person, celebrity, model, influencer or public figure. Do not say who they look like.',
    '- Describe features neutrally and concretely (shape, colour, size, position). No judgements of attractiveness, no guesses about ethnicity, nationality or personality.',
    '- Ignore clothing that changes between photos unless it is a recurring signature item; put recurring items in signature_accessories.',
    '- style_palette: the recurring colours and styling of the photos (wardrobe colours, makeup, overall look).',
    '- never_change: 3–8 short, concrete identity details that must stay identical in every image (e.g. "small mole under the left eye").',
    `- prompt_paragraph: 60–90 words, third person, present tense, starting with "${name}", describing only stable physical identity in a form that can be prepended to an image or video prompt. No camera, pose, scene or outfit instructions.`,
  ].join('\n');
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = obj;
  for (const key of keys) {
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[last] = value;
  return obj;
}

const cleanText = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const cleanList = (v) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|;/) : [])
    .map((s) => cleanText(s).replace(/^[-•*]\s*/, ''))
    .filter(Boolean);

/** Coerce any input (model output or edited form) into the bible shape. */
export function normalizeBible(data) {
  const out = {};
  for (const field of BIBLE_FIELDS) {
    const value = get(data || {}, field.key);
    setPath(out, field.key, field.list ? cleanList(value) : cleanText(value));
  }
  out.prompt_paragraph = cleanText(data?.prompt_paragraph);
  return out;
}

export function emptyBible() {
  return normalizeBible({});
}

export function bibleFieldValue(bible, field) {
  const value = get(bible || {}, field.key);
  return field.list ? (value || []).join('\n') : value || '';
}

export function setBibleField(bible, field, text) {
  return setPath(structuredClone(bible || emptyBible()), field.key, field.list ? cleanList(text) : text);
}

export function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Lines prepended to prompts for a character: the bible paragraph, the
 * never-change list, then optional free-text notes.
 */
export function bibleLines(character, { tags = '' } = {}) {
  if (!character) return [];
  const bible = character.bibleData;
  const paragraph = cleanText(bible?.prompt_paragraph);
  const notes = cleanText(character.bible);
  const head = `Character: ${character.name}${tags ? ` ${tags}` : ''}.`;
  const lines = [];
  if (paragraph) lines.push(`${head} ${paragraph}`);
  else lines.push(notes ? `${head} ${notes}` : head);
  const never = cleanList(bible?.never_change);
  if (never.length) lines.push(`Never change: ${never.join('; ')}.`);
  if (paragraph && notes) lines.push(`Notes: ${notes}`);
  return lines;
}
