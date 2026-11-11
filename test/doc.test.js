// Connection rules and undo: mistakes here silently corrupt a user's graph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, addNode, connect, commit, undo, redo, resetHistory, removeNodes, duplicate, mergeNodes } from '../src/app/doc.js';
import { parseDocument } from '../src/app/io.js';

function reset() {
  doc.graph = { nodes: [], links: [], groups: [], settings: { manual: true } };
  doc.sel = new Set();
  resetHistory();
}

test('sockets only connect to the same kind and never make a loop', () => {
  reset();
  const a = addNode('Path', 0, 0); const b = addNode('CylinderMesh', 0, 0);
  assert.equal(connect(a.id, 'mesh', b.id, 'in').ok, true);
  assert.equal(connect(a.id, 'dir', b.id, 'in').ok, false);
  const d = addNode('PathDistributor', 0, 0); const c = addNode('Path', 0, 0);
  assert.equal(connect(a.id, 'children', d.id, 'parent').ok, true);
  assert.equal(connect(d.id, 'out', c.id, 'in').ok, true);
  const d2 = addNode('PathDistributor', 0, 0);
  assert.equal(connect(c.id, 'children', d2.id, 'parent').ok, true);
  assert.equal(connect(d2.id, 'out', a.id, 'in').ok, false, 'a loop must be refused');
});

test('a single input and a modifier chain output replace the old wire', () => {
  reset();
  const v1 = addNode('Value', 0, 0); const v2 = addNode('Value', 0, 0); const p = addNode('Path', 0, 0);
  connect(v1.id, 'value', p.id, 'p:length');
  connect(v2.id, 'value', p.id, 'p:length');
  assert.deepEqual(doc.graph.links.filter((l) => l.toSock === 'p:length').map((l) => l.from), [v2.id]);
  const m1 = addNode('Dir_Noise', 0, 0); const m2 = addNode('Dir_Random', 0, 0);
  connect(p.id, 'dir', m1.id, 'in');
  connect(p.id, 'dir', m2.id, 'in');
  assert.deepEqual(doc.graph.links.filter((l) => l.fromSock === 'dir').map((l) => l.to), [m2.id]);
});

test('undo and redo restore nodes and links', () => {
  reset();
  const a = addNode('Path', 0, 0); const b = addNode('CylinderMesh', 0, 0);
  commit();
  connect(a.id, 'mesh', b.id, 'in');
  commit();
  removeNodes([b.id]);
  commit();
  assert.equal(doc.graph.nodes.length, 1);
  undo();
  assert.equal(doc.graph.nodes.length, 2);
  assert.equal(doc.graph.links.length, 1);
  undo();
  assert.equal(doc.graph.links.length, 0);
  redo();
  assert.equal(doc.graph.links.length, 1);
});

test('duplicating and merging keep inner links with fresh ids', () => {
  reset();
  const a = addNode('Path', 0, 0); const b = addNode('CylinderMesh', 0, 0);
  connect(a.id, 'mesh', b.id, 'in');
  const ids = duplicate([a.id, b.id]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(doc.graph.nodes.map((n) => n.id)).size, 4);
  assert.equal(doc.graph.links.length, 2);
  mergeNodes([{ id: a.id, type: 'Path', params: {} }, { id: 'zz', type: 'NoSuchNode', params: {} }], [{ id: 'x', from: a.id, fromSock: 'mesh', to: 'zz', toSock: 'in' }]);
  assert.equal(doc.graph.nodes.length, 5, 'unknown node types are skipped');
  assert.equal(doc.graph.links.length, 2, 'links to skipped nodes are dropped');
});

test('files that are not documents are refused', () => {
  assert.throws(() => parseDocument('not json'));
  assert.throws(() => parseDocument('{"nodes": 3}'));
  assert.throws(() => parseDocument('{"nodes":[{"id":1}],"links":[]}'));
  assert.equal(parseDocument('{"nodes":[],"links":[]}').nodes.length, 0);
});
