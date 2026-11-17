// What a person types and reads, and how backup files are named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits, showLength, parseLength, rulerMarks } from '../src/app/units.js';
import { stamp, makeBackups, backupName } from '../src/app/backup.js';
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
  assert.equal(figureFor(30).id, 'squirrel');
  assert.equal(figureFor(120).id, 'boy');
  assert.equal(figureFor(300).id, 'man');
  assert.equal(figureFor(640).id, 'giraffe');
  assert.equal(figureFor(2500).id, 'sauroposeidon');
  assert.equal(figureFor(2500, { sauroposeidon: false, giraffe: false }).id, 'man', 'only the figures picked in Settings show');
});

test('backups only save when something changed, and carry the date and time', async () => {
  assert.equal(stamp(new Date(2026, 10, 7, 9, 5, 3)), '261107_0905');
  assert.equal(backupName(false, 'Oak', '261107_0905'), 'Canopy-261107_0905.canopy');
  assert.equal(backupName(true, 'Oak', '261107_0905'), 'Oak_261107_0905.canopy');
  const saved = [];
  let text = 'a';
  const b = makeBackups({ text: () => text, write: async (when, t) => saved.push([when, t]), toast() {} });
  b.start(5);
  assert.equal(b.running(), true);
  await b.tick();
  assert.equal(saved.length, 1);
  await b.tick();
  assert.equal(saved.length, 1, 'nothing changed, so no new file');
  text = 'b';
  await b.tick();
  assert.equal(saved.length, 2);
  b.stop();
  assert.equal(b.running(), false);
});

test('a backup that was declined is tried again next time', async () => {
  let n = 0;
  const b = makeBackups({ text: () => 'a', write: async () => (n++ ? true : false), toast() {} });
  await b.tick(); await b.tick();
  assert.equal(n, 2);
});

test('metres, millimetres and inch fractions read and type back', () => {
  setUnits('metric', 'm');
  assert.equal(showLength(180), '1.8 m');
  assert.equal(parseLength('2'), 200, 'a bare number is in the unit that is on');
  setUnits('metric', 'mm');
  assert.equal(showLength(1.5), '15 mm');
  setUnits('imperial', 'frac');
  assert.equal(showLength(2.54 * 3.5), '3 1/2"');
  assert.equal(showLength(2.54 * 70.75), "5' 10 3/4\"");
  assert.ok(Math.abs(parseLength('5 1/2"') - 2.54 * 5.5) < 1e-9);
  assert.ok(Math.abs(parseLength("5' 1/2") - 2.54 * 60.5) < 1e-9);
  setUnits('metric');
});
