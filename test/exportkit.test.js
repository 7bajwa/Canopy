// The export window's data: zip archives, wind gradients, Pivot Painter elements, the wind bake and pieces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipStore, crc32 } from '../src/app/zip.js';
import { lineExtents, gradient, pivotElements, pivotTextures, pivotUvs, bakeVat, piecesOf, windPoint } from '../src/app/exportkit.js';
import { WIND_STRIDE } from '../src/engine/wind.js';

test('a stored zip lists its files with the right checksums', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const z = zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'b.bin', data: Uint8Array.of(1, 2, 3) }]);
  const v = new DataView(z.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50, 'starts with a local header');
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50, 'ends with the directory end');
  assert.equal(v.getUint16(end + 10, true), 2, 'two files');
  assert.ok(Buffer.from(z).toString('latin1').includes('hello'));
});

// Two lines: a trunk going up from the origin, and a branch from (0,50,0) going +X, child of the trunk.
function table() {
  const T = new Float32Array(2 * WIND_STRIDE);
  T.set([0, 0, 0, -1, 0, 1, 0, 0, 1, 1, 0, 0, 0], 0);
  T.set([0, 50, 0, 0, 1, 0, 0, 0.4, 1, 1, 0, 0, 0.5], WIND_STRIDE);
  return T;
}
const mesh = (kind) => ({
  kind,
  position: Float32Array.of(0, 0, 0, 0, 100, 0, 0, 50, 0, 40, 50, 0),
  color: new Float32Array(12).fill(0.5),
  wind: Float32Array.of(0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0),
  index: Uint32Array.of(0, 1, 0, 2, 3, 2),
});

test('wind gradients run up the plant and along each branch', () => {
  const T = table(); const m = mesh('tube');
  const ctx = { table: T, ext: lineExtents([m], T), lo: 0, hi: 100 };
  assert.deepEqual([...gradient(m, 'height', ctx)], [0, 1, 0.5, 0.5]);
  assert.deepEqual([...gradient(m, 'branch', ctx)], [0, 1, 0, 1]);
  assert.deepEqual([...gradient(m, 'leaf', ctx)], [0, 0, 0, 0], 'branches carry no leaf gradient');
  const leaf = mesh('leaf');
  assert.equal(gradient(leaf, 'branch', ctx)[2], 0.5, 'a leaf takes where it sits on its branch');
});

test('pivot painter elements keep the hierarchy and point each point at its pixel', () => {
  const T = table(); const m = mesh('tube');
  const pp = pivotElements([m], T);
  assert.equal(pp.elements.length, 2);
  assert.equal(pp.elements[0].parent, 0, 'a root is its own parent');
  assert.equal(pp.elements[1].parent, 0);
  assert.deepEqual(pp.elements[1].pivot, [0, 0, 50], 'Unreal axes: up is Z');
  assert.equal(pp.elements[1].extent, 40);
  const { pos } = pivotTextures(pp);
  assert.equal(new DataView(pos.buffer).getInt32(4 * 7, true), 0, 'the parent index is stored as its integer bits');
  const uv = pivotUvs(m, pp);
  assert.notEqual(uv[0], uv[4], 'the two lines read different pixels');
});

test('the wind bake moves the tip and keeps the base still', () => {
  const T = table(); const m = mesh('tube');
  const tip = windPoint([0, 100, 0], [0, 1, 0], T, 0.7, 0.3, [1, 0, 0]);
  assert.ok(Math.hypot(tip[0], tip[1] - 100, tip[2]) > 1, 'the tip sways');
  const vat = bakeVat(m, T, { frames: 4, seconds: 1, windS: 0.3 });
  assert.equal(vat.h, 4 * vat.rows);
  assert.deepEqual([...vat.data.slice(0, 3)], [0, 0, 0], 'the base does not move');
});

test('pieces split a mesh by line', () => {
  const p = piecesOf(mesh('tube'));
  assert.equal(p.length, 2);
  assert.deepEqual(p.map((x) => x.verts.length), [2, 2]);
});

test('straighten lines picked points up on one axis; snap rounds them to the grid', async () => {
  const { straighten, snapTo } = await import('../src/app/cut3d.js');
  assert.deepEqual(straighten([[0, 1, 2], [4, 3, 0]], 0), [[2, 1, 2], [2, 3, 0]]);
  assert.deepEqual(snapTo([[6, 2.4, -3]], 5), [[5, 0, -5]]);
});

test('a dropped box docks on the nearest wall it may use', async () => {
  const { dockAt } = await import('../src/app/dock.js');
  assert.deepEqual(dockAt(10, 300, 1000, 600, 'left', 0.5), { wall: 'left', at: 0.5 });
  assert.equal(dockAt(990, 300, 1000, 600, 'left', 0.5).wall !== 'right', true, 'never the other view\'s side wall');
  const top = dockAt(750, 5, 1000, 600, 'right', 0.5);
  assert.equal(top.wall, 'top');
  assert.equal(top.at, 0.5, 'halfway along its own half');
});

test('gridify pulls nearly lined-up points into straight rows and columns', async () => {
  const { gridify } = await import('../src/app/cut3d.js');
  const out = gridify([[0, 0, 0], [0.4, 10, 0], [-0.3, 20, 0.2], [10, 0.5, 0]], 1);
  assert.equal(new Set(out.slice(0, 3).map((v) => v[0])).size, 1, 'one straight column');
  assert.equal(out[0][1], out[3][1], 'one straight row');
  assert.notEqual(out[0][0], out[3][0], 'far apart points stay apart');
});
