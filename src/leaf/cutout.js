// Finds leaves in an atlas from their opacity and fits a minimal mesh around each.
// Works on plain { width, height, data } images so it runs and tests without a browser.

const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3] / 255;

// Connected islands of opaque pixels. Union-find over a downsampled mask keeps big atlases fast.
export function detectIslands(img, threshold = 0.25, minArea = 64) {
  const stride = Math.max(1, Math.floor(Math.max(img.width, img.height) / 1024));
  const w = Math.floor(img.width / stride);
  const h = Math.floor(img.height / stride);
  const parent = new Int32Array(w * h).fill(-1);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alphaAt(img, x * stride, y * stride) < threshold) continue;
      const i = x + y * w;
      parent[i] = i;
      if (x > 0 && parent[i - 1] >= 0) join(i - 1, i);
      if (y > 0 && parent[i - w] >= 0) join(i - w, i);
    }
  }
  const groups = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (parent[i] < 0) continue;
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = { x0: x, y0: y, x1: x, y1: y, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 }; groups.set(r, g); }
      g.x0 = Math.min(g.x0, x); g.x1 = Math.max(g.x1, x);
      g.y0 = Math.min(g.y0, y); g.y1 = Math.max(g.y1, y);
      g.area++;
      g.sx += x; g.sy += y; g.sxx += x * x; g.syy += y * y; g.sxy += x * y;
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const area = g.area * stride * stride;
    if (area < minArea) continue;
    const cx = g.sx / g.area; const cy = g.sy / g.area;
    // Principal axis of the pixels: a leaf's midrib is almost always its longest direction.
    const a = g.sxx / g.area - cx * cx;
    const b = g.sxy / g.area - cx * cy;
    const c = g.syy / g.area - cy * cy;
    const angle = 0.5 * Math.atan2(2 * b, a - c);
    out.push({
      rect: [g.x0 * stride, g.y0 * stride, (g.x1 + 1) * stride, (g.y1 + 1) * stride],
      center: [cx * stride, cy * stride], angle, area,
    });
  }
  return out.sort((p, q) => p.rect[1] - q.rect[1] || p.rect[0] - q.rect[0]);
}

// Picks which end of the principal axis is the base.
export function autoAxis(img, island, threshold = 0.25) {
  const [x0, y0, x1, y1] = island.rect;
  const dx = Math.cos(island.angle); const dy = Math.sin(island.angle);
  let tMin = Infinity; let tMax = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(img, x, y) < threshold) continue;
      const t = (x - island.center[0]) * dx + (y - island.center[1]) * dy;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
  }
  const a = [island.center[0] + dx * tMin, island.center[1] + dy * tMin];
  const b = [island.center[0] + dx * tMax, island.center[1] + dy * tMax];
  const span = tMax - tMin || 1;
  let nearA = 0; let nearB = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(img, x, y) < threshold) continue;
      const t = ((x - island.center[0]) * dx + (y - island.center[1]) * dy - tMin) / span;
      if (t < 0.25) nearA++;
      else if (t > 0.75) nearB++;
    }
  }
  // Most atlases stand leaves stem down, so the pivot goes at the lower end pointing up. Only a leaf lying almost flat
  // falls back to its narrower end being the tip.
  const lying = Math.abs(dy) < Math.abs(dx) * 0.25;
  const baseIsA = !lying || nearA === nearB ? a[1] > b[1] : nearA < nearB;
  return baseIsA ? { base: a, tip: b } : { base: b, tip: a };
}

