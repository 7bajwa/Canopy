// Cylinder meshes and the branch blend: how a branch grows out of its parent without a seam.
import { hash, hexToRgb, blendColor, bakeCurve, sampleCurve, clamp, smooth, norm, dot, cross, lerp } from './math.js';
import { sampleLine, newSample, tOf, ensureFrames, pointAt } from './line.js';
import { inlineColors, inlineBlend } from './builtins.js';
import { windWeight } from './wind.js';
import { seasonTint } from './life.js';

export class MeshBuf {
  constructor() {
    this.nv = 0; this.ni = 0;
    this.alloc(2048, 6144);
  }

  alloc(v, i) {
    const grow = (old, n) => { const a = new old.constructor(n); a.set(old.subarray(0, Math.min(old.length, n))); return a; };
    if (!this.position) {
      this.position = new Float32Array(v * 3); this.normal = new Float32Array(v * 3); this.uv = new Float32Array(v * 2);
      this.uv1 = new Float32Array(v * 2); this.color = new Float32Array(v * 3); this.blend = new Float32Array(v);
      this.wind = new Float32Array(v * 3); this.color2 = new Float32Array(v * 3); this.index = new Uint32Array(i);
    } else {
      for (const [k, n] of [['position', 3], ['normal', 3], ['uv', 2], ['uv1', 2], ['color', 3], ['blend', 1], ['wind', 3], ['color2', 3]]) {
        if (this[k].length < v * n) this[k] = grow(this[k], v * n);
      }
      if (this.index.length < i) this.index = grow(this.index, i);
    }
  }

  reserve(nv, ni) {
    const needV = this.nv + nv; const needI = this.ni + ni;
    if (needV * 3 > this.position.length || needI > this.index.length) this.alloc(Math.max(needV * 2, 2048), Math.max(needI * 2, 6144));
    const base = this.nv;
    this.nv = needV;
    return base;
  }

  tri(a, b, c) { const I = this.index; const k = this.ni; I[k] = a; I[k + 1] = b; I[k + 2] = c; this.ni = k + 3; }

  finish(builder, comps) {
    if (!this.ni) return null;
    const m = comps.material;
    const leaf = builder.type === 'LeavesMesh' || builder.type === 'StandardLeaves';
    const solid = builder.type === 'InstancedGeometry';
    const own = m === builder;
    const texture = leaf || solid ? comps.atlas || (own ? m.params.texture : null) || null : m ? m.params.texture : 'bark:brown';
    // A white leaf with nothing on it means "not set", not a request for paper-white foliage.
    const unset = leaf && !texture && (!m || (own && m.params.color === '#ffffff' && !builder.params.tintOn));
    const P = own ? m.params : {};
    const out = {
      nodeId: builder.id, kind: leaf ? 'leaf' : solid ? 'solid' : 'bark',
      position: this.position.slice(0, this.nv * 3), normal: this.normal.slice(0, this.nv * 3),
      uv: this.uv.slice(0, this.nv * 2), color: this.color.slice(0, this.nv * 3),
      index: this.index.slice(0, this.ni),
      material: {
        color: unset ? '#5c8f2f' : m?.params.color || '#ffffff', roughness: m?.params.roughness ?? (leaf ? 0.65 : 0.9), texture,
        normalColor: P.normalColor || null, normalMap: P.normalMap || null, normalScale: P.normalScale ?? 1,
        opacityColor: P.opacityColor || null, opacityMap: P.opacityMap || null, opacityCh: P.opacityCh || 'A',
        roughMap: P.roughMap || null, roughCh: P.roughCh || 'G',
        sssColor: P.sssColor || '#000000', sssMap: P.sssMap || null, sssCh: P.sssCh || 'R',
        aoColor: P.aoColor || null, aoMap: P.aoMap || null, aoCh: P.aoCh || 'R', aoAmount: P.aoAmount ?? 1,
      },
    };
    if (comps.blend) { out.uv1 = this.uv1.slice(0, this.nv * 2); out.blend = this.blend.slice(0, this.nv); }
    out.wind = this.wind.slice(0, this.nv * 3);
    // Tubes, leaves, cutouts (in quad mode) and mesh primitives are made of quads, two triangles each in a row;
    // export and the wireframe join them back up (facesOf checks each pair really forms a flat, convex quad).
    out.quads = builder.type !== 'MetaMesh';
    if (comps.hasChannel) out.color2 = this.color2.slice(0, this.nv * 3);
    return out;
  }
}

// Reads the component chain hanging off a builder into a plain config.
export function compsOf(ev, b) {
  const comps = { nodes: [], blend: null, material: null, uvw: null, uvwCustom: null, vc: [], atlas: null, hasChannel: false };
  const seen = new Set();
  const visit = (n) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    comps.nodes.push(n);
    if (n.type === 'BranchBlend') { if (n.params.enabled !== false && ev.blendOn) comps.blend = n; }
    else if (n.type === 'Material') comps.material = n;
    else if (n.type === 'UVWMapping') comps.uvw = n;
    else if (n.type === 'UVWCustom') comps.uvwCustom = n;
    else comps.vc.push(n);
    for (const l of ev.out(n.id, 'out')) visit(ev.nodes.get(l.to));
  };
  for (const l of ev.out(b.id, 'comp')) visit(ev.nodes.get(l.to));
  // The settings inside the mesh node apply unless a connected node overrides them.
  const P = b.params;
  if (P.color !== undefined) comps.material ||= b;
  if (P.uvOn) comps.uvw ||= b;
  comps.vc.unshift(...inlineColors(b));
  if (b.type === 'CylinderMesh' && P.blend && !comps.blend && ev.blendOn) comps.blend = inlineBlend(b);
  comps.color = colorFunction(ev, comps);
  if (ev.life) {
    // Season and Health tint leaves one by one; withered branches go gray and dark.
    const base = comps.color; const L = ev.life;
    comps.color = (line, t, out, out2) => {
      base(line, t, out, out2);
      if (line.node.params.leafy) { const k = seasonTint(L.season, line.season ?? 0.5, L.health); out[0] *= k[0]; out[1] *= k[1]; out[2] *= k[2]; }
      else if (line.withered) { const g = (out[0] + out[1] + out[2]) / 3; out[0] = (out[0] * 0.5 + g * 0.5) * 0.8; out[1] = (out[1] * 0.5 + g * 0.5) * 0.8; out[2] = (out[2] * 0.5 + g * 0.5) * 0.8; }
    };
  }
  comps.hasChannel = comps.vc.some((n) => n.type === 'VCMapChannel' && n.params.channel > 0);
  return comps;
}

