import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateGrowth, GROWTH_PRESETS } from '../src/engine/growth.js';
import { evaluate } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';

const alive = (nodes) => nodes.filter((n) => n.alive);

test('growth makes a branching, tapering tree that gets bigger with the years', () => {
  const young = alive(simulateGrowth({ growYears: 5 }, 1, [0, 0, 0], [0, 1, 0]));
  const old = alive(simulateGrowth({ growYears: 15 }, 1, [0, 0, 0], [0, 1, 0]));
  assert.ok(old.length > young.length * 2, `${young.length} -> ${old.length}`);
  assert.ok(old.some((n) => n.order >= 2), 'side branches of side branches');
  const top = Math.max(...old.map((n) => n.p[1]));
  assert.ok(top > 200, `it grows up: ${top}`);
  assert.ok(old[0].r > old[old.length - 1].r * 3, 'thick at the base, thin at the tips');
});

test('apical control changes the habit: high apical is narrower and taller', () => {
  const shape = (apical) => { const n = alive(simulateGrowth({ growYears: 14, apical }, 3, [0, 0, 0], [0, 1, 0])); const h = Math.max(...n.map((x) => x.p[1])); const w = Math.max(...n.map((x) => Math.hypot(x.p[0], x.p[2]))); return h / Math.max(1, w); };
  assert.ok(shape(0.6) > shape(0.46), `${shape(0.6)} vs ${shape(0.46)}`);
});

test('a Spline with Growth on builds a tree, and leaves grow on it', () => {
  const tree = { id: 't', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), ...GROWTH_PRESETS.Birch, growOn: true, growYears: 10 } };
  const leaves = { id: 'l', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), place: 'spline', density: 20, length: 8, meshType: 'leaf' } };
  const r = evaluate({ nodes: [tree, leaves], links: [{ id: 'k', from: 't', fromSock: 'children', to: 'l', toSock: 'parent' }], groups: [], settings: {} }, {});
  const count = (id) => { const L = r.lines; const s = new Set(); for (let k = 0; k < L.owner.length; k += 2) if (L.nodeIds[L.owner[k]] === id) s.add(L.lineId[k]); return s.size; };
  assert.ok(count('t') > 10, `branches: ${count('t')}`);
  assert.ok(count('l') > 50, `leaves: ${count('l')}`);
});

test('LODs thin the plant: fewer triangles each level, still the same plant', async () => {
  const { PRESETS, DEFAULT_PRESET } = await import('../src/graph/presets.js');
  const tris = (lod) => evaluate(PRESETS[DEFAULT_PRESET](), { lod }).meshes.reduce((s, m) => s + m.index.length / 3, 0);
  const t = [0, 1, 2, 3].map(tris);
  assert.ok(t[0] > t[1] && t[1] > t[2] && t[2] > t[3], t.join(' > '));
  assert.ok(t[3] > t[0] * 0.03, 'something is left');
});

test('growth cuts and leaves on young wood', () => {
  const nodes = simulateGrowth({ growYears: 12, cutTop: 300, cutSpread: 150, cutClear: 120 }, 2, [0, 0, 0], [0, 1, 0]).filter((n) => n.alive);
  assert.ok(nodes.every((n) => n.p[1] <= 300 + 1e-6), 'nothing above Max height');
  assert.ok(nodes.every((n) => Math.hypot(n.p[0], n.p[2]) <= 150 + 1e-6), 'nothing beyond Max spread');
  assert.ok(nodes.filter((n) => n.order > 0).every((n) => n.p[1] >= 120 - 1e-6), 'no side branches below Clear trunk');
  const leafCount = (leafYears) => {
    const tree = { id: 't', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), growOn: true, growYears: 10, leafYears } };
    const leaves = { id: 'l', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), place: 'spline', start: 0, density: 20, length: 8, meshType: 'leaf' } };
    const L = evaluate({ nodes: [tree, leaves], links: [{ id: 'k', from: 't', fromSock: 'children', to: 'l', toSock: 'parent' }], groups: [], settings: {} }, {}).lines;
    const s = new Set(); for (let k = 0; k < L.owner.length; k += 2) if (L.nodeIds[L.owner[k]] === 'l') s.add(L.lineId[k]); return s.size;
  };
  assert.ok(leafCount(2) < leafCount(0), 'fewer leaves when only young wood carries them');
});
