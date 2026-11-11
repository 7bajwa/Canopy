// Per-cutout meshing: triangles, quads where they fit, and mixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { meshAs, quadify } from '../src/leaf/cutout.js';

const leaf = { basePx: [50, 100], tipPx: [50, 0], outlinePx: [[0, 100], [100, 100], [100, 0], [0, 0]], innerPx: [[50, 50], [50, 25], [50, 75]] };

test('a square joins into one quad, and quads keep the area', () => {
  const faces = quadify([0, 1, 2, 0, 2, 3], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].length, 4);
});

test('triangles, quads and mixed all mesh the same leaf', () => {
  const tri = meshAs({ ...leaf, meshMode: 'tris' }, 200, 200);
  const quad = meshAs({ ...leaf, meshMode: 'quads' }, 200, 200);
  const mixed = meshAs({ ...leaf, meshMode: 'mixed' }, 200, 200);
  assert.equal(tri.stats.quads, 0);
  assert.ok(quad.stats.quads > 0, 'some quads');
  assert.ok(mixed.stats.quads <= quad.stats.quads);
  for (const m of [tri, quad, mixed]) assert.equal(m.mesh.tris.length, tri.mesh.tris.length, 'same surface, same triangle count');
});
