// The Export window: format, packing, how the plant splits into objects, and the wind data other engines read
// (vertex color gradients, Pivot Painter 2, a vertex animation bake, a simple bone rig).
import * as THREE from 'three';
import { el, numberField, checkField, selectField } from './fields.js';
import { doc } from './doc.js';
import { facesOf } from './quads.js';
import { writeFbx } from './fbx.js';
import { zipStore } from './zip.js';
import { download, safeName, saveDocument } from './io.js';
import { lineOf, lineExtents, windColors, pivotElements, pivotTextures, pivotUvs, bakeVat, piecesOf, pick, blenderUvs, BLENDER_UVS } from './exportkit.js';
import { WIND_STRIDE } from '../engine/wind.js';
import { lifeOf } from '../engine/life.js';

const opts = { layout: 'custom', format: 'glb', pack: true, group: 'node', ch: ['none', 'none', 'none', 'none'], pivot: false, vat: false, frames: 30, seconds: 2, strength: 5, rig: false, batch: 'separate' };
const GRADIENTS = [['none', 'Keep color'], ['height', 'Height, bottom to top'], ['branch', 'Branch, start to end'], ['leaf', 'Leaf, start to end (flutter)'], ['random', 'Random per piece (phase)'], ['bend', 'Bend, trunk to tips']];
// Ready-made wind layouts. Each sets the four vertex color channels (and Pivot Painter for Unreal); the matching
// sample shaders are in the app's wind folder (wind/README.md).
const LAYOUTS = {
  custom: { label: 'Custom (set the channels below)' },
  canopy: { label: 'Canopy: R flutter, G phase, B bend (Unity, Unreal, Godot shaders included)', ch: ['leaf', 'random', 'bend', 'none'], pivot: false },
  godot: { label: 'Godot tutorial: R sway (bend), G phase', ch: ['bend', 'random', 'none', 'none'], pivot: false },
  unreal: { label: 'Unreal Pivot Painter 2 + Canopy colors', ch: ['leaf', 'random', 'bend', 'none'], pivot: true },
  blender: { label: 'Blender: season and wind node groups (Canopy Bridge add-on)', ch: ['none', 'none', 'none', 'none'], pivot: false },
  none: { label: 'No wind data (keep colors)', ch: ['none', 'none', 'none', 'none'], pivot: false },
};

