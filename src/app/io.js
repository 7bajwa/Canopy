// Files: documents, node sets, exports, and the automatic save in the browser.
import { Vector3 } from 'three';
import { doc } from './doc.js';
import { parseObj } from '../engine/shapes.js';

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

export function saveDocument() {
  download(`${safeName(doc.name)}.canopy`, new Blob([documentText()], { type: 'application/json' }));
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
