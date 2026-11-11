// The open document: graph, selection, undo history and the background tree build.
import { NODE_TYPES, defaultParams, socketsOf, clone, kindFits, hasTabs } from '../graph/schema.js';
import { PRESETS, DEFAULT_PRESET } from '../graph/presets.js';
import { migrateGraph } from '../graph/materials.js';

const listeners = new Map();
export const on = (ev, fn) => (listeners.get(ev) || listeners.set(ev, []).get(ev)).push(fn);
export const emit = (ev, data) => { for (const fn of listeners.get(ev) || []) fn(data); };

export const doc = {
  graph: PRESETS[DEFAULT_PRESET](),
  name: 'Broadleaf tree',
  assets: {},
  sel: new Set(),
  link: null,
  result: null,
  stale: false,
  layoutVersion: 0,
};

// ---- History ----
const history = [];
// How many steps Undo can go back; set in Settings, System.
let historyLimit = 80;
export const setHistoryLimit = (n) => { historyLimit = Math.max(5, Math.round(+n) || 80); };
let cursor = -1;
const snap = () => JSON.stringify({ nodes: doc.graph.nodes, links: doc.graph.links, groups: doc.graph.groups, settings: doc.graph.settings, materials: doc.graph.materials, bake: doc.graph.bake, pack: doc.graph.pack });

export function resetHistory() { history.length = 0; history.push(snap()); cursor = 0; }

export function commit() {
  const s = snap();
  if (history[cursor] === s) return;
  history.length = cursor + 1;
  history.push(s);
  // Imported meshes make snapshots large, so history is limited by memory as well as by count.
  let total = history.reduce((sum, h) => sum + h.length, 0);
  while (history.length > 1 && (history.length > historyLimit || total > 80e6)) total -= history.shift().length;
  cursor = history.length - 1;
  scheduleAutosave();
}

function restore(s) {
  Object.assign(doc.graph, JSON.parse(s));
  for (const id of [...doc.sel]) if (!nodeById(id)) doc.sel.delete(id);
  doc.link = null;
  changed({ layout: true });
  emit('selection');
}

export const hasEdits = () => cursor > 0;
export function undo() { if (cursor > 0) restore(history[--cursor]); }
export function redo() { if (cursor < history.length - 1) restore(history[++cursor]); }

// ---- Lookups ----
export const nodeById = (id) => doc.graph.nodes.find((n) => n.id === id);
export const linksOf = (id) => doc.graph.links.filter((l) => l.from === id || l.to === id);
export const isLinked = (id, sock) => doc.graph.links.some((l) => l.to === id && l.toSock === sock);
export const selected = () => [...doc.sel].map(nodeById).filter(Boolean);
export const primary = () => { const s = selected(); return s[s.length - 1] || null; };

let counter = 0;
function freshId(prefix = 'n') {
  const used = new Set([...doc.graph.nodes.map((n) => n.id), ...doc.graph.links.map((l) => l.id), ...(doc.graph.groups || []).map((g) => g.id)]);
  let id;
  do { id = `${prefix}${++counter}`; } while (used.has(id));
  return id;
}

// ---- Editing ----
export function addNode(type, x, y, params = {}) {
  const n = { id: freshId(), type, x, y, on: true, params: { ...defaultParams(type), ...params } };
  doc.graph.nodes.push(n);
  return n;
}

export function removeNodes(ids) {
  const set = new Set(ids);
  doc.graph.nodes = doc.graph.nodes.filter((n) => !set.has(n.id));
  doc.graph.links = doc.graph.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  for (const g of doc.graph.groups || []) g.nodes = g.nodes.filter((id) => !set.has(id));
  doc.graph.groups = (doc.graph.groups || []).filter((g) => g.nodes.length);
  for (const id of ids) doc.sel.delete(id);
}

const reaches = (from, to, seen = new Set()) => {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return doc.graph.links.some((l) => l.from === from && reaches(l.to, to, seen));
};

export const findSocket = (node, key, dir) => {
  const { inputs, outputs } = socketsOf(node);
  return (dir === 'in' ? inputs : outputs).find((s) => s.k === key);
};

// A modifier or component chain has one next step, so those outputs replace rather than add.
const singleOut = (s) => s.kind === 'dir' || s.kind === 'comp';

export function connect(fromId, fromSock, toId, toSock) {
  const a = nodeById(fromId); const b = nodeById(toId);
  if (!a || !b || a === b) return { ok: false, why: 'A node cannot connect to itself.' };
  const out = findSocket(a, fromSock, 'out'); const inp = findSocket(b, toSock, 'in');
  if (!out || !inp) return { ok: false, why: 'That socket no longer exists.' };
  if (!kindFits(out.kind, inp)) return { ok: false, why: 'These sockets carry different things.' };
  if (reaches(toId, fromId)) return { ok: false, why: 'That connection would make a loop.' };
  const g = doc.graph;
  g.links = g.links.filter((l) => {
    if (!inp.multi && l.to === toId && l.toSock === toSock) return false;
    if (singleOut(out) && l.from === fromId && l.fromSock === fromSock) return false;
    return true;
  });
  g.links.push({ id: freshId('l'), from: fromId, fromSock, to: toId, toSock });
  // A connected parent decides how lines are placed, unless a mode that works anywhere was chosen.
  if (toSock === 'parent' && hasTabs(b.type)) {
    const onMesh = a.type !== 'Spline';
    if (onMesh) b.params.place = 'mesh';
    else if (b.params.place === 'point' || b.params.place === 'mesh') b.params.place = 'spline';
    // Children usually leave their parent at an angle, so a child still standing straight starts at 45°.
    if (!onMesh && !+b.params.tilt) b.params.tilt = 45;
  }
  return { ok: true };
}

