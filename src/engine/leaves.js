// Leaf and instance builders. A leaf follows its line; with an atlas shape its outline hugs the opaque pixels.
import { hash, DEG, clamp, bakeCurve, sampleCurve, hexToRgb, norm, sub } from './math.js';
import { sampleLine, newSample, tOf } from './line.js';
import { windWeight } from './wind.js';

const POLYGONS = {
  rectangle: [[-1, 0], [1, 0], [1, 1], [-1, 1]],
  diamond: [[0, 0], [1, 0.5], [0, 1], [-1, 0.5]],
  hexagon: [[-0.5, 0], [0.5, 0], [1, 0.5], [0.5, 1], [-0.5, 1], [-1, 0.5]],
  octagon: [[-0.4, 0], [0.4, 0], [1, 0.3], [1, 0.7], [0.4, 1], [-0.4, 1], [-1, 0.7], [-1, 0.3]],
};

// Finds the cutouts a builder should use, and registers its atlas as the mesh's texture.
function shapesFor(ev, job) {
  if (job.cutouts !== undefined) return job.cutouts;
  const l = ev.in(job.node.id, 'shape')[0];
  job.cutouts = null;
  if (l) {
    const n = ev.nodes.get(l.from);
    // Every cutout switched off on the node: no leaves at all, rather than plain blades.
    if (n.params.none) { job.cutouts = []; return job.cutouts; }
    const list = (n.params.cutouts || []).filter((c) => c.mesh?.pts?.length >= 3 && c.enabled !== false);
    if (list.length) { job.cutouts = list; job.comps.atlas = n.params.atlas; }
    else ev.warnings.add('A cutout leaf has no meshes yet: open the cutout editor and detect or add some.');
  }
  return job.cutouts;
}

function pickCutout(ev, job, list, line) {
  return list[Math.floor(hash(ev.h(job.node), line.id, 9) * list.length) % list.length];
}

// How far along and up a path gets after walking d, starting at angle a0 and turning by kappa per unit: an exact arc,
// so a leaf curls and bends the same however few points it has.
export const arc = (a0, kappa, d) => (Math.abs(kappa) < 1e-9
  ? [d * Math.cos(a0), d * Math.sin(a0)]
  : [(Math.sin(a0 + kappa * d) - Math.sin(a0)) / kappa, (Math.cos(a0) - Math.cos(a0 + kappa * d)) / kappa]);

// The leaf's frame at one place along its line: the midrib point after Angle and Bend lift it off the line, the
// side direction (turned by Twist) and the leaf's normal there.
function leafFrame(S, a, s, axis, pitch, bendK) {
  const ca = Math.cos(axis); const sa = Math.sin(axis);
  const b = [S.ux * ca + S.vx * sa, S.uy * ca + S.vy * sa, S.uz * ca + S.vz * sa];
  const n = [S.vx * ca - S.ux * sa, S.vy * ca - S.uy * sa, S.vz * ca - S.uz * sa];
  const T = [S.tx, S.ty, S.tz];
  const [X, Y] = arc(pitch, bendK, a);
  const th = pitch + bendK * a; const c = Math.cos(th); const sn = Math.sin(th);
  // Past either end of the line the leaf carries on straight, which X - s covers too.
  const m = [0, 1, 2].map((i) => [S.px, S.py, S.pz][i] + T[i] * (X - s) + n[i] * Y);
  return { m, b, n: [0, 1, 2].map((i) => n[i] * c - T[i] * sn) };
}

// Out from the midrib by d on one side: Fold is the angle it leaves at, Curl how far the edge has turned by `edge`.
const across = (f, sign, fold, curlK, d) => {
  const [u, w] = arc(fold, curlK, d);
  return [0, 1, 2].map((i) => f.m[i] + f.b[i] * sign * u + f.n[i] * w);
};

