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

test('growth is balanced: no side is favoured, and Lean is what makes it lean', () => {
  const com = (P, seeds) => {
    let sx = 0; let sz = 0; let w = 0;
    for (const s of seeds) {
      const n = alive(simulateGrowth({ growYears: 12, ...P }, s, [0, 0, 0], [0, 1, 0]));
      sx += n.reduce((a, x) => a + x.p[0], 0) / n.length; sz += n.reduce((a, x) => a + x.p[2], 0) / n.length;
      w += Math.max(...n.map((x) => Math.hypot(x.p[0], x.p[2])));
    }
    return { off: Math.hypot(sx, sz) / w, x: sx / seeds.length };
  };
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const P of [{}, GROWTH_PRESETS.Oak, { phyllotaxis: 180 }]) assert.ok(com(P, seeds).off < 0.1, `centre of mass near the trunk: ${com(P, seeds).off}`);
  assert.ok(com({ lean: 0.5, leanDir: 0 }, seeds.slice(0, 3)).x > 30, 'Lean pushes it toward +X');
});

test('broadleaf presets are round or spreading, the pine is a cone', () => {
  const ratio = (P) => { const n = alive(simulateGrowth(P, 1, [0, 0, 0], [0, 1, 0])); const h = Math.max(...n.map((x) => x.p[1])); const xs = n.map((x) => x.p[0]); return (Math.max(...xs) - Math.min(...xs)) / h; };
  for (const k of ['Birch', 'Oak', 'Maple', 'Willow']) assert.ok(ratio(GROWTH_PRESETS[k]) > 1, `${k} crown is wide: ${ratio(GROWTH_PRESETS[k])}`);
  assert.ok(ratio(GROWTH_PRESETS.Pine) < 1, `pine is narrow: ${ratio(GROWTH_PRESETS.Pine)}`);
});

test('a mesh in the way: the tree grows around it and never through it', async () => {
  const { makeShape } = await import('../src/engine/shapes.js');
  const box = makeShape({ shape: 'box', size: [150, 20, 150], pos: [0, 400, 0] });
  const n = alive(simulateGrowth({ growYears: 14 }, 1, [0, 0, 0], [0, 1, 0], [box]));
  assert.ok(n.every((x) => !box.inside(x.p)), 'nothing inside the mesh');
  assert.ok(n.some((x) => x.p[1] > 450), 'it still gets past it');
});

test('a Growth node grows the tree, an old Spline with Growth on opens as one and grows the same', async () => {
  const { migrateGraph } = await import('../src/graph/materials.js');
  const leaves = () => ({ id: 'l', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), place: 'spline', density: 20, length: 8, meshType: 'leaf' } });
  const graph = (tree) => ({ nodes: [tree, leaves()], links: [{ id: 'k', from: 't', fromSock: 'children', to: 'l', toSock: 'parent' }], groups: [], settings: {} });
  const old = graph({ id: 't', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), ...GROWTH_PRESETS.Oak, growOn: true, growYears: 8 } });
  const before = evaluate(structuredClone(old), {}).lines.owner.length;
  const migrated = migrateGraph(structuredClone(old));
  assert.equal(migrated.nodes[0].type, 'Growth');
  assert.equal(evaluate(migrated, {}).lines.owner.length, before, 'same tree and leaves');
  const fresh = graph({ id: 't', type: 'Growth', x: 0, y: 0, on: true, params: { ...defaultParams('Growth'), ...GROWTH_PRESETS.Oak, growYears: 8 } });
  assert.ok(evaluate(fresh, {}).lines.owner.length > 400);
});

test('snow only in winter; leaves a little fallen in summer; age sets the years grown', async () => {
  const { snowAt, lifeOf } = await import('../src/engine/life.js');
  const { yearsAtAge } = await import('../src/engine/growth.js');
  const life = (season) => ({ on: true, snow: 1, season });
  for (const s of [0.05, 0.25, 0.5, 0.62]) assert.equal(snowAt(life(s)), 0, `no snow at ${s}`);
  assert.ok(snowAt(life(0.85)) > 0.9, 'snow in winter');
  assert.equal(snowAt({ on: false, snow: 1, season: 0.85 }), 0);
  const L = lifeOf({ life: { on: true } });
  assert.ok(L.dropAt(0.25) > 0 && L.dropAt(0.25) < 0.15, 'a few leaves fallen in summer');
  assert.ok(L.dropAt(0.85) > 0.95, 'bare in winter');
  assert.equal(yearsAtAge({ growYears: 20 }, lifeOf({ life: { on: true, age: 0.5 } })), 10);
  assert.equal(yearsAtAge({ growYears: 20 }, null), 20);
});
