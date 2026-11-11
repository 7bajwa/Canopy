// Scene objects: anything lines can grow on, avoid, slice against or fill with attractors.
import { hash, norm, cross, sub, dot, len } from './math.js';

export function parseObj(text) {
  const v = [];
  const idx = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const f = p.slice(1).map((s) => {
        const i = parseInt(s, 10);
        return i < 0 ? v.length / 3 + i : i - 1;
      });
      for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]);
    }
  }
  return { v, idx };
}

function closestOnTri(px, py, pz, a, b, c) {
  const ab = sub(b, a); const ac = sub(c, a); const ap = [px - a[0], py - a[1], pz - a[2]];
  const d1 = dot(ab, ap); const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [px - b[0], py - b[1], pz - b[2]];
  const d3 = dot(ab, bp); const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const w = d1 / (d1 - d3); return [a[0] + ab[0] * w, a[1] + ab[1] * w, a[2] + ab[2] * w]; }
  const cp = [px - c[0], py - c[1], pz - c[2]];
  const d5 = dot(ab, cp); const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den; const w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// Returns { closest(p) -> {p,n,d}, inside(p), sample(seed,i) -> {p,n}, bounds, area, edges(), verts() }
export function shapeSize(params) {
  if (params.radius === undefined) return params.size || [100, 100, 100];
  // A ground patch: Radius scaled by its two size percentages; an imported one scales the mesh instead.
  if (params.shape === 'imported') return [params.sizeX, params.sizeX, params.sizeX];
  return [params.radius * (params.sizeX / 100), 1, params.radius * (params.sizeZ / 100)];
}

