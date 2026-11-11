// Growing on a Mesh with several copies, Mesh modifiers on all copies together, and exposed values through Math.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { WIND_STRIDE } from '../src/engine/wind.js';
import { defaultParams } from '../src/graph/schema.js';
import { newMod } from '../src/graph/defs-unified.js';

let ids = 0;
const node = (type, params = {}, extra = {}) => ({ id: `c${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params }, ...extra });
const link = (a, b, fromSock = 'children', toSock = 'parent') => ({ id: `l${a.id}${b.id}${toSock}`, from: a.id, fromSock, to: b.id, toSock });
const build = (nodes, links = []) => new Evaluator({ nodes, links, groups: [], settings: { seed: 1 } }).run();

test('children grow on every copy of a Mesh, not only the first', () => {
  const pots = node('Mesh', { place: 'ring', count: 3, ringRadius: 300, radius: 30 });
  const grass = node('Spline', { place: 'mesh', count: 60, length: 20, meshType: 'none' });
  const T = build([pots, grass], [link(pots, grass)]).windLines;
  const parents = new Set(); const xs = [];
  for (let k = 0; k < T.length; k += WIND_STRIDE) if (T[k + 3] >= 0) { parents.add(T[k + 3]); xs.push(T[k]); }
  assert.equal(parents.size, 3, 'each copy has children');
  assert.ok(Math.max(...xs) - Math.min(...xs) > 400, 'spread around the ring');
});

test('a bend on all copies together differs from a bend on each', () => {
  const row = (space) => {
    const box = node('Mesh', { place: 'line', count: 4, lineLen: 300, shape: 'rectangle', size: [20, 100, 20], mods: [newMod('b', 'bend', { angle: 60, direction: 0, space })] });
    return build([box]).meshes[0].position;
  };
  const each = row('each copy'); const all = row('all together');
  let d = 0;
  for (let i = 0; i < each.length; i++) d = Math.max(d, Math.abs(each[i] - all[i]));
  assert.ok(d > 5);
});

test('an exposed value passes through a Math mix into another node', () => {
  const a = node('Spline', { length: 100 }, { exposed: ['length'] });
  const mix = node('Math', { op: 'mix', a: 0, b: 0, t: 0.5 });
  const b = node('Spline', { length: 10, posX: 500 }, { exposed: ['length'] });
  const tip = (r) => { const P = r.lines.position; let hi = -Infinity; for (let i = 0; i < P.length; i += 3) if (P[i] > 400) hi = Math.max(hi, P[i + 1]); return hi; };
  const r = build([a, mix, b], [link(a, mix, 'o:length', 'p:a'), link(mix, b, 'value', 'p:length')]);
  assert.ok(Math.abs(tip(r) - 50) < 1, `got ${tip(r)}`);
});