// Scans along base-to-tip and records how far opaque pixels reach on each side of the midrib.
function scanProfile(img, cut, threshold, padding) {
  const [bx, by] = cut.base;
  const ax = cut.tip[0] - bx; const ay = cut.tip[1] - by;
  const length = Math.hypot(ax, ay) || 1;
  const dx = ax / length; const dy = ay / length;
  const px = -dy; const py = dx;
  const [x0, y0, x1, y1] = cut.rect;
  const samples = Math.min(256, Math.max(16, Math.ceil(length)));
  const lefts = new Float32Array(samples + 1);
  const rights = new Float32Array(samples + 1);
  let tMin = Infinity; let tMax = -Infinity;
  const points = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alphaAt(img, x, y) < threshold) continue;
      const rx = x + 0.5 - bx; const ry = y + 0.5 - by;
      const t = rx * dx + ry * dy; const s = rx * px + ry * py;
      points.push(t, s);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
  }
  if (!points.length) return null;
  tMin -= padding; tMax += padding;
  const span = tMax - tMin || 1;
  let opaque = 0;
  for (let i = 0; i < points.length; i += 2) {
    const u = (points[i] - tMin) / span;
    const k = Math.min(samples, Math.round(u * samples));
    // Each pixel covers a span of samples, so spread it to avoid thin slits in the profile.
    for (let j = Math.max(0, k - 1); j <= Math.min(samples, k + 1); j++) {
      if (points[i + 1] < 0) lefts[j] = Math.max(lefts[j], -points[i + 1] + padding);
      else rights[j] = Math.max(rights[j], points[i + 1] + padding);
    }
    opaque++;
  }
  return { lefts, rights, samples, tMin, tMax, length, dx, dy, px, py, opaque };
}

// Keeps the fewest rows that still cover the outline: inserts the row with the worst overshoot,
// then pushes rows outward so no opaque pixel is ever clipped by the mesh.
function fitRows(profile, maxRows) {
  const { lefts, rights, samples } = profile;
  const keep = [0, samples];
  const err = (i) => {
    let a = 0; let b = keep.length - 1;
    for (let k = 0; k + 1 < keep.length; k++) if (keep[k] <= i && i <= keep[k + 1]) { a = k; b = k + 1; break; }
    const i0 = keep[a]; const i1 = keep[b];
    const f = i1 > i0 ? (i - i0) / (i1 - i0) : 0;
    const l = Math.abs(lefts[i] - (lefts[i0] + (lefts[i1] - lefts[i0]) * f));
    const r = Math.abs(rights[i] - (rights[i0] + (rights[i1] - rights[i0]) * f));
    return l + r;
  };
  while (keep.length < maxRows) {
    let best = -1; let worst = 0.5;
    for (let i = 1; i < samples; i++) {
      if (keep.includes(i)) continue;
      const e = err(i);
      if (e > worst) { worst = e; best = i; }
    }
    if (best < 0) break;
    keep.push(best);
    keep.sort((a, b) => a - b);
  }
  const l = keep.map((i) => lefts[i]);
  const r = keep.map((i) => rights[i]);
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 0; k + 1 < keep.length; k++) {
      const i0 = keep[k]; const i1 = keep[k + 1];
      for (let i = i0 + 1; i < i1; i++) {
        const f = (i - i0) / (i1 - i0);
        const dl = lefts[i] - (l[k] + (l[k + 1] - l[k]) * f);
        const dr = rights[i] - (r[k] + (r[k + 1] - r[k]) * f);
        if (dl > 0) { l[k] += dl * (1 - f); l[k + 1] += dl * f; }
        if (dr > 0) { r[k] += dr * (1 - f); r[k + 1] += dr * f; }
      }
    }
  }
  return keep.map((i, k) => ({ t: i / samples, l: l[k], r: r[k] }));
}

// Outer contour in leaf space from the profile, reduced with Douglas-Peucker.
function simplify(points, tol) {
  if (points.length < 3) return points;
  let idx = -1; let max = 0;
  const [ax, ay] = points[0]; const [bx, by] = points[points.length - 1];
  const dx = bx - ax; const dy = by - ay; const l = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / l;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)];
}

function polygonFromProfile(profile, maxPoints) {
  const { lefts, rights, samples, tMin, tMax } = profile;
  const span = tMax - tMin;
  const right = [];
  const left = [];
  for (let i = 0; i <= samples; i++) {
    const t = tMin + (i / samples) * span;
    right.push([rights[i], t]);
    left.push([-lefts[i], t]);
  }
  const loop = [...right, ...left.reverse()];
  let tol = span * 0.002;
  let out = loop;
  for (let k = 0; k < 24; k++) {
    const half = Math.floor(loop.length / 2);
    out = [...simplify(loop.slice(0, half + 1), tol).slice(0, -1), ...simplify(loop.slice(half).concat([loop[0]]), tol).slice(0, -1)];
    if (out.length <= maxPoints) break;
    tol *= 1.5;
  }
  return out;
}

