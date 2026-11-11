// Local transforms on the gizmo's axes, absolute segments, caps, trunk flare, side pinch and avoiding intersections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';
import { newMod } from '../src/graph/defs-unified.js';
import { thicken, avoidMesh } from '../src/engine/meshmods.js';

let ids = 0;
const node = (type, params = {}) => ({ id: `t${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const link = (a, b) => ({ id: `l${a.id}${b.id}`, from: a.id, fromSock: 'children', to: b.id, toSock: 'parent' });
const run = (nodes, links = []) => new Evaluator({ nodes, links, groups: [], settings: { seed: 1 } }).run();
const bare = { meshType: 'none', mods: [] };
const linePts = (r) => { const P = r.lines.position; const out = []; for (let i = 0; i < P.length; i += 3) out.push([P[i], P[i + 1], P[i + 2]]); return out; };

test('Position Z is up on the gizmo, in world and in local axes', () => {
  for (const xfSpace of ['world', 'local']) {
    const pts = linePts(run([node('Spline', { ...bare, length: 50, posZ: 100, xfSpace })]));
    assert.ok(Math.min(...pts.map((p) => p[1])) > 99, `${xfSpace}: the line starts 100 up`);
  }
  // World Y runs away from the front view: the engine's -Z.
  const back = linePts(run([node('Spline', { ...bare, length: 50, posY: 100, xfSpace: 'world' })]));
  assert.ok(back.every((p) => p[2] < -99));
});

test('a local move follows the entity: Z along a tilted child, not up', () => {
  const trunk = node('Spline', { ...bare, length: 200 });
  const child = node('Spline', { ...bare, place: 'spline', density: 8, start: 40, end: 60, tipOn: false, tilt: 90, length: 10, posZ: 100, xfSpace: 'local' });
  const r = run([trunk, child], [link(trunk, child)]);
  const kids = linePts(r).filter((p) => Math.hypot(p[0], p[2]) > 1);
  assert.ok(kids.length >= 2 && kids.every((p) => Math.hypot(p[0], p[2]) > 90 && p[1] < 140), 'the children moved out sideways, the way they head, not up');
});

test('absolute segments give every line the same count', () => {
  const r = run([node('Spline', { ...bare, length: 300, segMode: 'absolute', segCount: 7 })]);
  assert.equal(r.lines.position.length / 3, 8 * 2 - 2 || r.lines.position.length / 3);
  const r2 = run([node('Spline', { ...bare, length: 30, segMode: 'absolute', segCount: 7 })]);
  assert.equal(r.lines.position.length, r2.lines.position.length, 'a short line gets as many points as a long one');
});

const tube = (extra) => run([node('Spline', { length: 100, radius: 10, sides: 8, blend: false, mods: [], curves: { radius: { pts: [[0, 1, 's'], [1, 1, 's']] } }, ...extra })]).meshes[0];

test('a bottom cap closes the start; the top dome follows its segments and height', () => {
  const open = tube({ capTop: false, capBottom: false }); const both = tube({ capTop: true, capBottom: true, capEndSegs: 5, capStartSegs: 5 });
  assert.equal(both.position.length / 3 - open.position.length / 3, 10 * 9, 'five rings each end');
  const rim = tube({ capTop: true, capEndSegs: 5, capEndBorder: 0.2 });
  assert.equal(rim.position.length / 3 - open.position.length / 3, 6 * 9, 'the border adds one ring');
  const flat = tube({ capTop: true, capEndProfile: { pts: [[0, 0, 's'], [1, 0, 's']] } });
  let hi = -Infinity; for (let i = 1; i < flat.position.length; i += 3) hi = Math.max(hi, flat.position[i]);
  assert.ok(hi < 100.01, 'a flat profile makes a flat cap');
  const tall = tube({ capTop: true, capEndHeight: 3 });
  let top = -Infinity; for (let i = 1; i < tall.position.length; i += 3) top = Math.max(top, tall.position[i]);
  assert.ok(top > 100 + 10 * 2.5, `a tall dome rises three tip radii (got ${top.toFixed(1)})`);
});

test('trunk flare widens the base into the floor with roots', () => {
  const widthAt = (m, y0) => { let w = 0; for (let i = 0; i < m.position.length; i += 3) if (Math.abs(m.position[i + 1] - y0) < 0.5) w = Math.max(w, Math.hypot(m.position[i], m.position[i + 2])); return w; };
  const plain = tube({ capTop: false }); const flared = tube({ capTop: false, blend: true, blendLength: 3, blendFlare: 1.5, blendRoots: 4, blendOffset: 0 });
  assert.ok(widthAt(flared, 0) > widthAt(plain, 0) * 2, 'the base spreads');
  assert.ok(Math.abs(widthAt(flared, 60) - widthAt(plain, 60)) < 0.5, 'higher up it is the same trunk');
});

// A card 40 wide (x) and 80 long (y), 5 points across and 9 along.
function card() {
  const P = []; const N = []; const W = []; const I = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 5; x++) { P.push(x * 10, y * 10, 0); N.push(0, 0, 1); W.push(0, y / 8, 0); }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const a = y * 5 + x; I.push(a, a + 1, a + 6, a, a + 6, a + 5); }
  return { position: Float32Array.from(P), normal: Float32Array.from(N), wind: Float32Array.from(W), index: Uint32Array.from(I), kind: 'leaf' };
}

test('side pinch thins only the side columns; the middle and the tip keep full thickness', () => {
  const m = card(); const nv = 45;
  thicken(m, { amount: 0.2, pinch: 0, measure: 'sides', sidePinch: 1, sideWidth: 0.5 });
  const gap = (v) => m.position[v * 3 + 2] - m.position[(nv + v) * 3 + 2];
  assert.ok(gap(4 * 5 + 0) < 1e-6, 'a side point comes to an edge');
  assert.ok(gap(4 * 5 + 2) > 1, 'the middle column is thick');
  assert.ok(Math.abs(gap(8 * 5 + 2) - gap(4 * 5 + 2)) < 1e-6, 'the tip row in the middle keeps the same thickness');
  const lop = card();
  thicken(lop, { amount: 0.2, pinch: 0, measure: 'sides', sidePinch: 0, upper: { pts: [[0, 1, 's'], [1, 1, 's']] }, lower: { pts: [[0, 0, 's'], [1, 0, 's']] } });
  assert.ok(Math.abs(lop.position[(nv + 22) * 3 + 2]) < 1e-6, 'a zero lower profile leaves the back flat');
});

test('avoid prunes one of two touching pieces and pushes a close one away', () => {
  const two = () => {
    const a = card(); const P = [...a.position, ...a.position.map((v, i) => (i % 3 === 2 ? v + 1 : v))];
    const W = [...a.wind, ...a.wind.map((v, i) => (i % 3 === 0 ? 1 : v))];
    return { position: Float32Array.from(P), normal: Float32Array.from([...a.normal, ...a.normal]), wind: Float32Array.from(W), index: Uint32Array.from([...a.index, ...a.index.map((x) => x + 45)]) };
  };
  const m = two();
  assert.equal(avoidMesh(m, [m], { mode: 'prune', with: 'same node', clearance: 2, baseSkip: 0 }), 1);
  assert.equal(m.index.length, card().index.length);
  const p = two();
  avoidMesh(p, [p], { mode: 'push', with: 'same node', clearance: 2, falloff: 0, amount: 3, baseSkip: 0 });
  assert.ok(p.position[(45 + 22) * 3 + 2] - p.position[22 * 3 + 2] > 6, 'the two sheets moved apart');
});

test('the Avoid spline modifier trims a line that runs into an earlier one', () => {
  const wall = node('Spline', { ...bare, length: 200, place: 'line', lineDir: [0, 0, 1], count: 20, lineLen: 200, posX: 60, xfSpace: 'world' });
  const reach = (mode) => node('Spline', { ...bare, length: 200, rotY: 90, xfSpace: 'world', posZ: 100, mods: [newMod('a', 'Dir_Avoid', { ...defaultParams('Dir_Avoid'), mode, clearance: 6, baseSkip: 0 })] });
  const far = (r) => Math.max(...linePts(r).filter((p) => Math.abs(p[1] - 100) < 1 && Math.abs(p[0] - 60) > 0.01).map((p) => p[0]));
  const free = run([wall, node('Spline', { ...bare, length: 200, rotY: 90, xfSpace: 'world', posZ: 100 })]);
  const trimmed = run([wall, reach('trim')]);
  assert.ok(far(free) > 150, 'without it the line runs through');
  assert.ok(far(trimmed) < 60, `with it the line stops at the wall (got ${far(trimmed).toFixed(1)})`);
});

test('a Spline can carry a tube and leaves on the same line, the tube with its own material', () => {
  const g = { nodes: [node('Spline', { length: 100, mods: [], meshType: 'tube+leaf', blend: false })], links: [], groups: [], settings: { seed: 1 } };
  const r = new Evaluator(g).run();
  assert.equal(r.meshes.length, 2, 'a tube and a leaf mesh');
});

test('leaf blend snaps the base of a leaf onto its parent branch', () => {
  const twig = node('Spline', { length: 200, radius: 10, mods: [], blend: false, curves: { radius: { pts: [[0, 1, 's'], [1, 1, 's']] } } });
  const leaf = (leafBlend) => node('Spline', { place: 'spline', density: 8, start: 40, end: 60, tipOn: false, tilt: 90, length: 40, mods: [], meshType: 'leaf', width: 8, leafBlend, leafBlendHeight: 2 });
  const minR = (on) => {
    const kid = leaf(on); const r = run([twig, kid], [link(twig, kid)]);
    const m = r.meshes.find((x) => x.nodeId === kid.id);
    let lo = Infinity; for (let i = 0; i < m.position.length; i += 3) lo = Math.min(lo, Math.hypot(m.position[i], m.position[i + 2]));
    return lo;
  };
  assert.ok(minR(false) < 9, 'without it the base sits inside the branch');
  assert.ok(Math.abs(minR(true) - 9.5) < 1.5, `with it the base sits on the bark (got ${minR(true).toFixed(2)})`);
});

test('a Spline with drawn strokes grows them where they were drawn, on a parent too', () => {
  const stroke = { pts: [[50, 0, 0], [50, 40, 0], [80, 80, 0]] };
  const r = run([node('Spline', { ...bare, strokes: [stroke] })]);
  const pts = linePts(r);
  assert.ok(pts.some((p) => Math.abs(p[0] - 80) < 1 && Math.abs(p[1] - 80) < 1), 'the line ends where the stroke ended');
  const trunk = node('Spline', { ...bare, length: 200 });
  const kid = node('Spline', { ...bare, strokes: [{ pts: [[0, 100, 0], [30, 130, 0]], parent: 0, t: 0.5 }] });
  const r2 = run([trunk, kid], [link(trunk, kid)]);
  assert.ok(linePts(r2).some((p) => Math.abs(p[0] - 30) < 1 && Math.abs(p[1] - 130) < 1), 'a drawn child starts on its parent');
});

test('a child can grow from two parents at once', () => {
  const a = node('Spline', { ...bare, length: 100 });
  const b = node('Spline', { ...bare, length: 100, posX: 300, xfSpace: 'world' });
  const kid = node('Spline', { ...bare, length: 20, tilt: 90 });
  const r = run([a, b, kid], [link(a, kid), link(b, kid)]);
  const xs = linePts(r).filter((p) => p[1] > 99).map((p) => p[0]);
  assert.ok(xs.some((x) => x < 50) && xs.some((x) => x > 250), 'children on both');
});
