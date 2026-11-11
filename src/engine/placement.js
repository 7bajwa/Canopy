// The Placement tab: where each line starts, which way it leaves, and how big it is.
import { hash, DEG, cross, norm, rotate, perpendicular, add, mul, clamp, mix3, dot, bakeCurve, sampleCurve, ZUP, turnXYZ, shapeXf } from './math.js';
import { sampleLine, newSample, tOf } from './line.js';
import { softNoise } from './primitive.js';
import { sproutFrames } from './leaves.js';

const GOLDEN = 137.50776 * DEG;
const S = newSample();

// Everything one entity needs from its surroundings; the mode only decides where and which way.
function emitter(ev, dn, q, out) {
  const seed = ev.h(dn);
  const c = ev.ctx;
  const align = clamp(+(dn.params.alignParent ?? 100) / 100, 0, 1);
  const identity = !!dn.params.identity;
  const localXf = dn.params.xfSpace !== 'world';
  // `mirror` is the second side of a pair (or every other one): its turns run the other way, so pairs open
  // and close like wings, and its transform is reflected across the plane through the parent line.
  return function emit({ p, axis, radial, t, key, line = null, s = 0, tilt = null, sizeK = 1, mirror = false, spinAdd = 0, rollAdd = 0 }) {
    c.line = line; c.lineId = key; c.t = t; c.pos = t; c.level = line ? line.level + 1 : 0; c.chainPos = t;
    const rnd = (salt) => hash(seed, key, salt);
    const sgn = mirror ? -1 : 1;
    const M = mirror ? (v) => { const k = 2 * dot(v, radial); return [v[0] - radial[0] * k, v[1] - radial[1] * k, v[2] - radial[2] * k]; } : (v) => v;
    const spin = (q.rotation(c) + spinAdd) * DEG * sgn;
    const r0 = spin ? rotate(radial, axis, spin) : radial;
    const side = norm(cross(axis, r0));
    const a = (tilt ?? q.tilt(c)) * DEG;
    const d = a ? norm(rotate(axis, side, a)) : axis;
    // A line's own X lies level and to the right of where it heads (Z), so leaves sit flat side by side.
    const level = identity ? null : cross([0, 1, 0], d);
    const flat = level && Math.hypot(...level) > 1e-3 ? norm(level) : side;
    const up0 = identity ? r0 : align < 1 ? rotate(flat, d, (1 - align) * (rnd(2) - 0.5) * Math.PI * 2) : flat;
    // Transform: each value read per entity, so its variation and curve apply. Its axes are the gizmo's
    // (Z up), either the world's or the entity's own: X to its side, Z the way it heads.
    const rot = [(q.rotX?.(c) || 0) * DEG, (q.rotY?.(c) || 0) * DEG, (q.rotZ?.(c) || 0) * DEG];
    const u = q.sclU ? q.sclU(c) : 1;
    const axes = [q.sclX ? q.sclX(c) : 1, q.sclY ? q.sclY(c) : 1, q.sclZ ? q.sclZ(c) : 1];
    // Worked out on the first side of a pair, then mirrored, so both sides move like wings.
    let dP = M(d); let uP = M(up0);
    // The entity's X: its own, except straight up or down, where it lines up with the world's around it.
    let xP = level && Math.hypot(...level) > 1e-3 ? uP : M(r0);
    const ownFrame = (z, x) => { const xs = norm(add(x, mul(z, -dot(x, z)))); return [xs, norm(cross(z, xs)), z]; };
    const F0 = localXf ? ownFrame(dP, xP) : ZUP;
    // A copy of a Mesh turns in its own shape (xf below); a line turns the way it leaves.
    if (!identity && rot.some(Boolean)) { dP = norm(turnXYZ(dP, F0, rot)); uP = norm(turnXYZ(uP, F0, rot)); xP = turnXYZ(xP, F0, rot); }
    // Roll turns it on its own axis, the way it heads.
    const roll = ((q.roll?.(c) || 0) + rollAdd) * DEG;
    if (roll) { uP = rotate(uP, dP, roll); xP = rotate(xP, dP, roll); }
    const F = localXf ? ownFrame(dP, xP) : ZUP;
    const o = [q.posX?.(c) || 0, q.posY?.(c) || 0, q.posZ?.(c) || 0];
    const off = M([0, 1, 2].map((i) => F[0][i] * o[0] + F[1][i] * o[1] + F[2][i] * o[2]));
    const pos = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
    const scale = Math.max(0, (q.scale(c) / 100) * u) * sizeK;
    out.push({
      p: pos, d: M(dP), up: M(uP), parent: line, s, pos: t, level: c.level, lengthScale: scale, scale,
      xf: identity ? shapeXf(rot, axes) : null,
      axisScale: !identity && axes.some((a) => a !== 1) ? { k: axes, f: F.map(M) } : null,
      angleDiv: a / DEG, angleBend: 0, offset: 0, distance: 0,
    });
  };
}

