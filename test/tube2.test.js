// Tube welding, tip rings, UV angle and the tile range.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { rotateUv } from '../src/engine/tube.js';
import { defaultParams } from '../src/graph/schema.js';

const node = (id, type, params = {}) => ({ id, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const graph = (nodes, links = []) => ({ nodes, links: links.map(([a, b], i) => ({ id: `l${i}`, from: a, fromSock: 'children', to: b, toSock: 'parent' })), groups: [], settings: { seed: 1 } });
const bark = (r, id) => r.meshes.find((m) => m.kind === 'bark' && m.nodeId === id);
const key = (m, i) => `${m.position[i * 3]},${m.position[i * 3 + 1]},${m.position[i * 3 + 2]}`;

test('tube seam and cap tip are welded: near points are the same point, with one normal', () => {
  const s = node('a', 'Spline', { length: 120, radius: 6, rotX: 50, capTop: true });
  const m = bark(new Evaluator(graph([s])).run(), 'a');
  const n = m.position.length / 3;
  const byKey = new Map();
  for (let i = 0; i < n; i++) (byKey.get(key(m, i)) || byKey.set(key(m, i), []).get(key(m, i))).push(i);
  let twins = 0;
  for (const list of byKey.values()) {
    for (const i of list.slice(1)) {
      twins++;
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(m.normal[i * 3 + k] - m.normal[list[0] * 3 + k]) < 1e-5, 'welded points share a normal');
    }
  }
  assert.ok(twins > 0, 'the seam has twin points');
  const reps = [...byKey.values()].map((l) => l[0]);
  for (let a = 0; a < reps.length; a++) {
    for (let b = a + 1; b < reps.length; b++) {
      const d = Math.hypot(...[0, 1, 2].map((k) => m.position[reps[a] * 3 + k] - m.position[reps[b] * 3 + k]));
      assert.ok(d > 1e-3, `a gap of ${d} between two points that should be one`);
    }
  }
});

test('a tip tube starts on its parent last ring: same points, same normals', () => {
  const g = graph([node('a', 'Spline', { length: 100, radius: 8 }), node('b', 'Spline', { place: 'spline', density: 1, length: 60, radius: 3, tipOn: true, tipTilt: 20 })], [['a', 'b']]);
  const r = new Evaluator(g).run();
  const pa = bark(r, 'a'); const pb = bark(r, 'b');
  const at = new Map();
  for (let i = 0; i < pa.position.length / 3; i++) at.set(key(pa, i), i);
  let shared = 0;
  for (let i = 0; i < pb.position.length / 3; i++) {
    const j = at.get(key(pb, i));
    if (j === undefined) continue;
    shared++;
    for (let k = 0; k < 3; k++) assert.equal(pb.normal[i * 3 + k], pa.normal[j * 3 + k]);
  }
  assert.ok(shared >= 4, `only ${shared} shared points`);
});

test('uvAngle 90 swaps the axes: u becomes 1 - v, v becomes u', () => {
  const uv = new Float32Array([0.2, 0.7, 3, -1]);
  rotateUv(uv, 0, 2, 90);
  assert.ok(Math.abs(uv[0] - 0.3) < 1e-6 && Math.abs(uv[1] - 0.2) < 1e-6);
  assert.ok(Math.abs(uv[2] - 2) < 1e-5 && Math.abs(uv[3] - 3) < 1e-5);
  const run = (uvAngle) => bark(new Evaluator(graph([node('a', 'Spline', { length: 120, radius: 6, uvAngle })])).run(), 'a');
  const m0 = run(0); const m9 = run(90);
  assert.equal(m0.uv.length, m9.uv.length);
  for (let i = 0; i < m0.uv.length; i += 2) {
    assert.ok(Math.abs(m9.uv[i] - (1 - m0.uv[i + 1])) < 1e-4 && Math.abs(m9.uv[i + 1] - m0.uv[i]) < 1e-4);
  }
});

test('tile range: V runs once to Tile from, then repeats from..to, and no face spans the jump', () => {
  const run = (p) => bark(new Evaluator(graph([node('a', 'Spline', { length: 300, radius: 6, capTop: false, ...p })])).run(), 'a');
  const plain = run({}); const m = run({ uvTileFrom: 0.5, uvTileTo: 1 });
  let lo = Infinity; let hi = -Infinity;
  for (let i = 1; i < m.uv.length; i += 2) { lo = Math.min(lo, m.uv[i]); hi = Math.max(hi, m.uv[i]); }
  assert.ok(lo < 0.05 && hi <= 1 + 1e-4, `V ${lo}..${hi}`);
  let plainHi = 0; for (let i = 1; i < plain.uv.length; i += 2) plainHi = Math.max(plainHi, plain.uv[i]);
  assert.ok(plainHi > 3, 'without a range V keeps climbing');
  assert.ok(m.position.length > plain.position.length, 'the wrap rings are doubled');
  // Up the straight tube V only climbs inside each face; a face over the jump would run back down.
  for (let t = 0; t < m.index.length; t += 3) {
    const p = [0, 1, 2].map((k) => m.index[t + k]).sort((a, b) => m.position[a * 3 + 1] - m.position[b * 3 + 1]);
    for (let k = 1; k < 3; k++) assert.ok(m.uv[p[k] * 2 + 1] >= m.uv[p[k - 1] * 2 + 1] - 1e-4, 'a face spans a tile jump');
  }
});
