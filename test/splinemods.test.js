// Spline modifiers: Curl, Zigzag angle, Hard bend smoothness, Trim keeping its thickness, strong Droop, Warp in Z, Avoid push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';
import { newMod } from '../src/graph/defs-unified.js';
import { migrateGraph } from '../src/graph/materials.js';

let ids = 0;
const node = (type, params = {}) => ({ id: `s${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const mod = (type, params = {}) => newMod(`m${++ids}`, type, { ...defaultParams(type), ...params });
const evalOf = (nodes, links = []) => { const ev = new Evaluator({ nodes, links, groups: [], settings: { seed: 1 } }); const r = ev.run(); return { ev, r }; };
const lineOf = (sp, extra = []) => evalOf([sp, ...extra]).ev.lines.find((l) => l.node.id === `${sp.id}#path`);
const pt = (l, i) => [l.pts[i * 3], l.pts[i * 3 + 1], l.pts[i * 3 + 2]];
const last = (l) => pt(l, l.n - 1);
const bare = { meshType: 'none', length: 200, steps: 5 };

test('Curl turns the line round on itself, tighter toward the tip', () => {
  const l = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Curl', { turns: 1, tighten: 0 })] }));
  const e = last(l);
  assert.ok(Math.hypot(e[0], e[1], e[2]) < 10, `one full turn brings the tip back near the base (got ${e.map((v) => v.toFixed(1))})`);
  const tight = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Curl', { turns: 0.5, tighten: 90 })] }));
  const mid = pt(tight, Math.floor(tight.n / 2));
  // Tightened, the first half stays straighter: its middle is still high up.
  assert.ok(mid[1] > 80, `tightening keeps the base straighter (mid at ${mid[1].toFixed(1)})`);
  const world = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Curl', { turns: 0.25, tighten: 0, axis: 'x', space: 'world' })] }));
  assert.ok(Math.abs(last(world)[0]) < 1e-3, 'around world X it stays in the plane across X');
});

test('Zigzag steps leave the line at the set angle, on the chosen axis', () => {
  for (const angle of [15, 40]) {
    const l = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Zigzag', { angle, steps: 20 })] }));
    const a = pt(l, 2); const b = pt(l, 3);
    const lateral = Math.hypot(b[0] - a[0], b[2] - a[2]); const up = b[1] - a[1];
    const got = Math.atan2(lateral, up) * 180 / Math.PI;
    assert.ok(Math.abs(got - angle) < 1.5, `angle ${angle}: got ${got.toFixed(1)}`);
  }
  const x = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Zigzag', { angle: 30, axis: 'x' })] }));
  const y = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Zigzag', { angle: 30, axis: 'y' })] }));
  const side = (l) => [Math.abs(pt(l, 1)[0]), Math.abs(pt(l, 1)[2])];
  assert.notDeepEqual(side(x).map((v) => v > 1), side(y).map((v) => v > 1), 'the two axes zigzag to different sides');
});

test('an old Zigzag with a Radius opens with the matching angle', () => {
  const g = migrateGraph({ nodes: [{ id: 'z', type: 'Spline', params: { mods: [{ id: 'a', type: 'Dir_Zigzag', params: { radius: 5, steps: 20 } }] } }], links: [] });
  assert.ok(Math.abs(g.nodes[0].params.mods[0].params.angle - Math.atan(0.5) * 180 / Math.PI) < 1e-9);
});

test('Hard bend smoothness rounds the corner over its length', () => {
  const kink = (smooth) => {
    const l = lineOf(node('Spline', { ...bare, steps: 2, mods: [mod('Dir_HardBend', { angle: 60, orient: 90, smooth })] }));
    let worst = 0;
    for (let i = 1; i + 1 < l.n; i++) {
      const a = pt(l, i - 1); const b = pt(l, i); const c = pt(l, i + 1);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
      worst = Math.max(worst, Math.acos(Math.min(1, cos)) * 180 / Math.PI);
    }
    const e = last(l); const d = pt(l, l.n - 2);
    return { worst, tipAngle: Math.acos((e[1] - d[1]) / Math.hypot(e[0] - d[0], e[1] - d[1], e[2] - d[2])) * 180 / Math.PI };
  };
  const sharp = kink(0); const round = kink(60);
  assert.ok(sharp.worst > 55, `0 is a sharp corner (got ${sharp.worst.toFixed(1)})`);
  assert.ok(round.worst < 10, `60 cm spreads it (worst step ${round.worst.toFixed(1)})`);
  assert.ok(Math.abs(round.tipAngle - 60) < 1 && Math.abs(sharp.tipAngle - 60) < 1, 'both end up turned by the full angle');
});

test('Trim cuts lines where set and keeps the thickness at the cut; children beyond it go', () => {
  const tube = (mods) => node('Spline', { length: 100, radius: 10, steps: 5, sides: 6, blend: false, capTop: false, mods });
  const sp = tube([mod('Dir_Cut', { at: 50, atChaos: 0, rate: 100 })]);
  const { ev, r } = evalOf([sp]);
  const l = ev.lines.find((x) => x.node.id === `${sp.id}#path`);
  assert.ok(Math.abs(l.length - 50) < 0.5, `cut at half (got ${l.length.toFixed(1)})`);
  const whole = evalOf([tube([])]).ev.lines[0];
  const rHalf = whole.radii[whole.len.findIndex((s) => Math.abs(s - 50) < 1e-3)];
  assert.ok(Math.abs(l.radii[l.n - 1] - rHalf) < rHalf * 0.05, `the cut end is as thick as the line was there (${l.radii[l.n - 1].toFixed(2)} vs ${rHalf.toFixed(2)})`);
  assert.ok(r.meshes.length > 0);
  const none = lineOf(node('Spline', { ...bare, mods: [mod('Dir_Cut', { at: 50, rate: 0 })] }));
  assert.ok(none.length > 199, 'Lines cut 0 leaves them whole');
  // Children: on a whole parent they spread to the top, on a trimmed one they stop at the cut.
  const kidsTop = (mods) => {
    const parent = node('Spline', { ...bare, mods }); const kid = node('Spline', { ...bare, length: 10, place: 'spline', density: 10, start: 0, end: 100, tipOn: true });
    const e = evalOf([parent, kid], [{ id: 'k', from: parent.id, fromSock: 'children', to: kid.id, toSock: 'parent' }]).ev;
    return Math.max(...e.lines.filter((x) => x.node.id === `${kid.id}#path`).map((x) => x.pts[1]));
  };
  assert.ok(kidsTop([]) > 190);
  assert.ok(kidsTop([mod('Dir_Cut', { at: 50, atChaos: 0 })]) < 101, 'no child (or tip) beyond the cut');
});

test('Droop goes past 5 and the tip of a strong one hangs down', () => {
  const tip = (strength) => {
    const l = lineOf(node('Spline', { ...bare, tilt: 90, length: 300, mods: [mod('Dir_Droop', { strength })] }));
    const a = pt(l, l.n - 2); const b = last(l);
    return { y: b[1], down: (a[1] - b[1]) / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) };
  };
  assert.ok(tip(20).y < tip(5).y - 20, 'Strength 20 sags well beyond 5');
  assert.ok(tip(20).down > 0.95, `the tip hangs straight down (got ${tip(20).down.toFixed(2)})`);
});

test('Warp Shape B bends the line in Z, across Shape A', () => {
  const flat = { pts: [[0, 0.5, 's'], [1, 0.5, 's']] };
  const up = { pts: [[0, 0.5, 's'], [1, 0.8, 's']] };
  const onlyB = last(lineOf(node('Spline', { ...bare, mods: [mod('Dir_Spline', { shapeA: flat, shapeB: up })] })));
  const onlyA = last(lineOf(node('Spline', { ...bare, mods: [mod('Dir_Spline', { shapeA: up, shapeB: flat })] })));
  const off = (p) => [p[0], p[2]];
  const dotAB = off(onlyA)[0] * off(onlyB)[0] + off(onlyA)[1] * off(onlyB)[1];
  assert.ok(Math.hypot(...off(onlyB)) > 50, 'Shape B alone bends it');
  assert.ok(Math.abs(dotAB) < 1, 'and across the way Shape A bends it');
});

test('Avoid bend turns a line away from one in its way, in a smooth curve', () => {
  const wall = node('Spline', { ...bare, length: 200, place: 'line', lineDir: [0, 0, 1], count: 20, lineLen: 200, posX: 60, xfSpace: 'world' });
  const reach = (mods) => node('Spline', { ...bare, length: 200, rotY: 90, xfSpace: 'world', posZ: 100, mods });
  const crossed = (sp) => { const l = evalOf([wall, sp]).ev.lines.find((x) => x.node.id === `${sp.id}#path`); return Math.max(...Array.from({ length: l.n }, (_, i) => l.pts[i * 3])); };
  assert.ok(crossed(reach([])) > 150);
  assert.ok(crossed(reach([mod('Dir_Avoid', { mode: 'bend', radius: 4, clearance: 6, baseSkip: 0 })])) < 60, 'it turns back before the wall');
  assert.ok(crossed(reach([mod('Dir_Avoid', { mode: 'bend', with: 'same node', clearance: 6, baseSkip: 0 })])) > 150, 'Against same node ignores the other node');
  // No step turns more than an arc of Bend radius allows.
  const l = evalOf([wall, reach([mod('Dir_Avoid', { mode: 'bend', radius: 25, clearance: 6, baseSkip: 0 })])]).ev.lines.find((x) => x.node.id.endsWith('#path') && x.node.id !== `${wall.id}#path`);
  let worst = 0;
  for (let i = 2; i < l.n; i++) {
    const a = [0, 1, 2].map((k) => l.pts[(i - 1) * 3 + k] - l.pts[(i - 2) * 3 + k]); const b = [0, 1, 2].map((k) => l.pts[i * 3 + k] - l.pts[(i - 1) * 3 + k]);
    const ang = Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1))) / (Math.hypot(...a) || 1);
    worst = Math.max(worst, ang);
  }
  assert.ok(worst <= 1 / 25 + 1e-3, `turns at most 1/radius per cm (got ${worst.toFixed(3)})`);
});

