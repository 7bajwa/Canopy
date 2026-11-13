// Writes a USDA (text USD) stage for Unreal Engine 5. Y is up and units are centimeters, the same as the editor;
// the stage says so (upAxis "Y", metersPerUnit 0.01) and Unreal's USD importers convert to its Z-up on import.
// Takes the same meshes as writeFbx (see fbx.js). Textures are referenced by file name next to the .usda;
// the ones that come with bytes are handed back in `files` to be written there.
//
// opts.name          the root prim (the plant), default 'Plant'
// opts.instancing    pieces whose geometry is the same (or that share m.proto) become prototypes drawn by one
//                    PointInstancer, each copy placed by its translation / quaternion / scale. Off: plain meshes.
// opts.naniteAssembly the root becomes a Nanite Assembly (UE 5.7+, Interchange USD import): meshes outside the
//                    PointInstancer are the base mesh, prototypes are the parts. Implies instancing.
// opts.nanite        marks every mesh for Nanite through Unreal's NaniteBuildSettingsAPI (UE 5.8 schema).
//
// A mesh, beyond writeFbx's fields, may carry quaternion ([x, y, z, w] or {x, y, z, w}), scale ([x, y, z]),
// proto (a key: meshes with the same key are copies of one piece) and doubleSided (default true).
// translation may be [x, y, z] or {x, y, z}; rotation is degrees in three.js Euler 'XYZ' order.
// Returns { usda, files: [{ file, bytes }] }.

import { facesOf } from './quads.js';

const num = (v) => (Number.isFinite(v) ? String(+(+v).toPrecision(7)) : '0');
const tuples = (a, size, n = a.length / size) => {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = new Array(size);
    for (let s = 0; s < size; s++) t[s] = num(a[i * size + s]);
    out[i] = `(${t.join(', ')})`;
  }
  return `[${out.join(', ')}]`;
};
const list = (a) => `[${Array.from(a, num).join(', ')}]`;
const ident = (s) => String(s || 'prim').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_');
const vec = (v) => (v == null ? null : Array.isArray(v) || ArrayBuffer.isView(v) ? [...v] : [v.x, v.y, v.z, v.w].filter((x) => x !== undefined));

// Unique names among siblings.
function namer() {
  const used = new Set();
  return (s) => { const b = ident(s); let n = b; for (let k = 2; used.has(n); k++) n = `${b}_${k}`; used.add(n); return n; };
}

