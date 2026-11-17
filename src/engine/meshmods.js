// Modifiers that act on a finished tube or leaf mesh, after the lines have been wrapped.
import { computeNormals, softNoise } from './primitive.js';
import { bakeCurve, sampleCurve } from './math.js';
import { facesOf } from '../app/quads.js';
import { projectMesh } from './project.js';

const CH = { R: 0, G: 1, B: 2, A: 3 };

function sample(img, u, v, ch) {
  const x = ((Math.floor(u * img.width) % img.width) + img.width) % img.width;
  const y = ((Math.floor((1 - v) * img.height) % img.height) + img.height) % img.height;
  return img.data[(y * img.width + x) * 4 + ch] / 255;
}

// Relaxes points toward the middle of their neighbours. Welded copies (a UV seam) relax as one point and land on the same spot.
function smooth(V, I, strength, passes, W) {
  const n = V.length / 3; const { id, count, first } = W;
  for (let p = 0; p < passes; p++) {
    const sum = new Float64Array(count * 3); const cnt = new Float64Array(count);
    for (let i = 0; i < I.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = I[i + e]; const b = I[i + (e + 1) % 3]; const ga = id[a]; const gb = id[b];
        for (let k = 0; k < 3; k++) { sum[ga * 3 + k] += V[b * 3 + k]; sum[gb * 3 + k] += V[a * 3 + k]; }
        cnt[ga]++; cnt[gb]++;
      }
    }
    for (let g = 0; g < count; g++) if (cnt[g]) for (let k = 0; k < 3; k++) { const r = first[g] * 3 + k; sum[g * 3 + k] = V[r] + (sum[g * 3 + k] / cnt[g] - V[r]) * strength; }
    for (let v = 0; v < n; v++) if (cnt[id[v]]) for (let k = 0; k < 3; k++) V[v * 3 + k] = sum[id[v] * 3 + k];
  }
}

const jitterAt = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return ((h >>> 0) / 4294967296) * 2 - 1; };

// Every per-point array of a mesh (position, normal, uv, colors, wind...) with how many numbers each point has.
const pointArrays = (m) => {
  const n = m.position.length / 3;
  return Object.keys(m).filter((k) => k !== 'index' && ArrayBuffer.isView(m[k]) && m[k].length % n === 0 && m[k].length >= n).map((k) => [k, m[k].length / n]);
};

// Normals from the triangles, shared where points meet but each point keeping the side it faced, so seams and
// two-sided leaves stay right.
function freshNormals(m) {
  const n = computeNormals(m.position, m.index);
  const old = m.normal;
  for (let i = 0; i < n.length; i += 3) if (n[i] * old[i] + n[i + 1] * old[i + 1] + n[i + 2] * old[i + 2] < 0) { n[i] = -n[i]; n[i + 1] = -n[i + 1]; n[i + 2] = -n[i + 2]; }
  m.normal = n;
}