// Ear clipping: the polygons are small, so the simple O(n^2) approach is plenty.
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = Array.from({ length: n }, (_, i) => i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[(i + 1) % n];
    area += ax * by - bx * ay;
  }
  const sign = area >= 0 ? 1 : -1;
  const tris = [];
  const cross = (a, b, c) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (p, a, b, c) => cross(a, b, p) * sign >= 0 && cross(b, c, p) * sign >= 0 && cross(c, a, p) * sign >= 0;
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]; const b = idx[i]; const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) * sign <= 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  return tris;
}

const cross2 = (all, a, b, c) => (all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[b][1] - all[a][1]) * (all[c][0] - all[a][0]);

// Puts a point into a triangle list: inside a triangle it splits it in three; on an edge it splits the
// triangles either side in two, so no crack opens along that edge. Winding is kept.
function insertPoint(tris, all, p) {
  let best = -1; let bestW = -Infinity; let bw = null;
  tris.forEach(([a, b, c], k) => {
    const s = cross2(all, a, b, c);
    if (!s) return;
    const w = [cross2(all, b, c, p) / s, cross2(all, c, a, p) / s, cross2(all, a, b, p) / s];
    const m = Math.min(...w);
    if (m > bestW) { bestW = m; best = k; bw = w; }
  });
  if (best < 0 || bestW < -1e-6) return false;
  const t = tris[best];
  const edge = bw.findIndex((w) => Math.abs(w) < 1e-6);
  if (edge < 0) { const [a, b, c] = t; tris.splice(best, 1, [a, b, p], [b, c, p], [c, a, p]); return true; }
  const u = t[(edge + 1) % 3]; const v = t[(edge + 2) % 3];
  const other = tris.findIndex((q, k) => k !== best && q.includes(u) && q.includes(v));
  const split = (k) => {
    const q = tris[k];
    const one = [...q]; const two = [...q];
    one[q.indexOf(u)] = p; two[q.indexOf(v)] = p;
    tris.splice(k, 1, one, two);
  };
  split(best);
  if (other >= 0) split(other > best ? other + 1 : other);
  return true;
}

// Swaps the shared edge of two triangles while that makes them fatter (a Delaunay mesh), never across the outline.
function flipToDelaunay(tris, all, keep = null) {
  const angleAt = (o, x, y) => {
    const ax = all[x][0] - all[o][0]; const ay = all[x][1] - all[o][1]; const bx = all[y][0] - all[o][0]; const by = all[y][1] - all[o][1];
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  };
  for (let guard = 0; guard < 2000; guard++) {
    const edges = new Map();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const u = t[e]; const v = t[(e + 1) % 3];
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        (edges.get(key) || edges.set(key, []).get(key)).push([ti, t[(e + 2) % 3]]);
      }
    });
    let done = true;
    for (const [key, list] of edges) {
      if (list.length !== 2 || keep?.has(key)) continue;
      const [u, v] = key.split(',').map(Number);
      const [[ta, a], [tb, b]] = list;
      // Only a convex pair can swap its edge, and only when the angles facing it add up past half a turn.
      if (cross2(all, a, b, u) * cross2(all, a, b, v) >= 0 || cross2(all, u, v, a) * cross2(all, u, v, b) >= 0) continue;
      if (angleAt(a, u, v) + angleAt(b, u, v) <= Math.PI + 1e-9) continue;
      tris[ta] = [a, u, b]; tris[tb] = [a, b, v];
      done = false;
      break;
    }
    if (done) break;
  }
}

