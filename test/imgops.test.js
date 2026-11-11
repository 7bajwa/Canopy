// The image tools behind map making, baking and packing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceGray, levels, blur, sharpen, normalsFromHeight, makeMap, dilate, rotateNormal, packChannels, enhanceNormals, grayImage } from '../src/leaf/imgops.js';
import { leafFromLine, meshCutout } from '../src/leaf/cutout.js';

const rgba = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4); return { width: w, height: h, data: d }; };

test('a color key cuts the picked background and keeps the rest', () => {
  const img = rgba(4, 1, (x) => (x < 2 ? [255, 255, 255, 255] : [30, 120, 20, 255]));
  const g = sourceGray(img, 'colorkey', { key: '#ffffff', tolerance: 0.1, softness: 0.05 });
  assert.deepEqual([...g.data], [0, 0, 1, 1]);
});

test('levels invert and clamp; blur keeps the mean; sharpen keeps flat areas flat', () => {
  const g = { width: 3, height: 1, data: Float32Array.from([0, 0.5, 1]) };
  assert.deepEqual([...levels(g, { invert: true }).data], [1, 0.5, 0]);
  const flat = grayImage(8, 8, 0.4);
  assert.ok(blur(flat, 2).data.every((v) => Math.abs(v - 0.4) < 1e-6));
  assert.ok(sharpen(flat, 2).data.every((v) => Math.abs(v - 0.4) < 1e-6));
});

test('a ramp of height leans its normals one way, and flat height points straight out', () => {
  const ramp = { width: 5, height: 5, data: Float32Array.from({ length: 25 }, (_, i) => (i % 5) / 4) };
  const n = normalsFromHeight(ramp, 2);
  const mid = (2 * 5 + 2) * 4;
  assert.ok(n.data[mid] < 120, 'rising to the right faces left');
  assert.ok(Math.abs(n.data[mid + 1] - 127.5) < 2);
  const flat = makeMap(rgba(3, 3, () => [128, 128, 128, 255]), { output: 'normal' });
  assert.ok(Math.abs(flat.data[(4) * 4] - 127.5) < 1 && flat.data[4 * 4 + 2] > 250);
});

test('dilation fills every empty pixel with the color of its filled neighbours', () => {
  const img = rgba(16, 16, (x, y) => (x < 4 && y < 4 ? [200, 50, 10, 255] : [0, 0, 0, 0]));
  const d = dilate(img);
  for (let i = 0; i < 256; i++) assert.deepEqual([d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2]], [200, 50, 10]);
  assert.equal(d.data[255 * 4 + 3], 0, 'alpha stays as it was');
});

test('normals rotate with the piece of texture, and channels pack', () => {
  const [r, g] = rotateNormal(255, 127.5, Math.PI / 2);
  assert.ok(Math.abs(r - 127.5) < 1e-6 && Math.abs(g - 255) < 1e-6);
  const a = rgba(1, 1, () => [10, 20, 30, 40]); const b = rgba(1, 1, () => [50, 60, 70, 80]);
  assert.deepEqual([...packChannels({ a, b }, ['a.r', 'b.g', 'black', 'white'], 1, 1).data], [10, 60, 0, 255]);
  const n = rgba(9, 9, (x) => [128, 128, 255, x > 2 && x < 6 ? 255 : 0]);
  const e = enhanceNormals(n, null, { bevel: 1, bevelWidth: 2 });
  assert.ok(e.data[(4 * 9 + 3) * 4] < 120 && e.data[(4 * 9 + 5) * 4] > 136, 'bevel leans out over both edges');
});

test('a dragged line makes a leaf a little longer than the line, pivot at its start', () => {
  const s = leafFromLine([50, 100], [50, 0]);
  assert.equal(s.outlinePx.length, 8);
  assert.deepEqual(s.basePx, [50, 100]);
  const ys = s.outlinePx.map((p) => p[1]);
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > 100);
  const m = meshCutout(s, 200, 200);
  assert.ok(m.stats.triangles >= 8);
});
