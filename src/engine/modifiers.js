// Direction modifiers. Each takes a line and reshapes its points in place, in chain order.
import { hash, DEG, cross, norm, rotate, dot, mul, sub, perpendicular, noise1, bakeCurve, sampleCurve, clamp, len } from './math.js';
import { sampleLine, newSample, finishLine, ensureFrames } from './line.js';
import { makeSpawns } from './distribute.js';

const S = newSample();

// Rewalks a line, turning each segment. turn(i, s, t, dir, pos) returns [axis, angle] or null.
function walk(line, turn) {
  const { pts, n, len: L, length } = line;
  const out = new Float32Array(pts.length);
  out[0] = pts[0]; out[1] = pts[1]; out[2] = pts[2];
  // Turns accumulate in a quaternion, so a segment inherits every earlier bend at constant cost.
  let qx = 0; let qy = 0; let qz = 0; let qw = 1;
  const apply = (v) => {
    const tx = 2 * (qy * v[2] - qz * v[1]); const ty = 2 * (qz * v[0] - qx * v[2]); const tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + qy * tz - qz * ty, v[1] + qw * ty + qz * tx - qx * tz, v[2] + qw * tz + qx * ty - qy * tx];
  };
  let pos = [pts[0], pts[1], pts[2]];
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 3; const b = a + 3;
    const seg = L[i + 1] - L[i];
    let d = seg > 1e-9 ? apply([(pts[b] - pts[a]) / seg, (pts[b + 1] - pts[a + 1]) / seg, (pts[b + 2] - pts[a + 2]) / seg]) : apply([0, 1, 0]);
    const t = turn(i, L[i], length > 0 ? L[i] / length : 0, d, pos, seg);
    if (t && t[1]) {
      d = rotate(d, t[0], t[1]);
      const s = Math.sin(t[1] / 2); const w = Math.cos(t[1] / 2);
      const x = t[0][0] * s; const y = t[0][1] * s; const z = t[0][2] * s;
      [qx, qy, qz, qw] = [w * qx + x * qw + y * qz - z * qy, w * qy - x * qz + y * qw + z * qx, w * qz + x * qy - y * qx + z * qw, w * qw - x * qx - y * qy - z * qz];
    }
    pos = [pos[0] + d[0] * seg, pos[1] + d[1] * seg, pos[2] + d[2] * seg];
    out[b] = pos[0]; out[b + 1] = pos[1]; out[b + 2] = pos[2];
  }
  line.pts = out;
}

function turnToward(d, target, amount) {
  const ax = cross(d, target);
  const l = len(ax);
  if (l < 1e-6) return null;
  const angle = Math.atan2(l, dot(d, target));
  return [[ax[0] / l, ax[1] / l, ax[2] / l], Math.min(angle, amount)];
}

// Runs a modifier on the stretch of the line between a and b (shares of its length) only. That stretch is cut out
// as a line of its own (so the modifier's curves run from its Start to its End, and its frame carries on from the
// line's), changed, and put back; the rest beyond End follows rigidly, turned as the stretch's end was turned.
export function inRange(ev, fn, m, line, a, b) {
  const L = line.length; const s0 = a * L; const s1 = b * L;
  if (s1 - s0 < 1e-3) return;
  const at = (s) => { const o = sampleLine(line, s, newSample()); return { p: [o.px, o.py, o.pz], u: [o.ux, o.uy, o.uz], t: [o.tx, o.ty, o.tz] }; };
  const A = at(s0); const B = at(s1);
  const { pts, len: ls, n } = line;
  const head = []; const mid = [...A.p]; const tail = [];
  for (let i = 0; i < n; i++) {
    const p = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
    if (ls[i] < s0 - 1e-4) head.push(...p);
    else if (ls[i] > s0 + 1e-4 && ls[i] < s1 - 1e-4) mid.push(...p);
    else if (ls[i] > s1 + 1e-4) tail.push(...p);
  }
  mid.push(...B.p);
  const part = { ...line, pts: new Float32Array(mid), upHint: A.u, startDir: A.t, U: null };
  finishLine(part);
  const k = part.n - 1;
  const dO = norm([mid[k * 3] - mid[k * 3 - 3], mid[k * 3 + 1] - mid[k * 3 - 2], mid[k * 3 + 2] - mid[k * 3 - 1]]);
  fn(ev, m, part, ev.q(m));
  if (part.dead) { line.dead = true; return; }
  finishLine(part);
  const P = part.pts; const e = part.n - 1;
  // Its start stays where it was, even if the modifier moved it.
  const off = [A.p[0] - P[0], A.p[1] - P[1], A.p[2] - P[2]];
  for (let i = 0; i < P.length; i += 3) { P[i] += off[0]; P[i + 1] += off[1]; P[i + 2] += off[2]; }
  const E = [P[e * 3], P[e * 3 + 1], P[e * 3 + 2]];
  const dM = e > 0 ? norm([P[e * 3] - P[e * 3 - 3], P[e * 3 + 1] - P[e * 3 - 2], P[e * 3 + 2] - P[e * 3 - 1]]) : dO;
  const ax = cross(dO, dM); const sin = len(ax); const ang = Math.atan2(sin, dot(dO, dM));
  const turn = (v) => (sin > 1e-9 ? rotate(v, mul(ax, 1 / sin), ang) : v);
  const out = [...head, ...P];
  for (let i = 0; i < tail.length; i += 3) {
    const r = turn([tail[i] - B.p[0], tail[i + 1] - B.p[1], tail[i + 2] - B.p[2]]);
    out.push(E[0] + r[0], E[1] + r[1], E[2] + r[2]);
  }
  for (const key of ['roll', 'align', 'cut']) if (part[key] !== line[key]) line[key] = part[key];
  line.pts = new Float32Array(out);
}