// three.js Euler 'XYZ' (degrees) to a quaternion [x, y, z, w].
function eulerQuat([x, y, z]) {
  const r = Math.PI / 360; const c1 = Math.cos(x * r); const c2 = Math.cos(y * r); const c3 = Math.cos(z * r);
  const s1 = Math.sin(x * r); const s2 = Math.sin(y * r); const s3 = Math.sin(z * r);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const placeOf = (m) => ({
  t: vec(m.translation) || [0, 0, 0],
  q: vec(m.quaternion) || (m.rotation ? eulerQuat(vec(m.rotation)) : [0, 0, 0, 1]),
  s: vec(m.scale) || [1, 1, 1],
});

const materialsOf = (m) => m.materials || [{ name: m.name, rgb: m.rgb || [1, 1, 1] }];

// Two FNV-1a hashes over every array the mesh draws with, values rounded so float noise doesn't split copies.
function geometryKey(m) {
  let a = 0x811c9dc5; let b = 0x01000193;
  const eat = (arr) => {
    if (!arr) { a = Math.imul(a ^ 0xff, 0x01000193); return; }
    for (let i = 0; i < arr.length; i++) {
      const v = Math.round(arr[i] * 1e4) | 0;
      a = Math.imul(a ^ v, 0x01000193); b = Math.imul(b ^ v ^ (b >>> 15), 0x85ebca6b);
    }
    a = Math.imul(a ^ arr.length, 0x01000193);
  };
  for (const arr of [m.position, m.normal, m.uv, m.colorA || m.color, m.index, m.quadTri, m.polyMat, ...(m.uvs || [])]) eat(arr);
  return `${a >>> 0}:${b >>> 0}:${materialsOf(m).map((x) => x.name).join('|')}`;
}

function shaderLines(mat, path, files, seen) {
  const L = [];
  const maps = mat.maps || {};
  const tex = (prim, map, raw, out) => {
    if (map.bytes && !seen.has(map.file)) { seen.add(map.file); files.push({ file: map.file, bytes: map.bytes }); }
    L.push(`    def Shader "${prim}"`, '    {', '        uniform token info:id = "UsdUVTexture"',
      `        asset inputs:file = @${map.file}@`, `        float2 inputs:st.connect = <${path}/UV.outputs:result>`,
      '        token inputs:wrapS = "repeat"', '        token inputs:wrapT = "repeat"',
      `        token inputs:sourceColorSpace = "${raw ? 'raw' : 'sRGB'}"`);
    // UsdPreviewSurface wants tangent-space normals in -1..1; the picture holds 0..1.
    if (prim === 'Normal') L.push('        float4 inputs:scale = (2, 2, 2, 1)', '        float4 inputs:bias = (-1, -1, -1, 0)');
    L.push(`        ${out}`, '    }');
  };
  const rgb = mat.rgb || [1, 1, 1];
  const S = [`    def Shader "Surface"`, '    {', '        uniform token info:id = "UsdPreviewSurface"',
    maps.diffuse ? `        color3f inputs:diffuseColor.connect = <${path}/Diffuse.outputs:rgb>` : `        color3f inputs:diffuseColor = (${rgb.map(num).join(', ')})`];
  if (maps.normal) S.push(`        normal3f inputs:normal.connect = <${path}/Normal.outputs:rgb>`);
  if (maps.opacity) S.push(`        float inputs:opacity.connect = <${path}/Opacity.outputs:r>`, `        float inputs:opacityThreshold = ${num(mat.alphaTest ?? 0.5)}`);
  S.push('        float inputs:roughness = 0.8', '        float inputs:metallic = 0', '        token outputs:surface', '    }');
  L.push(`def Material "${path.split('/').pop()}"`, '{', `    token outputs:surface.connect = <${path}/Surface.outputs:surface>`, ...S);
  if (maps.diffuse || maps.normal || maps.opacity) {
    L.push('    def Shader "UV"', '    {', '        uniform token info:id = "UsdPrimvarReader_float2"', '        string inputs:varname = "st"', '        float2 outputs:result', '    }');
  }
  if (maps.diffuse) tex('Diffuse', maps.diffuse, false, 'float3 outputs:rgb');
  if (maps.normal) tex('Normal', maps.normal, true, 'float3 outputs:rgb');
  if (maps.opacity) tex('Opacity', maps.opacity, true, 'float outputs:r');
  L.push('}');
  return L;
}

// One Mesh prim. matPaths: the material path for each of the mesh's materials. place: write its xformOps.
function meshLines(m, name, matPaths, place, opts) {
  const { corners, sizes, tri } = facesOf(m.index, m.quadTri, m.position);
  const schemas = ['MaterialBindingAPI', ...(opts.nanite ? ['NaniteBuildSettingsAPI'] : [])];
  const L = [`def Mesh "${name}" (`, `    prepend apiSchemas = [${schemas.map((s) => `"${s}"`).join(', ')}]`, ')', '{'];
  const p = (s) => L.push(`    ${s}`);
  p(`uniform bool doubleSided = ${m.doubleSided === false ? 0 : 1}`);
  p('uniform token subdivisionScheme = "none"');
  p(`point3f[] points = ${tuples(m.position, 3)}`);
  p(`int[] faceVertexCounts = ${list(sizes)}`);
  p(`int[] faceVertexIndices = ${list(corners)}`);
  if (m.normal) p(`normal3f[] normals = ${tuples(m.normal, 3)} (\n        interpolation = "vertex"\n    )`);
  // Unreal orders UV sets by primvar name, so st, st1, st2... keep the editor's order.
  [m.uv, ...(m.uvs || []).filter(Boolean)].forEach((uv, k) => {
    if (uv) p(`texCoord2f[] primvars:st${k || ''} = ${tuples(uv, 2)} (\n        interpolation = "vertex"\n    )`);
  });
  const color = m.colorA || m.color; const cs = m.colorA ? 4 : 3;
  if (color) {
    const n = color.length / cs; const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = color[i * cs]; rgb[i * 3 + 1] = color[i * cs + 1]; rgb[i * 3 + 2] = color[i * cs + 2]; }
    p(`color3f[] primvars:displayColor = ${tuples(rgb, 3)} (\n        interpolation = "vertex"\n    )`);
    if (m.colorA) p(`float[] primvars:displayOpacity = ${list(Array.from({ length: n }, (_, i) => color[i * 4 + 3]))} (\n        interpolation = "vertex"\n    )`);
  }
  if (opts.nanite) p('uniform bool unreal:nanite:enabled = 1');
  if (place) {
    const { t, q, s } = placeOf(m);
    p(`double3 xformOp:translate = (${t.map(num).join(', ')})`);
    p(`quatf xformOp:orient = (${[q[3], q[0], q[1], q[2]].map(num).join(', ')})`);
    p(`float3 xformOp:scale = (${s.map(num).join(', ')})`);
    p('uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]');
  }
  // One material for the whole mesh, or one GeomSubset per material when faces choose (polyMat, per triangle).
  const used = m.polyMat ? [...new Set(tri.map((t) => m.polyMat[t]))].sort((a, b) => a - b) : [];
  if (used.length > 1) {
    p('uniform token subsetFamily:materialBind:familyType = "partition"');
    for (const k of used) {
      const faces = []; tri.forEach((t, f) => { if (m.polyMat[t] === k) faces.push(f); });
      L.push(`    def GeomSubset "${matPaths[k].split('/').pop()}_faces" (`, '        prepend apiSchemas = ["MaterialBindingAPI"]', '    )', '    {',
        '        uniform token elementType = "face"', '        uniform token familyName = "materialBind"',
        `        int[] indices = ${list(faces)}`, `        rel material:binding = <${matPaths[k]}>`, '    }');
    }
  } else {
    p(`rel material:binding = <${matPaths[used[0] ?? 0]}>`);
  }
  L.push('}');
  return L;
}

