// Builds the Mesh node's shape as a plain triangle list, with its modifiers and transform applied.
import { DEG, noise1, applyXf } from './math.js';

function sphere(R, seg) {
  const v = []; const idx = [];
  const rings = Math.max(3, Math.round(seg * 0.75));
  for (let r = 0; r <= rings; r++) {
    const a = (r / rings) * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const b = (s / seg) * Math.PI * 2;
      v.push(Math.sin(a) * Math.cos(b) * R, Math.cos(a) * R, Math.sin(a) * Math.sin(b) * R);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s; const d = a + seg + 1;
    idx.push(a, a + 1, d, a + 1, d + 1, d);
  }
  return { v, idx };
}

// A subdivided box whose points are pulled onto a smaller box plus the bevel radius, which rounds the corners.
function rectangle(size, bevel, seg) {
  const [sx, sy, sz] = size.map((x) => Math.max(x, 0.01) / 2);
  const b = Math.max(0, Math.min(bevel, sx, sy, sz));
  const n = Math.max(1, Math.round(seg / 2));
  const v = []; const idx = [];
  const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  for (const [N, U, V] of faces) {
    const base = v.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 - 1; const c = (j / n) * 2 - 1;
      const p = [0, 1, 2].map((k) => (N[k] + U[k] * a + V[k] * c) * [sx, sy, sz][k]);
      const inner = [Math.max(-sx + b, Math.min(sx - b, p[0])), Math.max(-sy + b, Math.min(sy - b, p[1])), Math.max(-sz + b, Math.min(sz - b, p[2]))];
      const d = [p[0] - inner[0], p[1] - inner[1], p[2] - inner[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      v.push(inner[0] + (d[0] / l) * b, inner[1] + (d[1] / l) * b, inner[2] + (d[2] / l) * b);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  }
  return { v, idx };
}

function cone(R, top, h, seg) {
  const v = []; const idx = [];
  const add = (x, y, z) => { v.push(x, y, z); return v.length / 3 - 1; };
  const stacks = Math.max(2, Math.round(seg / 2));
  for (let j = 0; j <= stacks; j++) {
    const t = j / stacks; const r = R + (top - R) * t;
    for (let s = 0; s <= seg; s++) { const b = (s / seg) * Math.PI * 2; add(Math.cos(b) * r, h * t, Math.sin(b) * r); }
  }
  for (let j = 0; j < stacks; j++) for (let s = 0; s < seg; s++) {
    const a = j * (seg + 1) + s; const d = a + seg + 1;
    idx.push(a, d, a + 1, a + 1, d, d + 1);
  }
  const cap = (y, r, flip) => {
    const c = add(0, y, 0);
    const first = v.length / 3;
    for (let s = 0; s <= seg; s++) { const b = (s / seg) * Math.PI * 2; add(Math.cos(b) * r, y, Math.sin(b) * r); }
    for (let s = 0; s < seg; s++) { if (flip) idx.push(c, first + s, first + s + 1); else idx.push(c, first + s + 1, first + s); }
  };
  cap(0, R, true);
  if (top > 0) cap(h, top, false);
  return { v, idx };
}

function disk(R, seg) {
  const v = [0, 0, 0]; const idx = [];
  const rings = Math.max(2, Math.round(seg / 3));
  const n = seg * 2;
  for (let r = 1; r <= rings; r++) for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2; const rr = (r / rings) * R;
    v.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  const at = (r, s) => 1 + (r - 1) * n + ((s + n) % n);
  for (let s = 0; s < n; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings; r++) for (let s = 0; s < n; s++) {
    const a = at(r, s); const b = at(r, s + 1); const c = at(r + 1, s); const d = at(r + 1, s + 1);
    idx.push(a, b, c, b, d, c);
  }
  return { v, idx };
}

// Smooth normals from the triangles, welded by position so seams and box edges don't show.
export function computeNormals(v, idx) {
  const n = new Float32Array(v.length);
  const weld = new Map();
  const keyOf = (i) => `${Math.round(v[i * 3] * 100)},${Math.round(v[i * 3 + 1] * 100)},${Math.round(v[i * 3 + 2] * 100)}`;
  const rep = new Int32Array(v.length / 3);
  for (let i = 0; i < rep.length; i++) {
    const k = keyOf(i);
    if (!weld.has(k)) weld.set(k, i);
    rep[i] = weld.get(k);
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
    const ux = v[b] - v[a]; const uy = v[b + 1] - v[a + 1]; const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a]; const wy = v[c + 1] - v[a + 1]; const wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy; const ny = uz * wx - ux * wz; const nz = ux * wy - uy * wx;
    for (const i of [idx[t], idx[t + 1], idx[t + 2]]) {
      const r = rep[i] * 3;
      n[r] += nx; n[r + 1] += ny; n[r + 2] += nz;
    }
  }
  for (let i = 0; i < rep.length; i++) {
    const r = rep[i] * 3;
    const l = Math.hypot(n[r], n[r + 1], n[r + 2]) || 1;
    n[i * 3] = n[r] / l; n[i * 3 + 1] = n[r + 1] / l; n[i * 3 + 2] = n[r + 2] / l;
  }
  return n;
}

// Soft value noise in 3D from three 1D runs: cheap, and smooth enough for bumps.
export const softNoise = (x, y, z, scale, seed = 1) => (noise1(x / scale, seed) + noise1(y / scale, seed + 17) + noise1(z / scale, seed + 31)) / 3;

export function applyMods(v, idx, mods, height) {
  for (const m of mods || []) {
    if (m.on === false) continue;
    const P = m.params || {};
    if (m.type === 'noise') {
      const amp = +P.amp || 0;
      if (!amp) continue;
      const nor = computeNormals(v, idx);
      const s = Math.max(+P.scale || 30, 0.1);
      for (let i = 0; i < v.length; i += 3) {
        const d = softNoise(v[i], v[i + 1], v[i + 2], s) * amp * 2;
        v[i] += nor[i] * d; v[i + 1] += nor[i + 1] * d; v[i + 2] += nor[i + 2] * d;
      }
    } else if (m.type === 'inflate') {
      const amt = +P.amount || 0;
      const nor = computeNormals(v, idx);
      for (let i = 0; i < v.length; i += 3) { v[i] += nor[i] * amt; v[i + 1] += nor[i + 1] * amt; v[i + 2] += nor[i + 2] * amt; }
    } else if (m.type === 'wave') {
      const amp = +P.amp || 0; const w = Math.max(+P.length || 40, 0.1);
      const nor = computeNormals(v, idx);
      for (let i = 0; i < v.length; i += 3) {
        const d = Math.sin((v[i + 1] / w) * Math.PI * 2) * amp;
        v[i] += nor[i] * d; v[i + 1] += nor[i + 1] * d; v[i + 2] += nor[i + 2] * d;
      }
    } else if (m.type === 'twist') {
      const a = (+P.angle || 0) * DEG;
      for (let i = 0; i < v.length; i += 3) {
        const t = a * (v[i + 1] / height);
        const c = Math.cos(t); const s = Math.sin(t);
        const x = v[i]; const z = v[i + 2];
        v[i] = x * c - z * s; v[i + 2] = x * s + z * c;
      }
    } else if (m.type === 'taper') {
      const k = (+P.amount || 0) / 100;
      for (let i = 0; i < v.length; i += 3) {
        const f = Math.max(0, 1 - k * ((v[i + 1] / height) * 0.5 + 0.5));
        v[i] *= f; v[i + 2] *= f;
      }
    } else if (m.type === 'bend') {
      const a = (+P.angle || 0) * DEG;
      if (Math.abs(a) < 1e-4) continue;
      const dir = (+P.direction || 0) * DEG;
      const cd = Math.cos(dir); const sd = Math.sin(dir);
      const R = height / a;
      for (let i = 0; i < v.length; i += 3) {
        // Bends in the plane of Direction: y becomes an angle around a circle of radius R.
        const along = v[i] * cd + v[i + 2] * sd;
        const across = -v[i] * sd + v[i + 2] * cd;
        const t = (v[i + 1] / height) * a;
        const r = R - along;
        const na = R - r * Math.cos(t);
        v[i + 1] = r * Math.sin(t);
        v[i] = na * cd - across * sd;
        v[i + 2] = na * sd + across * cd;
      }
    }
  }
}

function rotateEuler(v, rot) {
  const [rx, ry, rz] = rot.map((a) => (+a || 0) * DEG);
  if (!rx && !ry && !rz) return;
  const cx = Math.cos(rx); const sx = Math.sin(rx); const cy = Math.cos(ry); const sy = Math.sin(ry); const cz = Math.cos(rz); const sz = Math.sin(rz);
  for (let i = 0; i < v.length; i += 3) {
    const x0 = v[i]; const y0 = v[i + 1]; const z0 = v[i + 2];
    const y1 = y0 * cx - z0 * sx; const z1 = y0 * sx + z0 * cx;
    const x2 = x0 * cy + z1 * sy; const z2 = -x0 * sy + z1 * cy;
    v[i] = x2 * cz - y1 * sz; v[i + 1] = x2 * sz + y1 * cz; v[i + 2] = z2;
  }
}

export function bakeShape(P) {
  const seg = Math.max(3, Math.min(64, Math.round(+P.segments || 16)));
  let mesh;
  if (P.shape === 'rectangle') mesh = rectangle(P.size || [100, 100, 100], +P.bevel || 0, seg);
  else if (P.shape === 'cone') mesh = cone(+P.radius || 50, +P.topRadius || 0, +P.height || 100, seg);
  else if (P.shape === 'disk') mesh = disk(+P.radius || 50, seg);
  else if (P.shape === 'imported' && P.obj?.v?.length) mesh = { v: [...P.obj.v], idx: [...P.obj.idx], uv: P.obj.uv?.length === (P.obj.v.length / 3) * 2 ? P.obj.uv : null };
  else mesh = sphere(+P.radius || 50, seg);
  const { v, idx } = mesh;
  let top = 0;
  for (let i = 1; i < v.length; i += 3) top = Math.max(top, Math.abs(v[i]));
  applyMods(v, idx, P.mods, Math.max(top, 1));
  const scl = P.scl || [1, 1, 1];
  for (let i = 0; i < v.length; i += 3) { v[i] *= +scl[0]; v[i + 1] *= +scl[1]; v[i + 2] *= +scl[2]; }
  rotateEuler(v, P.rot || [0, 0, 0]);
  if (P.xf) applyXf(v, P.xf);
  const pos = P.pos || [0, 0, 0];
  for (let i = 0; i < v.length; i += 3) { v[i] += +pos[0]; v[i + 1] += +pos[1]; v[i + 2] += +pos[2]; }
  return { v, idx, n: Array.from(computeNormals(v, idx)), ...(mesh.uv ? { uv: mesh.uv } : {}) };
}
