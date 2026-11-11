// What the export window adds to a mesh, kept free of the page so it can be checked on its own: wind gradients in
// vertex colors, Pivot Painter data, a vertex animation bake of the wind, and splitting a mesh into its pieces.
import { WIND_STRIDE } from '../engine/wind.js';
import { hash } from '../engine/math.js';

export const lineOf = (src, i) => (src.wind ? Math.round(src.wind[i * 3]) : -1);

// shortcut: Unreal's axes are taken as (x, z, y) of the editor's (Y up, centimeters), as an FBX or glTF arrives there
// after its import fixes the up axis; change here if a pivot texture reads mirrored in the target engine.
export const toUnreal = (v) => [v[0], v[2], v[1]];

// How far each line reaches along its own direction from its base, over every mesh, so 0..1 runs base to tip.
export function lineExtents(srcs, table) {
  const ext = new Map();
  for (const src of srcs) {
    const P = src.position;
    for (let i = 0; i < P.length / 3; i++) {
      const l = lineOf(src, i);
      if (l < 0) continue;
      const k = l * WIND_STRIDE;
      const d = (P[i * 3] - table[k]) * table[k + 4] + (P[i * 3 + 1] - table[k + 1]) * table[k + 5] + (P[i * 3 + 2] - table[k + 2]) * table[k + 6];
      if (d > (ext.get(l) || 0)) ext.set(l, d);
    }
  }
  return ext;
}

// How deep each line sits in the hierarchy (trunk 0), from the parent index the wind table keeps.
const depthOf = (table, l, cache) => {
  if (cache.has(l)) return cache.get(l);
  let d = 0; let p = Math.round(table[l * WIND_STRIDE + 3]); const seen = new Set([l]);
  while (p >= 0 && !seen.has(p) && d < 64) { seen.add(p); d++; p = Math.round(table[p * WIND_STRIDE + 3]); }
  cache.set(l, d);
  return d;
};

// One 0..1 value per point for a wind channel: height up the plant, place along its branch (leaves take where they
// sit on their branch), place along a leaf (0 on branches), a random number per piece (phase), or how much a point
// bends with its branches: 0 at the foot of the trunk rising through each level out to the tips (bend).
export function gradient(src, choice, ctx) {
  const n = src.position.length / 3; const out = new Float32Array(n);
  const { table, ext, lo, hi } = ctx;
  const leaf = src.kind === 'leaf';
  const depths = ctx.depths ||= new Map();
  let maxDepth = ctx.maxDepth;
  if (choice === 'bend' && maxDepth === undefined) {
    maxDepth = 0;
    for (let l = 0; l < table.length / WIND_STRIDE; l++) maxDepth = Math.max(maxDepth, depthOf(table, l, depths));
    ctx.maxDepth = maxDepth;
  }
  for (let i = 0; i < n; i++) {
    const l = lineOf(src, i); const k = l * WIND_STRIDE;
    const along = () => {
      if (l < 0) return 0;
      const d = (src.position[i * 3] - table[k]) * table[k + 4] + (src.position[i * 3 + 1] - table[k + 1]) * table[k + 5] + (src.position[i * 3 + 2] - table[k + 2]) * table[k + 6];
      return Math.min(1, Math.max(0, d / (ext.get(l) || 1)));
    };
    if (choice === 'height') out[i] = hi > lo ? (src.position[i * 3 + 1] - lo) / (hi - lo) : 0;
    else if (choice === 'branch') out[i] = leaf ? (l < 0 ? 0 : table[k + 12]) : along();
    else if (choice === 'leaf') out[i] = leaf ? along() : 0;
    else if (choice === 'random') out[i] = l < 0 ? 0 : hash(l, 77);
    else if (choice === 'bend') {
      if (l < 0) { out[i] = 0; continue; }
      // A leaf moves with the point of its branch it hangs on; a branch point by its depth plus how far out it is.
      const d = depthOf(table, l, depths);
      const t = leaf ? 1 : along();
      out[i] = Math.min(1, (d + t) / (maxDepth + 1));
    }
  }
  return out;
}