let root = null;
// batch: { items: presets, each(items, fn) } exports every preset, each as its own file or side by side in one.
export function openExport(view, toast, batch = null) {
  if (!view.meshes.length) { toast('There is no mesh to export yet.'); return; }
  if (!root) {
    root = el('section', 'modal'); root.id = 'exporter'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Export');
    document.body.append(root);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) root.hidden = true; });
  }
  const card = el('div', 'settings-card export-card');
  const body = el('div', 'settings-body');
  const draw = () => {
    body.replaceChildren();
    const sec = (t, on = true) => { const d = el('details', 'set-sec'); d.open = on; d.append(el('summary', '', t)); body.append(d); return d; };
    const f = sec('File');
    f.append(selectField('Format', opts.format, [['glb', 'GLB (glTF binary)'], ['fbx', 'FBX'], ['obj', 'OBJ, in a zip'], ['canopy', 'Canopy plant (.canopy)']], (v) => { opts.format = v; draw(); }));
    if (opts.format !== 'obj') f.append(checkField('Pack textures inside the file', opts.pack, (v) => { opts.pack = v; }));
    f.append(el('p', 'hint', opts.format === 'obj' ? 'The OBJ, its MTL and the pictures come in one zip.' : opts.format === 'canopy' ? 'The editable plant, nodes and all. Off: a zip with the .canopy and a textures folder.' : 'Off puts the pictures beside the file, in a zip.'));
    if (opts.format === 'canopy') return;
    if (batch) {
      const b = sec(`Presets (${batch.items.length})`);
      b.append(selectField('Presets as', opts.batch, [['separate', 'A file for each'], ['one', 'One file, side by side']], (v) => { opts.batch = v; }));
    }
    const g = sec('Objects');
    g.append(selectField('Export as', opts.group, [['single', 'One single mesh'], ['node', 'One mesh per node'], ['instances', 'Each piece on its own, with its transform']], (v) => { opts.group = v; draw(); }));
    g.append(el('p', 'hint', 'Each piece is a branch, a leaf or a copy, with its pivot at its base and turned the way it grows, so it can be moved in another app.'));
    const w = sec('Wind data', false);
    w.append(selectField('Layout', opts.layout, Object.entries(LAYOUTS).map(([k, v]) => [k, v.label]), (v) => {
      opts.layout = v; const L = LAYOUTS[v];
      if (L.ch) { opts.ch = [...L.ch]; opts.pivot = L.pivot; }
      draw();
    }));
    const shaders = el('a', 'wide-link', 'Sample wind shaders for Unity, Unreal and Godot');
    shaders.href = './wind/README.md'; shaders.target = '_blank'; shaders.rel = 'noopener';
    w.append(shaders);
    ['R', 'G', 'B', 'A'].forEach((c, i) => w.append(selectField(`Vertex color ${c}`, opts.ch[i], GRADIENTS, (v) => { opts.ch[i] = v; opts.layout = 'custom'; })));
    w.append(el('p', 'hint', 'A channel set to a gradient replaces that part of the vertex color.'));
    w.append(checkField('Pivot Painter 2 textures', opts.pivot, (v) => { opts.pivot = v; }));
    w.append(el('p', 'hint', 'Pivot position + parent index, and X axis + extent, as EXR textures; each piece points at its pixel in the second UV set.'));
    if (opts.group !== 'instances') {
      w.append(checkField('Vertex animation of the wind', opts.vat, (v) => { opts.vat = v; draw(); }));
      if (opts.vat) {
        w.append(numberField('Frames', opts.frames, { min: 2, max: 240, int: true }, (v) => { opts.frames = v; }));
        w.append(numberField('Seconds', opts.seconds, { min: 0.2, max: 30 }, (v) => { opts.seconds = v; }));
        w.append(numberField('Wind strength', opts.strength, { min: 0, max: 10 }, (v) => { opts.strength = v; }));
        w.append(el('p', 'hint', 'An EXR of offsets from rest per point and frame, read through the third UV set; a JSON says its size.'));
      }
      if (opts.format === 'glb') w.append(checkField('Bone rig (one bone per branch)', opts.rig, (v) => { opts.rig = v; }));
    }
  };
  draw();
  const row = el('div', 'row-buttons');
  const cancel = el('button', 'wide', 'Cancel'); const go = el('button', 'wide primary', 'Export');
  cancel.addEventListener('click', () => { root.hidden = true; });
  // Straight into Blender, through the Canopy Bridge add-on listening on this computer.
  const blender = el('button', 'wide', 'Send to Blender');
  blender.title = 'Sends an FBX with its textures to Blender. Needs the Canopy Bridge add-on listening there.';
  blender.addEventListener('click', async () => {
    blender.disabled = true; blender.textContent = 'Sending…';
    try { await sendToBlender(view); toast('Sent to Blender.'); root.hidden = true; } catch (e) {
      console.error(e);
      toast('Blender didn\'t answer. Install the Canopy Bridge add-on (link below Export), then press Start listening in its Canopy tab.', 8000);
    }
    blender.disabled = false; blender.textContent = 'Send to Blender';
  });
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Exporting…';
    try {
      if (!batch) await runExport(view);
      else if (opts.batch === 'separate') await batch.each(batch.items, (p) => runExport(view, `${doc.name} ${p.name}`));
      else {
        // Each preset's plant, copied where it stands and moved along X past the one before.
        const snaps = []; let dx = 0;
        await batch.each(batch.items, (p) => {
          const s = snapshotOf(view, dx);
          snaps.push(s);
          dx += s.width + Math.max(50, s.width * 0.25);
        });
        await runExport(combineSnapshots(snaps), `${doc.name} presets`);
      }
      root.hidden = true;
    } catch (e) { console.error(e); toast(`The export failed: ${e.message}`, 6000); }
    go.disabled = false; go.textContent = 'Export';
  });
  row.append(cancel, blender, go);
  const addon = el('a', 'hint', 'Get the Blender add-on (Canopy Bridge)');
  addon.href = './blender/canopy_blender.py'; addon.download = 'canopy_blender.py';
  card.append(el('h2', '', 'Export'), body, row, addon);
  root.replaceChildren(card);
  root.hidden = false;
  go.focus();
}

