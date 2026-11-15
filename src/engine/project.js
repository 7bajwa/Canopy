// The Project mesh modifier, like a shrinkwrap: moves each point of a mesh onto the surface of target meshes,
// either to the nearest point of it or along the point's own normal (both ways), with an offset off that surface.
import { bakeCurve, sampleCurve } from './math.js';

// The target triangles in a uniform grid, each triangle in every cell its box touches.
export function triGrid(targets) {
  let nt = 0;
  for (const t of targets) nt += t.index.length / 3;
  const T = new Float64Array(nt * 9); let k = 0;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of targets) {
    const V = t.position; const I = t.index;
    for (let i = 0; i < I.length; i++) for (let s = 0; s < 3; s++) {
      const x = V[I[i] * 3 + s]; T[k++] = x; if (x < lo[s]) lo[s] = x; if (x > hi[s]) hi[s] = x;
    }
  }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6);
  const vol = Math.max(hi[0] - lo[0], ext / 256) * Math.max(hi[1] - lo[1], ext / 256) * Math.max(hi[2] - lo[2], ext / 256);
  const cell = Math.max(ext / 200, Math.cbrt(vol / Math.max(1, nt)) * 1.5);
  const dim = [0, 1, 2].map((s) => Math.max(1, Math.ceil((hi[s] - lo[s]) / cell) + 1));
  const cells = new Map();
  const ix = (x, s) => Math.min(dim[s] - 1, Math.max(0, Math.floor((x - lo[s]) / cell)));
  for (let t = 0; t < nt; t++) {
    const a = [0, 1, 2].map((s) => ix(Math.min(T[t * 9 + s], T[t * 9 + 3 + s], T[t * 9 + 6 + s]), s));
    const b = [0, 1, 2].map((s) => ix(Math.max(T[t * 9 + s], T[t * 9 + 3 + s], T[t * 9 + 6 + s]), s));
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
      const key = (x * dim[1] + y) * dim[2] + z; let c = cells.get(key); if (!c) cells.set(key, (c = [])); c.push(t);
    }
  }
  return { T, nt, lo, cell, dim, cells, ix, stamp: new Int32Array(nt), pass: 0 };
}

