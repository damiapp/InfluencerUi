import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPolicyBlock } from '../lib/generations.js';

test('policy refusals are recognised, technical errors are not', () => {
  assert.equal(isPolicyBlock('Gemini API error (400): The prompt could not be submitted because it may depict a prominent person.'), true);
  assert.equal(isPolicyBlock('finish reason IMAGE_SAFETY'), true);
  assert.equal(isPolicyBlock('Content blocked by Responsible AI practices'), true);
  assert.equal(isPolicyBlock('I can’t create images of real people.', { noMedia: true }), true);
  assert.equal(isPolicyBlock('No media was returned and Google gave no reason.', { noMedia: true }), false);
  assert.equal(isPolicyBlock('Gemini API error (503): The model is overloaded.'), false);
  assert.equal(isPolicyBlock('fetch failed'), false);
});
