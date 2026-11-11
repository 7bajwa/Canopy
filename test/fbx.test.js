// FBX is a binary format written by hand here, so it's read back with a real FBX parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { writeFbx } from '../src/app/fbx.js';

const quad = (name, x) => ({
  name,
  position: Float32Array.of(x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0),
  normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
  uv: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
  color: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1),
  index: Uint32Array.of(0, 1, 2, 0, 2, 3),
  rgb: [0.5, 0.25, 0.75],
});

test('an exported FBX reads back with the same meshes', () => {
  const bytes = writeFbx([quad('Trunk', 0), quad('Leaves', 5)]);
  assert.equal(String.fromCharCode(...bytes.slice(0, 18)), 'Kaydara FBX Binary');
  const group = new FBXLoader().parse(bytes.buffer, '');
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.deepEqual(meshes.map((m) => m.name).sort(), ['Leaves', 'Trunk']);
  const trunk = meshes.find((m) => m.name === 'Trunk');
  const g = trunk.geometry;
  assert.equal(g.getAttribute('position').count, 6, 'two triangles');
  for (const k of ['normal', 'uv', 'color']) assert.ok(g.getAttribute(k), `${k} survives`);
  assert.equal(g.getAttribute('position').getX(1), 1);
  assert.equal(g.getAttribute('position').getY(2), 1);
  assert.equal(g.getAttribute('uv').getX(1), 1);
  assert.equal(g.getAttribute('color').getY(1), 1, 'vertex color survives');
  // The parser reads FBX diffuse colors as sRGB, so 0.5 arrives as about 0.214 in linear.
  assert.ok(Math.abs(trunk.material.color.r - 0.214) < 0.02, `material color survives: ${trunk.material.color.r}`);
});

test('FBX carries a place, a second UV set, two materials and an embedded picture', () => {
  const m = { ...quad('Leaf', 0), translation: [10, 20, 30], uvs: [Float32Array.of(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5)],
    colorA: Float32Array.of(1, 0, 0, 0.25, 0, 1, 0, 0.5, 0, 0, 1, 0.75, 1, 1, 1, 1),
    materials: [{ name: 'A', rgb: [1, 1, 1] }, { name: 'B', rgb: [1, 0, 0] }], polyMat: [0, 1] };
  const bare = writeFbx([m]);
  const group = new FBXLoader().parse(bare.buffer, '');
  let mesh; group.traverse((o) => { if (o.isMesh) mesh = o; });
  assert.deepEqual(mesh.position.toArray(), [10, 20, 30], 'the place comes through as the object transform');
  assert.ok(mesh.geometry.getAttribute('uv1'), 'a second UV set');
  assert.equal([mesh.material].flat().length, 2, 'two materials');
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4);
  const withTex = writeFbx([{ ...quad('Leaf', 0), materials: [{ name: 'A', rgb: [1, 1, 1], maps: { diffuse: { file: 'leaf.png', bytes: png } } }] }]);
  const text = Buffer.from(withTex).toString('latin1');
  assert.ok(text.includes('Content') && text.includes('leaf.png') && text.includes('DiffuseColor') && text.includes('\x89PNG'), 'the picture is inside');
});
