// Subdivide keeps quads, Merge welds, Remesh joins parts, Avoid tilts cards, and the LOD modifier thins parts out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { subdivide, weld, remesh, avoidMesh, lodShare } from '../src/engine/meshmods.js';
import { facesOf } from '../src/app/quads.js';
import { Evaluator } from '../src/engine/evaluate.js';
import { defaultParams } from '../src/graph/schema.js';

// A w×h grid of quads in the XY plane facing +Z, each quad two triangles in a row (the way tubes are built).
function grid(w, h, size = 10, z = 0, u0 = 0) {
  const P = []; const N = []; const UV = []; const W = []; const I = [];
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) { P.push(x * size, y * size, z); N.push(0, 0, 1); UV.push(u0 + x / w, y / h); W.push(1, y / h, 0); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = y * (w + 1) + x; I.push(a, a + 1, a + w + 2, a, a + w + 2, a + w + 1); }
  return { position: Float32Array.from(P), normal: Float32Array.from(N), uv: Float32Array.from(UV), wind: Float32Array.from(W), index: Uint32Array.from(I), quads: true };
}
const faceSizes = (m) => facesOf(m.index, m.quads ? new Uint8Array(m.index.length / 3).fill(1) : null, m.position).sizes;

test('subdivide keeps a quad mesh all quads, and triangles only where there were some', () => {
  const m = grid(2, 2);
  subdivide(m, 2, 1, true);
  const s = faceSizes(m);
  assert.equal(s.length, 4 * 16);
  assert.ok(s.every((n) => n === 4), 'every face is a quad');
  // One extra lone triangle beside the quads: it becomes four triangles, the quads stay quads.
  const t = grid(1, 1); t.position = Float32Array.from([...t.position, 20, 0, 0]); t.normal = Float32Array.from([...t.normal, 0, 0, 1]);
  t.uv = Float32Array.from([...t.uv, 1.5, 0]); t.wind = Float32Array.from([...t.wind, 1, 0, 0]); t.index = Uint32Array.from([...t.index, 1, 4, 3]);
  subdivide(t, 1, 0, true);
  const ts = faceSizes(t);
  assert.equal(ts.filter((n) => n === 4).length, 4);
  assert.equal(ts.filter((n) => n === 3).length, 4);
  for (let i = 2; i < t.position.length; i += 3) assert.equal(t.position[i], 0, 'smooth 0 stays flat');
});

test('subdivide smooths across a UV seam instead of treating it as a border', () => {
  // Two sheets meeting at x = 20 with their own points (as a seam has), different U on each side.
  const a = grid(2, 2); const b = grid(2, 2, 10, 0, 5);
  for (let i = 0; i < b.position.length; i += 3) b.position[i] += 20;
  const m = {
    position: Float32Array.from([...a.position, ...b.position]), normal: Float32Array.from([...a.normal, ...b.normal]),
    uv: Float32Array.from([...a.uv, ...b.uv]), wind: Float32Array.from([...a.wind, ...b.wind]),
    index: Uint32Array.from([...a.index, ...b.index.map((v) => v + 9)]), quads: true,
  };
  for (let i = 0; i < m.position.length; i += 3) m.position[i + 2] = Math.sin(m.position[i] / 10) * 3;
  subdivide(m, 1, 1, false);
  // Points at the seam's middle row on either side end up in the same place: no crack opened.
  const at = new Map();
  for (let v = 0; v < m.position.length / 3; v++) {
    if (Math.abs(m.position[v * 3] - 20) > 1e-3) continue;
    const k = Math.round(m.position[v * 3 + 1] * 100);
    if (at.has(k)) assert.ok(Math.abs(at.get(k) - m.position[v * 3 + 2]) < 1e-4, 'seam points agree'); else at.set(k, m.position[v * 3 + 2]);
  }
  assert.ok(at.size >= 3);
});