// Makes the edge a-b part of the mesh by flipping the edges that cross it (the edges of a hole must exist to cut it out).
function recoverEdge(tris, all, a, b) {
  for (let guard = 0; guard < 500; guard++) {
    if (tris.some((t) => t.includes(a) && t.includes(b))) return;
    const edges = new Map();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const u = t[e]; const v = t[(e + 1) % 3];
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        (edges.get(key) || edges.set(key, []).get(key)).push([ti, t[(e + 2) % 3]]);
      }
    });
    let done = false;
    for (const [key, list] of edges) {
      if (list.length !== 2) continue;
      const [u, v] = key.split(',').map(Number);
      if (u === a || u === b || v === a || v === b) continue;
      if (cross2(all, a, b, u) * cross2(all, a, b, v) >= 0 || cross2(all, u, v, a) * cross2(all, u, v, b) >= 0) continue;
      const [[ta, p], [tb, q]] = list;
      if (cross2(all, p, q, u) * cross2(all, p, q, v) >= 0 || cross2(all, u, v, p) * cross2(all, u, v, q) >= 0) continue;
      tris[ta] = [p, u, q]; tris[tb] = [p, q, v];
      done = true;
      break;
    }
    if (!done) return;
  }
}

// Joins a leaf's outline and inner points into triangles: clip the outline, add each inner point where it lands,
// then flip edges until no triangle is needlessly thin.
export function triangulateInner(all, outlineCount, holes = []) {
  // A point on a straight run of the outline can't be clipped as an ear, so it goes in afterwards, onto its edge.
  const ring = Array.from({ length: outlineCount }, (_, i) => i);
  const later = [];
  for (let i = 0; i < ring.length && ring.length > 3; i++) {
    const a = ring[(i + ring.length - 1) % ring.length]; const b = ring[i]; const c = ring[(i + 1) % ring.length];
    const len = Math.hypot(all[c][0] - all[a][0], all[c][1] - all[a][1]) || 1;
    if (Math.abs(cross2(all, a, b, c)) / len < 1e-3) { later.push(b); ring.splice(i, 1); i = Math.max(-1, i - 2); }
  }
  const base = triangulate(ring.map((i) => all[i]));
  const out = [];
  for (let i = 0; i + 2 < base.length; i += 3) out.push([ring[base[i]], ring[base[i + 1]], ring[base[i + 2]]]);
  for (const p of later) insertPoint(out, all, p);
  for (let p = outlineCount; p < all.length; p++) insertPoint(out, all, p);
  flipToDelaunay(out, all);
  if (holes.length) {
    // Each hole's edges are forced into the mesh, kept through the clean-up, and then everything inside is dropped.
    const keep = new Set();
    for (const h of holes) {
      h.forEach((a, i) => {
        const b = h[(i + 1) % h.length];
        recoverEdge(out, all, a, b);
        keep.add(a < b ? `${a},${b}` : `${b},${a}`);
      });
    }
    flipToDelaunay(out, all, keep);
    const loops = holes.map((h) => h.map((i) => all[i]));
    return out.filter(([a, b, c]) => {
      const x = (all[a][0] + all[b][0] + all[c][0]) / 3; const y = (all[a][1] + all[b][1] + all[c][1]) / 3;
      return !loops.some((loop) => insidePoly(loop, x, y));
    }).flat();
  }
  return out.flat();
}

// Quads split along their shorter diagonal, which bends more evenly; anything bigger is clipped like an outline.
function facesToTris(faces, all) {
  const out = [];
  const d = (a, b) => Math.hypot(all[a][0] - all[b][0], all[a][1] - all[b][1]);
  for (const f of faces) {
    if (f.length === 3) out.push(...f);
    else if (f.length === 4) {
      if (d(f[0], f[2]) <= d(f[1], f[3])) out.push(f[0], f[1], f[2], f[0], f[2], f[3]);
      else out.push(f[0], f[1], f[3], f[1], f[2], f[3]);
    } else for (const i of triangulate(f.map((v) => all[v]))) out.push(f[i]);
  }
  return out;
}

const validFaces = (faces, count) => Array.isArray(faces) && faces.length && faces.every((f) => Array.isArray(f) && f.length >= 3 && f.every((i) => Number.isInteger(i) && i >= 0 && i < count));

