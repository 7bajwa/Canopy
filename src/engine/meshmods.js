// Modifiers that act on a finished tube or leaf mesh, after the lines have been wrapped.
import { computeNormals, softNoise } from './primitive.js';
import { bakeCurve, sampleCurve } from './math.js';

const CH = { R: 0, G: 1, B: 2, A: 3 };

function sample(img, u, v, ch) {
  const x = ((Math.floor(u * img.width) % img.width) + img.width) % img.width;
  const y = ((Math.floor((1 - v) * img.height) % img.height) + img.height) % img.height;
  return img.data[(y * img.width + x) * 4 + ch] / 255;
}

// Relaxes points toward the middle of their neighbours.
function smooth(V, I, strength, passes) {
  const n = V.length / 3;
  for (let p = 0; p < passes; p++) {
    const sum = new Float64Array(n * 3); const cnt = new Float64Array(n);
    for (let i = 0; i < I.length; i += 3) {
      for (let e = 0; e < 3; e++) {
        const a = I[i + e]; const b = I[i + (e + 1) % 3];
        for (let k = 0; k < 3; k++) { sum[a * 3 + k] += V[b * 3 + k]; sum[b * 3 + k] += V[a * 3 + k]; }
        cnt[a]++; cnt[b]++;
      }
    }
    for (let v = 0; v < n; v++) if (cnt[v]) for (let k = 0; k < 3; k++) V[v * 3 + k] += (sum[v * 3 + k] / cnt[v] - V[v * 3 + k]) * strength;
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

// Splits every triangle into four. Smooth moves points toward the average of their neighbours (Loop's rule);
// with Keep edges an open border keeps its shape.
export function subdivide(m, levels = 1, smooth = 1, keepEdges = true) {
  for (let l = 0; l < levels; l++) {
    const nv = m.position.length / 3; const I = m.index;
    const edges = new Map(); const mids = [];
    const mid = (a, b, c) => {
      const k = a < b ? a * nv + b : b * nv + a;
      let e = edges.get(k);
      if (!e) { e = { at: nv + mids.length, a, b, far: [] }; edges.set(k, e); mids.push(e); }
      e.far.push(c);
      return e.at;
    };
    const idx = new Uint32Array(I.length * 4);
    for (let t = 0, o = 0; t < I.length; t += 3) {
      const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
      const ab = mid(a, b, c); const bc = mid(b, c, a); const ca = mid(c, a, b);
      idx.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o); o += 12;
    }
    const count = nv + mids.length;
    for (const [k, size] of pointArrays(m)) {
      const src = m[k]; const dst = new src.constructor(count * size);
      dst.set(src);
      for (const e of mids) {
        for (let s = 0; s < size; s++) {
          // A point's line number can't be averaged; it takes one end's.
          dst[e.at * size + s] = k === 'wind' && s === 0 ? src[e.a * size] : (src[e.a * size + s] + src[e.b * size + s]) / 2;
        }
      }
      m[k] = dst;
    }
    if (smooth > 0) {
      const V = m.position; const old = V.slice(0, nv * 3);
      const ring = Array.from({ length: nv }, () => []); const edge = new Uint8Array(nv);
      for (const e of mids) { ring[e.a].push(e.b); ring[e.b].push(e.a); if (e.far.length === 1) { edge[e.a] = 1; edge[e.b] = 1; } }
      const target = new Float32Array(count * 3);
      for (let v = 0; v < nv; v++) {
        const r = ring[v]; const n = r.length;
        for (let s = 0; s < 3; s++) {
          let p = old[v * 3 + s];
          if (edge[v]) {
            if (!keepEdges) {
              const side = r.filter((u) => edge[u]).slice(0, 2);
              if (side.length === 2) p = 0.75 * p + 0.125 * (old[side[0] * 3 + s] + old[side[1] * 3 + s]);
            }
          } else if (n) {
            const beta = n > 3 ? 3 / (8 * n) : 3 / 16;
            p = (1 - n * beta) * p + beta * r.reduce((sum, u) => sum + old[u * 3 + s], 0);
          }
          target[v * 3 + s] = p;
        }
      }
      for (const e of mids) {
        for (let s = 0; s < 3; s++) {
          const pa = old[e.a * 3 + s]; const pb = old[e.b * 3 + s];
          target[e.at * 3 + s] = e.far.length === 2 ? 0.375 * (pa + pb) + 0.125 * (old[e.far[0] * 3 + s] + old[e.far[1] * 3 + s]) : (pa + pb) / 2;
        }
      }
      for (let i = 0; i < count * 3; i++) V[i] += (target[i] - V[i]) * smooth;
    }
    m.index = idx;
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
// along the length by `pinchCurve` and per piece by `pinchVary` (a share, 0..1). Both sides moves half each way.
export function thicken(m, { amount = 0.1, pinch = 0.5, profile = null, both = true, pinchCurve = null, pinchVary = 0, measure = 'outline', sidePinch = 0, sideWidth = 0.35, upper = null, lower = null } = {}) {
  const nv = m.position.length / 3; const I = m.index;
  const V0 = m.position;
  const uses = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e]; const b = I[t + ((e + 1) % 3)];
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
    if (piece[s] >= 0) continue;
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
    const f = factor(v) * amount;
    const fF = f * front * faceK(v, 1); const fB = f * back * faceK(v, -1);
    for (let s = 0; s < 3; s++) {
      P[v * 3 + s] += N0[v * 3 + s] * fF;
      P[(nv + v) * 3 + s] += N0[v * 3 + s] * fB;
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
      const tri = [I[t], I[t + 1], I[t + 2]];
      const at = tri.indexOf(u.a);
      if (at >= 0 && tri.includes(u.b)) { if (tri[(at + 1) % 3] !== u.b) { a = u.b; b = u.a; } break; }
    }
    const w = nv * 2 + i * 4;
    const fa = w + (a === u.a ? 0 : 1); const fb = w + (a === u.a ? 1 : 0); const ba = fa + 2; const bb = fb + 2;
    for (const [j, v, side] of [[fa, a, front], [fb, b, front], [ba, a, back], [bb, b, back]]) {
      const f = factor(v) * amount * side * faceK(v, side === back ? -1 : 1);
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

export function applyMeshMods(m, mods, images, center = [0, 0, 0]) {
  const active = (mods || []).filter((x) => x.on !== false);
  if (!active.length) return;
  let V = m.position; let N = m.normal; let UV = m.uv;
  let moved = false;
  for (const mod of active) {
    const P = mod.params || {};
    let at = null;
    // These two change the mesh's points and triangles, so the arrays are read again after them.
    if (mod.type === 'subdivide' || mod.type === 'thickness') {
      if (moved) { freshNormals(m); moved = false; }
      // Subdividing splits each quad's triangles apart, so they no longer pair up.
      if (mod.type === 'subdivide') delete m.quads;
      if (mod.type === 'subdivide') subdivide(m, Math.max(1, Math.min(3, Math.round(+P.levels || 1))), Math.min(1, Math.max(0, +(P.smooth ?? 1))), P.keepEdges !== false);
      else {
        thicken(m, {
          amount: +(P.amount ?? 0.1), pinch: +(P.pinch ?? 0.5), profile: P.profile, both: P.both !== false, pinchCurve: P.curves?.pinch, pinchVary: (+P.vary?.pinch || 0) / 100,
          // Modifiers saved before the side settings keep measuring from the outline.
          measure: P.measure || 'outline', sidePinch: +(P.sidePinch ?? 0), sideWidth: Math.max(0.01, +(P.sideWidth ?? 0.35)), upper: P.upper, lower: P.lower,
        });
      }
      V = m.position; N = m.normal; UV = m.uv;
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
      smooth(V, m.index, Math.min(1, +P.strength), Math.max(1, Math.round(+P.passes || 1)));
      moved = true;
      continue;
    } else if (mod.type === 'displace' && +P.amount) {
      const img = images?.[P.texture];
      if (!img) continue;
      const ch = CH[P.channel] ?? 0; const tile = +P.tile || 1; const amt = +P.amount;
      at = (i) => (sample(img, UV[i * 2] * tile, UV[i * 2 + 1] * tile, ch) - 0.5) * amt * 2;
    }
    if (!at) continue;
    for (let i = 0; i < V.length / 3; i++) {
      const d = at(i);
      V[i * 3] += N[i * 3] * d; V[i * 3 + 1] += N[i * 3 + 1] * d; V[i * 3 + 2] += N[i * 3 + 2] * d;
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

// The Avoid intersections modifier, run once every mesh is built. Push moves each point that comes within
// clearance + falloff of another part out along its own normal; Prune drops whole parts that touch one kept
// before them, so one of each touching pair stays. Points are compared with points.
// shortcut: point-to-point distance misses crossings between large triangles; sample the faces if that shows.
export function avoidMesh(m, meshes, P) {
  const D = Math.max(0.01, +(P.clearance ?? 2)); const F = Math.max(0, +(P.falloff ?? 4)); const R = D + (P.mode === 'prune' ? 0 : F);
  const skip = Math.min(1, Math.max(0, +(P.baseSkip ?? 10) / 100));
  const own = partsOf(m);
  const cell = (x) => Math.floor(x / R);
  const keyOf = (x, y, z) => (cell(x) * 73856093) ^ (cell(y) * 19349663) ^ (cell(z) * 83492791);
  const grid = new Map();
  const put = (x, y, z, tag) => { const k = keyOf(x, y, z); let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(x, y, z, tag); };
  // Other meshes go in whole, tagged below zero; this mesh's parts by their own number.
  if (P.with !== 'same node') {
    meshes.forEach((o, mi) => {
      if (o === m) return;
      const parts = partsOf(o); const V = o.position;
      for (let v = 0; v < V.length / 3; v++) if (parts.along[v] >= skip) put(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], -1 - mi);
    });
  }
  const mine = P.with !== 'other nodes';
  const V = m.position; const N = m.normal; const nv = V.length / 3;
  const nearest = (v) => {
    const x = V[v * 3]; const y = V[v * 3 + 1]; const z = V[v * 3 + 2]; const p = own.id[v];
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
  if (mine) for (let v = 0; v < nv; v++) if (own.along[v] >= skip) put(V[v * 3], V[v * 3 + 1], V[v * 3 + 2], own.id[v]);
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
    move[v] = (away >= 0 ? 1 : -1) * amount * w; moved++;
  }
  for (let v = 0; v < nv; v++) if (move[v]) for (let s = 0; s < 3; s++) V[v * 3 + s] += N[v * 3 + s] * move[v];
  if (moved) freshNormals(m);
  return moved;
}
