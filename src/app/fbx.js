// Writes a binary FBX 7.4 file. Three.js has no FBX exporter, so this is the small part of the format
// a static mesh needs. Y is up and units are centimeters, the same as the editor.
// Textures are embedded (a Video's Content) when they come with bytes, or referenced by file name next to the FBX.

import { facesOf } from './quads.js';
const enc = new TextEncoder();
const MAGIC = 'Kaydara FBX Binary  \0\x1a\0';
const VERSION = 7400;

class Out {
  constructor() { this.parts = []; this.size = 0; }
  bytes(u8) { this.parts.push(u8); this.size += u8.length; }
  u8(v) { this.bytes(Uint8Array.of(v)); }
  u32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v, true); this.bytes(a); }
  i32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setInt32(0, v, true); this.bytes(a); }
  i64(v) { const a = new Uint8Array(8); new DataView(a.buffer).setBigInt64(0, BigInt(v), true); this.bytes(a); }
  f64(v) { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, v, true); this.bytes(a); }
  done() { const out = new Uint8Array(this.size); let at = 0; for (const p of this.parts) { out.set(p, at); at += p.length; } return out; }
}

// Property kinds, tagged the way FBX names them.
const I = (v) => ['I', v];
const L = (v) => ['L', v];
const D = (v) => ['D', v];
const S = (v) => ['S', v];
const doubles = (a) => ['d', a];
const ints = (a) => ['i', a];

function writeProp(out, [tag, v]) {
  out.u8(tag.charCodeAt(0));
  if (tag === 'I') out.i32(v);
  else if (tag === 'C') out.u8(v);
  else if (tag === 'L') out.i64(v);
  else if (tag === 'D') out.f64(v);
  else if (tag === 'S') { const b = enc.encode(v); out.u32(b.length); out.bytes(b); }
  else if (tag === 'R') { out.u32(v.length); out.bytes(v); }
  else {
    const data = tag === 'd' ? Float64Array.from(v) : Int32Array.from(v);
    out.u32(data.length); out.u32(0); out.u32(data.byteLength);
    out.bytes(new Uint8Array(data.buffer));
  }
}

const node = (name, props = [], kids = []) => ({ name, props, kids });

function writeNode(out, n) {
  const props = new Out();
  for (const p of n.props) writeProp(props, p);
  // The end offset comes first, so it is patched in once the children have been written.
  const end = new Uint8Array(4);
  out.bytes(end);
  out.u32(n.props.length);
  out.u32(props.size);
  const name = enc.encode(n.name);
  out.u8(name.length);
  out.bytes(name);
  out.bytes(props.done());
  if (n.kids.length) {
    for (const k of n.kids) writeNode(out, k);
    out.bytes(new Uint8Array(13));
  }
  new DataView(end.buffer).setUint32(0, out.size, true);
}

const P70 = (...entries) => node('Properties70', [], entries.map((e) => node('P', e)));