// Where a point of a cutout leaf ends up: at its place along the line, lifted by Angle, bent along, twisted,
// then folded and curled out from the midrib. The leaf mesh and its sprout points both use this, so children start on its surface.
function leafShaper(ev, job, line, ct, { spin = 0, a = 0, b = 1 } = {}) {
  const P = job.node.params;
  const q = ev.q(job.node);
  const S = newSample();
  const L = line.length;
  // Start and Finish shorten the leaf along its line; it keeps its proportions, so it narrows too.
  const len = L * Math.max(b - a, 0.01);
  const kLen = len * (P.proportional ? L / ev.unit : 1);
  const k = kLen * q.shapeScale(ct);
  // Width read again at each point along the leaf, so its own curve tapers the cutout from base (0) to tip (1).
  const widthAt = q.shapeScale.linked ? (t) => { ct.t = clamp(t, 0, 1); return kLen * q.shapeScale(ct); } : () => k;
  const fold = q.angleAcross(ct) * DEG;
  const pitch = q.angleAlong(ct) * DEG;
  // Curl is how far a typical leaf edge (a quarter of the leaf's length out) has turned; Bend is the turn at the tip.
  const curlK = (q.incAcross(ct) * DEG * q.incScale(ct)) / Math.max(0.25 * k, 1e-6);
  const bendK = (q.incAlong(ct) * DEG * q.incScale(ct)) / Math.max(L, 1e-6);
  const twist = q.leafTwist(ct) * DEG;
  // dz lifts a point off the leaf's surface (from the cutout's 3D shape), in leaf lengths like t and x.
  return (t, x, dz = 0) => {
    const along = a * L + t * len;
    const s = clamp(along, 0, L);
    const kw = widthAt(t);
    sampleLine(line, s, S);
    ct.t = clamp(s / Math.max(L, 1e-3), 0, 1);
    // A curve on Twist is read along the leaf, so it shapes where the leaf turns.
    const tw = q.leafTwist.linked ? q.leafTwist(ct) * DEG : twist;
    const f = leafFrame(S, along, s, q.angleAxis(ct) * DEG + tw * t + spin, pitch, bendK);
    const p = across(f, x < 0 ? -1 : 1, fold, curlK, Math.abs(x) * kw);
    if (dz) for (let i = 0; i < 3; i++) p[i] += f.n[i] * dz * k;
    return { p, s, t: ct.t };
  };
}

// The sprout points of the cutout leaf a line was given, placed on that leaf as it is shaped.
export function sproutFrames(ev, line) {
  const job = ev.jobs.get(line.node.id.replace('#path', '#mesh'));
  if (!job) return [];
  const list = shapesFor(ev, job);
  if (!list?.length) return [];
  const sprouts = pickCutout(ev, job, list, line).sprouts || [];
  if (!sprouts.length) return [];
  const at = leafShaper(ev, job, line, ev.setCtx(line, 0));
  const e = 0.02;
  return sprouts.map((sp) => {
    const here = at(sp.t, sp.s);
    // The leaf's own surface around the point gives both the way to grow and the way off the leaf.
    const a = at(sp.t + e, sp.s).p; const b = at(sp.t, sp.s + e).p; const o = here.p;
    const T = norm(sub(a, o)); const B = norm(sub(b, o));
    const axis = norm([T[0] * sp.da + B[0] * sp.db, T[1] * sp.da + B[1] * sp.db, T[2] * sp.da + B[2] * sp.db]);
    const nrm = norm([T[1] * B[2] - T[2] * B[1], T[2] * B[0] - T[0] * B[2], T[0] * B[1] - T[1] * B[0]]);
    // Square to the axis, so tilting a child lifts it off the leaf.
    const d = nrm[0] * axis[0] + nrm[1] * axis[1] + nrm[2] * axis[2];
    const normal = norm([nrm[0] - axis[0] * d, nrm[1] - axis[1] * d, nrm[2] - axis[2] * d]);
    return { p: o, axis, normal, t: sp.t, level: sp.level || 1 };
  });
}

function applySoft(ev, buf, from, to, soft) {
  if (!soft) return;
  const [cx, cy, cz] = ev.treeCenter;
  for (let i = from; i < to; i++) {
    const k = i * 3;
    let ox = buf.position[k] - cx; let oy = buf.position[k + 1] - cy; let oz = buf.position[k + 2] - cz;
    const ol = Math.hypot(ox, oy, oz) || 1;
    ox /= ol; oy /= ol; oz /= ol;
    // Keep the leaf facing its visible side; only the canopy-wide shape leans outward.
    const nx = buf.normal[k]; const ny = buf.normal[k + 1]; const nz = buf.normal[k + 2];
    const side = nx * ox + ny * oy + nz * oz < 0 ? -1 : 1;
    let rx = nx + (ox * side - nx) * soft; let ry = ny + (oy * side - ny) * soft; let rz = nz + (oz * side - nz) * soft;
    const m = Math.hypot(rx, ry, rz) || 1;
    rx /= m; ry /= m; rz /= m;
    buf.normal[k] = rx; buf.normal[k + 1] = ry; buf.normal[k + 2] = rz;
  }
}