function colorFunction(ev, comps) {
  const steps = comps.vc.map((n) => {
    const q = ev.q(n);
    const P = n.params;
    const seed = ev.h(n);
    const c = ev.ctx;
    const weight = (line, t) => { if (!q.weight) return 1; c.line = line; c.t = t; c.lineId = line.id; return q.weight(c) / 100; };
    const mode = P.blendMode || 'normal';
    switch (n.type) {
      case 'VCColorElements': {
        const main = hexToRgb(P.main); const tgt = hexToRgb(P.target);
        return (line, t, out) => {
          c.line = line; c.t = t; c.lineId = line.id;
          const pos = clamp((q.position(c) + (hash(seed, line.id) - 0.5) * q.posChaos(c)) / 100, 0, 1);
          blendColor(mode, out, [lerp(main[0], tgt[0], pos), lerp(main[1], tgt[1], pos), lerp(main[2], tgt[2], pos)], weight(line, t));
        };
      }
      case 'VCColorPaths': {
        const stops = (P.gradient || []).map(([x, col]) => [x, hexToRgb(col)]).sort((a, b) => a[0] - b[0]);
        const [lo, hi] = ev.plantY || [0, 1];
        return (line, tIn, out) => {
          if (!stops.length) return;
          // By height, the place along the gradient is how high up the plant this point is.
          const t = P.byHeight ? clamp((pointAt(line, tIn * line.length)[1] - lo) / (hi - lo || 1), 0, 1) : tIn;
          let i = 0;
          while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
          const a = stops[i]; const b = stops[Math.min(i + 1, stops.length - 1)];
          const f = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
          blendColor(mode, out, [lerp(a[1][0], b[1][0], f), lerp(a[1][1], b[1][1], f), lerp(a[1][2], b[1][2], f)], weight(line, t));
        };
      }
      case 'VCInherit':
        return (line, t, out) => {
          const parent = line.parent;
          if (!parent?.colorFn) return;
          const pc = [1, 1, 1];
          parent.colorFn(parent, tOf(parent, line.parentS), pc);
          blendColor(mode, out, pc, weight(line, t));
        };
      case 'ChaosMatID': {
        const opts = [1, 2, 3, 4].map((i) => [+P[`r${i}`] || 0, hexToRgb(P[`c${i}`])]);
        const total = opts.reduce((s, o) => s + o[0], 0) || 1;
        return (line, t, out) => {
          let r = hash(seed, line.id) * total;
          for (const [rate, tint] of opts) {
            r -= rate;
            if (r <= 0) { out[0] *= tint[0]; out[1] *= tint[1]; out[2] *= tint[2]; return; }
          }
        };
      }
      case 'VCMapChannel': return { channel: +P.channel || 0 };
      default: return null;
    }
  }).filter(Boolean);
  return (line, t, out, out2) => {
    let target = out;
    for (const s of steps) {
      if (typeof s === 'function') s(line, t, target);
      else if (s.channel > 0 && out2) target = out2;
      else target = out;
    }
  };
}

export function computeRadii(ev, job, lines) {
  const b = job.node;
  const q = ev.q(b);
  const P = b.params;
  const taper = bakeCurve(P.taper);
  const curved = q.radius.linked;
  const minR = +P.minRadius || 0;
  const S = newSample();
  for (const line of lines) {
    line.colorFn ||= job.comps.color;
    if (line.pointR) { line.radii = line.pointR; line.r0 = line.radii[0]; continue; }
    const c = ev.setCtx(line, tOf(line, 0));
    const base = Math.max(1e-4, q.radius(c) * (line.sizeScale ?? 1));
    let k = line.sizeScale ?? 1;
    if (line.parent?.radii) {
      const R = sampleLine(line.parent, line.parentS, S).r;
      if (P.autoRadius) k = Math.min(k, (R * (+P.autoFactor || 0.65)) / (base / k));
      if (P.underParent) k = Math.min(k, (R * 0.95) / (base / k));
    }
    const r = new Float32Array(line.n);
    for (let i = 0; i < line.n; i++) {
      const t = tOf(line, line.len[i]);
      c.t = t;
      r[i] = Math.max(minR, (curved ? q.radius(c) : base * sampleCurve(taper, t)) * k);
    }
    line.radii = r;
    line.r0 = r[0];
  }
}

const TWO_PI = Math.PI * 2;

