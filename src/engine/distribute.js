// Distributors decide where lines start and which way they leave.
import { hash, DEG, cross, norm, rotate, perpendicular, add, mul, sub, clamp, dot, len } from './math.js';
import { sampleLine, newSample, tOf, finishLine } from './line.js';
import { placementSpawns } from './placement.js';

const S = newSample();

// The shared "distributor in point" logic: spreads Count lines around a start vector.
function emitInPoint(ev, dn, q, base, emit) {
  const c = ev.ctx;
  const seed = ev.h(dn);
  const { p, dir, key, phiBase = 0 } = base;
  const rnd = (salt) => hash(seed, key, salt);
  let count = Math.max(0, Math.round(q.count(c)));
  const chaosCount = q.countChaos(c);
  if (chaosCount) count = Math.round(count * (1 - (chaosCount / 100) * rnd(1)));
  if (!count) return;
  // Start vector: spin around the base direction, then lean it.
  const up = base.up || perpendicular(dir);
  const axisA = (q.axisAngle(c) + (rnd(2) * 2 - 1) * q.axisChaos(c)) * DEG;
  const lean = rotate(up, dir, axisA);
  let start = q.startBend(c) ? rotate(dir, norm(cross(dir, lean)), q.startBend(c) * DEG) : dir;
  const randMax = q.randMax(c);
  const randMin = q.randMin(c);
  if (randMax || randMin) {
    const a = rnd(3) * Math.PI * 2;
    const rv = rotate(perpendicular(start), start, a);
    start = rotate(start, norm(cross(start, rv)), (randMin + (randMax - randMin) * rnd(4)) * DEG);
  }
  // The radial direction carries Turn axis from the caller, so it must survive into the spread.
  const flat = sub(up, mul(start, dot(up, start)));
  const u = len(flat) > 1e-4 ? norm(flat) : perpendicular(start);
  const angular = dn.params.layout === 'angular';
  for (let i = 0; i < count; i++) {
    const r = (s) => hash(seed, key, 10 + i * 7 + s);
    const phi = phiBase + (i / count) * Math.PI * 2 + (angular ? (r(0) - 0.5) * (Math.PI * 2 / count) : 0);
    const radial = rotate(u, start, phi);
    const axis = norm(cross(start, radial));
    const div = q.angleDiv(c) + q.divChaos(c) * r(1);
    const bend = q.angleBend(c) + q.bendChaos(c) * r(2);
    const off = q.offset(c) + q.offsetChaos(c) * r(3);
    const d = norm(rotate(start, axis, (div + bend) * DEG));
    // Fully aligned, a line's side lies across the parent, so leaves and petals face the same way round it.
    const loose = 1 - clamp(+(dn.params.alignParent ?? 100) / 100, 0, 1);
    const up = loose ? rotate(axis, d, loose * (r(4) - 0.5) * Math.PI * 2) : axis;
    emit({
      p: off ? add(p, mul(radial, off)) : p, d, up,
      angleDiv: div, angleBend: bend, offset: off, ...base.extra,
    });
  }
}

function setParentCtx(ev, parent, t, key, level) {
  const c = ev.setCtx(parent, t);
  c.pos = t; c.lineId = key; c.level = level;
  return c;
}

