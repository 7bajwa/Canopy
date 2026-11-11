// Cutout leaf meshes: quads or well-shaped triangles, with nothing missing or overlapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoutsFromImage, meshCutout, triangulateInner, addOutlinePoint, addInnerPoint, removeCutoutPoint } from '../src/leaf/cutout.js';

const leafImage = () => {
  const w = 128; const h = 128; const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - 64) / 22) ** 2 + ((y - 64) / 54) ** 2 < 1) data[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, data };
};

// The triangles must cover the outline exactly once: same area, and no triangle turned over.
function covers(c) {
  const all = [...c.outlinePx, ...(c.innerPx || [])];
  const signed = (a, b, d) => ((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])) / 2;
  const { tris } = c.mesh;
  let sum = 0; let pos = 0; let neg = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const s = signed(all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]);
    sum += Math.abs(s);
    if (s > 1e-9) pos++; else if (s < -1e-9) neg++;
  }
  let poly = 0;
  const o = c.outlinePx;
  for (let i = 0; i < o.length; i++) poly += o[i][0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * o[i][1];
  return { area: sum, poly: Math.abs(poly) / 2, flipped: Math.min(pos, neg) };
}

test('quad mode builds a grid of quads, one more column each side when asked', () => {
  const [one] = cutoutsFromImage(leafImage(), { points: 10, inside: 'quads', columns: 1 });
  const [two] = cutoutsFromImage(leafImage(), { points: 10, inside: 'quads', columns: 2 });
  assert.ok(one.faces?.length > 4);
  assert.ok(one.stats.quads >= one.faces.length - 4, 'mostly quads; only the pointed ends may be triangles');
  assert.ok(two.stats.quads > one.stats.quads);
  for (const c of [one, two]) {
    const k = covers(c);
    assert.ok(Math.abs(k.area - k.poly) < k.poly * 1e-6, `area ${k.area} vs ${k.poly}`);
    assert.equal(k.flipped, 0);
  }
});

test('triangle mode joins the same points as a Delaunay mesh', () => {
  const [c] = cutoutsFromImage(leafImage(), { points: 12, inside: 'triangles', columns: 2 });
  assert.equal(c.faces, null);
  const all = [...c.outlinePx, ...c.innerPx];
  const used = new Set(c.mesh.tris);
  for (let i = 0; i < all.length; i++) assert.ok(used.has(i), `point ${i} is left out`);
  const k = covers(c);
  assert.ok(Math.abs(k.area - k.poly) < k.poly * 1e-6);
  // No shared edge that a flip would improve.
  const t = c.mesh.tris;
  const edges = new Map();
  for (let i = 0; i < t.length; i += 3) for (let e = 0; e < 3; e++) {
    const u = t[i + e]; const v = t[i + (e + 1) % 3]; const key = u < v ? `${u},${v}` : `${v},${u}`;
    (edges.get(key) || edges.set(key, []).get(key)).push(t[i + (e + 2) % 3]);
  }
  const angle = (o, x, y) => { const a = [all[x][0] - all[o][0], all[x][1] - all[o][1]]; const b = [all[y][0] - all[o][0], all[y][1] - all[o][1]]; return Math.atan2(Math.abs(a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1]); };
  for (const [key, opp] of edges) {
    if (opp.length !== 2) continue;
    const [u, v] = key.split(',').map(Number);
    assert.ok(angle(opp[0], u, v) + angle(opp[1], u, v) <= Math.PI + 1e-6, `edge ${key} should flip`);
  }
});

test('points on a straight edge of the outline still join the mesh, with no crack', () => {
  const all = [[0, 0], [50, 0], [100, 0], [100, 100], [50, 100], [0, 100], [50, 50]];
  const tris = triangulateInner(all, 6);
  for (let i = 0; i < all.length; i++) assert.ok(tris.includes(i), `point ${i} unused`);
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.ok(Math.abs(area - 10000) < 1e-6);
});

test('adding and removing points keeps a quad mesh whole', () => {
  const [c] = cutoutsFromImage(leafImage(), { points: 10, inside: 'quads', columns: 1 });
  const re = (x) => meshCutout(x, 128, 128);
  const a = c.outlinePx[2]; const b = c.outlinePx[3];
  const edged = re(addOutlinePoint(c, 2, [(a[0] + b[0]) / 2 + 1, (a[1] + b[1]) / 2]));
  assert.ok(edged.faces, 'still a quad mesh');
  assert.ok(Math.abs(covers(edged).area - covers(edged).poly) < 1e-3);
  const f = c.faces.find((x) => x.length === 4);
  const all = [...c.outlinePx, ...c.innerPx];
  const mid = [f.reduce((s, i) => s + all[i][0], 0) / 4, f.reduce((s, i) => s + all[i][1], 0) / 4];
  const filled = re(addInnerPoint(c, mid));
  assert.ok(filled.faces && filled.faces.length === c.faces.length + 3, 'the quad it landed in became four triangles');
  const k = covers(filled);
  assert.ok(Math.abs(k.area - k.poly) < 1e-3 && k.flipped === 0);
  const gone = re(removeCutoutPoint(filled, 'inner', filled.innerPx.length - 1));
  assert.ok(Math.abs(covers(gone).area - covers(gone).poly) < 1e-3, 'no hole where the point was');
  const corner = re(removeCutoutPoint(c, 'outline', 1));
  assert.ok(Math.abs(covers(corner).area - covers(corner).poly) < 1e-3);
});

test('a hole leaves the mesh open where it is, and every hole point joins the edge of it', () => {
  const c = meshCutout({ basePx: [50, 100], tipPx: [50, 0], outlinePx: [[0, 100], [100, 100], [100, 0], [0, 0]], innerPx: [], holesPx: [[[30, 30], [70, 30], [70, 70], [30, 70]]] }, 100, 100);
  const all = [...c.outlinePx, ...c.holesPx.flat()];
  const { tris } = c.mesh;
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, d] = [all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]];
    area += Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])) / 2;
    const cx = (a[0] + b[0] + d[0]) / 3; const cy = (a[1] + b[1] + d[1]) / 3;
    assert.ok(!(cx > 30 && cx < 70 && cy > 30 && cy < 70), 'a triangle sits inside the hole');
  }
  assert.ok(Math.abs(area - (10000 - 1600)) < 1e-6, `area ${area}`);
  for (let i = 4; i < 8; i++) assert.ok(tris.includes(i));
  assert.equal(c.faces, null);
});