// Where the local modes start: the origin, or the tip of each parent line.
function framesOf(dn, parents) {
  if (!parents) return [{ p: [0, 0, 0], T: [0, 1, 0], U: [1, 0, 0], V: [0, 0, -1], key: 1 }];
  return parents.map((line) => {
    sampleLine(line, line.length, S);
    return { p: [S.px, S.py, S.pz], T: [S.tx, S.ty, S.tz], U: [S.ux, S.uy, S.uz], V: [S.vx, S.vy, S.vz], line, s: line.length, key: line.id * 4099 };
  });
}

const around = (f, a) => norm(add(mul(f.U, Math.cos(a)), mul(f.V, Math.sin(a))));
const countOf = (q, c, seed, key) => {
  c.t = 0; c.pos = 0; c.lineId = (seed ^ key) | 0;
  return Math.max(0, Math.round(q.count(c)));
};
const keyOf = (f, i) => (f.key + i * 31) | 0;
const place = (f, x, y, z) => [f.p[0] + f.U[0] * x + f.T[0] * y + f.V[0] * z, f.p[1] + f.U[1] * x + f.T[1] * y + f.V[1] * z, f.p[2] + f.U[2] * x + f.T[2] * y + f.V[2] * z];

function pointMode(ev, dn, q, f, emit, seed) {
  const n = countOf(q, ev.ctx, seed, f.key);
  for (let i = 0; i < n; i++) {
    emit({ p: f.p, axis: f.T, radial: around(f, n > 1 ? (i / n) * Math.PI * 2 : 0), t: n > 1 ? i / (n - 1) : 0, key: keyOf(f, i), line: f.line, s: f.s });
  }
}

function lineMode(ev, dn, q, f, emit, seed) {
  const n = countOf(q, ev.ctx, seed, f.key);
  const raw = dn.params.lineDir || [1, 0, 0];
  const dir = norm([+raw[0], +raw[1], +raw[2]]);
  const random = dn.params.spacing === 'random';
  for (let i = 0; i < n; i++) {
    const key = keyOf(f, i);
    const t = random ? hash(seed, key, 7) : n > 1 ? i / (n - 1) : 0;
    ev.ctx.t = t; ev.ctx.pos = t; ev.ctx.lineId = key;
    const len = q.lineLen(ev.ctx) * t;
    const p = place(f, dir[0] * len, dir[1] * len, dir[2] * len);
    emit({ p, axis: f.T, radial: around(f, i * GOLDEN), t, key, line: f.line, s: f.s });
  }
}

function ringMode(ev, dn, q, f, emit, seed) {
  const n = countOf(q, ev.ctx, seed, f.key);
  const inside = dn.params.ringFill === 'inside';
  const random = dn.params.spacing === 'random';
  for (let i = 0; i < n; i++) {
    const key = keyOf(f, i);
    let a; let k; let t;
    if (inside) {
      // Sunflower spacing keeps the same distance between neighbours, from the center out.
      k = random ? Math.sqrt(hash(seed, key, 7)) : Math.sqrt((i + 0.5) / n);
      a = random ? hash(seed, key, 8) * Math.PI * 2 : i * GOLDEN;
      t = k;
    } else {
      k = 1;
      a = random ? hash(seed, key, 8) * Math.PI * 2 : (i / n) * Math.PI * 2;
      t = a / (Math.PI * 2);
    }
    ev.ctx.t = t; ev.ctx.pos = t; ev.ctx.lineId = key;
    const R = q.ringRadius(ev.ctx) * k;
    const radial = around(f, a);
    const p = add(f.p, mul(radial, R));
    emit({ p, axis: f.T, radial, t, key, line: f.line, s: f.s });
  }
}

function urchinMode(ev, dn, q, f, emit, seed) {
  const n = countOf(q, ev.ctx, seed, f.key);
  const st = clamp(+dn.params.sproutStart / 100, 0, 1); const en = clamp(+dn.params.sproutEnd / 100, 0, 1);
  const mode = dn.params.sproutAlign;
  for (let i = 0; i < n; i++) {
    const key = keyOf(f, i);
    const u = (i + 0.5) / n;
    const t = st + (en - st) * u;
    const y = t * 2 - 1; const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLDEN;
    ev.ctx.t = t; ev.ctx.pos = t; ev.ctx.lineId = key;
    const R = q.sproutRadius(ev.ctx); const H = q.sproutHeight(ev.ctx);
    const radial = around(f, a);
    const p = add(add(f.p, mul(radial, rr * R)), mul(f.T, ((y + 1) / 2) * H));
    const nrm = norm(add(mul(radial, rr), mul(f.T, y)));
    const axis = mode === 'axis' ? f.T : mode === 'orthogonal' ? radial : nrm;
    // Tilting needs a direction square to the axis, which the ball's poles don't supply by themselves.
    const side = Math.abs(dot(axis, f.T)) < 0.98 ? f.T : radial;
    emit({ p, axis, radial: norm(add(side, mul(axis, -dot(side, axis)))), t, key, line: f.line, s: f.s });
  }
}

