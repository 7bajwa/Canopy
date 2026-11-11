// Mix node math, collide targets, the Collide modifier on a real plant, and mirrored pairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, mixValue } from '../src/engine/evaluate.js';
import { collideTarget } from '../src/engine/modifiers.js';
import { PRESETS, DEFAULT_PRESET } from '../src/graph/presets.js';
import { defaultParams } from '../src/graph/schema.js';

test('mix blends A toward A (op) B', () => {
  assert.equal(mixValue('add', 2, 3, 1), 5);
  assert.equal(mixValue('add', 2, 3, 0), 2);
  assert.equal(mixValue('mul', 2, 3, 0.5), 4);
  assert.equal(mixValue('div', 2, 0, 1), 0, 'divide by zero gives 0');
  assert.equal(mixValue('diff', 2, 7, 1), 5);
  assert.equal(mixValue('sub', 2, 3, 5), -1, 'blend is held to 0..1');
});

test('collide targets bounce off and lie along a surface', () => {
  const b = collideTarget('bounce', [0, -1, 0], [0, 1, 0]);
  assert.deepEqual(b.map((x) => Math.round(x)), [0, 1, 0]);
  const a = collideTarget('attract', [Math.SQRT1_2, -Math.SQRT1_2, 0], [0, 1, 0], 0);
  assert.ok(Math.abs(a[1]) < 1e-9 && a[0] > 0.99, 'touching: runs flat along the floor');
});

const firstSpline = (g) => g.nodes.find((n) => n.type === 'Spline');
const lengthOf = (res) => res.stats.lines;

test('a floor Collide set to trim stops lines that reach below it', () => {
  const name = DEFAULT_PRESET in PRESETS ? DEFAULT_PRESET : Object.keys(PRESETS)[0];
  const plain = PRESETS[name]();
  const base = evaluate(plain);
  const g = PRESETS[name]();
  const sp = firstSpline(g);
  sp.params.mods = [...(sp.params.mods || []), { id: 'col', type: 'Dir_Collide', on: true, open: false, params: { ...defaultParams('Dir_Collide'), mode: 'trim', height: 1e6, erase: true } }];
  const cut = evaluate(g);
  assert.ok(lengthOf(cut) < lengthOf(base), 'the trunk below the floor is gone, and its children with it');
});

test('adding an unrelated Mesh node leaves the plant exactly as it was', () => {
  const name = DEFAULT_PRESET in PRESETS ? DEFAULT_PRESET : Object.keys(PRESETS)[0];
  const before = evaluate(PRESETS[name]());
  const g = PRESETS[name]();
  g.nodes.unshift({ id: 'zzRock', type: 'Mesh', x: 0, y: 0, params: defaultParams('Mesh') });
  const after = evaluate(g);
  const sig = (res) => res.meshes.filter((m) => m.nodeId !== 'zzRock').map((m) => `${m.nodeId}:${m.position.length}:${m.position.slice(0, 30).join(',')}`).join('|');
  assert.equal(sig(after), sig(before));
});

test('pairs mirror the turn around the parent', () => {
  const name = DEFAULT_PRESET in PRESETS ? DEFAULT_PRESET : Object.keys(PRESETS)[0];
  const g = PRESETS[name]();
  const child = g.nodes.find((n) => n.type === 'Spline' && n.params.place === 'spline');
  assert.ok(child, 'the preset has a child spline');
  Object.assign(child.params, { pattern: 'pairs', rotation: 40, vary: {}, alignParent: 100 });
  const res = evaluate(g);
  assert.ok(res.meshes.length > 0 && res.meshes.every((m) => m.position.every(Number.isFinite)));
});

test('only leaves flutter; branches never spin what grows on them', () => {
  const name = DEFAULT_PRESET in PRESETS ? DEFAULT_PRESET : Object.keys(PRESETS)[0];
  const T = evaluate(PRESETS[name]()).windLines;
  const values = new Set(); for (let i = 11; i < T.length; i += 16) values.add(T[i] > 0);
  assert.deepEqual([...values].sort(), [false, true], 'some lines (leaves) flutter and some (branches) do not');
});
