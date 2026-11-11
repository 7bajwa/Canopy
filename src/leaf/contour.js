// Finds cutouts by tracing the opacity: each island's outline and its holes (negative space), evened out to a
// chosen edge length, with rings of inner points that thin out toward the middle. Plain { width, height, data } images.
import { autoAxis, meshAs } from './cutout.js';

// Distance from every pixel to the nearest pixel of the other kind (chamfer 3-4, in pixels).
function distance(mask, w, h, toOutside) {
  const BIG = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = (mask[i] === 1) === toOutside ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? (toOutside ? 0 : BIG) : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
    }
  }
  return d;
}

// Every boundary of a mask as closed loops of pixel corners, clockwise on screen around what's inside
// (outlines one way, holes the other). Diagonal touches stay joined, matching 8-connected islands.
export function traceLoops(mask, w, h) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const out = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const add = (ax, ay, bx, by) => { const k = key(ax, ay); (out.get(k) || out.set(k, []).get(k)).push([ax, ay, bx, by]); };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const list of out.values()) {
    while (list.length) {
      let e = list.pop();
      const loop = [];
      for (;;) {
        loop.push([e[0], e[1]]);
        const next = out.get(key(e[2], e[3]));
        if (!next?.length) break;
        let pick = 0;
        if (next.length > 1) {
          // At a pinch point take the right turn, which keeps diagonal pixels in one loop.
          const dx = e[2] - e[0]; const dy = e[3] - e[1];
          pick = Math.max(0, next.findIndex((n) => n[2] - n[0] === -dy && n[3] - n[1] === dx));
        }
        e = next.splice(pick, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

const area = (loop) => { let s = 0; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]); return s / 2; };

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1; let best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// A closed loop simplified, then re-spaced so its edges run about `step` long, keeping its sharp corners.
export function resample(loop, step, tol = 1) {
  // Split at the farthest point from the start, so the simplifier sees two open runs.
  let far = 0; let best = -1;
  for (let i = 0; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > best) { best = d; far = i; } }
  const pts = [...simplify(loop.slice(0, far + 1), tol), ...simplify([...loop.slice(far), loop[0]], tol).slice(1, -1)];
  const n = pts.length;
  if (n < 3) return pts;
  const corner = pts.map((p, i) => {
    const a = pts[(i + n - 1) % n]; const b = pts[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]]; const v = [b[0] - p[0], b[1] - p[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
    return cos < Math.cos((55 * Math.PI) / 180);
  });
  // Runs between corners (or the whole loop when it has none) are cut into equal steps.
  let starts = corner.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) starts = [0];
  const result = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]; const to = s + 1 < starts.length ? starts[s + 1] : starts[0] + n;
    const run = [];
    for (let i = from; i <= to; i++) run.push(pts[i % n]);
    let len = 0;
    for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    const parts = Math.max(1, Math.round(len / step));
    let i = 1; let walked = 0;
    result.push(run[0]);
    for (let k = 1; k < parts; k++) {
      const want = (k / parts) * len;
      for (;;) {
        const seg = Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
        if (walked + seg >= want || i === run.length - 1) {
          const f = seg ? (want - walked) / seg : 0;
          result.push([run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f]);
          break;
        }
        walked += seg; i++;
      }
    }
  }
  return result.length >= 3 ? result : pts;
}

// Islands of opaque pixels, 8-connected, as label numbers with their bounds and size.
function islands(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = found.length + 1;
    const g = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
    let top = 0;
    stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top];
      const x = i % w; const y = (i / w) | 0;
      g.area++; g.sx += x; g.sy += y; g.sxx += x * x; g.syy += y * y; g.sxy += x * y;
      if (x < g.x0) g.x0 = x; if (x > g.x1) g.x1 = x; if (y < g.y0) g.y0 = y; if (y > g.y1) g.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && !label[j]) { label[j] = id; stack[top++] = j; }
        }
      }
    }
    found.push(g);
  }
  return { label, found };
}

const inPoly = (poly, x, y) => {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) on = !on;
  }
  return on;
};

