import test from 'node:test';
import assert from 'node:assert/strict';
import { uvTris, boxMap } from '../src/app/uvwire.js';

const quad = (id, kind) => ({ nodeId: id, kind, uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), index: new Uint32Array([0, 1, 2, 0, 2, 3]) });

test('uvTris reads the picked node triangles and caps the count', () => {
  const ms = [quad('a', 'bark'), quad('b', 'bark'), quad('a', 'leaf')];
  const t = uvTris(ms, (m) => m.nodeId === 'a');
  assert.equal(t.length, 4 * 6);
  assert.deepEqual([...t.subarray(0, 6)], [0, 0, 1, 0, 1, 1]);
  assert.equal(uvTris(ms, (m) => m.nodeId === 'a' && m.kind === 'bark').length, 12);
  assert.equal(uvTris(ms, () => true, 3).length, 3 * 6);
  assert.equal(uvTris(null, () => true).length, 0);
});

test('boxMap moves, scales and turns points with the box', () => {
  const box = [[0, 0], [1, 0], [0, 1]];
  assert.equal(boxMap(box, box), null);
  const m = boxMap(box, [[1, 1], [1, 3], [-1, 1]]); // turned 90 degrees, doubled, moved
  assert.deepEqual(m(0.5, 0), [1, 2]);
  assert.deepEqual(m(0, 0.5), [0, 1]);
});
