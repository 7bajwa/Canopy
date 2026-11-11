// What a person types and reads, and how backup files are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits, showLength, parseLength, rulerMarks } from '../src/app/units.js';
import { stamp, makeBackups } from '../src/app/backup.js';
import { figureFor } from '../src/app/scalefig.js';

test('lengths read in the system that is on, and the stored centimeters never change', () => {
  setUnits('metric');
  assert.equal(showLength(180), '180 cm');
  setUnits('imperial');
  assert.equal(showLength(182.88), "6' 0\"");
  assert.equal(showLength(2.54), '1"');
  assert.equal(showLength(180.34), "5' 11\"");
  setUnits('metric');
});

test('typed lengths understand every common way of writing them', () => {
  setUnits('metric');
  assert.equal(parseLength('180'), 180);
  assert.equal(parseLength('1.8 m'), 180);
  assert.equal(parseLength('10mm'), 1);
  assert.equal(parseLength("6'"), 182.88);
  assert.ok(Math.abs(parseLength('5\' 11"') - 180.34) < 1e-6);
  assert.equal(parseLength('10 in'), 25.4);
  setUnits('imperial');
  assert.equal(parseLength('10'), 25.4, 'a bare number means inches when feet and inches are on');
  assert.equal(parseLength('10cm'), 10);
  assert.ok(Number.isNaN(parseLength('tall')));
  setUnits('metric');
});

test('a ruler marks every 10 cm to 2 m, every metre to 10 m, then every 5 m', () => {
  setUnits('metric');
  assert.equal(rulerMarks(150)[1], 10);
  assert.equal(rulerMarks(640)[1], 100);
  assert.equal(rulerMarks(2000)[1], 500);
  for (const system of ['metric', 'imperial']) {
    setUnits(system);
    for (const h of [10, 60, 180, 640, 2000, 9000]) assert.equal(rulerMarks(h)[0], 0);
  }
  setUnits('metric');
});

test('the figure beside a plant grows with the plant', () => {
  assert.equal(figureFor(30), 'baby');
  assert.equal(figureFor(120), 'boy');
  assert.equal(figureFor(640), 'man');
  assert.equal(figureFor(2500), 'man');
});

test('backups only save when something changed, and carry the date and time', async () => {
  assert.equal(stamp(new Date(2026, 10, 7, 9, 5, 3)), '2026-11-07 09-05-03');
  const saved = [];
  let text = 'a';
  const b = makeBackups({ text: () => text, name: () => 'Tree', download: (n, t) => saved.push([n, t]), toast() {}, app: null });
  assert.equal(await b.start(5), true);
  assert.equal(saved[0][0], 'Tree.canopy');
  await b.tick();
  assert.equal(saved.length, 1, 'nothing changed, so no new file');
  text = 'b';
  await b.tick();
  assert.equal(saved.length, 2);
  assert.match(saved[1][0], /^Tree \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\.canopy$/);
  b.stop();
  assert.equal(b.running(), false);
});

test('closing the save dialog leaves backups off', async () => {
  const b = makeBackups({ text: () => 'a', name: () => 'Tree', download() {}, toast() {}, app: { saveAs: async () => false } });
  assert.equal(await b.start(5), false);
  assert.equal(b.running(), false);
});
