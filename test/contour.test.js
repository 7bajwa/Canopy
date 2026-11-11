// Auto detect by contours: islands, holes, edge length, inner rings, speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contourCutouts } from '../src/leaf/contour.js';

const image = (w, h, inside) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) data.set([60, 140, 40, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
};
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const inPoly = (poly, x, y) => {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) on = !on;
  }
  return on;
};

test('two blobs make two cutouts whose outlines hug them', () => {
  const a = ellipse(80, 100, 50, 80); const b = ellipse(250, 120, 60, 70);
  const cuts = contourCutouts(image(360, 240, (x, y) => a(x, y) || b(x, y)), { padding: 2, segment: 16 });
  assert.equal(cuts.length, 2);
  for (const [c, f, cx, cy, rx, ry] of [[cuts[0], a, 80, 100, 50, 80], [cuts[1], b, 250, 120, 60, 70]]) {
    for (let k = 0; k < 64; k++) {
      const ang = (k / 64) * Math.PI * 2;
      assert.ok(inPoly(c.outlinePx, cx + Math.cos(ang) * rx * 0.97, cy + Math.sin(ang) * ry * 0.97), 'covers the blob');
    }
    for (const [x, y] of c.outlinePx) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      assert.ok((r - 1) * Math.min(rx, ry) < 5, 'not far outside');
    }
    assert.ok(f);
  }
});

test('a ring keeps its hole as negative space', () => {
  const outer = ellipse(100, 100, 80, 80); const hole = ellipse(100, 100, 35, 35);
  const [c, ...rest] = contourCutouts(image(200, 200, (x, y) => outer(x, y) && !hole(x, y)), { segment: 16 });
  assert.equal(rest.length, 0);
  assert.equal(c.holesPx.length, 1);
  // No triangle sits in the hole.
  const all = [...c.outlinePx, ...c.innerPx, ...c.holesPx.flat()];
  const t = c.mesh.tris;
  assert.ok(t.length > 0);
  for (let i = 0; i < t.length; i += 3) {
    const mx = (all[t[i]][0] + all[t[i + 1]][0] + all[t[i + 2]][0]) / 3; const my = (all[t[i]][1] + all[t[i + 1]][1] + all[t[i + 2]][1]) / 3;
    assert.ok(Math.hypot(mx - 100, my - 100) > 30, 'triangle inside the hole');
  }
});

test('specks are skipped, edges run near the chosen length, and the middle has fewer points', () => {
  const big = ellipse(120, 120, 100, 100);
  const cuts = contourCutouts(image(260, 260, (x, y) => big(x, y) || (x > 257 && y > 257)), { segment: 20, minArea: 64 });
  assert.equal(cuts.length, 1);
  const c = cuts[0];
  const lens = c.outlinePx.map((p, i) => { const q = c.outlinePx[(i + 1) % c.outlinePx.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }).sort((x, y) => x - y);
  const median = lens[lens.length >> 1];
  assert.ok(median > 12 && median < 28, `median edge ${median}`);
  assert.ok(c.innerPx.length > 0 && c.innerPx.length < c.outlinePx.length * 1.5);
  assert.ok(c.mesh.tris.length > 0 && c.stats.quads > 0);
});

test('a big atlas of many leaves runs quickly', () => {
  const blobs = Array.from({ length: 30 }, (_, i) => ellipse(80 + (i % 6) * 160, 90 + Math.floor(i / 6) * 190, 55, 80));
  const t0 = performance.now();
  const cuts = contourCutouts(image(1024, 1024, (x, y) => blobs.some((f) => f(x, y))), { segment: 24 });
  assert.equal(cuts.length, 30);
  assert.ok(performance.now() - t0 < 4000, `${Math.round(performance.now() - t0)} ms`);
});

test('the middle line option adds a row of points along the leaf', async () => {
  const { contourCutouts } = await import('../src/leaf/contour.js');
  const w = 60; const h = 200; const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - 30) / 20) ** 2 + ((y - 100) / 90) ** 2 < 1) data[(y * w + x) * 4 + 3] = 255;
  const plain = contourCutouts({ width: w, height: h, data }, { inner: false, segment: 16 });
  const mid = contourCutouts({ width: w, height: h, data }, { inner: false, midline: true, segment: 16 });
  assert.equal(plain[0].innerPx.length, 0);
  assert.ok(mid[0].innerPx.length >= 6, `points along the middle: ${mid[0].innerPx.length}`);
  assert.ok(mid[0].innerPx.every(([x]) => Math.abs(x - 30) < 4), 'they lie on the middle');
});
