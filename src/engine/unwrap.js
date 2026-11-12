// Cylinder unwrap around a spline, for baking a scanned trunk onto a tube. Every scan point gets its place in the
// tube's own terms: t along the spline (0 base, 1 tip), u around it (0..1), r its distance from the spline.

// Frames along a polyline (flat xyz): arc length, and per point a tangent with two normals carried along
// (parallel transport), so "around" doesn't twist where the line bends.
export function lineFrames(P) {
  const n = P.length / 3; const s = new Float64Array(n); const T = []; const N = []; const B = [];
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
    T.push(norm([P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]]));
  }
  // Start with the world's X (or Z for a line along X), then carry it along.
  let ref = Math.abs(T[0][0]) > 0.9 ? [0, 0, 1] : [1, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = T[i];
    const d = ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2];
    const nn = norm([ref[0] - t[0] * d, ref[1] - t[1] * d, ref[2] - t[2] * d]);
    N.push(nn); B.push(cross(t, nn)); ref = nn;
  }
  return { s, L: s[n - 1] || 1e-6, T, N, B };
}

// Each scan point (flat xyz) as [t, u, r] around the polyline P.
export function cylCoords(V, P, F = lineFrames(P)) {
  const n = P.length / 3; const out = new Float32Array((V.length / 3) * 3);
  for (let v = 0; v < V.length / 3; v++) {
    const x = V[v * 3]; const y = V[v * 3 + 1]; const z = V[v * 3 + 2];
    let best = Infinity; let bi = 0; let bf = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ax = P[i * 3]; const ay = P[i * 3 + 1]; const az = P[i * 3 + 2];
      const dx = P[i * 3 + 3] - ax; const dy = P[i * 3 + 4] - ay; const dz = P[i * 3 + 5] - az;
      const len2 = dx * dx + dy * dy + dz * dz || 1e-12;
      const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2));
      const qx = ax + dx * f - x; const qy = ay + dy * f - y; const qz = az + dz * f - z;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < best) { best = d; bi = i; bf = f; }
    }
    const j = Math.min(n - 1, bi + 1);
    const lerp = (A, k) => A[bi][k] + (A[j][k] - A[bi][k]) * bf;
    const cx = P[bi * 3] + (P[j * 3] - P[bi * 3]) * bf; const cy = P[bi * 3 + 1] + (P[j * 3 + 1] - P[bi * 3 + 1]) * bf; const cz = P[bi * 3 + 2] + (P[j * 3 + 2] - P[bi * 3 + 2]) * bf;
    const d = [x - cx, y - cy, z - cz];
    const nx = [lerp(F.N, 0), lerp(F.N, 1), lerp(F.N, 2)]; const bx = [lerp(F.B, 0), lerp(F.B, 1), lerp(F.B, 2)];
    const a = Math.atan2(d[0] * bx[0] + d[1] * bx[1] + d[2] * bx[2], d[0] * nx[0] + d[1] * nx[1] + d[2] * nx[2]);
    out[v * 3] = (F.s[bi] + (F.s[j] - F.s[bi]) * bf) / F.L;
    out[v * 3 + 1] = (a / (Math.PI * 2) + 1) % 1;
    out[v * 3 + 2] = Math.sqrt(best);
  }
  return out;
}

// The scan's radius along the spline: the median distance in each of `bins` stretches (gaps filled from
// neighbours). Returns { r: Float32Array(bins), mean }.
export function fitRadius(C, bins = 24) {
  const lists = Array.from({ length: bins }, () => []);
  for (let i = 0; i < C.length; i += 3) lists[Math.min(bins - 1, Math.floor(C[i] * bins))].push(C[i + 2]);
  const r = new Float32Array(bins).fill(NaN);
  lists.forEach((l, i) => { if (l.length) { l.sort((a, b) => a - b); r[i] = l[l.length >> 1]; } });
  for (let i = 0; i < bins; i++) if (Number.isNaN(r[i])) {
    let a = i - 1; while (a >= 0 && Number.isNaN(r[a])) a--;
    let b = i + 1; while (b < bins && Number.isNaN(r[b])) b++;
    r[i] = a >= 0 && b < bins ? (r[a] + r[b]) / 2 : a >= 0 ? r[a] : b < bins ? r[b] : 1;
  }
  const mean = r.reduce((x, y) => x + y, 0) / bins;
  return { r, mean };
}

// Texture height for a width, keeping the unwrapped tube's own aspect (length over circumference).
// pow2 rounds to the nearest power of two.
export function unwrapSize(width, length, meanRadius, pow2 = false) {
  const h = Math.max(1, Math.round(width * length / (2 * Math.PI * Math.max(meanRadius, 1e-6))));
  return pow2 ? 2 ** Math.round(Math.log2(h)) : h;
}

// A normal map (RGBA bytes) from a gray height map: Sobel slopes times strength.
export function heightToNormal(img, strength = 2) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const H = (x, y) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength; let ny = dy * strength; let nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

// The middle line of a scanned trunk: its long axis (the main direction of its points, pointing up), cut into slices
// along it, each slice's middle taken from the extent of its points (not their average, so uneven scans don't pull
// it to one side). Returns points from the foot to the top, for a Spline to run up inside the scan.
export function scanCenterline(V, bins = 16) {
  const n = V.length / 3;
  if (n < 4) return null;
  const m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) m[c] += V[i * 3 + c] / n;
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [V[i * 3] - m[0], V[i * 3 + 1] - m[1], V[i * 3 + 2] - m[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += d[r] * d[c];
  }
  let a = [0, 1, 0];
  for (let k = 0; k < 32; k++) {
    const b = [0, 1, 2].map((r) => cov[r * 3] * a[0] + cov[r * 3 + 1] * a[1] + cov[r * 3 + 2] * a[2]);
    const l = Math.hypot(...b) || 1; a = b.map((x) => x / l);
  }
  if (a[1] < 0) a = a.map((x) => -x);
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  let u = cross(a, ref); const ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const v = cross(a, u);
  const dot = (i, w) => (V[i * 3] - m[0]) * w[0] + (V[i * 3 + 1] - m[1]) * w[1] + (V[i * 3 + 2] - m[2]) * w[2];
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < n; i++) { const t = dot(i, a); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const box = Array.from({ length: bins }, () => [Infinity, -Infinity, Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    const b = box[Math.min(bins - 1, Math.floor(((dot(i, a) - lo) / (hi - lo || 1)) * bins))];
    const pu = dot(i, u); const pv = dot(i, v);
    b[0] = Math.min(b[0], pu); b[1] = Math.max(b[1], pu); b[2] = Math.min(b[2], pv); b[3] = Math.max(b[3], pv);
  }
  const at = (t, b) => { const cu = (b[0] + b[1]) / 2; const cv = (b[2] + b[3]) / 2; return [0, 1, 2].map((c) => m[c] + a[c] * t + u[c] * cu + v[c] * cv); };
  const full = box.map((b, k) => [b, k]).filter(([b]) => b[0] <= b[1]);
  if (full.length < 2) return null;
  const step = (hi - lo) / bins;
  // The ends reach the scan's foot and top, with the middle of the slice beside them.
  return [at(lo, full[0][0]), ...full.map(([b, k]) => at(lo + (k + 0.5) * step, b)), at(hi, full[full.length - 1][0])];
}