// ---- The plant as parts: each with its arrays, material and transform ----
const nodeName = (id) => { const n = doc.graph.nodes.find((x) => x.id === id); return safeName(n?.name || n?.type || id); };

function partsOf(view) {
  const table = view.windLines || new Float32Array(0);
  const srcs = view.meshes.map((m) => m.userData.src);
  let lo = Infinity; let hi = -Infinity;
  for (const s of srcs) for (let i = 1; i < s.position.length; i += 3) { lo = Math.min(lo, s.position[i]); hi = Math.max(hi, s.position[i]); }
  const ctx = { table, ext: lineExtents(srcs, table), lo, hi };
  const forBlender = opts.layout === 'blender';
  const pp = opts.pivot && !forBlender ? pivotElements(srcs, table) : null;
  const tinted = opts.ch.some((c) => c !== 'none');
  // Leaves ride the bone of the branch they grow on.
  const leafLines = new Set();
  for (const s of srcs) if (s.kind === 'leaf') for (let i = 0; i < s.position.length / 3; i++) leafLines.add(lineOf(s, i));
  let parts = view.meshes.map((mesh) => {
    const src = mesh.userData.src;
    return {
      name: nodeName(src.nodeId), src, material: mesh.material, kind: src.kind, leafLines,
      position: src.position, normal: src.normal, uv: src.uv, color: src.color, index: src.index, wind: src.wind,
      quadTri: src.quads ? new Uint8Array(src.index.length / 3).fill(1) : null,
      colorA: tinted ? windColors(src, opts.ch, ctx) : null,
      uvs: forBlender ? blenderUvs(src, ctx) : [pp ? pivotUvs(src, pp) : src.uv1 || null],
      uvNames: forBlender ? BLENDER_UVS : null,
    };
  });
  if (opts.group === 'instances') parts = parts.flatMap((p) => instancesOf(p, table));
  if (opts.group === 'single') parts = [merge(parts)];
  return { parts, table, pp };
}

// Cuts a part into its pieces, each moved to its base and turned so its local Y is the way it grows.
function instancesOf(part, table) {
  return piecesOf(part).map((pc, n) => {
    const k = pc.line * WIND_STRIDE;
    const base = pc.line >= 0 ? new THREE.Vector3(table[k], table[k + 1], table[k + 2]) : new THREE.Vector3();
    const dir = pc.line >= 0 ? new THREE.Vector3(table[k + 4], table[k + 5], table[k + 6]).normalize() : new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const inv = q.clone().invert();
    const P = pick(part.position, 3, pc.verts); const N = pick(part.normal, 3, pc.verts);
    const v = new THREE.Vector3();
    for (let i = 0; i < P.length; i += 3) {
      v.set(P[i] - base.x, P[i + 1] - base.y, P[i + 2] - base.z).applyQuaternion(inv); P[i] = v.x; P[i + 1] = v.y; P[i + 2] = v.z;
      v.set(N[i], N[i + 1], N[i + 2]).applyQuaternion(inv); N[i] = v.x; N[i + 1] = v.y; N[i + 2] = v.z;
    }
    return {
      ...part, name: `${part.name}_${String(n + 1).padStart(3, '0')}`, position: P, normal: N, uv: pick(part.uv, 2, pc.verts), color: pick(part.color, 3, pc.verts),
      colorA: part.colorA && pick(part.colorA, 4, pc.verts), uvs: part.uvs.map((u) => u && pick(u, 2, pc.verts)), wind: part.wind && pick(part.wind, 3, pc.verts),
      index: pc.index, translation: base, quaternion: q, quadTri: part.quadTri ? new Uint8Array(pc.index.length / 3).fill(1) : null,
    };
  });
}

