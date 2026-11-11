// Leaf deformation: every setting changes the shape, even with one width segment, and the arc helper is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';
import { meshCutout } from '../src/leaf/cutout.js';
import { arc } from '../src/engine/leaves.js';

const cut = meshCutout({ name: 'L', basePx: [50, 100], tipPx: [50, 0], outlinePx: [[0, 100], [100, 100], [100, 0], [0, 0]], innerPx: [[50, 50]] }, 200, 200);
const leaf = (p) => {
  const n = { id: 'd1', type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), meshType: 'cutout', length: 40, cutouts: [cut], texture: null, angleAcross: 0, incAcross: 0, softNormals: 0, ...p } };
  return new Evaluator({ nodes: [n], links: [], groups: [], settings: { seed: 1 } }).run().meshes.find((m) => m.kind === 'leaf').position;
};
const diff = (a, b) => a.reduce((s, v, i) => Math.max(s, Math.abs(v - b[i])), 0);

test('arc is a circle and a straight line at zero turn', () => {
  assert.deepEqual(arc(0, 0, 5), [5, 0]);
  const [x, y] = arc(0, Math.PI / 10, 10);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 20 / Math.PI) < 1e-9, 'half a turn ends a diameter up');
});

test('curl, angle, bend and twist all move the leaf', () => {
  const flat = leaf({});
  for (const k of ['incAcross', 'angleAlong', 'incAlong', 'leafTwist']) assert.ok(diff(leaf({ [k]: 30 }), flat) > 1, `${k} does nothing`);
});
