// The file plan behind Bake and Pack: suffixes, opacity in the diffuse's alpha or apart, and the packed texture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFiles, EXPORT_DEFAULTS, settle } from '../src/app/texout.js';

const img = (v) => ({ width: 2, height: 1, data: Uint8ClampedArray.of(v, v, v, 255, v, v, v, 0) });
const maps = () => ({ color: img(200), opacity: img(255), normal: img(128), roughness: img(90), ao: img(30), subsurface: img(60) });

test('each checked map gets a file with its own suffix', () => {
  const o = settle(structuredClone(EXPORT_DEFAULTS));
  o.suffix.color = 'Albedo';
  const files = planFiles(maps(), o);
  assert.deepEqual(files.map((f) => f.suffix), ['Albedo', 'Normal', 'Roughness', 'AO']);
  assert.equal(files[0].slots.opacityMap, 'A', 'opacity rides in the diffuse alpha');
});

test('opacity apart, and a packed texture whose maps the material reads when they have no file', () => {
  const o = settle(structuredClone(EXPORT_DEFAULTS));
  o.opacityInColor = false; o.maps.ao = false; o.packed.on = true;
  const files = planFiles(maps(), o);
  assert.ok(files.some((f) => f.key === 'opacity' && f.slots.opacityMap === 'R'));
  const packed = files.find((f) => f.key === 'packed');
  assert.equal(packed.suffix, 'Mask');
  assert.equal(packed.img.data[0], 30, 'AO in red');
  assert.equal(packed.slots.aoMap, 'R', 'AO is read from the mask');
  assert.equal(packed.slots.roughMap, undefined, 'roughness has its own file, so it is read from there');
});

test('old settings fill in the new parts', () => {
  const o = settle({ name: 'x', maps: { color: true, ao: true }, dilate: false, pack: true });
  assert.equal(o.dil.color, false);
  assert.equal(o.suffix.ao, 'AO');
  assert.equal(o.pack, undefined);
});
