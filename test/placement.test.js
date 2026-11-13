import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';
import { makeShape } from '../src/engine/shapes.js';
import { layerPoints } from '../src/engine/placement.js';
import { bakeShape } from '../src/engine/primitive.js';

const node = (id, type, params = {}) => ({ id, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const lines = (g, id) => { const r = evaluate(g, {}); const L = r.lines; const s = new Set(); for (let k = 0; k < L.owner.length; k += 2) if (L.nodeIds[L.owner[k]] === id) s.add(L.lineId[k]); return s.size; };

test('grid placement makes columns times rows', () => {
  const g = { nodes: [node('a', 'Spline', { place: 'grid', gridX: 3, gridZ: 4, gridStep: 50, length: 100 })], links: [], groups: [], settings: {} };
  assert.equal(lines(g, 'a'), 12);
});

test('mesh placement on faces and vertices makes one per face or point', () => {
  const ball = node('m', 'Mesh', { shape: 'rectangle', size: [100, 100, 100], bevel: 0, segments: 3, show: false });
  const on = (meshOn) => ({ nodes: [ball, node('s', 'Spline', { place: 'mesh', meshOn, length: 10, slope: 180 })], links: [{ id: 'l', from: 'm', fromSock: 'children', to: 's', toSock: 'parent' }], groups: [], settings: {} });
  const faces = lines(on('faces'), 's'); const verts = lines(on('vertices'), 's');
  assert.ok(faces > 6 && verts > 6, `faces ${faces}, vertices ${verts}`);
  assert.notEqual(faces, verts);
});

test('layers ring a shape from the bottom up, staggered', () => {
  const shape = makeShape({ shape: 'sphere', radius: 50, sizeX: 100, sizeY: 100, sizeZ: 100, pos: [0, 0, 0] });
  const pts = layerPoints(shape, 1, 4, 32, true);
  assert.equal(pts.length, 32);
  assert.ok(pts[0].p[1] < pts[31].p[1], 'bottom first');
});

test('a sphere profile curve shapes the ball', () => {
  const plain = bakeShape({ shape: 'sphere', radius: 50, segments: 16 });
  const egg = bakeShape({ shape: 'sphere', radius: 50, segments: 16, curves: { profile: { pts: [[0, 1, 's'], [1, 0.3, 's']] } } });
  const widthNear = (m, y) => { let w = 0; for (let i = 0; i < m.v.length; i += 3) if (Math.abs(m.v[i + 1] - y) < 8) w = Math.max(w, Math.abs(m.v[i])); return w; };
  assert.ok(widthNear(egg, 35) < widthNear(plain, 35) * 0.7, 'narrower near the top');
});

test('scan base blending: blended branches start inside the base, and the base is cut open there', () => {
  const base = (crop) => node('m', 'Mesh', { shape: 'sphere', radius: 50, segments: 24, cropUnder: crop });
  const g = (crop) => ({ nodes: [base(crop), node('s', 'Spline', { place: 'mesh', count: 6, length: 80, radius: 6, meshType: 'tube', blendBase: true })], links: [{ id: 'l', from: 'm', fromSock: 'children', to: 's', toSock: 'parent' }], groups: [], settings: {} });
  const baseTris = (crop) => evaluate(g(crop), {}).meshes.filter((x) => x.nodeId === 'm').reduce((s, x) => s + x.index.length / 3, 0);
  const open = baseTris(true); const closed = baseTris(false);
  assert.ok(open < closed && open > closed * 0.7, `${closed} -> ${open}`);
});

test('Droop arches a level line down, more for longer lines', () => {
  const tipY = (length, mods) => { const g = { nodes: [node('a', 'Spline', { tilt: 90, length, mods })], links: [], groups: [], settings: {} }; const P = evaluate(g, {}).lines.position; return P[P.length - 2]; };
  const droop = [{ id: 'd', type: 'Dir_Droop', on: true, params: { strength: 1, stiffness: 300 } }];
  assert.ok(tipY(300, droop) < tipY(300, []) - 30, 'it sags');
  assert.ok(tipY(600, droop) - tipY(600, []) < (tipY(300, droop) - tipY(300, [])) * 2, 'a longer one sags more than in proportion');
});
