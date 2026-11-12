// The AI control commands, on a stand-in document: build, change, check and refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApi } from '../src/app/aibridge.js';
import { NODE_TYPES, defaultParams } from '../src/graph/schema.js';
import { newMaterial } from '../src/graph/materials.js';

function setup() {
  const doc = { name: 'Test', graph: { nodes: [], links: [], groups: [], settings: {}, materials: [] } };
  let n = 0;
  const api = makeApi({
    doc, NODE_TYPES, defaultParams, newMaterial,
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

test('variation, curves, modifiers and materials go in as the guide writes them, and bad ones are refused', () => {
  const { api, doc } = setup();
  const { id: mat } = api.addMaterial({ name: 'Red leaf', color: '#c8141f', roughness: 0.45 });
  const { id } = api.addNode({ type: 'Spline', params: { material: mat, vary: { tilt: 30 }, curves: { width: { pts: [[0, 0.2], [1, 1]] } }, mods: { gravity: { vector: [0, -1, 0], strength: 1.4 }, Dir_Random: { max: 20 } } } });
  const P = doc.graph.nodes.find((n) => n.id === id).params;
  assert.equal(P.material, mat);
  assert.equal(P.vary.tilt, 30);
  assert.deepEqual(P.curves.width.pts[1], [1, 1, 's']);
  assert.equal(P.mods.find((m) => m.id === 'gravity').params.strength, 1.4);
  assert.ok(P.mods.some((m) => m.type === 'Dir_Random'), 'a new modifier by type');
  assert.throws(() => api.setParams({ id, params: { vary: { nope: 1 } } }), /no number setting/);
  assert.throws(() => api.setParams({ id, params: { curves: { width: { pts: [[2, 1], [3, 1]] } } } }), /2 to 32 points/);
  assert.throws(() => api.setParams({ id, params: { mods: { Explode: {} } } }), /not a modifier/);
  assert.throws(() => api.addMaterial({ color: 'red' }), /color like/);
});