// From the points a person can edit to what the engine draws. Measures are in leaf lengths, so atlas proportions survive any line length.
export function meshCutout(c, width, height) {
  const [bx, by] = c.basePx; const [tx, ty] = c.tipPx;
  const L = Math.hypot(tx - bx, ty - by) || 1;
  const dx = (tx - bx) / L; const dy = (ty - by) / L;
  const outline = c.outlinePx; const inner = c.innerPx || [];
  // Holes (negative space) are loops of points inside the outline; the mesh has nothing inside them.
  const holes = (c.holesPx || []).filter((h) => h.length >= 3);
  let lo = Infinity; let hi = -Infinity;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of outline) {
    const a = (x - bx) * dx + (y - by) * dy;
    lo = Math.min(lo, a); hi = Math.max(hi, a);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const span = Math.max(hi - lo, 1);
  const all = [...outline, ...inner, ...holes.flat()];
  let next = outline.length + inner.length;
  const holeLoops = holes.map((h) => h.map(() => next++));
  const pts = all.map(([x, y]) => {
    const ox = x - bx; const oy = y - by;
    // v flips because images count from the top and textures from the bottom.
    return { t: (ox * dx + oy * dy) / span, x: (ox * -dy + oy * dx) / span, u: x / width, v: 1 - y / height };
  });
  // Faces may use hole points too (quads joined from a triangulation around holes).
  const faces = validFaces(c.faces, all.length) ? c.faces : null;
  const tris = faces ? facesToTris(faces, all) : triangulateInner(all, outline.length, holeLoops);
  // Always counter-clockwise across then along, which is what makes the leaf face the way its line says.
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = pts[tris[i]]; const b = pts[tris[i + 1]]; const d = pts[tris[i + 2]];
    if ((b.x - a.x) * (d.t - a.t) - (b.t - a.t) * (d.x - a.x) < 0) { const k = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = k; }
  }
  return {
    ...c,
    id: c.id || `cut${Math.random().toString(36).slice(2, 9)}`,
    holesPx: holes,
    faces,
    rect: [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)],
    span, tmin: lo / span, tmax: hi / span, width, height,
    mesh: { pts, tris },
    // Flat outline for the classic flat-leaf node.
    poly: pts.slice(0, outline.length).map((p) => ({ x: p.x, y: p.t, u: p.u, v: p.v })), tris: triangulate(outline),
    stats: { triangles: tris.length / 3, quads: faces ? faces.filter((f) => f.length === 4).length : 0 },
    enabled: c.enabled !== false,
    // 3D offsets only fit while the points are the same ones.
    deform: c.deform?.length === pts.length ? c.deform : undefined,
  };
}

// Fits one leaf from its opacity: rows along its axis that never clip an opaque pixel, each row cut into columns
// across. In quad mode the rows and columns are the faces; in triangle mode the same points are joined as triangles.
export function fitCutout(img, source, opts = {}) {
  const threshold = opts.threshold ?? 0.25;
  const padding = opts.padding ?? 2;
  const midline = opts.midline !== false;
  const points = Math.max(4, opts.points ?? 10);
  const cols = Math.max(1, Math.min(6, Math.round(opts.columns ?? 1)));
  const quads = opts.inside !== 'triangles';
  const profile = scanProfile(img, source, threshold, padding);
  if (!profile) return null;
  const { tMin, tMax, dx, dy, px, py } = profile;
  const [bx, by] = source.base;
  const span = tMax - tMin;
  const rows = fitRows(profile, Math.max(2, Math.ceil(points / 2)));
  const at = (r, s) => { const a = tMin + r.t * span; return [bx + dx * a + px * s, by + dy * a + py * s]; };
  // Across each row from the left edge to the right one, as shares of that side's width.
  const across = [];
  for (let j = cols; j >= 1; j--) across.push(-j / cols);
  if (midline) across.push(0);
  for (let j = 1; j <= cols; j++) across.push(j / cols);
  // Rows that end in a point give several points in one spot, so they merge.
  const unique = [];
  const idOf = (p) => {
    let i = unique.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1);
    if (i < 0) { unique.push(p); i = unique.length - 1; }
    return i;
  };
  const grid = rows.map((r) => across.map((f) => idOf(at(r, f < 0 ? f * r.l : f * r.r))));
  const n = rows.length; const m = across.length;
  const loop = [];
  for (let r = 0; r < n; r++) loop.push(grid[r][m - 1]);
  for (let k = m - 2; k >= 0; k--) loop.push(grid[n - 1][k]);
  for (let r = n - 2; r >= 0; r--) loop.push(grid[r][0]);
  for (let k = 1; k < m - 1; k++) loop.push(grid[0][k]);
  const ring = loop.filter((id, i) => id !== loop[(i + 1) % loop.length]);
  if (new Set(ring).size < 3) return null;
  const onRing = new Set(ring);
  const innerIds = [...new Set(grid.flat())].filter((id) => !onRing.has(id));
  const order = [...ring, ...innerIds];
  const index = new Map(order.map((id, i) => [id, i]));
  const outlinePx = ring.map((id) => unique[id]);
  const innerPx = innerIds.map((id) => unique[id]);
  let faces;
  if (quads) {
    faces = [];
    for (let r = 0; r + 1 < n; r++) {
      for (let k = 0; k + 1 < m; k++) {
        const f = [grid[r][k], grid[r][k + 1], grid[r + 1][k + 1], grid[r + 1][k]].map((id) => index.get(id));
        const g = f.filter((v, i) => v !== f[(i + 1) % f.length]);
        if (new Set(g).size >= 3) faces.push([...new Set(g)]);
      }
    }
  }
  return meshCutout({
    name: source.name, basePx: source.base, tipPx: source.tip, outlinePx, innerPx, faces,
    sprouts: source.sprouts || [], enabled: source.enabled, auto: source.auto ?? true,
  }, img.width, img.height);
}

