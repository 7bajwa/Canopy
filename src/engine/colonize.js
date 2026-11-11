// Space colonization, attractor clouds and unified skeletons.
import { hash, norm, DEG, sub, add, mul, clamp } from './math.js';
import { finishLine, sampleLine, newSample } from './line.js';

const MAX_POINTS = 12000;

// Fills a test volume with points using one of the cloud algorithms.
function fill(n, min, max, inside, spacing, seed) {
  const pts = [];
  const algo = n.params.algo;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  if (algo === 'one') return [center];
  const jitter = clamp(+n.params.randomize || 0, 0, 1) * spacing;
  const jit = (p, i) => {
    if (!jitter) return p;
    const q = [p[0] + (hash(seed, i, 1) - 0.5) * jitter, p[1] + (hash(seed, i, 2) - 0.5) * jitter, p[2] + (hash(seed, i, 3) - 0.5) * jitter];
    return inside(q) ? q : p;
  };
  if (algo === 'poisson') {
    // Dart throwing on a hash grid: natural-looking and needs no tuning.
    const cell = spacing;
    const grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    const vol = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
    const tries = Math.min(MAX_POINTS * 3, Math.ceil((vol / (spacing ** 3)) * 4));
    for (let i = 0; i < tries && pts.length < MAX_POINTS; i++) {
      const p = [
        min[0] + hash(seed, i, 1) * (max[0] - min[0]),
        min[1] + hash(seed, i, 2) * (max[1] - min[1]),
        min[2] + hash(seed, i, 3) * (max[2] - min[2]),
      ];
      if (!inside(p)) continue;
      const cx = Math.floor(p[0] / cell); const cy = Math.floor(p[1] / cell); const cz = Math.floor(p[2] / cell);
      let ok = true;
      for (let x = cx - 1; x <= cx + 1 && ok; x++) for (let y = cy - 1; y <= cy + 1 && ok; y++) for (let z = cz - 1; z <= cz + 1 && ok; z++) {
        const q = grid.get(key(x, y, z));
        if (q && (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 < spacing * spacing) ok = false;
      }
      if (!ok) continue;
      grid.set(key(cx, cy, cz), p);
      pts.push(p);
    }
    return pts;
  }
  const dy = algo === 'cubic' ? spacing : spacing * (algo === 'hcp' ? Math.sqrt(2 / 3) : Math.SQRT1_2);
  const dz = algo === 'cubic' ? spacing : spacing * (algo === 'hcp' ? Math.sqrt(3) / 2 : Math.SQRT1_2);
  let i = 0;
  let layer = 0;
  for (let y = min[1]; y <= max[1] && pts.length < MAX_POINTS; y += dy, layer++) {
    let row = 0;
    for (let z = min[2]; z <= max[2]; z += dz, row++) {
      for (let x = min[0]; x <= max[0]; x += spacing) {
        let px = x; let pz = z;
        if (algo === 'hcp') { px += row % 2 ? spacing / 2 : 0; pz += layer % 2 ? dz / 3 : 0; if (layer % 2) px += spacing / 2; }
        else if (algo === 'fcc') { px += (row + layer) % 2 ? spacing / 2 : 0; }
        const p = [px, y, pz];
        if (inside(p)) pts.push(jit(p, i++));
        if (pts.length >= MAX_POINTS) return pts;
      }
    }
  }
  return pts;
}

export function cloudPoints(ev, n) {
  ev.cloudCache ||= new Map();
  if (ev.cloudCache.has(n.id)) return ev.cloudCache.get(n.id);
  const P = n.params;
  const q = ev.q(n);
  const c = ev.ctx;
  c.line = null; c.t = 0;
  const spacing = Math.max(1, q.density(c));
  const ctr = P.center || [0, 0, 0];
  const seed = ev.h(n);
  let pts = [];
  if (n.type === 'SphereCloud') {
    const r = q.radius(c); const h = r * q.zScale(c);
    const floor = -h + ((q.bottomSlice(c) / 100) * 2 * h);
    pts = fill(n, [ctr[0] - r, ctr[1] + floor, ctr[2] - r], [ctr[0] + r, ctr[1] + h, ctr[2] + r], (p) => {
      const y = (p[1] - ctr[1]) / h;
      return ((p[0] - ctr[0]) / r) ** 2 + y * y + ((p[2] - ctr[2]) / r) ** 2 < 1 && p[1] - ctr[1] >= floor;
    }, spacing, seed);
  } else if (n.type === 'BoxCloud') {
    const hx = q.sx(c) / 2; const hy = q.sy(c) / 2; const hz = q.sz(c) / 2;
    pts = fill(n, [ctr[0] - hx, ctr[1] - hy, ctr[2] - hz], [ctr[0] + hx, ctr[1] + hy, ctr[2] + hz], () => true, spacing, seed);
  } else if (n.type === 'MeshCloud') {
    const shape = ev.shapeLinked(n);
    if (shape) pts = fill(n, shape.bounds[0], shape.bounds[1], shape.inside, spacing, seed);
    else ev.warnings.add('An Object cloud needs a Scene object connected.');
  } else if (n.type === 'PathCloud') {
    const l = ev.in(n.id, 'parent')[0];
    const lines = l ? ev.pathLines.get(l.from) || [] : [];
    const spread = q.spread(c);
    let i = 0;
    const S = newSample();
    for (const line of lines) {
      for (let s = 0; s < line.length; s += spacing) {
        sampleLine(line, s, S);
        const off = spread * Math.cbrt(hash(seed, i, 4));
        const dir = norm([hash(seed, i, 1) - 0.5, hash(seed, i, 2) - 0.5, hash(seed, i, 3) - 0.5]);
        pts.push(add([S.px, S.py, S.pz], mul(dir, off)));
        if (++i > MAX_POINTS) break;
      }
    }
  }
  ev.cloudCache.set(n.id, pts);
  return pts;
}

// Grows from each start point toward the attractors, consuming those it reaches.
export function growColonization(ev, node, spawns, srcChain) {
  const q = ev.q(node);
  const c = ev.ctx;
  c.line = null; c.t = 0;
  const seed = ev.h(node);
  const step0 = Math.max(0.5, q.step(c));
  const minStep = Math.max(0.1, q.minStep(c));
  const adaptive = node.params.adaptive;
  const fullLength = q.fullLength(c);
  const iterations = Math.round(q.iterations(c) * (ev.draft ? 0.6 : 1));
  const coneCos = Math.cos(q.cone(c) * DEG);
  const randomness = q.randomness(c) / 100;
  const light = q.light(c) / 100;
  const gravity = q.gravity(c) / 100;

  const attractors = [];
  for (const l of ev.in(node.id, 'clouds')) {
    const cloud = ev.nodes.get(l.from);
    const P = cloud.params;
    const dMin = P.overrideDist ? +P.minDist : q.minDist(c);
    const dMax = P.overrideDist ? +P.maxDist : q.maxDist(c);
    for (const p of cloudPoints(ev, cloud)) attractors.push({ p, alive: true, dMin, dMax });
  }

  // Tree of skeleton nodes; a node may have several children.
  const nodes = [];
  const seedSpawns = spawns.length ? spawns : [{ p: [0, 0, 0], d: [0, 1, 0], level: 0, pos: 0 }];
  for (const sp of seedSpawns) {
    nodes.push({ p: sp.p, d: sp.d, parent: null, dist: 0, kids: [], sp });
  }
  if (!attractors.length) {
    ev.warnings.add('Space colonization needs a cloud connected.');
    return [];
  }

  const CELL = Math.max(...attractors.map((a) => a.dMax), 1);
  const hashCell = (x, y, z) => `${x},${y},${z}`;
  const grid = new Map();
  const index = (n) => {
    const k = hashCell(Math.floor(n.p[0] / CELL), Math.floor(n.p[1] / CELL), Math.floor(n.p[2] / CELL));
    (grid.get(k) || grid.set(k, []).get(k)).push(n);
  };
  nodes.forEach(index);

  for (let it = 0; it < iterations; it++) {
    for (const n of nodes) { n.force = null; n.count = 0; }
    let active = false;
    for (const a of attractors) {
      if (!a.alive) continue;
      let best = null; let bd = a.dMax * a.dMax;
      const cx = Math.floor(a.p[0] / CELL); const cy = Math.floor(a.p[1] / CELL); const cz = Math.floor(a.p[2] / CELL);
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
        const cell = grid.get(hashCell(x, y, z));
        if (!cell) continue;
        for (const n of cell) {
          const dx = a.p[0] - n.p[0]; const dy = a.p[1] - n.p[1]; const dz = a.p[2] - n.p[2];
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd >= bd) continue;
          const l = Math.sqrt(dd) || 1;
          if ((dx * n.d[0] + dy * n.d[1] + dz * n.d[2]) / l < coneCos) continue;
          bd = dd; best = n;
        }
      }
      if (!best) continue;
      if (bd < a.dMin * a.dMin) { a.alive = false; continue; }
      const dir = norm(sub(a.p, best.p));
      best.force = best.force ? add(best.force, dir) : dir;
      best.count++;
      active = true;
    }
    if (!active) {
      // Nothing in reach yet: climb toward the nearest attractor as a trunk instead of giving up.
      if (nodes.length > seedSpawns.length + 2000 || nodes.some((n) => n.kids.length > 1)) break;
      const alive = attractors.filter((a) => a.alive);
      if (!alive.length) break;
      const tips = nodes.filter((n) => !n.kids.length);
      for (const tip of tips) {
        const near = alive.reduce((a, b) => (Math.hypot(...sub(a.p, tip.p)) < Math.hypot(...sub(b.p, tip.p)) ? a : b));
        if (Math.hypot(...sub(near.p, tip.p)) >= near.dMax) tip.force = norm(sub(near.p, tip.p));
      }
      if (!tips.some((t) => t.force)) break;
    }
    const fresh = [];
    for (const n of nodes) {
      if (!n.force || n.dist >= fullLength) continue;
      let d = norm(add(n.force, mul(n.d, 0.5)));
      if (randomness) d = norm(add(d, mul(norm([hash(seed, nodes.length, fresh.length + 1) - 0.5, hash(seed, nodes.length, fresh.length + 2) - 0.5, hash(seed, nodes.length, fresh.length + 3) - 0.5]), randomness)));
      if (light) d = norm(add(d, [0, light, 0]));
      if (gravity) d = norm(add(d, [0, -gravity, 0]));
      const st = adaptive ? clamp(step0 * (2 / (1 + n.count)), minStep, step0) : step0;
      const m = { p: add(n.p, mul(d, st)), d, parent: n, dist: n.dist + st, kids: [], sp: n.sp };
      n.kids.push(m);
      fresh.push(m);
      if (nodes.length + fresh.length > 60000) break;
    }
    if (!fresh.length) break;
    for (const m of fresh) { nodes.push(m); index(m); }
  }

  // Longest child continues the line; the others start new lines.
  const reach = (n) => {
    let best = 0;
    for (const k of n.kids) best = Math.max(best, 1 + k.reach);
    n.reach = best;
  };
  for (let i = nodes.length - 1; i >= 0; i--) reach(nodes[i]);
  const radiusFor = (n) => {
    const P = node.params;
    const minR = +q.minRadius(c);
    const grow = q.growRadius(c) / 100;
    const parent = q.parentGrow(c) / 100;
    const maxR = q.maxRadius(c);
    let sum = 0;
    let longest = minR;
    for (const k of n.kids) { sum += k.r ** 2.5; longest = Math.max(longest, k.r); }
    const murray = n.kids.length > 1 ? sum ** (1 / 2.5) : longest;
    const base = longest + (murray - longest) * parent;
    const delta = step0 / ev.unit;
    n.r = Math.min(maxR, P.growMode === 'exponential' ? base * (1 + grow * delta) : base + grow * delta * minR * 2);
    return n.r;
  };
  for (let i = nodes.length - 1; i >= 0; i--) radiusFor(nodes[i]);

  const lines = [];
  const build = (start, parentLine, parentS, level, sp) => {
    const chain = [];
    let cur = start;
    while (cur) {
      chain.push(cur);
      cur = cur.kids.length ? cur.kids.reduce((a, b) => (b.reach > a.reach ? b : a)) : null;
    }
    if (chain.length < 2) return;
    const pts = new Float32Array(chain.length * 3);
    const radii = new Float32Array(chain.length);
    chain.forEach((n, i) => { pts.set(n.p, i * 3); radii[i] = n.r; });
    const d = norm(sub(chain[1].p, chain[0].p));
    const line = ev.newLine(node, { ...sp, p: chain[0].p, d, parent: parentLine, s: parentS, level, pos: parentLine ? parentS / parentLine.length : sp.pos || 0 }, pts, 0);
    finishLine(line);
    line.nominal = line.length;
    line.pointR = radii;
    line.radii = radii;
    line.r0 = radii[0];
    ev.segs += line.n;
    ev.applyChain(ev.chain(node, 'dir'), line);
    if (line.dead) return;
    if (line.pts.length / 3 !== radii.length) { line.pointR = null; line.radii = null; }
    lines.push(line);
    ev.lines.push(line);
    chain.forEach((n, i) => {
      for (const k of n.kids) {
        if (i + 1 < chain.length && k === chain[i + 1]) continue;
        build(n === k ? k : { ...k, p: n.p, kids: [k], reach: k.reach + 1, r: k.r, d: k.d }, line, line.len[i], level + 1, sp);
      }
    });
  };
  for (const n of nodes) if (!n.parent) build(n, n.sp.parent || null, n.sp.s || 0, n.sp.level || 0, n.sp);
  return ev.register(node, lines, srcChain);
}