// How much of the flare reaches out at angle phi around a line: roots ridge it (depth 1 leaves nothing between
// them), and offset leans it toward phiOff (1 puts it all on that side, leaving the other almost flat).
// A cap's rings as [radius share, height, distance along the cap, part of the border], from the rim inward.
function capProfile(P, key, draft) {
  const n = draft ? 2 : Math.max(1, Math.round(+P[key + 'Segs'] || 3));
  const h = Math.max(0, +(P[key + 'Height'] ?? 1));
  const out = []; let path = 0; let last = [1, 0];
  const push = (f, up, rim = false) => { path += Math.hypot(f - last[0], up - last[1]); last = [f, up]; out.push([f, up, path, rim]); };
  const profile = P[key + 'Profile'];
  if (!profile) {
    const shape = Math.max(0.1, +(P[key + 'Shape'] ?? 1));
    for (let k = 1; k <= n; k++) { const a = (k / n) * Math.PI * 0.5; push(Math.cos(a) ** shape, Math.sin(a) * h); }
    return out;
  }
  const table = bakeCurve(profile);
  const inner = 1 - clamp(+P[key + 'Border'] || 0, 0, 0.95);
  if (inner < 1) push(inner, 0, true);
  const y0 = sampleCurve(table, 0) * h;
  if (Math.abs(y0) > 1e-3) push(inner, y0, true);
  for (let k = 1; k <= n; k++) { const x = k / n; push(inner * (1 - x), sampleCurve(table, x) * h); }
  return out;
}

function flareShape(phi, roots, depth, turn, offset, phiOff) {
  const lobe = roots ? 1 - depth + depth * (0.5 + 0.5 * Math.cos(roots * (phi - turn))) ** 1.5 : 1;
  return lobe * (1 + offset * Math.cos(phi - phiOff));
}
const wrapAngle = (a) => { a %= TWO_PI; if (a > Math.PI) a -= TWO_PI; if (a < -Math.PI) a += TWO_PI; return a; };

// How much the collars of attached branches swell a line's surface at (s, phi).
function bulgeAt(line, s, phi, R) {
  const att = line.attach;
  if (!att) return 0;
  let sum = 0;
  for (let i = 0; i < att.length; i++) {
    const a = att[i];
    const ds = (s - a.s) / a.La;
    if (ds > 2.5 || ds < -2.5) continue;
    const dp = (wrapAngle(phi - a.phi) * Math.max(R, 1e-3)) / a.Lp;
    if (dp > 2.5 || dp < -2.5) continue;
    sum += a.h * Math.exp(-(ds * ds + dp * dp));
  }
  return sum;
}

function sidesOf(ev, job, line) {
  const P = job.node.params;
  const ct = ev.setCtx(line, 0);
  let sides = Math.round(ev.q(job.node).sides(ct));
  if (P.optimize) sides = Math.round((TWO_PI * line.radii[0]) / (+P.faceSize || 8));
  if (ev.draft) sides = Math.round(sides * 0.6);
  return clamp(sides, Math.max(3, Math.round(+P.minSides || 3)), 64);
}

// How far in from the true circle the parent's flat facet lies at this angle.
function facetScale(line, angle) {
  const n = line.meshSides;
  if (!n) return 1;
  const step = TWO_PI / n;
  const a = ((angle % step) + step) % step;
  return Math.cos(step / 2) / Math.cos(a - step / 2);
}

const nS = newSample();
function surfacePoint(line, s, phi, out3) {
  sampleLine(line, clamp(s, 0, line.length), nS);
  const c = Math.cos(phi); const n = Math.sin(phi);
  const r = nS.r + bulgeAt(line, s, phi, nS.r);
  out3[0] = nS.px + (nS.ux * c + nS.vx * n) * r;
  out3[1] = nS.py + (nS.uy * c + nS.vy * n) * r;
  out3[2] = nS.pz + (nS.uz * c + nS.vz * n) * r;
}

