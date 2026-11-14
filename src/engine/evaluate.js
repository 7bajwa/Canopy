// Turns a node graph into meshes: walks distributors and paths, then builds geometry.
import { NODE_TYPES, socketsOf } from '../graph/schema.js';
import { hash, hashString, clamp, DEG, bakeCurve, sampleCurve, dot, norm, sub } from './math.js';
import { finishLine, ensureFrames, pointAt, tOf } from './line.js';
import { makeShape, shapeSize } from './shapes.js';
import { MODIFIERS } from './modifiers.js';
import { makeSpawns, drawnLines } from './distribute.js';
import { growColonization, cloudPoints, unifySkeleton } from './colonize.js';
import { growthLines } from './growth.js';
import { buildCylinders, prepareJunctions, MeshBuf, computeRadii, compsOf } from './tube.js';
import { buildLeaves, buildStandardLeaves, buildInstances } from './leaves.js';
import { buildMeta } from './meta.js';
import { inlineModifiers } from './builtins.js';
import { expandGraph, ownerOf } from './expand.js';
import { applyMeshMods, avoidMesh } from './meshmods.js';
import { applyMods, computeNormals } from './primitive.js';
import { windTable } from './wind.js';
import { bakeOcclusion } from './ao.js';
import { lifeOf, lifeLine } from './life.js';

const AT = { start: 0, mid: 0.5, end: 1 };

export const MIX_OPS = {
  add: (x, y) => x + y, sub: (x, y) => x - y, mul: (x, y) => x * y, div: (x, y) => (y === 0 ? 0 : x / y),
  pow: (x, y) => x ** y, min: Math.min, max: Math.max, mod: (x, y) => (y === 0 ? 0 : x % y),
  avg: (x, y) => (x + y) / 2, diff: (x, y) => Math.abs(x - y), mix: (x, y) => y,
};
export const mixValue = (op, a, b, t) => { const r = (MIX_OPS[op] || MIX_OPS.add)(a, b); return a + (r - a) * Math.max(0, Math.min(1, t)); };

export class Evaluator {
  constructor(source, opts = {}) {
    const graph = expandGraph(source);
    this.graph = graph;
    this.images = opts.images || null;
    this.draft = !!opts.draft;
    // Level of detail for exports: 0 full, each level up thins tubes and leaves (see lodKeep).
    this.lod = Math.max(0, Math.min(3, Math.round(+opts.lod || 0)));
    this.camera = opts.camera || [0, 0, 500];
    const s = graph.settings || {};
    this.seed = s.seed ?? 1;
    // Age, Season and Health sliders, when turned on.
    this.life = lifeOf(s);
    this.unit = s.unitCalc || 100;
    this.segLimit = s.segLimit || 400;
    this.maxSegs = s.maxSegments || 400000;
    this.maxLines = s.maxLines || 150000;
    this.blendOn = s.blendOn !== false;
    this.nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    this.linksOut = new Map();
    this.linksIn = new Map();
    for (const l of graph.links) {
      if (!this.nodes.has(l.from) || !this.nodes.has(l.to)) continue;
      const a = `${l.from}.${l.fromSock}`; const b = `${l.to}.${l.toSock}`;
      (this.linksOut.get(a) || this.linksOut.set(a, []).get(a)).push(l);
      (this.linksIn.get(b) || this.linksIn.set(b, []).get(b)).push(l);
    }
    this.ctx = { t: 0, lineId: 0, level: 0, pos: 0, chainPos: 0, length: 0, radius: 0, angleDiv: 0, angleBend: 0, offset: 0, distance: 0, surfaceLevel: 0, line: null, parentLine: null };
    this.lines = [];
    this.lineCount = 0;
    this.lineSlots = new Map(); this.lineIds = new Set();
    this.segs = 0;
    this.jobs = new Map();
    this.warnings = new Set();
    this.boxes = new Map();
    this.compiled = new Map();
    this.chains = new Map();
    this.shapes = new Map();
    this.skeletons = new Map();
    this.pathLines = new Map();
    this.hashes = new Map();
    this.running = new Set();
    this.afterPaths = [];
  }

  on(n) { return n && n.on !== false; }
  out(id, sock) { return (this.linksOut.get(`${id}.${sock}`) || []).filter((l) => this.on(this.nodes.get(l.to))); }
  in(id, sock) { return (this.linksIn.get(`${id}.${sock}`) || []).filter((l) => this.on(this.nodes.get(l.from))); }
  h(node) {
    let v = this.hashes.get(node.id);
    if (v === undefined) { v = hashString(node.id) ^ (node.params.seedOffset || 0) * 1299709; this.hashes.set(node.id, v); }
    return v ^ Math.imul(this.seed, 2654435761);
  }

  // Compiled parameter accessors for a node: q.length(ctx) etc. Plain numbers stay as fast constants.
  q(node) {
    let q = this.compiled.get(node.id);
    if (q) return q;
    q = {};
    for (const p of NODE_TYPES[node.type].params) if (p.t === 'num') q[p.k] = this.param(node, p);
    this.compiled.set(node.id, q);
    return q;
  }