test('merge welds touching points, keeping UV seams apart but in one place', () => {
  // Two separate quads sharing an edge's position (x = 10), with the same UVs there, then with different ones.
  const pair = (u2) => {
    const a = grid(1, 1); const b = grid(1, 1, 10, 0, u2);
    for (let i = 0; i < b.position.length; i += 3) b.position[i] += 10 + 0.01;
    return { position: Float32Array.from([...a.position, ...b.position]), normal: Float32Array.from([...a.normal, ...b.normal]), uv: Float32Array.from([...a.uv, ...b.uv]), index: Uint32Array.from([...a.index, ...b.index.map((v) => v + 4)]), quads: true };
  };
  const same = pair(1); weld(same, 0.1, true);
  assert.equal(same.position.length / 3, 6, 'shared edge welds when UVs match');
  const seam = pair(3); weld(seam, 0.1, true);
  assert.equal(seam.position.length / 3, 8, 'a UV seam keeps its own points');
  assert.equal(seam.position[1 * 3], seam.position[4 * 3], 'but they move to the same place');
  const full = pair(3); weld(full, 0.1, false);
  assert.equal(full.position.length / 3, 6, 'with seams off everything welds');
  // Two sides of a leaf (facing away) never weld.
  const two = grid(1, 1); const back = grid(1, 1);
  for (let i = 2; i < back.normal.length; i += 3) back.normal[i] = -1;
  const m = { position: Float32Array.from([...two.position, ...back.position]), normal: Float32Array.from([...two.normal, ...back.normal]), uv: Float32Array.from([...two.uv, ...back.uv]), index: Uint32Array.from([...two.index, ...back.index.map((v) => v + 4)]) };
  weld(m, 0.1, true);
  assert.equal(m.position.length / 3, 8);
});

test('remesh turns two crossing sheets into one closed surface with UVs, facing out', () => {
  const a = grid(4, 4, 5); const b = grid(4, 4, 5);
  // b stands upright across a's middle.
  for (let i = 0; i < b.position.length; i += 3) { const y = b.position[i + 1]; b.position[i + 1] = 0; b.position[i + 2] = y - 10; b.normal[i + 1] = 1; b.normal[i + 2] = 0; }
  for (let i = 0; i < b.position.length; i += 3) b.position[i + 1] += 10;
  const m = { position: Float32Array.from([...a.position, ...b.position]), normal: Float32Array.from([...a.normal, ...b.normal]), uv: Float32Array.from([...a.uv, ...b.uv]), wind: Float32Array.from([...a.wind, ...b.wind]), index: Uint32Array.from([...a.index, ...b.index.map((v) => v + 25)]), quads: true };
  const t0 = Date.now();
  remesh(m, { res: 32, quads: true, snap: 0.5 });
  assert.ok(Date.now() - t0 < 3000, 'quick enough');
  const n = m.position.length / 3;
  assert.ok(m.index.length > 100 && n > 50);
  assert.equal(m.uv.length, n * 2); assert.equal(m.wind.length, n * 3);
  assert.ok([...m.uv].every((x) => x >= -0.3 && x <= 1.3), 'UVs come from the source');
  // Closed: every edge is used by exactly two triangles.
  const uses = new Map(); const key = (x, y) => (x < y ? `${x},${y}` : `${y},${x}`);
  const P = m.position; const k3 = (v) => `${P[v * 3].toFixed(4)},${P[v * 3 + 1].toFixed(4)},${P[v * 3 + 2].toFixed(4)}`;
  const id = new Map(); const wid = (v) => { const k = k3(v); if (!id.has(k)) id.set(k, id.size); return id.get(k); };
  for (let t = 0; t < m.index.length; t += 3) for (let e = 0; e < 3; e++) { const k = key(wid(m.index[t + e]), wid(m.index[t + (e + 1) % 3])); uses.set(k, (uses.get(k) || 0) + 1); }
  assert.ok([...uses.values()].every((c) => c === 2 || c === 4), 'no open edges');
  // Points on top of the flat sheet (high z, away from the upright one) face up.
  let up = 0; let down = 0;
  for (let v = 0; v < n; v++) if (P[v * 3 + 2] > 0.3 && Math.abs(P[v * 3 + 1] - 10) > 4 && P[v * 3 + 2] < 2) { if (m.normal[v * 3 + 2] > 0) up++; else down++; }
  assert.ok(up > down, `normals face out (${up} up, ${down} down)`);
});