// Every cut keeps the line's nominal length, so the thickness at the cut stays as it was (a chopped branch, a
// sliced leaf) instead of tapering to a point; what grew beyond it is gone with the points.
export function cutAt(line, s, keepLength, capEnd) {
  const { pts, len: L, n } = line;
  if (s <= 0) { line.dead = true; return; }
  if (s >= line.length) return;
  let k = 0;
  while (k < n - 1 && L[k + 1] < s) k++;
  sampleLine(line, s, S);
  const out = pts.slice(0, (k + 1) * 3);
  const end = new Float32Array(out.length + 3);
  end.set(out); end[out.length] = S.px; end[out.length + 1] = S.py; end[out.length + 2] = S.pz;
  line.pts = end;
  line.nominal ||= line.length;
  line.cut = true;
  if (capEnd && capEnd !== 'none') line.capEnd = capEnd;
}

function sliceStart(line, s, keepLength, capStart) {
  const { pts, len: L, n, length } = line;
  if (s >= length) { line.dead = true; return; }
  let k = 0;
  while (k < n - 1 && L[k + 1] <= s) k++;
  sampleLine(line, s, S);
  const rest = pts.slice((k + 1) * 3);
  const out = new Float32Array(rest.length + 3);
  out[0] = S.px; out[1] = S.py; out[2] = S.pz;
  out.set(rest, 3);
  line.pts = out;
  line.nominal ||= length;
  line.tOff = (line.tOff || 0) + s;
  if (capStart && capStart !== 'none') line.capStart = capStart;
}

function resample(line, stepAt) {
  const pts = [line.pts[0], line.pts[1], line.pts[2]];
  const L = line.length;
  let s = 0;
  const min = L / 512;
  while (s < L - 1e-4) {
    const st = Math.max(stepAt(s / L), min);
    s = s + st > L - st * 0.25 ? L : s + st;
    sampleLine(line, s, S);
    pts.push(S.px, S.py, S.pz);
  }
  line.pts = new Float32Array(pts);
}

function deviationSpawnsFor(ev, node, line) {
  // Any child distributor of the owning path can pull the parent off course.
  const out = [];
  for (const l of ev.out(line.node.id, 'children')) {
    const dn = ev.nodes.get(l.to);
    if (dn.type === 'PathDistributor' || dn.type === 'SimplePathPos' || (dn.type === 'Placement' && dn.params.place === 'spline')) out.push(...makeSpawns(ev, dn, [line], 1));
  }
  return out;
}

// Where a line heading `d` should turn at a surface with normal `n`: bounce mirrors it off; attract lays it
// along the surface, leaning in a little while it is still above (gap > 0).
export function collideTarget(mode, d, n, gap = 0) {
  const into = dot(d, n);
  if (mode === 'bounce') return norm(sub(d, mul(n, 2 * into)));
  const along = sub(d, mul(n, into));
  if (len(along) < 1e-6) return perpendicular(n);
  return norm(sub(norm(along), mul(n, gap > 0 ? 0.3 : 0)));
}

const pickAngle =(ev, node, q, line, salt) => hash(ev.h(node), line.id, salt);
// World axes as the gizmo names them (Z up).
const GIZMO_AXES = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
// The same axes on the line's own frame where it starts: X its side, Z the way it heads, Y across both.
function localAxes(line) {
  ensureFrames(line);
  const z = [line.T[0], line.T[1], line.T[2]]; const x = [line.U[0], line.U[1], line.U[2]];
  return { x, y: norm(cross(z, x)), z };
}
const axisOf = (P, line) => (P.space === 'world' ? GIZMO_AXES[P.axis] : localAxes(line)[P.axis]) || null;
// The line's own side at point i (its frame's X, which every entity has the same way round), square to the
// heading d and turned by orient around it. Orientations then mean the same on every line.
function sideAt(F, i, d, orient) {
  let u = F ? [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]] : perpendicular(d);
  u = sub(u, mul(d, dot(u, d)));
  if (len(u) < 1e-4) u = perpendicular(d);
  return rotate(norm(u), d, orient);
}
const frameU = (line) => { ensureFrames(line); return line.U; };