  param(node, p) {
    const base = +(node.params[p.k] ?? p.d);
    const vl = this.in(node.id, `p:${p.k}`)[0];
    const cl = this.in(node.id, `c:${p.k}`)[0];
    let f;
    if (vl) {
      const src = this.valueFn(vl);
      f = this.nodes.get(vl.from).type === 'Affect' ? (c) => base * src(c) : src;
    } else f = () => base;
    if (cl) {
      const cn = this.nodes.get(cl.from);
      const sample = this.curveFn(cn);
      if (cn.params.mode === 'value') f = sample;
      else { const g = f; f = (c) => g(c) * sample(c); }
    }
    // The curve and variation icons on a value: the same idea as wiring in a Curve or Random node.
    // A value can have one curve per level of the chain: its own line, each parent, and the whole plant.
    let inner = false;
    for (const [key, curve] of Object.entries(node.params.curves || {})) {
      if (key !== p.k && !key.startsWith(`${p.k}@`)) continue;
      inner = true;
      const table = bakeCurve(curve);
      const g = f;
      const scope = key.slice(p.k.length + 1);
      if (scope === 'global') f = (c) => g(c) * sampleCurve(table, this.globalAt(c));
      else if (scope) f = (c) => g(c) * sampleCurve(table, this.chainAt(c, scope));
      else f = p.along === 'pos' ? (c) => g(c) * sampleCurve(table, c.pos) : (c) => g(c) * sampleCurve(table, c.t);
    }
    const vary = +node.params.vary?.[p.k] || 0;
    if (vary) {
      const g = f;
      const salt = hashString(p.k);
      const seed = this.h(node);
      // Values that sit at 0 (angles, offsets) vary by an amount of their own; a percentage of 0 would do nothing.
      f = p.abs
        ? (c) => g(c) + vary * (hash(seed, c.lineId, salt) * 2 - 1)
        : (c) => g(c) * (1 + (vary / 100) * (hash(seed, c.lineId, salt) * 2 - 1));
    }
    f.linked = !!(vl || cl || inner);
    return f;
  }

  // Where a value is being read on its chain: the line itself, or the parent it is about to grow from.
  chainStart(c) { return c.line ? [c.line, c.t] : [c.parentLine, c.pos]; }

  // How far along one ancestor (by the node a person sees) this point of the chain attaches.
  chainAt(c, owner) {
    let [line, at] = this.chainStart(c);
    while (line) {
      if (ownerOf(line.node.id) === owner) return at;
      at = line.parent ? tOf(line.parent, line.parentS) : 0;
      line = line.parent;
    }
    return 0;
  }

  // How far from the root of the plant to the tip of this line.
  globalAt(c) {
    const [line, at] = this.chainStart(c);
    if (!line) return c.t;
    return (line.rootDist + at * line.length) / Math.max(1e-3, line.rootDist + line.length);
  }

  curveFn(cn) {
    const table = bakeCurve(cn.params.curve);
    const rep = Math.max(1, Math.round(cn.params.repeat || 1));
    const scale = +cn.params.scale || 1;
    const lookup = (t) => sampleCurve(table, rep > 1 ? (t * rep) % 1 : t) * scale;
    const fn = (c) => lookup(c.t);
    fn.at = lookup;
    return fn;
  }

  valueFn(link) {
    const n = this.nodes.get(link.from);
    const key = link.fromSock;
    if (this.running.has(n.id)) { this.warnings.add('A value loop was found and ignored.'); return () => 0; }
    this.running.add(n.id);
    try { return this.valueOf(n, key); } finally { this.running.delete(n.id); }
  }

  valueOf(n, key) {
    const P = n.params;
    const seed = this.h(n);
    const round = P.kind === 'integer' ? Math.round : (x) => x;
    switch (n.type) {
      case 'Value': { const v = round(+P.value); return () => v; }
      case 'Public': {
        let v = +P.value;
        if (P.clamp) v = clamp(v, +P.min, +P.max);
        if (P.kind === 'boolean') v = v > 0 ? 1 : 0;
        v = round(v);
        return () => v;
      }
      case 'Random': {
        const lo = +P.min; const hi = +P.max;
        return P.kind === 'integer'
          ? (c) => Math.floor(lo + hash(seed, c.lineId) * (hi - lo + 1))
          : (c) => lo + hash(seed, c.lineId) * (hi - lo);
      }
      case 'Math': {
        const { a, b } = this.q(n);
        const { t } = this.q(n);
        if (P.op === 'mix') return (c) => { const k = t(c); return round(a(c) * (1 - k) + b(c) * k); };
        const op = MIX_OPS[P.op] || MIX_OPS.mul;
        return (c) => round(op(a(c), b(c)));
      }
      case 'Mix': {
        // Blend 0 passes A through; 1 gives the full A (op) B result.
        const { a, b, t } = this.q(n);
        return (c) => mixValue(P.op, a(c), b(c), t(c));
      }
      case 'Affect': return this.affectFn(n, seed);
      case 'AttributePosition': return this.attrPos(n);
      case 'AttributeDistance': return this.attrDist(n);
      case 'AttributeIDs': return P.kind === 'line' ? (c) => c.lineId : P.kind === 'parent' ? (c) => (c.line?.parent ? c.line.parent.id : 0) : (c) => c.level;
      default:
        // An exposed setting's output passes on its value, curves and variation included.
        if (key.startsWith('o:')) { const p = NODE_TYPES[n.type].params.find((x) => x.k === key.slice(2)); if (p?.t === 'num') return this.param(n, p); }
        if (key === 'pathPos') return (c) => c.pos * 100;
        if (key === 'angle') return (c) => this.angleAt(c.line, c.t);
        return (c) => +c[key] || 0;
    }
  }