function splineMode(ev, dn, q, parents, emit, seed) {
  const P = dn.params;
  const c = ev.ctx;
  const curved = q.density.linked;
  const baseDensity = +P.density || 1;
  for (const line of parents) {
    const L = line.length;
    if (L <= 0) continue;
    const key0 = (line.id * 4099) | 0;
    c.line = line; c.t = 0; c.pos = 0; c.lineId = key0; c.level = line.level + 1;
    // Start and end can vary per parent line, and follow a curve up the chain.
    const start = clamp(q.start(c) / 100, 0, 1); const end = clamp(q.end(c) / 100, 0, 1);
    const span = (end - start) * L;
    const n = span > 0 ? Math.round(((curved ? baseDensity : q.density(c)) * span) / ev.unit) : 0;
    // Opposite and alternate kinds start level, out to the line's sides; spirals and whorls start anywhere.
    const sided = P.pattern === 'alternate' || P.pattern === 'pairs' || P.pattern === 'alternate pairs';
    const phi0 = sided ? 0 : hash(seed, line.id, 2) * Math.PI * 2;
    const turn = q.turn(c) * DEG;
    const whorl = Math.max(1, Math.round(+P.whorl || 1));
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const s = start * L + ((i + 0.5 + (hash(seed, line.id, 3 + i) - 0.5) * 0.7) / n) * span;
      if (P.pattern === 'pairs') nodes.push([s, phi0], [s, phi0 + Math.PI, true]);
      else if (P.pattern === 'alternate pairs') nodes.push([s, phi0 + i * (Math.PI / 2)], [s, phi0 + i * (Math.PI / 2) + Math.PI, true]);
      else if (P.pattern === 'alternate') nodes.push([s, phi0 + (i % 2) * Math.PI, i % 2 === 1]);
      else if (P.pattern === 'whorl') for (let w = 0; w < whorl; w++) nodes.push([s, phi0 + i * 0.6 + (w / whorl) * Math.PI * 2]);
      else nodes.push([s, phi0 + i * turn]);
    }
    nodes.forEach(([s, a, mirror], i) => {
      const t = tOf(line, s);
      const key = (key0 + i * 31) | 0;
      c.line = line; c.t = t; c.pos = t; c.lineId = key;
      if (curved && hash(seed, key, 5) > q.density(c) / baseDensity) return;
      sampleLine(line, s, S);
      const f = { U: [S.ux, S.uy, S.uz], V: [S.vx, S.vy, S.vz] };
      emit({ p: [S.px, S.py, S.pz], axis: [S.tx, S.ty, S.tz], radial: around(f, a), t, key, line, s, mirror: !!mirror });
    });
    // Without this a line just stops, which reads as a cut branch.
    if (P.tipOn) {
      c.line = line; c.t = 1; c.pos = 1; c.lineId = key0;
      const count = Math.max(1, Math.round(q.tipCount ? q.tipCount(c) : +P.tipCount || 1));
      sampleLine(line, L, S);
      const p = [S.px, S.py, S.pz]; const axis = [S.tx, S.ty, S.tz];
      const f = { U: [S.ux, S.uy, S.uz], V: [S.vx, S.vy, S.vz] };
      for (let i = 0; i < count; i++) {
        // Each tip reads its own angle, scale, turn and roll, so their variation makes the tips differ.
        const key = (key0 + 1000003 + i * 31) | 0;
        c.line = line; c.t = 1; c.pos = 1; c.lineId = key;
        const tilt = q.tipTilt(c); const sizeK = q.tipScale(c) / 100;
        const spinAdd = q.tipRot ? q.tipRot(c) : 0; const rollAdd = q.tipRoll ? q.tipRoll(c) : 0;
        emit({ p, axis, radial: around(f, phi0 + (i / count) * Math.PI * 2), t: 1, key, line, s: L, tilt, sizeK, spinAdd, rollAdd });
      }
    }
  }
}

// A point of a Mesh's surface (baked as its first copy) moved onto another copy, by that copy's own frame.
// shortcut: a copy's own rotation and axis-scale variation isn't followed, only its place, turn and size; carry xf here if that shows.
function onCopy(pt, line, from) {
  sampleLine(line, 0, S);
  const k = (line.sizeScale ?? 1) / (+from.sclU || 1);
  const f = { p: [S.px, S.py, S.pz], U: [S.ux, S.uy, S.uz], T: [S.tx, S.ty, S.tz], V: [S.vx, S.vy, S.vz] };
  const l = [0, 1, 2].map((i) => (pt.p[i] - from.pos[i]) * k);
  const n = place({ ...f, p: [0, 0, 0] }, pt.n[0], pt.n[1], -pt.n[2]);
  return { p: place(f, l[0], l[1], -l[2]), n: norm(n) };
}