// The parent's shaded normal, collar swelling included; a plain radial one leaves a visible rim.
const sa = [0, 0, 0]; const sb = [0, 0, 0]; const sc = [0, 0, 0]; const sd = [0, 0, 0];
function surfaceNormal(line, s, phi, R, radial) {
  const e = Math.max(R * 0.08, 0.02);
  surfacePoint(line, s - e, phi, sa); surfacePoint(line, s + e, phi, sb);
  surfacePoint(line, s, phi - 0.06, sc); surfacePoint(line, s, phi + 0.06, sd);
  const n = norm(cross([sb[0] - sa[0], sb[1] - sa[1], sb[2] - sa[2]], [sd[0] - sc[0], sd[1] - sc[1], sd[2] - sc[2]]));
  return dot(n, radial) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

// Works out every branch's joint before any mesh is built, so parents know their collars.
export function prepareJunctions(ev) {
  const P0 = newSample();
  // Child rims follow the parent's real facets, so every parent's side count must be known first.
  for (const job of ev.jobs.values()) {
    if (job.node.type !== 'CylinderMesh') continue;
    for (const line of job.lines) if (line.radii) line.meshSides = sidesOf(ev, job, line);
  }
  for (const job of ev.jobs.values()) {
    if (job.node.type !== 'CylinderMesh' || !job.comps.blend) continue;
    const q = ev.q(job.comps.blend);
    const c = ev.ctx;
    for (const line of job.lines) {
      const parent = line.parent;
      if (!parent?.radii || line.n < 2) continue;
      c.line = line; c.t = 0; c.lineId = line.id;
      sampleLine(parent, line.parentS, P0);
      const R = P0.r;
      const rb = line.radii[0];
      if (R <= 1e-4 || rb / R < q.minRatio(c)) continue;
      const a = sampleLine(line, 0, newSample());
      const d = [a.tx, a.ty, a.tz];
      const T = [P0.tx, P0.ty, P0.tz];
      const cosA = clamp(dot(d, T), -1, 1);
      const sinRaw = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const sinA = Math.max(sinRaw, 0.25);
      const n0 = sinRaw > 0.02 ? norm([d[0] - T[0] * cosA, d[1] - T[1] * cosA, d[2] - T[2] * cosA]) : [P0.ux, P0.uy, P0.uz];
      const b0 = cross(T, n0);
      const phi0 = Math.atan2(n0[0] * P0.vx + n0[1] * P0.vy + n0[2] * P0.vz, n0[0] * P0.ux + n0[1] * P0.uy + n0[2] * P0.uz);
      const hc = R / sinA;
      const L = q.length(c) * rb;
      const sEnd = Math.min(hc + L, line.length * 0.6);
      if (sEnd < hc * 0.85) continue;
      const flare = q.flare(c);
      const collar = ev.draft ? 0 : q.collar(c) * rb;
      const s0 = clamp(line.parentS + hc * cosA, 0, parent.length);
      const reach = rb * (1.2 + flare) + L * 0.5;
      line.junction = {
        parent, R, rb, T, n0, b0, phi0, cosA, sinA, hc, sEnd, flare, s0: line.parentS,
        origin: [P0.px, P0.py, P0.pz],
        rings: ev.draft ? 2 : Math.round(q.rings(c)),
        tension: q.tension(c), sink: q.sink(c) / 100, shade: q.shade(c),
        texture: job.comps.blend.params.textureBlend !== false,
        roots: Math.max(0, Math.round(+job.comps.blend.params.roots || 0)), rootDepth: clamp(+(job.comps.blend.params.rootDepth ?? 0.45), 0, 1),
        rootTurn: (+job.comps.blend.params.rootTurn || 0) * (Math.PI / 180), offset: clamp(+job.comps.blend.params.offset || 0, 0, 1),
      };
      if (collar > 0) {
        (parent.attach ||= []).push({ s: s0, phi: phi0, h: collar, La: reach, Lp: reach });
      }
    }
  }
}

const trigCache = new Map();
function trig(sides) {
  let t = trigCache.get(sides);
  if (!t) {
    t = new Float32Array((sides + 1) * 2);
    for (let j = 0; j <= sides; j++) { const a = (j / sides) * TWO_PI; t[j * 2] = Math.cos(a); t[j * 2 + 1] = Math.sin(a); }
    trigCache.set(sides, t);
  }
  return t;
}

function uvConfig(comps) {
  const P = comps.uvw?.params;
  return {
    tileU: P ? +P.tileU || 1 : 2, absWidth: !!P?.absWidth, width: +P?.width || 40, flipU: !!P?.flipU, offU: +P?.offsetU || 0,
    absLength: P ? !!P.absLength : true, lengthV: +P?.lengthV || 60, tileV: P ? +P.tileV || 1 : 1, flipV: !!P?.flipV, offV: +P?.offsetV || 0,
    byRadius: !!P?.scaleByRadius,
  };
}

// Tiling and offsets can vary per line when the mesh node sets them, so each line reads its own.
function lineUv(base, q, c, P) {
  if (!P.owned) return base;
  return { ...base, tileU: q.tileU(c), tileV: q.tileV(c), offU: q.offsetU(c), offV: q.offsetV(c) };
}

// On Spline nodes, one tile of bark wraps half way round, which suits the built-in textures.
const tileOf = (uv, r0, P) => (uv.absWidth ? Math.max(1, Math.round((TWO_PI * r0) / uv.width)) : uv.tileU) * (P.owned ? 2 : 1);
const vOf = (uv, line, s) => {
  const raw = uv.absLength ? (s / uv.lengthV) * uv.tileV : (s / Math.max(line.length, 1e-3)) * uv.tileV;
  return (uv.flipV ? -raw : raw) + uv.offV;
};

export function buildCylinders(ev, buf, job, lines) {
  const comps = job.comps;
  const q = ev.q(job.node);
  const P = job.node.params;
  const base0 = uvConfig(comps);
  const tubeRot = ev.param(job.node, { k: 'tubeRot', d: 0, abs: true, along: 'pos' });
  const tubeStart = ev.param(job.node, { k: 'tubeStart', d: 0, along: 'pos' });
  const tubeEnd = ev.param(job.node, { k: 'tubeEnd', d: 100, along: 'pos' });
  const uvTwist = ev.param(job.node, { k: 'uvTwist', d: 0, abs: true, along: 'pos' });
  const c = ev.ctx;
  const out = newSample();
  const parentS = newSample();

  for (const line of lines) {
    if (line.n < 2 || line.length < 1e-3 || !line.radii) continue;
    ensureFrames(line);
    const ct = ev.setCtx(line, 0);
    const R0 = line.radii[0];
    const sides = line.meshSides || sidesOf(ev, job, line);
    let cosSin = trig(sides);
    const rotDeg = tubeRot(ct);
    if (rotDeg) {
      const a = rotDeg * (Math.PI / 180);
      cosSin = cosSin.map((_, k) => (k % 2 ? cosSin[k - 1] * Math.sin(a) + cosSin[k] * Math.cos(a) : cosSin[k] * Math.cos(a) - cosSin[k + 1] * Math.sin(a)));
    }
    const uv = lineUv(base0, q, ct, P);

    // Stations are the ring positions along the line; collars add a few so the swelling has geometry.
    let stations = [];
    if (P.overrideSteps) {
      const st = Math.max(+P.stepSize || 20, line.length / 512);
      for (let s = 0; s < line.length - st * 0.5; s += st) stations.push(s);
      stations.push(line.length);
    } else stations = Array.from(line.len);
    // Spline nodes keep their own segments: the collar swells the rings that are there instead of adding loops.
    if (line.attach && !P.owned) {
      line.attach.sort((a, b) => b.h - a.h);
      for (const a of line.attach.slice(0, 24)) {
        if (a.h < R0 * 0.04) continue;
        // Enough rings to carry the swelling smoothly: a child's rim follows it exactly.
        for (const k of [-1.9, -1.4, -1, -0.7, -0.4, -0.15, 0, 0.15, 0.4, 0.7, 1, 1.4, 1.9]) stations.push(a.s + k * a.La);
      }
      stations = stations.filter((s) => s >= 0 && s <= line.length).sort((a, b) => a - b);
      const gap = line.length / 800;
      stations = stations.filter((s, i) => i === 0 || i === stations.length - 1 || s - stations[i - 1] > gap);
    }

    // Start and Finish cut the tube short. A tube that starts late can't blend into its parent.
    const cutStart = tubeStart(ct) / 100 * line.length;
    const cutEnd = tubeEnd(ct) / 100 * line.length;
    if (cutStart > 0 || cutEnd < line.length) stations = stations.filter((s) => s >= cutStart - 1e-3 && s <= cutEnd + 1e-3);
    const j = cutStart > 0 ? null : line.junction;
    const K = j ? Math.max(2, j.rings) : 0;
    const startS = j ? j.sEnd : 0;
    if (j) stations = stations.filter((s) => s > startS + 1e-3);

    // A line standing on the floor flares into it: more rings low down carry the spread and the roots.
    // Blend treats the floor as the parent of a line that has none: the same height, spread, roots and offset.
    const fb = P.owned && P.blend && !line.parent && !j && cutStart <= 0 ? comps.blend?.params : null;
    const flare = fb && +fb.flare > 0 ? {
      H: Math.min(Math.max(0.1, +fb.length || 1.6) * R0, line.length * 0.9), spread: Math.max(0, +fb.flare) * R0,
      pow: 1 + 3 * clamp(+(fb.tension ?? 0.85), 0, 1), roots: Math.max(0, Math.round(+fb.roots || 0)), depth: clamp(+(fb.rootDepth ?? 0.45), 0, 1),
      twist: (+fb.rootTurn || 0) * (Math.PI / 180), offset: clamp(+fb.offset || 0, 0, 1), sink: Math.max(0, (+fb.sink || 0) / 100) * R0 * 2,
    } : null;
    if (flare) {
      const F = ev.draft ? 3 : Math.max(2, Math.round(+fb.rings || 4) * 2);
      for (let k = 1; k < F; k++) stations.push(flare.H * (k / F) ** 1.6);
      stations.push(flare.H);
      stations = [...new Set(stations)].filter((s) => s >= 0 && s <= line.length).sort((a, b) => a - b);
    }

    // Round caps, as rings from the rim in to the middle. With a profile (Spline nodes) its curve gives the height
    // of each ring from the outside (left) to the middle (right), so a flat curve makes a flat cap; a border first
    // steps in by a share of the radius, like bark around the cut wood. Without one it is a plain dome.
    const endCap = line.capEnd || P.capEnd;
    const startCap = line.capStart || P.capStart;
    const capEndList = endCap === 'spherical' && line.radii[line.n - 1] > 0.02 ? capProfile(P, 'capEnd', ev.draft) : [];
    const capStartList = !j && startCap === 'spherical' && line.radii[0] > 0.02 ? capProfile(P, 'capStart', ev.draft) : [];
    const capRings = capEndList.length; const startRings = capStartList.length;
    const discUv = P.capUv === 'disc';
    const rings = (j ? K + 1 : 0) + startRings + stations.length + capRings;
    if (rings < 2) continue;
    const verts = sides + 1;
    const rp = new Float32Array(rings * verts * 3);
    const rn = new Float32Array(rings * verts * 3);
    const ringV = new Float32Array(rings);
    const ringT = new Float32Array(rings);
    const blendM = j ? new Float32Array(rings) : null;
    const uvP = j ? new Float32Array(rings * verts * 2) : null;
    const forced = j ? new Float32Array((K + 1) * verts * 3) : null;
    // On cap rings, how far out from the cap's middle the ring sits (0..1), for disc UVs; -1 elsewhere.
    const ringCap = new Float32Array(rings).fill(-1);
    let r = 0;

    if (j) {
      // A point on the parent's surface at (s', phi), wrapping round it rather than falling off.
      const parent = j.parent;
      const foot = (ex, ey, ez, rho, out3) => {
        const ox = line.pts[0] - j.origin[0]; const oy = line.pts[1] - j.origin[1]; const oz = line.pts[2] - j.origin[2];
        const x = rho * (ex * j.b0[0] + ey * j.b0[1] + ez * j.b0[2]) + ox * j.b0[0] + oy * j.b0[1] + oz * j.b0[2];
        const y = rho * (ex * j.n0[0] + ey * j.n0[1] + ez * j.n0[2]) + ox * j.n0[0] + oy * j.n0[1] + oz * j.n0[2];
        const a = rho * (ex * j.T[0] + ey * j.T[1] + ez * j.T[2]) + ox * j.T[0] + oy * j.T[1] + oz * j.T[2];
        const xn = x / j.R;
        const edge = 0.85;
        const phi = Math.abs(xn) <= edge
          ? Math.asin(xn)
          : Math.sign(xn) * Math.min(2.6, Math.asin(edge) + (Math.abs(xn) - edge) / Math.sqrt(1 - edge * edge));
        const h = (j.R * Math.cos(phi) - y) / j.sinA;
        const limit = j.R * 3 + j.rb * 4;
        const axial = a + clamp(h * j.cosA, -limit, limit);
        const sp = clamp(j.s0 + axial, 0, parent.length);
        sampleLine(parent, sp, parentS);
        const world = j.phi0 + phi;
        const cp = Math.cos(world); const sn = Math.sin(world);
        const nx = parentS.ux * cp + parentS.vx * sn; const ny = parentS.uy * cp + parentS.vy * sn; const nz = parentS.uz * cp + parentS.vz * sn;
        const Rb = (parentS.r + bulgeAt(parent, sp, world, parentS.r)) * facetScale(parent, world) * (1 - j.sink);
        out3[0] = parentS.px + nx * Rb; out3[1] = parentS.py + ny * Rb; out3[2] = parentS.pz + nz * Rb;
        const sn2 = surfaceNormal(parent, sp, world, j.R, [nx, ny, nz]);
        out3[3] = sn2[0]; out3[4] = sn2[1]; out3[5] = sn2[2]; out3[6] = sp; out3[7] = world;
      };
      // Where a fillet vertex falls in the parent's bark, so the bark runs on over the joint unbroken.
      const parentUV = (x, y, z, near, out2) => {
        let sp = j.s0 + (x - j.origin[0]) * j.T[0] + (y - j.origin[1]) * j.T[1] + (z - j.origin[2]) * j.T[2];
        sp = clamp(sp, 0, parent.length);
        sampleLine(parent, sp, parentS);
        sp = clamp(sp + (x - parentS.px) * parentS.tx + (y - parentS.py) * parentS.ty + (z - parentS.pz) * parentS.tz, 0, parent.length);
        sampleLine(parent, sp, parentS);
        const dx = x - parentS.px; const dy = y - parentS.py; const dz = z - parentS.pz;
        let phi = Math.atan2(dx * parentS.vx + dy * parentS.vy + dz * parentS.vz, dx * parentS.ux + dy * parentS.uy + dz * parentS.uz);
        phi += Math.round((near - phi) / TWO_PI) * TWO_PI;
        out2[0] = phi; out2[1] = sp;
      };
      const pp = [0, 0];
      sampleLine(line, 0, out);
      const ux = out.ux; const uy = out.uy; const uz = out.uz;
      const vx = out.vx; const vy = out.vy; const vz = out.vz;
      const endS = sampleLine(line, j.sEnd, newSample());
      const a0 = new Float64Array(8); const a1 = new Float64Array(8);
      const puvTile = tileOf(uv, parent.r0 || j.R, P);
      // Offset leans the flare toward the branch's underside, where real branches carry more wood.
      const downU = -uy; const downV = -vy;
      const offset = Math.hypot(downU, downV) > 0.05 ? j.offset : 0;
      const phiDown = Math.atan2(downV, downU);
      for (let v = 0; v < verts; v++) {
        const cs = cosSin[v * 2]; const sn = cosSin[v * 2 + 1];
        const ex = ux * cs + vx * sn; const ey = uy * cs + vy * sn; const ez = uz * cs + vz * sn;
        const rimR = j.rb * (1 + j.flare * flareShape(Math.atan2(sn, cs), j.roots, j.rootDepth, j.rootTurn, offset, phiDown));
        foot(ex, ey, ez, rimR, a0);
        foot(ex, ey, ez, j.rb, a1);
        const px = endS.px + (endS.ux * cs + endS.vx * sn) * endS.r;
        const py = endS.py + (endS.uy * cs + endS.vy * sn) * endS.r;
        const pz = endS.pz + (endS.uz * cs + endS.vz * sn) * endS.r;
        // Quadratic fillet: leaves the parent along its surface, arrives along the branch's side.
        const mx = (a0[0] + px) / 2; const my = (a0[1] + py) / 2; const mz = (a0[2] + pz) / 2;
        const cx = mx + (a1[0] - mx) * j.tension; const cy = my + (a1[1] - my) * j.tension; const cz = mz + (a1[2] - mz) * j.tension;
        let near = a0[7];
        for (let k = 0; k <= K; k++) {
          const w = k / K;
          const i0 = (1 - w) * (1 - w); const i1 = 2 * w * (1 - w); const i2 = w * w;
          const x = a0[0] * i0 + cx * i1 + px * i2; const y = a0[1] * i0 + cy * i1 + py * i2; const z = a0[2] * i0 + cz * i1 + pz * i2;
          const o = (k * verts + v) * 3;
          rp[o] = x; rp[o + 1] = y; rp[o + 2] = z;
          if (k) parentUV(x, y, z, near, pp);
          else { pp[0] = a0[7]; pp[1] = a0[6]; }
          near = pp[0];
          const pu = (pp[0] / TWO_PI) * puvTile;
          uvP[(k * verts + v) * 2] = (uv.flipU ? -pu : pu) + uv.offU;
          uvP[(k * verts + v) * 2 + 1] = vOf(uv, parent, pp[1]);
          forced[o] = a0[3]; forced[o + 1] = a0[4]; forced[o + 2] = a0[5];
        }
      }
      for (let k = 0; k <= K; k++) {
        const w = k / K;
        const s = w * j.sEnd;
        ringV[k] = vOf(uv, line, s);
        ringT[k] = tOf(line, s);
        blendM[k] = j.texture ? 1 - smooth(w) : 0;
      }
      r = K + 1;
    }

    if (startRings) {
      // The bottom dome, from its tip up to the tube's first ring.
      sampleLine(line, 0, out);
      for (let k = startRings - 1; k >= 0; k--) {
        const [f, up, path, rim] = capStartList[k];
        const rr = out.r * f; const lift = -out.r * up;
        for (let v = 0; v < verts; v++) {
          const cs = cosSin[v * 2]; const sn = cosSin[v * 2 + 1];
          const o = (r * verts + v) * 3;
          rp[o] = out.px + out.tx * lift + (out.ux * cs + out.vx * sn) * rr;
          rp[o + 1] = out.py + out.ty * lift + (out.uy * cs + out.vy * sn) * rr;
          rp[o + 2] = out.pz + out.tz * lift + (out.uz * cs + out.vz * sn) * rr;
        }
        ringV[r] = vOf(uv, line, -out.r * path);
        ringT[r] = 0;
        ringCap[r] = rim ? -1 : f;
        r++;
      }
    }

    const rof = q.radialOffset; const sof = q.scaleOffset;
    const offsets = rof.linked || sof.linked || +P.radialOffset || (+P.scaleOffset !== 1 && P.scaleOffset !== undefined);
    for (const s of stations) {
      sampleLine(line, s, out);
      let rad = out.r;
      if (offsets) { c.t = tOf(line, s); rad = rad * sof(c) + rof(c); }
      // Flare: (1 - x)^pow spreads the base like a fillet onto the floor; roots ridge it around.
      const fall = flare && s < flare.H ? (1 - s / flare.H) ** flare.pow : 0;
      const drop = fall ? flare.sink * fall ** 3 : 0;
      for (let v = 0; v < verts; v++) {
        const cs = cosSin[v * 2]; const sn = cosSin[v * 2 + 1];
        const bulge = line.attach ? bulgeAt(line, s, Math.atan2(sn, cs), rad) : 0;
        let rr = rad + bulge;
        if (fall) {
          rr += flare.spread * fall * flareShape(Math.atan2(sn, cs), flare.roots, flare.depth, flare.twist, flare.offset, flare.twist);
        }
        const o = (r * verts + v) * 3;
        rp[o] = out.px + (out.ux * cs + out.vx * sn) * rr - out.tx * drop;
        rp[o + 1] = out.py + (out.uy * cs + out.vy * sn) * rr - out.ty * drop;
        rp[o + 2] = out.pz + (out.uz * cs + out.vz * sn) * rr - out.tz * drop;
      }
      ringV[r] = vOf(uv, line, s);
      ringT[r] = tOf(line, s);
      r++;
    }

    if (capRings) {
      sampleLine(line, line.length, out);
      for (const [f, up, path, rim] of capEndList) {
        const rr = out.r * f;
        const lift = out.r * up;
        ringCap[r] = rim ? -1 : f;
        for (let v = 0; v < verts; v++) {
          const cs = cosSin[v * 2]; const sn = cosSin[v * 2 + 1];
          const o = (r * verts + v) * 3;
          rp[o] = out.px + out.tx * lift + (out.ux * cs + out.vx * sn) * rr;
          rp[o + 1] = out.py + out.ty * lift + (out.uy * cs + out.vy * sn) * rr;
          rp[o + 2] = out.pz + out.tz * lift + (out.uz * cs + out.vz * sn) * rr;
        }
        ringV[r] = vOf(uv, line, line.length + out.r * path);
        ringT[r] = 1;
        r++;
      }
    }

    // Smooth normals across the ring grid; the seam column wraps so it stays invisible.
    for (let i = 0; i < rings; i++) {
      const a = Math.max(i - 1, 0); const b = Math.min(i + 1, rings - 1);
      for (let v = 0; v < sides; v++) {
        const o = (i * verts + v) * 3;
        const ol = (i * verts + (v + sides - 1) % sides) * 3;
        const or = (i * verts + (v + 1) % sides) * 3;
        const oa = (a * verts + v) * 3; const ob = (b * verts + v) * 3;
        const dx = rp[or] - rp[ol]; const dy = rp[or + 1] - rp[ol + 1]; const dz = rp[or + 2] - rp[ol + 2];
        const ex = rp[ob] - rp[oa]; const ey = rp[ob + 1] - rp[oa + 1]; const ez = rp[ob + 2] - rp[oa + 2];
        let nx = dy * ez - dz * ey; let ny = dz * ex - dx * ez; let nz = dx * ey - dy * ex;
        const m = Math.hypot(nx, ny, nz);
        if (m > 1e-12) { nx /= m; ny /= m; nz /= m; }
        else if (i > 0) {
          const pv = ((i - 1) * verts + v) * 3;
          nx = rn[pv]; ny = rn[pv + 1]; nz = rn[pv + 2];
        } else if (startRings) { sampleLine(line, 0, out); nx = -out.tx; ny = -out.ty; nz = -out.tz; } else { nx = 0; ny = 1; nz = 0; }
        if (j && i <= K) {
          // The joint starts with the parent's normal so shading has no visible edge.
          const w = (1 - smooth(i / K)) * j.shade;
          const fo = (i * verts + v) * 3;
          nx += (forced[fo] - nx) * w; ny += (forced[fo + 1] - ny) * w; nz += (forced[fo + 2] - nz) * w;
          const mm = Math.hypot(nx, ny, nz) || 1;
          nx /= mm; ny /= mm; nz /= mm;
        }
        rn[o] = nx; rn[o + 1] = ny; rn[o + 2] = nz;
      }
      const f = i * verts * 3; const l = (i * verts + sides) * 3;
      rn[l] = rn[f]; rn[l + 1] = rn[f + 1]; rn[l + 2] = rn[f + 2];
    }

    const startPlanar = startCap === 'planar';
    const endPlanar = endCap === 'planar';
    const extra = (startPlanar && !j ? verts + 1 : 0) + (endPlanar ? verts + 1 : 0);
    const base = buf.reserve(rings * verts + extra, (rings - 1) * sides * 6 + (startPlanar && !j ? sides * 3 : 0) + (endPlanar ? sides * 3 : 0));
    const tile = tileOf(uv, R0, P);
    const twistU = (uvTwist(ct) / 360) * tile;
    const col = [1, 1, 1]; const col2 = [1, 1, 1];
    const parentCol = [1, 1, 1];
    if (j && j.parent.colorFn) j.parent.colorFn(j.parent, tOf(j.parent, line.parentS), parentCol);
    for (let i = 0; i < rings; i++) {
      col[0] = col[1] = col[2] = 1; col2[0] = col2[1] = col2[2] = 1;
      comps.color(line, ringT[i], col, col2);
      if (j && i <= K) {
        // Colors cross-fade with the bark so a tinted branch never starts with a hard line.
        const w = 1 - smooth(i / K);
        col[0] += (parentCol[0] - col[0]) * w; col[1] += (parentCol[1] - col[1]) * w; col[2] += (parentCol[2] - col[2]) * w;
      }
      const wv = windWeight(line, ringT[i]);
      for (let v = 0; v < verts; v++) {
        const idx = base + i * verts + v;
        const o = (i * verts + v) * 3;
        buf.position[idx * 3] = rp[o]; buf.position[idx * 3 + 1] = rp[o + 1]; buf.position[idx * 3 + 2] = rp[o + 2];
        buf.normal[idx * 3] = rn[o]; buf.normal[idx * 3 + 1] = rn[o + 1]; buf.normal[idx * 3 + 2] = rn[o + 2];
        const u = (v / sides) * tile + ringT[i] * twistU;
        if (discUv && ringCap[i] >= 0) {
          // A round patch of the texture on the cap, centered on the cap's tip.
          const k = ringCap[i] * 0.5 * (+P.capUvScale || 1);
          buf.uv[idx * 2] = +(P.capUvU ?? 0.5) + cosSin[v * 2] * k; buf.uv[idx * 2 + 1] = +(P.capUvV ?? 0.5) + cosSin[v * 2 + 1] * k;
        } else { buf.uv[idx * 2] = (uv.flipU ? -u : u) + uv.offU; buf.uv[idx * 2 + 1] = ringV[i]; }
        buf.color[idx * 3] = col[0]; buf.color[idx * 3 + 1] = col[1]; buf.color[idx * 3 + 2] = col[2];
        buf.color2[idx * 3] = col2[0]; buf.color2[idx * 3 + 1] = col2[1]; buf.color2[idx * 3 + 2] = col2[2];
        if (j && i <= K) {
          buf.uv1[idx * 2] = uvP[(i * verts + v) * 2]; buf.uv1[idx * 2 + 1] = uvP[(i * verts + v) * 2 + 1];
          buf.blend[idx] = blendM[i];
        } else { buf.uv1[idx * 2] = buf.uv[idx * 2]; buf.uv1[idx * 2 + 1] = buf.uv[idx * 2 + 1]; buf.blend[idx] = 0; }
        buf.wind[idx * 3] = line.windIndex; buf.wind[idx * 3 + 1] = wv; buf.wind[idx * 3 + 2] = 0;
      }
    }
    for (let i = 0; i + 1 < rings; i++) {
      for (let v = 0; v < sides; v++) {
        const a = base + i * verts + v; const b = a + verts; const cc = a + 1; const dd = b + 1;
        buf.tri(a, cc, b); buf.tri(cc, dd, b);
      }
    }
    let next = base + rings * verts;
    const fan = (ring, flip) => {
      const center = next + verts;
      const nd = flip ? -1 : 1;
      sampleLine(line, flip ? 0 : line.length, out);
      let cx = 0; let cy = 0; let cz = 0;
      for (let v = 0; v < sides; v++) { const o = (ring * verts + v) * 3; cx += rp[o]; cy += rp[o + 1]; cz += rp[o + 2]; }
      for (let v = 0; v <= verts; v++) {
        const idx = next + v;
        const o = v < verts ? (ring * verts + v) * 3 : -1;
        buf.position[idx * 3] = o >= 0 ? rp[o] : cx / sides;
        buf.position[idx * 3 + 1] = o >= 0 ? rp[o + 1] : cy / sides;
        buf.position[idx * 3 + 2] = o >= 0 ? rp[o + 2] : cz / sides;
        buf.normal[idx * 3] = out.tx * nd; buf.normal[idx * 3 + 1] = out.ty * nd; buf.normal[idx * 3 + 2] = out.tz * nd;
        buf.color[idx * 3] = col[0]; buf.color[idx * 3 + 1] = col[1]; buf.color[idx * 3 + 2] = col[2];
        buf.color2[idx * 3] = col2[0]; buf.color2[idx * 3 + 1] = col2[1]; buf.color2[idx * 3 + 2] = col2[2];
        buf.uv[idx * 2] = o >= 0 ? cosSin[v * 2] * 0.5 + 0.5 : 0.5; buf.uv[idx * 2 + 1] = o >= 0 ? cosSin[v * 2 + 1] * 0.5 + 0.5 : 0.5;
        buf.uv1[idx * 2] = buf.uv[idx * 2]; buf.uv1[idx * 2 + 1] = buf.uv[idx * 2 + 1];
        buf.blend[idx] = 0;
        buf.wind[idx * 3] = line.windIndex; buf.wind[idx * 3 + 1] = windWeight(line, flip ? 0 : 1); buf.wind[idx * 3 + 2] = 0;
      }
      for (let v = 0; v < sides; v++) {
        if (flip) buf.tri(center, next + v + 1, next + v);
        else buf.tri(center, next + v, next + v + 1);
      }
      next += verts + 1;
    };
    if (startPlanar && !j) fan(0, true);
    if (endPlanar) fan(rings - 1, false);
  }
}