// The two extra UV sets the Canopy Bridge add-on reads in Blender: CanopyWind (flutter, phase) and CanopyBend
// (bend, 1 on leaves), so the vertex colors keep the plant's own colors.
export function blenderUvs(src, ctx) {
  const [fl, ph, bend] = ['leaf', 'random', 'bend'].map((c) => gradient(src, c, ctx));
  const n = fl.length; const wind = new Float32Array(n * 2); const bnd = new Float32Array(n * 2);
  const leaf = src.kind === 'leaf' ? 1 : 0;
  for (let i = 0; i < n; i++) { wind[i * 2] = fl[i]; wind[i * 2 + 1] = ph[i]; bnd[i * 2] = bend[i]; bnd[i * 2 + 1] = leaf; }
  return [wind, bnd];
}
export const BLENDER_UVS = ['CanopyWind', 'CanopyBend'];

// RGBA per point: each channel either keeps the mesh's own color (alpha 1) or carries a wind gradient.
export function windColors(src, channels, ctx) {
  const n = src.position.length / 3; const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = src.color[i * 3]; out[i * 4 + 1] = src.color[i * 3 + 1]; out[i * 4 + 2] = src.color[i * 3 + 2]; out[i * 4 + 3] = 1; }
  channels.forEach((choice, ch) => {
    if (!choice || choice === 'none') return;
    const g = gradient(src, choice, ctx);
    for (let i = 0; i < n; i++) out[i * 4 + ch] = g[i];
  });
  return out;
}

// Pivot Painter 2 elements: one per line, in line order. Pivot and X axis in Unreal's axes, the parent as an element
// index (a root is its own parent, as Pivot Painter expects), and the length along X.
export function pivotElements(srcs, table) {
  const used = new Set();
  for (const s of srcs) for (let i = 0; i < s.position.length / 3; i++) { const l = lineOf(s, i); if (l >= 0) used.add(l); }
  const lines = [...used].sort((a, b) => a - b);
  const index = new Map(lines.map((l, i) => [l, i]));
  const ext = lineExtents(srcs, table);
  const elements = lines.map((l, i) => {
    const k = l * WIND_STRIDE; let parent = Math.round(table[k + 3]);
    while (parent >= 0 && !index.has(parent)) parent = Math.round(table[parent * WIND_STRIDE + 3]);
    return { line: l, pivot: toUnreal([table[k], table[k + 1], table[k + 2]]), x: toUnreal([table[k + 4], table[k + 5], table[k + 6]]), parent: parent >= 0 ? index.get(parent) : i, extent: ext.get(l) || 0 };
  });
  const w = Math.max(1, Math.ceil(Math.sqrt(elements.length))); const h = Math.max(1, Math.ceil(elements.length / w));
  return { elements, index, w, h };
}

// The two Pivot Painter 2 textures as float RGBA: pivot position + parent index (stored as the integer's bits read as
// a float, Pivot Painter's "int as float"), and X axis (0..1) + X extent / 2048.
export function pivotTextures({ elements, w, h }) {
  const pos = new Float32Array(w * h * 4); const xv = new Float32Array(w * h * 4);
  const bits = new DataView(new ArrayBuffer(4));
  elements.forEach((e, i) => {
    pos.set(e.pivot, i * 4); bits.setInt32(0, e.parent, true); pos[i * 4 + 3] = bits.getFloat32(0, true);
    xv.set(e.x.map((v) => v * 0.5 + 0.5), i * 4); xv[i * 4 + 3] = e.extent / 2048;
  });
  return { pos, xv };
}

// Each point's element as a texture coordinate pointing at its pixel, for the second UV set.
export function pivotUvs(src, { index, w, h }) {
  const n = src.position.length / 3; const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const e = index.get(lineOf(src, i)) ?? 0;
    uv[i * 2] = ((e % w) + 0.5) / w; uv[i * 2 + 1] = 1 - (Math.floor(e / w) + 0.5) / h;
  }
  return uv;
}

