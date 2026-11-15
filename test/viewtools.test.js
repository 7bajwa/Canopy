// The LOD count saves and undoes with the plant; the entity box picks what a line crosses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, commit, undo, resetHistory } from '../src/app/doc.js';
import { segHitsBox } from '../src/app/xfgizmo.js';

test('doc.lods defaults to 4, stays in 1..8 and undoes', () => {
  doc.graph = { nodes: [], links: [], groups: [], settings: { manual: true } };
  resetHistory();
  assert.equal(doc.lods, 4);
  doc.lods = 6; commit();
  assert.equal(doc.graph.settings.lods, 6);
  doc.lods = 20; assert.equal(doc.lods, 8);
  doc.lods = 0; assert.equal(doc.lods, 1);
  doc.lods = 6; commit();
  doc.lods = 2; commit();
  undo();
  assert.equal(doc.lods, 6);
});

test('a segment touches a box when it crosses it, even with both ends outside', () => {
  const b = { x0: 10, y0: 10, x1: 20, y1: 20 };
  assert.equal(segHitsBox([0, 15], [30, 15], b), true);
  assert.equal(segHitsBox([12, 12], [14, 14], b), true);
  assert.equal(segHitsBox([0, 0], [5, 30], b), false);
  assert.equal(segHitsBox([0, 25], [25, 0], b), true);
  assert.equal(segHitsBox([0, 45], [45, 0], b), false);
});
