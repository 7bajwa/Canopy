// Files: documents, node sets, exports, and the automatic save in the browser.
import { Vector3 } from 'three';
import { doc } from './doc.js';
import { parseObj } from '../engine/shapes.js';
import { zipStore, unzip } from './zip.js';

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const downloadText = (name, text) => download(name, new Blob([text], { type: 'application/json' }));

export const safeName = (s) => (s || 'plant').replace(/[^\w\- ]+/g, '').trim() || 'plant';

export const documentText = () => JSON.stringify({ app: 'canopy', version: 1, name: doc.name, graph: doc.graph, assets: doc.assets });

// Saving: by default one .canopy file with every picture packed inside it. With textures "beside the file" it is a
// .zip holding the .canopy and a textures folder the .canopy points at (open the zip to get it all back).
export function saveDocument(textures = 'embed') {
  const name = safeName(doc.name);
  if (textures !== 'folder') { download(`${name}.canopy`, new Blob([documentText()], { type: 'application/json' })); return; }
  const { text, files } = documentPackage();
  download(`${name}.zip`, new Blob([zipStore([{ name: `${name}.canopy`, data: text }, ...files])], { type: 'application/zip' }));
}

// The document with its pictures moved out into files: assets keep their name and point at textures/<file>.
export function documentPackage() {
  const files = []; const assets = {};
  const used = new Set();
  for (const [id, a] of Object.entries(doc.assets || {})) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(a?.url || '');
    if (!m) { assets[id] = a; continue; }
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[m[1]] || 'bin';
    let file = `textures/${safeName((a.name || id).replace(/\.\w+$/, ''))}.${ext}`;
    for (let k = 2; used.has(file); k++) file = file.replace(/(-\d+)?\.(\w+)$/, `-${k}.$2`);
    used.add(file);
    files.push({ name: file, data: m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3])) });
    assets[id] = { name: a.name, file, type: m[1] };
  }
  return { text: JSON.stringify({ app: 'canopy', version: 1, name: doc.name, graph: doc.graph, assets }), files };
}

// A picked file as a document: a .canopy, or a .zip made by Save with textures beside it (pictures packed back in).
export async function readDocumentFile(f) {
  if (!/\.zip$/i.test(f.name)) return parseDocument(await f.text());
  const entries = await unzip(await f.arrayBuffer());
  const main = entries.find((e) => /\.canopy$/i.test(e.name));
  if (!main) throw new Error('That zip has no .canopy file in it.');
  const d = parseDocument(new TextDecoder().decode(main.data));
  for (const a of Object.values(d.assets || {})) {
    if (!a?.file) continue;
    const e = entries.find((x) => x.name === a.file);
    if (!e) continue;
    let bin = ''; for (let i = 0; i < e.data.length; i += 0x8000) bin += String.fromCharCode(...e.data.subarray(i, i + 0x8000));
    a.url = `data:${a.type || 'image/png'};base64,${btoa(bin)}`;
    delete a.file; delete a.type;
  }
  return d;
}