export const MODIFIERS = {
  Dir_Random(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const r = pickAngle(ev, node, q, line, 1);
    const axisDir = pickAngle(ev, node, q, line, 2) * Math.PI * 2;
    const smoothing = Math.max(0.1, q.smoothing(c));
    let axis = null; const F = frameU(line);
    walk(line, (i, s, t, d, p, seg) => {
      if (s >= smoothing) return null;
      c.t = t;
      const total = (q.min(c) + (q.max(c) - q.min(c)) * r) * DEG;
      if (!axis) axis = sideAt(F, i, d, axisDir);
      return [axis, total * seg / smoothing];
    });
  },

  Dir_Vector(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const shape = P.source === 'surface' ? ev.shapeLinked(node) : null;
    const base = P.source === 'local' ? line.startDir : norm(P.vector);
    const horizontal = P.mode === 'horizontal';
    walk(line, (i, s, t, d, p, seg) => {
      c.t = t;
      const strength = q.strength(c);
      if (!strength) return null;
      let g = base;
      if (P.source === 'point') g = norm(sub(P.vector, p));
      else if (shape) g = norm(sub(shape.closest(p).p, p));
      if (horizontal) g = norm(sub(d, mul(g, dot(d, g))));
      const amount = Math.abs(strength) * seg / ev.unit;
      const tt = turnToward(d, strength < 0 ? mul(g, -1) : g, amount);
      return tt;
    });
  },

  Dir_Noise(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    ensureFrames(line);
    const seed = (ev.h(node) ^ Math.imul(line.id, 16777619) ^ Math.round(+node.params.seed || 0)) | 0;
    const scale = Math.max(0.1, q.scale(c));
    const phase = q.phase(c);
    const iter = Math.max(1, Math.round(q.iter(c)));
    const rough = q.rough(c);
    const shift = node.params.shift;
    const fbm = (x, s) => {
      let v = noise1(x, s); let a = rough; let f = 2;
      for (let k = 1; k < iter && a > 0; k++) { v += noise1(x * f, s + k * 17) * a; a *= rough; f *= 2; }
      return v;
    };
    const x0 = fbm(phase, seed); const y0 = fbm(phase, seed + 91);
    const out = line.pts.slice();
    const sx = q.sx(c); const sy = q.sy(c);
    for (let i = 0; i < line.n; i++) {
      c.t = line.length ? line.len[i] / line.length : 0;
      const st = q.strength(c);
      const x = phase + line.len[i] / scale;
      const nx = (fbm(x, seed) - (shift ? 0 : x0)) * st * sx;
      const ny = (fbm(x, seed + 91) - (shift ? 0 : y0)) * st * sy;
      const k = i * 3;
      out[k] += line.U[k] * nx + line.V[k] * ny;
      out[k + 1] += line.U[k + 1] * nx + line.V[k + 1] * ny;
      out[k + 2] += line.U[k + 2] * nx + line.V[k + 2] * ny;
    }
    line.pts = out;
  },

  Dir_Deviation(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const P = node.params;
    if (ev.deviating) return;
    ev.deviating = true;
    const spawns = deviationSpawnsFor(ev, node, line);
    ev.deviating = false;
    if (!spawns.length) return;
    const angle = q.angle(c) * DEG;
    const spread = Math.max(1, +(P.spread ?? 20));
    // Each child pulls the stretch of line around it out toward the side the child grows on, as a smooth bump (a
    // kink toward the child): the line keeps its course instead of every fork bending it further the same way.
    const bumps = [];
    for (const sp of spawns) {
      sampleLine(line, sp.s, S);
      const T = [S.tx, S.ty, S.tz];
      // A child heading along the line (no tilt) still grows out on its own side of the bark.
      let side = sub(sp.d, mul(T, dot(sp.d, T)));
      if (len(side) < 1e-3 && sp.out) side = sub(sp.out, mul(T, dot(sp.out, T)));
      if (len(side) < 1e-4) continue;
      const a = Math.min(1.2, P.fromChild ? Math.acos(clamp(dot(sp.d, T), -1, 1)) * 0.5 : angle);
      bumps.push([sp.s, mul(norm(side), Math.tan(a) * spread)]);
    }
    for (let i = 1; i < line.n; i++) {
      const s = line.len[i]; const base = Math.min(1, s / spread);
      for (const [s0, v] of bumps) {
        const g = Math.exp(-(((s - s0) / spread) ** 2)) * base;
        line.pts[i * 3] += v[0] * g; line.pts[i * 3 + 1] += v[1] * g; line.pts[i * 3 + 2] += v[2] * g;
      }
    }
  },

  // Warp: Shape A bends the line to its side, Shape B the other way across it (Z), each by its height above where it starts.
  Dir_Spline(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const a = bakeCurve(P.shapeA); const b = bakeCurve(P.shapeB);
    const seed = ev.h(node);
    const scale = q.scale(c) * (1 - (q.scaleChaos(c) / 100) * hash(seed, line.id, 1));
    const orient = (q.orient(c) + q.orientChaos(c) * (hash(seed, line.id, 2) * 2 - 1)) * DEG;
    const dir = line.startDir;
    const side = sideAt(frameU(line), 0, dir, orient);
    const side2 = norm(cross(dir, side));
    const p0 = [line.pts[0], line.pts[1], line.pts[2]];
    const a0 = sampleCurve(a, 0); const b0 = sampleCurve(b, 0);
    const L = line.length;
    for (let i = 0; i < line.n; i++) {
      const t = L ? line.len[i] / L : 0;
      const va = (sampleCurve(a, t) - a0) * L * scale; const vb = (sampleCurve(b, t) - b0) * L * scale;
      const k = i * 3;
      for (let j = 0; j < 3; j++) line.pts[k + j] = p0[j] + dir[j] * line.len[i] * scale + side[j] * va + side2[j] * vb;
    }
  },

  Dir_HardBend(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const seed = ev.h(node);
    const pos = clamp((q.position(c) + q.posChaos(c) * (hash(seed, line.id, 1) * 2 - 1)) / 100, 0, 1) * line.length;
    const angle = (q.angle(c) + q.angleChaos(c) * (hash(seed, line.id, 2) * 2 - 1)) * DEG;
    const orient = q.orient(c) * DEG + hash(seed, line.id, 3) * (q.orient(c) ? 0 : Math.PI * 2);
    const applyStr = q.applyStrength(c);
    const applyV = norm(node.params.applyVector || [0, -1, 0]);
    // Smoothness spreads the turn evenly over that length around the position, kept inside the line.
    const L = line.length;
    const sm = Math.min(Math.max(0, q.smooth ? q.smooth(c) : 0), L);
    const a0 = sm > 0 ? clamp(pos - sm / 2, 0, L - sm) : pos; const a1 = a0 + sm;
    let done = false; let axis = null; const F = frameU(line);
    walk(line, (i, s, t, d, p, seg) => {
      if (sm > 0) {
        const over = Math.min(s + seg, a1) - Math.max(s, a0);
        if (over > 0) { axis ||= sideAt(F, i, d, orient); done = true; return [axis, angle * over / sm]; }
      } else if (!done && s + seg >= pos) {
        done = true;
        return [sideAt(F, i, d, orient), angle];
      }
      if (done && applyStr) return turnToward(d, applyV, applyStr * seg / ev.unit);
      return null;
    });
  },

  // Droop: a cantilever under its own weight. The bend at a point grows with the line still beyond it and its
  // lever (only the level part pulls, so a hanging tip settles straight down), over a stiffness that falls as the
  // line thins toward its tip; lines longer than Stiffness sag more.
  Dir_Droop(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const L = line.length;
    const k = q.strength(c) * (L / Math.max(1, q.stiffness(c)));
    if (!k || !L) return;
    walk(line, (i, s, t, d, p, seg) => {
      const rest = Math.max(0, 1 - s / L); const thick = 0.25 + 0.75 * rest;
      const lever = Math.max(0.35, Math.hypot(d[0], d[2]));
      return turnToward(d, [0, -1, 0], k * (rest * rest) / (thick * thick) * lever * (seg / L));
    });
  },

  // Curl: the line turns about one axis by Turns over its length, its curvature growing toward the tip by Tighten
  // (1 / (1 - k t), scaled so the whole line still makes the set turns), like a fern bud or a tendril.
  Dir_Curl(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const L = line.length;
    if (!L) return;
    const tight = clamp(q.tighten(c) / 100, 0, 1) * 0.9;
    const W = tight > 0 ? -Math.log(1 - tight) / tight : 1;
    const orient = (q.orient(c) + q.orientChaos(c) * (hash(ev.h(node), line.id, 1) * 2 - 1)) * DEG;
    let axis = axisOf(P, line); const F = frameU(line);
    walk(line, (i, s, t, d, p, seg) => {
      c.t = t;
      axis ||= sideAt(F, i, d, orient);
      return [axis, q.turns(c) * Math.PI * 2 * (seg / L) / (W * (1 - tight * t))];
    });
  },

  // Applied at draw time by the viewport; lines keep their shape so it stays cheap.
  Dir_Wind() {},

  Dir_Copy(ev, node, line, q) {
    const parent = line.parent;
    if (!parent) return;
    const c = ev.setCtx(line, 0);
    const start = sampleLine(parent, line.parentS, newSample());
    const p0 = [line.pts[0], line.pts[1], line.pts[2]];
    const off = sub(p0, [start.px, start.py, start.pz]);
    const radial = len(off) > 1e-3 ? norm(off) : [start.ux, start.uy, start.uz];
    for (let i = 0; i < line.n; i++) {
      c.t = line.length ? line.len[i] / line.length : 0;
      const r = q.radial(c);
      const sp = sampleLine(parent, line.parentS + line.len[i], S);
      const k = i * 3;
      line.pts[k] = sp.px + radial[0] * r + off[0];
      line.pts[k + 1] = sp.py + radial[1] * r + off[1];
      line.pts[k + 2] = sp.pz + radial[2] * r + off[2];
    }
  },

  Dir_AlignChildren(ev, node, line, q) {
    line.align = clamp(q.amount(ev.setCtx(line, 0)) / 100, 0, 1);
  },

  Dir_Radial(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const orient = q.orient(c) * DEG;
    const smoothing = Math.max(0.1, q.smoothing(c));
    let axis = null; const F = frameU(line);
    // The whole length bends, to the tip; its curve is the way to hold part of it straight.
    walk(line, (i, s, t, d, p, seg) => {
      c.t = t;
      if (!axis) axis = sideAt(F, i, d, orient);
      return [axis, q.angle(c) * DEG * seg / smoothing];
    });
  },

  Dir_Spiral(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    ensureFrames(line);
    const turn = q.turn(c) * DEG;
    const A = axisOf(node.params, line);
    const e1 = A && perpendicular(A); const e2 = A && cross(A, e1);
    const out = line.pts.slice();
    for (let i = 0; i < line.n; i++) {
      c.t = line.length ? line.len[i] / line.length : 0;
      const a = turn * line.len[i] / ev.unit;
      const r = q.radius(c) * Math.min(1, line.len[i] / Math.max(1e-3, q.radius(c)));
      const k = i * 3;
      const x = Math.cos(a) * r; const y = Math.sin(a) * r;
      for (let j = 0; j < 3; j++) out[k + j] += A ? e1[j] * x + e2[j] * y : line.U[k + j] * x + line.V[k + j] * y;
    }
    line.pts = out;
  },

  // Each step leaves the line at Angle (with its variation), alternately to one side and the other of the chosen axis.
  Dir_Zigzag(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const seed = ev.h(node);
    const steps = Math.max(0.5, q.steps(c));
    resample(line, () => steps);
    finishLine(line);
    ensureFrames(line);
    const F = node.params.axis === 'y' ? line.V : line.U;
    const out = line.pts.slice();
    for (let i = 1; i < line.n; i++) {
      c.t = line.length ? line.len[i] / line.length : 0;
      const a = clamp(q.angle(c) + q.angleChaos(c) * (hash(seed, line.id, i) * 2 - 1), 0, 85) * DEG;
      const h = Math.tan(a) * steps / 2 * (i % 2 ? 1 : -1);
      const k = i * 3;
      out[k] += F[k] * h; out[k + 1] += F[k + 1] * h; out[k + 2] += F[k + 2] * h;
    }
    line.pts = out;
  },

  Dir_Twist(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const roll = line.roll && line.roll.length === line.n ? line.roll : new Float32Array(line.n);
    let total = 0;
    for (let i = 1; i < line.n; i++) {
      c.t = line.len[i] / line.length;
      total += q.angle(c) * DEG * (line.len[i] - line.len[i - 1]) / ev.unit;
      roll[i] += total;
    }
    line.roll = roll;
    line.U = null;
  },

  Dir_ObjReact(ev, node, line, q) {
    const shape = ev.shapeLinked(node);
    if (!shape) return;
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const reflectD = q.reflectDist(c); const minD = q.minDist(c);
    const magD = q.magnetDist(c); const magS = q.magnetStr(c) / 100;
    walk(line, (i, s, t, d, p, seg) => {
      const hit = shape.closest(p);
      if (P.reflect && hit.d < reflectD) {
        const facing = dot(d, hit.n);
        if (facing < 0) {
          const k = 1 - Math.max(hit.d, 0) / Math.max(reflectD, 1e-3);
          const tangent = norm(sub(d, mul(hit.n, facing)));
          const tt = turnToward(d, P.prevent && hit.d < minD + seg ? hit.n : tangent, Math.PI * 0.5 * k * k + 0.02);
          if (tt) return tt;
        }
      } else if (P.magnet && hit.d < magD) {
        const k = magS * (1 - hit.d / Math.max(magD, 1e-3));
        return turnToward(d, mul(hit.n, -1), k * seg / Math.max(hit.d, seg));
      }
      return null;
    });
  },

  Dir_PathReact(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const D = Math.max(q.reflectDist(c), P.magnet ? q.magnetDist(c) : 0, 1);
    const magS = q.magnetStr(c) / 100;
    const reflectD = q.reflectDist(c);
    ev.reactHash ||= new Map();
    let grid = ev.reactHash.get(node.id);
    if (!grid) { grid = new Map(); ev.reactHash.set(node.id, grid); }
    const key = (x, y, z) => `${Math.floor(x / D)},${Math.floor(y / D)},${Math.floor(z / D)}`;
    const nearest = (p) => {
      let best = null; let bd = D * D;
      const cx = Math.floor(p[0] / D); const cy = Math.floor(p[1] / D); const cz = Math.floor(p[2] / D);
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
        const cell = grid.get(`${x},${y},${z}`);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i += 3) {
          const dd = (cell[i] - p[0]) ** 2 + (cell[i + 1] - p[1]) ** 2 + (cell[i + 2] - p[2]) ** 2;
          if (dd < bd) { bd = dd; best = [cell[i], cell[i + 1], cell[i + 2], Math.sqrt(dd)]; }
        }
      }
      return best;
    };
    walk(line, (i, s, t, d, p, seg) => {
      if (i === 0) return null;
      const hit = nearest(p);
      if (!hit) return null;
      const away = norm(sub(p, hit));
      if (P.reflect && hit[3] < reflectD) return turnToward(d, away, (1 - hit[3] / reflectD) * 0.6);
      if (P.magnet) return turnToward(d, mul(away, -1), magS * seg / Math.max(hit[3], seg));
      return null;
    });
    for (let i = 0; i < line.pts.length; i += 3) {
      const k = key(line.pts[i], line.pts[i + 1], line.pts[i + 2]);
      let cell = grid.get(k);
      if (!cell) { cell = []; grid.set(k, cell); }
      cell.push(line.pts[i], line.pts[i + 1], line.pts[i + 2]);
    }
  },

  // Keeps a line clear of every line grown before it. The grid of their points is kept per reach and topped
  // up with the lines finished since the last call, so it grows with the plant instead of being rebuilt.
  Dir_Avoid(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const D = Math.max(0.1, q.clearance(c)); const F = Math.max(0, +P.falloff || 0);
    const R = D + (P.mode === 'trim' || P.mode === 'prune' ? 0 : F);
    // Against: lines of this node, of the other nodes, or all of them; each choice keeps its own grid.
    const w = P.with === 'same node' || P.with === 'other nodes' ? P.with : 'everything';
    const grids = (ev.avoidGrids ||= new Map());
    const gk = w === 'everything' ? R : `${R}|${w}|${line.node.id}`;
    let G = grids.get(gk);
    if (!G) { G = { cells: new Map(), done: 0 }; grids.set(gk, G); }
    const key = (x, y, z) => (Math.floor(x / R) * 73856093) ^ (Math.floor(y / R) * 19349663) ^ (Math.floor(z / R) * 83492791);
    for (; G.done < ev.lines.length; G.done++) {
      const l = ev.lines[G.done]; const p = l.pts;
      if (w !== 'everything' && (l.node === line.node) !== (w === 'same node')) continue;
      // Long segments are filled in, so a line can't slip between two far-apart points.
      for (let i = 0; i < p.length; i += 3) {
        const steps = i ? Math.max(1, Math.ceil(Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]) / (R * 0.5))) : 1;
        for (let s = 1; s <= steps; s++) {
          const f = s / steps; const x = i ? p[i - 3] + (p[i] - p[i - 3]) * f : p[i]; const y = i ? p[i - 2] + (p[i + 1] - p[i - 2]) * f : p[i + 1]; const z = i ? p[i - 1] + (p[i + 2] - p[i - 1]) * f : p[i + 2];
          const k = key(x, y, z);
          let cell = G.cells.get(k); if (!cell) G.cells.set(k, (cell = []));
          cell.push(x, y, z);
        }
      }
    }
    const nearest = (x, y, z) => {
      let best = R * R; let hit = null;
      const cx = Math.floor(x / R); const cy = Math.floor(y / R); const cz = Math.floor(z / R);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) for (let d = cz - 1; d <= cz + 1; d++) {
        const cell = G.cells.get((a * 73856093) ^ (b * 19349663) ^ (d * 83492791));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i += 3) {
          const dd = (cell[i] - x) ** 2 + (cell[i + 1] - y) ** 2 + (cell[i + 2] - z) ** 2;
          if (dd < best) { best = dd; hit = [cell[i], cell[i + 1], cell[i + 2]]; }
        }
      }
      return hit && [...hit, Math.sqrt(best)];
    };
    const skip = Math.max(0, +(P.baseSkip ?? 10));
    const pts = line.pts;
    if (P.mode === 'trim' || P.mode === 'prune') {
      for (let i = 1; i < line.n; i++) {
        const a = (i - 1) * 3; const seg = line.len[i] - line.len[i - 1];
        const steps = Math.max(1, Math.ceil(seg / (D * 0.5)));
        for (let k = 1; k <= steps; k++) {
          const f = k / steps; const s = line.len[i - 1] + seg * f;
          if (s < skip) continue;
          const h = nearest(pts[a] + (pts[a + 3] - pts[a]) * f, pts[a + 1] + (pts[a + 4] - pts[a + 1]) * f, pts[a + 2] + (pts[a + 5] - pts[a + 2]) * f);
          if (!h || h[3] >= D) continue;
          if (P.mode === 'prune') { line.dead = true; return; }
          cutAt(line, Math.max(s - D, 1e-3), false, 'none');
          return;
        }
      }
      return;
    }
    if (P.mode === 'push') {
      // Push: each point out to the clearance (by what it lacks, scaled by Amount), fading over the falloff; then
      // smoothed along the line over Spread so it bends aside rather than kinking. Smoothing thins the push, so it
      // runs again (up to four passes) until no point past the base is still inside the clearance.
      const n = line.n; const push = new Float32Array(n * 3);
      const spread = Math.max(0, +(P.spread ?? 20));
      for (let pass = 0; pass < 4; pass++) {
        push.fill(0);
        let any = false; let inside = false;
        for (let i = 1; i < n; i++) {
          if (line.len[i] < skip) continue;
          c.t = line.length > 0 ? line.len[i] / line.length : 0;
          const h = nearest(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
          if (!h) continue;
          if (h[3] < D * 0.98) inside = true;
          const lack = h[3] < D ? D - h[3] : F > 0 ? (1 - (h[3] - D) / F) * D * 0.15 : 0;
          if (lack <= 0) continue;
          const away = h[3] > 1e-6 ? norm([pts[i * 3] - h[0], pts[i * 3 + 1] - h[1], pts[i * 3 + 2] - h[2]]) : [line.ux?.[i] ?? 1, 0, 0];
          const m = clamp(q.strength(c) / 100, 0, 1) * lack * (pass ? 1 : 1.15);
          push[i * 3] = away[0] * m; push[i * 3 + 1] = away[1] * m; push[i * 3 + 2] = away[2] * m; any = true;
        }
        if (!any) break;
        // Spread: each point takes the strongest push near it, faded by distance along the line, so the line bows
        // out smoothly around a touch at full strength instead of averaging it away.
        const out = new Float32Array(n * 3);
        let lo = 1;
        for (let i = 1; i < n; i++) {
          while (line.len[i] - line.len[lo] > spread * 3) lo++;
          let best = 0;
          for (let k = lo; k < n && line.len[k] - line.len[i] <= spread * 3; k++) {
            const g = spread > 0 ? Math.exp(-(((line.len[k] - line.len[i]) / spread) ** 2)) : k === i ? 1 : 0;
            const mag = Math.hypot(push[k * 3], push[k * 3 + 1], push[k * 3 + 2]) * g;
            if (mag > best) { best = mag; out[i * 3] = push[k * 3] * g; out[i * 3 + 1] = push[k * 3 + 1] * g; out[i * 3 + 2] = push[k * 3 + 2] * g; }
          }
        }
        for (let i = 0; i < n * 3; i++) pts[i] += out[i];
        finishLine(line);
        if (!inside) break;
      }
      return;
    }
    // Bend: the line is regrown step by step and, where its next point would come near another line, turns away
    // from there on (mirrored off it when heading in), harder the closer it is; meeting another later, it turns
    // away again. Each step turns at most as far as an arc of Bend radius allows, so it curves off instead of
    // kinking. A long segment is checked at points along it, so it can't step through a line.
    const radius = Math.max(1, +(P.radius ?? 25));
    walk(line, (i, s, t, d, p, seg) => {
      if (s < skip) return null;
      c.t = t;
      const k = clamp(q.strength(c) / 100, 0, 1);
      if (!k) return null;
      const m = Math.max(1, Math.ceil(seg / (D * 0.5)));
      let h = null; let nx = null;
      for (let j = 1; j <= m && !h; j++) { nx = [p[0] + d[0] * seg * j / m, p[1] + d[1] * seg * j / m, p[2] + d[2] * seg * j / m]; h = nearest(nx[0], nx[1], nx[2]); }
      if (!h) return null;
      const away = h[3] > 1e-6 ? norm(sub(nx, h)) : perpendicular(d);
      const into = dot(d, away);
      if (into >= 0 && h[3] >= D) return null;
      const near = h[3] < D ? 1 : 1 - (h[3] - D) / Math.max(F, 1e-3);
      let target = into < 0 ? norm(sub(d, mul(away, 2 * into))) : norm([d[0] + away[0], d[1] + away[1], d[2] + away[2]]);
      // Head on, the mirror is straight back: lean it to one side so there is a way to turn.
      if (len(cross(d, target)) < 1e-3) target = norm([target[0] + perpendicular(d)[0] * 0.5, target[1] + perpendicular(d)[1] * 0.5, target[2] + perpendicular(d)[2] * 0.5]);
      return turnToward(d, target, Math.min(Math.PI * 0.5, seg / radius) * k * Math.max(near, 0.25));
    });
  },

  Dir_ObjSlice(ev, node, line, q) {
    const shape = ev.shapeLinked(node);
    if (!shape) return;
    const P = node.params;
    const D = q.distance(ev.setCtx(line, 0));
    for (let i = 1; i < line.n; i++) {
      const p = [line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2]];
      if (shape.closest(p).d < D) {
        if (P.erase) { line.dead = true; return; }
        cutAt(line, line.len[i - 1], P.keepLength, P.capEnd);
        return;
      }
    }
  },

  // The floor (a level plane at Height) or a connected scene mesh: lines that come near it lie along it
  // (attract), turn off it (bounce) or stop there (trim).
  Dir_Collide(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const shape = P.target === 'object' ? ev.shapeLinked(node) : null;
    if (P.target === 'object' && !shape) { ev.warnings.add('Collide set to Object needs a scene object connected.'); return; }
    const h = +P.height || 0;
    const hitAt = shape ? (p) => shape.closest(p) : (p) => ({ d: p[1] - h, n: [0, 1, 0] });
    const D = Math.max(0, q.distance(c));
    if (P.mode === 'trim') {
      for (let i = 1; i < line.n; i++) {
        if (hitAt([line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2]]).d < D) {
          if (P.erase) { line.dead = true; return; }
          cutAt(line, line.len[i - 1], false, 'none');
          return;
        }
      }
      return;
    }
    const reach = Math.max(D + 1e-3, +P.reach || 0);
    walk(line, (i, s, t, d, p, seg) => {
      c.t = t;
      const k = clamp(q.strength(c) / 100, 0, 1);
      if (!k) return null;
      const next = [p[0] + d[0] * seg, p[1] + d[1] * seg, p[2] + d[2] * seg];
      const hit = hitAt(next);
      const into = dot(d, hit.n);
      if (P.mode === 'bounce') {
        if (hit.d >= D || into >= 0) return null;
        return turnToward(d, collideTarget('bounce', d, hit.n), Math.PI * k);
      }
      if (hit.d >= reach) return null;
      // Inside the reach it bends onto the surface, more the closer it gets, and never goes through.
      const near = hit.d <= D ? 1 : 1 - (hit.d - D) / (reach - D);
      return turnToward(d, collideTarget('attract', d, hit.n, hit.d - D), Math.PI * k * Math.max(near, into < 0 && hit.d < D ? 1 : 0) * Math.min(1, seg / Math.max(reach - D, 1e-3) * 4));
    });
  },

  Dir_VectorOrient(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    ensureFrames(line);
    const target = norm(P.vector);
    const roll = line.roll && line.roll.length === line.n ? line.roll : new Float32Array(line.n);
    for (let i = 0; i < line.n; i++) {
      c.t = line.len[i] / (line.length || 1);
      const k = i * 3;
      const T = [line.T[k], line.T[k + 1], line.T[k + 2]];
      const U = [line.U[k], line.U[k + 1], line.U[k + 2]];
      const V = [line.V[k], line.V[k + 1], line.V[k + 2]];
      const proj = sub(target, mul(T, dot(target, T)));
      if (len(proj) < 1e-4) continue;
      const a = Math.atan2(dot(proj, V), dot(proj, U));
      roll[i] += (a + (P.axis === 'x' ? 0 : -Math.PI / 2)) * (q.strength(c) / 100);
    }
    line.roll = roll;
    line.U = null;
  },

  Dir_StartEndSlice(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const seed = ev.h(node);
    const end = q.end(c); const start = q.start(c);
    if (end > 0 && hash(seed, line.id, 2) * 100 < q.endRate(c)) cutAt(line, line.length - end, P.keepLength, P.capEnd);
    if (line.dead) return;
    finishLine(line);
    if (start > 0 && hash(seed, line.id, 1) * 100 < q.startRate(c)) sliceStart(line, start, P.keepLength, P.capStart);
  },

  // Trim: a share of the lines (Lines cut) break off at Cut at, moved up or down by the variation.
  Dir_Cut(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const seed = ev.h(node);
    if (hash(seed, line.id, 1) * 100 >= q.rate(c)) return;
    const at = clamp((q.at(c) + q.atChaos(c) * (hash(seed, line.id, 2) * 2 - 1)) / 100, 0, 1);
    if (at < 1) cutAt(line, at * line.length, true, 'none');
  },

  Dir_OptimizeSteps(ev, node, line, q) {
    const tol = q.tolerance(ev.setCtx(line, 0)) * DEG;
    const p = line.pts;
    const keep = [p[0], p[1], p[2]];
    let last = 0;
    for (let i = 1; i < line.n - 1; i++) {
      const a = norm([p[i * 3] - p[last * 3], p[i * 3 + 1] - p[last * 3 + 1], p[i * 3 + 2] - p[last * 3 + 2]]);
      const b = norm([p[i * 3 + 3] - p[i * 3], p[i * 3 + 4] - p[i * 3 + 1], p[i * 3 + 5] - p[i * 3 + 2]]);
      if (Math.acos(clamp(dot(a, b), -1, 1)) >= tol) { keep.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); last = i; }
    }
    keep.push(p[(line.n - 1) * 3], p[(line.n - 1) * 3 + 1], p[(line.n - 1) * 3 + 2]);
    line.pts = new Float32Array(keep);
    line.roll = null;
  },

  Dir_Eraser(ev, node, line) {
    if ((node.params.lines || []).includes(line.id)) line.dead = true;
  },

  Dir_Trim(ev, node, line) {
    const cut = (node.params.cuts || []).find((x) => x.line === line.id);
    if (cut) cutAt(line, cut.t * line.length, node.params.keepLength, node.params.capEnd);
  },

  Dir_OverrideSteps(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    if (q.steps.linked || !node.params.uniform) {
      resample(line, (t) => { c.t = t; return q.steps(c); });
    } else {
      const n = Math.max(1, Math.round(line.length / Math.max(q.steps(c), 1e-3)));
      resample(line, () => line.length / n);
    }
    line.roll = null;
  },

  Dir_Shape(ev, node, line, q) {
    const edits = (node.params.edits || []).filter((e) => e.line === line.id);
    if (!edits.length) return;
    const r = Math.max(0.02, q.falloff(ev.setCtx(line, 0)));
    for (let i = 0; i < line.n; i++) {
      const t = line.length ? line.len[i] / line.length : 0;
      for (const e of edits) {
        const k = Math.exp(-(((t - e.t) / r) ** 2));
        line.pts[i * 3] += e.d[0] * k; line.pts[i * 3 + 1] += e.d[1] * k; line.pts[i * 3 + 2] += e.d[2] * k;
      }
    }
  },
};