test('Collide follows a mesh copy moved with the gizmo', () => {
  const end = (dy) => {
    const mesh = node('Mesh', { posZ: 100, inst: { 1: { t: [0, dy, 0] } } });
    const sp = node('Spline', { ...bare, length: 400, mods: [mod('Dir_Collide', { target: 'object', mode: 'trim', object: mesh.id })] });
    return lineOf(sp, [mesh]).length;
  };
  assert.ok(end(100) - end(0) > 90, `${end(0)} -> ${end(100)}`);
});

test('Deviation kinks the parent toward each child, more with a wider angle', () => {
  const push = (angle) => {
    const parent = node('Spline', { ...bare, mods: [mod('Dir_Deviation', { angle, spread: 10 })] });
    const kid = node('Spline', { ...bare, length: 30, place: 'spline', density: 5, start: 40, end: 60, tilt: 45 });
    const ev = evalOf([parent, kid], [{ id: 'k', from: parent.id, fromSock: 'children', to: kid.id, toSock: 'parent' }]).ev;
    const pl = ev.lines.find((x) => x.node.id === `${parent.id}#path`);
    const kids = ev.lines.filter((x) => x.node.id === `${kid.id}#path`);
    assert.ok(kids.length > 0);
    // The undeviated parent is the Y axis, so its X/Z at the child's height is how far it moved and which way.
    return Math.min(...kids.map((k) => {
      let i = 0; for (let j = 0; j < pl.n; j++) if (Math.abs(pl.pts[j * 3 + 1] - k.pts[1]) < Math.abs(pl.pts[i * 3 + 1] - k.pts[1])) i = j;
      const d = [k.pts[k.n * 3 - 3] - k.pts[0], 0, k.pts[k.n * 3 - 1] - k.pts[2]];
      return (pl.pts[i * 3] * d[0] + pl.pts[i * 3 + 2] * d[2]) / Math.hypot(d[0], d[2]);
    }));
  };
  assert.ok(Math.abs(push(0)) < 1e-6, 'angle 0 leaves the line alone');
  const small = push(10); const big = push(30);
  assert.ok(small > 0.5, `toward the child (${small.toFixed(2)})`);
  assert.ok(big > small * 1.5, `a wider angle kinks more (${small.toFixed(2)} vs ${big.toFixed(2)})`);
});