// Every part as one mesh, with one material per original part, chosen per triangle.
function merge(parts) {
  const cat = (key, size, fill) => {
    const n = parts.reduce((s, p) => s + p.position.length / 3, 0); const out = new Float32Array(n * size); let at = 0;
    for (const p of parts) { const nv = p.position.length / 3; const a = typeof key === 'function' ? key(p) : p[key]; if (a) out.set(a, at); else out.fill(fill, at, at + nv * size); at += nv * size; }
    return out;
  };
  const index = []; const polyMat = []; const groups = []; const quadTri = []; let base = 0;
  parts.forEach((p, m) => {
    groups.push([index.length, p.index.length, m]);
    for (let i = 0; i < p.index.length; i++) index.push(p.index[i] + base);
    for (let t = 0; t < p.index.length / 3; t++) { polyMat.push(m); quadTri.push(p.quadTri ? 1 : 0); }
    base += p.position.length / 3;
  });
  const anyA = parts.some((p) => p.colorA);
  const nUv = Math.max(0, ...parts.map((p) => p.uvs.length));
  return {
    name: safeName(doc.name), material: parts.map((p) => p.material), kind: 'mixed', leafLines: parts[0]?.leafLines,
    position: cat('position', 3, 0), normal: cat('normal', 3, 0), uv: cat('uv', 2, 0), color: cat('color', 3, 1),
    colorA: anyA ? cat((p) => p.colorA || windColorsOf(p), 4, 1) : null, uvs: Array.from({ length: nUv }, (_, k) => (parts.some((p) => p.uvs[k]) ? cat((p) => p.uvs[k], 2, 0) : null)), uvNames: parts[0]?.uvNames,
    wind: parts.every((p) => p.wind) ? cat('wind', 3, 0) : null, index: Uint32Array.from(index), polyMat, groups, quadTri: Uint8Array.from(quadTri),
  };
}
const windColorsOf = (p) => { const n = p.position.length / 3; const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([p.color[i * 3], p.color[i * 3 + 1], p.color[i * 3 + 2], 1], i * 4); return a; };

