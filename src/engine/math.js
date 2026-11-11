// Small numeric toolbox for the engine. Everything is deterministic for a given seed.

export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

// Stable hash to 0..1, so changing one branch doesn't reshuffle every other branch.
export function hash(a, b = 0, c = 0, d = 0) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 13), 0x27d4eb2f) ^ Math.imul(c + 0x165667b1, 0xd3a2646c);
  x = (Math.imul(x ^ (x >>> 15), 0x9e3779b1) + d) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

// Rodrigues rotation of v around a unit axis.
export function rotate(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v) * (1 - c);
  return [
    v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d,
    v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d,
    v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d,
  ];
}

// The transform settings use the view gizmo's axes (X right, Y away from the front view, Z up); in the
// engine's Y-up space those are these three directions.
export const ZUP = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
// Turns v around a frame's X, then Y, then Z (radians), the order the Rotation values are read in.
export const turnXYZ = (v, f, r) => rotate(rotate(rotate(v, f[0], r[0]), f[1], r[1]), f[2], r[2]);
// Rotation and scale for a shape in its own Y-up coordinates, from gizmo-axis values: r holds where each
// of the shape's axes ends up, k its scale. Null when it changes nothing.
export function shapeXf(rot, scl) {
  const k = [scl[0], scl[2], scl[1]];
  if (!rot.some(Boolean) && k.every((a) => a === 1)) return null;
  return { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => turnXYZ(e, ZUP, rot)), k };
}
export function applyXf(v, xf) {
  const { r, k } = xf;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i] * k[0]; const y = v[i + 1] * k[1]; const z = v[i + 2] * k[2];
    v[i] = r[0][0] * x + r[1][0] * y + r[2][0] * z;
    v[i + 1] = r[0][1] * x + r[1][1] * y + r[2][1] * z;
    v[i + 2] = r[0][2] * x + r[1][2] * y + r[2][2] * z;
  }
}

export function perpendicular(d) {
  const ref = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(ref, d));
}

// Smooth 1D value noise: enough for organic wobble and much cheaper than 3D noise.
export function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(seed, i) * 2 - 1, hash(seed, i + 1) * 2 - 1, u);
}

// Bakes a curve to a table so per-vertex lookups cost almost nothing.
const CURVE_SIZE = 128;
export function bakeCurve(curve) {
  const pts = [...(curve?.pts?.length ? curve.pts : [[0, 1, 's'], [1, 1, 's']])].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(CURVE_SIZE + 1);
  const n = pts.length;
  const tangent = (i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    return pts[i][2] === 'c' ? null : (b[1] - a[1]) / Math.max(b[0] - a[0], 1e-4);
  };
  let k = 0;
  for (let i = 0; i <= CURVE_SIZE; i++) {
    const x = i / CURVE_SIZE;
    while (k < n - 2 && x > pts[k + 1][0]) k++;
    const p0 = pts[k];
    const p1 = pts[Math.min(k + 1, n - 1)];
    const w = p1[0] - p0[0];
    if (w < 1e-6 || x <= p0[0]) { out[i] = x <= p0[0] ? p0[1] : p1[1]; continue; }
    if (x >= p1[0]) { out[i] = p1[1]; continue; }
    const t = (x - p0[0]) / w;
    const m0 = tangent(k);
    const m1 = tangent(Math.min(k + 1, n - 1));
    const linear = (p1[1] - p0[1]) / w;
    const a = (m0 ?? linear) * w;
    const b = (m1 ?? linear) * w;
    const t2 = t * t;
    const t3 = t2 * t;
    out[i] = (2 * t3 - 3 * t2 + 1) * p0[1] + (t3 - 2 * t2 + t) * a + (-2 * t3 + 3 * t2) * p1[1] + (t3 - t2) * b;
  }
  return out;
}

export function sampleCurve(table, t) {
  const x = clamp(t, 0, 1) * CURVE_SIZE;
  const i = Math.floor(x);
  return i >= CURVE_SIZE ? table[CURVE_SIZE] : table[i] + (table[i + 1] - table[i]) * (x - i);
}

export function hexToRgb(hex) {
  const v = parseInt((hex || '#ffffff').slice(1), 16);
  // sRGB to linear, since the renderer and glTF expect linear vertex colors
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
}

const BLEND = {
  normal: (a, b) => b,
  darken: (a, b) => Math.min(a, b),
  multiply: (a, b) => a * b,
  colorBurn: (a, b) => (b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b)),
  linearBurn: (a, b) => Math.max(0, a + b - 1),
  lighten: (a, b) => Math.max(a, b),
  screen: (a, b) => 1 - (1 - a) * (1 - b),
  colorDodge: (a, b) => (b >= 1 ? 1 : Math.min(1, a / (1 - b))),
  linearDodge: (a, b) => Math.min(1, a + b),
  overlay: (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  softLight: (a, b) => (b < 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(a) - a)),
  hardLight: (a, b) => (b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  vividLight: (a, b) => (b < 0.5 ? (b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / (2 * b))) : (b >= 1 ? 1 : Math.min(1, a / (2 * (1 - b))))),
  linearLight: (a, b) => clamp(a + 2 * b - 1, 0, 1),
  pinLight: (a, b) => (b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1)),
  difference: (a, b) => Math.abs(a - b),
  exclusion: (a, b) => a + b - 2 * a * b,
};

export function blendColor(mode, base, top, weight, out = base) {
  const f = BLEND[mode] || BLEND.normal;
  for (let i = 0; i < 3; i++) out[i] = base[i] + (f(base[i], top[i]) - base[i]) * weight;
  return out;
}
