// Crumple on a flat card: the base stays, corners move, the same seed gives the same result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMeshMods } from '../src/engine/meshmods.js';

// A 5x5 card in the XY plane facing +Z, base along y = 0. The middle column is split in two (a UV seam), so the
// card has points that share a place without sharing an index.
function card(wind = true) {
  const P = []; const N = []; const UV = []; const W = []; const I = [];
  const at = [];
  for (let y = 0; y < 5; y++) {
    at.push([]);
    for (let x = 0; x < 5; x++) {
      const add = () => { P.push((x - 2) * 5, y * 10, 0); N.push(0, 0, 1); UV.push(x / 4, y / 4); W.push(3, y / 4, 0); return P.length / 3 - 1; };
      at[y].push(x === 2 ? [add(), add()] : [add(), add()].slice(0, 1));
    }
  }
  const id = (x, y, right) => at[y][x][x === 2 && right ? 1 : 0];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const r = x >= 2; const a = id(x, y, r); const b = id(x + 1, y, r); const c = id(x + 1, y + 1, r); const d = id(x, y + 1, r);
    I.push(a, b, c, a, c, d);
  }
  const m = { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(UV), index: Uint32Array.from(I) };
  if (wind) m.wind = Float32Array.from(W);
  return m;
}

const mods = (seed = 1) => [{ type: 'crumple', on: true, params: { amount: 0.8, curl: 0.5, wrinkle: 0.3, wrinkleScale: 2, seed } }];

test('crumple keeps the base, moves the corners and keeps shared points together', () => {
  const m = card(); const before = Float32Array.from(m.position);
  applyMeshMods(m, mods());
  const V = m.position; const n = V.length / 3;
  for (let v = 0; v < n; v++) {
    if (before[v * 3 + 1] === 0) for (let k = 0; k < 3; k++) assert.ok(Math.abs(V[v * 3 + k] - before[v * 3 + k]) < 1e-6, 'base point stays put');
  }
  const corner = [...Array(n).keys()].find((v) => before[v * 3] === -10 && before[v * 3 + 1] === 40);
  assert.ok(Math.hypot(V[corner * 3] - before[corner * 3], V[corner * 3 + 1] - before[corner * 3 + 1], V[corner * 3 + 2] - before[corner * 3 + 2]) > 0.5, 'tip corner moves');
  // Points that started in one place end in one place.
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) {
    if (before[u * 3] === before[v * 3] && before[u * 3 + 1] === before[v * 3 + 1]) for (let k = 0; k < 3; k++) assert.ok(Math.abs(V[u * 3 + k] - V[v * 3 + k]) < 1e-5, 'seam stays welded');
  }
  assert.ok([...V].every(Number.isFinite));
});

test('crumple is deterministic and the seed changes it', () => {
  const a = card(); const b = card(); const c = card();
  applyMeshMods(a, mods(1)); applyMeshMods(b, mods(1)); applyMeshMods(c, mods(2));
  assert.deepEqual([...a.position], [...b.position]);
  assert.notDeepEqual([...a.position], [...c.position]);
});

test('crumple works on a plain card without wind data', () => {
  const m = card(false); const before = Float32Array.from(m.position);
  applyMeshMods(m, mods());
  assert.ok(Math.abs(m.position[2] - before[2]) < 1e-6, 'its first point (the base) stays');
  assert.ok([...m.position].some((x, i) => Math.abs(x - before[i]) > 0.1));
});