function pathDistSpawns(ev, dn, q, parents, lv) {
  const out = [];
  const seed = ev.h(dn);
  const P = dn.params;
  const hasCurve = q.density.linked;
  const baseDensity = +P.density || 1;
  for (const line of parents) {
    const L = line.length;
    if (L <= 0) continue;
    const key0 = line.id * 4099;
    setParentCtx(ev, line, 0, key0, line.level + 1);
    const start = clamp(P.startAbs ? q.start(ev.ctx) : (q.start(ev.ctx) / 100) * L, 0, L);
    const end = clamp(P.endAbs ? q.end(ev.ctx) : (q.end(ev.ctx) / 100) * L, 0, L);
    const span = end - start;
    if (span <= 0) continue;
    const chaos = q.densityChaos(ev.ctx) / 100;
    const density = hasCurve ? baseDensity : q.density(ev.ctx);
    const n = Math.round((density * span / ev.unit) * (1 - chaos * hash(seed, line.id, 1)));
    const turn = q.turn(ev.ctx) * DEG;
    const phi0 = hash(seed, line.id, 2) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const s = start + ((i + 0.5 + (hash(seed, line.id, 3 + i) - 0.5) * 0.7) / n) * span;
      const t = tOf(line, s);
      const key = (key0 + i * 31) | 0;
      setParentCtx(ev, line, t, key, line.level + 1);
      if (hasCurve && hash(seed, key, 5) > q.density(ev.ctx) / baseDensity) continue;
      if (!P.instant && hash(seed, key, 6) > (i + 1) / Math.max(1, n * 0.35)) continue;
      sampleLine(line, s, S);
      let dir = [S.tx, S.ty, S.tz];
      if (line.align && line.startDir) dir = norm(add(mul(dir, 1 - line.align), mul(line.startDir, line.align)));
      const u = norm(add(mul([S.ux, S.uy, S.uz], Math.cos(phi0 + i * turn)), mul([S.vx, S.vy, S.vz], Math.sin(phi0 + i * turn))));
      emitInPoint(ev, dn, q, {
        p: [S.px, S.py, S.pz], dir, key, up: u, phiBase: 0,
        extra: { parent: line, s, pos: t, level: line.level + 1, branchUp: u },
      }, (sp) => out.push(sp));
    }
  }
  return out;
}

// A branch leaves its parent at Angle divergence from the parent's axis, around Turn axis.
// emitInPoint spins around the start vector, so it needs the turn fed in as the radial direction.
function positionSpawn(ev, dn, line, P, q, key, extra, out, emitter) {
  const L = line.length;
  setParentCtx(ev, line, 0, key, line.level + 1);
  const raw = q.position(ev.ctx);
  let s = P.abs ? raw : (raw / 100) * L;
  const chaos = q.chaos(ev.ctx) / 100;
  if (chaos) s -= chaos * hash(ev.h(dn), key, 7) * s;
  s = clamp(s, 0, L);
  const t = tOf(line, s);
  sampleLine(line, s, S);
  const axis = q.axis(ev.ctx) * DEG;
  const bend = q.bend(ev.ctx) * DEG;
  const radial = norm(add(mul([S.ux, S.uy, S.uz], Math.cos(axis)), mul([S.vx, S.vy, S.vz], Math.sin(axis))));
  const T = [S.tx, S.ty, S.tz];
  const dir = norm(rotate(T, norm(cross(T, radial)), bend));
  const base = { p: [S.px, S.py, S.pz], dir, radial, s, t, lengthScale: q.lengthPct(ev.ctx) / 100 };
  emitter(base);
}

