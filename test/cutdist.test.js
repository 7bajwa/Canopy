// Cutouts spread By curve along the parent: the first in the list at the base, the last at the tip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';
import { meshCutout } from '../src/leaf/cutout.js';

const square = { id: 'sq', ...meshCutout({ name: 'A', basePx: [50, 100], tipPx: [50, 0], outlinePx: [[0, 100], [100, 100], [100, 0], [0, 0]] }, 200, 200) };
const hex = { id: 'hx', ...meshCutout({ name: 'B', basePx: [50, 100], tipPx: [50, 0], outlinePx: [[30, 100], [70, 100], [100, 50], [70, 0], [30, 0], [0, 50]] }, 200, 200) };
let ids = 0;
const node = (params) => ({ id: `c${++ids}`, type: 'Spline', x: 0, y: 0, on: true, params: { ...defaultParams('Spline'), ...params } });

// Vertex count of each leaf (grouped by the line it sways with), from base to tip of the stem.
function leaves(p) {
  const stem = node({ length: 200 });
  const leaf = node({ meshType: 'cutout', length: 20, count: 12, cutouts: [square, hex], texture: null, ...p });
  const g = { nodes: [stem, leaf], links: [{ id: 'l', from: stem.id, fromSock: 'children', to: leaf.id, toSock: 'parent' }], groups: [], settings: { seed: 1 } };
  const m = new Evaluator(g).run().meshes.find((x) => x.kind === 'leaf');
  const by = new Map();
  for (let v = 0; v < m.position.length / 3; v++) {
    const k = m.wind[v * 3]; const e = by.get(k) || { n: 0, y: Infinity };
    e.n++; e.y = Math.min(e.y, m.position[v * 3 + 1]); by.set(k, e);
  }
  return [...by.values()].sort((a, b) => a.y - b.y).map((e) => e.n);
}

test('by curve puts the first cutout at the base and the last at the tip', () => {
  const n = leaves({ cutDist: 'by curve' });
  assert.ok(n.length >= 4, `${n.length} leaves`);
  assert.notEqual(n[0], n[n.length - 1], 'base and tip leaves use different cutouts');
  const flip = leaves({ cutDist: 'by curve', cutCurve: { pts: [[0, 1, 's'], [1, 0, 's']] } });
  assert.equal(flip[0], n[n.length - 1], 'a falling curve swaps them');
  assert.deepEqual(leaves({ cutDist: 'by curve' }), n, 'same result every build');
});
