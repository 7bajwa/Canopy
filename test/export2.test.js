import test from 'node:test';
import assert from 'node:assert/strict';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { writeFbx } from '../src/app/fbx.js';
import { FORMATS, exportButton, mainExt, parentsOf } from '../src/app/exportkit.js';
import { WIND_STRIDE } from '../src/engine/wind.js';

const quad = (name, x, parent) => ({
  name, parent,
  position: Float32Array.of(x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0),
  normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
  uv: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
  color: new Float32Array(12).fill(1),
  index: Uint32Array.of(0, 1, 2, 0, 2, 3),
  rgb: [1, 1, 1],
  translation: [x, 0, 0],
});

test('FBX: pieces hang from their parent model', () => {
  const bytes = writeFbx([quad('Trunk', 0, -1), quad('Branch', 5, 0), quad('Leaf', 9, 1)]);
  const group = new FBXLoader().parse(bytes.buffer, '');
  const by = {}; group.traverse((o) => { if (o.isMesh) by[o.name] = o; });
  assert.equal(by.Branch.parent.name, 'Trunk');
  assert.equal(by.Leaf.parent.name, 'Branch');
  assert.ok(!by.Trunk.parent.isMesh, 'the trunk sits at the top');
});

test('parentsOf: a leaf goes under its branch, past lines with no piece', () => {
  // Lines: 0 trunk, 1 branch (parent 0), 2 twig without a piece (parent 1), 3 leaf (parent 2).
  const table = new Float32Array(4 * WIND_STRIDE);
  [-1, 0, 1, 2].forEach((p, l) => { table[l * WIND_STRIDE + 3] = p; });
  assert.deepEqual(parentsOf([0, 1, 3, -1], table), [-1, 0, 1, -1]);
});

test('export formats: one word each, Blender sends instead of saving', () => {
  assert.deepEqual(FORMATS.map(([, l]) => l), ['GLB', 'FBX', 'OBJ', 'USD', 'Canopy', 'Blender']);
  assert.equal(exportButton('blender'), 'Send to Blender');
  for (const [k] of FORMATS.filter(([k]) => k !== 'blender')) assert.equal(exportButton(k), 'Export');
  assert.equal(mainExt('glb', true), 'glb');
  assert.equal(mainExt('glb', false), 'gltf');
  assert.equal(mainExt('blender', false), 'fbx');
});
