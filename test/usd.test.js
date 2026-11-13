// USDA is text, so it's checked by reading the attributes back out of the string.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeUsd } from '../src/app/usd.js';

const quad = (name, x = 0) => ({
  name,
  position: Float32Array.of(x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0),
  normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
  uv: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
  color: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1),
  index: Uint32Array.of(0, 1, 2, 0, 2, 3),
  quadTri: Uint8Array.of(1, 1),
  rgb: [0.5, 0.25, 0.75],
});
const triangle = (name) => ({
  name,
  position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  uv: Float32Array.of(0, 0, 1, 0, 0, 1),
  index: Uint32Array.of(0, 1, 2),
  materials: [{ name: 'Bark', rgb: [0.3, 0.2, 0.1], maps: { diffuse: { file: 'bark.png', bytes: Uint8Array.of(1, 2, 3) }, normal: { file: 'bark_n.png' } } }],
});

const arr = (usda, attr) => {
  const m = usda.match(new RegExp(`${attr.replace(/[[\]]/g, '\\$&')} = \\[([^\\]]*)\\]`));
  assert.ok(m, `${attr} is written`);
  return m[1].trim() ? m[1].split(/,(?![^(]*\))/).map((s) => s.trim()) : [];
};
const all = (usda, attr) => [...usda.matchAll(new RegExp(`${attr.replace(/[[\]]/g, '\\$&')} = \\[([^\\]]*)\\]`, 'g'))].map((m) => m[1].split(/,(?![^(]*\))/).map((s) => s.trim()));
function balanced(s) {
  let d = 0;
  for (const c of s.replace(/@[^@]*@|"[^"]*"/g, '')) { if ('{(['.includes(c)) d++; if ('})]'.includes(c)) d--; assert.ok(d >= 0, 'never closes more than it opened'); }
  assert.equal(d, 0, 'every brace, paren and bracket closes');
}

test('a quad and a triangle come out as USDA with matching counts', () => {
  const { usda, files } = writeUsd([quad('Leaf'), triangle('Trunk')], { name: 'My Plant' });
  assert.match(usda, /^#usda 1\.0\n/);
  assert.match(usda, /upAxis = "Y"/);
  assert.match(usda, /metersPerUnit = 0\.01/);
  assert.match(usda, /defaultPrim = "My_Plant"/);
  assert.match(usda, /def Xform "My_Plant"/);
  balanced(usda);
  const counts = all(usda, 'int[] faceVertexCounts');
  const indices = all(usda, 'int[] faceVertexIndices');
  const points = all(usda, 'point3f[] points');
  assert.deepEqual(counts, [['4'], ['3']], 'the quad stays one quad');
  counts.forEach((c, i) => {
    assert.equal(c.reduce((s, n) => s + +n, 0), indices[i].length, 'corners add up');
    assert.ok(indices[i].every((v) => +v < points[i].length), 'corners point at real points');
    assert.equal(all(usda, 'normal3f[] normals')[i].length, points[i].length);
    assert.equal(all(usda, 'texCoord2f[] primvars:st')[i].length, points[i].length);
  });
  assert.equal(arr(usda, 'color3f[] primvars:displayColor').length, 4, 'vertex colors on the quad');
  assert.deepEqual(files, [{ file: 'bark.png', bytes: Uint8Array.of(1, 2, 3) }], 'only pictures with bytes are handed back');
});

test('materials are UsdPreviewSurface, textured and bound', () => {
  const { usda } = writeUsd([quad('Leaf'), triangle('Trunk')]);
  assert.match(usda, /def Material "Leaf"/);
  assert.match(usda, /def Material "Bark"/);
  assert.match(usda, /rel material:binding = <\/Plant\/Materials\/Leaf>/);
  assert.match(usda, /rel material:binding = <\/Plant\/Materials\/Bark>/);
  assert.match(usda, /info:id = "UsdPreviewSurface"/);
  assert.match(usda, /asset inputs:file = @bark\.png@/);
  assert.match(usda, /inputs:diffuseColor\.connect = <\/Plant\/Materials\/Bark\/Diffuse\.outputs:rgb>/);
  assert.match(usda, /inputs:normal\.connect = <\/Plant\/Materials\/Bark\/Normal\.outputs:rgb>/);
  // Every connection lands on a prim that exists.
  for (const [, path] of usda.matchAll(/<(\/[^>.]+)[^>]*>/g)) {
    const name = path.split('/').pop();
    assert.match(usda, new RegExp(`def \\w+ "${name}"`), `${path} exists`);
  }
});

test('per-face materials become GeomSubsets, and extra UV sets st1', () => {
  const m = { ...quad('Leaf'), quadTri: null, uvs: [null, Float32Array.of(0, 0, 0, 0, 0, 0, 0, 0)],
    colorA: Float32Array.of(1, 0, 0, 0.25, 0, 1, 0, 0.5, 0, 0, 1, 0.75, 1, 1, 1, 1),
    materials: [{ name: 'A', rgb: [1, 1, 1] }, { name: 'B', rgb: [1, 0, 0] }], polyMat: [0, 1] };
  const { usda } = writeUsd([m]);
  balanced(usda);
  assert.equal((usda.match(/def GeomSubset/g) || []).length, 2);
  assert.deepEqual(all(usda, 'int[] indices'), [['0'], ['1']]);
  assert.match(usda, /familyType = "partition"/);
  assert.equal(arr(usda, 'texCoord2f[] primvars:st1').length, 4);
  assert.deepEqual(arr(usda, 'float[] primvars:displayOpacity'), ['0.25', '0.5', '0.75', '1']);
});

test('copies become one prototype drawn by a PointInstancer', () => {
  const trunk = triangle('Trunk');
  const leaves = Array.from({ length: 5 }, (_, i) => ({ ...quad(`Leaf_${i}`), materials: [{ name: 'Leaf', rgb: [0, 1, 0] }], translation: { x: i, y: 2, z: 0 }, quaternion: [0, Math.sin(i / 2), 0, Math.cos(i / 2)] }));
  const { usda } = writeUsd([trunk, ...leaves], { instancing: true });
  balanced(usda);
  assert.equal((usda.match(/def Mesh /g) || []).length, 2, 'the trunk and one prototype');
  assert.match(usda, /def PointInstancer "Instances"/);
  assert.deepEqual(arr(usda, 'rel prototypes'), ['</Plant/Instances/Prototypes/Leaf_0>']);
  assert.deepEqual(arr(usda, 'int[] protoIndices'), ['0', '0', '0', '0', '0']);
  assert.equal(arr(usda, 'point3f[] positions').length, 5);
  assert.equal(arr(usda, 'quath[] orientations').length, 5);
  assert.equal(arr(usda, 'float3[] scales').length, 5);
  assert.equal(arr(usda, 'point3f[] positions')[3], '(3, 2, 0)');
  assert.doesNotMatch(usda, /NaniteAssemblyRootAPI/);

  const off = writeUsd([trunk, ...leaves]).usda;
  assert.equal((off.match(/def Mesh /g) || []).length, 6, 'without instancing every piece is a mesh');
  assert.equal((off.match(/xformOp:orient = /g) || []).length, 6);

  const nanite = writeUsd([trunk, ...leaves], { naniteAssembly: true, nanite: true }).usda;
  balanced(nanite);
  assert.match(nanite, /prepend apiSchemas = \["NaniteAssemblyRootAPI"\]/);
  assert.match(nanite, /unreal:naniteAssembly:meshType = "staticMesh"/);
  assert.match(nanite, /def PointInstancer/, 'an assembly implies instancing');
  assert.match(nanite, /"NaniteBuildSettingsAPI"/);
});

test('different pieces stay separate prototypes; a lone piece stays a mesh', () => {
  const a = [quad('A', 0), quad('A', 0)]; const b = [quad('B', 3), quad('B', 3), quad('B', 3)]; // same name, so same default material
  const { usda } = writeUsd([...a, ...b, quad('C', 9)], { instancing: true });
  assert.equal(arr(usda, 'rel prototypes').length, 2);
  assert.deepEqual(arr(usda, 'int[] protoIndices'), ['0', '0', '1', '1', '1']);
  assert.match(usda, /def Mesh "C"/);
});