function setCommon(buf, idx, col, col2, line, t, flutter) {
  buf.color[idx * 3] = col[0]; buf.color[idx * 3 + 1] = col[1]; buf.color[idx * 3 + 2] = col[2];
  buf.color2[idx * 3] = col2[0]; buf.color2[idx * 3 + 1] = col2[1]; buf.color2[idx * 3 + 2] = col2[2];
  buf.wind[idx * 3] = line.windIndex; buf.wind[idx * 3 + 1] = windWeight(line, t); buf.wind[idx * 3 + 2] = flutter;
}

// One cutout leaf on its line.
// The far LODs' cutout: one quad over the leaf's extent, its UVs fitted (an affine map from the leaf's own t, x
// to the picture's u, v), so the picture's alpha still draws the outline. No 3D edits.
const cards = new WeakMap();
export function cutoutCard(mesh) {
  if (cards.has(mesh)) return cards.get(mesh);
  const { pts } = mesh;
  let t0 = Infinity; let t1 = -Infinity; let x0 = Infinity; let x1 = -Infinity;
  for (const p of pts) { t0 = Math.min(t0, p.t); t1 = Math.max(t1, p.t); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
  // Least squares for u = a·t + b·x + c (and the same for v).
  const fit = (k) => {
    let stt = 0; let stx = 0; let st = 0; let sxx = 0; let sx = 0; let n = 0; let su = 0; let stu = 0; let sxu = 0;
    for (const p of pts) { stt += p.t * p.t; stx += p.t * p.x; st += p.t; sxx += p.x * p.x; sx += p.x; n++; su += p[k]; stu += p.t * p[k]; sxu += p.x * p[k]; }
    const M = [[stt, stx, st], [stx, sxx, sx], [st, sx, n]]; const B = [stu, sxu, su];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M) || 1;
    return [0, 1, 2].map((c) => det(M.map((row, r) => row.map((v, j) => (j === c ? B[r] : v)))) / D);
  };
  const fu = fit('u'); const fv = fit('v');
  const corner = (t, x) => ({ t, x, u: fu[0] * t + fu[1] * x + fu[2], v: fv[0] * t + fv[1] * x + fv[2] });
  const card = { pts: [corner(t0, x0), corner(t0, x1), corner(t1, x1), corner(t1, x0)], tris: [0, 1, 2, 0, 2, 3] };
  cards.set(mesh, card);
  return card;
}

function cutoutLeaf(ev, buf, job, line, cut, steps, ct, flip, shape) {
  const P = job.node.params;
  const comps = job.comps;
  const col = [1, 1, 1]; const col2 = [1, 1, 1];
  const far = ev.lod >= 2 && (+(line.node.params.lodReduce ?? 100)) > 0;
  const { pts, tris } = far ? cutoutCard(cut.mesh) : cut.mesh;
  const at = leafShaper(ev, job, line, ct, shape);
  const count = pts.length;
  const sides = P.twoSided ? 2 : 1;
  const base = buf.reserve(count * sides, tris.length * sides);
  for (let i = 0; i < count; i++) {
    const pt = pts[i];
    // A shape edited in 3D moves points without moving their texture.
    const o = far ? null : cut.deform?.[i];
    const { p, s, t } = o ? at(pt.t + o[1], pt.x + o[0], o[2]) : at(pt.t, pt.x);
    const idx = base + i;
    buf.position[idx * 3] = p[0]; buf.position[idx * 3 + 1] = p[1]; buf.position[idx * 3 + 2] = p[2];
    buf.normal[idx * 3] = 0; buf.normal[idx * 3 + 1] = 0; buf.normal[idx * 3 + 2] = 0;
    buf.uv[idx * 2] = pt.u; buf.uv[idx * 2 + 1] = pt.v;
    col.fill(1); col2.fill(1);
    comps.color(line, tOf(line, s), col, col2);
    setCommon(buf, idx, col, col2, line, t, Math.min(1, t * 1.6));
  }
  // Normals from the leaf's own triangles, so folds shade correctly.
  const p = buf.position; const n = buf.normal;
  for (let i = 0; i < tris.length; i += 3) {
    const a = (base + tris[i]) * 3; const b = (base + tris[i + 1]) * 3; const c = (base + tris[i + 2]) * 3;
    const ux = p[b] - p[a]; const uy = p[b + 1] - p[a + 1]; const uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a]; const wy = p[c + 1] - p[a + 1]; const wz = p[c + 2] - p[a + 2];
    const fx = uy * wz - uz * wy; const fy = uz * wx - ux * wz; const fz = ux * wy - uy * wx;
    for (const v of [a, b, c]) { n[v] += fx; n[v + 1] += fy; n[v + 2] += fz; }
  }
  for (let i = 0; i < count; i++) {
    const v = (base + i) * 3;
    const m = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] *= flip / m; n[v + 1] *= flip / m; n[v + 2] *= flip / m;
  }
  for (let i = 0; i < tris.length; i += 3) {
    if (flip < 0) buf.tri(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    else buf.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  }
  if (sides === 2) {
    const off = base + count;
    for (const [key, size] of [['position', 3], ['uv', 2], ['color', 3], ['color2', 3], ['wind', 3]]) buf[key].copyWithin(off * size, base * size, (base + count) * size);
    for (let i = 0; i < count * 3; i++) n[off * 3 + i] = -n[base * 3 + i];
    for (let i = 0; i < tris.length; i += 3) {
      if (flip < 0) buf.tri(off + tris[i], off + tris[i + 1], off + tris[i + 2]);
      else buf.tri(off + tris[i], off + tris[i + 2], off + tris[i + 1]);
    }
  }
}

