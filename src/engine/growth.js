// Growth: a node that grows itself, year by year, like a real tree (after Palubicki et al. 2009, "Self-organizing
// tree models"). Every year:
//   1. Light: each bud casts a soft shadow, a pyramid below it in a grid of internode-sized cells, and meshes in the
//      scene shade what is under them; a bud's light is what is left where it sits, and it leans toward brighter cells.
//   2. Each branch sums the light of everything above it, from the tips down.
//   3. Energy flows up from the root and splits at each fork: Apical (λ) favours the main stem over the side.
//   4. Each bud grows as many internodes as its energy allows, steered by its old heading, light (phototropism),
//      gravity (an angle it settles at) and noise; new side buds are set around it by the phyllotaxis angle.
//      A shoot that runs into a mesh slides along its surface (friction) instead of growing through it.
//   5. Branches that get too little light for their size are shed, so lower limbs drop and a bare trunk forms.
// Thickness follows the pipe model: each fork is as thick as its children together (r^n = Σ child r^n).
// The light grid is centred on the base and leaning sums every brighter neighbour, so nothing favours one side.
// The result is ordinary lines (one per axis, linked to their parents), so leaves, meshes and wind work as usual.
import { hash, norm, add, mul, sub, rotate, perpendicular, cross, dot, clamp, DEG } from './math.js';
import { finishLine } from './line.js';
import { makeShape } from './shapes.js';

export const GROWTH_DEFAULTS = {
  growYears: 18, internode: 30, budRadius: 0.5, pipeExp: 2.5, branchAngle: 45, phyllotaxis: 137.5, budsPerNode: 1,
  angNoise: 0.2, growSpeed: 2, apical: 0.52, decay: 0.9, shadowStrength: 1, shadowSize: 6, lightInfluence: 1,
  shedding: 0.25, verticalTrunk: 0.8, gravAngle: 70, gravInfluence: 0.25, photoInfluence: 0.4, favorUp: 0, favorSides: 0,
  growMax: 6000, cutTop: 0, cutSpread: 0, cutClear: 0, leafYears: 0,
  trunkThick: 0.65, leaderFade: 0, avoidMeshes: 1, lean: 0, leanDir: 0, droop: 0, shootMax: 6,
};

