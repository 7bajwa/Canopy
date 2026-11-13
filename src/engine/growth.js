// Growth: a Spline that grows itself, year by year, like a real tree (after Palubicki et al. 2009, "Self-organizing
// tree models"). Every year:
//   1. Light: each bud casts a soft shadow, a pyramid below it in a grid of internode-sized cells; a bud's light is
//      what is left where it sits, and it leans toward the brightest neighbouring cell.
//   2. Each branch sums the light of everything above it, from the tips down.
//   3. Growth power flows up from the root and splits at each fork: Apical (λ) favours the main stem over the side.
//   4. Each bud grows as many internodes as its power allows, steered by its old heading, light (phototropism),
//      gravity (an angle it settles at) and noise; new side buds are set around it by the phyllotaxis angle.
//   5. Branches that get too little light for their size are shed, so lower limbs drop and a bare trunk forms.
// Thickness follows the pipe model: each fork is as thick as its children together (r^n = Σ child r^n).
// The result is ordinary lines (one per axis, linked to their parents), so leaves, meshes and wind work as usual.
import { hash, norm, add, mul, sub, rotate, perpendicular, cross, dot, clamp, DEG } from './math.js';
import { finishLine } from './line.js';

export const GROWTH_DEFAULTS = {
  growYears: 18, internode: 30, budRadius: 0.5, pipeExp: 2.5, branchAngle: 45, phyllotaxis: 137.5, budsPerNode: 1,
  angNoise: 0.2, growSpeed: 2, apical: 0.52, decay: 0.9, shadowStrength: 1, shadowSize: 6, lightInfluence: 1,
  shedding: 0.25, verticalTrunk: 0.8, gravAngle: 70, gravInfluence: 0.25, photoInfluence: 0.4, favorUp: 0, favorSides: 0,
  growMax: 6000,
};

// Starting points per species (estimates to tune by eye; lengths in cm).
// Every preset also sets light tubes: a grown tree has thousands of thin twigs.
const LIGHT = { sides: 8, minSides: 3, growMax: 6000 };
export const GROWTH_PRESETS = {
  Birch: { ...LIGHT, growYears: 22, internode: 25, budRadius: 0.3, branchAngle: 40, phyllotaxis: 180, budsPerNode: 1, angNoise: 0.25, growSpeed: 2.2, apical: 0.53, decay: 0.9, shedding: 0.3, verticalTrunk: 0.8, gravAngle: 95, gravInfluence: 0.3, photoInfluence: 0.4, favorUp: 0.1, favorSides: 0.3 },
  Alder: { ...LIGHT, growYears: 20, internode: 22, budRadius: 0.35, branchAngle: 45, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.2, growSpeed: 2, apical: 0.54, decay: 0.9, shedding: 0.35, verticalTrunk: 0.9, gravAngle: 60, gravInfluence: 0.25, photoInfluence: 0.3, favorUp: 0.2, favorSides: 0.2 },
  Ash: { ...LIGHT, growYears: 22, internode: 35, budRadius: 0.5, branchAngle: 35, phyllotaxis: 90, budsPerNode: 2, angNoise: 0.2, growSpeed: 1.8, apical: 0.51, decay: 0.85, shedding: 0.25, verticalTrunk: 0.6, gravAngle: 45, gravInfluence: 0.2, photoInfluence: 0.4, favorUp: 0.4, favorSides: 0 },
  Oak: { ...LIGHT, growYears: 30, internode: 20, budRadius: 0.45, branchAngle: 55, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.45, growSpeed: 2, apical: 0.49, decay: 0.92, shedding: 0.15, verticalTrunk: 0.3, gravAngle: 75, gravInfluence: 0.15, photoInfluence: 0.6, favorUp: 0, favorSides: 0.5, shadowSize: 8 },
  Pine: { ...LIGHT, growYears: 26, internode: 30, budRadius: 0.4, branchAngle: 70, phyllotaxis: 72, budsPerNode: 5, angNoise: 0.15, growSpeed: 2.4, apical: 0.58, decay: 0.8, shedding: 0.45, verticalTrunk: 1, gravAngle: 90, gravInfluence: 0.4, photoInfluence: 0.2, favorUp: 0, favorSides: 0.6, shadowSize: 4 },
  Maple: { ...LIGHT, growYears: 24, internode: 25, budRadius: 0.45, branchAngle: 45, phyllotaxis: 90, budsPerNode: 2, angNoise: 0.3, growSpeed: 2, apical: 0.5, decay: 0.9, shedding: 0.2, verticalTrunk: 0.5, gravAngle: 50, gravInfluence: 0.2, photoInfluence: 0.5, favorUp: 0.3, favorSides: 0.2, shadowSize: 8 },
  Willow: { ...LIGHT, growYears: 22, internode: 30, budRadius: 0.3, branchAngle: 35, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.25, growSpeed: 2.6, apical: 0.47, decay: 0.95, shedding: 0.2, verticalTrunk: 0.4, gravAngle: 150, gravInfluence: 0.6, photoInfluence: 0.3, favorUp: 0.4, favorSides: 0 },
};