// Shares radii across connected paths: tips set the base, parents grow from their children.
export function unifySkeleton(ev, node, lines) {
  const q = ev.q(node);
  const c = ev.ctx;
  c.line = null; c.t = 0;
  const minR = q.minRadius(c);
  const grow = q.growRadius(c) / 100;
  const parentGrow = q.parentGrow(c) / 100;
  const maxR = q.maxRadius(c);
  const exponential = node.params.growMode === 'exponential';
  const inSet = new Set(lines);
  const kids = new Map();
  for (const l of lines) {
    if (l.parent && inSet.has(l.parent)) (kids.get(l.parent) || kids.set(l.parent, []).get(l.parent)).push(l);
  }
  const done = new Set();
  const solve = (line) => {
    if (done.has(line)) return;
    done.add(line);
    const children = kids.get(line) || [];
    children.forEach(solve);
    const r = new Float32Array(line.n);
    const sorted = [...children].sort((a, b) => a.parentS - b.parentS);
    let cur = minR;
    let k = sorted.length - 1;
    for (let i = line.n - 1; i >= 0; i--) {
      const d = i < line.n - 1 ? (line.len[i + 1] - line.len[i]) / ev.unit : 0;
      cur = exponential ? cur * (1 + grow * d) : cur + grow * d * minR * 2;
      while (k >= 0 && sorted[k].parentS >= line.len[i]) {
        const cr = sorted[k].pointR ? sorted[k].pointR[0] : minR;
        const m = (cur ** 2.5 + cr ** 2.5) ** (1 / 2.5);
        cur += (m - cur) * parentGrow;
        k--;
      }
      r[i] = Math.min(cur, maxR);
    }
    line.pointR = r;
    line.radii = r;
    line.r0 = r[0];
  };
  for (const l of lines) solve(l);
}
