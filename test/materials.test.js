// Files from before shared materials: looks become materials, equal looks share one, transforms split per axis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateGraph, materialOf } from '../src/graph/materials.js';

test('legacy looks become shared materials and transforms split per axis', () => {
  const g = migrateGraph({ nodes: [
    { id: 'a', type: 'Spline', name: 'Leaves', params: { meshType: 'cutout', atlas: 'atlas:green', color: '#123456', origin: [1, 2, 3] } },
    { id: 'b', type: 'Spline', name: 'More', params: { meshType: 'cutout', atlas: 'atlas:green', color: '#123456' } },
    { id: 'c', type: 'Mesh', name: 'Fruit', params: { rot: [10, 20, 30], vary: { scl: 15 } } },
  ] });
  const [a, b, c] = g.nodes;
  assert.equal(g.materials.length, 1, 'two equal looks share one material; a node with no look gets none');
  assert.equal(a.params.material, b.params.material);
  assert.equal(materialOf(g, a).texture, 'atlas:green');
  assert.ok(!('atlas' in a.params) && !('color' in a.params));
  // Old Y-up world values move to the gizmo's axes (Z up) and stay in world space.
  assert.deepEqual([a.params.posX, a.params.posY, a.params.posZ], [1, -3, 2]);
  assert.deepEqual([c.params.rotX, c.params.rotY, c.params.rotZ], [10, -30, 20]);
  assert.equal(c.params.xfSpace, 'world');
  assert.equal(c.params.vary.sclU, 15);
  assert.equal(c.params.material, null);
  // Running it again changes nothing.
  assert.deepEqual(migrateGraph(structuredClone(g)), g);
});
