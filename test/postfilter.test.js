import test from 'node:test';
import assert from 'node:assert/strict';
import { postFilter } from '../src/leaf/imgops.js';

const img = (w, h, v) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });

test('post filters: neutral settings keep the picture, exposure and vignette change it as expected', () => {
  const a = img(9, 9, 128);
  assert.deepEqual([...postFilter(a, {}).data], [...a.data]);
  assert.ok(postFilter(a, { exposure: 1 }).data[0] > 200, 'one stop up brightens');
  const v = postFilter(a, { vignette: 1, vignetteSoft: 0 }).data;
  const at = (x, y) => v[(y * 9 + x) * 4];
  assert.ok(at(0, 0) < at(4, 4), 'corners darker than the middle');
  assert.equal(v[3], 128, 'alpha untouched');
  const warm = postFilter(a, { temperature: 1 }).data;
  assert.ok(warm[0] > warm[2], 'warm makes red above blue');
});