// Starting points per species (lengths in cm). Broadleaves have weak apical control (below 0.5) and many strong side
// limbs, so the crown rounds or spreads; the pine keeps a strong leader and level whorls, so it stays a cone.
// Every preset also sets light tubes: a grown tree has thousands of thin twigs.
const LIGHT = { sides: 8, minSides: 3, growMax: 6000 };
export const GROWTH_PRESETS = {
  // A light, open, rounded crown on a straight stem; long slender limbs with drooping tips.
  Birch: { ...LIGHT, growYears: 22, internode: 26, budRadius: 0.25, pipeExp: 2.7, trunkThick: 0.55, branchAngle: 40, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.3, growSpeed: 2.4, apical: 0.52, leaderFade: 0.3, decay: 0.92, shedding: 0.3, verticalTrunk: 0.7, gravAngle: 50, gravInfluence: 0.2, photoInfluence: 0.4, favorUp: 0, favorSides: 0.1, shadowSize: 6, droop: 0.35, cutClear: 100 },
  // A smaller egg-shaped crown: a straight stem with short limbs all the way up.
  Alder: { ...LIGHT, growYears: 20, internode: 22, budRadius: 0.3, pipeExp: 2.6, trunkThick: 0.6, branchAngle: 50, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.25, growSpeed: 2.2, apical: 0.515, leaderFade: 0.2, decay: 0.9, shedding: 0.3, verticalTrunk: 0.8, gravAngle: 65, gravInfluence: 0.3, photoInfluence: 0.35, favorUp: 0, favorSides: 0.3, shadowSize: 6, droop: 0.1, cutClear: 80 },
  // A vase: opposite buds, steep limbs from a clear trunk that open into a broad, flat-topped crown.
  Ash: { ...LIGHT, growYears: 22, internode: 32, budRadius: 0.45, pipeExp: 2.5, trunkThick: 0.6, branchAngle: 35, phyllotaxis: 90, budsPerNode: 2, angNoise: 0.25, growSpeed: 2.6, apical: 0.5, leaderFade: 0.4, decay: 0.92, shedding: 0.25, verticalTrunk: 0.5, gravAngle: 50, gravInfluence: 0.25, photoInfluence: 0.4, favorUp: 0, favorSides: 0.2, shadowSize: 7, cutClear: 200, droop: 0.15 },
  // Broad and spreading: a short trunk splits into heavy, crooked limbs under a wide dome.
  Oak: { ...LIGHT, growYears: 28, internode: 22, budRadius: 0.4, pipeExp: 2.4, trunkThick: 0.7, branchAngle: 65, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.5, growSpeed: 2.6, apical: 0.48, leaderFade: 0.8, decay: 0.95, shedding: 0.15, verticalTrunk: 0.2, gravAngle: 80, gravInfluence: 0.15, photoInfluence: 0.6, favorUp: -0.1, favorSides: 0.6, shadowSize: 8, cutClear: 180 },
  // A cone: one strong leader, whorls of level limbs that shorten toward the top, the lowest shed.
  Pine: { ...LIGHT, growYears: 26, internode: 30, budRadius: 0.4, pipeExp: 2.6, trunkThick: 0.6, branchAngle: 80, phyllotaxis: 137.5, budsPerNode: 5, angNoise: 0.15, growSpeed: 2.4, apical: 0.62, leaderFade: 0, decay: 0.5, shedding: 0.55, verticalTrunk: 1, gravAngle: 95, gravInfluence: 0.4, photoInfluence: 0.2, favorUp: 0, favorSides: 0.6, shadowSize: 4, shootMax: 2.5 },
  // A full round dome: opposite buds, many upswept limbs of near equal strength.
  Maple: { ...LIGHT, growYears: 24, internode: 24, budRadius: 0.4, pipeExp: 2.5, trunkThick: 0.65, branchAngle: 55, phyllotaxis: 90, budsPerNode: 2, angNoise: 0.35, growSpeed: 2.6, apical: 0.5, leaderFade: 0.5, decay: 0.93, shedding: 0.2, verticalTrunk: 0.5, gravAngle: 60, gravInfluence: 0.25, photoInfluence: 0.3, favorUp: 0, favorSides: 0.4, shadowSize: 8, cutClear: 150, droop: 0.25 },
  // Wide and weeping: limbs rise, then long thin shoots hang down.
  Willow: { ...LIGHT, growYears: 22, internode: 30, budRadius: 0.25, pipeExp: 2.6, trunkThick: 0.6, branchAngle: 30, phyllotaxis: 137.5, budsPerNode: 1, angNoise: 0.3, growSpeed: 3.5, apical: 0.48, leaderFade: 0.8, decay: 0.95, shedding: 0.1, verticalTrunk: 0.7, gravAngle: 65, gravInfluence: 0.3, photoInfluence: 0.3, favorUp: 0.1, favorSides: 0.4, shadowSize: 7, cutClear: 220, droop: 1.5 },
};

const UP = [0, 1, 0];
const num = (P, k) => { const v = +P[k]; return Number.isFinite(v) ? v : GROWTH_DEFAULTS[k]; };

// The 26 neighbouring cells, as offsets and unit directions.
const NEIGH = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) NEIGH.push([x, y, z, norm([x, y, z])]);

