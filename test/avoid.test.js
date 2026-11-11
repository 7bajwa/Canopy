import test from 'node:test';
import assert from 'node:assert/strict';
import { avoidMesh } from '../src/engine/meshmods.js';

// Two big flat quads 1 cm apart, each a single pair of triangles: corners are far from each other, so only surface
// sampling notices that the middles touch.
const quad = (y, x0) => ({
  position: new Float32Array([x0, y, 0, x0 + 40, y, 0, x0 + 40, y, 40, x0, y, 40]),
  normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  index: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

test('mesh avoid sees across big triangles and pushes out to the clearance', () => {
  const a = quad(0, 0); const b = quad(1, 20);
  const moved = avoidMesh(b, [a, b], { mode: 'push', with: 'other nodes', clearance: 3, falloff: 0, amount: 0.5, baseSkip: 0 });
  assert.ok(moved > 0, 'something moved');
  const ys = [1, 4, 7, 10].map((i) => b.position[i]);
  assert.ok(ys.some((y) => y >= 2.9), `a corner over the other quad cleared 3 cm: ${ys}`);
});