  affectFn(n, seed) {
    const P = n.params;
    const inp = this.in(n.id, 'p:input')[0];
    let input = inp ? this.valueFn(inp) : (c) => c.pos * 100;
    if (inp?.fromSock === 'pathPos' && P.posMode === 'chain') input = (c) => c.chainPos * 100;
    const lo = +P.min; const span = (+P.max - lo) || 1;
    const factor = +P.factor;
    const chaos = (+P.chaos || 0) / 100;
    const cl = this.in(n.id, 'c:factor')[0];
    const curve = cl ? this.curveFn(this.nodes.get(cl.from)) : null;
    return (c) => {
      let f = factor;
      if (curve) f *= curve.at(clamp((input(c) - lo) / span, 0, 1));
      if (chaos) f *= 1 - chaos * hash(seed, c.lineId);
      return f;
    };
  }

  angleAt(line, t) {
    if (!line || line.n < 3) return 0;
    const i = clamp(Math.round(t * (line.n - 1)), 1, line.n - 2) * 3;
    const p = line.pts;
    const a = norm([p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]]);
    const b = norm([p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]]);
    return Math.acos(clamp(dot(a, b), -1, 1)) / DEG;
  }

  attrPoint(line, at, target) {
    if (!line) return [0, 0, 0];
    if (at in AT) return pointAt(line, AT[at] * line.length);
    let best = null; let bd = at === 'far' ? -1 : Infinity;
    for (let i = 0; i < line.n; i++) {
      const q = [line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2]];
      const d = Math.hypot(...sub(q, target));
      if (at === 'far' ? d > bd : d < bd) { bd = d; best = q; }
    }
    return best;
  }

  attrPos(n) {
    const { at, axis } = n.params;
    return (c) => {
      const p = this.attrPoint(c.line, at, [0, 0, 0]);
      return axis === 'x' ? p[0] : axis === 'z' ? p[2] : axis === 'height' ? p[1] : Math.hypot(p[0], p[2]);
    };
  }

  attrDist(n) {
    const { at, target, point } = n.params;
    const shape = target === 'object' ? this.shapeLinked(n) : null;
    return (c) => {
      const tgt = point || [0, 0, 0];
      const p = this.attrPoint(c.line, at, tgt);
      return shape ? Math.abs(shape.closest(p).d) : Math.hypot(...sub(p, tgt));
    };
  }

  shapeLinked(n) {
    const l = this.in(n.id, 'object')[0];
    if (!l) return null;
    let s = this.shapes.get(l.from);
    if (!s) { s = makeShape(this.nodes.get(l.from).params); this.shapes.set(l.from, s); }
    return s;
  }

  setCtx(line, t) {
    const c = this.ctx;
    c.line = line; c.t = t; c.lineId = line.id; c.level = line.level; c.pos = line.pos; c.chainPos = line.chainPos;
    c.length = line.nominal || line.length; c.radius = line.r0 || 0;
    c.angleDiv = line.angleDiv; c.angleBend = line.angleBend; c.offset = line.offset; c.distance = line.distance; c.surfaceLevel = line.surfaceLevel;
    return c;
  }

  // The chain of modifiers hanging from a socket, following Switch nodes.
  chain(node, sock) {
    const key = `${node.id}.${sock}`;
    let list = this.chains.get(key);
    if (list) return list;
    list = sock === 'dir' ? inlineModifiers(node) : [];
    const seen = new Set();
    let cur = this.out(node.id, sock)[0] ? this.nodes.get(this.out(node.id, sock)[0].to) : null;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.type === 'SwitchModifiers') {
        const choice = Math.round(this.q(cur).value(this.ctx));
        const l = this.out(cur.id, `out${choice}`)[0];
        cur = l ? this.nodes.get(l.to) : null;
        continue;
      }
      list.push(cur);
      const nx = this.out(cur.id, 'out')[0];
      cur = nx ? this.nodes.get(nx.to) : null;
    }
    this.chains.set(key, list);
    return list;
  }

  grow(node, b) {
    let box = this.boxes.get(node);
    if (!box) { box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; this.boxes.set(node, box); }
    for (let k = 0; k < 3; k++) { if (b[k] < box[k]) box[k] = b[k]; if (b[k + 3] > box[k + 3]) box[k + 3] = b[k + 3]; }
  }

  lineBox(line) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const p = line.pts;
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
    return b;
  }

  // A line's number comes from its node, its parent line and its place among that parent's children, so adding
  // an unrelated node (an imported mesh, a new branch) doesn't reshuffle every other line's randomness.
  // The share of detail a node keeps at this LOD: 1 at LOD 0, then 0.6, 0.36 and 0.22, softened by its LOD reduction %.
  lodKeep(node) {
    if (!this.lod) return 1;
    const k = Math.max(0, Math.min(100, +(node.params.lodReduce ?? 100))) / 100;
    return 1 - (1 - 0.6 ** this.lod) * k;
  }

  lineIdFor(node, parent) {
    const key = `${node.id}|${parent ? parent.id : 0}`;
    const n = (this.lineSlots.get(key) || 0) + 1;
    this.lineSlots.set(key, n);
    let id = ((Math.imul(hashString(node.id), 2654435761) ^ Math.imul(parent ? parent.id : 0, 40503) ^ Math.imul(n, 7919)) >>> 1) || 1;
    while (this.lineIds.has(id)) id = (id % 2147483646) + 1;
    this.lineIds.add(id);
    return id;
  }

  newLine(node, spawn, pts, nominal, id = this.lineIdFor(node, spawn.parent)) {
    this.lineCount++;
    const line = {
      id, node, pts, nominal, tOff: 0,
      parent: spawn.parent || null, parentS: spawn.s || 0, level: spawn.level || 0, pos: spawn.pos || 0,
      angleDiv: spawn.angleDiv || 0, angleBend: spawn.angleBend || 0, offset: spawn.offset || 0,
      distance: spawn.distance || 0, surfaceLevel: spawn.surfaceLevel || 0,
      attach: null, roll: null, startDir: spawn.d, upHint: spawn.up || null, lastLevel: true,
      rootDist: spawn.parent ? spawn.parent.rootDist + (spawn.s || 0) : 0,
      chainPos: spawn.parent ? (spawn.parent.rootDist + (spawn.s || 0)) / Math.max(1e-3, spawn.parent.rootDist + spawn.parent.length) : 0,
      colorFn: null, radii: null, capEnd: null, capStart: null, dead: false, windW: 0, sizeScale: spawn.scale ?? 1, xf: spawn.xf || null, inst: spawn.key || 0, isTip: !!spawn.tip,
    };
    finishLine(line);
    return line;
  }

  buildLines(node, spawns, srcChain) {
    const q = this.q(node);
    const seed = this.h(node);
    const rate = (node.params.countRate ?? 100) / 100;
    const chaos = q.chaos;
    const c = this.ctx;
    const dirChain = this.chain(node, 'dir');
    const lines = [];
    for (const sp of spawns) {
      if (this.lineCount >= this.maxLines || this.segs >= this.maxSegs) { this.warnings.add('Reached the size limit: raise it in Preferences or lower the density.'); break; }
      const nextId = this.lineIdFor(node, sp.parent);
      if (sp.hide) continue;
      if (rate < 1 && hash(seed, nextId, 11) > rate) continue;
      c.line = null; c.parentLine = sp.parent || null; c.t = 0; c.lineId = nextId; c.level = sp.level || 0; c.pos = sp.pos || 0; c.chainPos = 0;
      c.angleDiv = sp.angleDiv || 0; c.angleBend = sp.angleBend || 0; c.offset = sp.offset || 0;
      c.distance = sp.distance || 0; c.surfaceLevel = sp.surfaceLevel || 0;
      c.length = sp.parent ? sp.parent.length : 0; c.radius = sp.parent ? sp.parent.r0 || 0 : 0;
      let L = Math.max(0.1, q.length(c)) * (sp.lengthScale ?? 1);
      if (chaos) L *= 1 - (chaos(c) / 100) * hash(seed, nextId, 12);
      c.length = L;
      // A leaning trunk standing on the ground starts a little below it, so its whole foot meets the ground
      // instead of lifting on one side.
      let p0 = sp.p;
      // Blend into the base: start inside the surface it grows on, by about its thickness.
      if (node.params.blendBase) {
        const sink = (+node.params.radius || 0) * (sp.lengthScale ?? 1) * 1.2;
        p0 = [sp.p[0] - sp.d[0] * sink, sp.p[1] - sp.d[1] * sink, sp.p[2] - sp.d[2] * sink];
        L += sink;
      } else if (!sp.parent && Math.abs(sp.p[1]) < 0.5 && sp.d[1] > 0.2 && sp.d[1] < 0.999 && String(node.params.meshType ?? 'tube').includes('tube')) {
        const sink = (+node.params.radius || 0) * (sp.lengthScale ?? 1) * Math.sqrt(1 - sp.d[1] * sp.d[1]) / sp.d[1];
        p0 = [sp.p[0] - sp.d[0] * sink, sp.p[1] - sp.d[1] * sink, sp.p[2] - sp.d[2] * sink];
        L += sink;
      }
      const pts = [p0[0], p0[1], p0[2]];
      let s = 0;
      const minStep = L / this.segLimit;
      const lodStep = this.lod ? 1 / this.lodKeep(node) : 1;
      // Absolute segments: the same number on every line, whatever its length.
      const fixedStep = node.params.segMode === 'absolute' ? L / clamp(Math.round(+node.params.segCount || 1), 1, this.segLimit) : 0;
      while (s < L - 1e-4) {
        c.t = s / L;
        const st = (fixedStep || Math.max(q.steps(c), minStep)) * lodStep;
        s = s + st > L - st * 0.25 ? L : s + st;
        pts.push(p0[0] + sp.d[0] * s, p0[1] + sp.d[1] * s, p0[2] + sp.d[2] * s);
      }
      const line = this.newLine(node, sp, new Float32Array(pts), L, nextId);
      this.applyChain(dirChain, line);
      if (this.life && !line.dead) lifeLine(this.life, line, this.seed);
      if (line.dead) continue;
      // Lower LODs: fewer leaves, each larger, so the crown keeps its look.
      if (this.lod && line.node.params.leafy) {
        const keep = this.lodKeep(node);
        if (hash(seed, nextId, 931) > keep) continue;
        line.sizeScale = (line.sizeScale ?? 1) / Math.sqrt(keep);
      }
      if (sp.axisScale) {
        // Scale X, Y and Z stretch the finished line's shape along the transform's axes (its own or the world's), around its base.
        const P = line.pts; const { k, f } = sp.axisScale;
        for (let i = 3; i < P.length; i += 3) {
          const d = [P[i] - P[0], P[i + 1] - P[1], P[i + 2] - P[2]];
          const a = f.map((e, j) => (e[0] * d[0] + e[1] * d[1] + e[2] * d[2]) * k[j]);
          for (let j = 0; j < 3; j++) P[i + j] = P[j] + f[0][j] * a[0] + f[1][j] * a[1] + f[2][j] * a[2];
        }
        finishLine(line);
      }
      this.segs += line.n;
      this.lines.push(line);
      lines.push(line);
    }
    return this.register(node, lines, srcChain);
  }

  applyChain(chain, line) {
    for (const m of chain) {
      const fn = MODIFIERS[m.type];
      if (!fn) continue;
      fn(this, m, line, this.q(m));
      if (line.dead) return;
      finishLine(line);
    }
  }

  register(node, lines, srcChain = []) {
    for (const m of this.chain(node, 'dir')) srcChain = [...srcChain, m];
    for (const m of this.chain(node, 'after')) srcChain = [...srcChain, m];
    for (const l of lines) {
      const b = this.lineBox(l);
      this.grow(node.id, b);
      for (const m of srcChain) this.grow(m.id, b);
    }
    const known = this.pathLines.get(node.id) || this.pathLines.set(node.id, []).get(node.id);
    for (const l of lines) known.push(l);
    this.attachBuilders(node, lines);
    return lines;
  }

  attachBuilders(node, lines) {
    for (const l of this.out(node.id, 'mesh')) this.attachBuilder(this.nodes.get(l.to), lines);
  }

  attachBuilder(b, lines) {
    if (b.type === 'SwitchMeshes') {
      const c = Math.round(this.q(b).value(this.ctx));
      for (const l of this.out(b.id, `out${c}`)) this.attachBuilder(this.nodes.get(l.to), lines);
      return;
    }
    if (b.type === 'UnifiedSkeleton') {
      const sk = this.skeletons.get(b.id) || this.skeletons.set(b.id, []).get(b.id);
      for (const l of lines) sk.push(l);
      return;
    }
    let job = this.jobs.get(b.id);
    if (!job) { job = { node: b, lines: [], comps: compsOf(this, b) }; this.jobs.set(b.id, job); }
    for (const l of lines) { job.lines.push(l); l.colorFn ||= job.comps.color; }
    if (b.type === 'CylinderMesh' || b.type === 'MetaMesh') computeRadii(this, job, lines);
    for (const l of lines) {
      const box = this.lineBox(l);
      this.grow(b.id, box);
      for (const cn of job.comps.nodes) this.grow(cn.id, box);
    }
  }

  runDistributor(dn, parents) {
    const outs = this.out(dn.id, 'out');
    for (const link of outs) {
      const target = this.nodes.get(link.to);
      let cur = parents;
      const levels = dn.params.levels ? Math.round(this.q(dn).levels(this.ctx)) : 1;
      const byPath = new Map();
      for (let lv = 1; lv <= levels; lv++) {
        const sp = makeSpawns(this, dn, cur, lv);
        if (!sp.length) break;
        const produced = this.routeSpawns(dn, target, sp);
        const next = [];
        for (const [path, lines] of produced) {
          if (!byPath.has(path)) byPath.set(path, []);
          const all = byPath.get(path);
          for (const l of lines) { all.push(l); next.push(l); }
        }
        if (lv < levels) for (const l of next) l.lastLevel = false;
        cur = next;
      }
      for (const [path, lines] of byPath) this.runChildren(path, lines);
      for (const [, lines] of byPath) for (const l of lines) this.grow(dn.id, this.lineBox(l));
    }
  }

  routeSpawns(dn, target, spawns) {
    const out = new Map();
    const emit = (path, group) => {
      const lines = this.growLines(path, group, [dn]);
      out.set(path, out.has(path) ? out.get(path).concat(lines) : lines);
    };
    if (target.type !== 'SwitchPaths') { emit(target, spawns); return out; }
    const q = this.q(target);
    const seed = this.h(dn);
    const groups = new Map();
    spawns.forEach((sp, i) => {
      const c = this.ctx;
      c.line = sp.parent; c.lineId = (seed + i) | 0; c.t = 0; c.level = sp.level; c.pos = sp.pos;
      const choice = Math.round(q.value(c));
      for (const l of this.out(target.id, `out${choice}`)) {
        const p = this.nodes.get(l.to);
        (groups.get(p) || groups.set(p, []).get(p)).push(sp);
      }
    });
    for (const [p, g] of groups) emit(p, g);
    return out;
  }

  growLines(path, spawns, src) {
    if (path.type === 'SpaceColonization') return growColonization(this, path, spawns, src);
    if (path.type === 'GrowthPath') return growthLines(this, path, spawns, src);
    return this.buildLines(path, spawns, src);
  }

  runChildren(path, lines) {
    if (!lines.length || this.depth > 16) return;
    this.depth = (this.depth || 0) + 1;
    for (const l of this.out(path.id, 'children')) this.runChildDist(this.nodes.get(l.to), lines);
    this.depth--;
  }

  runChildDist(n, lines) {
    if (n.type === 'SwitchDistributors') {
      const c = Math.round(this.q(n).value(this.ctx));
      for (const l of this.out(n.id, `out${c}`)) this.runChildDist(this.nodes.get(l.to), lines);
    } else if (n.type === 'DrawPath') {
      const made = this.register(n, drawnLines(this, n, lines));
      this.runChildren(n, made);
    } else if (n.type !== 'PathCloud') {
      this.runDistributor(n, n.params.lastLevel ? lines.filter((l) => l.lastLevel) : lines);
    }
  }

  // Modifiers on the After mesh socket move a line and carry its children along with it.
  applyAfterChains() {
    const deltas = new Map();
    let any = false;
    for (const line of this.lines) {
      const chain = this.chain(line.node, 'after');
      if (chain.length) any = true;
      else if (!any) continue;
      const before = line.pts.slice();
      if (chain.length) { this.applyChain(chain, line); }
      const n = line.pts.length / 3;
      const d = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) d[i] = i < before.length ? line.pts[i] - before[i] : 0;
      let px = 0; let py = 0; let pz = 0;
      const pd = line.parent && deltas.get(line.parent);
      if (pd) {
        const f = clamp(tOf(line.parent, line.parentS), 0, 1) * (pd.length / 3 - 1);
        const k = Math.round(f) * 3;
        px = pd[k]; py = pd[k + 1]; pz = pd[k + 2];
      }
      for (let i = 0; i < n; i++) {
        d[i * 3] += px; d[i * 3 + 1] += py; d[i * 3 + 2] += pz;
        line.pts[i * 3] += px; line.pts[i * 3 + 1] += py; line.pts[i * 3 + 2] += pz;
      }
      deltas.set(line, d);
      finishLine(line);
      ensureFrames(line);
    }
  }

  run() {
    const t0 = Date.now();
    const roots = this.graph.nodes.filter((n) => this.on(n));
    for (const n of roots) {
      if (n.type === 'Distributor' || n.type === 'PointDistributor' || n.type === 'SurfaceDistributor') this.runDistributor(n, null);
      // With a spline parent it runs when that parent's lines exist, even if the parent is switched off.
      else if (n.type === 'Placement') { if (!this.linksIn.has(`${n.id}.parent`)) this.runDistributor(n, null); }
      else if ((n.type === 'Path' || n.type === 'SpaceColonization' || n.type === 'GrowthPath') && !this.in(n.id, 'in').length) {
        const lines = this.growLines(n, [{ p: [0, 0, 0], d: [0, 1, 0], level: 0, pos: 0 }]);
        this.runChildren(n, lines);
      } else if (n.type === 'DrawSurf' || (n.type === 'DrawPath' && !this.in(n.id, 'parent').length)) {
        const made = this.register(n, drawnLines(this, n, null));
        this.runChildren(n, made);
      }
    }
    for (const [id, input] of this.skeletons) {
      const sk = this.nodes.get(id);
      unifySkeleton(this, sk, input);
      this.register(sk, input);
      this.runChildren(sk, input);
    }
    this.applyAfterChains();
    return this.buildOutput(t0);
  }

  buildOutput(t0) {
    const center = [0, 0, 0];
    let weight = 0;
    for (const l of this.lines) {
      if (l.level > 0 || !l.n) { const m = l.n >> 1; center[0] += l.pts[m * 3]; center[1] += l.pts[m * 3 + 1]; center[2] += l.pts[m * 3 + 2]; weight++; }
    }
    this.treeCenter = weight ? [center[0] / weight, center[1] / weight, center[2] / weight] : [0, 100, 0];
    // The plant's height range, for color gradients by height.
    let lo = Infinity; let hi = -Infinity;
    for (const l of this.lines) for (let i = 1; i < l.pts.length; i += 3) { lo = Math.min(lo, l.pts[i]); hi = Math.max(hi, l.pts[i]); }
    this.plantY = lo < hi ? [lo, hi] : [0, 1];
    continueTips(this.lines);
    prepareJunctions(this);
    const windLines = windTable(this);
    const meshes = [];
    const aoJobs = [];
    const cropJobs = [];
    const avoidJobs = [];
    let tris = 0; let verts = 0;
    const metaGroups = new Map();
    for (const job of this.jobs.values()) {
      const { node: b } = job;
      if (b.type === 'MetaMesh') {
        const k = Math.round(b.params.metaId || 0);
        (metaGroups.get(k) || metaGroups.set(k, []).get(k)).push(job);
        continue;
      }
      const buf = new MeshBuf();
      const visible = job.lines.filter((l) => l.node.params.visible !== false);
      if (b.type === 'CylinderMesh') buildCylinders(this, buf, job, visible);
      else if (b.type === 'LeavesMesh') buildLeaves(this, buf, job, visible);
      else if (b.type === 'StandardLeaves') buildStandardLeaves(this, buf, job, visible);
      else if (b.type === 'InstancedGeometry') buildInstances(this, buf, job, visible);
      const m = buf.finish(b, job.comps);
      if (m) {
        if (b.params.globalMods?.length) shapeAll(m, b.params.globalMods);
        applyMeshMods(m, b.params.meshMods, this.images, this.treeCenter);
        if (b.params.vcAO) aoJobs.push([m, +b.params.vcAOStrength || 0.7]);
        if (b.params.cropUnder) cropJobs.push(m);
        for (const mod of b.params.meshMods || []) if (mod.on !== false && mod.type === 'avoid') avoidJobs.push([m, mod.params || {}]);
        m.nodeId = ownerOf(m.nodeId);
        meshes.push(m); tris += m.index.length / 3; verts += m.position.length / 3;
      }
    }
    for (const jobs of metaGroups.values()) {
      for (const m of buildMeta(this, jobs)) { meshes.push(m); tris += m.index.length / 3; verts += m.position.length / 3; }
    }
    // Scan base blending: a Mesh with Crop under branches loses the triangles around where blended branches enter it.
    if (cropJobs.length) {
      const holes = [];
      for (const l of this.lines) {
        if (!l.node.params.blendBase || !l.pts) continue;
        const r = (l.radii?.[0] || l.r0 || +l.node.params.radius || 1) * 0.9;
        // Where the branch crosses the surface: about one thickness up from its sunk start.
        const k = Math.min(l.pts.length / 3 - 1, 1);
        holes.push([l.pts[0], l.pts[1], l.pts[2], l.pts[k * 3], l.pts[k * 3 + 1], l.pts[k * 3 + 2], r]);
      }
      for (const m of cropJobs) {
        const before = m.index.length;
        m.index = cropAround(m, holes);
        tris -= (before - m.index.length) / 3;
      }
    }
    // Avoiding intersections needs every mesh in place, and comes before occlusion, which depends on where they ended up.
    for (const [m, P] of avoidJobs) {
      const before = m.index.length;
      avoidMesh(m, meshes, P);
      tris -= (before - m.index.length) / 3;
    }
    // Occlusion is baked last, since it depends on everything around a mesh.
    if (aoJobs.length) {
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const m of meshes) for (let i = 0; i < m.position.length; i += 3) for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], m.position[i + k]); box[k + 3] = Math.max(box[k + 3], m.position[i + k]); }
      const all = bakeOcclusion(meshes, box);
      for (const [m, strength] of aoJobs) {
        const ao = all[meshes.indexOf(m)];
        for (let v = 0; v < ao.length; v++) { const f = 1 - strength * (1 - ao[v]); m.color[v * 3] *= f; m.color[v * 3 + 1] *= f; m.color[v * 3 + 2] *= f; }
      }
    }
    // Hidden parts report under the node a person sees.
    const boxes = {};
    for (const [id, b] of this.boxes) {
      const owner = ownerOf(id);
      const o = boxes[owner];
      boxes[owner] = o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.min(o[2], b[2]), Math.max(o[3], b[3]), Math.max(o[4], b[4]), Math.max(o[5], b[5])] : [...b];
    }
    return {
      meshes,
      lines: this.lineOutput(),
      boxes,
      windLines,
      helpers: this.helperOutput(),
      stats: { lines: this.lines.length, tris, verts, ms: Date.now() - t0, draft: this.draft },
      warnings: [...this.warnings],
    };
  }

  helperOutput() {
    const out = [];
    for (const n of this.graph.nodes) {
      if (!this.on(n)) continue;
      if ((n.type === 'SceneObject' || n.type === 'GroundPatch') && n.params.display !== false) {
        out.push({ kind: 'object', id: n.id, shape: n.params.shape, pos: n.params.pos, size: shapeSize(n.params), color: n.params.color, obj: n.params.shape === 'imported' ? n.params.obj : null });
      }
      if (socketsOf(n).outputs.some((s) => s.kind === 'cloud') && n.params.display !== false) {
        out.push({ kind: 'cloud', id: n.id, points: Float32Array.from(cloudPoints(this, n).flat()) });
      }
    }
    return out;
  }

  // Flat arrays for the wire view and for picking in the 3D view.
  lineOutput() {
    let count = 0;
    for (const l of this.lines) count += Math.max(0, l.n - 1);
    const position = new Float32Array(count * 6);
    const color = new Float32Array(count * 6);
    const lineId = new Int32Array(count * 2);
    const nodeIds = [];
    const nodeIndex = new Map();
    const owner = new Uint16Array(count * 2);
    const radius = new Float32Array(count * 2);
    // The placement copy each line came from (0 for none), so the Transform gizmo can edit one copy.
    const inst = new Int32Array(count * 2);
    let k = 0;
    const rgb = new Map();
    const parse = (hex) => {
      let c = rgb.get(hex);
      if (!c) { const v = parseInt((hex || '#35d07f').slice(1), 16); c = [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; rgb.set(hex, c); }
      return c;
    };
    for (const l of this.lines) {
      const id = ownerOf(l.node.id);
      if (!nodeIndex.has(id)) { nodeIndex.set(id, nodeIds.length); nodeIds.push(id); }
      const ni = nodeIndex.get(id);
      const c = parse(l.node.params.wire);
      for (let i = 0; i + 1 < l.n; i++) {
        for (let e = 0; e < 2; e++) {
          const v = (i + e) * 3;
          position[k * 3] = l.pts[v]; position[k * 3 + 1] = l.pts[v + 1]; position[k * 3 + 2] = l.pts[v + 2];
          color[k * 3] = c[0]; color[k * 3 + 1] = c[1]; color[k * 3 + 2] = c[2];
          lineId[k] = l.id; owner[k] = ni; inst[k] = l.inst || 0;
          radius[k] = l.radii ? l.radii[Math.min(i + e, l.radii.length - 1)] : 0;
          k++;
        }
      }
    }
    return { position, color, lineId, owner, radius, nodeIds, inst };
  }
}

