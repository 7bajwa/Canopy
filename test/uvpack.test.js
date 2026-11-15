// Packing tubes: a tube's UV box moved, turned and scaled on the sheet gives UV params that read the same texels there.
import test from 'node:test';
import assert from 'node:assert/strict';

const { tubeUv, remapTubeUv, sheetMap, tubeRectPx } = await import('../src/app/pack.js').catch(() => ({}));

const close = (a, b, msg) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${msg}: ${a} vs ${b}`);

test('tube box remap follows its piece on the sheet', { skip: !tubeUv && 'needs the page' }, () => {
  const cases = [
    [{ tileU: 0.1, tileV: 1, offsetU: 0.3, offsetV: 0 }, { cx: 0.2, cy: 0.5, rot: 0, k: 0.001, sc: [512, 512] }],
    [{ tileU: 0.25, tileV: 2, offsetU: -0.1, offsetV: 0.4, flipU: true }, { cx: 0.7, cy: 0.3, rot: 0.7, k: 0.0005, sc: [300, 600] }],
    [{ tileU: 0.5, tileV: 0.5, offsetU: 0.2, offsetV: 0.1, flipV: true, uvAngle: 30 }, { cx: 0.5, cy: 0.5, rot: -2.2, k: 0.002, sc: [100, 900] }],
    [{ tileU: 1, tileV: 1, offsetU: 0, offsetV: 0, uvFix: 'U' }, { cx: 0.4, cy: 0.6, rot: Math.PI / 2, k: 0.0004, sc: [0, 0] }],
  ];
  for (const [P, it] of cases) {
    const T = sheetMap(it, 1024, 1024, 1);
    const Q = { ...P, ...remapTubeUv(P, T) };
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.8]]) close(tubeUv(Q, a, b), T(tubeUv(P, a, b)), `${JSON.stringify(P)} at ${a},${b}`);
    assert.equal(Q.uvFix, 'none');
  }
});

test('tube box is one tile of the texture, two tileU wide round an old Spline tube, one with Even texel size', { skip: !tubeUv && 'needs the page' }, () => {
  const px = tubeRectPx({ tileU: 0.1, tileV: 1, offsetU: 0.5, offsetV: 0, uvMatch: false }, 1000, 500);
  close(px[0], [500, 500], 'start'); close(px[1], [700, 500], 'across'); close(px[2], [700, 0], 'far corner');
  close(tubeRectPx({ tileU: 0.1, tileV: 1, offsetU: 0.5, offsetV: 0 }, 1000, 500)[1], [600, 500], 'even texel');
});