// The skeleton for one tree from base p, heading d. Returns its nodes: { p, d, parent, main, lats, order, alive, r }.
// obstacles: shapes ({ inside, closest, bounds }) the tree grows around and is shaded by.
export function simulateGrowth(P, seed, p0, d0, obstacles = []) {
  if (typeof obstacles === 'function') obstacles = [{ inside: obstacles }];
  const g = Object.fromEntries(Object.keys(GROWTH_DEFAULTS).map((k) => [k, num(P, k)]));
  const L = Math.max(0.5, g.internode);
  const years = clamp(Math.round(g.growYears), 1, 120);
  const qmax = clamp(Math.round(g.shadowSize), 1, 12);
  const a = Math.max(0, g.shadowStrength); const b = 2;
  const lambda0 = clamp(g.apical, 0.01, 0.99);
  const maxNodes = clamp(Math.round(g.growMax), 100, 200000);
  const per = clamp(Math.round(g.budsPerNode), 1, 8);
  let rnd = 0;
  const rand = () => hash(seed, ++rnd, 51);
  const obs = g.avoidMeshes > 0 ? (obstacles || []).filter((o) => o?.inside) : [];
  const blockedAt = (p) => obs.some((o) => (!o.bounds || (p[0] >= o.bounds[0][0] - 1 && p[0] <= o.bounds[1][0] + 1 && p[1] >= o.bounds[0][1] - 1 && p[1] <= o.bounds[1][1] + 1 && p[2] >= o.bounds[0][2] - 1 && p[2] <= o.bounds[1][2] + 1)) && o.inside(p));
  // A steady push to one side (wind, a wall of light), when Lean is set.
  const leanV = [Math.cos(g.leanDir * DEG), 0, Math.sin(g.leanDir * DEG)];
  // A random start around the stem, so even two-ranked buds (180°) don't all face one way on every tree.
  const nodes = [{ p: p0.slice(), d: norm(d0), parent: -1, main: -1, lats: [], order: 0, alive: true, buds: [], tip: true, Q: 0, sub: 0, count: 0, phase: rand() * 360, year: 0 }];
  // Cuts: nothing grows above Max height or beyond Max spread from the base; side branches start above Clear trunk.
  const cut = (p, order) => (g.cutTop > 0 && p[1] - p0[1] > g.cutTop) || (g.cutSpread > 0 && Math.hypot(p[0] - p0[0], p[2] - p0[2]) > g.cutSpread) || (order > 0 && g.cutClear > 0 && p[1] - p0[1] < g.cutClear);

  // Side buds on a new node: around its heading by the phyllotaxis angle, out by the branch angle.
  const addBuds = (n) => {
    const side = perpendicular(n.d);
    for (let k = 0; k < per; k++) {
      const around = (n.phase + (per > 1 ? k * (360 / per) : 0)) * DEG;
      const out = rotate(n.d, rotate(side, n.d, around), g.branchAngle * DEG);
      n.buds.push({ d: norm(out), used: false, Q: 0, v: 0 });
    }
  };

  // Cells are centred on the base, so the trunk sits in the middle of its cell column, not on a corner.
  const cell = (p) => [Math.round((p[0] - p0[0]) / L), Math.round((p[1] - p0[1]) / L), Math.round((p[2] - p0[2]) / L)];
  const key = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
  const centre = (I, J, K) => [p0[0] + I * L, p0[1] + J * L, p0[2] + K * L];
  // Cells inside a mesh, and cells a mesh shades from above (kept across years: meshes don't move).
  const solid = new Map(); const roof = new Map();
  const isSolid = (I, J, K) => { const k = key(I, J, K); let v = solid.get(k); if (v === undefined) { v = blockedAt(centre(I, J, K)); solid.set(k, v); } return v; };
  const roofed = (I, J, K) => {
    const k = key(I, J, K); let v = roof.get(k);
    // Darkest right under it, lighter farther down, never fully dark: light still comes in from the sides.
    if (v === undefined) { v = 0; for (let q = 1; q <= qmax * 2 && !v; q++) if (isSolid(I, J + q, K)) v = 0.85 * (1 - (q - 1) / (qmax * 2)); roof.set(k, v); }
    return v;
  };

  for (let year = 0; year < years; year++) {
    const live = nodes.filter((n) => n.alive);
    if (live.length >= maxNodes) break;
    let budget = maxNodes - live.length;
    // Leader fade: a broadleaf's leader loses its lead as the tree ages, so the crown opens into limbs.
    const lambda = clamp(lambda0 - g.leaderFade * 0.06 * (year / years), 0.01, 0.99);
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
    const shadeOf = (I, J, K) => (shade.get(key(I, J, K)) || 0) + (obs.length ? (isSolid(I, J, K) ? C + a : roofed(I, J, K) * (C + a)) : 0);
    const lightAt = (p) => { const [I, J, K] = cell(p); return clamp((C - shadeOf(I, J, K) + a) / C, 0, 1); };
    // Toward the light: every neighbouring cell ahead pulls by how much brighter it is than the average, so in even
    // light the pull is zero and the shoot keeps its heading.
    const towardLight = (p, d) => {
      const [I, J, K] = cell(p);
      let sum = 0; let cnt = 0; const ls = [];
      for (const [x, y, z, v] of NEIGH) {
        if (dot(v, d) < -0.2) continue;
        const l = 1 / (1 + shadeOf(I + x, J + y, K + z)); ls.push([v, l]); sum += l; cnt++;
      }
      const mean = sum / Math.max(1, cnt);
      let pull = [0, 0, 0];
      for (const [v, l] of ls) pull = add(pull, mul(v, l - mean));
      const m = Math.hypot(...pull);
      return m > 1e-6 ? mul(pull, Math.min(1, m * 4) / m) : [0, 0, 0];
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
    // 3. Energy from the root up, split at every fork.
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
      const order = nodes[s.from].order + (s.axis ? 0 : 1);
      // The longest shoot a year: the leader's, shorter on each order of side branch (by Decay), rounded by chance.
      const cap = clamp(g.shootMax, 0.2, 12) * g.decay ** order;
      let steps = Math.min(Math.floor(cap + rand()), Math.floor(s.v)); if (steps < 1) continue;
      if (s.bud) s.bud.used = true;
      let at = s.from; let d = s.d; let first = true;
      while (steps-- > 0 && budget > 0) {
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
        let nd = norm(add(add(add(add(d, mul(lean, g.photoInfluence)), mul(trop, g.gravInfluence)), mul(noise, g.angNoise)), mul(leanV, g.lean)));
        if (order === 0) nd = norm(add(mul(nd, 1 - g.verticalTrunk), mul(UP, g.verticalTrunk)));
        // Hanging twigs: shoots past the first limbs bend down under their own weight (birch tips, a weeping willow).
        else if (order >= 2 && g.droop > 0) nd = norm(add(nd, [0, -g.droop * Math.min(1, (order - 1) * 0.6), 0]));
        let p = add(from.p, mul(nd, L));
        // Friction: a shoot that meets a mesh slides along its surface; one that can't get round it stops.
        if (obs.length && blockedAt(p)) {
          const o = obs.find((x) => x.inside(p)); const c = o?.closest?.(p);
          if (!c?.n) break;
          const n0 = c.d < 0 ? c.n : mul(c.n, -1);
          const out = dot(n0, sub(p, c.p)) < 0 ? mul(c.n, -1) : c.n;
          nd = norm(add(sub(nd, mul(out, dot(nd, out))), mul(out, 0.35)));
          p = add(from.p, mul(nd, L));
          if (blockedAt(p)) break;
        }
        if (p[1] < p0[1] - L || cut(p, order)) break;
        const idx = nodes.length;
        const n = { p, d: nd, parent: at, main: -1, lats: [], order, alive: true, buds: [], tip: true, phase: from.phase + g.phyllotaxis, Q: 0, sub: 0, count: 0, year };
        nodes.push(n); budget--;
        if (first && !s.axis) { from.lats.push(idx); n.lat = true; }
        else { from.main = idx; from.tip = false; }
        addBuds(n);
        at = idx; d = nd; first = false;
      }
    }
  }
  // Thickness: tips at the bud radius, every fork as thick as its children together; Trunk thickness scales what
  // the pipe model adds above the twig size.
  for (const n of nodes) n.r = 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]; if (!n.alive) continue;
    const kids = [n.main, ...n.lats].filter((c) => c >= 0 && nodes[c].alive);
    n.pr = kids.length ? kids.reduce((s, c) => s + nodes[c].pr ** g.pipeExp, 0) ** (1 / g.pipeExp) : g.budRadius;
  }
  const k = Math.max(0, g.trunkThick);
  for (const n of nodes) if (n.alive) n.r = g.budRadius + (n.pr - g.budRadius) * k;
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