// ---- Pictures ----
async function pngOf(image) {
  const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
  c.getContext('2d').drawImage(image, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// Every picture the materials use, once each, with a file name.
async function pictures(parts) {
  const files = new Map(); let n = 0;
  for (const p of parts) for (const mat of [p.material].flat()) for (const slot of ['map', 'normalMap', 'alphaMap']) {
    const img = mat?.[slot]?.image;
    if (!img?.width || files.has(img)) continue;
    files.set(img, { file: `${safeName(doc.name)}_${slot === 'map' ? 'color' : slot === 'normalMap' ? 'normal' : 'opacity'}_${++n}.png`, bytes: await pngOf(img) });
  }
  return files;
}

async function exr(data, w, h) {
  const { EXRExporter } = await import('three/examples/jsm/exporters/EXRExporter.js');
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  return new EXRExporter().parse(t, { type: THREE.FloatType, compression: 0 });
}

//// ---- Several presets in one file ----
// A copy of what the view shows, moved dx along X, with its width.
function snapshotOf(view, dx = 0) {
  let lo = Infinity; let hi = -Infinity;
  for (const m of view.meshes) { const P = m.userData.src.position; for (let i = 0; i < P.length; i += 3) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); } }
  const shift = lo < hi ? dx - lo : dx;
  const move = (a) => { const o = a.slice(); for (let i = 0; i < o.length; i += 3) o[i] += shift; return o; };
  const T = (view.windLines || new Float32Array(0)).slice();
  for (let k = 0; k < T.length; k += WIND_STRIDE) T[k] += shift;
  const meshes = view.meshes.map((m) => ({ material: m.material, userData: { src: { ...m.userData.src, position: move(m.userData.src.position) } } }));
  return { meshes, windLines: T, width: lo < hi ? hi - lo : 0, u: view.u, gust: view.gust };
}
// The snapshots as one view: each one's lines are renumbered after the ones before it.
function combineSnapshots(list) {
  let lines = 0; const meshes = []; const tables = [];
  for (const s of list) {
    for (const m of s.meshes) {
      const src = m.userData.src; const wind = src.wind?.slice();
      if (wind) for (let i = 0; i < wind.length; i += 3) if (wind[i] >= 0) wind[i] += lines;
      meshes.push({ material: m.material, userData: { src: { ...src, wind } } });
    }
    const T = s.windLines.slice();
    for (let k = 0; k < T.length; k += WIND_STRIDE) if (T[k + 3] >= 0) T[k + 3] += lines;
    tables.push(T); lines += T.length / WIND_STRIDE;
  }
  const windLines = new Float32Array(lines * WIND_STRIDE); let at = 0;
  for (const T of tables) { windLines.set(T, at); at += T.length; }
  return { meshes, windLines, u: list[0]?.u, gust: list[0]?.gust };
}