// The closest point to p on triangle t of the grid (Ericson), written into out.
export function closestOnTri(T, t, px, py, pz, out) {
  const o = t * 9;
  const ax = T[o]; const ay = T[o + 1]; const az = T[o + 2];
  const abx = T[o + 3] - ax; const aby = T[o + 4] - ay; const abz = T[o + 5] - az;
  const acx = T[o + 6] - ax; const acy = T[o + 7] - ay; const acz = T[o + 8] - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const set = (v, w) => { out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w; };
  const d1 = abx * apx + aby * apy + abz * apz; const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set(0, 0);
  const bpx = px - T[o + 3]; const bpy = py - T[o + 4]; const bpz = pz - T[o + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz; const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return set(d1 / (d1 - d3), 0);
  const cpx = px - T[o + 6]; const cpy = py - T[o + 7]; const cpz = pz - T[o + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz; const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return set(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(1 - w, w); }
  const den = 1 / (va + vb + vc);
  return set(vb * den, vc * den);
}

// The nearest surface point within maxD: [x, y, z, triangle, distance], or null.
function nearest(g, x, y, z, maxD) {
  const c = [g.ix(x, 0), g.ix(y, 1), g.ix(z, 2)]; const q = [0, 0, 0];
  const pass = ++g.pass; let best = maxD * maxD; let hit = null;
  const rings = Math.max(...g.dim);
  for (let r = 0; r <= rings; r++) {
    for (let a = c[0] - r; a <= c[0] + r; a++) {
      if (a < 0 || a >= g.dim[0]) continue;
      for (let b = c[1] - r; b <= c[1] + r; b++) {
        if (b < 0 || b >= g.dim[1]) continue;
        const edge = a === c[0] - r || a === c[0] + r || b === c[1] - r || b === c[1] + r;
        for (let d = c[2] - r; d <= c[2] + r; d += edge ? 1 : Math.max(1, 2 * r)) {
          if (d < 0 || d >= g.dim[2]) continue;
          const list = g.cells.get((a * g.dim[1] + b) * g.dim[2] + d);
          if (!list) continue;
          for (const t of list) {
            if (g.stamp[t] === pass) continue;
            g.stamp[t] = pass;
            closestOnTri(g.T, t, x, y, z, q);
            const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
            if (dd < best) { best = dd; hit = [q[0], q[1], q[2], t]; }
          }
        }
      }
    }
    // Cells past ring r are at least r cells away.
    if (best <= (r * g.cell) ** 2) break;
  }
  if (hit) hit.push(Math.sqrt(best));
  return hit;
}

// The ray o + d * s against triangle t (both faces): s, or NaN when it misses.
function rayTri(T, t, ox, oy, oz, dx, dy, dz) {
  const o = t * 9;
  const e1x = T[o + 3] - T[o]; const e1y = T[o + 4] - T[o + 1]; const e1z = T[o + 5] - T[o + 2];
  const e2x = T[o + 6] - T[o]; const e2y = T[o + 7] - T[o + 1]; const e2z = T[o + 8] - T[o + 2];
  const px = dy * e2z - dz * e2y; const py = dz * e2x - dx * e2z; const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return NaN;
  const inv = 1 / det;
  const tx = ox - T[o]; const ty = oy - T[o + 1]; const tz = oz - T[o + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return NaN;
  const qx = ty * e1z - tz * e1y; const qy = tz * e1x - tx * e1z; const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return NaN;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// The first hit walking the grid from o along d (unit), up to maxS: [s, triangle], or null.
function march(g, o, d, maxS) {
  const { lo, cell, dim } = g;
  // Clip the walk to the grid's box.
  let s0 = 0; let s1 = maxS;
  for (let k = 0; k < 3; k++) {
    const a = lo[k]; const b = lo[k] + dim[k] * cell;
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < a || o[k] > b) return null; continue; }
    let ta = (a - o[k]) / d[k]; let tb = (b - o[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta];
    s0 = Math.max(s0, ta); s1 = Math.min(s1, tb);
  }
  if (s0 > s1) return null;
  const c = [0, 1, 2].map((k) => g.ix(o[k] + d[k] * s0, k));
  const step = d.map((v) => (v > 0 ? 1 : -1));
  const next = d.map((v, k) => (Math.abs(v) < 1e-12 ? Infinity : (lo[k] + (c[k] + (v > 0 ? 1 : 0)) * cell - o[k]) / v));
  const delta = d.map((v) => (Math.abs(v) < 1e-12 ? Infinity : cell / Math.abs(v)));
  const pass = ++g.pass; let best = Infinity; let bt = -1;
  for (;;) {
    const list = g.cells.get((c[0] * dim[1] + c[1]) * dim[2] + c[2]);
    if (list) for (const t of list) {
      if (g.stamp[t] === pass) continue;
      g.stamp[t] = pass;
      const s = rayTri(g.T, t, o[0], o[1], o[2], d[0], d[1], d[2]);
      if (s >= 0 && s <= maxS && s < best) { best = s; bt = t; }
    }
    const k = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    // A hit nearer than where this cell ends can't be beaten by the cells after it.
    if (bt >= 0 && best <= next[k]) break;
    if (next[k] > s1) break;
    c[k] += step[k]; next[k] += delta[k];
    if (c[k] < 0 || c[k] >= dim[k]) break;
  }
  return bt < 0 ? null : [best, bt];
}

function faceNormal(T, t) {
  const o = t * 9;
  const e1 = [T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]]; const e2 = [T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}

// Moves m's points onto the targets ({ position, index } meshes). parts ({ id, along }) lets the strength fade
// along each piece and limits which pieces move. Returns how many points moved.
export function projectMesh(m, targets, P = {}, parts = null) {
  const list = targets.filter((t) => t?.index?.length && t.position?.length);
  if (!list.length) return 0;
  const g = triGrid(list);
  const V = m.position; const N = m.normal; const nv = V.length / 3;
  const strength = Math.min(1, Math.max(0, +(P.strength ?? 1)));
  const offset = +(P.offset ?? 0);
  const maxD = +P.maxDist > 0 ? +P.maxDist : Infinity;
  const curve = P.curves?.strength ? bakeCurve(P.curves.strength) : null;
  const along = (v) => parts?.along[v] ?? 0;
  const fade = { 'toward the tip': (a) => 1 - a, 'toward the base': (a) => a }[P.falloff] || (() => 1);
  const skip = (v) => (parts && P.parts === 'first line' ? parts.id[v] !== 0 : parts && P.parts === 'all but the first' ? parts.id[v] === 0 : false);
  const far = maxD < Infinity ? maxD : g.dim.reduce((a, b) => Math.max(a, b), 0) * g.cell * 2;
  let moved = 0;
  for (let v = 0; v < nv; v++) {
    if (skip(v)) continue;
    let w = strength * fade(along(v));
    if (curve) w *= sampleCurve(curve, along(v));
    if (w <= 0) continue;
    const x = V[v * 3]; const y = V[v * 3 + 1]; const z = V[v * 3 + 2];
    const n = N ? [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]] : [0, 1, 0];
    let hit = null;
    if (P.mode === 'along normal') {
      const l = Math.hypot(...n);
      if (!l) continue;
      const d = n.map((c) => c / l);
      const f = march(g, [x, y, z], d, far); const b = march(g, [x, y, z], d.map((c) => -c), far);
      const s = f && (!b || f[0] <= b[0]) ? f[0] : b ? -b[0] : null;
      if (s === null) continue;
      hit = [x + d[0] * s, y + d[1] * s, z + d[2] * s, (f && (!b || f[0] <= b[0]) ? f : b)[1]];
    } else {
      hit = nearest(g, x, y, z, maxD);
      if (!hit) continue;
    }
    let off = [0, 0, 0];
    if (offset) {
      // Off the surface on the side the point's own normal faces, whichever way the target was wound.
      const fn = faceNormal(g.T, hit[3]);
      const sign = fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] < 0 ? -1 : 1;
      off = fn.map((c) => c * sign * offset);
    }
    V[v * 3] = x + (hit[0] + off[0] - x) * w;
    V[v * 3 + 1] = y + (hit[1] + off[1] - y) * w;
    V[v * 3 + 2] = z + (hit[2] + off[2] - z) * w;
    moved++;
  }
  return moved;
}