// Every mesh in the scene, as shapes the tree grows around (built once per evaluation).
function sceneObstacles(ev) {
  if (ev._growObs) return ev._growObs;
  const out = [];
  for (const n of ev.graph?.nodes || []) {
    if (n.type !== 'SceneObject' || n.on === false) continue;
    let s = ev.shapes?.get(n.id);
    if (!s) { try { s = makeShape(n.params); ev.shapes?.set(n.id, s); } catch { s = null; } }
    if (s?.inside) out.push(s);
  }
  return (ev._growObs = out);
}

// Age stretches or shortens the years grown, so a young Growth tree is a smaller, younger tree, not a shrunk one.
export function yearsAtAge(P, life) {
  const y = num(P, 'growYears');
  if (!life) return y;
  return Math.max(1, Math.round(y * clamp(+life.age || 0, 0.05, 1.5) * (life.growAt ? life.growAt(life.age) : 1)));
}

// Lines for the evaluator: one per axis, each starting at its fork on the parent's line.
export function growthLines(ev, node, spawns, srcChain) {
  const P0 = node.params;
  const years = yearsAtAge(P0, ev.life);
  const P = { ...P0, growYears: years };
  const seed = ev.h(node);
  const lines = [];
  const shape = ev.shapeLinked?.(node);
  const obstacles = sceneObstacles(ev);
  if (shape?.inside && !obstacles.includes(shape)) obstacles.push(shape);
  spawns.forEach((sp, si) => {
    const nodes = simulateGrowth(P, (seed + si * 977) | 0, sp.p, sp.d, obstacles);
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
      // Leaves on young wood only: children start where this axis is younger than Leaves on the last N years.
      const ly = Math.round(num(P, 'leafYears'));
      if (ly > 0) {
        const i = chain.findIndex((n) => n !== fork && n.year >= years - ly);
        line.youngFrom = i < 0 ? 1 : line.len[i] / Math.max(1e-6, line.length);
      }
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