export function evaluate(graph, opts) {
  return new Evaluator(graph, opts).run();
}

// All typed arrays in a result, so the worker can hand them over without copying.
export function transferables(res) {
  const list = [];
  for (const m of res.meshes) for (const v of Object.values(m)) if (ArrayBuffer.isView(v)) list.push(v.buffer);
  for (const v of Object.values(res.lines)) if (ArrayBuffer.isView(v)) list.push(v.buffer);
  for (const h of res.helpers) if (h.points) list.push(h.points.buffer);
  list.push(res.windLines.buffer);
  return list;
}

// A Mesh's modifiers set to "all together": every copy shaped as one, from the base of them all upward.
function shapeAll(m, mods) {
  const v = m.position;
  let x0 = Infinity; let y0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; let z1 = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    x0 = Math.min(x0, v[i]); x1 = Math.max(x1, v[i]); y0 = Math.min(y0, v[i + 1]); y1 = Math.max(y1, v[i + 1]); z0 = Math.min(z0, v[i + 2]); z1 = Math.max(z1, v[i + 2]);
  }
  const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
  for (let i = 0; i < v.length; i += 3) { v[i] -= cx; v[i + 1] -= y0; v[i + 2] -= cz; }
  applyMods(v, m.index, mods, Math.max(y1 - y0, 1));
  for (let i = 0; i < v.length; i += 3) { v[i] += cx; v[i + 1] += y0; v[i + 2] += cz; }
  m.normal.set(computeNormals(v, m.index));
}