const turn = (v, ax, a) => {
  const c = Math.cos(a); const s = Math.sin(a); const d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2];
  const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
  return [v[0] * c + cr[0] * s + ax[0] * d * (1 - c), v[1] * c + cr[1] * s + ax[1] * d * (1 - c), v[2] * c + cr[2] * s + ax[2] * d * (1 - c)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// The viewport's wind bend for one point at one moment, the same steps its vertex shader takes.
export function windPoint(p, wind, table, time, windS, dir) {
  let i = Math.round(wind[0]); let w = wind[1]; let fl = wind[2];
  p = [...p];
  for (let lv = 0; lv < 10 && i >= 0; lv++) {
    const k = i * WIND_STRIDE;
    const A = [table[k], table[k + 1], table[k + 2]]; const B = [table[k + 4], table[k + 5], table[k + 6]];
    const C = [table[k + 8], table[k + 9], table[k + 10], table[k + 11]];
    const ph = C[2] + (A[0] * dir[0] + A[1] * dir[1] + A[2] * dir[2]) * 0.004;
    const t = time * C[1] + ph;
    const around = (ax, a) => { const r = turn([p[0] - A[0], p[1] - A[1], p[2] - A[2]], ax, a); p = [A[0] + r[0], A[1] + r[1], A[2] + r[2]]; };
    if (fl > 0 && C[3] > 0) around(B, windS * C[3] * fl * Math.sin(time * (5 + C[1]) + ph * 3) * 0.9);
    const amt = windS * C[0] * w;
    if (amt) {
      let ax = cross(B, dir); const l = Math.hypot(...ax); const lean = l > 0.05;
      ax = lean ? [ax[0] / l, ax[1] / l, ax[2] / l] : unit(cross(B, [0.31, 0.87, 0.38]));
      around(ax, amt * ((lean ? 0.7 : 0) + 0.3 * Math.sin(t) + 0.08 * Math.sin(t * 2.1 + 1.1)));
      around(unit(cross(B, ax)), amt * 0.12 * Math.sin(t * 0.73 + 2));
    }
    w = table[k + 7];
    fl = Math.min(1, table[k + 12] * 1.6);
    i = Math.round(table[k + 3]);
  }
  return p;
}

// A vertex animation texture: each frame's offset from rest per point, `w` points to a row and as many rows per frame
// as it takes, frames stacked downward. uv points at each point's pixel in the first frame.
export function bakeVat(src, table, { frames = 30, seconds = 2, windS = 0.15, dir = [1, 0, 0], speed = 1 } = {}) {
  const n = src.position.length / 3;
  const w = Math.min(8192, Math.max(1, n)); const rows = Math.ceil(n / w); const h = rows * frames;
  const data = new Float32Array(w * h * 4);
  let lo = Infinity; let hi = -Infinity;
  for (let f = 0; f < frames; f++) {
    const time = (f / frames) * seconds * speed;
    for (let i = 0; i < n; i++) {
      const p0 = [src.position[i * 3], src.position[i * 3 + 1], src.position[i * 3 + 2]];
      const p = src.wind ? windPoint(p0, [src.wind[i * 3], src.wind[i * 3 + 1], src.wind[i * 3 + 2]], table, time, windS, dir) : p0;
      const at = ((f * rows + Math.floor(i / w)) * w + (i % w)) * 4;
      for (let s = 0; s < 3; s++) { const d = p[s] - p0[s]; data[at + s] = d; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      data[at + 3] = 1;
    }
  }
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = ((i % w) + 0.5) / w; uv[i * 2 + 1] = 1 - (Math.floor(i / w) + 0.5) / h; }
  return { data, w, h, rows, frames, uv, range: [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0] };
}

// A mesh cut into its pieces, one per line, each with its own points and triangles.
// A triangle goes with its first corner's line; a corner from another line (where a branch blends in) is copied in.
export function piecesOf(src) {
  const groups = new Map();
  for (let t = 0; t < src.index.length; t += 3) {
    const l = lineOf(src, src.index[t]);
    let g = groups.get(l);
    if (!g) { g = { line: l, verts: [], at: new Map(), tris: [] }; groups.set(l, g); }
    for (let e = 0; e < 3; e++) {
      const v = src.index[t + e];
      if (!g.at.has(v)) { g.at.set(v, g.verts.length); g.verts.push(v); }
      g.tris.push(g.at.get(v));
    }
  }
  return [...groups.values()].map((g) => ({ line: g.line, verts: g.verts, index: Uint32Array.from(g.tris) }));
}

// The arrays of a mesh kept only at the given points.
export function pick(arr, size, verts) {
  const out = new arr.constructor(verts.length * size);
  verts.forEach((v, j) => { for (let s = 0; s < size; s++) out[j * size + s] = arr[v * size + s]; });
  return out;
}
