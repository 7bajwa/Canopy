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

// Makes a map repeat seamlessly along its length: the last band fades into the first, then is cut off.
export function tileAlong(img, frac = 0.15) {
  const { width: W, height: H, data } = img;
  const b = Math.max(1, Math.round(H * frac));
  const out = { width: W, height: H - b, data: new Uint8ClampedArray(W * (H - b) * 4) };
  out.data.set(data.subarray(0, W * (H - b) * 4));
  for (let y = 0; y < b; y++) {
    const t = y / b; // 0 at the seam: the row that followed the kept part; toward 1: the map itself
    for (let x = 0; x < W * 4; x++) out.data[y * W * 4 + x] = data[(H - b + y) * W * 4 + x] * (1 - t) + data[y * W * 4 + x] * t;
  }
  return out;
}