// The triangles of a mesh with those near the given branch entries taken out. A hole is a segment (the branch's
// first stretch) with a radius: a triangle goes when its middle lies within that radius of the segment.
export function cropAround(m, holes) {
  const P = m.position; const I = m.index; const keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3);
    let cut = false;
    for (const h of holes) {
      const d = [h[3] - h[0], h[4] - h[1], h[5] - h[2]]; const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      const s = Math.max(0, Math.min(1, ((c[0] - h[0]) * d[0] + (c[1] - h[1]) * d[1] + (c[2] - h[2]) * d[2]) / dd));
      if (Math.hypot(c[0] - h[0] - d[0] * s, c[1] - h[1] - d[1] * s, c[2] - h[2] - d[2] * s) < h[6]) { cut = true; break; }
    }
    if (!cut) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  return new Uint32Array(keep);
}

// A tube's tip copy carries the tube on: the parent's end has no cap, the copy starts on the parent's end ring with
// its thickness, eases to its own over its first fifth, and leaves along the parent's heading before it turns. One
// tip tube per parent (the first); more tips at one end still meet there with caps.
export function continueTips(lines) {
  for (const l of lines) {
    const p = l.parent;
    if (!l.isTip || !p?.radii || !l.radii || l.n < 3 || p.tipChild) continue;
    p.tipChild = l;
    p.capEnd = 'none'; l.capStart = 'none';
    const Rend = p.radii[p.radii.length - 1];
    for (let i = 0; i < l.n; i++) {
      const t = l.len[i] / Math.max(1e-6, l.length); const f = t >= 0.2 ? 1 : (t / 0.2) ** 2 * (3 - 2 * t / 0.2);
      l.radii[i] = Rend * (1 - f) + l.radii[i] * f;
    }
    if (l.pointR) l.pointR = l.radii;
    const P = l.pts; const n = p.pts.length / 3;
    const T = [p.pts[n * 3 - 3] - p.pts[n * 3 - 6], p.pts[n * 3 - 2] - p.pts[n * 3 - 5], p.pts[n * 3 - 1] - p.pts[n * 3 - 4]];
    const tl = Math.hypot(...T) || 1; const d1 = Math.hypot(P[3] - P[0], P[4] - P[1], P[5] - P[2]);
    for (let k = 0; k < 3; k++) P[3 + k] = P[k] + (T[k] / tl) * d1;
    finishLine(l);
    l.r0 = l.radii[0];
    // Rings start turned the same way as the parent's last one (same frame, same side count: see tube.js).
    ensureFrames(p);
    l.upHint = [p.U[n * 3 - 3], p.U[n * 3 - 2], p.U[n * 3 - 1]];
  }
}