const insidePoly = (poly, x, y) => {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) on = !on;
  }
  return on;
};

// Point edits on a cutout. With faces (a quad mesh) the new point joins the face it lands on, so the rest stays as built.
export function addOutlinePoint(c, edge, pt) {
  const n = c.outlinePx.length; const at = edge + 1;
  const outlinePx = [...c.outlinePx.slice(0, at), pt, ...c.outlinePx.slice(at)];
  if (!c.faces) return { ...c, outlinePx };
  const a = edge; const b = (edge + 1) % n;
  let placed = false;
  const faces = c.faces.map((f) => {
    const g = f.map((i) => (i >= at ? i + 1 : i));
    if (placed) return g;
    for (let i = 0; i < f.length; i++) {
      const x = f[i]; const y = f[(i + 1) % f.length];
      if ((x === a && y === b) || (x === b && y === a)) { g.splice(i + 1, 0, at); placed = true; break; }
    }
    return g;
  });
  return { ...c, outlinePx, faces };
}

export function addInnerPoint(c, pt) {
  const innerPx = [...(c.innerPx || []), pt];
  if (!c.faces) return { ...c, innerPx };
  const all = [...c.outlinePx, ...innerPx];
  const p = all.length - 1;
  const k = c.faces.findIndex((f) => insidePoly(f.map((i) => all[i]), pt[0], pt[1]));
  if (k < 0) return { ...c, innerPx, faces: null };
  const f = c.faces[k];
  const fan = f.map((v, i) => [v, f[(i + 1) % f.length], p]);
  return { ...c, innerPx, faces: [...c.faces.slice(0, k), ...fan, ...c.faces.slice(k + 1)] };
}

export function removeCutoutPoint(c, kind, i) {
  const n = c.outlinePx.length;
  const idx = kind === 'outline' ? i : n + i;
  const outlinePx = kind === 'outline' ? c.outlinePx.filter((_, k) => k !== i) : c.outlinePx;
  const innerPx = kind === 'inner' ? c.innerPx.filter((_, k) => k !== i) : c.innerPx || [];
  if (!c.faces) return { ...c, outlinePx, innerPx };
  // An outline corner in one face can leave it and the face stays whole. Anything else would leave a hole,
  // so those points are joined again as triangles.
  if (c.faces.filter((f) => f.includes(idx)).length !== 1) return { ...c, outlinePx, innerPx, faces: null };
  const faces = c.faces.map((f) => f.filter((v) => v !== idx).map((v) => (v > idx ? v - 1 : v))).filter((f) => f.length >= 3);
  return { ...c, outlinePx, innerPx, faces };
}