// ---- Writers ----
const BRIDGE = 'http://127.0.0.1:9787/import';
// One FBX with its textures inside, posted to the Blender add-on.
async function sendToBlender(view) {
  const keep = { format: opts.format, pack: opts.pack, vat: opts.vat, pivot: opts.pivot, layout: opts.layout };
  Object.assign(opts, { format: 'fbx', pack: true, vat: false, pivot: false, layout: 'blender' });
  try {
    const { parts } = partsOf(view);
    const data = fbx(parts, await pictures(parts), true);
    // The plant's Age & Season values become the scene's Season and Health sliders in Blender.
    const L = lifeOf(doc.graph.settings);
    const q = `name=${encodeURIComponent(safeName(doc.name))}${L ? `&season=${L.season}&health=${L.health}` : ''}`;
    const res = await fetch(`${BRIDGE}?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
    if (!res.ok) throw new Error(await res.text());
  } finally { Object.assign(opts, keep); }
}

async function runExport(view, title = doc.name) {
  if (opts.format === 'canopy') { saveDocument(opts.pack ? 'embed' : 'folder'); return; }
  const { parts, table, pp } = partsOf(view);
  const name = safeName(title);
  const extra = [];
  if (pp) {
    const { pos, xv } = pivotTextures(pp);
    extra.push({ name: `${name}_PivotPos_ParentIndex.exr`, data: await exr(pos, pp.w, pp.h) }, { name: `${name}_XVector_XExtent.exr`, data: await exr(xv, pp.w, pp.h) });
  }
  if (opts.vat && opts.group !== 'instances') {
    const dir = view.u?.uWindDir?.value; const d = dir ? [dir.x, dir.y, dir.z] : [1, 0, 0];
    const info = [];
    for (const p of parts) {
      const vat = bakeVat(p, table, { frames: opts.frames, seconds: opts.seconds, windS: (opts.strength / 10) * 0.3, dir: d, speed: view.gust?.speed || 1 });
      p.uvs = [p.uvs[0] || new Float32Array(p.uv.length), vat.uv];
      extra.push({ name: `${name}_${p.name}_VAT.exr`, data: await exr(vat.data, vat.w, vat.h) });
      info.push({ mesh: p.name, width: vat.w, height: vat.h, rowsPerFrame: vat.rows, frames: vat.frames, seconds: opts.seconds, units: 'cm', offsetRange: vat.range, uvSet: 2 });
    }
    extra.push({ name: `${name}_VAT.json`, data: JSON.stringify(info, null, 2) });
  }
  const pics = await pictures(parts);
  const packed = opts.pack && opts.format !== 'obj';
  let main;
  if (opts.format === 'glb') main = { name: `${name}.glb`, data: await glb(parts, packed, table) };
  else if (opts.format === 'fbx') main = { name: `${name}.fbx`, data: fbx(parts, pics, packed) };
  else main = { name: `${name}.obj`, data: obj(parts, pics) };
  const files = [main, ...extra];
  if (opts.format === 'obj') files.push({ name: `${name}.mtl`, data: mtl(parts, pics) });
  if (!packed) for (const f of pics.values()) files.push({ name: f.file, data: f.bytes });
  if (files.length === 1) download(main.name, new Blob([main.data]));
  else download(`${name}.zip`, new Blob([zipStore(files)], { type: 'application/zip' }));
}

const matName = (m, fallback) => safeName(m?.name || fallback);
const rgbOf = (m) => (m?.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1]);

async function glb(parts, packed, table) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const scene = new THREE.Scene(); const top = new THREE.Group(); top.name = doc.name;
  // glTF measures in meters and the editor in centimeters.
  top.scale.setScalar(0.01); scene.add(top);
  const copyMat = (m) => new THREE.MeshStandardMaterial({
    name: m.name, color: m.color, roughness: m.roughness ?? 1, metalness: m.metalness ?? 0, vertexColors: true, side: m.side, alphaTest: m.alphaTest,
    map: packed ? m.map : null, normalMap: packed ? m.normalMap : null,
  });
  for (const p of parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
    g.setAttribute('color', p.colorA ? new THREE.BufferAttribute(p.colorA, 4) : new THREE.BufferAttribute(p.color, 3));
    p.uvs.forEach((u, i) => { if (u) g.setAttribute(`uv${i + 1}`, new THREE.BufferAttribute(u, 2)); });
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    const mats = [p.material].flat().map(copyMat);
    if (p.groups) for (const [start, count, m] of p.groups) g.addGroup(start, count, m);
    let mesh;
    if (opts.rig && p.wind && opts.group !== 'instances') mesh = rigged(g, mats, p, table);
    else mesh = new THREE.Mesh(g, p.groups ? mats : mats[0]);
    mesh.name = p.name;
    if (p.translation) mesh.position.copy(p.translation);
    if (p.quaternion) mesh.quaternion.copy(p.quaternion);
    top.add(mesh);
  }
  return new GLTFExporter().parseAsync(scene, { binary: true });
}

// shortcut: one bone per branch line, each point following its own line fully (leaves follow the branch they grow
// on); no smooth weights between bones, so a bent branch bends at its joints only.
function rigged(g, mats, p, table) {
  const lines = new Set(); const n = p.position.length / 3;
  const owner = (l) => (l >= 0 && isLeafLine(p, l) ? Math.round(table[l * WIND_STRIDE + 3]) : l);
  const own = new Int32Array(n);
  for (let i = 0; i < n; i++) { let l = owner(lineOf(p, i)); own[i] = l; while (l >= 0 && !lines.has(l)) { lines.add(l); l = Math.round(table[l * WIND_STRIDE + 3]); } }
  const list = [...lines].sort((a, b) => a - b); const at = new Map(list.map((l, i) => [l, i]));
  const bones = list.map((l) => { const b = new THREE.Bone(); b.name = `line_${l}`; return b; });
  const roots = [];
  list.forEach((l, i) => {
    const k = l * WIND_STRIDE; const parent = Math.round(table[k + 3]);
    const pos = new THREE.Vector3(table[k], table[k + 1], table[k + 2]);
    if (parent >= 0 && at.has(parent)) { const pk = parent * WIND_STRIDE; pos.sub(new THREE.Vector3(table[pk], table[pk + 1], table[pk + 2])); bones[at.get(parent)].add(bones[i]); } else roots.push(bones[i]);
    bones[i].position.copy(pos);
  });
  const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = at.get(own[i]) ?? 0; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, p.groups ? mats : mats[0]);
  for (const r of roots) mesh.add(r);
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}
const isLeafLine = (p, l) => !!p.leafLines?.has(l);

function fbx(parts, pics, packed) {
  const e = new THREE.Euler();
  return writeFbx(parts.map((p) => {
    const mats = [p.material].flat();
    return {
      name: p.name, position: p.position, normal: p.normal, uv: p.uv, color: p.color, colorA: p.colorA, index: p.index, quadTri: p.quadTri,
      uvs: p.uvs.filter(Boolean), uvNames: p.uvNames, rgb: rgbOf(mats[0]), polyMat: p.polyMat,
      translation: p.translation && [p.translation.x, p.translation.y, p.translation.z],
      rotation: p.quaternion && (e.setFromQuaternion(p.quaternion, 'XYZ'), [e.x, e.y, e.z].map((r) => (r * 180) / Math.PI)),
      materials: mats.map((m, i) => ({
        name: matName(m, `${p.name}_${i + 1}`), rgb: rgbOf(m),
        maps: Object.fromEntries([['diffuse', m?.map], ['normal', m?.normalMap], ['opacity', m?.alphaMap]].filter(([, t]) => pics.has(t?.image)).map(([k, t]) => {
          const f = pics.get(t.image); return [k, packed ? f : { file: f.file }];
        })),
      })),
    };
  }));
}

// OBJ has no transforms, so pieces are written where they stand.
function obj(parts, pics) {
  const out = [`# ${doc.name}\nmtllib ${safeName(doc.name)}.mtl\n`]; let base = 1;
  const v = new THREE.Vector3();
  for (const p of parts) {
    const n = p.position.length / 3; const mats = [p.material].flat();
    const chunk = [`o ${p.name}\n`];
    for (let i = 0; i < n; i++) {
      v.set(p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]);
      if (p.quaternion) v.applyQuaternion(p.quaternion); if (p.translation) v.add(p.translation);
      chunk.push(`v ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}\n`);
    }
    for (let i = 0; i < n; i++) chunk.push(`vt ${p.uv[i * 2].toFixed(4)} ${p.uv[i * 2 + 1].toFixed(4)}\n`);
    for (let i = 0; i < n; i++) {
      v.set(p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2]); if (p.quaternion) v.applyQuaternion(p.quaternion);
      chunk.push(`vn ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}\n`);
    }
    let cur = -1;
    const { corners, sizes, tri } = facesOf(p.index, p.quadTri, p.position);
    for (let f = 0, at = 0; f < sizes.length; at += sizes[f++]) {
      const m = p.polyMat ? p.polyMat[tri[f]] : 0;
      if (m !== cur) { cur = m; chunk.push(`usemtl ${matName(mats[m], `${p.name}_${m + 1}`)}\n`); }
      chunk.push(`f ${corners.slice(at, at + sizes[f]).map((v) => `${v + base}/${v + base}/${v + base}`).join(' ')}\n`);
    }
    base += n; out.push(chunk.join(''));
  }
  return out.join('');
}

function mtl(parts, pics) {
  const seen = new Set(); const out = [];
  for (const p of parts) [p.material].flat().forEach((m, i) => {
    const nm = matName(m, `${p.name}_${i + 1}`); if (seen.has(nm)) return; seen.add(nm);
    const [r, g, b] = rgbOf(m);
    out.push(`newmtl ${nm}\nKd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}\n`);
    if (pics.has(m?.map?.image)) out.push(`map_Kd ${pics.get(m.map.image).file}\n`);
    if (pics.has(m?.normalMap?.image)) out.push(`norm ${pics.get(m.normalMap.image).file}\n`);
    if (pics.has(m?.alphaMap?.image)) out.push(`map_d ${pics.get(m.alphaMap.image).file}\n`);
    out.push('\n');
  });
  return out.join('');
}