test('a modifier works between its Start and End only, and the rest follows on', () => {
  const full = lineOf(node('Spline', { ...bare, steps: 2, mods: [mod('Dir_Radial', { angle: 90, smoothing: 50 })] }));
  const part = lineOf(node('Spline', { ...bare, steps: 2, mods: [mod('Dir_Radial', { angle: 90, smoothing: 50, from: 50, to: 75 })] }));
  const at = (l, s) => { let i = 0; while (i < l.n - 1 && l.len[i] < s) i++; return pt(l, i); };
  const mid = at(part, 98);
  assert.ok(Math.abs(mid[0]) < 1e-3 && Math.abs(mid[2]) < 1e-3, 'before Start it stays straight');
  assert.ok(Math.abs(part.length - 200) < 2, `it keeps its length (got ${part.length.toFixed(1)})`);
  // Past End it goes straight on in the new direction.
  const a = at(part, 160); const b = at(part, 199); const c = at(part, 180);
  const d1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const d2 = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
  const cos = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (Math.hypot(...d1) * Math.hypot(...d2));
  assert.ok(cos > 0.999, 'past End it carries straight on');
  assert.ok(Math.hypot(...last(full).map((v, i) => v - last(part)[i])) > 10, 'and it differs from the whole-line one');
});

test('modifier orientation follows the own frame of each line, so lines round a ring bend alike', () => {
  const sp = node('Spline', { ...bare, place: 'ring', count: 4, ringRadius: 50, mods: [mod('Dir_Radial', { angle: 60, smoothing: 100, orient: 0 })] });
  const ls = evalOf([sp]).ev.lines.filter((l) => l.node.id === `${sp.id}#path`);
  // Each tip's sideways offset, measured against the way out from the ring's middle to its base.
  const outward = ls.map((l) => { const b = pt(l, 0); const e = last(l); const r = Math.hypot(b[0], b[2]); return ((e[0] - b[0]) * b[0] + (e[2] - b[2]) * b[2]) / r; });
  assert.ok(Math.abs(Math.hypot(...last(ls[0]).map((v, i) => v - pt(ls[0], 0)[i])) - 200) > 1, 'it bends');
  assert.ok(Math.max(...outward) - Math.min(...outward) < 0.5, `every line bends the same way round (got ${outward.map((v) => v.toFixed(1))})`);
});