// Joins a triangulation's triangles in pairs into quads where two share an edge and make a convex four-sided
// face, best-shaped first. Strict (a mixed mesh) only keeps quads with no corner under 45° or over 135°;
// whatever isn't joined stays a triangle. Faces index the same points as the triangles.
export function quadify(tris, pts, strict = false) {
  const n = tris.length / 3;
  const edges = new Map();
  for (let t = 0; t < n; t++) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t * 3 + e]; const b = tris[t * 3 + ((e + 1) % 3)];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      (edges.get(k) || edges.set(k, []).get(k)).push([t, a, b]);
    }
  }
  const pairs = [];
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [[t1, x, y], [t2]] = list;
    const c = [0, 1, 2].map((i) => tris[t1 * 3 + i]).find((v) => v !== x && v !== y);
    const d = [0, 1, 2].map((i) => tris[t2 * 3 + i]).find((v) => v !== x && v !== y);
    // t1 runs x to y, so the quad keeps its winding as x, d, y, c.
    const q = [x, d, y, c];
    let sign = 0; let worst = 0; let convex = true;
    for (let i = 0; i < 4; i++) {
      const p0 = pts[q[(i + 3) % 4]]; const p1 = pts[q[i]]; const p2 = pts[q[(i + 1) % 4]];
      const ax = p0[0] - p1[0]; const ay = p0[1] - p1[1]; const bx = p2[0] - p1[0]; const by = p2[1] - p1[1];
      const cr = ax * by - ay * bx;
      if (Math.abs(cr) < 1e-9 || (sign && Math.sign(cr) !== sign)) { convex = false; break; }
      sign = Math.sign(cr);
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1))));
      worst = Math.max(worst, Math.abs(ang - Math.PI / 2));
    }
    if (!convex || (strict && worst > Math.PI / 4)) continue;
    pairs.push({ t1, t2, q, worst });
  }
  pairs.sort((a, b) => a.worst - b.worst);
  const used = new Array(n).fill(false);
  const faces = [];
  for (const p of pairs) {
    if (used[p.t1] || used[p.t2]) continue;
    used[p.t1] = used[p.t2] = true;
    faces.push(p.q);
  }
  for (let t = 0; t < n; t++) if (!used[t]) faces.push([tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]]);
  return faces;
}

// A cutout meshed the way its meshMode asks: triangles, quads where they fit, or only well-shaped quads.
// Without a mode it keeps the faces it was built with.
export function meshAs(c, width, height) {
  if (!c.meshMode) return meshCutout(c, width, height);
  const tri = meshCutout({ ...c, faces: null }, width, height);
  if (c.meshMode === 'tris') return tri;
  const all = [...c.outlinePx, ...(c.innerPx || []), ...(tri.holesPx || []).flat()];
  return meshCutout({ ...c, faces: quadify(tri.mesh.tris, all, c.meshMode === 'mixed') }, width, height);
}

// A plain leaf outline from a pivot-to-tip line: a little longer than the line, three points down each side and a midrib.
export function leafFromLine(base, tip) {
  const L = Math.hypot(tip[0] - base[0], tip[1] - base[1]) || 1;
  const d = [(tip[0] - base[0]) / L, (tip[1] - base[1]) / L]; const p = [-d[1], d[0]];
  const at = (f, w) => [base[0] + (d[0] * f + p[0] * w) * L, base[1] + (d[1] * f + p[1] * w) * L];
  const side = [[0.18, 0.2], [0.45, 0.27], [0.78, 0.17]];
  return {
    basePx: base, tipPx: tip, sprouts: [], auto: false,
    outlinePx: [at(-0.05, 0), ...side.map(([f, w]) => at(f, w)), at(1.1, 0), ...[...side].reverse().map(([f, w]) => at(f, -w))],
    innerPx: side.map(([f]) => at(f, 0)),
  };
}

// Detects and fits every leaf in an atlas in one go.
export function cutoutsFromImage(img, opts = {}) {
  const threshold = opts.threshold ?? 0.25;
  return detectIslands(img, threshold).map((island, i) => {
    const { base, tip } = autoAxis(img, island, threshold);
    return fitCutout(img, { rect: island.rect, base, tip, name: `Leaf ${i + 1}` }, opts);
  }).filter(Boolean);
}
