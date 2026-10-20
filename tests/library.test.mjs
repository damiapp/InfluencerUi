import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRefs, primaryRefs, MAX_PRIMARY_REFS } from '../packages/studio/src/refs.js';
import { BIBLE_SCHEMA, bibleInstructions, bibleLines, normalizeBible, setBibleField, BIBLE_FIELDS, countWords } from '../packages/studio/src/bible.js';
import { buildImagePrompt, buildVideoPrompt } from '../packages/studio/src/prompt.js';
import { estimateCost, textCostFromUsage } from '../packages/studio/src/pricing.js';
import pricing from '../config/pricing.json' with { type: 'json' };

const ref = (id, angle, expression, lighting, primary = false) => ({ id, angle, expression, lighting, primary });

const library = [
  ref('f1', 'front', 'neutral', 'studio'),
  ref('f2', 'front', 'neutral', 'studio'),
  ref('f3', 'front', 'big smile', 'golden hour', true),
  ref('t1', 'three-quarter', 'neutral', 'studio'),
  ref('t2', 'three-quarter', 'laughing', 'night'),
  ref('p1', 'profile', 'neutral', 'soft daylight', true),
  ref('b1', 'full-body', 'soft smile', 'hard sun'),
  ref('u1', null, null, null),
];

test('primaries come first, then one of each angle before repeats', () => {
  const picked = selectRefs(library, 5).map((r) => r.id);
  assert.deepEqual(picked.slice(0, 2), ['f3', 'p1']);
  // New angles (three-quarter, full-body) beat a second front or profile.
  assert.ok(picked.includes('b1'));
  assert.ok(picked.some((id) => id.startsWith('t')));
  assert.equal(new Set(picked).size, 5);
});

test('within an angle, new expression/lighting wins over a duplicate', () => {
  const picked = selectRefs(library, 6).map((r) => r.id);
  assert.ok(picked.includes('t2') || picked.includes('t1'));
  // f1/f2 are identical; at most one of them makes it into 6.
  assert.ok(!(picked.includes('f1') && picked.includes('f2')));
});

test('budget, exclusions, untagged last, primaries capped', () => {
  assert.equal(selectRefs(library, 3).length, 3);
  assert.equal(selectRefs(library, 100).length, library.length);
  assert.equal(selectRefs(library, 8).at(-1).id, 'f2');
  assert.ok(!selectRefs(library, 8, { exclude: ['f3'] }).some((r) => r.id === 'f3'));
  const manyPrimary = Array.from({ length: 6 }, (_, i) => ref(`x${i}`, 'front', null, null, true));
  assert.equal(selectRefs(manyPrimary, 6).filter((r) => r.primary).length, 6);
  assert.equal(selectRefs(manyPrimary, 6).slice(0, MAX_PRIMARY_REFS).every((r) => r.primary), true);
  assert.deepEqual(primaryRefs(library, 2).map((r) => r.id), ['f3', 'p1']);
  assert.deepEqual(primaryRefs([ref('a', 'front'), ref('b', 'profile')], 1).map((r) => r.id), ['a']);
});

test('bible schema, instructions and normalisation', () => {
  assert.deepEqual(BIBLE_SCHEMA.required.length, 12);
  assert.deepEqual(Object.keys(BIBLE_SCHEMA.properties.skin.properties), ['tone', 'freckles', 'marks']);
  assert.deepEqual(Object.keys(BIBLE_SCHEMA.properties.hair.properties), ['color', 'length', 'cut', 'texture']);
  const text = bibleInstructions('Lena', 15);
  assert.match(text, /Never compare the character to, or name, any real person/);
  assert.match(text, /60–90 words/);
  const b = normalizeBible({ eyes: ' green ', never_change: '- mole\n- bob', hair: { color: 'copper' }, extra: 'x' });
  assert.equal(b.eyes, 'green');
  assert.deepEqual(b.never_change, ['mole', 'bob']);
  assert.equal(b.hair.color, 'copper');
  assert.equal(b.hair.cut, '');
  assert.equal(b.extra, undefined);
  const field = BIBLE_FIELDS.find((f) => f.key === 'skin.marks');
  assert.equal(setBibleField(b, field, 'scar').skin.marks, 'scar');
  assert.equal(countWords(' a b  c '), 3);
});

test('bible paragraph and never-change list are prepended to prompts', () => {
  const lena = {
    name: 'Lena',
    bible: 'Usually wears a beret.',
    styleNotes: '',
    bibleData: normalizeBible({ prompt_paragraph: 'Lena has copper hair.', never_change: ['copper bob', 'green eyes'] }),
  };
  assert.deepEqual(bibleLines(lena), ['Character: Lena. Lena has copper hair.', 'Never change: copper bob; green eyes.', 'Notes: Usually wears a beret.']);
  assert.match(buildImagePrompt({ character: lena, characterRefCount: 6, prompt: 'At the beach.' }), /^Character: Lena\. Lena has copper hair\.\nNever change: copper bob; green eyes\./);
  const video = buildVideoPrompt({ character: lena, hasFirstFrame: true, characterRefCount: 2, prompt: 'She waves.' });
  assert.match(video, /^\[# Sources <FIRST_FRAME>@Image1\] \[# References <IMAGE_REF_0>@Image2 <IMAGE_REF_1>@Image3\]\nCharacter: Lena <IMAGE_REF_0> <IMAGE_REF_1>\. Lena has copper hair\.\nNever change/);
  // Without a structured bible, the free-text bible is used as before.
  assert.deepEqual(bibleLines({ name: 'Mia', bible: 'Freckles.' }), ['Character: Mia. Freckles.']);
});

test('text pricing: estimate and exact cost from usage', () => {
  assert.equal(estimateCost(pricing, { kind: 'text', model: 'gemini-3.8-flash', inputImages: 15 }), 0.0239);
  assert.equal(textCostFromUsage(pricing, 'gemini-3.8-flash', { total_input_tokens: 1_000_000, total_output_tokens: 0 }), 0.75);
  assert.equal(textCostFromUsage(pricing, 'gemini-3.8-flash', null), null);
});