export function saveNodes(nodes, links) {
  const ids = new Set(nodes.map((n) => n.id));
  const data = { app: 'canopy', version: 1, name: doc.name, nodes, links: links.filter((l) => ids.has(l.from) && ids.has(l.to)), assets: doc.assets };
  download(`${safeName(doc.name)}-nodes.canopy`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}

// Files come from outside, so check the shape before anything reaches the editor.
export function parseDocument(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a Canopy document.'); }
  const nodes = data?.graph?.nodes || data?.nodes;
  const links = data?.graph?.links || data?.links;
  if (!Array.isArray(nodes) || !Array.isArray(links)) throw new Error('That file is not a Canopy document.');
  for (const n of nodes) {
    if (typeof n?.id !== 'string' || typeof n?.type !== 'string' || typeof n?.params !== 'object') throw new Error('That file has a damaged node.');
  }
  return data;
}

// A file from the app's samples folder. The PC app opens its pages from disk, where fetch can't reach, so it reads
// them through its own host.
export async function readSample(name) {
  if (window.canopyApp?.readSample) return window.canopyApp.readSample(name);
  const r = await fetch(`./samples/${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`${name} is missing`);
  return r.text();
}

export const pickFile = (accept) => new Promise((resolve) => {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = accept;
  i.addEventListener('change', () => resolve(i.files[0] || null));
  i.click();
});

export const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('That file could not be read.'));
  r.readAsDataURL(file);
});

export const downloadImage = async (dataUrl) => download(`${safeName(doc.name)}.png`, await (await fetch(dataUrl)).blob());

// A mesh file as flat vertex and triangle lists, the form scene objects keep. Files are untrusted, so failures say what happened.
export async function importMesh(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['obj', 'glb', 'gltf', 'fbx'].includes(ext)) throw new Error('Choose an OBJ, FBX, GLB or glTF file.');
  let mesh;
  try {
    if (ext === 'obj') mesh = parseObj(await file.text());
    else if (ext === 'glb' || ext === 'gltf') {
      const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/loaders/DRACOLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      // Many downloaded models are compressed (Draco or Meshopt); the decoders ship with the app.
      const draco = new DRACOLoader().setDecoderPath('./draco/');
      const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
      // glTF measures in meters and the editor in centimeters; its pictures aren't flipped, so V turns over.
      try { mesh = flatten((await loader.parseAsync(ext === 'glb' ? await file.arrayBuffer() : await file.text(), '')).scene, 100, true); } finally { draco.dispose(); }
    } else {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      const root = new FBXLoader().parse(await file.arrayBuffer(), '');
      // FBX files say their own unit (UnitScaleFactor is centimeters per unit); the editor works in centimeters.
      mesh = flatten(root, fbxUnit(root));
    }
  } catch (e) {
    console.warn(e);
    throw new Error(`${file.name} could not be read as a ${ext.toUpperCase()} mesh${e?.message ? `: ${e.message}` : '.'}`);
  }
  if (!mesh.v.length || !mesh.idx.length) throw new Error('That file has no mesh in it.');
  if (mesh.v.some((x) => !Number.isFinite(x))) throw new Error('That mesh has damaged points.');
  return mesh;
}

const fbxUnit = (root) => { const u = +root.userData?.unitScaleFactor; return Number.isFinite(u) && u > 0 ? u : 1; };

// Every mesh in a loaded scene as one: points, triangles, UVs, and the first color picture found (as an image URL).
function flatten(root, scale, flipV = false) {
  const v = []; const idx = []; const uv = [];
  let anyUv = false; let texture = null;
  const p = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const base = v.length / 3;
    const tex = o.geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      v.push(p.x * scale, p.y * scale, p.z * scale);
      uv.push(tex ? tex.getX(i) : 0, tex ? (flipV ? 1 - tex.getY(i) : tex.getY(i)) : 0);
    }
    if (tex) anyUv = true;
    const list = o.geometry.getIndex();
    const count = list ? list.count : pos.count;
    for (let i = 0; i < count; i++) idx.push(base + (list ? list.getX(i) : i));
    const image = [o.material].flat()[0]?.map?.image;
    if (!texture && image?.width) {
      const c = document.createElement('canvas');
      c.width = image.width; c.height = image.height;
      c.getContext('2d').drawImage(image, 0, 0);
      texture = c.toDataURL('image/png');
    }
  });
  return anyUv ? { v, idx, uv, texture } : { v, idx, texture };
}

// ---- Automatic save ----
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('canopy', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('docs');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function autosave() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction('docs', 'readwrite');
    t.objectStore('docs').put({ name: doc.name, graph: JSON.parse(JSON.stringify(doc.graph)), assets: doc.assets }, 'current');
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  db.close();
}

// The browser keeps the last dozen backups next to the automatic save.
export async function storeBackup(name, when, text) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction('docs', 'readwrite');
    const store = t.objectStore('docs');
    store.put({ name, when, text }, `backup:${when}`);
    const keys = store.getAllKeys();
    keys.onsuccess = () => { const old = keys.result.filter((k) => String(k).startsWith('backup:')).sort(); for (const k of old.slice(0, Math.max(0, old.length - 12))) store.delete(k); };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  db.close();
}

export async function loadAutosave() {
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    const r = db.transaction('docs').objectStore('docs').get('current');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return value;
}
