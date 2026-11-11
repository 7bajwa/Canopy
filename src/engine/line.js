// A line is the skeleton of one branch or leaf: points, arc lengths, and a twist-free frame.
import { norm, perpendicular } from './math.js';

export function finishLine(line) {
  const pts = line.pts;
  const n = pts.length / 3;
  const l = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3; const b = i * 3;
    l[i] = l[i - 1] + Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
  }
  line.n = n;
  line.len = l;
  line.length = n > 1 ? l[n - 1] : 0;
  line.U = null;
}

// Parallel transport keeps rings from twisting. V = T x U throughout, which the blend relies on.
export function ensureFrames(line) {
  if (line.U) return;
  const { pts, n } = line;
  const T = new Float32Array(n * 3);
  const U = new Float32Array(n * 3);
  const V = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0) * 3; const b = Math.min(i + 1, n - 1) * 3;
    const t = norm([pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]]);
    T[i * 3] = t[0]; T[i * 3 + 1] = t[1]; T[i * 3 + 2] = t[2];
  }
  let u = line.upHint ? norm(line.upHint) : perpendicular([T[0], T[1], T[2]]);
  for (let i = 0; i < n; i++) {
    const tx = T[i * 3]; const ty = T[i * 3 + 1]; const tz = T[i * 3 + 2];
    const d = u[0] * tx + u[1] * ty + u[2] * tz;
    let ux = u[0] - d * tx; let uy = u[1] - d * ty; let uz = u[2] - d * tz;
    const m = Math.hypot(ux, uy, uz) || 1;
    ux /= m; uy /= m; uz /= m;
    u = [ux, uy, uz];
    let vx = ty * uz - tz * uy; let vy = tz * ux - tx * uz; let vz = tx * uy - ty * ux;
    const roll = line.roll ? line.roll[i] : 0;
    if (roll) {
      const c = Math.cos(roll); const s = Math.sin(roll);
      const rx = ux * c + vx * s; const ry = uy * c + vy * s; const rz = uz * c + vz * s;
      vx = vx * c - ux * s; vy = vy * c - uy * s; vz = vz * c - uz * s;
      U[i * 3] = rx; U[i * 3 + 1] = ry; U[i * 3 + 2] = rz;
    } else { U[i * 3] = ux; U[i * 3 + 1] = uy; U[i * 3 + 2] = uz; }
    V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
  }
  line.T = T; line.U = U; line.V = V;
}

// Shared scratch result for sampleLine: hot loops call this per ring, so it must not allocate.
export function newSample() {
  return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 1, ux: 1, uy: 0, uz: 0, vx: 0, vy: 1, vz: 0, r: 0, i: 0, f: 0 };
}

export function sampleLine(line, s, o) {
  ensureFrames(line);
  const { pts, len, n, T, U, V, radii } = line;
  if (n < 2) {
    o.px = pts[0]; o.py = pts[1]; o.pz = pts[2]; o.r = radii ? radii[0] : 0;
    return o;
  }
  let lo = 0; let hi = n - 1;
  if (s <= 0) hi = 1;
  else if (s >= len[n - 1]) lo = n - 2;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] <= s) lo = m; else hi = m; }
  if (hi - lo > 1) hi = lo + 1;
  if (s <= 0) lo = 0;
  const w = len[hi] - len[lo];
  const f = w > 1e-9 ? Math.min(1, Math.max(0, (s - len[lo]) / w)) : 0;
  const a = lo * 3; const b = hi * 3;
  o.px = pts[a] + (pts[b] - pts[a]) * f;
  o.py = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * f;
  o.pz = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * f;
  let x = T[a] + (T[b] - T[a]) * f; let y = T[a + 1] + (T[b + 1] - T[a + 1]) * f; let z = T[a + 2] + (T[b + 2] - T[a + 2]) * f;
  let m = Math.hypot(x, y, z) || 1;
  o.tx = x / m; o.ty = y / m; o.tz = z / m;
  x = U[a] + (U[b] - U[a]) * f; y = U[a + 1] + (U[b + 1] - U[a + 1]) * f; z = U[a + 2] + (U[b + 2] - U[a + 2]) * f;
  m = Math.hypot(x, y, z) || 1;
  o.ux = x / m; o.uy = y / m; o.uz = z / m;
  x = V[a] + (V[b] - V[a]) * f; y = V[a + 1] + (V[b + 1] - V[a + 1]) * f; z = V[a + 2] + (V[b + 2] - V[a + 2]) * f;
  m = Math.hypot(x, y, z) || 1;
  o.vx = x / m; o.vy = y / m; o.vz = z / m;
  o.r = radii ? radii[lo] + (radii[hi] - radii[lo]) * f : 0;
  o.i = lo; o.f = f;
  return o;
}

export function pointAt(line, s) {
  const o = sampleLine(line, s, newSample());
  return [o.px, o.py, o.pz];
}

// Fraction of the nominal length, which stays stable when a modifier slices the line.
export const tOf = (line, s) => (line.nominal > 0 ? Math.min(1, ((line.tOff || 0) + s) / line.nominal) : 0);
