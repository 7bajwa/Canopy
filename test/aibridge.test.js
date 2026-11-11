// The AI control commands, on a stand-in document: build, change, check and refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApi } from '../src/app/aibridge.js';
import { NODE_TYPES, defaultParams } from '../src/graph/schema.js';

function setup() {
  const doc = { name: 'Test', graph: { nodes: [], links: [], groups: [], settings: {}, materials: [] } };
  let n = 0;
  const api = makeApi({
    doc, NODE_TYPES, defaultParams,
    addNode: (type, x, y) => { const node = { id: `n${++n}`, type, x, y, on: true, params: defaultParams(type) }; doc.graph.nodes.push(node); return node; },
    connect: (from, fs, to, ts) => { doc.graph.links.push({ id: `l${doc.graph.links.length}`, from, fromSock: fs, to, toSock: ts }); return { ok: true }; },
    removeNodes: (ids) => { doc.graph.nodes = doc.graph.nodes.filter((x) => !ids.includes(x.id)); },
    changed: () => {}, commit: () => {},
    loadGraph: (g, name) => { doc.graph = g; doc.name = name; },
    renderImage: () => 'data:image/png;base64,AAAA',
  });
  return { doc, api };
}

test('the schema lists the Spline with its settings', () => {
  const { api } = setup();
  const spline = api.schema().nodeTypes.find((t) => t.type === 'Spline');
  assert.ok(spline.params.some((p) => p.key === 'length' && p.type === 'num'));
});

test('a trunk with branches is built, changed and read back', () => {
  const { api, doc } = setup();
  const { id: trunk } = api.addNode({ type: 'Spline', name: 'Trunk', params: { length: 500 } });
  const { id: branch } = api.addNode({ type: 'Spline', name: 'Branches', parent: trunk, params: { place: 'spline', density: 3 } });
  api.setParams({ id: branch, params: { tilt: 50 } });
  const plant = api.getPlant();
  assert.equal(plant.graph.nodes.length, 2);
  assert.equal(doc.graph.nodes.find((n) => n.id === branch).params.tilt, 50);
  assert.deepEqual(api.listNodes().find((n) => n.id === branch).parent, trunk);
});

test('bad input is refused with a clear reason', () => {
  const { api } = setup();
  assert.throws(() => api.addNode({ type: 'Rocket' }), /Unknown node type/);
  assert.throws(() => api.addNode({ type: 'Spline', params: { length: Infinity } }), /needs a number/);
  assert.throws(() => api.addNode({ type: 'Spline', params: { nope: 1 } }), /no setting/);
  assert.throws(() => api.setPlant({ graph: { nodes: [{ id: 'a', type: 'Spline' }], links: [{ from: 'a', to: 'b' }] } }), /isn't there/);
  const ok = api.setPlant({ graph: { nodes: [{ id: 'a', type: 'Spline', params: { length: 120 } }], links: [] } });
  assert.equal(ok.nodes, 1);
});
