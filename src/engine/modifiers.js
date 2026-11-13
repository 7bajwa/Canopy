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

export function cutAt(line, s, keepLength, capEnd) {
  const { pts, len: L, n } = line;
  if (s <= 0) { line.dead = true; return; }
  let k = 0;
  while (k < n - 1 && L[k + 1] < s) k++;
  sampleLine(line, s, S);
  const out = pts.slice(0, (k + 1) * 3);
  const end = new Float32Array(out.length + 3);
  end.set(out); end[out.length] = S.px; end[out.length + 1] = S.py; end[out.length + 2] = S.pz;
  line.pts = end;
  if (!keepLength) line.nominal = s;
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
  if (keepLength) line.tOff = (line.tOff || 0) + s;
  else line.nominal = length - s;
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

export const MODIFIERS = {
  Dir_Random(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const r = pickAngle(ev, node, q, line, 1);
    const axisDir = pickAngle(ev, node, q, line, 2) * Math.PI * 2;
    const smoothing = Math.max(0.1, q.smoothing(c));
    let axis = null;
    walk(line, (i, s, t, d, p, seg) => {
      if (s >= smoothing) return null;
      c.t = t;
      const total = (q.min(c) + (q.max(c) - q.min(c)) * r) * DEG;
      if (!axis) axis = rotate(perpendicular(d), d, axisDir);
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
    spawns.sort((a, b) => a.s - b.s);
    const angle = q.angle(c) * DEG;
    const count = spawns.length;
    // Each kink turns the rest of the line away from the child growing there.
    let idx = 0;
    walk(line, (i, s, t, d, p, seg) => {
      const list = [];
      while (idx < count && spawns[idx].s <= s + seg) {
        const sp = spawns[idx++];
        const side = sub(sp.d, mul(d, dot(sp.d, d)));
        if (len(side) < 1e-4) continue;
        const a = P.fromChild ? Math.acos(clamp(dot(sp.d, d), -1, 1)) * 0.2 : angle;
        list.push([norm(cross(side, d)), a]);
      }
      if (!list.length) return null;
      return list[0];
    });
  },

  Dir_Spline(ev, node, line, q) {
    const P = node.params;
    const c = ev.setCtx(line, 0);
    const a = bakeCurve(P.shapeA); const b = bakeCurve(P.shapeB);
    const seed = ev.h(node);
    const blend = clamp(q.blend(c), 0, 1);
    const scale = q.scale(c) * (1 - (q.scaleChaos(c) / 100) * hash(seed, line.id, 1));
    const orient = (q.orient(c) + q.orientChaos(c) * (hash(seed, line.id, 2) * 2 - 1)) * DEG;
    const dir = line.startDir;
    const side = rotate(perpendicular(dir), dir, orient);
    const p0 = [line.pts[0], line.pts[1], line.pts[2]];
    const base = sampleCurve(a, 0) * (1 - blend) + sampleCurve(b, 0) * blend;
    const L = line.length;
    for (let i = 0; i < line.n; i++) {
      const t = L ? line.len[i] / L : 0;
      const v = (sampleCurve(a, t) * (1 - blend) + sampleCurve(b, t) * blend - base) * L * scale;
      const k = i * 3;
      line.pts[k] = p0[0] + dir[0] * line.len[i] * scale + side[0] * v;
      line.pts[k + 1] = p0[1] + dir[1] * line.len[i] * scale + side[1] * v;
      line.pts[k + 2] = p0[2] + dir[2] * line.len[i] * scale + side[2] * v;
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
    let done = false;
    walk(line, (i, s, t, d, p, seg) => {
      if (!done && s + seg >= pos) {
        done = true;
        return [rotate(perpendicular(d), d, orient), angle];
      }
      if (done && applyStr) return turnToward(d, applyV, applyStr * seg / ev.unit);
      return null;
    });
  },

  // Droop: a cantilever under its own weight. The bend at a point grows with the square of the line still beyond it,
  // so it arches from the base and the tip hangs; lines longer than Stiffness sag more.
  Dir_Droop(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const k = q.strength(c) * (line.length / Math.max(1, q.stiffness(c)));
    if (!k) return;
    walk(line, (i, s, t, d, p, seg) => {
      const rest = Math.max(0, 1 - s / line.length);
      return turnToward(d, [0, -1, 0], k * rest * rest * (seg / line.length) * 1.5);
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
    let axis = null;
    walk(line, (i, s, t, d, p, seg) => {
      if (s >= smoothing) return null;
      c.t = t;
      if (!axis) axis = rotate(perpendicular(d), d, orient);
      return [axis, q.angle(c) * DEG * seg / smoothing];
    });
  },

  Dir_Spiral(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    ensureFrames(line);
    const turn = q.turn(c) * DEG;
    const out = line.pts.slice();
    for (let i = 0; i < line.n; i++) {
      c.t = line.length ? line.len[i] / line.length : 0;
      const a = turn * line.len[i] / ev.unit;
      const r = q.radius(c) * Math.min(1, line.len[i] / Math.max(1e-3, q.radius(c)));
      const k = i * 3;
      const x = Math.cos(a) * r; const y = Math.sin(a) * r;
      out[k] += line.U[k] * x + line.V[k] * y;
      out[k + 1] += line.U[k + 1] * x + line.V[k + 1] * y;
      out[k + 2] += line.U[k + 2] * x + line.V[k + 2] * y;
    }
    line.pts = out;
  },

  Dir_Zigzag(ev, node, line, q) {
    const c = ev.setCtx(line, 0);
    const steps = Math.max(0.5, q.steps(c));
    const r = q.radius(c);
    resample(line, () => steps);
    finishLine(line);
    ensureFrames(line);
    const out = line.pts.slice();
    for (let i = 1; i < line.n; i++) {
      const sign = i % 2 ? 1 : -1;
      const k = i * 3;
      out[k] += line.U[k] * r * sign; out[k + 1] += line.U[k + 1] * r * sign; out[k + 2] += line.U[k + 2] * r * sign;
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
    const R = D + (P.mode === 'push' ? F : 0);
    const grids = (ev.avoidGrids ||= new Map());
    let G = grids.get(R);
    if (!G) { G = { cells: new Map(), done: 0 }; grids.set(R, G); }
    const key = (x, y, z) => (Math.floor(x / R) * 73856093) ^ (Math.floor(y / R) * 19349663) ^ (Math.floor(z / R) * 83492791);
    for (; G.done < ev.lines.length; G.done++) {
      const l = ev.lines[G.done]; const p = l.pts;
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