function geometryNode(id, m) {
  const { position, normal, uv, index } = m;
  const color = m.colorA || m.color; const cs = m.colorA ? 4 : 3;
  const uvSets = [uv, ...(m.uvs || [])];
  // Quads where the mesh was built of them (see quads.js), triangles elsewhere.
  const { corners, sizes, tri } = facesOf(index, m.quadTri, position);
  const polygon = new Int32Array(corners.length);
  const normals = new Float64Array(corners.length * 3);
  for (let f = 0, at = 0; f < sizes.length; at += sizes[f++]) {
    for (let j = 0; j < sizes[f]; j++) {
      const i = at + j; const v = corners[i];
      // FBX marks the last corner of each polygon by storing its index as -(i + 1).
      polygon[i] = j === sizes[f] - 1 ? -v - 1 : v;
      normals[i * 3] = normal[v * 3]; normals[i * 3 + 1] = normal[v * 3 + 1]; normals[i * 3 + 2] = normal[v * 3 + 2];
    }
  }
  const polyMat = m.polyMat && tri.map((t) => m.polyMat[t]);
  const colors = new Float64Array((color.length / cs) * 4);
  for (let i = 0; i < color.length / cs; i++) {
    colors[i * 4] = color[i * cs]; colors[i * 4 + 1] = color[i * cs + 1]; colors[i * 4 + 2] = color[i * cs + 2]; colors[i * 4 + 3] = cs === 4 ? color[i * 4 + 3] : 1;
  }
  const layer = (kind, k = 0) => node('LayerElement', [], [node('Type', [S(kind)]), node('TypedIndex', [I(k)])]);
  const uvNode = (set, k) => node('LayerElementUV', [I(k)], [
    node('Version', [I(101)]), node('Name', [S(k ? m.uvNames?.[k - 1] || `UVMap${k}` : 'UVMap')]),
    node('MappingInformationType', [S('ByPolygonVertex')]), node('ReferenceInformationType', [S('IndexToDirect')]),
    node('UV', [doubles(set)]), node('UVIndex', [ints(corners)]),
  ]);
  return node('Geometry', [L(id), S(`${m.name}\0\x01Geometry`), S('Mesh')], [
    node('Vertices', [doubles(position)]),
    node('PolygonVertexIndex', [ints(polygon)]),
    node('GeometryVersion', [I(124)]),
    node('LayerElementNormal', [I(0)], [
      node('Version', [I(102)]), node('Name', [S('')]),
      node('MappingInformationType', [S('ByPolygonVertex')]), node('ReferenceInformationType', [S('Direct')]),
      node('Normals', [doubles(normals)]),
    ]),
    node('LayerElementColor', [I(0)], [
      node('Version', [I(101)]), node('Name', [S('Color')]),
      node('MappingInformationType', [S('ByPolygonVertex')]), node('ReferenceInformationType', [S('IndexToDirect')]),
      node('Colors', [doubles(colors)]), node('ColorIndex', [ints(corners)]),
    ]),
    ...uvSets.map(uvNode),
    node('LayerElementMaterial', [I(0)], [
      node('Version', [I(101)]), node('Name', [S('')]),
      node('MappingInformationType', [S(polyMat ? 'ByPolygon' : 'AllSame')]), node('ReferenceInformationType', [S('IndexToDirect')]),
      node('Materials', [ints(polyMat || [0])]),
    ]),
    node('Layer', [I(0)], [
      node('Version', [I(100)]),
      layer('LayerElementNormal'), layer('LayerElementColor'), layer('LayerElementUV'), layer('LayerElementMaterial'),
    ]),
    ...uvSets.slice(1).map((_, k) => node('Layer', [I(k + 1)], [node('Version', [I(100)]), layer('LayerElementUV', k + 1)])),
  ]);
}

const vec3 = (name, v) => [S(name), S('Lcl ' + name.split(' ')[1]), S(''), S('A'), D(v[0]), D(v[1]), D(v[2])];
const SLOTS = { diffuse: 'DiffuseColor', normal: 'NormalMap', opacity: 'TransparentColor' };