export function makeShape(params) {
  const pos = params.pos || [0, 0, 0];
  const size = shapeSize(params);
  const [cx, cy, cz] = pos;
  const [hx, hy, hz] = [size[0], size[1], size[2]];
  const raw = params.shape === 'square' ? 'plane' : params.shape;
  const kind = raw === 'imported' && params.obj?.v?.length ? 'mesh' : raw === 'imported' ? 'sphere' : raw;

  if (kind === 'disk') {
    return {
      kind,
      bounds: [[cx - hx, cy, cz - hz], [cx + hx, cy, cz + hz]],
      area: Math.PI * hx * hz,
      closest(p) {
        const x = (p[0] - cx) / hx; const z = (p[2] - cz) / hz;
        const k = Math.min(1, 1 / (Math.hypot(x, z) || 1));
        const s = [cx + x * k * hx, cy, cz + z * k * hz];
        const d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
        return { p: s, n: [0, 1, 0], d: p[1] < cy ? -d : d };
      },
      inside: () => false,
      sample(seed, i) {
        // The square root keeps points even across the disk instead of bunching at its center.
        const r = Math.sqrt(hash(seed, i, 1)); const a = hash(seed, i, 2) * Math.PI * 2;
        return { p: [cx + Math.cos(a) * r * hx, cy, cz + Math.sin(a) * r * hz], n: [0, 1, 0] };
      },
    };
  }

  if (kind === 'sphere') {
    return {
      kind,
      bounds: [[cx - hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz + hz]],
      area: 4 * Math.PI * ((hx * hy + hy * hz + hx * hz) / 3),
      closest(p) {
        const q = [(p[0] - cx) / hx, (p[1] - cy) / hy, (p[2] - cz) / hz];
        const n = norm(q);
        const s = [cx + n[0] * hx, cy + n[1] * hy, cz + n[2] * hz];
        const d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
        return { p: s, n, d: len(q) < 1 ? -d : d };
      },
      inside(p) { return ((p[0] - cx) / hx) ** 2 + ((p[1] - cy) / hy) ** 2 + ((p[2] - cz) / hz) ** 2 < 1; },
      sample(seed, i) {
        const z = hash(seed, i, 1) * 2 - 1; const a = hash(seed, i, 2) * Math.PI * 2; const r = Math.sqrt(1 - z * z);
        const n = [r * Math.cos(a), z, r * Math.sin(a)];
        return { p: [cx + n[0] * hx, cy + n[1] * hy, cz + n[2] * hz], n };
      },
    };
  }
  if (kind === 'box' || kind === 'plane') {
    const sy = kind === 'plane' ? 0 : hy;
    return {
      kind,
      bounds: [[cx - hx, cy - sy, cz - hz], [cx + hx, cy + sy, cz + hz]],
      area: kind === 'plane' ? 4 * hx * hz : 8 * (hx * sy + sy * hz + hx * hz),
      closest(p) {
        const q = [p[0] - cx, p[1] - cy, p[2] - cz];
        const inside = Math.abs(q[0]) <= hx && Math.abs(q[1]) <= sy && Math.abs(q[2]) <= hz;
        if (inside) {
          const dx = hx - Math.abs(q[0]); const dy = sy - Math.abs(q[1]); const dz = hz - Math.abs(q[2]);
          const m = Math.min(dx, dy, dz);
          const n = m === dy ? [0, Math.sign(q[1]) || 1, 0] : m === dx ? [Math.sign(q[0]) || 1, 0, 0] : [0, 0, Math.sign(q[2]) || 1];
          return { p: [p[0] + n[0] * m, p[1] + n[1] * m, p[2] + n[2] * m], n, d: -m };
        }
        const s = [Math.max(-hx, Math.min(hx, q[0])), Math.max(-sy, Math.min(sy, q[1])), Math.max(-hz, Math.min(hz, q[2]))];
        const diff = [q[0] - s[0], q[1] - s[1], q[2] - s[2]];
        return { p: [cx + s[0], cy + s[1], cz + s[2]], n: norm(diff), d: len(diff) };
      },
      inside(p) { return Math.abs(p[0] - cx) < hx && Math.abs(p[1] - cy) < sy && Math.abs(p[2] - cz) < hz; },
      sample(seed, i) {
        const u = hash(seed, i, 1) * 2 - 1; const v = hash(seed, i, 2) * 2 - 1;
        if (kind === 'plane') return { p: [cx + u * hx, cy, cz + v * hz], n: [0, 1, 0] };
        const axis = Math.floor(hash(seed, i, 3) * 6);
        const sign = axis % 2 ? 1 : -1;
        if (axis < 2) return { p: [cx + sign * hx, cy + u * sy, cz + v * hz], n: [sign, 0, 0] };
        if (axis < 4) return { p: [cx + u * hx, cy + sign * sy, cz + v * hz], n: [0, sign, 0] };
        return { p: [cx + u * hx, cy + v * sy, cz + sign * hz], n: [0, 0, sign] };
      },
    };
  }

  // Imported mesh: scaled by Size / 100 and moved to Position.
  const scale = size[0] / 100;
  const V = params.obj.v;
  const I = params.obj.idx;
  const vert = (i) => [V[i * 3] * scale + cx, V[i * 3 + 1] * scale + cy, V[i * 3 + 2] * scale + cz];
  const tris = [];
  let area = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < I.length; i += 3) {
    const a = vert(I[i]); const b = vert(I[i + 1]); const c = vert(I[i + 2]);
    const cr = cross(sub(b, a), sub(c, a));
    const l = len(cr);
    area += l / 2;
    tris.push({ a, b, c, n: norm(cr), acc: area });
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
  }
  const inside = (p) => {
    // Ray parity along +Y; shortcut: assumes a closed mesh, as the object cloud requires
    let hits = 0;
    for (const t of tris) {
      const d1 = (t.b[0] - t.a[0]) * (p[2] - t.a[2]) - (t.b[2] - t.a[2]) * (p[0] - t.a[0]);
      const d2 = (t.c[0] - t.b[0]) * (p[2] - t.b[2]) - (t.c[2] - t.b[2]) * (p[0] - t.b[0]);
      const d3 = (t.a[0] - t.c[0]) * (p[2] - t.c[2]) - (t.a[2] - t.c[2]) * (p[0] - t.c[0]);
      if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) {
        if (Math.abs(t.n[1]) < 1e-6) continue;
        const y = t.a[1] - (t.n[0] * (p[0] - t.a[0]) + t.n[2] * (p[2] - t.a[2])) / t.n[1];
        if (y > p[1]) hits++;
      }
    }
    return hits % 2 === 1;
  };
  return {
    kind,
    bounds: [min, max],
    area,
    closest(p) {
      let best = null; let bd = Infinity; let tri = null;
      for (const t of tris) {
        const q = closestOnTri(p[0], p[1], p[2], t.a, t.b, t.c);
        const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bd) { bd = d; best = q; tri = t; }
      }
      if (!best) return { p, n: [0, 1, 0], d: 0 };
      const d = Math.sqrt(bd);
      return { p: best, n: tri.n, d: dot(sub(p, best), tri.n) < 0 ? -d : d };
    },
    inside,
    sample(seed, i) {
      const pick = hash(seed, i, 1) * area;
      let lo = 0; let hi = tris.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].acc < pick) lo = m + 1; else hi = m; }
      const t = tris[lo];
      let u = hash(seed, i, 2); let v = hash(seed, i, 3);
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      return {
        p: [
          t.a[0] + (t.b[0] - t.a[0]) * u + (t.c[0] - t.a[0]) * v,
          t.a[1] + (t.b[1] - t.a[1]) * u + (t.c[1] - t.a[1]) * v,
          t.a[2] + (t.b[2] - t.a[2]) * u + (t.c[2] - t.a[2]) * v,
        ],
        n: t.n,
      };
    },
    triangles: tris,
    vertices: Array.from({ length: V.length / 3 }, (_, i) => vert(i)),
  };
}
