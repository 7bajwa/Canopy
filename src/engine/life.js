// Age, Season and Health: three sliders for the whole plant (graph.settings.life), worked into every line as it is
// grown, so every node and setting keeps working as before and nothing has to be wired up.
//   Age 0..1.5: 1 is the plant as designed. Below, it is younger and smaller: each level starts growing later (trunk first, then
//     branches from the base upward, twigs, leaves last), lines are shorter (grown from the base, the tip comes last)
//     and thinner. Above 1 it is older: thicker, and some branches wither.
//   Season 0..1 around the year: 0 spring (buds and small light leaves), 0.25 summer (as designed), 0.5 autumn
//     (yellow, orange and red, each leaf on its own day), 0.75 winter (bare), back to spring.
//   Health 0..1: 1 healthy. Lower withers whole branches (they keep their bark, lose their leaves), thins leaves
//     and yellows them.
// Each leaf and branch draws its own random number from its line id, so moving a slider changes the plant smoothly
// instead of reshuffling it.
import { hash, clamp } from './math.js';
import { finishLine } from './line.js';

export const LIFE_DEFAULTS = { on: false, age: 1, season: 0.25, health: 1, levelDelay: 0.14, spread: 0.12 };

export function lifeOf(settings) {
  const L = { ...LIFE_DEFAULTS, ...(settings?.life || {}) };
  return L.on ? L : null;
}

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// How much of its leaves a plant has dropped by this time of year (0..1), before each leaf's own offset.
export const dropAt = (s) => (s < 0.5 ? 0 : s < 0.82 ? smooth(0.5, 0.8, s) : s < 0.96 ? 1 : 1 - smooth(0.96, 1, s));
// Spring: new leaves start small and grow to full size by early summer.
export const leafSize = (s) => (s < 0.2 ? 0.35 + 0.65 * smooth(0, 0.2, s) : s > 0.96 ? 0.35 : 1);

// The color a leaf takes at time of year s with its own random r, multiplied onto its color.
export function seasonTint(s, r, health = 1) {
  let c = [1, 1, 1];
  if (s < 0.18) { const k = 1 - smooth(0.05, 0.18, s); c = [1 + 0.25 * k, 1 + 0.2 * k, 1 - 0.2 * k]; }
  // Autumn: each leaf turns on its own, toward yellow, orange or red.
  const turn = smooth(0.36 + r * 0.1, 0.48 + r * 0.1, s) * (s < 0.9 ? 1 : 0);
  if (turn > 0) {
    // Leaf textures are mostly green, so red is lifted hard and green held back to read as yellow, orange and red.
    const fall = r < 0.4 ? [2.6, 1.15, 0.2] : r < 0.75 ? [3.0, 0.75, 0.15] : [3.2, 0.4, 0.2];
    c = c.map((v, i) => v + (fall[i] - v) * turn);
  }
  // Poor health yellows and dulls the leaves.
  const sick = clamp(1 - health, 0, 1) * (0.4 + 0.6 * r);
  if (sick > 0) c = [c[0] * (1 + 0.6 * sick), c[1] * (1 + 0.25 * sick), c[2] * (1 - 0.7 * sick)];
  return c;
}

// One line, right after it has grown (before its children are placed on it). leafy: the line carries leaves.
export function lifeLine(L, line, seed) {
  const leafy = !!line.node.params.leafy;
  const level = line.level || 0;
  const p = line.parent;
  const r = (salt) => hash(seed, line.id, salt);
  // Withering: a branch picked for it, and everything on it.
  line.withered = !!p?.withered;
  const wither = clamp(1 - L.health, 0, 1) * 0.55 + Math.max(0, L.age - 1.1) * 0.6;
  if (!leafy && level >= 1 && !line.withered && r(901) < wither * (level === 1 ? 0.5 : 1)) line.withered = true;
  if (leafy) {
    if (line.withered) { line.dead = true; return; }
    // Thinning from poor health, and the leaves the season has dropped.
    if (r(902) < clamp(1 - L.health, 0, 1) * 0.45) { line.dead = true; return; }
    const ph = r(903);
    line.season = ph;
    if (ph < dropAt(L.season) * (0.85 + 0.3 * ph)) { line.dead = true; return; }
    // A young plant carries fewer leaves.
    if (r(905) > 0.3 + 0.7 * Math.min(L.age, 1)) { line.dead = true; return; }
  }
  // Age: each level waits its turn, and along a parent the ones near the base start first. Leaves don't wait for
  // their level: they come with whatever has grown, so even a seedling has a few.
  const A = Math.min(L.age, 1);
  const along = p ? clamp(line.pos || 0, 0, 1) * L.spread : 0;
  const start = Math.min(0.9, leafy ? along * 0.5 : level * L.levelDelay + along);
  let t = clamp((A - start) / Math.max(0.05, 1 - start), 0, 1);
  if (t <= 0.02) {
    // Not its turn yet: some stay as short buds, the closer to their turn the more, so young plants carry leaves.
    if (leafy || r(904) > A / Math.max(start, 1e-3)) { line.dead = true; return; }
    t = 0.06;
  }
  let k = t;
  if (leafy) k *= leafSize(L.season);
  // Shrunk toward its base rather than cut, so what grows along it still has room: a young plant is a small one.
  if (k < 0.999 && line.length > 0) {
    const P = line.pts;
    for (let i = 3; i < P.length; i++) P[i] = P[i % 3] + (P[i] - P[i % 3]) * k;
    finishLine(line);
  }
  // Thickness follows age (older than 1 keeps thickening a little).
  line.sizeScale = (line.sizeScale ?? 1) * (leafy ? Math.sqrt(k) : t ** 0.6 * (1 + Math.max(0, L.age - 1) * 0.5));
  if (line.withered && !leafy) line.sizeScale *= 0.85;
}