export function makeSpawns(ev, dn, parents, lv) {
  const out = [];
  const q = ev.q(dn);
  const P = dn.params;
  const c = ev.ctx;
  const seed = ev.h(dn);
  switch (dn.type) {
    case 'Distributor': {
      c.line = null; c.t = 0; c.lineId = seed; c.level = 0; c.pos = 0;
      emitInPoint(ev, dn, q, { p: P.origin || [0, 0, 0], dir: [0, 1, 0], key: 1, extra: { level: 0, pos: 0 } }, (s) => out.push(s));
      break;
    }
    case 'PointDistributor': {
      (P.points || []).forEach((pt, i) => {
        c.line = null; c.t = 0; c.lineId = (seed + i) | 0; c.level = 0; c.pos = 0;
        emitInPoint(ev, dn, q, { p: pt, dir: [0, 1, 0], key: i + 1, extra: { level: 0, pos: 0 } }, (s) => out.push(s));
      });
      break;
    }
    case 'SurfaceDistributor': {
      const shape = ev.shapeLinked(dn);
      if (!shape) { ev.warnings.add('A Surface distributor needs a Scene object connected.'); break; }
      c.line = null; c.t = 0; c.lineId = seed; c.level = 0; c.pos = 0;
      const density = q.density(c);
      const mode = P.mode;
      const list = [];
      if (mode === 'vertices' && shape.vertices) shape.vertices.forEach((p) => list.push({ p, n: shape.closest(p).n }));
      else if (mode === 'edges' && shape.triangles) {
        for (const t of shape.triangles) list.push({ p: t.a.map((v, k) => (v + t.b[k]) / 2), n: t.n });
      } else {
        const count = Math.round(density * shape.area / (ev.unit * ev.unit));
        for (let i = 0; i < Math.min(count, 20000); i++) list.push(shape.sample(seed, i + 1));
      }
      list.forEach((pt, i) => {
        c.lineId = (seed + i) | 0;
        const dir = norm(pt.n);
        // Ground has no direction of its own, so each start point gets its own turn around the normal.
        const up = rotate(perpendicular(dir), dir, hash(seed, i + 1, 9) * Math.PI * 2);
        emitInPoint(ev, dn, q, { p: pt.p, dir, up, key: i + 1, extra: { level: 0, pos: 0, surfaceLevel: 1 } }, (s) => out.push(s));
      });
      break;
    }
    case 'Placement':
      return placementSpawns(ev, dn, parents);
    case 'PathDistributor':
      if (parents) return pathDistSpawns(ev, dn, q, parents, lv);
      break;
    case 'PathPosDistributor': {
      if (!parents) break;
      const posNodes = ev.in(dn.id, 'positions').map((l) => ev.nodes.get(l.from));
      for (const line of parents) {
        posNodes.forEach((pn, i) => {
          const key = (line.id * 4099 + i * 131) | 0;
          positionSpawn(ev, pn, line, pn.params, ev.q(pn), key, null, out, (b) => {
            setParentCtx(ev, line, b.t, key, line.level + 1);
            emitInPoint(ev, dn, q, {
              p: b.p, dir: b.dir, key, up: b.radial,
              extra: { parent: line, s: b.s, pos: b.t, level: line.level + 1, lengthScale: b.lengthScale },
            }, (s) => out.push(s));
          });
        });
      }
      break;
    }
    case 'SimplePathPos': {
      if (!parents) break;
      for (const line of parents) {
        const key = (line.id * 4099) | 0;
        positionSpawn(ev, dn, line, P, q, key, null, out, (b) => {
          out.push({ p: b.p, d: b.dir, up: cross(b.dir, b.radial), parent: line, s: b.s, pos: b.t, level: line.level + 1, lengthScale: b.lengthScale });
        });
      }
      break;
    }
    default:
  }
  return out;
}

// Hand-drawn strokes become lines. A stroke keeps its shape and follows its parent's position.
export function drawnLines(ev, node, parents) {
  const P = node.params;
  const shape = node.type === 'DrawSurf' ? ev.shapeLinked(node) : null;
  const out = [];
  for (const stroke of P.strokes || []) {
    const raw = stroke.pts || [];
    if (raw.length < 2) continue;
    let parent = null; let s = 0; let shift = [0, 0, 0];
    if (node.type === 'DrawPath') {
      parent = parents?.[stroke.parent ?? 0] || parents?.[0] || null;
      if (parent) {
        s = clamp((stroke.t ?? 0) * parent.length, 0, parent.length);
        sampleLine(parent, s, S);
        shift = sub([S.px, S.py, S.pz], raw[0]);
      }
    }
    const maxLen = +P.length || Infinity;
    const pts = [];
    let travelled = 0;
    for (let i = 0; i < raw.length; i++) {
      if (i) travelled += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1], raw[i][2] - raw[i - 1][2]);
      if (!P.capToDrawing && travelled > maxLen) break;
      let p = add(raw[i], shift);
      if (shape) {
        const hit = shape.closest(p);
        p = add(hit.p, mul(hit.n, +P.lift || 0));
      }
      pts.push(p[0], p[1], p[2]);
    }
    if (pts.length < 6) continue;
    const d = norm([pts[3] - pts[0], pts[4] - pts[1], pts[5] - pts[2]]);
    const sp = { p: pts.slice(0, 3), d, parent, s, pos: parent ? s / parent.length : 0, level: parent ? parent.level + 1 : 0 };
    const line = ev.newLine(node, sp, new Float32Array(pts), 0);
    finishLine(line);
    line.nominal = line.length;
    ev.applyChain(ev.chain(node, 'dir'), line);
    if (line.dead) continue;
    ev.segs += line.n;
    ev.lines.push(line);
    out.push(line);
  }
  return out;
}
