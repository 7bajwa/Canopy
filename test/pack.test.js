// Texture packing layout: pieces fit the square without overlapping, at one scale, and points follow their piece.
import test from 'node:test';
import assert from 'node:assert/strict';

const { autoPack, place } = await import('../src/app/pack.js').catch(() => ({}));

test('auto pack fits every piece inside the square without overlaps', { skip: !autoPack && 'needs the page' }, () => {
  const items = [[300, 600], [200, 200], [500, 250], [120, 400], [90, 90]].map(([w, h], i) => ({ id: i, w, h, sc: [w / 2, h / 2] }));
  autoPack(items, 0.01);
  const boxes = items.map((it) => [it.cx - (it.w * it.k) / 2, it.cy - (it.h * it.k) / 2, it.cx + (it.w * it.k) / 2, it.cy + (it.h * it.k) / 2]);
  for (const b of boxes) assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1, 'inside the square');
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    assert.ok(a[2] <= b[0] + 1e-9 || b[2] <= a[0] + 1e-9 || a[3] <= b[1] + 1e-9 || b[3] <= a[1] + 1e-9, `pieces ${i} and ${j} overlap`);
  }
  assert.ok(items.every((it) => it.k === items[0].k) && items[0].k > 0);
  // Turned a quarter, a point to the right of the piece's middle lands below it.
  const it = { cx: 0.5, cy: 0.5, k: 0.001, rot: Math.PI / 2, sc: [100, 100] };
  const [x, y] = place(it, [200, 100], 1000);
  assert.ok(Math.abs(x - 500) < 1e-6 && Math.abs(y - 600) < 1e-6);
});