test('avoid tilt turns a crossing card clear of the one before it, as a whole', () => {
  // Two cards from the same base row: the second one leans through the first.
  const card = (lean, id) => {
    const P = []; const N = []; const W = []; const I = [];
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 1; x++) { P.push(x * 10 - 5, y * 5, y * 5 * lean); N.push(0, -lean, 1); W.push(id, y / 4, 0); }
    for (let y = 0; y < 4; y++) { const a = y * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    return { P, N, W, I };
  };
  const a = card(0, 1); const b = card(0.3, 2);
  for (let i = 1; i < b.P.length; i += 3) b.P[i] += 0.5;
  for (let i = 2; i < b.P.length; i += 3) b.P[i] -= 4;
  const off = a.P.length / 3;
  const m = { position: Float32Array.from([...a.P, ...b.P]), normal: Float32Array.from([...a.N, ...b.N]), wind: Float32Array.from([...a.W, ...b.W]), index: Uint32Array.from([...a.I, ...b.I.map((v) => v + off)]) };
  const before = m.position.slice();
  const moved = avoidMesh(m, [m], { mode: 'tilt', with: 'same node', clearance: 1, maxTilt: 40, amount: 4, baseSkip: 0 });
  assert.equal(moved, 1, 'one card moves');
  for (let i = 0; i < off * 3; i++) assert.equal(m.position[i], before[i], 'the first card stays');
  // The moved card keeps its shape (a rigid turn): its side length is unchanged.
  const len = (Q, u, v) => Math.hypot(Q[u * 3] - Q[v * 3], Q[u * 3 + 1] - Q[v * 3 + 1], Q[u * 3 + 2] - Q[v * 3 + 2]);
  assert.ok(Math.abs(len(m.position, off, off + 8) - len(before, off, off + 8)) < 1e-3);
});

let ids = 0;
const node = (type, params = {}) => ({ id: `l${++ids}`, type, x: 0, y: 0, on: true, params: { ...defaultParams(type), ...params } });
const tris = (g, o) => new Evaluator(g, o).run().meshes.reduce((s, m) => s + m.index.length / 3, 0);

test('the LOD modifier thins a Spline toward the last LOD, honouring the LOD count', () => {
  assert.equal(lodShare({ amount: 80 }, 0, 4), 1);
  assert.ok(Math.abs(lodShare({ amount: 80 }, 3, 4) - 0.2) < 1e-6, 'full reduction at the last LOD');
  assert.ok(Math.abs(lodShare({ amount: 80 }, 3, 7) - 0.6) < 1e-6, 'halfway through seven LODs');
  assert.equal(lodShare({ amount: 80, sides: false }, 3, 4, 'sides'), 1);
  const lod = (amount, extra = {}) => ({ id: 'q', type: 'lod', on: true, params: { amount, segments: true, sides: true, leaves: true, cardFrom: 2, ...extra } });
  const spline = (mods) => ({ nodes: [node('Spline', { length: 300, steps: 10, sides: 16, meshMods: mods })], links: [], groups: [], settings: { seed: 1 } });
  const full = tris(spline([lod(90)]), { lod: 0 });
  const low = tris(spline([lod(90)]), { lod: 3, lods: 4 });
  const none = tris(spline([lod(0)]), { lod: 3, lods: 4 });
  assert.ok(low < full * 0.25, `${low} vs ${full}`);
  assert.equal(none, full, '0% keeps every LOD whole, whatever the old LOD reduction says');
  // LOD 5 of 8 is not clamped to 3.
  const ev = new Evaluator(spline([lod(90)]), { lod: 5, lods: 8 });
  assert.equal(ev.lod, 5);
  assert.equal(new Evaluator(spline([]), { lod: 9, lods: 4 }).lod, 3);
  // Without the modifier the old LOD reduction % still applies.
  assert.ok(tris(spline([]), { lod: 3 }) < full);
});

test('the LOD modifier on a Mesh lowers its segments', () => {
  const mesh = (mods) => ({ nodes: [node('Mesh', { shape: 'sphere', segments: 32, mods })], links: [], groups: [], settings: { seed: 1 } });
  const mod = { id: 'q', type: 'lod', on: true, params: { amount: 80, segments: true } };
  assert.ok(tris(mesh([mod]), { lod: 3 }) < tris(mesh([mod]), { lod: 0 }) * 0.2);
  assert.equal(tris(mesh([]), { lod: 3 }), tris(mesh([]), { lod: 0 }), 'no modifier, no change');
});
