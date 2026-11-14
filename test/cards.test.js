import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMesh } from '../src/app/cards.js';

test('cards: n quads crossing at the middle, each on its own atlas column', () => {
  const m = cardMesh(3, 200, 400, [10, 0, 20], 0);
  assert.equal(m.index.length, 18);
  assert.equal(m.position.length / 3, 12);
  const us = []; for (let i = 0; i < m.uv.length; i += 2) us.push(m.uv[i]);
  assert.deepEqual([Math.min(...us), Math.max(...us)], [0, 1]);
  for (let i = 1; i < m.position.length; i += 3) assert.ok(m.position[i] >= 0 && m.position[i] <= 400);
});

test('a cutout card keeps the picture mapping of the leaf', async () => {
  const { cutoutCard } = await import('../src/engine/leaves.js');
  // A leaf whose u follows x and v follows t.
  const pts = [];
  for (const t of [0, 0.5, 1]) for (const x of [-1, 0, 1]) pts.push({ t, x, u: 0.5 + x * 0.25, v: t });
  const card = cutoutCard({ pts, tris: [] });
  assert.equal(card.pts.length, 4);
  for (const p of card.pts) { assert.ok(Math.abs(p.u - (0.5 + p.x * 0.25)) < 1e-9); assert.ok(Math.abs(p.v - p.t) < 1e-9); }
});