function meshMode(ev, dn, q, emit, seed, parents) {
  const P = dn.params;
  const shape = ev.shapeLinked(dn);
  const ol = ev.in(dn.id, 'object')[0];
  const from = ol && ev.nodes.get(ol.from)?.params.copyFrom;
  const copies = from && parents?.length ? parents : null;
  if (!shape) { ev.warnings.add('A Placement set to Mesh needs a Mesh node connected as its parent.'); return; }
  const n = countOf(q, ev.ctx, seed, 7);
  const lo = shape.bounds[0][1]; const hi = shape.bounds[1][1];
  const h0 = lo + (hi - lo) * (+P.heightStart / 100); const h1 = lo + (hi - lo) * (+P.heightEnd / 100);
  const follow = clamp(+P.meshAlign / 100, 0, 1);
  const prune = clamp(+P.prune / 100, 0, 1);
  const minCos = Math.cos(clamp(+P.slope, 0, 180) * DEG);
  const even = P.spacing === 'even';
  const cell = Math.max(+P.minDist || 5, 0.01);
  const grid = new Map();
  let made = 0;
  // Tries more points than asked, so spacing and pruning still reach the count when they can.
  for (let i = 0; i < n * 12 && made < n; i++) {
    const local = shape.sample(seed, i + 1);
    if (local.p[1] < h0 - 1e-3 || local.p[1] > h1 + 1e-3 || local.n[1] < minCos) continue;
    const line = copies ? copies[i % copies.length] : null;
    const pt = line ? onCopy(local, line, from) : local;
    if (prune && softNoise(pt.p[0], pt.p[1], pt.p[2], +P.pruneScale || 50, seed) * 0.5 + 0.5 < prune) continue;
    if (even) {
      const key = (x, y, z) => `${x},${y},${z}`;
      const cx = Math.floor(pt.p[0] / cell); const cy = Math.floor(pt.p[1] / cell); const cz = Math.floor(pt.p[2] / cell);
      let near = false;
      for (let x = cx - 1; x <= cx + 1 && !near; x++) for (let y = cy - 1; y <= cy + 1 && !near; y++) for (let z = cz - 1; z <= cz + 1 && !near; z++) {
        const o = grid.get(key(x, y, z));
        if (o && Math.hypot(o[0] - pt.p[0], o[1] - pt.p[1], o[2] - pt.p[2]) < cell) near = true;
      }
      if (near) continue;
      grid.set(key(cx, cy, cz), pt.p);
    }
    const axis = norm(mix3([0, 1, 0], norm(pt.n), follow));
    const k = (seed + made * 31 + 1) | 0;
    const radial = rotate(perpendicular(axis), axis, hash(seed, k, 9) * Math.PI * 2);
    emit({ p: pt.p, axis, radial, t: hi > lo ? (local.p[1] - lo) / (hi - lo) : made / Math.max(1, n - 1), key: k, line, s: 0 });
    made++;
  }
}

function sproutsMode(ev, dn, parents, emit) {
  let found = false;
  for (const line of parents) {
    // The points sit on the parent leaf as it is folded and curled, so children start on its surface.
    const level = Math.round(+dn.params.sproutLevel || 0);
    const spots = sproutFrames(ev, line);
    spots.forEach((sp, i) => {
      if (level && sp.level !== level) return;
      found = true;
      const L = line.length;
      emit({ p: sp.p, axis: sp.axis, radial: sp.normal, t: clamp(sp.t, 0, 1), key: (line.id * 4099 + i * 31) | 0, line, s: clamp(sp.t * L, 0, L) });
    });
  }
  if (!found) ev.warnings.add('Sprout placement needs a parent cutout leaf with sprout points. Add them with the Sprout tool in the cutout editor.');
}

export function placementSpawns(ev, dn, parents) {
  const out = [];
  const q = ev.q(dn);
  const seed = ev.h(dn);
  const mode = dn.params.place;
  const emit = emitter(ev, dn, q, out);
  if (mode === 'mesh') { meshMode(ev, dn, q, emit, seed, parents); return out; }
  if (mode === 'spline') { if (parents) splineMode(ev, dn, q, parents, emit, seed); return out; }
  if (mode === 'sprouts') { if (parents) sproutsMode(ev, dn, parents, emit); return out; }
  const run = { line: lineMode, ring: ringMode, urchin: urchinMode }[mode] || pointMode;
  for (const f of framesOf(dn, parents)) run(ev, dn, q, f, emit, seed);
  return out;
}
