// Wind data. A vertex shader bends each line around its base, then carries it along with every parent up the chain,
// so children stay on their branches. These tables are all it needs to do that.
import { hash, bakeCurve, sampleCurve, clamp } from './math.js';
import { tOf } from './line.js';

export const WIND_BEND = { pts: [[0, 0, 's'], [0.35, 0.12, 's'], [0.7, 0.48, 's'], [1, 1, 's']] };
export const WIND_STRIDE = 16;

// How far along a line the bend has built up: 0 stays put at the base, 1 swings fully.
export function windWeight(line, t) {
  const n = line.node;
  n.windTable ||= bakeCurve(n.params.windCurve || WIND_BEND);
  return sampleCurve(n.windTable, t);
}

export function windTable(ev) {
  ev.lines.forEach((l, i) => { l.windIndex = i; });
  const T = new Float32Array(ev.lines.length * WIND_STRIDE);
  ev.lines.forEach((l, i) => {
    const k = i * WIND_STRIDE;
    const q = ev.q(l.node);
    const c = ev.setCtx(l, 0);
    const P = l.node.params;
    const n = l.pts.length - 3;
    const dx = l.pts[n] - l.pts[0]; const dy = l.pts[n + 1] - l.pts[1]; const dz = l.pts[n + 2] - l.pts[2];
    const m = Math.hypot(dx, dy, dz) || 1;
    T[k] = l.pts[0]; T[k + 1] = l.pts[1]; T[k + 2] = l.pts[2];
    T[k + 3] = l.parent ? l.parent.windIndex : -1;
    T[k + 4] = dx / m; T[k + 5] = dy / m; T[k + 6] = dz / m;
    T[k + 7] = l.parent ? windWeight(l.parent, tOf(l.parent, l.parentS)) : 0;
    // shortcut: a Mesh with no parent is the ground of what grows on it, so it stays still; give it a parent to make it sway.
    const still = P.windRigid && !l.parent;
    // Thin, high-up parts give more than the trunk, and long parts swing slower than short ones.
    T[k + 8] = still ? 0 : ((q.windPower ? q.windPower(c) : 100) / 100) * (0.55 + 0.3 * Math.min(l.level, 3));
    // Short parts swing a little quicker than long ones, but within a narrow range so the plant moves as one.
    T[k + 9] = ((q.windSpeed ? q.windSpeed(c) : 100) / 100) * clamp(1.1 * Math.pow(300 / Math.max(l.length, 30), 0.25), 0.75, 1.8);
    // A small offset per part; most of the timing comes from where it stands, so gusts travel across the plant.
    T[k + 10] = hash(l.id, 3) * 0.8;
    // Only leaves shiver; a branch with flutter would spin its children around it.
    const mesh = ev.jobs?.get(l.node.id.replace('#path', '#mesh'))?.node.params.meshType;
    T[k + 11] = mesh === 'leaf' || mesh === 'cutout' ? (q.windFlutter ? q.windFlutter(c) : 0) / 100 : 0;
    // Where along its parent this line starts, for the parent's flutter to carry it.
    T[k + 12] = l.parent ? tOf(l.parent, l.parentS) : 0;
  });
  return T;
}

// How strong the global wind is at a moment: calm, then a gust up to somewhere in the range, then slowly back to calm.
export function gustAt(time, { min = 0, max = 10, freq = 6 } = {}) {
  const period = 60 / Math.max(freq, 0.1);
  const i = Math.floor(time / period);
  const u = time / period - i;
  const active = 0.65 + 0.35 * hash(i, 11);
  if (u >= active) return 0;
  const f = u / active;
  // Quick rise, long fall.
  const shape = f < 0.28 ? Math.sin((f / 0.28) * Math.PI * 0.5) ** 2 : Math.cos(((f - 0.28) / 0.72) * Math.PI * 0.5) ** 2;
  const peak = min + (max - min) * hash(i, 5);
  const ripple = 1 + 0.14 * Math.sin(time * 1.9) + 0.07 * Math.sin(time * 4.3);
  return Math.max(0, peak * shape * ripple);
}