const indent = (lines, n = 1) => lines.map((l) => (l ? '    '.repeat(n) + l.replace(/\n/g, `\n${'    '.repeat(n)}`) : l));

export function writeUsd(meshes, opts = {}) {
  const root = ident(opts.name || 'Plant');
  const instancing = !!(opts.instancing || opts.naniteAssembly);
  const files = []; const seenFiles = new Set();

  // Materials, once each by name.
  const matName = namer(); const matByName = new Map(); const matLines = [];
  const matPathsOf = (m) => materialsOf(m).map((mat) => {
    let path = matByName.get(mat.name);
    if (!path) {
      path = `/${root}/Materials/${matName(mat.name)}`; matByName.set(mat.name, path);
      matLines.push(...shaderLines(mat, path, files, seenFiles));
    }
    return path;
  });

  // Copies of one piece share a prototype; a piece without copies stays a plain mesh.
  const groups = new Map();
  if (instancing) for (const m of meshes) { const k = m.proto ?? geometryKey(m); (groups.get(k) || groups.set(k, []).get(k)).push(m); }
  const protos = [...groups.values()].filter((g) => g.length > 1);
  const instanced = new Set(protos.flat());

  const meshName = namer(); meshName('Materials'); meshName('Instances');
  const body = [];
  for (const m of meshes) if (!instanced.has(m)) body.push(...meshLines(m, meshName(m.name), matPathsOf(m), true, opts));

  if (protos.length) {
    const protoName = namer(); const paths = []; const protoBody = [];
    const idx = []; const T = []; const Q = []; const Sc = [];
    protos.forEach((g, k) => {
      const name = protoName(g[0].name);
      paths.push(`</${root}/Instances/Prototypes/${name}>`);
      protoBody.push(...meshLines(g[0], name, matPathsOf(g[0]), false, opts));
      for (const m of g) {
        const { t, q, s } = placeOf(m);
        idx.push(k); T.push(...t); Q.push(q[3], q[0], q[1], q[2]); Sc.push(...s);
      }
    });
    body.push('def PointInstancer "Instances"', '{',
      `    rel prototypes = [${paths.join(', ')}]`,
      `    int[] protoIndices = ${list(idx)}`,
      `    point3f[] positions = ${tuples(T, 3)}`,
      `    quath[] orientations = ${tuples(Q, 4)}`,
      `    float3[] scales = ${tuples(Sc, 3)}`,
      '',
      '    def Scope "Prototypes"', '    {', ...indent(protoBody, 2), '    }',
      '}');
  }

  const rootMeta = opts.naniteAssembly
    ? ['    kind = "assembly"', '    prepend apiSchemas = ["NaniteAssemblyRootAPI"]']
    : ['    kind = "component"'];
  const out = [
    '#usda 1.0', '(', `    defaultPrim = "${root}"`, '    metersPerUnit = 0.01', '    upAxis = "Y"', '    doc = "Canopy tree editor"', ')', '',
    `def Xform "${root}" (`, ...rootMeta, ')', '{',
  ];
  if (opts.naniteAssembly) out.push('    uniform token unreal:naniteAssembly:meshType = "staticMesh"', '');
  out.push(...indent(body), '', '    def Scope "Materials"', '    {', ...indent(matLines, 2), '    }', '}', '');
  return { usda: out.join('\n'), files };
}