// meshes: [{ name, position, normal, uv, color, index, rgb: [r, g, b] }], all flat arrays. Optional: colorA (RGBA),
// uvs (more UV sets), translation and rotation (degrees, XYZ), materials [{ name, rgb, maps: { diffuse, normal,
// opacity: { file, bytes? } } }] with polyMat (a material number per triangle).
export function writeFbx(meshes) {
  const objects = [];
  const links = [];
  const videos = new Map();
  let id = 1000000;
  let counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0 };
  for (const m of meshes) {
    const model = ++id; const geometry = ++id;
    objects.push(
      geometryNode(geometry, m),
      node('Model', [L(model), S(`${m.name}\0\x01Model`), S('Mesh')], [
        node('Version', [I(232)]),
        P70(...[m.translation && vec3('Lcl Translation', m.translation), m.rotation && vec3('Lcl Rotation', m.rotation)].filter(Boolean)),
        node('Shading', [['C', 1]]),
        node('Culling', [S('CullingOff')]),
      ]),
    );
    links.push([model, 0], [geometry, model]);
    counts.Model++; counts.Geometry++;
    for (const mat of m.materials || [{ name: m.name, rgb: m.rgb }]) {
      const material = ++id;
      objects.push(node('Material', [L(material), S(`${mat.name}\0\x01Material`), S('')], [
        node('Version', [I(102)]),
        node('ShadingModel', [S('phong')]),
        P70([S('DiffuseColor'), S('Color'), S(''), S('A'), D(mat.rgb[0]), D(mat.rgb[1]), D(mat.rgb[2])]),
      ]));
      links.push([material, model]);
      counts.Material++;
      for (const [slot, tex] of Object.entries(mat.maps || {})) {
        if (!tex || !SLOTS[slot]) continue;
        let video = videos.get(tex.file);
        if (!video) {
          video = ++id; videos.set(tex.file, video);
          objects.push(node('Video', [L(video), S(`${tex.file}\0\x01Video`), S('Clip')], [
            node('Type', [S('Clip')]),
            P70([S('Path'), S('KString'), S('XRefUrl'), S(''), S(tex.file)]),
            node('UseMipMap', [I(0)]), node('Filename', [S(tex.file)]), node('RelativeFilename', [S(tex.file)]),
            ...(tex.bytes ? [node('Content', [['R', tex.bytes]])] : []),
          ]));
          counts.Video++;
        }
        const texture = ++id;
        objects.push(node('Texture', [L(texture), S(`${tex.file}\0\x01Texture`), S('')], [
          node('Type', [S('TextureVideoClip')]), node('Version', [I(202)]),
          node('TextureName', [S(`${tex.file}\0\x01Texture`)]), node('Media', [S(`${tex.file}\0\x01Video`)]),
          node('FileName', [S(tex.file)]), node('RelativeFilename', [S(tex.file)]),
          node('ModelUVTranslation', [D(0), D(0)]), node('ModelUVScaling', [D(1), D(1)]),
          node('Texture_Alpha_Source', [S('None')]), node('Cropping', [I(0), I(0), I(0), I(0)]),
        ]));
        counts.Texture++;
        links.push([video, texture], [texture, material, SLOTS[slot]]);
      }
    }
  }
  const axes = (k, v) => [S(k), S('int'), S('Integer'), S(''), I(v)];
  const doc = [
    node('FBXHeaderExtension', [], [node('FBXHeaderVersion', [I(1003)]), node('FBXVersion', [I(VERSION)]), node('Creator', [S('Canopy tree editor')])]),
    node('GlobalSettings', [], [
      node('Version', [I(1000)]),
      P70(axes('UpAxis', 1), axes('UpAxisSign', 1), axes('FrontAxis', 2), axes('FrontAxisSign', 1), axes('CoordAxis', 0), axes('CoordAxisSign', 1),
        [S('UnitScaleFactor'), S('double'), S('Number'), S(''), D(1)]),
    ]),
    node('Definitions', [], [
      node('Version', [I(100)]),
      node('Count', [I(Object.values(counts).reduce((a, b) => a + b, 0))]),
      ...Object.entries(counts).filter(([, k]) => k).map(([t, k]) => node('ObjectType', [S(t)], [node('Count', [I(k)])])),
    ]),
    node('Objects', [], objects),
    // A texture plugs into a material's slot by name (OP); everything else hangs from its owner (OO).
    node('Connections', [], links.map(([child, parent, slot]) => node('C', slot ? [S('OP'), L(child), L(parent), S(slot)] : [S('OO'), L(child), L(parent)]))),
  ];
  const out = new Out();
  out.bytes(enc.encode(MAGIC));
  out.u32(VERSION);
  for (const n of doc) writeNode(out, n);
  out.bytes(new Uint8Array(13));
  // Fixed footer the format ends with; some importers check for it.
  out.bytes(Uint8Array.of(0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e));
  out.bytes(new Uint8Array(4));
  out.bytes(new Uint8Array((16 - (out.size % 16)) % 16));
  out.u32(VERSION);
  out.bytes(new Uint8Array(120));
  out.bytes(Uint8Array.of(0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b));
  return out.done();
}