// Custom UVs from the mesh node. Atlas leaves keep their fitted coordinates. Values that can vary per line are read per line.
const uvTransform = (P, q, c) => (P.uvOn
  ? { su: (P.flipU ? -1 : 1) * q.tileU(c), sv: (P.flipV ? -1 : 1) * q.tileV(c), ou: q.offsetU(c), ov: q.offsetV(c) }
  : { su: 1, sv: 1, ou: 0, ov: 0 });

export function buildLeaves(ev, buf, job, lines) {
  const b = job.node;
  const P = b.params;
  const q = ev.q(b);
  const cutouts = shapesFor(ev, job);
  const outline = bakeCurve(P.outline);
  const comps = job.comps;
  const bladeRot = ev.param(b, { k: 'bladeRot', d: 0, abs: true, along: 'pos' });
  const leafStart = ev.param(b, { k: 'leafStart', d: 0, along: 'pos' });
  const leafEnd = ev.param(b, { k: 'leafEnd', d: 100, along: 'pos' });
  const c = ev.ctx;
  const S = newSample();
  const soft = +P.softNormals || 0;
  const start = buf.nv;
  let sideSteps = Math.max(1, Math.round(q.sideSteps(c)));
  if (ev.draft) sideSteps = 1;
  const flipN = P.flip ? -1 : 1;
  const col = [1, 1, 1]; const col2 = [1, 1, 1];
  const blades = Math.max(1, Math.round(+P.blades || 1));

  for (const line of lines) {
    if (line.n < 2 || line.length <= 1e-3) continue;
    const v0 = buf.nv;
    if (cutouts) {
      if (!cutouts.length) continue;
      const ct = ev.setCtx(line, 0);
      const rot = bladeRot(ct) * DEG;
      const shape = { a: leafStart(ct) / 100, b: leafEnd(ct) / 100 };
      for (let blade = 0; blade < blades; blade++) {
        cutoutLeaf(ev, buf, job, line, pickCutout(ev, job, cutouts, line), sideSteps, ev.setCtx(line, 0), flipN, { ...shape, spin: (blade / blades) * Math.PI + rot });
      }
      blendLeafBase(buf, v0, buf.nv, line, P);
      continue;
    }
    for (let blade = 0; blade < blades; blade++) {
    const ct = ev.setCtx(line, 0);
    const uvt = uvTransform(P, q, ct);
    const rot = bladeRot(ct) * DEG;
    const bladeAxis = blades > 1 ? ((blade / blades) * Math.PI) + rot : rot;
    const leafA = leafStart(ct) / 100; const leafB = leafEnd(ct) / 100;
    const L = line.length;
    let rows;
    if (P.overrideSteps) {
      const n = Math.max(1, Math.round(L / Math.max(+P.stepSize || 4, L / 256)));
      rows = Array.from({ length: n + 1 }, (_, i) => ({ t: i / n }));
    } else rows = Array.from(line.len, (s) => ({ t: s / L }));
    let steps = sideSteps;
    if (P.optimize) {
      ct.t = 0.5;
      steps = Math.max(1, Math.min(8, Math.round(q.width(ct) / Math.max(+P.faceSize || 6, 0.1))));
    }
    const fold = q.angleAcross(ct) * DEG;
    const pitch = q.angleAlong(ct) * DEG;
    const curlA = q.incAcross(ct) * DEG * q.incScale(ct);
    const bendK = (q.incAlong(ct) * DEG * q.incScale(ct)) / Math.max(L, 1e-6);
    const twist = q.leafTwist(ct) * DEG;
    const scaleW = (P.proportional ? L / ev.unit : 1) * (line.sizeScale ?? 1);
    const noCenter = P.noCenter && steps === 1;
    const cols = noCenter ? 2 : steps * 2 + 1;
    const rowsN = rows.length;
    const base = buf.reserve(rowsN * cols * (P.twoSided ? 2 : 1), (rowsN - 1) * (cols - 1) * 6 * (P.twoSided ? 2 : 1));

    for (let r = 0; r < rowsN; r++) {
      const row = rows[r];
      const s = clamp((leafA + (leafB - leafA) * row.t) * L, 0, L);
      sampleLine(line, s, S);
      ct.t = row.t;
      const tw = q.leafTwist.linked ? q.leafTwist(ct) * DEG : twist;
      const f = leafFrame(S, s, s, q.angleAxis(ct) * DEG + bladeAxis + tw * row.t, pitch, bendK);
      // Curl is how far the edge has turned at the full width.
      const curlK = curlA / Math.max(q.width(ct) * scaleW, 1e-3);
      const wl = q.width(ct) * scaleW * (q.width.linked ? 1 : sampleCurve(outline, row.t));
      const wr = wl;
      col.fill(1); col2.fill(1);
      comps.color(line, tOf(line, s), col, col2);
      const windT = tOf(line, s);
      const flutter = Math.min(1, windT * 1.6);
      const write = (colIdx, px, py, pz, x) => {
        const idx = base + r * cols + colIdx;
        buf.position[idx * 3] = px; buf.position[idx * 3 + 1] = py; buf.position[idx * 3 + 2] = pz;
        buf.uv[idx * 2] = (0.5 + x * 0.5) * uvt.su + uvt.ou; buf.uv[idx * 2 + 1] = row.t * uvt.sv + uvt.ov;
        setCommon(buf, idx, col, col2, line, windT, flutter);
      };

      // Out from the midrib on each side, folded and curled.
      const side = (sign, width, startCol, dirCol) => {
        for (let k = 1; k <= steps; k++) {
          const p = across(f, sign, fold, curlK, (width * k) / steps);
          const uvx = P.uvFit ? sign * (k / steps) : sign * (k / steps) * (width / Math.max(q.width(ct) * scaleW, 1e-3));
          write(startCol + dirCol * (k - 1), p[0], p[1], p[2], uvx);
        }
      };
      if (noCenter) {
        side(-1, wl, 0, 0);
        side(1, wr, 1, 0);
      } else {
        write(steps, f.m[0], f.m[1], f.m[2], 0);
        side(-1, wl, steps - 1, -1);
        side(1, wr, steps + 1, 1);
      }
    }

    // Normals from the leaf's own grid, so folds shade correctly.
    for (let r = 0; r < rowsN; r++) {
      const ra = Math.max(r - 1, 0); const rb = Math.min(r + 1, rowsN - 1);
      for (let v = 0; v < cols; v++) {
        const ca = Math.max(v - 1, 0); const cb = Math.min(v + 1, cols - 1);
        const a = (base + ra * cols + v) * 3; const bb = (base + rb * cols + v) * 3;
        const d = (base + r * cols + ca) * 3; const e = (base + r * cols + cb) * 3;
        const p = buf.position;
        const ux = p[bb] - p[a]; const uy = p[bb + 1] - p[a + 1]; const uz = p[bb + 2] - p[a + 2];
        const wx = p[e] - p[d]; const wy = p[e + 1] - p[d + 1]; const wz = p[e + 2] - p[d + 2];
        let nx = wy * uz - wz * uy; let ny = wz * ux - wx * uz; let nz = wx * uy - wy * ux;
        const m = Math.hypot(nx, ny, nz);
        if (m > 1e-9) { nx /= m; ny /= m; nz /= m; } else { nx = 0; ny = 1; nz = 0; }
        const k = (base + r * cols + v) * 3;
        buf.normal[k] = nx * flipN; buf.normal[k + 1] = ny * flipN; buf.normal[k + 2] = nz * flipN;
      }
    }
    for (let r = 0; r + 1 < rowsN; r++) {
      for (let v = 0; v + 1 < cols; v++) {
        const a = base + r * cols + v; const d = a + cols; const e = a + 1; const f = d + 1;
        if (P.flip) { buf.tri(a, d, e); buf.tri(e, d, f); } else { buf.tri(a, e, d); buf.tri(e, f, d); }
      }
    }
    if (P.twoSided) mirror(buf, base, rowsN * cols, rowsN, cols, P.flip);
    }
    blendLeafBase(buf, v0, buf.nv, line, P);
  }
  applySoft(ev, buf, start, buf.nv, soft);
}