export function removeLink(id) { doc.graph.links = doc.graph.links.filter((l) => l.id !== id); if (doc.link === id) doc.link = null; }

export function select(ids, mode = 'set') {
  if (mode === 'set') doc.sel = new Set(ids);
  else if (mode === 'add') for (const id of ids) doc.sel.add(id);
  else if (mode === 'toggle') for (const id of ids) { if (doc.sel.has(id)) doc.sel.delete(id); else doc.sel.add(id); }
  doc.link = null;
  emit('selection');
}

// Sets a parameter on the node and on every other selected node of the same type.
export function setParam(node, key, value, { draft = false } = {}) {
  const targets = doc.sel.has(node.id) ? selected().filter((n) => n.type === node.type) : [node];
  for (const n of targets) n.params[key] = clone(value);
  // Switches, choices and textures can show or hide rows on the node itself.
  changed({ draft, layout: key === 'outs' || !(typeof value === 'number' || Array.isArray(value)) });
  emit('params', { node, key });
}

// A value row can belong to the node or to one of its modifiers.
export function setRowValue(node, owner, key, value, { draft = false } = {}) {
  if (owner === node.params) { setParam(node, key, value, { draft }); return; }
  owner[key] = clone(value);
  changed({ draft, layout: !(typeof value === 'number' || Array.isArray(value)) });
}

// Call after any edit: redraws the graph and rebuilds the tree.
export function changed({ draft = false, layout = false, rebuild = true } = {}) {
  if (layout) doc.layoutVersion++;
  emit('graph');
  if (rebuild) regenerate({ draft });
  scheduleAutosave();
}

export function duplicate(ids, dx = 40, dy = 40) {
  const set = new Set(ids);
  const map = new Map();
  for (const n of doc.graph.nodes.filter((x) => set.has(x.id))) {
    const c = { ...clone(n), id: freshId(), x: n.x + dx, y: n.y + dy };
    map.set(n.id, c.id);
    doc.graph.nodes.push(c);
  }
  for (const l of doc.graph.links.filter((x) => set.has(x.from) && set.has(x.to))) {
    doc.graph.links.push({ ...l, id: freshId('l'), from: map.get(l.from), to: map.get(l.to) });
  }
  return [...map.values()];
}

// Adds nodes from another document, giving them fresh ids so nothing collides.
export function mergeNodes(nodes, links, dx = 0, dy = 0) {
  const map = new Map();
  for (const n of nodes) {
    if (!NODE_TYPES[n.type]) continue;
    const c = { ...clone(n), id: freshId(), x: (n.x || 0) + dx, y: (n.y || 0) + dy };
    map.set(n.id, c.id);
    doc.graph.nodes.push(c);
  }
  for (const l of links) {
    if (map.has(l.from) && map.has(l.to)) doc.graph.links.push({ ...l, id: freshId('l'), from: map.get(l.from), to: map.get(l.to) });
  }
  return [...map.values()];
}

export function groupSelected() {
  const ids = [...doc.sel];
  if (!ids.length) return;
  doc.graph.groups ||= [];
  doc.graph.groups.push({ id: freshId('g'), title: 'Group', nodes: ids, color: '#4a8610' });
  changed({ rebuild: false });
  commit();
}

export function loadGraph(graph, name, assets) {
  doc.graph = migrateGraph({ groups: [], settings: {}, materials: [], ...graph });
  // Drop nodes this version doesn't know so an old or edited file still opens.
  doc.graph.nodes = doc.graph.nodes.filter((n) => NODE_TYPES[n.type]);
  for (const n of doc.graph.nodes) n.params = { ...defaultParams(n.type), ...n.params };
  doc.name = name;
  if (assets) doc.assets = assets;
  doc.sel = new Set();
  doc.link = null;
  doc.result = null;
  doc.layoutVersion++;
  resetHistory();
  emit('document');
  emit('selection');
  changed({ layout: true });
}

// ---- Background build ----
let worker = null;
let busy = false;
let pending = null;
let reqId = 0;
let watchdog = 0;

function startWorker() {
  worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    clearTimeout(watchdog);
    busy = false;
    if (e.data.id === reqId) {
      if (e.data.error) { console.error(e.data.error); emit('build-error', e.data.error); }
      else { doc.result = e.data; doc.stale = false; emit('result', e.data); }
    }
    pump();
  };
  worker.onerror = (e) => { console.error(e.message); emit('build-error', e.message); restartWorker(); };
}

function restartWorker() {
  clearTimeout(watchdog);
  worker?.terminate();
  busy = false;
  startWorker();
  pump();
}

function pump() {
  if (busy || !pending) return;
  const opts = pending;
  pending = null;
  busy = true;
  emit('build-start');
  worker.postMessage({ id: ++reqId, graph: doc.graph, opts });
  // A runaway graph must not freeze the editor: give up on it and carry on.
  watchdog = setTimeout(() => { emit('build-error', 'That graph took too long to build, so the build was stopped. Lower the density or count.'); restartWorker(); }, 45000);
}

export function regenerate({ draft = false, force = false } = {}) {
  if (doc.graph.settings?.manual && !force) { doc.stale = true; emit('stale'); return; }
  if (!worker) startWorker();
  pending = { draft };
  pump();
}

// ---- Autosave ----
let autosaveTimer = 0;
let autosaver = null;
export const setAutosaver = (fn) => { autosaver = fn; };
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosaver?.(), 800);
}
