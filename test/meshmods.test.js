// Subdivide and Thickness on a flat square sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { subdivide, thicken } from '../src/engine/meshmods.js';

// A 3×3 grid of points in the XY plane, facing +Z, two triangles per cell.
function sheet() {
  const P = []; const N = []; const UV = []; const C = []; const W = []; const I = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { P.push(x * 10, y * 10, 0); N.push(0, 0, 1); UV.push(x / 2, y / 2); C.push(1, 1, 1); W.push(7, y / 2, 0); }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const a = y * 3 + x; I.push(a, a + 1, a + 4, a, a + 4, a + 3); }
  return { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(UV), color: Float32Array.from(C), wind: Float32Array.from(W), index: Uint32Array.from(I), kind: 'leaf' };
}

test('subdivide quarters the triangles, keeps corners and carries every array', () => {
  const m = sheet();
  subdivide(m, 1, 1, true);
  assert.equal(m.index.length, 8 * 3 * 4);
  const n = m.position.length / 3;
  for (const k of ['normal', 'color', 'wind']) assert.equal(m[k].length, n * 3);
  assert.equal(m.uv.length, n * 2);
  assert.deepEqual([...m.position.slice(0, 3)], [0, 0, 0], 'a corner stays put');
  assert.ok([...m.wind].every((v, i) => i % 3 !== 0 || v === 7), 'line numbers are copied, not averaged');
  const two = sheet(); subdivide(two, 2, 0, true);
  assert.equal(two.index.length, 8 * 3 * 16);
  for (let i = 2; i < two.position.length; i += 3) assert.equal(two.position[i], 0, 'smooth 0 keeps a flat sheet flat');
});

// A long sheet, 3 points across (x, 5 apart) and 5 along (y, 10 apart): 10 wide, 40 long.
function strip() {
  const P = []; const N = []; const UV = []; const W = []; const I = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { P.push(x * 5, y * 10, 0); N.push(0, 0, 1); UV.push(x / 2, y / 4); W.push(0, y / 4, 0); }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) { const a = y * 3 + x; I.push(a, a + 1, a + 4, a, a + 4, a + 3); }
  return { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(UV), wind: Float32Array.from(W), index: Uint32Array.from(I), kind: 'leaf' };
}

test('thickness follows the cutout width and pinches only the outline', () => {
  const m = strip(); const nv = 15;
  thicken(m, { amount: 0.5, pinch: 0.5, both: true });
  assert.equal(m.index.length / 3, 16 * 2 + 12 * 2, 'front, back and two triangles per border edge');
  const gap = (v) => m.position[v * 3 + 2] - m.position[(nv + v) * 3 + 2];
  assert.ok(Math.abs(gap(7) - 5) < 1e-5, 'half of the 10 wide piece inside');
  assert.ok(Math.abs(gap(4) - 5) < 1e-5, 'every inner point keeps the full thickness');
  assert.ok(Math.abs(gap(6) - 2.5) < 1e-5 && Math.abs(gap(0) - 2.5) < 1e-5, 'outline points, corners included, are pinched');
  assert.ok(m.normal[(nv + 7) * 3 + 2] < 0, 'the back faces back');
  const curved = strip();
  thicken(curved, { amount: 0.5, pinch: 1, pinchCurve: { pts: [[0, 0, 'l'], [1, 0, 'l']] } });
  assert.ok(Math.abs(curved.position[6 * 3 + 2] - curved.position[(nv + 6) * 3 + 2] - 5) < 1e-5, 'a pinch curve at 0 leaves the sides full');
});