// Leaf blend: the base of each leaf wraps onto its parent's bark. Points within Blend height (in parent radii) of
// the leaf's start are spread sideways by Blend spread and pulled onto the parent's surface, fully at the base and
// fading out up the leaf (faster with more smoothness).
const B0 = newSample(); const B1 = newSample();
function blendLeafBase(buf, v0, v1, line, P) {
  const parent = line.parent;
  if (!P.leafBlend || !parent?.radii || v1 <= v0) return;
  const R = sampleLine(parent, line.parentS, B1).r;
  if (R <= 1e-4) return;
  const H = Math.max(1e-3, (+P.leafBlendHeight || 2) * R);
  const spread = Math.max(0, +(P.leafBlendSpread ?? 0.5)); const pow = 1 + 3 * clamp(+(P.leafBlendSmooth ?? 0.5), 0, 1);
  const sink = clamp((+P.leafBlendSink || 0) / 100, 0, 0.9);
  sampleLine(line, 0, B0);
  const o = [B0.px, B0.py, B0.pz]; const T = [B0.tx, B0.ty, B0.tz];
  const pa = [B1.px, B1.py, B1.pz]; const pt = [B1.tx, B1.ty, B1.tz];
  const pos = buf.position;
  for (let v = v0; v < v1; v++) {
    const d = [pos[v * 3] - o[0], pos[v * 3 + 1] - o[1], pos[v * 3 + 2] - o[2]];
    const s = d[0] * T[0] + d[1] * T[1] + d[2] * T[2];
    if (s >= H) continue;
    const w = (1 - Math.max(0, s) / H) ** pow;
    // Out from the midrib: widened by Blend spread, and at least a share of the parent's thickness at the base, so a
    // leaf that narrows to a point still meets the bark with some width.
    const lat = [d[0] - T[0] * s, d[1] - T[1] * s, d[2] - T[2] * s]; const ll = Math.hypot(...lat);
    const want = ll > 1e-6 ? Math.max(ll * (1 + spread * w), spread * R * w * 0.6) / ll : 1;
    const p = [0, 1, 2].map((i) => o[i] + T[i] * s + lat[i] * want);
    // The nearest spot on the parent's axis, then out to its surface the way this point lies from it.
    const sp = clamp(line.parentS + (p[0] - pa[0]) * pt[0] + (p[1] - pa[1]) * pt[1] + (p[2] - pa[2]) * pt[2], 0, parent.length);
    sampleLine(parent, sp, B1);
    const r = [p[0] - B1.px, p[1] - B1.py, p[2] - B1.pz];
    const along = r[0] * B1.tx + r[1] * B1.ty + r[2] * B1.tz;
    let out = [r[0] - B1.tx * along, r[1] - B1.ty * along, r[2] - B1.tz * along];
    // A point right on the axis (the midrib's start) goes out the way the leaf leaves.
    if (Math.hypot(out[0], out[1], out[2]) < 1e-3 * R) { const k2 = T[0] * B1.tx + T[1] * B1.ty + T[2] * B1.tz; out = [T[0] - B1.tx * k2, T[1] - B1.ty * k2, T[2] - B1.tz * k2]; }
    const l = Math.hypot(out[0], out[1], out[2]);
    const axis = [B1.px, B1.py, B1.pz]; const tan = [B1.tx, B1.ty, B1.tz];
    for (let i = 0; i < 3; i++) {
      const target = l > 1e-6 ? axis[i] + tan[i] * along + (out[i] / l) * B1.r * (1 - sink) : p[i];
      pos[v * 3 + i] = p[i] + (target - p[i]) * w;
    }
  }
}

