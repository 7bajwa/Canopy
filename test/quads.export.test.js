// Quad pairs join back into quads for export; cutout triangles and cap tips stay triangles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { facesOf } from '../src/app/quads.js';

test('two triangles of a quad join, keeping their winding; unmarked ones do not', () => {
  // A unit square a(0) b(1) c(2) d(3), as a tube writes it: (a, c, b), (c, d, b).
  const P = [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0];
  const f = facesOf([0, 2, 1, 2, 3, 1], [1, 1], P);
  assert.deepEqual(f.sizes, [4]);
  assert.deepEqual(f.corners, [2, 3, 1, 0]);
  assert.deepEqual(facesOf([0, 2, 1, 2, 3, 1], null, P).sizes, [3, 3]);
});

test('a quad with two corners in one place is a triangle', () => {
  const P = [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, 1, 0];
  const f = facesOf([0, 1, 2, 1, 3, 2], [1, 1], P);
  assert.deepEqual(f.sizes, [3]);
});
