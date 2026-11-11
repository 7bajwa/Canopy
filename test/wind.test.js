// Wind and free-form cutouts: the parts that keep a plant in one piece when it moves or is edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { gustAt, WIND_STRIDE } from '../src/engine/wind.js';
import { defaultParams } from '../src/graph/schema.js';
import { meshCutout, triangulateInner } from '../src/leaf/cutout.js';

let ids = 0;
const node = (type, params = {}) => ({ id: `w${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const link = (a, b) => ({ id: `l${a.id}${b.id}`, from: a.id, fromSock: 'children', to: b.id, toSock: 'parent' });
const build = (nodes, links = []) => new Evaluator({ nodes, links, groups: [], settings: { seed: 1 } }).run();

// The shader's job, done here on the CPU so a test can see whether parts stay together.
function bendAt(table, p, line, weight, strength) {
  let q = [...p]; let i = line; let w = weight;
  while (i >= 0) {
    const k = i * WIND_STRIDE;
    const o = [table[k], table[k + 1], table[k + 2]];
    const d = [table[k + 4], table[k + 5], table[k + 6]];
    const wind = [1, 0, 0];
    const ax = [d[1] * wind[2] - d[2] * wind[1], d[2] * wind[0] - d[0] * wind[2], d[0] * wind[1] - d[1] * wind[0]];
    const m = Math.hypot(...ax);
    if (m > 0.05) {
      const n = ax.map((x) => x / m);
      const a = strength * table[k + 8] * w;
      const v = q.map((x, j) => x - o[j]);
      const cr = [n[1] * v[2] - n[2] * v[1], n[2] * v[0] - n[0] * v[2], n[0] * v[1] - n[1] * v[0]];
      const dt = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
      q = v.map((x, j) => o[j] + x * Math.cos(a) + cr[j] * Math.sin(a) + n[j] * dt * (1 - Math.cos(a)));
    }
    w = table[k + 7];
    i = table[k + 3];
  }
  return q;
}

test('every vertex names its line, and children point at their parent', () => {
  const trunk = node('Spline', { length: 300 });
  const twig = node('Spline', { place: 'spline', density: 3, length: 60, tipOn: false });
  const r = build([trunk, twig], [link(trunk, twig)]);
  const count = r.windLines.length / WIND_STRIDE;
  assert.equal(count, r.stats.lines);
  for (const m of r.meshes) {
    assert.equal(m.wind.length, m.position.length);
    for (let i = 0; i < m.wind.length; i += 3) assert.ok(m.wind[i] >= 0 && m.wind[i] < count);
  }
  assert.equal(r.windLines[3], -1, 'the trunk has no parent');
  assert.ok(r.windLines[WIND_STRIDE + 3] === 0, 'a twig hangs from the trunk');
});

test('the base stays put, the tip swings, and a branch stays on its parent while bending', () => {
  const trunk = node('Spline', { length: 400, blend: false });
  const twig = node('Spline', { place: 'spline', start: 50, end: 60, density: 8, length: 100, tilt: 60, tipOn: false, blend: false });
  const r = build([trunk, twig], [link(trunk, twig)]);
  const T = r.windLines;
  // Trunk bend at the very bottom and top.
  const base = [T[0], T[1], T[2]];
  assert.deepEqual(bendAt(T, base, 0, 0, 0.3).map((x) => +x.toFixed(4)), base.map((x) => +x.toFixed(4)));
  assert.ok(bendAt(T, [0, 400, 0], 0, 1, 0.3)[0] > 10, 'the top of the trunk leans with the wind');

  // A twig's base point, carried as part of the twig, must land where the trunk's surface at that height lands.
  const k = WIND_STRIDE;
  const b = [T[k], T[k + 1], T[k + 2]];
  const asTwig = bendAt(T, b, 1, 0, 0.3);
  const asTrunk = bendAt(T, b, 0, T[k + 7], 0.3);
  assert.ok(Math.hypot(asTwig[0] - asTrunk[0], asTwig[1] - asTrunk[1], asTwig[2] - asTrunk[2]) < 1e-3, 'the joint stays connected');
});

test('bending keeps lengths: the trunk arcs instead of stretching', () => {
  const trunk = node('Spline', { length: 400 });
  const T = build([trunk]).windLines;
  const tip = bendAt(T, [0, 400, 0], 0, 1, 0.3);
  assert.ok(Math.abs(Math.hypot(...tip) - 400) < 1e-3);
});

test('gusts start calm, stay in the range, and return to calm', () => {
  const o = { min: 2, max: 6, freq: 10 };
  let top = 0; let calm = 0;
  for (let t = 0; t < 600; t += 0.05) {
    const g = gustAt(t, o);
    assert.ok(g >= 0);
    top = Math.max(top, g);
    if (g < 0.01) calm++;
  }
  assert.ok(top > 2 && top <= 6 * 1.21 + 1e-6, `peak ${top}`);
  assert.ok(calm > 100, 'there are calm moments between gusts');
  assert.equal(gustAt(0, o), 0);
});

test('gusts change smoothly, with no jumps', () => {
  let last = 0;
  for (let t = 0; t < 120; t += 0.02) {
    const g = gustAt(t);
    assert.ok(Math.abs(g - last) < 0.8, `jump of ${g - last} at ${t}`);
    last = g;
  }
});

test('a wind tab value reaches the table, with its variation', () => {
  const quiet = node('Spline', { length: 100, windPower: 0 });
  assert.equal(build([quiet]).windLines[8], 0);
  const varied = node('Spline', { count: 8, length: 100, vary: { windPower: 80 } });
  const T = build([varied]).windLines;
  const powers = new Set();
  for (let i = 0; i < T.length; i += WIND_STRIDE) powers.add(T[i + 8]);
  assert.ok(powers.size > 3);
});

test('a Mesh on a branch rides it, and a Mesh with no parent stays still', () => {
  const stem = node('Spline', { length: 200 });
  const fruit = node('Mesh', { place: 'spline', density: 3, radius: 3, tipOn: false });
  const r = build([stem, fruit], [link(stem, fruit)]);
  const solid = r.meshes.find((m) => m.kind === 'solid');
  const line = solid.wind[0];
  assert.equal(r.windLines[line * WIND_STRIDE + 3], 0, 'its parent is the stem');
  const alone = build([node('Mesh', { radius: 10 })]);
  assert.equal(alone.windLines[8], 0);
});

test('Mesh copies get their own transform, variation and curve', () => {
  const box = (m) => { let lo = Infinity; let hi = -Infinity; for (let i = 0; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); } return [lo, hi]; };
  const plain = build([node('Mesh', { radius: 10 })]).meshes[0];
  const moved = build([node('Mesh', { radius: 10, posX: 50 })]).meshes[0];
  assert.ok(Math.abs(box(moved)[0] - box(plain)[0] - 50) < 0.5);
  const big = build([node('Mesh', { radius: 10, sclU: 2 })]).meshes[0];
  assert.ok(box(big)[1] > box(plain)[1] * 1.9);
  // Counted along a line of copies: variation must shift them apart.
  const a = build([node('Mesh', { place: 'point', count: 5, radius: 5 })]).meshes[0];
  const b = build([node('Mesh', { place: 'point', count: 5, radius: 5, vary: { posX: 60 } })]).meshes[0];
  assert.ok(box(b)[1] - box(b)[0] > box(a)[1] - box(a)[0] + 10);
});

test('curves can be set per level of the chain, and multiply together', () => {
  const trunk = node('Spline', { length: 400 });
  const lens = (curves) => {
    const twig = node('Spline', { place: 'spline', start: 0, end: 100, density: 6, length: 100, tipOn: false, curves: { ...defaultParams('Spline').curves, ...curves } });
    const r = build([trunk, twig], [link(trunk, twig)]);
    const out = []; const T = r.windLines;
    for (let i = WIND_STRIDE; i < T.length; i += WIND_STRIDE) out.push(T[i + 1]);
    const { position: P, lineId } = r.lines;
    const tops = new Map();
    for (let i = 0; i < lineId.length; i++) tops.set(lineId[i], Math.max(tops.get(lineId[i]) ?? -Infinity, P[i * 3 + 1]));
    return [...tops.values()];
  };
  const flat = lens({});
  const scoped = lens({ [`length@${trunk.id}`]: { pts: [[0, 0.2, 's'], [1, 0.2, 's']] } });
  assert.ok(Math.max(...scoped) < Math.max(...flat), 'a curve on the parent level shortens the children');
  const global = lens({ 'length@global': { pts: [[0, 0.2, 's'], [1, 0.2, 's']] } });
  assert.ok(Math.max(...global) < Math.max(...flat));
});

test('points inside a leaf all join the mesh, and it keeps its area', () => {
  const outline = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const all = [...outline, [50, 50], [25, 25], [75, 60]];
  const tris = triangulateInner(all, 4);
  assert.equal(tris.length / 3, 2 + 3 * 2);
  for (let i = 0; i < all.length; i++) assert.ok(tris.includes(i), `point ${i} is unused`);
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.ok(Math.abs(area - 10000) < 1);
});

test('a hand-edited cutout builds a leaf that faces its line and uses the atlas', () => {
  const c = meshCutout({ name: 'Mine', basePx: [50, 100], tipPx: [50, 0], outlinePx: [[0, 100], [100, 100], [100, 0], [0, 0]], innerPx: [[50, 50]] }, 200, 200);
  assert.equal(c.mesh.pts.length, 5);
  assert.equal(c.stats.triangles, 4);
  assert.ok(Math.abs(c.tmin) < 1e-9 && Math.abs(c.tmax - 1) < 1e-9);
  const p0 = c.mesh.pts[0];
  assert.deepEqual([p0.u, p0.v], [0, 0.5]);
  const r = build([node('Spline', { meshType: 'cutout', length: 40, cutouts: [c], texture: null, angleAcross: 0, incAcross: 0, softNormals: 0 })]);
  const leaf = r.meshes.find((m) => m.kind === 'leaf');
  assert.equal(leaf.index.length, 12);
  // Every triangle agrees with the normals it was given.
  const { position: P, normal: N, index: I } = leaf;
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, d] = [I[i] * 3, I[i + 1] * 3, I[i + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const w = [P[d] - P[a], P[d + 1] - P[a + 1], P[d + 2] - P[a + 2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    assert.ok(f[0] * N[a] + f[1] * N[a + 1] + f[2] * N[a + 2] > 0, 'triangle faces against its normal');
  }
});