function mirror(buf, base, count, rowsN, cols, flip) {
  const off = base + count;
  for (const [k, n] of [['position', 3], ['uv', 2], ['color', 3], ['color2', 3], ['wind', 3]]) {
    buf[k].copyWithin(off * n, base * n, (base + count) * n);
  }
  for (let i = 0; i < count; i++) for (let n = 0; n < 3; n++) buf.normal[(off + i) * 3 + n] = -buf.normal[(base + i) * 3 + n];
  for (let r = 0; r + 1 < rowsN; r++) {
    for (let v = 0; v + 1 < cols; v++) {
      const a = off + r * cols + v; const d = a + cols; const e = a + 1; const f = d + 1;
      if (flip) { buf.tri(a, e, d); buf.tri(e, f, d); } else { buf.tri(a, d, e); buf.tri(e, d, f); }
    }
  }
}

export function buildStandardLeaves(ev, buf, job, lines) {
  const b = job.node;
  const P = b.params;
  const q = ev.q(b);
  const cutouts = shapesFor(ev, job);
  const comps = job.comps;
  const S = newSample();
  const start = buf.nv;
  const poly = POLYGONS[P.leafType] || POLYGONS.diamond;
  const col = [1, 1, 1]; const col2 = [1, 1, 1];
  const flip = P.flip ? -1 : 1;
  for (const line of lines) {
    const ct = ev.setCtx(line, 0);
    const uvt = uvTransform(P, q, ct);
    const s = (q.position(ct) / 100) * line.length;
    ct.t = tOf(line, s);
    const size = (P.useLength ? line.length : q.size(ct)) * (P.useLength ? 1 : line.sizeScale ?? 1);
    const width = size / Math.max(q.ratio(ct), 0.05);
    sampleLine(line, s, S);
    const cut = cutouts ? pickCutout(ev, job, cutouts, line) : null;
    col.fill(1); col2.fill(1);
    comps.color(line, ct.t, col, col2);
    const pts = cut ? cut.poly : poly;
    const count = pts.length;
    const nTris = cut ? cut.tris.length : (count - 2) * 3;
    const sides = P.twoSided ? 2 : 1;
    const base = buf.reserve(count * sides, nTris * sides);
    for (let side = 0; side < sides; side++) {
      const nsign = (side ? -1 : 1) * flip;
      for (let i = 0; i < count; i++) {
        const idx = base + side * count + i;
        const pt = pts[i];
        const x = cut ? pt.x * size : pt[0] * width * 0.5;
        const y = cut ? ((pt.y - cut.tmin) / (cut.tmax - cut.tmin || 1)) * size : pt[1] * size;
        buf.position[idx * 3] = S.px + S.ux * x + S.tx * y;
        buf.position[idx * 3 + 1] = S.py + S.uy * x + S.ty * y;
        buf.position[idx * 3 + 2] = S.pz + S.uz * x + S.tz * y;
        buf.normal[idx * 3] = S.vx * nsign; buf.normal[idx * 3 + 1] = S.vy * nsign; buf.normal[idx * 3 + 2] = S.vz * nsign;
        buf.uv[idx * 2] = cut ? pt.u : (pt[0] * 0.5 + 0.5) * uvt.su + uvt.ou;
        buf.uv[idx * 2 + 1] = cut ? pt.v : pt[1] * uvt.sv + uvt.ov;
        setCommon(buf, idx, col, col2, line, 1, Math.min(1, y / size));
      }
      const at = base + side * count;
      if (cut) {
        for (let k = 0; k < cut.tris.length; k += 3) {
          const [i0, i1, i2] = [cut.tris[k], cut.tris[k + 1], cut.tris[k + 2]];
          if (nsign > 0) buf.tri(at + i0, at + i2, at + i1); else buf.tri(at + i0, at + i1, at + i2);
        }
      } else {
        for (let k = 1; k + 1 < count; k++) {
          if (nsign > 0) buf.tri(at, at + k + 1, at + k); else buf.tri(at, at + k, at + k + 1);
        }
      }
    }
  }
  applySoft(ev, buf, start, buf.nv, +P.softNormals || 0);
}

