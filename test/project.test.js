// The Project modifier: points land on the target surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMesh, triGrid, closestOnTri } from '../src/engine/project.js';

// A UV sphere of radius r around c, as triangles.
function sphere(r, c = [0, 0, 0], seg = 32, rings = 16) {
  const P = []; const I = [];
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
    const th = (j / rings) * Math.PI; const ph = (i / seg) * Math.PI * 2;
    P.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i; const b = a + seg + 1;
    I.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { position: new Float32Array(P), index: new Uint32Array(I) };
}

// Points scattered inside the target, each with an outward normal from the middle.
function cloud(n, r) {
  const V = []; const N = [];
  for (let k = 0; k < n; k++) {
    const t = (k * 2.399963) % (Math.PI * 2); const y = 1 - (2 * (k + 0.5)) / n; const s = Math.sqrt(1 - y * y);
    const d = [Math.cos(t) * s, y, Math.sin(t) * s]; const rr = r * (0.3 + 0.6 * ((k * 0.618) % 1));
    V.push(...d.map((x) => x * rr)); N.push(...d);
  }
  return { position: new Float32Array(V), normal: new Float32Array(N), index: new Uint32Array(0) };
}

// Distance from each point to the target surface, by checking every triangle.
function distances(m, target) {
  const g = triGrid([target]); const q = [0, 0, 0]; const out = [];
  for (let v = 0; v < m.position.length / 3; v++) {
    const x = m.position[v * 3]; const y = m.position[v * 3 + 1]; const z = m.position[v * 3 + 2];
    let best = Infinity;
    for (let t = 0; t < g.nt; t++) { closestOnTri(g.T, t, x, y, z, q); best = Math.min(best, Math.hypot(q[0] - x, q[1] - y, q[2] - z)); }
    out.push(best);
  }
  return out;
}

test('nearest surface puts every point on the target', () => {
  const target = sphere(20, [0, 0, 0]);
  const m = cloud(200, 20);
  assert.equal(projectMesh(m, [target], { mode: 'nearest surface' }), 200);
  for (const d of distances(m, target)) assert.ok(d < 1e-3, `off the surface by ${d}`);
});

test('along normal hits the target where the normal points', () => {
  const target = sphere(20);
  const m = cloud(120, 20);
  const dirs = Array.from(m.normal);
  projectMesh(m, [target], { mode: 'along normal' });
  for (const d of distances(m, target)) assert.ok(d < 1e-3);
  // Each point stays on its own normal line through the middle.
  for (let v = 0; v < 120; v++) {
    const p = [m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2]]; const l = Math.hypot(...p);
    assert.ok(Math.abs(p[0] / l - dirs[v * 3]) < 1e-3 && Math.abs(p[1] / l - dirs[v * 3 + 1]) < 1e-3);
  }
});

test('offset, strength and which parts move', () => {
  const target = sphere(20);
  const off = cloud(60, 20);
  projectMesh(off, [target], { offset: 1.5 });
  for (const d of distances(off, target)) assert.ok(Math.abs(d - 1.5) < 0.05, `offset gave ${d}`);
  const half = cloud(60, 20); const start = Array.from(half.position);
  projectMesh(half, [target], { strength: 0.5 });
  const full = cloud(60, 20); projectMesh(full, [target], {});
  for (let i = 0; i < start.length; i++) assert.ok(Math.abs(half.position[i] - (start[i] + full.position[i]) / 2) < 1e-4);
  const some = cloud(10, 20); const before = Array.from(some.position);
  const parts = { id: Int32Array.from({ length: 10 }, (_, i) => (i < 5 ? 0 : 1)), along: new Float32Array(10) };
  assert.equal(projectMesh(some, [target], { parts: 'first line' }, parts), 5);
  for (let i = 15; i < 30; i++) assert.equal(some.position[i], before[i]);
});