// Points in the same place facing the same way count as one, so UV seams don't open up as borders; the back of a
// two-sided leaf (facing away) stays its own sheet. first[g] is the lowest point of weld group g.
export function weldIds(V, N) {
  const n = V.length / 3; const id = new Int32Array(n); const first = []; const byPos = new Map(); let count = 0;
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(V[v * 3] * 1e3)},${Math.round(V[v * 3 + 1] * 1e3)},${Math.round(V[v * 3 + 2] * 1e3)}`;
    let list = byPos.get(k);
    if (!list) byPos.set(k, (list = []));
    const hit = N ? list.find((u) => N[u * 3] * N[v * 3] + N[u * 3 + 1] * N[v * 3 + 1] + N[u * 3 + 2] * N[v * 3 + 2] > 0) : list[0];
    if (hit === undefined) { list.push(v); first.push(v); id[v] = count++; } else id[v] = id[hit];
  }
  return { id, count, first };
}

// Catmull-Clark style: each quad becomes four quads, each triangle (cutout fills, cap tips) four triangles, so a
// quad mesh stays quads. Smooth 0 keeps the shape exactly; 1 rounds it off. With Keep edges an open border keeps its shape.
export function subdivide(m, levels = 1, smooth = 1, keepEdges = true) {
  for (let l = 0; l < levels; l++) {
    const V = m.position; const nv = V.length / 3; const I = m.index;
    const { corners, sizes } = facesOf(I, m.quads ? new Uint8Array(I.length / 3).fill(1) : null, V);
    const { id: cid, count: nc } = weldIds(V, m.normal);
    const faces = []; for (let f = 0, at = 0; f < sizes.length; at += sizes[f++]) faces.push(corners.slice(at, at + sizes[f]));
    // New points: one per edge (per pair of real points, so each side of a seam keeps its own UVs), one per quad.
    const edgePt = new Map(); const made = []; // made: [list of source points] for each new point
    const edgeOf = (a, b) => { const k = a < b ? a * nv + b : b * nv + a; let e = edgePt.get(k); if (e === undefined) { e = nv + made.length; edgePt.set(k, e); made.push([a, b]); } return e; };
    const topo = new Map(); // welded edge -> faces using it
    const tkey = (a, b) => { const x = cid[a]; const y = cid[b]; return x < y ? x * nc + y : y * nc + x; };
    const centre = new Int32Array(faces.length).fill(-1);
    faces.forEach((f, fi) => {
      for (let i = 0; i < f.length; i++) {
        const a = f[i]; const b = f[(i + 1) % f.length]; edgeOf(a, b);
        const k = tkey(a, b); const list = topo.get(k); if (list) list.push(fi); else topo.set(k, [fi]);
      }
      if (f.length === 4) { centre[fi] = nv + made.length; made.push(f); }
    });
    const count = nv + made.length;
    for (const [k, size] of pointArrays(m)) {
      const src = m[k]; const dst = new src.constructor(count * size);
      dst.set(src);
      made.forEach((list, j) => {
        for (let s = 0; s < size; s++) {
          // A point's line number can't be averaged; it takes one end's.
          dst[(nv + j) * size + s] = k === 'wind' && s === 0 ? src[list[0] * size] : list.reduce((sum, v) => sum + src[v * size + s], 0) / list.length;
        }
      });
      m[k] = dst;
    }
    if (smooth > 0) {
      const P = m.position; const old = V;
      const fpt = faces.map((f) => [0, 1, 2].map((s) => f.reduce((sum, v) => sum + old[v * 3 + s], 0) / f.length));
      const target = new Float64Array(count * 3);
      for (let i = 0; i < count * 3; i++) target[i] = P[i];
      // Per welded point: its faces, its edges' midpoints, and its open-border neighbours.
      const fsum = new Float64Array(nc * 3); const fcnt = new Float64Array(nc); const esum = new Float64Array(nc * 3); const ecnt = new Float64Array(nc);
      const open = new Uint8Array(nc); const bsum = new Float64Array(nc * 3); const bcnt = new Float64Array(nc);
      const rep = new Int32Array(nc); for (let v = nv - 1; v >= 0; v--) rep[cid[v]] = v;
      faces.forEach((f, fi) => { for (const v of new Set(f.map((x) => cid[x]))) { for (let s = 0; s < 3; s++) fsum[v * 3 + s] += fpt[fi][s]; fcnt[v]++; } });
      const seenE = new Set();
      faces.forEach((f) => {
        for (let i = 0; i < f.length; i++) {
          const a = f[i]; const b = f[(i + 1) % f.length]; const k = tkey(a, b);
          const fl = topo.get(k); const e = edgePt.get(a < b ? a * nv + b : b * nv + a);
          for (let s = 0; s < 3; s++) {
            target[e * 3 + s] = fl.length === 2 ? (old[a * 3 + s] + old[b * 3 + s] + fpt[fl[0]][s] + fpt[fl[1]][s]) / 4 : (old[a * 3 + s] + old[b * 3 + s]) / 2;
          }
          if (seenE.has(k)) continue;
          seenE.add(k);
          const x = cid[a]; const y = cid[b];
          for (let s = 0; s < 3; s++) { const mid = (old[a * 3 + s] + old[b * 3 + s]) / 2; esum[x * 3 + s] += mid; esum[y * 3 + s] += mid; }
          ecnt[x]++; ecnt[y]++;
          if (fl.length !== 2) { open[x] = 1; open[y] = 1; for (let s = 0; s < 3; s++) { bsum[x * 3 + s] += old[b * 3 + s]; bsum[y * 3 + s] += old[a * 3 + s]; } bcnt[x]++; bcnt[y]++; }
        }
      });
      for (let v = 0; v < nv; v++) {
        const c = cid[v]; const n = ecnt[c];
        if (!n) continue;
        for (let s = 0; s < 3; s++) {
          const p = old[v * 3 + s];
          if (open[c]) target[v * 3 + s] = keepEdges || bcnt[c] !== 2 ? p : 0.75 * p + 0.125 * bsum[c * 3 + s];
          else target[v * 3 + s] = (fsum[c * 3 + s] / fcnt[c] + (2 * esum[c * 3 + s]) / n + (n - 3) * p) / n;
        }
      }
      for (let i = 0; i < count * 3; i++) P[i] += (target[i] - P[i]) * smooth;
    }
    // Quads first, as triangle pairs export joins back up; then the triangles' centres, an empty triangle (so the last
    // centre doesn't pair with a corner beside it), then the corners.
    const q = []; const tc = []; const tk = [];
    faces.forEach((f, fi) => {
      const e = f.map((v, i) => edgePt.get(v < f[(i + 1) % f.length] ? v * nv + f[(i + 1) % f.length] : f[(i + 1) % f.length] * nv + v));
      if (f.length === 4) {
        const c = centre[fi];
        for (const [a, b, cc, d] of [[f[0], e[0], c, e[3]], [e[0], f[1], e[1], c], [c, e[1], f[2], e[2]], [e[3], c, e[2], f[3]]]) q.push(a, b, cc, a, cc, d);
      } else {
        tc.push(e[0], e[1], e[2]);
        tk.push(f[0], e[0], e[2], e[0], f[1], e[1], e[2], e[1], f[2]);
      }
    });
    m.index = Uint32Array.from(tc.length && m.quads ? [...q, ...tc, tc[0], tc[0], tc[0], ...tk] : [...q, ...tc, ...tk]);
  }
  freshNormals(m);
}

const pieceRand = (p) => { const x = Math.sin((p + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };

// Each piece's length direction (its longest spread, base to tip by the wind weight), every point's place
// along it (0..1), and which border points lie on the sides: on edges running mostly along the length.
export function pieceAxes(V, members, piece, border, wind) {
  const along = new Float32Array(V.length / 3); const axes = [];
  for (const list of members) {
    const c = [0, 0, 0];
    for (const v of list) for (let s = 0; s < 3; s++) c[s] += V[v * 3 + s] / list.length;
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const v of list) { const d = [0, 1, 2].map((s) => V[v * 3 + s] - c[s]); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i * 3 + j] += d[i] * d[j]; }
    let a = [1, 0.7, 0.3];
    for (let it = 0; it < 24; it++) { const b = [0, 1, 2].map((i) => M[i * 3] * a[0] + M[i * 3 + 1] * a[1] + M[i * 3 + 2] * a[2]); const l = Math.hypot(...b) || 1; a = b.map((x) => x / l); }
    const proj = list.map((v) => (V[v * 3] - c[0]) * a[0] + (V[v * 3 + 1] - c[1]) * a[1] + (V[v * 3 + 2] - c[2]) * a[2]);
    if (wind) { let r = 0; list.forEach((v, i) => { r += proj[i] * wind[v * 3 + 1]; }); if (r < 0) { a = a.map((x) => -x); for (let i = 0; i < proj.length; i++) proj[i] = -proj[i]; } }
    const lo = Math.min(...proj); const span = Math.max(...proj) - lo || 1;
    list.forEach((v, i) => { along[v] = (proj[i] - lo) / span; });
    axes.push(a);
  }
  const side = new Set(); const anyBorder = new Set(); const hasSide = new Set();
  for (const u of border) {
    const a = axes[piece[u.a]];
    const d = [0, 1, 2].map((s) => V[u.b * 3 + s] - V[u.a * 3 + s]);
    const l = Math.hypot(...d) || 1;
    anyBorder.add(u.a); anyBorder.add(u.b);
    if (Math.abs((d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / l) > 0.5) { side.add(u.a); side.add(u.b); hasSide.add(piece[u.a]); }
  }
  // A piece with no edge along its length (a round one) is measured from its whole border.
  for (const v of anyBorder) if (!hasSide.has(piece[v])) side.add(v);
  return { side, along, axes };
}

const smoothstep = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// Each point's place across its piece, 0 at either side and 1 in the middle, as if the piece were a card with
// rows along its length: measured side to side within its slice of the length (the slices beside it lend their
// width, so a lone tip point isn't its own slice). half is each piece's widest half-width.
export function acrossOf(V, N, members, along, axes) {
  const B = 16; const u = new Float32Array(V.length / 3).fill(1); const half = [];
  members.forEach((list, p) => {
    const n = [0, 0, 0];
    for (const v of list) for (let s = 0; s < 3; s++) n[s] += N[v * 3 + s];
    const a = axes[p];
    let w = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    let l = Math.hypot(...w);
    if (l < 1e-9) { w = Math.abs(a[1]) < 0.9 ? [a[2], 0, -a[0]] : [0, -a[2], a[1]]; l = Math.hypot(...w) || 1; }
    w = w.map((x) => x / l);
    const lo = new Float64Array(B).fill(Infinity); const hi = new Float64Array(B).fill(-Infinity);
    const bin = (v) => Math.min(B - 1, Math.floor(along[v] * B));
    const xs = list.map((v) => V[v * 3] * w[0] + V[v * 3 + 1] * w[1] + V[v * 3 + 2] * w[2]);
    list.forEach((v, i) => { const b = bin(v); lo[b] = Math.min(lo[b], xs[i]); hi[b] = Math.max(hi[b], xs[i]); });
    let widest = 0;
    list.forEach((v, i) => {
      const b = bin(v); let a0 = Infinity; let a1 = -Infinity;
      for (let k = Math.max(0, b - 1); k <= Math.min(B - 1, b + 1); k++) { a0 = Math.min(a0, lo[k]); a1 = Math.max(a1, hi[k]); }
      if (a1 - a0 > 1e-6) u[v] = Math.max(0, Math.min(1, 1 - Math.abs((2 * (xs[i] - a0)) / (a1 - a0) - 1)));
      widest = Math.max(widest, (a1 - a0) / 2);
    });
    half.push(widest);
  });
  return { u, half };
}

// Shortest distance over the mesh's edges from any of the seed points (Dijkstra).
export function edgeDistance(V, ring, seeds) {
  const n = V.length / 3; const dist = new Float64Array(n).fill(Infinity);
  const heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const v of seeds) { dist[v] = 0; push(0, v); }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const u of ring[v]) {
      const nd = d + Math.hypot(V[u * 3] - V[v * 3], V[u * 3 + 1] - V[v * 3 + 1], V[u * 3 + 2] - V[v * 3 + 2]);
      if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
    }
  }
  return dist;
}

// Gives a sheet a back and sides. Each piece is as thick as `amount` times its own width (1 = as thick as wide).
// The Profile curve shapes it by depth (0 at the outline, 1 deepest in); Edge pinch thins only the outline's points,
// along the length by `pinchCurve` and per piece by `pinchVary` (a share, 0..1). Both sides moves half each way. amountCurve and amountVary shape the thickness along each piece and per piece.
export function thicken(m, { amount = 0.1, pinch = 0.5, profile = null, both = true, pinchCurve = null, pinchVary = 0, measure = 'outline', sidePinch = 0, sideWidth = 0.35, upper = null, lower = null, amountCurve = null, amountVary = 0 } = {}) {
  const nv = m.position.length / 3; const I = m.index;
  const V0 = m.position;
  // A UV seam's copies count as one point (the first of each weld group), so the seam is no border and never opens.
  const { id: wid, first } = weldIds(V0, m.normal); const R = (v) => first[wid[v]];
  const uses = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = R(I[t + e]); const b = R(I[t + ((e + 1) % 3)]);
      const k = a < b ? a * nv + b : b * nv + a;
      const u = uses.get(k);
      if (u) u.n++; else uses.set(k, { n: 1, a, b });
    }
  }
  const border = [...uses.values()].filter((u) => u.n === 1);
  const ring = Array.from({ length: nv }, () => []);
  for (const u of uses.values()) { ring[u.a].push(u.b); ring[u.b].push(u.a); }
  const piece = new Int32Array(nv).fill(-1); const members = [];
  for (let s = 0; s < nv; s++) {
    if (piece[s] >= 0 || R(s) !== s) continue;
    const id = members.length; const list = [s]; piece[s] = id;
    for (let q = 0; q < list.length; q++) for (const u of ring[list[q]]) if (piece[u] < 0) { piece[u] = id; list.push(u); }
    members.push(list);
  }
  const { along, axes } = pieceAxes(V0, members, piece, border, m.wind);
  const onRim = new Uint8Array(nv);
  for (const u of border) { onRim[u.a] = 1; onRim[u.b] = 1; }
  const dist = edgeDistance(V0, ring, [...onRim.keys()].filter((v) => onRim[v]));
  let widest = members.map((list) => list.reduce((w, v) => Math.max(w, dist[v]), 0));
  const table = bakeCurve(profile); const pinchT = pinchCurve ? bakeCurve(pinchCurve) : null;
  const upT = upper ? bakeCurve(upper) : null; const loT = lower ? bakeCurve(lower) : null;
  // Sides: each point's place across its piece (0 at a side, 1 in the middle), measured within its own slice
  // along the length, so the tip and base keep their thickness and only the side columns pinch.
  const across = measure === 'sides' ? acrossOf(V0, m.normal, members, along, axes) : null;
  if (across) widest = across.half;
  const sideK = (u) => (u >= sideWidth ? 1 : 1 - sidePinch * (1 - smoothstep(u / sideWidth)));
  // Only the outline's own points are pinched; every point inside keeps the full thickness (shaped by the profile).
  const factor = (v) => {
    const p = piece[v]; const deep = widest[p];
    const d = across ? across.u[v] : !deep || !Number.isFinite(dist[v]) ? 1 : Math.min(1, dist[v] / deep);
    let k = 0;
    if (onRim[v]) {
      k = pinch * (pinchT ? sampleCurve(pinchT, along[v]) : 1);
      if (pinchVary) k *= 1 + pinchVary * (pieceRand(p) * 2 - 1);
    }
    return sampleCurve(table, d) * (1 - Math.min(1, Math.max(0, k))) * deep * 2 * (across ? sideK(d) : 1);
  };
  const depthOf = (v) => (across ? across.u[v] : Math.min(1, Number.isFinite(dist[v]) && widest[piece[v]] ? dist[v] / widest[piece[v]] : 1));
  const amtT = amountCurve ? bakeCurve(amountCurve) : null;
  const amt = (v) => amount * (amtT ? sampleCurve(amtT, along[v]) : 1) * (amountVary ? Math.max(0, 1 + amountVary * (pieceRand(piece[v] + 101) * 2 - 1)) : 1);
  // The front and back faces each follow their own profile across.
  const faceK = (v, side) => { const T = side > 0 ? upT : loT; return T ? sampleCurve(T, depthOf(v)) : 1; };
  const front = both ? 0.5 : 0; const back = both ? -0.5 : -1;
  const count = nv * 2 + border.length * 4;
  const out = {};
  for (const [k, size] of pointArrays(m)) {
    const src = m[k]; const dst = new src.constructor(count * size);
    dst.set(src); dst.set(src, nv * size);
    border.forEach((u, i) => { for (const [j, v] of [[0, u.a], [1, u.b], [2, u.a], [3, u.b]]) for (let s = 0; s < size; s++) dst[(nv * 2 + i * 4 + j) * size + s] = src[v * size + s]; });
    out[k] = dst;
  }
  const P = out.position; const N = out.normal; const N0 = m.normal;
  for (let v = 0; v < nv; v++) {
    const r = R(v);
    const f = factor(r) * amt(r);
    const fF = f * front * faceK(r, 1); const fB = f * back * faceK(r, -1);
    for (let s = 0; s < 3; s++) {
      P[v * 3 + s] = V0[r * 3 + s] + N0[r * 3 + s] * fF;
      P[(nv + v) * 3 + s] = V0[r * 3 + s] + N0[r * 3 + s] * fB;
      N[(nv + v) * 3 + s] = -N0[v * 3 + s];
    }
  }
  const idx = new Uint32Array(I.length * 2 + border.length * 6);
  idx.set(I);
  for (let t = 0; t < I.length; t += 3) idx.set([I[t] + nv, I[t + 2] + nv, I[t + 1] + nv], I.length + t);
  border.forEach((u, i) => {
    // The edge's direction as its own triangle runs it, so the wall faces outward.
    let a = u.a; let b = u.b;
    for (let t = 0; t < I.length; t += 3) {
      const tri = [R(I[t]), R(I[t + 1]), R(I[t + 2])];
      const at = tri.indexOf(u.a);
      if (at >= 0 && tri.includes(u.b)) { if (tri[(at + 1) % 3] !== u.b) { a = u.b; b = u.a; } break; }
    }
    const w = nv * 2 + i * 4;
    const fa = w + (a === u.a ? 0 : 1); const fb = w + (a === u.a ? 1 : 0); const ba = fa + 2; const bb = fb + 2;
    for (const [j, v, side] of [[fa, a, front], [fb, b, front], [ba, a, back], [bb, b, back]]) {
      const f = factor(v) * amt(v) * side * faceK(v, side === back ? -1 : 1);
      for (let s = 0; s < 3; s++) P[j * 3 + s] = m.position[v * 3 + s] + N0[v * 3 + s] * f;
    }
    // A flat face: its normal from its own corners.
    const e1 = [0, 1, 2].map((s) => P[ba * 3 + s] - P[fa * 3 + s]); const e2 = [0, 1, 2].map((s) => P[bb * 3 + s] - P[fa * 3 + s]);
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
    for (const j of [fa, fb, ba, bb]) N.set(n, j * 3);
    idx.set([fa, ba, bb, fa, bb, fb], I.length * 2 + i * 6);
  });
  Object.assign(m, out);
  m.index = idx;
}

// Keeps only the points the index uses, in order, with every per-point array.
function compact(m, rep) {
  const n = m.position.length / 3; const I = m.index;
  const to = new Int32Array(n).fill(-1); let count = 0;
  for (let i = 0; i < I.length; i++) { const r = rep[I[i]]; if (to[r] < 0) to[r] = count++; }
  const list = new Int32Array(count); for (let v = 0; v < n; v++) if (to[v] >= 0) list[to[v]] = v;
  for (const [k, size] of pointArrays(m)) {
    const src = m[k]; const dst = new src.constructor(count * size);
    for (let j = 0; j < count; j++) for (let s = 0; s < size; s++) dst[j * size + s] = src[list[j] * size + s];
    m[k] = dst;
  }
  m.index = I.map((v) => to[rep[v]]);
}

// Welds points closer than `dist`. Points that meet keep their own UVs when they differ (a seam) and stay apart
// when they face away from each other (the two sides of a leaf), but all move to the same place, so no crack shows.
export function weld(m, dist = 0.1, seams = true) {
  const V = m.position; const N = m.normal; const UV = m.uv; const n = V.length / 3;
  const d = Math.max(1e-6, dist); const d2 = d * d;
  const up = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; };
  const grid = new Map(); const cell = (x) => Math.floor(x / d);
  for (let v = 0; v < n; v++) {
    const cx = cell(V[v * 3]); const cy = cell(V[v * 3 + 1]); const cz = cell(V[v * 3 + 2]);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) for (let c = cz - 1; c <= cz + 1; c++) {
      const list = grid.get(`${a},${b},${c}`);
      if (list) for (const u of list) if ((V[u * 3] - V[v * 3]) ** 2 + (V[u * 3 + 1] - V[v * 3 + 1]) ** 2 + (V[u * 3 + 2] - V[v * 3 + 2]) ** 2 <= d2) up[find(u)] = find(v);
    }
    const k = `${cx},${cy},${cz}`; const list = grid.get(k); if (list) list.push(v); else grid.set(k, [v]);
  }
  const groups = new Map();
  for (let v = 0; v < n; v++) { const r = find(v); const g = groups.get(r); if (g) g.push(v); else groups.set(r, [v]); }
  const rep = Int32Array.from({ length: n }, (_, i) => i);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const c = [0, 1, 2].map((s) => g.reduce((sum, v) => sum + V[v * 3 + s], 0) / g.length);
    const heads = [];
    for (const v of g) {
      V[v * 3] = c[0]; V[v * 3 + 1] = c[1]; V[v * 3 + 2] = c[2];
      const h = heads.find((u) => (!N || N[u * 3] * N[v * 3] + N[u * 3 + 1] * N[v * 3 + 1] + N[u * 3 + 2] * N[v * 3 + 2] > 0)
        && (!seams || !UV || (Math.abs(UV[u * 2] - UV[v * 2]) < 1e-3 && Math.abs(UV[u * 2 + 1] - UV[v * 2 + 1]) < 1e-3)));
      if (h === undefined) heads.push(v); else rep[v] = h;
    }
  }
  const I = m.index;
  if (!m.quads) {
    // Collapsed triangles go; in a quad mesh they stay (drawn as nothing) so the triangle pairs keep lining up.
    const keep = [];
    for (let t = 0; t < I.length; t += 3) { const a = rep[I[t]]; const b = rep[I[t + 1]]; const c = rep[I[t + 2]]; if (a !== b && b !== c && a !== c) keep.push(I[t], I[t + 1], I[t + 2]); }
    m.index = Uint32Array.from(keep);
  }
  compact(m, rep);
  if (m.index.length) freshNormals(m);
}

// Closest point on triangle abc to p (Ericson), as barycentric weights; out = [wa, wb, wc, distance²].
function closestOnTri(px, py, pz, V, a, b, c, out) {
  const ax = V[a * 3]; const ay = V[a * 3 + 1]; const az = V[a * 3 + 2];
  const abx = V[b * 3] - ax; const aby = V[b * 3 + 1] - ay; const abz = V[b * 3 + 2] - az;
  const acx = V[c * 3] - ax; const acy = V[c * 3 + 1] - ay; const acz = V[c * 3 + 2] - az;
  const apx = px - ax; const apy = py - ay; const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz; const d2 = acx * apx + acy * apy + acz * apz;
  let u; let v; let w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; } else {
    const bpx = px - V[b * 3]; const bpy = py - V[b * 3 + 1]; const bpz = pz - V[b * 3 + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz; const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - V[c * 3]; const cpy = py - V[c * 3 + 1]; const cpz = pz - V[c * 3 + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz; const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2; const vb = d5 * d2 - d1 * d6; const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3 || 1); u = 1 - t; v = t; w = 0; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6 || 1); u = 1 - t; v = 0; w = t; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + d5 - d6 || 1); u = 0; v = 1 - t; w = t; }
    else { const s = 1 / (va + vb + vc || 1); v = vb * s; w = vc * s; u = 1 - v - w; }
  }
  const qx = ax + abx * v + acx * w; const qy = ay + aby * v + acy * w; const qz = az + abz * v + acz * w;
  out[0] = u; out[1] = v; out[2] = w; out[3] = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  return out;
}

// Barycentric weights of p projected on triangle abc's plane, not clamped to the triangle (for running UVs on past it).
function planeBary(px, py, pz, V, a, b, c) {
  const e0 = [0, 1, 2].map((s) => V[b * 3 + s] - V[a * 3 + s]); const e1 = [0, 1, 2].map((s) => V[c * 3 + s] - V[a * 3 + s]);
  const e2 = [px - V[a * 3], py - V[a * 3 + 1], pz - V[a * 3 + 2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d00 = dot(e0, e0); const d01 = dot(e0, e1); const d11 = dot(e1, e1); const d20 = dot(e2, e0); const d21 = dot(e2, e1);
  const den = d00 * d11 - d01 * d01 || 1;
  const v = (d11 * d20 - d01 * d21) / den; const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

// Rebuilds the whole mesh as one closed surface from a voxel grid (surface nets), so parts that touch or overlap
// blend into one. `res` is the number of cells along the longest side. Every per-point array (UVs, colors, wind)
// is carried over from the nearest source triangle; where a new face would straddle a UV seam its corners take
// the UVs of the face middle's triangle instead. snap pulls the new surface back toward the source (0..1).
export function remesh(m, { res = 64, quads = true, snap = 0.5 } = {}) {
  const V = m.position; const I = m.index; const nt = I.length / 3;
  if (!nt) return;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < I.length; i++) for (let s = 0; s < 3; s++) { const x = V[I[i] * 3 + s]; if (x < lo[s]) lo[s] = x; if (x > hi[s]) hi[s] = x; }
  const ext = [0, 1, 2].map((s) => hi[s] - lo[s]);
  let h = Math.max(...ext, 1e-3) / Math.max(4, Math.min(256, Math.round(res)));
  let dims;
  for (;;) {
    const pad = 3;
    dims = ext.map((e) => Math.ceil(e / h) + 1 + pad * 2);
    if (dims[0] * dims[1] * dims[2] <= 6e6) break;
    h *= 1.15;
  }
  const [nx, ny, nz] = dims; const sxy = nx * ny; const total = nx * ny * nz;
  const org = lo.map((x) => x - 3 * h);
  const dist = new Float32Array(total).fill(Infinity); const near = new Int32Array(total).fill(-1);
  // A shell this far out keeps even a flat sheet (a leaf) a closed, hole-free slab.
  const isoD = h * 0.9; const band = isoD + h * 1.5; const out4 = new Float64Array(4);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3]; const b = I[t * 3 + 1]; const c = I[t * 3 + 2];
    const g0 = []; const g1 = [];
    for (let s = 0; s < 3; s++) {
      const mn = Math.min(V[a * 3 + s], V[b * 3 + s], V[c * 3 + s]) - band; const mx = Math.max(V[a * 3 + s], V[b * 3 + s], V[c * 3 + s]) + band;
      g0.push(Math.max(0, Math.ceil((mn - org[s]) / h))); g1.push(Math.min(dims[s] - 1, Math.floor((mx - org[s]) / h)));
    }
    for (let k = g0[2]; k <= g1[2]; k++) for (let j = g0[1]; j <= g1[1]; j++) for (let i = g0[0]; i <= g1[0]; i++) {
      const d = closestOnTri(org[0] + i * h, org[1] + j * h, org[2] + k * h, V, a, b, c, out4)[3];
      const at = i + j * nx + k * sxy;
      if (d < dist[at]) { dist[at] = d; near[at] = t; }
    }
  }
  // Outside is what the grid's border reaches without crossing the shell; everything else (a tube's hollow) is solid.
  const f = new Float32Array(total);
  for (let i = 0; i < total; i++) f[i] = Math.sqrt(dist[i]) - isoD;
  const outside = new Uint8Array(total); const queue = new Int32Array(total); let qh = 0; let qt = 0;
  outside[0] = 1; queue[qt++] = 0;
  while (qh < qt) {
    const v = queue[qh++]; const i = v % nx; const j = Math.floor(v / nx) % ny; const k = Math.floor(v / sxy);
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di; const b = j + dj; const c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const u = a + b * nx + c * sxy;
      if (!outside[u] && f[u] > 0) { outside[u] = 1; queue[qt++] = u; }
    }
  }
  for (let i = 0; i < total; i++) if (!outside[i] && f[i] > 0) f[i] = -h;
  // One point per cell the surface crosses, at the middle of its edges' crossings.
  const cellAt = new Int32Array(total).fill(-1); const P = [];
  const CE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = f[(i + (c & 1)) + (j + ((c >> 1) & 1)) * nx + (k + (c >> 2)) * sxy]; if (cv[c] < 0) neg++; }
    if (!neg || neg === 8) continue;
    let x = 0; let y = 0; let z = 0; let n = 0;
    for (const [p, q] of CE) {
      if ((cv[p] < 0) === (cv[q] < 0)) continue;
      const t = cv[p] / (cv[p] - cv[q]);
      x += (p & 1) + ((q & 1) - (p & 1)) * t; y += ((p >> 1) & 1) + (((q >> 1) & 1) - ((p >> 1) & 1)) * t; z += (p >> 2) + ((q >> 2) - (p >> 2)) * t; n++;
    }
    cellAt[i + j * nx + k * sxy] = P.length / 3;
    P.push(org[0] + (i + x / n) * h, org[1] + (j + y / n) * h, org[2] + (k + z / n) * h);
  }
  // A quad across every grid edge the surface crosses, from the four cells around it, facing outside.
  const quadsOut = [];
  const cellId = (i, j, k) => cellAt[i + j * nx + k * sxy];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v = i + j * nx + k * sxy; const inside = f[v] < 0;
    for (let ax = 0; ax < 3; ax++) {
      const u = v + (ax === 0 ? 1 : ax === 1 ? nx : sxy);
      if (inside === (f[u] < 0)) continue;
      let q;
      if (ax === 0) q = [cellId(i, j - 1, k - 1), cellId(i, j, k - 1), cellId(i, j, k), cellId(i, j - 1, k)];
      else if (ax === 1) q = [cellId(i - 1, j, k - 1), cellId(i - 1, j, k), cellId(i, j, k), cellId(i, j, k - 1)];
      else q = [cellId(i - 1, j - 1, k), cellId(i, j - 1, k), cellId(i, j, k), cellId(i - 1, j, k)];
      if (q.some((x) => x < 0)) continue;
      quadsOut.push(inside ? q : [q[3], q[2], q[1], q[0]]);
    }
  }
  // Each new point: its nearest source triangle (among those the voxels around it found) and its place on it.
  const np = P.length / 3; const tri = new Int32Array(np).fill(-1); const W = new Float32Array(np * 3);
  const cellOf = (x, s) => Math.max(0, Math.min(dims[s] - 2, Math.floor((x - org[s]) / h)));
  const nearestTri = (x, y, z) => {
    const i = cellOf(x, 0); const j = cellOf(y, 1); const k = cellOf(z, 2);
    let best = Infinity; let bt = -1; let bw = null;
    for (let c = 0; c < 27; c++) {
      const a = i + (c % 3) - 1; const b = j + (Math.floor(c / 3) % 3) - 1; const e = k + Math.floor(c / 9) - 1;
      if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue;
      const t = near[a + b * nx + e * sxy];
      if (t < 0) continue;
      const r = closestOnTri(x, y, z, V, I[t * 3], I[t * 3 + 1], I[t * 3 + 2], out4);
      if (r[3] < best) { best = r[3]; bt = t; bw = [r[0], r[1], r[2]]; }
    }
    return [bt, bw];
  };
  for (let p = 0; p < np; p++) {
    const [t, w] = nearestTri(P[p * 3], P[p * 3 + 1], P[p * 3 + 2]);
    if (t < 0) continue;
    tri[p] = t; W.set(w, p * 3);
    if (snap) for (let s = 0; s < 3; s++) { const q = w[0] * V[I[t * 3] * 3 + s] + w[1] * V[I[t * 3 + 1] * 3 + s] + w[2] * V[I[t * 3 + 2] * 3 + s]; P[p * 3 + s] += (q - P[p * 3 + s]) * snap * 0.9; }
  }
  const UV = m.uv;
  const uvAt = (t, w, s) => w[0] * UV[I[t * 3] * 2 + s] + w[1] * UV[I[t * 3 + 1] * 2 + s] + w[2] * UV[I[t * 3 + 2] * 2 + s];
  // Output points: [grid point, source triangle, weights]; a point keeps one entry unless a seam needs another.
  const outPts = []; const key = new Map();
  const addPt = (p, t, w, tag) => { const k = tag < 0 ? p : `${p}|${tag}`; let at = key.get(k); if (at === undefined) { at = outPts.length; key.set(k, at); outPts.push([p, t, w]); } return at; };
  const idx = [];
  for (const q of quadsOut) {
    let corners = q.map((p) => addPt(p, tri[p], [W[p * 3], W[p * 3 + 1], W[p * 3 + 2]], -1));
    if (UV) {
      const mid = [0, 1, 2].map((s) => q.reduce((sum, p) => sum + P[p * 3 + s], 0) / 4);
      const [tf] = nearestTri(mid[0], mid[1], mid[2]);
      if (tf >= 0) {
        let span = 0;
        for (let s = 0; s < 2; s++) { const xs = [0, 1, 2].map((c) => UV[I[tf * 3 + c] * 2 + s]); span = Math.max(span, Math.max(...xs) - Math.min(...xs)); }
        const tol = Math.max(0.05, span * 2);
        corners = q.map((p, c) => {
          if (tri[p] < 0) return corners[c];
          const w = [W[p * 3], W[p * 3 + 1], W[p * 3 + 2]];
          const e = planeBary(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], V, I[tf * 3], I[tf * 3 + 1], I[tf * 3 + 2]);
          const off = Math.max(Math.abs(uvAt(tri[p], w, 0) - uvAt(tf, e, 0)), Math.abs(uvAt(tri[p], w, 1) - uvAt(tf, e, 1)));
          return off > tol ? addPt(p, tf, e, tf) : corners[c];
        });
      }
    }
    idx.push(corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]);
  }
  const count = outPts.length;
  const arrays = pointArrays(m).filter(([k]) => k !== 'position' && k !== 'normal');
  const res2 = { position: new Float32Array(count * 3) };
  for (const [k, size] of arrays) res2[k] = new m[k].constructor(count * size);
  outPts.forEach(([p, t, w], o) => {
    for (let s = 0; s < 3; s++) res2.position[o * 3 + s] = P[p * 3 + s];
    if (t < 0) return;
    const c = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    const top = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
    for (const [k, size] of arrays) {
      const src = m[k]; const dst = res2[k];
      for (let s = 0; s < size; s++) {
        // A point's line number can't be blended; it takes the nearest corner's.
        dst[o * size + s] = k === 'wind' && s === 0 ? src[c[top] * size] : w[0] * src[c[0] * size + s] + w[1] * src[c[1] * size + s] + w[2] * src[c[2] * size + s];
      }
    }
  });
  Object.assign(m, res2);
  m.index = Uint32Array.from(idx);
  m.normal = computeNormals(m.position, m.index);
  m.quads = !!quads;
}

// The share of detail a part keeps at one LOD, from its LOD modifier: 1 at LOD0, down by Reduction % at the last
// LOD, following its curve (LOD0 on the left, the last LOD on the right). what: 'segments', 'sides' or 'leaves'.
const lodTables = new WeakMap();
export function lodShare(P, lod, lods = 4, what = null) {
  if (!lod || !P || (what && P[what] === false)) return 1;
  const t = lods > 1 ? Math.min(1, lod / (lods - 1)) : 1;
  const c = P.curves?.amount;
  let table = c ? lodTables.get(c) : null;
  if (c && !table) lodTables.set(c, (table = bakeCurve(c)));
  const r = (Math.max(0, Math.min(100, +(P.amount ?? 80))) / 100) * (table ? sampleCurve(table, t) : t);
  return Math.max(0.05, 1 - r);
}

// The enabled LOD modifier's settings in a stack, or null.
export const lodModOf = (mods) => (mods || []).find((x) => x.type === 'lod' && x.on !== false)?.params || null;

// Modifiers that rebuild the mesh's points and triangles rather than move them.
export const REBUILD = new Set(['subdivide', 'thickness', 'merge', 'remesh']);

export function applyMeshMods(m, mods, images, center = [0, 0, 0]) {
  const active = (mods || []).filter((x) => x.on !== false);
  if (!active.length) return;
  let V = m.position; let N = m.normal; let UV = m.uv;
  let moved = false; let W = null;
  // Built lazily, again after a rebuild: points that move must move their seam copies the same way.
  const welded = () => (W ||= weldIds(V, N));
  for (const mod of active) {
    const P = mod.params || {};
    let at = null;
    // These change the mesh's points and triangles, so the arrays are read again after them.
    if (REBUILD.has(mod.type)) {
      if (moved) { freshNormals(m); moved = false; }
      if (mod.type === 'subdivide') subdivide(m, Math.max(1, Math.min(3, Math.round(+P.levels || 1))), Math.min(1, Math.max(0, +(P.smooth ?? 1))), P.keepEdges !== false);
      else if (mod.type === 'merge') weld(m, Math.max(0, +(P.distance ?? 0.1)), P.seams !== false);
      else if (mod.type === 'remesh') remesh(m, { res: +P.resolution || 64, quads: P.quads !== false, snap: Math.min(1, Math.max(0, +(P.snap ?? 0.5))) });
      else {
        thicken(m, {
          amount: +(P.amount ?? 0.1), pinch: +(P.pinch ?? 0.5), profile: P.profile, both: P.both !== false, pinchCurve: P.curves?.pinch, pinchVary: varyShare(P, 'pinch', +(P.pinch ?? 0.5)),
          amountCurve: P.curves?.amount, amountVary: varyShare(P, 'amount', +(P.amount ?? 0.1)),
          // Modifiers saved before the side settings keep measuring from the outline.
          measure: P.measure || 'outline', sidePinch: +(P.sidePinch ?? 0), sideWidth: Math.max(0.01, +(P.sideWidth ?? 0.35)), upper: P.upper, lower: P.lower,
        });
      }
      V = m.position; N = m.normal; UV = m.uv; W = null;
      continue;
    }
    if (mod.type === 'noise' && (+P.amp || +P.vary?.amp)) {
      const s = Math.max(+P.scale || 30, 0.1); const amp = +P.amp * 2;
      // Variation (an amount of its own, in cm) per piece, and the curve from each piece's base to its tip.
      const vary = +P.vary?.amp || 0; const curve = P.curves?.amp ? bakeCurve(P.curves.amp) : null;
      const parts = vary || curve ? partsOf(m) : null;
      const per = parts && vary ? Array.from({ length: parts.count }, (_, p) => vary * 2 * (pieceRand(p) * 2 - 1)) : null;
      at = (i) => {
        let a = per ? amp + per[parts.id[i]] : amp;
        if (curve) a *= sampleCurve(curve, parts.along[i]);
        return softNoise(V[i * 3], V[i * 3 + 1], V[i * 3 + 2], s) * a;
      };
    } else if (mod.type === 'inflate' && +P.amount) {
      at = () => +P.amount;
    } else if (mod.type === 'wave' && +P.amp) {
      const w = Math.max(+P.length || 40, 0.1);
      at = (i) => Math.sin((V[i * 3 + 1] / w) * Math.PI * 2) * +P.amp;
    } else if (mod.type === 'jitter' && +P.amount) {
      at = (i) => jitterAt(i) * +P.amount;
    } else if (mod.type === 'ripple' && +P.amp) {
      const w = Math.max(+P.length || 60, 0.1);
      at = (i) => Math.sin((Math.hypot(V[i * 3] - center[0], V[i * 3 + 2] - center[2]) / w) * Math.PI * 2) * +P.amp;
    } else if (mod.type === 'smooth' && +P.strength) {
      smooth(V, m.index, Math.min(1, +P.strength), Math.max(1, Math.round(+P.passes || 1)), welded());
      moved = true;
      continue;
    } else if (mod.type === 'crumple') {
      if (crumple(m, P)) moved = true;
      continue;
    } else if (mod.type === 'displace' && +P.amount) {
      const img = images?.[P.texture];
      if (!img) continue;
      const ch = CH[P.channel] ?? 0; const tile = +P.tile || 1; const amt = +P.amount;
      at = (i) => (sample(img, UV[i * 2] * tile, UV[i * 2 + 1] * tile, ch) - 0.5) * amt * 2;
    }
    if (!at) continue;
    // Each weld group moves by its first point's amount along its normal, so seam copies stay together.
    const { id, first } = welded(); const d = first.map((r) => at(r));
    for (let i = V.length / 3 - 1; i >= 0; i--) {
      const g = id[i]; const r = first[g];
      for (let k = 0; k < 3; k++) V[i * 3 + k] = V[r * 3 + k] + N[r * 3 + k] * d[g];
    }
    moved = true;
  }
  if (moved) freshNormals(m);
}

// The texture names a graph's displacement modifiers need, so they can be read before the build starts.
export function displacementTextures(graph) {
  const names = new Set();
  for (const n of graph.nodes) for (const mod of n.params?.meshMods || []) {
    if (mod.type === 'displace' && mod.on !== false && mod.params?.texture) names.add(mod.params.texture);
  }
  return [...names];
}

// The separate parts of a mesh, one per line (a leaf, a branch's tube with its caps), by the line each point
// sways with; meshes without that fall back to connected triangles. along is each point's distance from its
// part's base (its stillest point in the wind), 0..1.
function partsOf(m) {
  const nv = m.position.length / 3; const V = m.position; const W = m.wind;
  const id = new Int32Array(nv);
  if (W && W.length >= nv * 3) {
    const map = new Map();
    for (let v = 0; v < nv; v++) { const k = W[v * 3]; let p = map.get(k); if (p === undefined) { p = map.size; map.set(k, p); } id[v] = p; }
  } else {
    const up = Int32Array.from({ length: nv }, (_, i) => i);
    const find = (x) => { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; };
    const I = m.index;
    for (let t = 0; t < I.length; t += 3) { const a = find(I[t]); up[find(I[t + 1])] = a; up[find(I[t + 2])] = a; }
    const map = new Map();
    for (let v = 0; v < nv; v++) { const r = find(v); let p = map.get(r); if (p === undefined) { p = map.size; map.set(r, p); } id[v] = p; }
  }
  const count = id.reduce((a, b) => Math.max(a, b + 1), 0);
  const base = new Int32Array(count).fill(-1);
  for (let v = 0; v < nv; v++) { const p = id[v]; if (base[p] < 0 || (W && W[v * 3 + 1] < W[base[p] * 3 + 1])) base[p] = v; }
  const d = new Float32Array(nv); const far = new Float32Array(count);
  for (let v = 0; v < nv; v++) { const b = base[id[v]]; d[v] = Math.hypot(V[v * 3] - V[b * 3], V[v * 3 + 1] - V[b * 3 + 1], V[v * 3 + 2] - V[b * 3 + 2]); far[id[v]] = Math.max(far[id[v]], d[v]); }
  for (let v = 0; v < nv; v++) d[v] = far[id[v]] > 0 ? d[v] / far[id[v]] : 0;
  return { id, count, along: d };
}

// Crumple: folds, curled corners and wrinkles on each leaf or card, growing from 0 at its base so the stem point
// stays put. Each point moves by its position alone, so points that share a place stay together.
// A modifier value's variation as a share of the value: Percent as it is, Absolute turned into the share it makes.
const varyShare = (P, k, base) => {
  const v = +P.vary?.[k] || 0;
  return P.varyMode?.[k] === 'abs' ? (Math.abs(base) > 1e-9 ? v / Math.abs(base) : 0) : v / 100;
};

export function crumple(m, P = {}) {
  const V = m.position; const N = m.normal; const W = m.wind; const nv = V.length / 3;
  const amount = +(P.amount ?? 0.5); const curl = +P.curl || 0; const wr = +P.wrinkle || 0; const ws = Math.max(0.1, +P.wrinkleScale || 2);
  const seed = Math.round(+P.seed || 0); const vary = varyShare(P, 'amount', +(P.amount ?? 0.5)); const curve = P.curves?.amount ? bakeCurve(P.curves.amount) : null;
  if (!nv || !(amount || vary || curl || wr)) return false;
  const wind = W && W.length >= nv * 3;
  // Without wind data, parts are joined across UV seams too (by place), so a seam cannot tear open.
  const { id, count } = wind ? partsOf(m) : partsOf({ position: V, index: Uint32Array.from([...m.index, ...seamTris(V)]) });
  const members = Array.from({ length: count }, () => []);
  for (let v = 0; v < nv; v++) members[id[v]].push(v);
  const rnd = (p, k) => pieceRand(p * 7.31 + k * 1.7 + seed * 13.1);
  const out = new Float64Array(V.length);
  members.forEach((list, p) => {
    // The base: every point as still in the wind as the stillest one (a card's whole bottom edge), else the first point.
    const w0 = wind ? Math.min(...list.map((v) => W[v * 3 + 1])) : 0;
    const baseList = wind ? list.filter((v) => W[v * 3 + 1] <= w0 + 1e-4) : [list[0]];
    const b = [0, 1, 2].map((s) => baseList.reduce((t, v) => t + V[v * 3 + s], 0) / baseList.length);
    const c = [0, 1, 2].map((s) => list.reduce((t, v) => t + V[v * 3 + s], 0) / list.length);
    let a = sub3(c, b); let l = Math.hypot(...a); if (l < 1e-9) return;
    a = a.map((x) => x / l);
    const n = [0, 0, 0]; const f = list[0];
    for (const v of list) { const sg = N[v * 3] * N[f * 3] + N[v * 3 + 1] * N[f * 3 + 1] + N[v * 3 + 2] * N[f * 3 + 2] < 0 ? -1 : 1; for (let s = 0; s < 3; s++) n[s] += N[v * 3 + s] * sg; }
    const dn = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    for (let s = 0; s < 3; s++) n[s] -= a[s] * dn;
    l = Math.hypot(...n); if (l < 1e-9) return;
    for (let s = 0; s < 3; s++) n[s] /= l;
    const side = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
    const rel = (v) => [V[v * 3] - b[0], V[v * 3 + 1] - b[1], V[v * 3 + 2] - b[2]];
    const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    let L = 0; let H = 0;
    for (const v of list) { const r = rel(v); L = Math.max(L, dot(r, a)); H = Math.max(H, Math.abs(dot(r, side))); }
    if (L < 1e-9) return;
    H = H || L;
    const amt = amount * (1 + vary * (rnd(p, 0) * 2 - 1));
    // Three creases at random angles and places; each folds the part beyond it up or down.
    const folds = [0, 1, 2].map((k) => { const th = rnd(p, k + 1) * Math.PI; return [Math.cos(th), Math.sin(th), 0.25 + rnd(p, k + 4) * 0.6, (rnd(p, k + 7) < 0.5 ? -1 : 1) * (0.5 + rnd(p, k + 10))]; });
    for (const v of list) {
      const r = rel(v); const s = Math.max(0, dot(r, a) / L); const x = dot(r, side) / H;
      const k = curve ? amt * sampleCurve(curve, Math.min(1, s)) : amt;
      let h = 0;
      for (const [cx, cy, o, g] of folds) h += g * Math.max(0, s * cx + x * cy * 0.5 - o);
      const up = (k * h * 0.5 + curl * x * x * (0.3 + 0.7 * s) * 0.3) * L * s + softNoise(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], ws, seed + 1) * wr * 2 * s;
      // A curled edge rolls in a little rather than stretching.
      const inward = -Math.abs(curl) * 0.15 * x * x * s * x * H;
      for (let q = 0; q < 3; q++) out[v * 3 + q] = n[q] * up + side[q] * inward;
    }
  });
  for (let i = 0; i < V.length; i++) V[i] += out[i];
  return true;
}
const sub3 = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
// Degenerate triangles tying each point to the first point in the same place, only to join parts.
function seamTris(V) {
  const { id } = weldIds(V); const first = new Map(); const out = [];
  for (let v = 0; v < V.length / 3; v++) {
    const u = first.get(id[v]);
    if (u === undefined) first.set(id[v], v); else out.push(u, v, v);
  }
  return out;
}

// The Avoid intersections modifier, run once every mesh is built. Push moves each point that comes within
// clearance + falloff of another part out along its own normal; Prune drops whole parts that touch one kept
// before them, so one of each touching pair stays. Points are compared with points.
// shortcut: point-to-point distance misses crossings between large triangles; sample the faces if that shows.
export function avoidMesh(m, meshes, P) {
  const D = Math.max(0.01, +(P.clearance ?? 2)); const F = Math.max(0, +(P.falloff ?? 4)); const R = D + (P.mode === 'prune' || P.mode === 'tilt' ? 0 : F);
  const skip = Math.min(1, Math.max(0, +(P.baseSkip ?? 10) / 100));
  const own = partsOf(m);
  const cell = (x) => Math.floor(x / R);
  const keyOf = (x, y, z) => (cell(x) * 73856093) ^ (cell(y) * 19349663) ^ (cell(z) * 83492791);
  const grid = new Map();
  const put = (x, y, z, tag) => { const k = keyOf(x, y, z); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(x, y, z, tag); };
  // Points over a mesh's surface, not just its corners: big triangles (cards, flat leaves, coarse tubes) get extra
  // points across them every half reach, so nothing slips through between far-apart vertices.
  const putSurface = (o, parts, tag) => {
    const V = o.position; const I = o.index; const step = R * 0.5;
    for (let v = 0; v < V.length / 3; v++) if (parts.along[v] >= skip) put(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], tag(v));
    if (!I) return;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
      if (parts.along[a] < skip && parts.along[b] < skip && parts.along[c] < skip) continue;
      const e = Math.max(Math.hypot(V[a * 3] - V[b * 3], V[a * 3 + 1] - V[b * 3 + 1], V[a * 3 + 2] - V[b * 3 + 2]), Math.hypot(V[a * 3] - V[c * 3], V[a * 3 + 1] - V[c * 3 + 1], V[a * 3 + 2] - V[c * 3 + 2]));
      const n = Math.min(24, Math.ceil(e / step));
      if (n < 2) continue;
      const g = tag(a);
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
        if ((i === 0 && j === 0) || (i === n) || (j === n)) continue;
        const u = i / n; const w = j / n; const k = 1 - u - w;
        put(V[a * 3] * k + V[b * 3] * u + V[c * 3] * w, V[a * 3 + 1] * k + V[b * 3 + 1] * u + V[c * 3 + 1] * w, V[a * 3 + 2] * k + V[b * 3 + 2] * u + V[c * 3 + 2] * w, g);
      }
    }
  };
  // Other meshes go in whole, tagged below zero; this mesh's parts by their own number.
  if (P.with !== 'same node') {
    meshes.forEach((o, mi) => { if (o !== m) putSurface(o, partsOf(o), () => -1 - mi); });
  }
  const mine = P.with !== 'other nodes';
  const V = m.position; const N = m.normal; const nv = V.length / 3;
  const nearest = (v) => nearestAt(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], own.id[v]);
  const nearestAt = (x, y, z, p) => {
    let best = R * R; let hit = -1; let hx = 0; let hy = 0; let hz = 0;
    const cx = cell(x); const cy = cell(y); const cz = cell(z);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) for (let c = cz - 1; c <= cz + 1; c++) {
      const list = grid.get((a * 73856093) ^ (b * 19349663) ^ (c * 83492791));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 4) {
        if (list[i + 3] === p) continue;
        const dd = (list[i] - x) ** 2 + (list[i + 1] - y) ** 2 + (list[i + 2] - z) ** 2;
        if (dd < best) { best = dd; hit = i; hx = list[i]; hy = list[i + 1]; hz = list[i + 2]; }
      }
    }
    return hit < 0 ? null : [hx, hy, hz, Math.sqrt(best)];
  };
  const members = Array.from({ length: own.count }, () => []);
  for (let v = 0; v < nv; v++) members[own.id[v]].push(v);
  // Tilt: each piece that touches one placed before it turns as a whole around its base (up or down, or rolled
  // about its length), or slides along its normal, by the smallest step that clears it. Sampled over its surface,
  // so a wide card or a thick leaf counts with its full size.
  function tiltParts() {
    const I = m.index; const S = Array.from({ length: own.count }, () => []); const step = D * 0.5;
    for (let v = 0; v < nv; v++) S[own.id[v]].push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], own.along[v]);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
      const e = Math.max(Math.hypot(V[a * 3] - V[b * 3], V[a * 3 + 1] - V[b * 3 + 1], V[a * 3 + 2] - V[b * 3 + 2]), Math.hypot(V[a * 3] - V[c * 3], V[a * 3 + 1] - V[c * 3 + 1], V[a * 3 + 2] - V[c * 3 + 2]));
      const n = Math.min(12, Math.ceil(e / step));
      if (n < 2) continue;
      const list = S[own.id[a]];
      for (let i = 1; i < n; i++) for (let j = 1; i + j < n; j++) {
        const u = i / n; const w = j / n; const k = 1 - u - w;
        list.push(...[0, 1, 2].map((s) => V[a * 3 + s] * k + V[b * 3 + s] * u + V[c * 3 + s] * w), own.along[a] * k + own.along[b] * u + own.along[c] * w);
      }
    }
    const maxA = (Math.min(90, Math.max(0, +(P.maxTilt ?? 30))) * Math.PI) / 180; const slide = Math.max(0, +(P.amount ?? 2));
    // How many of a piece's samples touch something; away sums which side of what they touch they are on.
    const hits = (pts, p, cap, n = null) => {
      let c = 0; let away = 0;
      for (let i = 0; i < pts.length; i += 4) {
        if (pts[i + 3] < skip) continue;
        const h = nearestAt(pts[i], pts[i + 1], pts[i + 2], p);
        if (!h || h[3] >= D) continue;
        if (n) away += (pts[i] - h[0]) * n[0] + (pts[i + 1] - h[1]) * n[1] + (pts[i + 2] - h[2]) * n[2];
        if (++c >= cap) break;
      }
      return [c, away];
    };
    const norm = (x) => { const l = Math.hypot(...x); return l > 1e-9 ? x.map((y) => y / l) : null; };
    // Turns (around `axis` through `o`) or slides (along `n`) one point; dir: true for a direction (no slide).
    // A slide fades from nothing at the base to full at the tip (by `al`, how far along), so the joint stays put.
    const move = (T, x, y, z, dir, al = 1) => {
      if (T.shift !== undefined) { const f = T.shift * Math.min(1, Math.max(0, (al - T.a0) / T.span)); return dir ? [x, y, z] : [x + T.n[0] * f, y + T.n[1] * f, z + T.n[2] * f]; }
      const k = T.axis; const c = Math.cos(T.ang); const s = Math.sin(T.ang);
      const v = dir ? [x, y, z] : [x - T.o[0], y - T.o[1], z - T.o[2]];
      const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
      const r = [0, 1, 2].map((i) => v[i] * c + (k[(i + 1) % 3] * v[(i + 2) % 3] - k[(i + 2) % 3] * v[(i + 1) % 3]) * s + k[i] * d * (1 - c));
      return dir ? r : [r[0] + T.o[0], r[1] + T.o[1], r[2] + T.o[2]];
    };
    const moved = (pts, T) => { const o = pts.slice(); for (let i = 0; i < o.length; i += 4) { const q = move(T, pts[i], pts[i + 1], pts[i + 2], false, pts[i + 3]); o[i] = q[0]; o[i + 1] = q[1]; o[i + 2] = q[2]; } return o; };
    let changed = 0;
    members.forEach((list, p) => {
      let pts = S[p];
      if (!list.length) return;
      let lo = list[0]; let hi = list[0]; const ns = [0, 0, 0];
      for (const v of list) { if (own.along[v] < own.along[lo]) lo = v; if (own.along[v] > own.along[hi]) hi = v; for (let s = 0; s < 3; s++) ns[s] += N[v * 3 + s]; }
      const n = norm(ns) || [0, 1, 0];
      let [best, away] = hits(pts, p, Infinity, n);
      if (best) {
        // Pivot at the middle of the base (every point near the lowest along), so a tube's ring or a card's edge
        // turns about its joint rather than about one corner.
        const a0 = own.along[lo]; const span = Math.max(1e-6, own.along[hi] - a0);
        const o = [0, 0, 0]; let nb = 0;
        for (const v of list) if (own.along[v] <= a0 + span * 0.02) { o[0] += V[v * 3]; o[1] += V[v * 3 + 1]; o[2] += V[v * 3 + 2]; nb++; }
        for (let s = 0; s < 3; s++) o[s] /= nb;
        const a = norm([V[hi * 3] - o[0], V[hi * 3 + 1] - o[1], V[hi * 3 + 2] - o[2]]) || (Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        const w = norm([a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]]) || [1, 0, 0];
        // Turning around w by a positive angle lifts the tip toward +n, so the first try goes the way it already leans.
        const s0 = away >= 0 ? 1 : -1;
        let pick = null;
        const tryT = (T) => { const c = hits(moved(pts, T), p, best)[0]; if (c < best) { best = c; pick = T; } };
        for (let k = 1; k <= 6 && best; k++) {
          if (maxA > 0) for (const [axis, sg] of [[w, s0], [w, -s0], [a, 1], [a, -1]]) if (best) tryT({ axis, o, ang: (sg * maxA * k) / 6 });
          if (slide > 0) for (const sg of [s0, -s0]) if (best) tryT({ shift: (sg * slide * k) / 6, n, a0, span });
        }
        if (pick) {
          for (const v of list) {
            const q = move(pick, V[v * 3], V[v * 3 + 1], V[v * 3 + 2], false, own.along[v]); const r = move(pick, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], true);
            for (let s = 0; s < 3; s++) { V[v * 3 + s] = q[s]; N[v * 3 + s] = r[s]; }
          }
          pts = moved(pts, pick); changed++;
        }
      }
      if (mine) for (let i = 0; i < pts.length; i += 4) if (pts[i + 3] >= skip) put(pts[i], pts[i + 1], pts[i + 2], p);
    });
    return changed;
  }
  if (P.mode === 'prune') {
    const dropped = new Uint8Array(own.count);
    members.forEach((list, p) => {
      if (list.some((v) => own.along[v] >= skip && nearest(v)?.[3] < D)) { dropped[p] = 1; return; }
      if (mine) for (const v of list) if (own.along[v] >= skip) put(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], p);
    });
    if (!dropped.some(Boolean)) return 0;
    const I = m.index; const keep = [];
    for (let t = 0; t < I.length; t += 3) if (!dropped[own.id[I[t]]]) keep.push(I[t], I[t + 1], I[t + 2]);
    m.index = new Uint32Array(keep);
    return dropped.reduce((a, b) => a + b, 0);
  }
  if (P.mode === 'tilt') return tiltParts();
  if (mine) putSurface(m, own, (v) => own.id[v]);
  const amount = Math.max(0, +(P.amount ?? 2));
  const move = new Float32Array(nv);
  let moved = 0;
  for (let v = 0; v < nv; v++) {
    if (own.along[v] < skip) continue;
    const h = nearest(v);
    if (!h) continue;
    const w = h[3] <= D ? 1 : F > 0 ? 1 - (h[3] - D) / F : 0;
    if (w <= 0) continue;
    const away = (V[v * 3] - h[0]) * N[v * 3] + (V[v * 3 + 1] - h[1]) * N[v * 3 + 1] + (V[v * 3 + 2] - h[2]) * N[v * 3 + 2];
    // At least out to the clearance when inside it, so a touching point really comes clear.
    move[v] = (away >= 0 ? 1 : -1) * Math.max(amount * w, h[3] < D ? D - h[3] : 0); moved++;
  }
  for (let v = 0; v < nv; v++) if (move[v]) for (let s = 0; s < 3; s++) V[v * 3 + s] += N[v * 3 + s] * move[v];
  if (moved) freshNormals(m);
  return moved;
}

// The Project modifier, run once every mesh is built: wraps this mesh onto the meshes of its target node.
export function projectOnto(m, meshes, P) {
  const targets = meshes.filter((o) => o !== m && o.nodeId === P.target);
  const moved = targets.length ? projectMesh(m, targets, P, partsOf(m)) : 0;
  if (moved) freshNormals(m);
  return moved;
}