function primitive(shape, obj) {
  if (shape === 'imported' && obj?.v?.length) {
    const scale = 0.01;
    return { v: obj.v.map((x) => x * scale), idx: obj.idx, n: obj.n, uv: obj.uv };
  }
  if (shape === 'box') {
    const v = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1].map((x) => x / 2);
    return { v, idx: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7] };
  }
  if (shape === 'cone') {
    const v = [0, 1, 0, 0, 0, 0];
    const idx = [];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      idx.push(0, 2 + ((i + 1) % n), 2 + i, 1, 2 + i, 2 + ((i + 1) % n));
    }
    return { v, idx };
  }
  // Low-poly sphere: fruit counts run to thousands, so it stays small.
  const v = []; const idx = [];
  const rings = 5; const seg = 8;
  for (let r = 0; r <= rings; r++) {
    const a = (r / rings) * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const b = (s / seg) * Math.PI * 2;
      v.push(Math.sin(a) * Math.cos(b) * 0.5, Math.cos(a) * 0.5, Math.sin(a) * Math.sin(b) * 0.5);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s; const d = a + seg + 1;
    idx.push(a, a + 1, d, a + 1, d + 1, d);
  }
  return { v, idx };
}

// A copy's own rotation and scale per axis, from its Placement transform (math.js shapeXf).
function lineTransform(xf) {
  if (!xf?.r) return null;
  const { r, k: [kx, ky, kz] } = xf;
  const turn = (x, y, z) => [r[0][0] * x + r[1][0] * y + r[2][0] * z, r[0][1] * x + r[1][1] * y + r[2][1] * z, r[0][2] * x + r[1][2] * y + r[2][2] * z];
  return {
    point: (x, y, z) => turn(x * kx, y * ky, z * kz),
    normal: (x, y, z) => { const q = turn(x / (kx || 1), y / (ky || 1), z / (kz || 1)); const m = Math.hypot(q[0], q[1], q[2]) || 1; return [q[0] / m, q[1] / m, q[2] / m]; },
  };
}

