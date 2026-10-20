import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImagePrompt,
  buildVideoPrompt,
  buildEditPrompt,
  appendSnippet,
  KEEP_SAME_SUFFIX,
} from '../packages/studio/src/prompt.js';
import { estimateCost } from '../packages/studio/src/pricing.js';
import pricing from '../config/pricing.json' with { type: 'json' };

const mia = { name: 'Mia', bible: 'Freckles, copper bob haircut, small nose ring.', styleNotes: 'Warm film tones.' };

test('image prompt prepends the bible and explains reference order', () => {
  const out = buildImagePrompt({ character: mia, characterRefCount: 3, extraRefCount: 1, prompt: 'Drinking coffee in Paris.' });
  const lines = out.split('\n');
  assert.equal(lines[0], 'Character: Mia. Freckles, copper bob haircut, small nose ring.');
  assert.match(out, /The first 3 reference images show Mia/);
  assert.match(out, /Reference image 4 is additional/);
  assert.match(out, /Drinking coffee in Paris\./);
  assert.equal(lines.at(-1), 'Style: Warm film tones.');
});

test('image prompt without a character is just the prompt', () => {
  assert.equal(buildImagePrompt({ prompt: '  a cat ' }), 'a cat');
});

test('video prompt with first frame only uses the simple tag', () => {
  const out = buildVideoPrompt({ hasFirstFrame: true, prompt: 'She waves.' });
  assert.equal(out, '<FIRST_FRAME>\nShe waves.');
});

test('video prompt with frames and refs declares sources', () => {
  const out = buildVideoPrompt({ character: mia, hasFirstFrame: true, hasLastFrame: true, characterRefCount: 2, extraRefCount: 1, prompt: 'Walks.' });
  assert.match(out, /^\[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2\] \[# References <IMAGE_REF_0>@Image3 <IMAGE_REF_1>@Image4 <IMAGE_REF_2>@Image5\]/);
  assert.match(out, /Character: Mia <IMAGE_REF_0> <IMAGE_REF_1>\./);
  assert.match(out, /Additional references: <IMAGE_REF_2>\./);
  assert.match(out, /Use Image1 as the starting frame and Image2 as the final frame/);
});

test('last frame is ignored without a first frame', () => {
  const out = buildVideoPrompt({ hasLastFrame: true, prompt: 'x' });
  assert.equal(out, 'x');
});

test('edit prompt appends keep-the-same once', () => {
  assert.equal(buildEditPrompt('Make her jacket red'), `Make her jacket red. ${KEEP_SAME_SUFFIX}`);
  assert.equal(buildEditPrompt('Make it rain.'), `Make it rain. ${KEEP_SAME_SUFFIX}`);
  assert.equal(buildEditPrompt(`Rain. ${KEEP_SAME_SUFFIX}`), `Rain. ${KEEP_SAME_SUFFIX}`);
  assert.equal(buildEditPrompt('Rain', false), 'Rain');
});

test('appendSnippet does not duplicate', () => {
  assert.equal(appendSnippet('a', 'b.'), 'a b.');
  assert.equal(appendSnippet('a b.', 'b.'), 'a b.');
  assert.equal(appendSnippet('', 'b.'), 'b.');
});

test('cost estimates', () => {
  assert.equal(estimateCost(pricing, { kind: 'image', model: 'gemini-3-pro-image', imageSize: '4K', count: 2 }), 0.48);
  assert.equal(estimateCost(pricing, { kind: 'video', model: 'gemini-omni-1.1-flash', resolution: '720p', durationSeconds: 10 }), 1.01);
  assert.equal(estimateCost(pricing, { kind: 'video', model: 'unknown' }), null);
});