const UP = [0, 1, 0];
const num = (P, k) => { const v = +P[k]; return Number.isFinite(v) ? v : GROWTH_DEFAULTS[k]; };

// The skeleton for one tree from base p, heading d. Returns its nodes: { p, d, parent, main, lats, order, alive, r }.
// obstacle(p) -> true where growth may not go.
export function simulateGrowth(P, seed, p0, d0, obstacle = null) {
  const g = Object.fromEntries(Object.keys(GROWTH_DEFAULTS).map((k) => [k, num(P, k)]));
  const L = Math.max(0.5, g.internode);
  const years = clamp(Math.round(g.growYears), 1, 120);
  const qmax = clamp(Math.round(g.shadowSize), 1, 12);
  const a = Math.max(0, g.shadowStrength); const b = 2;
  const lambda = clamp(g.apical, 0.01, 0.99);
  const maxNodes = clamp(Math.round(g.growMax), 100, 200000);
  const per = clamp(Math.round(g.budsPerNode), 1, 8);
  let rnd = 0;
  const rand = () => hash(seed, ++rnd, 51);
  const nodes = [{ p: p0.slice(), d: norm(d0), parent: -1, main: -1, lats: [], order: 0, alive: true, buds: [], tip: true, Q: 0, sub: 0, count: 0, phase: 0 }];

  // Side buds on a new node: around its heading by the phyllotaxis angle, out by the branch angle.
  const addBuds = (n) => {
    const side = perpendicular(n.d);
    for (let k = 0; k < per; k++) {
      const around = (n.phase + (per > 1 ? k * (360 / per) : 0)) * DEG;
      const out = rotate(n.d, rotate(side, n.d, around), g.branchAngle * DEG);
      n.buds.push({ d: norm(out), used: false, Q: 0, v: 0 });
    }
  };

  const cell = (p) => [Math.floor(p[0] / L), Math.floor(p[1] / L), Math.floor(p[2] / L)];
  const key = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);

  for (let year = 0; year < years; year++) {
    const live = nodes.filter((n) => n.alive);
    if (live.length >= maxNodes) break;
    // 1. Shadows, cast by every bud that can still grow.
    const shade = new Map();
    const cast = (p) => {
      const [I, J, K] = cell(p);
      for (let q = 0; q <= qmax; q++) {
        const s = a * b ** -q;
        for (let dx = -q; dx <= q; dx++) for (let dz = -q; dz <= q; dz++) {
          const kk = key(I + dx, J - q, K + dz); shade.set(kk, (shade.get(kk) || 0) + s);
        }
      }
    };
    // One shadow per node with a bud left (its buds sit together); a bud doesn't shade itself (the +a below).
    for (const n of live) if (n.tip || n.buds.some((bd) => !bd.used)) cast(n.p);
    // Full light is two shadows' worth, so a bud under one layer of leaves still gets some (0..1 after scaling).
    const C = 2 * Math.max(a, 1e-6);
    const lightAt = (p) => { const [I, J, K] = cell(p); return Math.max(C - (shade.get(key(I, J, K)) || 0) + a, 0) / C; };
    // The brightest neighbouring cell, as a direction to lean toward.
    const towardLight = (p, d) => {
      const [I, J, K] = cell(p); let best = null; let bs = Infinity;
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const v = norm([x, y, z]); if (dot(v, d) < 0) continue;
        const s = shade.get(key(I + x, J + y, K + z)) || 0;
        if (s < bs) { bs = s; best = v; }
      }
      return best || d;
    };
    // A bud feels the light half a step out the way it points, not inside its own branch.
    const budQ = (p, d) => {
      const q = 1 + (lightAt(add(p, mul(d, L * 0.5))) - 1) * clamp(g.lightInfluence, 0, 1);
      const up = dot(d, UP);
      return Math.max(0, q * (1 + g.favorUp * up + g.favorSides * (1 - Math.abs(up))));
    };
    // 2. Light gathered from the tips down (children come after their parents in the list).
    for (const n of live) {
      n.tQ = n.tip ? budQ(n.p, n.d) : 0;
      for (const bd of n.buds) bd.Q = bd.used ? 0 : budQ(n.p, bd.d);
      n.sub = 0; n.count = 1;
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]; if (!n.alive) continue;
      n.Qm = n.tip ? n.tQ : n.main >= 0 && nodes[n.main].alive ? nodes[n.main].sub : 0;
      n.Ql = n.buds.reduce((s, bd) => s + bd.Q, 0) + n.lats.reduce((s, c) => s + (nodes[c].alive ? nodes[c].sub : 0), 0);
      n.sub = n.Qm + n.Ql;
      if (n.parent >= 0) nodes[n.parent].count += n.count;
    }
    // 5. Shedding (from the third year): side branches whose light per node is too low drop off.
    if (year >= 2 && g.shedding > 0) {
      for (const n of live) {
        if (!n.lat) continue;
        if (n.sub / Math.max(1, n.count) < g.shedding * 0.5) killFrom(nodes, n);
      }
    }
    // 3. Power from the root up, split at every fork.
    const v = new Map(); v.set(0, g.growSpeed * nodes[0].sub);
    const grow = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; if (!n.alive) continue;
      const vin = v.get(i) || 0;
      const den = lambda * n.Qm + (1 - lambda) * n.Ql;
      if (den <= 0 || vin <= 0) continue;
      const vm = (vin * lambda * n.Qm) / den; const vl = ((vin * (1 - lambda) * n.Ql) / den) * g.decay;
      if (n.tip) grow.push({ from: i, d: n.d, v: vm, axis: true });
      else if (n.main >= 0) v.set(n.main, (v.get(n.main) || 0) + vm);
      for (const bd of n.buds) if (!bd.used && bd.Q > 0) grow.push({ from: i, d: bd.d, v: (vl * bd.Q) / n.Ql, bud: bd });
      for (const c of n.lats) if (nodes[c].alive) v.set(c, (v.get(c) || 0) + (vl * nodes[c].sub) / n.Ql);
    }
    // 4. Shoots.
    for (const s of grow) {
      let steps = Math.min(6, Math.floor(s.v)); if (steps < 1) continue;
      if (s.bud) s.bud.used = true;
      let at = s.from; let d = s.d; let first = true;
      const order = nodes[s.from].order + (s.axis ? 0 : 1);
      while (steps-- > 0 && nodes.length < maxNodes) {
        const from = nodes[at];
        // Heading: the old one, toward light, toward its settled angle under gravity, plus noise.
        const lean = towardLight(from.p, d);
        let trop;
        if (order === 0) trop = UP;
        else {
          const ax = cross(UP, d); const flat = Math.hypot(...ax) < 1e-4 ? perpendicular(UP) : norm(ax);
          trop = norm(rotate(UP, flat, g.gravAngle * DEG));
        }
        const noise = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
        let nd = norm(add(add(add(d, mul(lean, g.photoInfluence)), mul(trop, g.gravInfluence)), mul(noise, g.angNoise)));
        if (order === 0) nd = norm(add(mul(nd, 1 - g.verticalTrunk), mul(UP, g.verticalTrunk)));
        const p = add(from.p, mul(nd, L));
        if (obstacle?.(p) || p[1] < -L) break;
        const idx = nodes.length;
        const n = { p, d: nd, parent: at, main: -1, lats: [], order, alive: true, buds: [], tip: true, phase: from.phase + g.phyllotaxis, Q: 0, sub: 0, count: 0 };
        nodes.push(n);
        if (first && !s.axis) { from.lats.push(idx); n.lat = true; }
        else { from.main = idx; from.tip = false; }
        addBuds(n);
        at = idx; d = nd; first = false;
      }
    }
  }
  // Thickness: tips at the bud radius, every fork as thick as its children together.
  for (const n of nodes) n.r = 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]; if (!n.alive) continue;
    const kids = [n.main, ...n.lats].filter((c) => c >= 0 && nodes[c].alive);
    n.r = kids.length ? kids.reduce((s, c) => s + nodes[c].r ** g.pipeExp, 0) ** (1 / g.pipeExp) : g.budRadius;
  }
  return nodes;
}

