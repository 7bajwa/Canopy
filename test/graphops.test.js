// Graph rules: one wire per parent, and muted nodes passing the flow through to their children.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, addNode, connect, resetHistory } from '../src/app/doc.js';
import { bypassMuted, expandGraph } from '../src/engine/expand.js';

function reset() {
  doc.graph = { nodes: [], links: [], groups: [], settings: { manual: true } };
  doc.sel = new Set();
  resetHistory();
}

test('the same parent connects to a child only once, other parents still add', () => {
  reset();
  const a = addNode('Spline', 0, 0); const b = addNode('Spline', 0, 0); const c = addNode('Spline', 0, 0);
  assert.equal(connect(a.id, 'children', c.id, 'parent').ok, true);
  assert.equal(connect(a.id, 'children', c.id, 'parent').ok, true);
  assert.equal(doc.graph.links.filter((l) => l.to === c.id).length, 1, 'no second wire from the same parent');
  connect(b.id, 'children', c.id, 'parent');
  assert.deepEqual(doc.graph.links.filter((l) => l.to === c.id).map((l) => l.from).sort(), [a.id, b.id].sort());
});

test('new nodes get their own wire color', () => {
  reset();
  const a = addNode('Spline', 0, 0);
  assert.match(a.params.wire, /^#[0-9a-f]{6}$/);
});

test('a muted node makes nothing and its children grow from its parent', () => {
  const node = (id, mute) => ({ id, type: 'Spline', on: true, ...(mute ? { mute: true } : {}), params: {} });
  const link = (from, to) => ({ id: `${from}-${to}`, from, fromSock: 'children', to, toSock: 'parent' });
  const graph = { nodes: [node('a'), node('m', true), node('m2', true), node('c')], links: [link('a', 'm'), link('m', 'm2'), link('m2', 'c'), link('a', 'c')] };
  const g = bypassMuted(graph);
  assert.deepEqual(g.nodes.map((n) => n.id), ['a', 'c']);
  assert.deepEqual(g.links.map((l) => [l.from, l.to]), [['a', 'c']], 'bypassed through both muted nodes, without a duplicate');
  const x = expandGraph(graph);
  assert.ok(!x.nodes.some((n) => n.id.startsWith('m')), 'muted parts are not built');
  assert.ok(x.links.some((l) => l.from === 'a#path' && l.to === 'c#place'));
  // A muted root leaves its children standing on their own.
  const lone = bypassMuted({ nodes: [node('m', true), node('c')], links: [link('m', 'c')] });
  assert.deepEqual(lone.links, []);
});
