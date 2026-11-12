import test from 'node:test';
import assert from 'node:assert/strict';
import { cylCoords, fitRadius, unwrapSize, heightToNormal } from '../src/engine/unwrap.js';

test('a cylinder scan around a straight spline unwraps to its radius, length and aspect', () => {
  const P = [0, 0, 0, 0, 100, 0, 0, 200, 0];
  const V = [];
  for (let k = 0; k <= 20; k++) for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2; const r = 10 + (k / 20) * 10;
    V.push(Math.cos(ang) * r, k * 10, Math.sin(ang) * r);
  }
  const C = cylCoords(new Float32Array(V), P);
  assert.ok(Math.abs(C[2] - 10) < 1e-3, 'base radius');
  assert.ok(Math.abs(C[(20 * 16) * 3] - 1) < 1e-6, 'tip at t = 1');
  const us = new Set(); for (let a = 0; a < 16; a++) us.add(Math.round(C[a * 3 + 1] * 16) % 16);
  assert.equal(us.size, 16, 'points spread all the way around');
  const { r, mean } = fitRadius(C, 4);
  assert.ok(r[0] < r[3], 'radius grows toward the tip');
  assert.ok(mean > 12 && mean < 18);
  assert.equal(unwrapSize(1024, 200, 15), Math.round(1024 * 200 / (2 * Math.PI * 15)));
  assert.equal(unwrapSize(1024, 200, 15, true), 2048);
  const flat = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(128) };
  const n = heightToNormal(flat).data;
  assert.deepEqual([n[0], n[1], n[2]], [128, 128, 255]);
});

test('scanCenterline finds the middle of a leaning, uneven trunk from foot to top', async () => {
  const { scanCenterline } = await import('../src/engine/unwrap.js');
  // A ring every 10 cm, centered on x = 30 + 0.1 * y, with more points on one side.
  const V = [];
  for (let y = 0; y <= 300; y += 10) for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * (i % 2 ? 2 : 1); V.push(30 + y * 0.1 + 20 * Math.cos(a), y, 20 * Math.sin(a)); }
  const pts = scanCenterline(new Float32Array(V), 10);
  assert.ok(pts[0][1] < 1 && pts[pts.length - 1][1] > 299, 'foot to top');
  for (const p of pts) assert.ok(Math.abs(p[0] - (30 + p[1] * 0.1)) < 3 && Math.abs(p[2]) < 3, `on the axis: ${p.map((x) => x.toFixed(1))}`);
});