export function buildInstances(ev, buf, job, lines) {
  const b = job.node;
  const q = ev.q(b);
  const comps = job.comps;
  const custom = comps.uvwCustom?.params;
  const elements = ev.in(b.id, 'elements').map((l) => ev.nodes.get(l.from));
  if (!elements.length) { ev.warnings.add('Instanced geometry needs an Instanced element connected.'); return; }
  const shapes = elements.map((n) => ({
    n, mesh: primitive(n.params.shape, n.params.obj), rate: n.params.rate ?? 100, rgb: hexToRgb(n.params.color), q: ev.q(n),
  }));
  const total = shapes.reduce((s, e) => s + e.rate, 0) || 1;
  const S = newSample();
  const col = [1, 1, 1]; const col2 = [1, 1, 1];
  const seed = ev.h(b);
  for (const line of lines) {
    const ct = ev.setCtx(line, 0);
    const s = (q.position(ct) / 100) * line.length;
    ct.t = tOf(line, s);
    sampleLine(line, s, S);
    let pick = hash(seed, line.id, 1) * total;
    const el = shapes.find((e) => (pick -= e.rate) <= 0) || shapes[0];
    const scale = (q.scale(ct) / 100) * (1 - (q.randomScale(ct) / 100) * hash(seed, line.id, 2)) * el.q.size(ct) * (line.sizeScale ?? 1);
    const { v, idx, n: normals, uv: uvs } = el.mesh;
    const count = v.length / 3;
    col.fill(1); col2.fill(1);
    comps.color(line, ct.t, col, col2);
    const base = buf.reserve(count, idx.length);
    const center = [S.px, S.py, S.pz];
    const local = lineTransform(line.xf);
    for (let i = 0; i < count; i++) {
      let x = v[i * 3] * scale; let y = v[i * 3 + 1] * scale; let z = v[i * 3 + 2] * scale;
      if (local) [x, y, z] = local.point(x, y, z);
      const k = (base + i) * 3;
      // The line frame is left-handed as (U, T, V), so V is negated or every instance comes out inside-out.
      buf.position[k] = S.px + S.ux * x + S.tx * y - S.vx * z;
      buf.position[k + 1] = S.py + S.uy * x + S.ty * y - S.vy * z;
      buf.position[k + 2] = S.pz + S.uz * x + S.tz * y - S.vz * z;
      if (normals) {
        let nx = normals[i * 3]; let ny = normals[i * 3 + 1]; let nz = normals[i * 3 + 2];
        if (local) [nx, ny, nz] = local.normal(nx, ny, nz);
        buf.normal[k] = S.ux * nx + S.tx * ny - S.vx * nz;
        buf.normal[k + 1] = S.uy * nx + S.ty * ny - S.vy * nz;
        buf.normal[k + 2] = S.uz * nx + S.tz * ny - S.vz * nz;
      } else {
        const d = sub([buf.position[k], buf.position[k + 1], buf.position[k + 2]], center);
        const n = norm(d);
        buf.normal[k] = n[0]; buf.normal[k + 1] = n[1]; buf.normal[k + 2] = n[2];
      }
      if (uvs) { buf.uv[(base + i) * 2] = uvs[i * 2]; buf.uv[(base + i) * 2 + 1] = uvs[i * 2 + 1]; } else {
        const u = (i / count) * (custom ? +custom.su : 1) + (custom ? +custom.ou : 0);
        buf.uv[(base + i) * 2] = u;
        buf.uv[(base + i) * 2 + 1] = (y / Math.max(scale, 1e-3)) * (custom ? +custom.sv : 1) + (custom ? +custom.ov : 0);
      }
      buf.color[k] = el.rgb[0] * col[0]; buf.color[k + 1] = el.rgb[1] * col[1]; buf.color[k + 2] = el.rgb[2] * col[2];
      buf.color2[k] = col2[0]; buf.color2[k + 1] = col2[1]; buf.color2[k + 2] = col2[2];
      // Stiff: a copy swings whole around where it attaches.
      buf.wind[k] = line.windIndex; buf.wind[k + 1] = 1; buf.wind[k + 2] = 0;
    }
    for (let i = 0; i < idx.length; i += 3) buf.tri(base + idx[i], base + idx[i + 1], base + idx[i + 2]);
  }
}