export function contourCutouts(img, o = {}) {
  const { threshold = 0.5, padding = 2, segment = 24, minArea = 64, holeArea = 400, inner = true, midline = false } = o;
  const w = img.width; const h = img.height;
  let mask = new Uint8Array(w * h);
  const cut = Math.max(1, threshold * 255);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3] >= cut ? 1 : 0;
  // Padding grows the opaque area, so the outline never cuts into the leaf.
  if (padding > 0) {
    const d = distance(mask, w, h, false);
    mask = mask.map((v, i) => (v || d[i] <= padding ? 1 : 0));
  }
  const { label, found } = islands(mask, w, h);
  const step = Math.max(2, segment);
  const cutouts = [];
  for (const g of found) {
    if (g.area < minArea) continue;
    // Work in the island's own box, with a clear border so every loop closes.
    const bx = g.x0 - 1; const by = g.y0 - 1; const bw = g.x1 - g.x0 + 3; const bh = g.y1 - g.y0 + 3;
    const own = new Uint8Array(bw * bh);
    for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) if (label[y * w + x] === g.id) own[(y - by) * bw + (x - bx)] = 1;
    const loops = traceLoops(own, bw, bh).map((l) => ({ l, a: area(l) })).sort((p, q) => Math.abs(q.a) - Math.abs(p.a));
    if (!loops.length) continue;
    const shift = (pts) => pts.map(([x, y]) => [x + bx, y + by]);
    const outline = shift(resample(loops[0].l, step));
    const holes = loops.slice(1).filter((x) => Math.sign(x.a) !== Math.sign(loops[0].a) && Math.abs(x.a) >= holeArea)
      .map((x) => shift(resample(x.l, step))).filter((x) => x.length >= 3);
    // Small holes are filled, so their pixels count as inside for the inner rings.
    const fill = own.slice();
    for (const x of loops.slice(1)) {
      if (Math.sign(x.a) === Math.sign(loops[0].a) || Math.abs(x.a) >= holeArea) continue;
      for (let y = 0; y < bh; y++) for (let xx = 0; xx < bw; xx++) if (!fill[y * bw + xx] && inPoly(x.l, xx + 0.5, y + 0.5)) fill[y * bw + xx] = 1;
    }
    // The pivot: along the island's longest direction, base at the lower end.
    const cx = g.sx / g.area; const cy = g.sy / g.area;
    const ang = 0.5 * Math.atan2(2 * (g.sxy / g.area - cx * cy), g.sxx / g.area - cx * cx - (g.syy / g.area - cy * cy));
    const axis = autoAxis(img, { rect: [g.x0, g.y0, g.x1 + 1, g.y1 + 1], center: [cx, cy], angle: ang }, threshold);
    const innerPx = [];
    const taken = [...outline, ...holes.flat()];
    const free = (p) => taken.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= step * 0.6);
    const solid = (p) => fill[(Math.floor(p[1]) - by) * bw + (Math.floor(p[0]) - bx)] === 1;
    // A row of points from base to tip, so the leaf can fold along its middle.
    if (midline) {
      const [x0, y0] = axis.base; const [x1, y1] = axis.tip; const L = Math.hypot(x1 - x0, y1 - y0);
      for (let d = step; d < L - step * 0.5; d += step) { const p = [x0 + ((x1 - x0) * d) / L, y0 + ((y1 - y0) * d) / L]; if (solid(p) && free(p)) { innerPx.push(p); taken.push(p); } }
    }
    if (inner) {
      const depth = distance(fill, bw, bh, true);
      let deepest = 0; let deep = null;
      for (let i = 0; i < depth.length; i++) if (depth[i] > deepest) { deepest = depth[i]; deep = [(i % bw) + bx + 0.5, ((i / bw) | 0) + by + 0.5]; }
      // Rings every step inward, each with fewer points than the one outside it.
      for (let k = 1; k * step < deepest; k++) {
        const ring = depth.map((v) => (v >= k * step ? 1 : 0));
        for (const l of traceLoops(ring, bw, bh)) {
          for (const p of shift(resample(l, step * 1.5 ** k))) if (free(p)) { innerPx.push(p); taken.push(p); }
        }
      }
      if (deep && deepest > step * 0.6 && free(deep)) innerPx.push(deep);
    }
    cutouts.push({ name: '', basePx: axis.base, tipPx: axis.tip, outlinePx: outline, innerPx, holesPx: holes, sprouts: [], auto: true, meshMode: 'mixed', top: g.y0, left: g.x0 });
  }
  cutouts.sort((p, q) => p.top - q.top || p.left - q.left);
  return cutouts.map(({ top, left, ...c }, i) => meshAs({ ...c, name: `Leaf ${i + 1}` }, w, h));
}
