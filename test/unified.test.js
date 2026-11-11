// The all-in-one Spline and Mesh nodes: what each tab's settings do to the built plant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { expandGraph } from '../src/engine/expand.js';
import { bakeShape } from '../src/engine/primitive.js';
import { defaultParams, kindFits, NODE_TYPES } from '../src/graph/schema.js';
import { cutoutsFromImage } from '../src/leaf/cutout.js';
import { sproutFromPixels } from '../src/app/sprout.js';

let ids = 0;
const node = (type, params = {}) => ({ id: `t${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const graph = (nodes, links = []) => ({ nodes, links: links.map(([a, b], i) => ({ id: `l${i}`, from: a.id, fromSock: a.type === 'GroundPatch' ? 'out' : 'children', to: b.id, toSock: 'parent' })), groups: [], settings: { seed: 1 } });
const build = (g) => new Evaluator(g).run();
const bark = (r) => r.meshes.find((m) => m.kind === 'bark');
const yRange = (m) => {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 1; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
  return [lo, hi];
};

test('a plain Spline builds a straight tube at full length, owned by the node people see', () => {
  const s = node('Spline', { length: 200 });
  const r = build(graph([s]));
  assert.equal(bark(r).nodeId, s.id);
  assert.equal(r.stats.lines, 1);
  const [lo, hi] = yRange(bark(r));
  assert.ok(lo < 1 && Math.abs(hi - 200) < 15, `height ${lo}..${hi}`);
  assert.ok(r.boxes[s.id], 'selecting the node must find its box');
});

test('every Spline part keeps the owner prefix, so nothing leaks past the node', () => {
  const g = expandGraph(graph([node('Spline')]));
  assert.ok(g.nodes.every((n) => n.id.includes('#')));
  assert.ok(g.nodes.some((n) => n.type === 'Placement') && g.nodes.some((n) => n.type === 'CylinderMesh'));
});

test('modifiers do nothing at strength 0, bend the line when raised, and obey their tick box', () => {
  const stack = (strength, on = true) => [{ id: 'g', type: 'Dir_Vector', on, open: false, params: { vector: [1, 0, 0], strength } }];
  const tipX = (g) => { const m = bark(build(g)); let far = 0; for (let i = 0; i < m.position.length; i += 3) far = Math.max(far, Math.abs(m.position[i])); return far; };
  const straight = tipX(graph([node('Spline', { length: 300, mods: stack(0) })]));
  const bent = tipX(graph([node('Spline', { length: 300, mods: stack(1) })]));
  const off = tipX(graph([node('Spline', { length: 300, mods: stack(1, false) })]));
  assert.ok(bent > straight + 30, `${bent} vs ${straight}`);
  assert.equal(off, straight);
});

test('placement modes make the asked count, spread out as each mode says', () => {
  const spreads = {};
  for (const place of ['point', 'line', 'ring', 'sprout']) {
    const s = node('Spline', { place, count: 12, length: 30 });
    const r = build(graph([s]));
    assert.equal(r.stats.lines, 12, place);
    const m = bark(r);
    let x0 = Infinity; let x1 = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) { x0 = Math.min(x0, m.position[i]); x1 = Math.max(x1, m.position[i]); }
    spreads[place] = x1 - x0;
  }
  assert.ok(spreads.line > 150 && spreads.ring > 150, JSON.stringify(spreads));
});

test('a child with Spline placement grows along its parent, and from the tip when asked', () => {
  const trunk = node('Spline', { length: 300 });
  const twig = node('Spline', { place: 'spline', density: 4, length: 30, tipOn: false });
  const plain = build(graph([trunk, twig], [[trunk, twig]])).stats.lines;
  twig.params.tipOn = true; twig.params.tipCount = 3;
  const crowned = build(graph([trunk, twig], [[trunk, twig]])).stats.lines;
  assert.ok(plain > 2);
  assert.equal(crowned, plain + 3);
});

test('a Spline on a Mesh parent grows from its surface', () => {
  const ball = node('Mesh', { shape: 'sphere', radius: 50 });
  const hair = node('Spline', { place: 'mesh', count: 30, length: 10, radius: 1 });
  const r = build(graph([ball, hair], [[ball, hair]]));
  assert.ok(r.stats.lines >= 30);
  const { position: P, owner, nodeIds } = r.lines;
  let checked = 0;
  // Every line starts on the sphere, within a few percent of its radius.
  for (let i = 0; i < owner.length; i += 2) {
    if (nodeIds[owner[i]] !== hair.id || (i && r.lines.lineId[i] === r.lines.lineId[i - 2])) continue;
    const d = Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    assert.ok(d > 44 && d < 56, `start ${d} from the center`);
    checked++;
  }
  assert.ok(checked >= 30);
});

test('variation spreads a value per line and a curve shapes it along the length', () => {
  const lengths = (s) => {
    const { position: P, lineId, owner, nodeIds } = build(graph([s])).lines;
    const top = new Map();
    for (let i = 0; i < owner.length; i++) if (nodeIds[owner[i]] === s.id) top.set(lineId[i], Math.max(top.get(lineId[i]) ?? 0, P[i * 3 + 1]));
    return [...top.values()];
  };
  const same = lengths(node('Spline', { count: 8, length: 100 }));
  const varied = lengths(node('Spline', { count: 8, length: 100, vary: { length: 50 } }));
  assert.ok(Math.max(...same) - Math.min(...same) < 1);
  assert.ok(Math.max(...varied) - Math.min(...varied) > 10);
  assert.ok(Math.max(...varied) <= 151 && Math.min(...varied) >= 49, 'stays within plus and minus 50%');

  const thick = (curves) => { const m = bark(build(graph([node('Spline', { radius: 10, length: 100, curves, capEnd: 'none' })]))); let r = 0; for (let i = 0; i < m.position.length; i += 3) if (m.position[i + 1] > 90) r = Math.max(r, Math.hypot(m.position[i], m.position[i + 2])); return r; };
  assert.ok(thick({ radius: { pts: [[0, 1, 's'], [1, 1, 's']] } }) > thick({ radius: { pts: [[0, 1, 's'], [1, 0.1, 's']] } }) * 2);
});

test('an offset of 0 can still vary, since a share of 0 would do nothing', () => {
  const uv = (vary) => bark(build(graph([node('Spline', { count: 6, length: 50, offsetU: 0, vary })]))).uv.slice(0, 200).join();
  assert.notEqual(uv({ offsetU: 80 }), uv({}));
});

test('primitives are closed, face outward and react to their modifiers', () => {
  const outward = (o) => {
    let agree = 0; let total = 0;
    for (let i = 0; i < o.idx.length; i += 3) {
      const [a, b, c] = [o.idx[i], o.idx[i + 1], o.idx[i + 2]];
      const v = (k, j) => o.v[k * 3 + j];
      const ux = v(b, 0) - v(a, 0); const uy = v(b, 1) - v(a, 1); const uz = v(b, 2) - v(a, 2);
      const wx = v(c, 0) - v(a, 0); const wy = v(c, 1) - v(a, 1); const wz = v(c, 2) - v(a, 2);
      const nx = uy * wz - uz * wy; const ny = uz * wx - ux * wz; const nz = ux * wy - uy * wx;
      const mx = v(a, 0) + v(b, 0) + v(c, 0); const my = v(a, 1) + v(b, 1) + v(c, 1); const mz = v(a, 2) + v(b, 2) + v(c, 2);
      if (Math.hypot(nx, ny, nz) < 1e-9) continue;
      total++;
      if (nx * mx + ny * my + nz * mz >= 0) agree++;
    }
    return agree / total;
  };
  for (const shape of ['sphere', 'rectangle']) {
    const o = bakeShape({ ...defaultParams('Mesh'), shape });
    assert.ok(o.v.length > 0 && o.idx.length > 0, shape);
    assert.ok(outward(o) > 0.98, `${shape} faces inward: ${outward(o)}`);
  }
  const p = defaultParams('Mesh');
  const plain = bakeShape({ ...p, shape: 'sphere' }).v.join();
  const twist = (on) => [...p.mods, { id: 't', type: 'twist', on, params: { angle: 90 } }];
  const twistOff = bakeShape({ ...p, shape: 'sphere', mods: twist(false) }).v.join();
  assert.equal(twistOff, plain, 'a modifier with its tick off changes nothing');
  const twistOn = bakeShape({ ...p, shape: 'sphere', mods: twist(true) }).v.join();
  assert.notEqual(twistOn, plain);
});

test('mesh modifiers move the surface only when on', () => {
  const mods = (on) => [{ id: 'i', type: 'inflate', on, open: false, params: { amount: 5 } }];
  const peak = (s) => { let r = 0; const m = bark(build(graph([s]))); for (let i = 0; i < m.position.length; i += 3) if (m.position[i + 1] > 20 && m.position[i + 1] < 40) r = Math.max(r, Math.hypot(m.position[i], m.position[i + 2])); return r; };
  const base = node('Spline', { length: 100, radius: 10, curves: {}, meshMods: mods(false) });
  const fat = node('Spline', { length: 100, radius: 10, curves: {}, meshMods: mods(true) });
  assert.ok(peak(fat) > peak(base) + 4);
});

test('parent connectors take a Spline, a Mesh or an object', () => {
  const inSock = NODE_TYPES.Spline.in[0];
  for (const kind of ['parent', 'object']) assert.ok(kindFits(kind, inSock), kind);
  assert.ok(!kindFits('curve', inSock));
});

// A white blob on a clear image, so the fitter finds exactly one leaf.
const leafImage = () => {
  const w = 128; const h = 128; const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - 64) / 22) ** 2 + ((y - 64) / 54) ** 2 < 1) data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
};

test('sprout points grow children where they were placed, on the correct side', () => {
  const [cut] = cutoutsFromImage(leafImage(), { rowsMax: 7 });
  const mid = [(cut.basePx[0] + cut.tipPx[0]) / 2, (cut.basePx[1] + cut.tipPx[1]) / 2];
  const sprout = sproutFromPixels(cut, mid, [cut.tipPx[0] - cut.basePx[0], cut.tipPx[1] - cut.basePx[1]]);
  assert.ok(Math.abs(sprout.t - 0.5) < 0.2, `t ${sprout.t}`);
  assert.ok(Math.abs(sprout.s) < 0.02, `s ${sprout.s}`);
  assert.ok(sprout.da > 0.99, 'aimed along the leaf');

  const leaf = node('Spline', { length: 40, meshType: 'cutout', cutouts: [{ ...cut, sprouts: [sprout] }], texture: null });
  const child = node('Spline', { place: 'sprouts', length: 10 });
  const r = build(graph([leaf, child], [[leaf, child]]));
  assert.equal(r.stats.lines, 2, 'one line for the leaf, one for its one sprout');
  assert.deepEqual([...r.warnings], []);
});