function killFrom(nodes, n) {
  const stack = [n];
  while (stack.length) {
    const m = stack.pop(); if (!m.alive) continue;
    m.alive = false;
    for (const c of [m.main, ...m.lats]) if (c >= 0) stack.push(nodes[c]);
  }
}

// Lines for the evaluator: one per axis, each starting at its fork on the parent's line.
export function growthLines(ev, node, spawns, srcChain) {
  const P = node.params;
  const seed = ev.h(node);
  const lines = [];
  const shape = ev.shapeLinked?.(node);
  const obstacle = shape?.inside ? (p) => shape.inside(p) : null;
  spawns.forEach((sp, si) => {
    const nodes = simulateGrowth(P, (seed + si * 977) | 0, sp.p, sp.d, obstacle);
    const build = (startIdx, fork, parentLine, parentS, level) => {
      const chain = fork ? [fork] : [];
      for (let i = startIdx; i >= 0 && nodes[i].alive; i = nodes[i].main) chain.push(nodes[i]);
      if (chain.length < 2) return;
      const pts = new Float32Array(chain.length * 3); const radii = new Float32Array(chain.length);
      chain.forEach((n, i) => { pts.set(n.p, i * 3); radii[i] = n === fork ? nodes[startIdx].r : n.r; });
      const line = ev.newLine(node, { ...sp, p: chain[0].p, d: norm(sub(chain[1].p, chain[0].p)), parent: parentLine, s: parentS, level, pos: parentLine ? parentS / Math.max(1e-6, parentLine.length) : sp.pos || 0 }, pts, 0);
      finishLine(line);
      line.nominal = line.length;
      line.pointR = radii; line.radii = radii; line.r0 = radii[0];
      ev.segs += line.n;
      ev.applyChain(ev.chain(node, 'dir'), line);
      if (line.dead) return;
      if (line.pts.length / 3 !== radii.length) { line.pointR = null; line.radii = null; }
      lines.push(line); ev.lines.push(line);
      chain.forEach((n, i) => {
        if (n === fork) return;
        for (const c of n.lats) if (nodes[c].alive) build(c, n, line, line.len[i], level + 1);
      });
    };
    build(0, null, sp.parent || null, sp.s || 0, sp.level || 0);
  });
  return ev.register(node, lines, srcChain);
}
