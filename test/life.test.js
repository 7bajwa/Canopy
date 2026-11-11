import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/engine/evaluate.js';
import { PRESETS, DEFAULT_PRESET } from '../src/graph/presets.js';
import { dropAt, seasonTint } from '../src/engine/life.js';

const run = (life) => {
  const g = PRESETS[DEFAULT_PRESET]();
  if (life) g.settings.life = { on: true, ...life };
  const r = evaluate(g, {});
  const leaf = r.meshes.filter((m) => m.kind === 'leaf').reduce((s, m) => s + m.index.length / 3, 0);
  const bark = r.meshes.filter((m) => m.kind !== 'leaf').reduce((s, m) => s + m.index.length / 3, 0);
  let top = -Infinity; for (const m of r.meshes) for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]);
  return { leaf, bark, top };
};

test('Age, Season and Health change the plant in the expected direction', () => {
  const base = run(null);
  const same = run({ age: 1, season: 0.25, health: 1 });
  assert.equal(same.leaf, base.leaf, 'defaults leave the plant as designed');
  const young = run({ age: 0.4 });
  assert.ok(young.top < base.top * 0.8, `younger is shorter: ${young.top} vs ${base.top}`);
  assert.ok(young.leaf < base.leaf, 'younger has fewer leaves');
  const winter = run({ season: 0.82 });
  assert.equal(winter.leaf, 0, 'bare in winter');
  assert.ok(winter.bark > 0, 'branches stay');
  const autumn = run({ season: 0.65 });
  assert.ok(autumn.leaf > 0 && autumn.leaf < base.leaf, 'autumn is dropping');
  const sick = run({ health: 0.3 });
  assert.ok(sick.leaf < base.leaf * 0.8, 'poor health thins leaves');
  assert.equal(dropAt(0.25), 0);
  const t = seasonTint(0.6, 0.1); assert.ok(t[0] > t[2], 'autumn is warm');
});
