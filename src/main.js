// Starts the editor: connects the graph, the 3D view, the panels and the files.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import './style.css';
import { doc, on, loadGraph, resetHistory, regenerate, commit, undo, redo, setAutosaver, groupSelected, changed, addNode, connect, select, selected, primary, mergeNodes, hasEdits, removeNodes, duplicate, emit, setHistoryLimit, nodeById } from './app/doc.js';
import { NODE_TYPES, socketsOf, kindFits, clone, defaultParams } from './graph/schema.js';
import { makeApi, startBridge, stopBridge } from './app/aibridge.js';
import { PRESETS, DEFAULT_PRESET } from './graph/presets.js';
import { GraphView, setTextScale, NODE_W, setGraphPalette } from './app/graphview.js';
import { Viewport } from './app/viewport.js';
import { attachInput } from './app/input.js';
import { AtlasEditor, ensureCutouts } from './app/atlas.js';
import { makeEditors } from './app/nodeedit.js';
import { MaterialEditor } from './app/matedit.js';
import { BakePanel } from './app/bakeui.js';
import { ViewGizmo } from './app/gizmo.js';
import { takeOverColorInputs } from './app/colorpop.js';
import { XfGizmo } from './app/xfgizmo.js';
import { TexturePacker } from './app/pack.js';
import { materialOf, newMaterial } from './graph/materials.js';
import { openSettings } from './app/settings.js';
import { openExport } from './app/exportdlg.js';
import { makeSeedPresets } from './app/seedpresets.js';
import { makeRender } from './app/renderui.js';
import { makeScanBake } from './app/scanbake.js';
import { makeLife } from './app/lifeui.js';
import { applyTheme, themeOf } from './app/themes.js';
import { WIND_PRESETS } from './graph/defs-unified.js';
import { dockAt } from './app/dock.js';
import { saveDocument, readDocumentFile, saveNodes, parseDocument, pickFile, readDataUrl, importMesh, downloadImage, autosave, loadAutosave, documentText, downloadText, safeName, storeBackup } from './app/io.js';
import { makeBackups } from './app/backup.js';
import { setUnits } from './app/units.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const graph = new GraphView($('#graph'));
const view = new Viewport($('#view'));

const PREFS_KEY = 'canopy-prefs';
function storedPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
const prefs = { shadows: view.renderer.shadowMap.enabled, snap: false, graphDim: 1, layout: 'overlay', ui: 1, text: 1, varShow: 'icon', fadeOn: true, fadeStrength: 0.85, fadeSize: 1.25, exposure: 1, envLight: 0.55, navAt: 'middle', units: 'metric', windMin: 0, windMax: 10, gustFreq: 6, windSpeed: 1, windDir: 20, scaleShow: 'both', backupMin: 5, undoSteps: 80, shading: 'pbr', theme: 'forest', grid: true, gizmo: true,
  focus: 'auto', splitAt: 0.5, toolGroups: {}, wireColor: '#000000', wireOpacity: 0.35, dials: true, dialSize: 48, gizmoSize: 96, sunYaw: 38, navY2d: null, navY3d: null,
  texturesInFile: 'embed', renderSize: 2048, renderHeight: null, renderCamera: 'frame', renderGrid: false, renderPost: {}, glow: false, renderFigure: false, renderGround: true, renderBg: 'clear', renderBgColor: '#11160f', backupOn: true, aiBridge: false,
  groundOn: true, groundColor: '#3a4a30', groundOpacity: 0.35, groundSize: 200, groundGrid: true, groundShadow: true, swapViews: false, barAt: 'top', navWall2d: null, navWall3d: null, customThemes: {}, ...storedPrefs() };
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
// Pictures were square before height had its own setting.
prefs.renderHeight ??= prefs.renderSize;
// Once, for this version: the new starting look (no graph grid, snapping on, no glow, a folded toolbar, a smaller ground).
if (!prefs.seen39) Object.assign(prefs, { grid: false, snap: true, glow: false, toolGroups: {}, groundSize: 200, seen39: true });

// ---- Messages ----
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- Popups ----
const popup = $('#popup');
function closePopups() { popup.hidden = true; popup.onkeydown = null; popup.replaceChildren(); popup.classList.remove('wide-pop'); }

// The popup lives inside the stage, whose handlers would otherwise swallow its presses and scrolling.
for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'contextmenu']) {
  popup.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); });
}
document.addEventListener('pointerdown', (e) => {
  if (popup.hidden || popup.contains(e.target)) return;
  // Blur first so a number being typed is kept rather than lost.
  if (popup.contains(document.activeElement)) document.activeElement.blur();
  closePopups();
}, true);

function placePopup(p) {
  const r = stage.getBoundingClientRect();
  popup.hidden = false;
  const b = popup.getBoundingClientRect();
  // Offsets are in the popup's own scale, which follows the UI scale setting.
  const x = p.back ? p.x - b.width : p.x; const y = p.up ? p.y - b.height : p.y;
  popup.style.left = `${Math.max(6, Math.min(r.width - b.width - 6, x)) / prefs.ui}px`;
  popup.style.top = `${Math.max(6, Math.min(r.height - b.height - 6, y)) / prefs.ui}px`;
}

// A plain list: { label, fn }, { head } for a heading, { sep: true } for a dividing line.
function menu(p, items) {
  popup.replaceChildren();
  popup.classList.remove('add');
  for (const it of items) {
    if (it.sep) { popup.append(document.createElement('hr')); continue; }
    if (it.head) {
      const h = document.createElement('h4');
      h.textContent = it.head;
      popup.append(h);
      continue;
    }
    const b = document.createElement('button');
    b.className = it.on ? 'menu-item on' : 'menu-item';
    b.textContent = it.label;
    if (it.on) b.setAttribute('aria-pressed', 'true');
    if (it.title) b.title = it.title;
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => { closePopups(); it.fn(); });
    popup.append(b);
  }
  placePopup(p);
}

// Under a toolbar button, at the top of the stage.
// Menus open just under their button, below the floating bar. A button folded into a compact group opens from that group's button.
let menuAnchor = null;
// A screen taller than wide (a tablet turned upright) stacks the tree above the graph, with the toolbar at the bottom.
const isPortrait = () => stage.clientHeight > stage.clientWidth * 1.05;
const barSide = () => (isPortrait() ? 'bottom' : prefs.barAt || 'top');
const under = (btn) => {
  const a = btn.offsetParent ? btn : menuAnchor || btn;
  const r = a.getBoundingClientRect(); const s = stage.getBoundingClientRect();
  const at = barSide();
  if (at === 'bottom') return { x: r.left - s.left, y: r.top - s.top - 6, up: true };
  if (at === 'left') return { x: r.right - s.left + 6, y: r.top - s.top };
  if (at === 'right') return { x: r.left - s.left - 6, y: r.top - s.top, back: true };
  return { x: r.left - s.left, y: r.bottom - s.top + 6 };
};

// ---- Tooltips ----
const tip = $('#tip');
let tipKey = '';
let tipTimer = 0;
function hoverTip(info, p) {
  const key = info ? info.title + info.text : '';
  if (key === tipKey) return;
  tipKey = key;
  clearTimeout(tipTimer);
  tip.hidden = true;
  if (!info) return;
  tipTimer = setTimeout(() => {
    tip.replaceChildren();
    const b = document.createElement('b');
    b.textContent = info.title;
    tip.append(b);
    if (info.text) tip.append(document.createElement('br'), info.text);
    tip.hidden = false;
    const r = stage.getBoundingClientRect(); const t = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(r.width - t.width - 8, p.x + 14)) / prefs.ui}px`;
    tip.style.top = `${Math.max(4, Math.min(r.height - t.height - 8, p.y + 18)) / prefs.ui}px`;
  }, 3000);
}
stage.addEventListener('pointerleave', () => hoverTip(null));

function addMenu(p, wire = null) {
  const plugs = (s) => (wire.dir === 'out' ? kindFits(wire.kind, s) : kindFits(s.kind, wire.sock));
  const place = (type) => {
    const w = graph.toWorld(p.x, p.y);
    const n = newNode(type, w.x, w.y);
    if (type === 'Spline' && !wire) n.params.blendOffset = 0;
    if (wire) {
      const { inputs, outputs } = socketsOf(n);
      const s = (wire.dir === 'out' ? inputs : outputs).find(plugs);
      if (s) { if (wire.dir === 'out') connect(wire.node.id, wire.sock.k, n.id, s.k); else connect(n.id, s.k, wire.node.id, wire.sock.k); }
    }
    settleNew(n);
  };
  const item = (type) => ({ label: NODE_TYPES[type].title, title: NODE_TYPES[type].desc, fn: () => place(type) });
  // Value and Curve still open from older files; new ones come from a value's own variation and curve icons.
  menu(p, [item('Spline'), item('Mesh'), { sep: true }, item('Mix')]);
}

const newNode = (type, x, y) => {
  const n = addNode(type, x, y);
  // Tabs start with the first one open, so the settings of a new node are one glance away.
  if (NODE_TYPES[type].tabs) n.tab = type === 'Mesh' ? 'shape' : 'spline';
  return n;
};
const settleNew = (n) => {
  select([n.id]);
  ensureCutouts(doc.graph).finally(() => { changed({ layout: true }); commit(); });
};

// From the toolbar: onto the selected node when there is one, otherwise on its own.
function addFromBar(type) {
  const parent = primary();
  const r = stage.getBoundingClientRect();
  if (!parent) {
    const w = graph.toWorld(r.width * 0.25, r.height * 0.3);
    const n = newNode(type, w.x, w.y);
    // A Spline on its own is a trunk: its blend into the floor spreads evenly.
    if (type === 'Spline') n.params.blendOffset = 0;
    settleNew(n);
    return;
  }
  const siblings = doc.graph.links.filter((l) => l.from === parent.id).length;
  const n = newNode(type, parent.x + NODE_W + 110, parent.y + siblings * 70);
  connect(parent.id, 'children', n.id, 'parent');
  settleNew(n);
}

// A value's own menu: show its sockets, copy, paste and reset. On a value's variation or curve icon the same
// items work on that instead.
let clip = null;
function paramMenu(p, node, row, zone) {
  const { param, owner } = row;
  const k = param.k;
  const done = () => { changed({ layout: true }); commit(); };
  if (zone === 'var' || zone === 'curve') {
    const what = zone === 'var' ? 'variation' : 'curve';
    const key = zone === 'var' ? 'vary' : 'curves';
    const put = (v) => { owner[key] = { ...owner[key] }; if (v === undefined) delete owner[key][k]; else owner[key][k] = clone(v); done(); };
    menu(p, [
      { label: `Copy ${what}`, fn: () => { clip = { what, v: clone(owner[key]?.[k]) }; } },
      { label: `Paste ${what}`, disabled: clip?.what !== what, fn: () => put(clip.v) },
      { label: `Reset ${what}`, fn: () => put(undefined) },
    ]);
    return;
  }
  const exposed = node.exposed || [];
  const on = exposed.includes(k);
  const items = [];
  if (param.t === 'num' && owner === node.params) {
    items.push({
      label: on ? 'Hide its sockets' : 'Expose (show sockets)',
      title: 'An input on the left to drive this value from another node, and an output on the right to pass it on.',
      fn: () => {
        node.exposed = on ? exposed.filter((x) => x !== k) : [...exposed, k];
        // Wires to sockets that are gone go too; a value that always has its input keeps it.
        if (on) doc.graph.links = doc.graph.links.filter((l) => !((l.from === node.id && l.fromSock === `o:${k}`) || (!param.sock && l.to === node.id && l.toSock === `p:${k}`)));
        done();
      },
    }, { sep: true });
  }
  items.push(
    { label: 'Copy value', fn: () => { clip = { what: 'value', t: param.t, v: clone(owner[k]) }; } },
    { label: 'Paste value', disabled: !(clip?.what === 'value' && clip.t === param.t), fn: () => { owner[k] = clone(clip.v); done(); } },
    { label: 'Reset to default', fn: () => { owner[k] = clone(param.d); done(); } },
  );
  menu(p, items);
}

function nodeMenu(p, node) {
  if (!doc.sel.has(node.id)) select([node.id]);
  menu(p, [
    { label: 'Rename', fn: () => ui.edit.rename(p, node) },
    { label: 'Frame in graph', fn: () => graph.frameNodes(selected(), graphRegion(), false, 1.25) },
    { label: 'Frame in 3D view', fn: () => { const b = view.boxOf([...doc.sel]); if (b) view.frameBox(b); else toast('This node has nothing in the 3D view yet.'); } },
    { label: node.on === false ? 'Turn on' : 'Turn off', fn: () => { for (const n of selected()) n.on = n.on === false; changed(); commit(); } },
    { label: 'Duplicate', fn: () => { select(duplicate([...doc.sel])); changed({ layout: true }); commit(); } },
    { label: 'Group', fn: groupSelected },
    { label: 'Save selected nodes…', fn: () => saveNodes(selected(), doc.graph.links) },
    { sep: true },
    { label: 'Delete', fn: () => { removeNodes([...doc.sel]); emit('selection'); changed({ layout: true }); commit(); } },
  ]);
}

// ---- Layout ----
const LAYOUTS = ['overlay', 'split', 'tree', 'graph'];
const READABLE_ZOOM = 0.45;
const NAV_W = 40;

let bake = null;
const gizmoEl = $('#gizmo');

function layout() {
  const r = stage.getBoundingClientRect();
  // Baking takes the whole stage for the 3D view, beside its panel.
  if (bake?.isOpen()) {
    // The panel starts under the top bar, so the bar's buttons stay in reach.
    const panel = $('#bake');
    panel.style.top = `${$('#bar').getBoundingClientRect().bottom / (+getComputedStyle(document.documentElement).getPropertyValue('--ui') || 1) + 6}px`;
    const pw = panel.getBoundingClientRect().width;
    stage.dataset.layout = 'tree';
    input?.setLayout('tree');
    graph.resize(0, 0, r.width, r.height);
    view.resize(0, 0, r.width - pw, r.height, 0);
    $('#nav3d').style.right = `${pw + 8}px`;
    placeGizmo();
    bake.placeFrame();
    return;
  }
  $('#nav3d').style.right = '';
  const free = r.width;
  const mode = prefs.layout;
  stage.dataset.layout = mode;
  input?.setLayout(mode);
  const portrait = isPortrait();
  // Turning the screen moves the graph's area, so the nodes are framed again in their new place.
  if (stage.hasAttribute('data-portrait') !== portrait && doc.graph.nodes.length) requestAnimationFrame(() => graph.frameNodes(doc.graph.nodes, graphRegion(), true, 0.9, READABLE_ZOOM));
  stage.toggleAttribute('data-portrait', portrait);
  if (document.body.dataset.bar !== barSide()) applyBar();
  const swap = !!prefs.swapViews && !portrait;
  const split = $('#splitter');
  if (portrait) {
    const top = mode === 'split' ? Math.round(r.height * prefs.splitAt) : r.height;
    if (mode === 'split') { view.resize(0, 0, free, top, 0); graph.resize(0, top, free, r.height - top); } else {
      graph.resize(0, 0, free, r.height);
      // Over the graph, the tree sits in the upper part, clear of the nodes below.
      view.resize(0, 0, free, r.height, 0, mode === 'overlay' ? -r.height * 0.22 : 0);
    }
    split.style.left = ''; split.style.top = `${top - 4}px`;
  } else if (mode === 'split') {
    const half = Math.round(free * prefs.splitAt);
    if (swap) { graph.resize(free - half, 0, half, r.height); view.resize(0, 0, free - half, r.height, 0); } else { graph.resize(0, 0, half, r.height); view.resize(half, 0, free - half, r.height, 0); }
  } else {
    graph.resize(0, 0, r.width, r.height);
    const bias = mode === 'overlay' && free > 700 ? (swap ? free * 0.32 : free * 0.68) - r.width / 2 : free / 2 - r.width / 2;
    view.resize(0, 0, r.width, r.height, bias);
  }
  for (const b of document.querySelectorAll('[data-layout-btn]')) b.setAttribute('aria-pressed', b.dataset.layoutBtn === mode);
  split.hidden = mode !== 'split';
  if (!portrait) { split.style.top = ''; split.style.left = `${Math.round(free * (swap ? 1 - prefs.splitAt : prefs.splitAt)) - 4}px`; }
  placeGizmo();
  placeNavs();
}

function placeGizmo() {
  const v = view.rect;
  gizmoEl.hidden = !prefs.gizmo || stage.dataset.layout === 'graph' || v.w < 260;
  // Clear of the 3D view's navigation icons on the right edge, and below the floating toolbar.
  const bar = $('#bar').getBoundingClientRect(); const s = stage.getBoundingClientRect();
  const below = barSide() === 'top' ? Math.max(0, bar.bottom - s.top) : 0;
  const onLeft = !!prefs.swapViews && !isPortrait();
  // In the 3D view's top corner, clear of a toolbar docked on that side.
  const x = onLeft ? v.x + 10 + (barSide() === 'left' ? bar.width + 6 : 0) : v.x + v.w - prefs.gizmoSize - 10 - (barSide() === 'right' ? bar.width + 6 : 0);
  Object.assign(gizmoEl.style, { left: `${x}px`, top: `${v.y + below + 10}px` });
  placeDials();
}

// Fits the graph into the part of the stage the tree isn't using.
function graphRegion() {
  const r = stage.getBoundingClientRect();
  const free = r.width;
  // The left edge stays clear of the graph's navigation icons.
  const swap = !!prefs.swapViews;
  if (isPortrait()) {
    // In the graph's own coordinates: in Split its canvas already starts below the tree.
    const top = prefs.layout === 'overlay' ? r.height * 0.5 : 0;
    const h = (prefs.layout === 'split' ? r.height * (1 - prefs.splitAt) : r.height) - top - 56;
    return { x: NAV_W, y: top, w: free - NAV_W, h };
  }
  // A top bar floating over the stage covers its first rows, so the graph starts below it.
  const bar = $('#bar').getBoundingClientRect();
  const top = prefs.barAt === 'top' || !prefs.barAt ? Math.max(0, bar.bottom - r.top) : 0;
  const h = r.height - top;
  if (prefs.layout === 'overlay' && free > 700) return swap ? { x: free * 0.5, y: top, w: free * 0.5 - NAV_W, h } : { x: NAV_W, y: top, w: free * 0.5 - NAV_W, h };
  if (prefs.layout === 'split') return swap ? { x: free * (1 - prefs.splitAt), y: top, w: free * prefs.splitAt - NAV_W, h } : { x: NAV_W, y: top, w: free * prefs.splitAt - NAV_W, h };
  return { x: NAV_W, y: top, w: free - NAV_W, h };
}

function setLayout(mode) {
  prefs.layout = mode;
  savePrefs();
  layout();
  graph.frameNodes(doc.graph.nodes, graphRegion(), true, 0.9, READABLE_ZOOM);
}

// ---- Parts ----
const xfGizmo = new XfGizmo(view);
const life = makeLife();
const scanBake = makeScanBake({ view, toast: (m, ms) => toast(m, ms) });
const renderer = makeRender({ view, prefs, setPref: (k, v) => setPref(k, v), toast: (m) => toast(m), download: (u) => downloadImage(u), hide: () => [xfGizmo.helper] });
const ui = {
  gizmo: xfGizmo,
  // The Draw tool's first stroke: a new Spline under the node it was drawn on (or on its own), drawn as a thin tube.
  // A drawn spline. With a picked node as the style, it is a sibling of that node: same mesh, materials, modifiers
  // and look, growing from the same parent, and every child of the picked node grows on it too (children take
  // several parents). Without one it is a plain spline under parentId.
  drawnSpline(parentId, stroke, styleId = null) {
    const parent = parentId && doc.graph.nodes.find((x) => x.id === parentId);
    const style = styleId && doc.graph.nodes.find((x) => x.id === styleId && x.type === 'Spline');
    const n = newNode('Spline', (style?.x ?? parent?.x ?? 0) + (style ? 30 : NODE_W + 110), (style?.y ?? parent?.y ?? 0) + 70);
    if (style) {
      const { strokes, inst, ...look } = structuredClone(style.params);
      Object.assign(n.params, look, { strokes: [stroke] });
      n.name = `${style.name} (drawn)`;
    } else {
      Object.assign(n.params, { strokes: [stroke], radius: parent ? Math.max(0.5, (+parent.params.radius || 4) * 0.4) : 4, blendOffset: parent ? 0.5 : 0 });
      // The bark of what it grows on (a tube's own material when that has leaves too).
      if (parent?.type === 'Spline') n.params.material = parent.params.tubeMaterial || parent.params.material;
      n.name = 'Drawn';
    }
    if (parent) connect(parent.id, 'children', n.id, 'parent');
    if (style) for (const l of doc.graph.links.filter((x) => x.from === style.id && x.fromSock === 'children')) connect(n.id, 'children', l.to, l.toSock);
    settleNew(n);
    return n;
  },
  onDrawStop() { press('pen', false); },
  status(zone) { $('#zone').textContent = zone === 'tree' ? 'Over the tree: scroll zooms the tree, right-drag pans it, middle-drag orbits' : 'Over the graph: scroll zooms the graph, right-drag pans it, middle-drag orbits the tree'; },
  addMenu, nodeMenu, paramMenu, menu, toast, graphRegion, hoverTip,
  edit: makeEditors({ popup, placePopup, closePopups, menu, toast }),
  action: (act, node, p) => {
    if (act === 'mateditor') matEditor.open(node.params.material);
    if (act === 'windpreset') {
      menu(p || { x: 200, y: 200 }, Object.entries(WIND_PRESETS).map(([name, v]) => ({ label: name, fn: () => { Object.assign(node.params, structuredClone(v)); changed({ layout: true }); commit(); toast(`Wind set for ${name}.`); } })));
      return;
    }
    if (act !== 'atlas') return;
    const m = materialOf(doc.graph, node);
    if (!m?.texture) { toast('Pick a material with a leaf texture first, on the Material tab.'); return; }
    editCutouts(m);
  },
  openMaterials: (id) => matEditor.open(id),
  modalOpen: () => atlas.isOpen() || !settingsEl.hidden || matEditor.isOpen() || packer.isOpen(),
  save: () => saveDocument(prefs.texturesInFile),
  cycleLayout: () => setLayout(LAYOUTS[(LAYOUTS.indexOf(prefs.layout) + 1) % LAYOUTS.length]),
  setMode,
};

const input = attachInput(stage, graph, view, ui);
for (const b of document.querySelectorAll('[data-xf-scope]')) b.addEventListener('click', () => { xfGizmo.setScope(b.dataset.xfScope); for (const o of document.querySelectorAll('[data-xf-scope]')) o.setAttribute('aria-pressed', o === b); });
document.querySelector('[data-xf-reset]')?.addEventListener('click', () => { if (!xfGizmo.resetCopy()) toast('Click a copy in the 3D view first; it has no edit of its own yet.'); });
for (const b of document.querySelectorAll('[data-xf]')) b.addEventListener('click', () => { xfGizmo.setMode(b.dataset.xf); for (const o of document.querySelectorAll('[data-xf]')) o.setAttribute('aria-pressed', o === b); });
// For touch screens, where there is no Delete key.
$('[data-xf-remove]').addEventListener('click', () => input.removeSelection());
const seedPresets = makeSeedPresets({ view, toast, thumb: () => renderer.image({ thumb: true }), exportBatch: (items, each) => openExport(view, toast, { items, each }) });
// Color boxes everywhere open the app's own color popup beside them.
takeOverColorInputs();
const canopy = { doc, graph, view, xf: xfGizmo, rebuild: () => changed({ layout: true }) }; // lets automated checks and the console read and rebuild the editor's state
window.canopy = canopy;

async function addImage(file) {
  const id = `img:${Date.now().toString(36)}`;
  doc.assets[id] = { name: file.name, url: await readDataUrl(file) };
  return id;
}

const atlas = new AtlasEditor($('#atlas'), {
  toast,
  onClose: () => matEditor.dock(false),
  onMaterial: (m) => { if (matEditor.isOpen()) matEditor.open(m.id); },
});
// The cutout editor opens beside the material editor, both on the same material.
const editCutouts = (m) => { matEditor.open(m.id); matEditor.dock(true); atlas.open(m); };
const matEditor = new MaterialEditor($('#materials'), {
  toast,
  editCutouts: (m) => editCutouts(m),
});
canopy.atlas = atlas;
const gizmo = new ViewGizmo(gizmoEl, view);
bake = new BakePanel($('#bake'), $('#bake-frame'), {
  view, toast,
  enter: (on) => { view.setOrtho(on); stage.toggleAttribute('data-bake', on); layout(); },
});
view.onCamera = () => { gizmo.draw(); bake.viewMoved(); };
const packer = new TexturePacker($('#packer'), {
  toast,
  editShape: (matId, cutId) => { const m = doc.graph.materials?.find((x) => x.id === matId); if (!m) return; matEditor.open(m.id); matEditor.dock(true); atlas.openOn(m, cutId); },
});
Object.assign(canopy, { bake, packer });

// ---- Settings ----
function applyPref(k) {
  const v = prefs[k];
  const root = document.documentElement.style;
  if (k === 'shadows') view.setShadows(v);
  if (k === 'snap') graph.snap = v;
  if (k === 'graphDim') stage.style.setProperty('--graph-dim', v);
  if (k === 'ui') root.setProperty('--ui', v);
  if (k === 'text') { root.setProperty('--text', v); setTextScale(v); graph.invalidate(); }
  if (k === 'navAt') stage.dataset.nav = v;
  if (k === 'theme' || k === 'customThemes') { setGraphPalette(applyTheme(themeOf(prefs))); doc.layoutVersion++; graph.invalidate(); placeDials(); }
  if (k === 'grid') { graph.showGrid = v; graph.invalidate(); }
  if (k === 'glow') stage.dataset.glow = v ? 'on' : 'off';
  if (k === 'gizmo') placeGizmo();
  if (k === 'units') { setUnits(v); doc.layoutVersion++; graph.invalidate(); showScale(); }
  if (k === 'scaleShow') showScale();
  if (k === 'windMin' || k === 'windMax' || k === 'gustFreq' || k === 'windSpeed' || k === 'windDir') applyGust();
  if (k === 'backupMin') backups.setInterval(v);
  if (k === 'undoSteps') setHistoryLimit(v);
  if (k === 'varShow') { graph.varBox = v === 'box'; doc.layoutVersion++; graph.invalidate(); }
  if (k === 'fadeStrength') stage.style.setProperty('--fade', v);
  if (k === 'exposure' || k === 'envLight') view.setLook(prefs.exposure, prefs.envLight);
  if (k === 'fadeOn' || k === 'fadeSize') placeFade();
  if (k === 'ui' || k === 'layout' || k === 'splitAt') layout();
  if (k === 'focus') applyFocus();
  if (k === 'toolGroups' || k === 'toolHidden' || k === 'groupLast') applyToolbar();
  if (k === 'wireColor' || k === 'wireOpacity') view.setWireLook(prefs.wireColor, prefs.wireOpacity);
  if (k === 'gizmoSize') { gizmo.resize(v); placeGizmo(); }
  if (k === 'dials' || k === 'dialSize' || k === 'windDir') placeDials();
  if (k === 'sunYaw') { view.setSunYaw(v); placeDials(); }
  if (k === 'navY2d' || k === 'navY3d' || k === 'navWall2d' || k === 'navWall3d') placeNavs();
  if (k === 'barAt') applyBar();
  if (k === 'swapViews') { layout(); graph.frameNodes(doc.graph.nodes, graphRegion(), true, 0.9, READABLE_ZOOM); }
  if (k.startsWith('ground')) view.setGround({ on: prefs.groundOn, color: prefs.groundColor, opacity: prefs.groundOpacity, size: prefs.groundSize, shadow: prefs.groundShadow, grid: prefs.groundGrid });
  if (k === 'aiBridge') { if (v) startBridge(aiApi()); else stopBridge(); }
  if (k === 'backupOn') { if (v) startQuietBackups(); else { backups.stop(); press('backup', false); } }
}
function setPref(k, v) { prefs[k] = v; savePrefs(); applyPref(k); }
const applyGust = () => view.setGust({ min: prefs.windMin, max: prefs.windMax, freq: prefs.gustFreq, speed: prefs.windSpeed, dir: prefs.windDir });
let scaleOn = false;
const showScale = () => view.setScale(scaleOn ? prefs.scaleShow : 'off', prefs.units);

// The graph fades out around the plant so branches stay readable over it.
const fade = $('#fade');
function placeFade() {
  const b = prefs.fadeOn && prefs.layout === 'overlay' ? view.plantScreen() : null;
  fade.hidden = !b;
  if (!b) return;
  const rx = Math.max(60, ((b.x1 - b.x0) / 2) * prefs.fadeSize * 1.3);
  const ry = Math.max(60, ((b.y1 - b.y0) / 2) * prefs.fadeSize * 1.2);
  const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
  Object.assign(fade.style, { left: `${cx - rx}px`, top: `${cy - ry}px`, width: `${rx * 2}px`, height: `${ry * 2}px` });
}
view.onRender = placeFade;

// ---- Icons that move the views, for touch and pen ----
const NAV = {
  'g-pan': (dx, dy) => graph.panBy(dx, dy),
  'g-zoom': (dx, dy) => { const r = stage.getBoundingClientRect(); graph.zoomAt(r.width * 0.3, r.height / 2, Math.exp(-dy * 0.006)); },
  'v-pan': (dx, dy) => view.panBy(dx, dy),
  'v-orbit': (dx, dy) => view.orbitBy(dx, dy),
  'v-zoom': (dx, dy) => { const { x, y, w, h } = view.rect; view.zoomAt(x + w / 2, y + h / 2, Math.exp(dy * 0.006)); },
};
const NAV_TAP = {
  'g-focus': () => setPref('focus', prefs.focus === 'graph' ? 'auto' : 'graph'),
  'v-focus': () => setPref('focus', prefs.focus === 'tree' ? 'auto' : 'tree'),
  'g-zoom': () => NAV['g-zoom'](0, -40),
  'v-zoom': () => NAV['v-zoom'](0, -40),
  'g-frame': () => graph.frameNodes(doc.graph.nodes, graphRegion(), false, 0.9, READABLE_ZOOM),
  'v-frame': () => view.frameAll(),
};
for (const b of document.querySelectorAll('[data-nav]')) {
  const kind = b.dataset.nav;
  let last = null; let moved = 0;
  b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); last = e; moved = 0; });
  b.addEventListener('pointermove', (e) => {
    if (!last) return;
    moved += Math.abs(e.clientX - last.clientX) + Math.abs(e.clientY - last.clientY);
    NAV[kind]?.(e.clientX - last.clientX, e.clientY - last.clientY);
    last = e;
  });
  const end = () => { if (last && moved < 6) NAV_TAP[kind]?.(); last = null; };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', () => { last = null; });
}
for (const nav of document.querySelectorAll('.nav')) {
  for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'contextmenu']) nav.addEventListener(ev, (e) => e.stopPropagation());
}

// One layer in front: the other then moves only by its icons.
function applyFocus() {
  stage.dataset.focus = prefs.focus;
  input.setFocus(prefs.focus);
  $('[data-nav=g-focus]').setAttribute('aria-pressed', prefs.focus === 'graph');
  $('[data-nav=v-focus]').setAttribute('aria-pressed', prefs.focus === 'tree');
}

// The navigation boxes dock to a wall by the grip on top: their own view's side wall, or the top or bottom wall
// within their own view's half (lying flat there). They never cross to the other view's side.
const homeSide = (which) => ((which === '2d') !== !!prefs.swapViews ? 'left' : 'right');
function navDivide() { return prefs.layout === 'split' ? (prefs.swapViews ? 1 - prefs.splitAt : prefs.splitAt) : 0.5; }
function navSpot(which) {
  // Upright: the tree's icons on the right of the upper part, the graph's on the left of the lower part.
  if (isPortrait()) {
    const d = prefs.layout === 'split' ? prefs.splitAt : 0.5;
    return which === '3d' ? { wall: 'right', at: d / 2, side: 'right' } : { wall: 'left', at: (1 + d) / 2, side: 'left' };
  }
  const side = homeSide(which);
  let wall = prefs[`navWall${which}`] || side;
  if ((wall === 'left' || wall === 'right') && wall !== side) wall = side;
  return { wall, at: prefs[`navY${which}`], side };
}
function placeNavs() {
  const s = stage.getBoundingClientRect(); const bar = $('#bar').getBoundingClientRect(); const ui = prefs.ui || 1;
  for (const which of ['2d', '3d']) {
    const n = $(`#nav${which}`);
    if (which === '3d' && bake?.isOpen()) continue;
    const { wall, at, side } = navSpot(which);
    n.dataset.wall = wall;
    // Clear of the toolbar when it's docked on the same wall.
    const gap = (barSide() === wall ? ((wall === 'left' || wall === 'right') ? bar.width : (wall === 'top' ? bar.bottom - s.top : s.bottom - bar.top)) / ui : 0) + 8;
    const st = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto', transform: '' };
    if (wall === 'left' || wall === 'right') {
      st[wall] = `${gap}px`;
      if (at == null) Object.assign(st, { top: '', bottom: '', transform: '' }); else Object.assign(st, { top: `${at * 100}%`, transform: 'translateY(-50%)' });
      if (which === '3d') {
        // Never behind the gizmo and dials, which sit in this wall's top corner.
        const corner = (dialsEl.hidden ? gizmoEl.getBoundingClientRect().bottom : dialsEl.getBoundingClientRect().bottom) - s.top;
        const h = n.getBoundingClientRect().height; const mid = (at ?? (prefs.navAt === 'top' ? 0 : prefs.navAt === 'bottom' ? 1 : 0.5)) * s.height;
        if (!gizmoEl.hidden && mid - h / 2 < corner + 8) Object.assign(st, { top: `${(corner + 8) / ui}px`, bottom: 'auto', transform: 'none' });
      }
    } else {
      st[wall] = `${gap}px`;
      const d = navDivide(); const lo = side === 'left' ? 0 : d; const hi = side === 'left' ? d : 1;
      Object.assign(st, { left: `${(lo + (hi - lo) * (at ?? 0.5)) * 100}%`, transform: 'translateX(-50%)' });
    }
    Object.assign(n.style, st);
  }
}
for (const which of ['2d', '3d']) {
  const n = $(`#nav${which}`); const grip = n.querySelector('.nav-grip');
  grip.title = 'Drag to dock these icons on another wall';
  let drag = null;
  grip.addEventListener('pointerdown', (e) => { e.stopPropagation(); grip.setPointerCapture(e.pointerId); const b = n.getBoundingClientRect(); drag = { dx: e.clientX - b.left, dy: e.clientY - b.top }; n.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = stage.getBoundingClientRect(); const ui = prefs.ui || 1;
    Object.assign(n.style, { left: `${(e.clientX - s.left - drag.dx) / ui}px`, top: `${(e.clientY - s.top - drag.dy) / ui}px`, right: 'auto', bottom: 'auto', transform: '' });
  });
  grip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag = null; n.classList.remove('dragging');
    const s = stage.getBoundingClientRect();
    const d = dockAt(e.clientX - s.left, e.clientY - s.top, s.width, s.height, homeSide(which), navDivide());
    prefs[`navWall${which}`] = d.wall; prefs[`navY${which}`] = d.at;
    savePrefs(); placeNavs();
  });
}

// The toolbar docks on any edge of the window by its grip: along the top or bottom, or standing on the left or right.
{
  const barEl = $('#bar');
  const grip = document.createElement('div'); grip.className = 'bar-grip'; grip.title = 'Drag to dock the toolbar on another edge'; grip.setAttribute('aria-hidden', 'true');
  barEl.prepend(grip);
  let drag = false;
  grip.addEventListener('pointerdown', (e) => { grip.setPointerCapture(e.pointerId); drag = true; barEl.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const ui = prefs.ui || 1;
    Object.assign(barEl.style, { left: `${e.clientX / ui}px`, top: `${e.clientY / ui}px`, right: 'auto', bottom: 'auto', transform: 'translate(-12px, -50%)' });
  });
  grip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag = false; barEl.classList.remove('dragging');
    barEl.style.cssText = '';
    const w = innerWidth; const h = innerHeight;
    const walls = { top: e.clientY, bottom: h - e.clientY, left: e.clientX, right: w - e.clientX };
    setPref('barAt', Object.entries(walls).sort((a, b) => a[1] - b[1])[0][0]);
  });
}
const applyBar = () => { document.body.dataset.bar = barSide(); requestAnimationFrame(() => { placeGizmo(); placeNavs(); }); };
// In Split, the bar between the halves resizes them.
{
  const split = $('#splitter');
  let drag = false;
  split.addEventListener('pointerdown', (e) => { split.setPointerCapture(e.pointerId); drag = true; e.stopPropagation(); });
  split.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    const f = isPortrait() ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    prefs.splitAt = Math.max(0.15, Math.min(0.85, prefs.swapViews && !isPortrait() ? 1 - f : f));
    layout();
  });
  split.addEventListener('pointerup', () => { if (drag) savePrefs(); drag = false; });
}

// Toolbar groups can be full, folded into one button with a list, or hidden. They start folded, with adding nodes
// left open and the update and wind buttons out of the way (updates are automatic).
const GROUP_START = { make: 'full', vary: 'full', tools: 'full', update: 'hidden', wind: 'hidden' };
const groupMode = (k) => prefs.toolGroups?.[k] || GROUP_START[k] || 'compact';
// Each button can also be left out on its own (Settings, Toolbar). A folded group's button does the last thing
// picked from it; holding it (or its arrow) opens the list, and what is picked there moves to the top.
const toolKey = (b) => b.dataset.act || b.dataset.layoutBtn || b.dataset.shade || b.dataset.mode || b.getAttribute('aria-label');
const toolsOf = (g) => [...g.querySelectorAll(':scope > button:not(.group-more), :scope > a')];
function applyToolbar() {
  for (const g of document.querySelectorAll('#bar .group[data-group]')) {
    const mode = groupMode(g.dataset.group);
    for (const b of toolsOf(g)) b.hidden = !!prefs.toolHidden?.[toolKey(b)];
    const shown = toolsOf(g).filter((b) => !b.hidden);
    g.hidden = mode === 'hidden' || !shown.length;
    g.classList.toggle('compact', mode === 'compact');
    let more = g.querySelector(':scope > .group-more');
    if (mode !== 'compact' || !shown.length) continue;
    if (!more) {
      more = document.createElement('button');
      more.className = 'group-more';
      more.setAttribute('aria-haspopup', 'menu');
      const list = () => {
        menuAnchor = more;
        menu(under(more), toolsOf(g).filter((b) => !b.hidden).map((b) => ({
          label: b.getAttribute('aria-label') || b.title, on: b.getAttribute('aria-pressed') === 'true',
          fn: () => { setPref('groupLast', { ...prefs.groupLast, [g.dataset.group]: toolKey(b) }); b.click(); },
        })));
      };
      let hold = 0; let held = false;
      more.addEventListener('pointerdown', () => { held = false; clearTimeout(hold); hold = setTimeout(() => { held = true; list(); }, 450); });
      more.addEventListener('pointerleave', () => clearTimeout(hold));
      more.addEventListener('click', (e) => {
        e.stopPropagation(); clearTimeout(hold);
        if (held) return;
        if (e.target.closest('.caret')) { list(); return; }
        const last = toolsOf(g).find((b) => !b.hidden && toolKey(b) === prefs.groupLast?.[g.dataset.group]) || toolsOf(g).find((b) => !b.hidden);
        last?.click();
      });
      g.prepend(more);
    }
    const last = shown.find((b) => toolKey(b) === prefs.groupLast?.[g.dataset.group]) || shown[0];
    more.title = `${last.getAttribute('aria-label') || last.title} (hold for ${g.dataset.label})`;
    more.setAttribute('aria-label', more.title);
    more.innerHTML = `${last.querySelector('svg').outerHTML}<span class="caret">▾</span>`;
  }
}

// The light and wind dials: click the middle to switch one on or off, drag the dot around the ring to turn it.
const dialsEl = $('#dials');
let sunOn = true;
const dialOn = (kind) => (kind === 'sun' ? sunOn : $('[data-act=wind]').getAttribute('aria-pressed') === 'true');
function drawDial(c, kind, deg) {
  const S = prefs.dialSize; const r = Math.min(devicePixelRatio || 1, 2);
  c.width = c.height = S * r; c.style.width = c.style.height = `${S}px`;
  const g = c.getContext('2d'); g.scale(r, r);
  const R = S / 2 - 6; const a = ((deg - 90) * Math.PI) / 180;
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--bar-bg') || 'rgba(20, 27, 18, .78)'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, 7); g.fill();
  g.strokeStyle = css.getPropertyValue('--line') || 'rgba(255, 255, 255, .35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.stroke();
  const on = dialOn(kind);
  g.strokeStyle = kind === 'sun' ? '#ffd04d' : '#8fd3ff'; g.fillStyle = g.strokeStyle; g.lineWidth = 1.6; g.lineCap = 'round';
  g.globalAlpha = on ? 1 : 0.35;
  const k = S / 48; const cx = S / 2; const cy = S / 2;
  g.beginPath();
  if (kind === 'sun') {
    g.arc(cx, cy, 5 * k, 0, 7); g.stroke();
    g.beginPath();
    for (let i = 0; i < 8; i++) { const b = (i / 8) * Math.PI * 2; g.moveTo(cx + Math.cos(b) * 8 * k, cy + Math.sin(b) * 8 * k); g.lineTo(cx + Math.cos(b) * 11 * k, cy + Math.sin(b) * 11 * k); }
  } else {
    // Three wavy lines.
    for (const [y, w] of [[-5, 16], [0, 18], [5, 12]]) {
      for (let i = 0; i <= 12; i++) { const x = cx - 9 * k + (w * k * i) / 12; const yy = cy + y * k + Math.sin((i / 12) * Math.PI * 2) * 1.6 * k; if (i) g.lineTo(x, yy); else g.moveTo(x, yy); }
    }
  }
  g.stroke();
  g.globalAlpha = 1;
  g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 4.5, 0, 7); g.fill();
}
function placeDials() {
  dialsEl.hidden = !prefs.dials || gizmoEl.hidden;
  if (dialsEl.hidden) return;
  drawDial($('[data-dial=sun]'), 'sun', prefs.sunYaw);
  drawDial($('[data-dial=wind]'), 'wind', prefs.windDir);
  // A column centered under the gizmo.
  dialsEl.style.width = `${prefs.gizmoSize}px`;
  Object.assign(dialsEl.style, { left: gizmoEl.style.left, top: `${parseFloat(gizmoEl.style.top) + prefs.gizmoSize + 8}px` });
}
for (const c of dialsEl.querySelectorAll('canvas')) {
  let drag = false;
  const turn = (e) => {
    const b = c.getBoundingClientRect();
    const deg = ((Math.atan2(e.clientY - b.top - b.height / 2, e.clientX - b.left - b.width / 2) * 180) / Math.PI + 90 + 360) % 360;
    prefs[c.dataset.dial === 'sun' ? 'sunYaw' : 'windDir'] = Math.round(deg);
    if (c.dataset.dial === 'sun') view.setSunYaw(prefs.sunYaw); else applyGust();
    placeDials();
  };
  c.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const b = c.getBoundingClientRect();
    // The middle switches it; anywhere on the ring turns it.
    if (Math.hypot(e.clientX - b.left - b.width / 2, e.clientY - b.top - b.height / 2) < b.width * 0.28) {
      if (c.dataset.dial === 'sun') { sunOn = !sunOn; view.setSunOn(sunOn); } else actions.wind($('[data-act=wind]'));
      placeDials();
      return;
    }
    c.setPointerCapture(e.pointerId); drag = true; turn(e);
  });
  c.addEventListener('pointermove', (e) => { if (drag) turn(e); });
  c.addEventListener('pointerup', () => { if (drag) savePrefs(); drag = false; });
  c.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
}

// The ruler button under the dials stays out of the 3D view's own dragging.
$('#dials .dial-btn')?.addEventListener('pointerdown', (e) => e.stopPropagation());

const settingsEl = $('#settings');
const closeSettings = () => { settingsEl.hidden = true; };
settingsEl.querySelector('[data-close]').addEventListener('click', closeSettings);
settingsEl.addEventListener('pointerdown', (e) => { if (e.target === settingsEl) closeSettings(); });
settingsEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); e.stopPropagation(); });

function setMode(mode) {
  view.setMode(mode);
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === mode);
}

function setShading(mode) {
  prefs.shading = mode;
  savePrefs();
  view.setShading(mode);
  if (view.mode !== 'mesh') setMode('mesh');
  for (const b of document.querySelectorAll('[data-shade]')) b.setAttribute('aria-pressed', b.dataset.shade === mode);
}

const press = (act, on) => $(`[data-act=${act}]`).setAttribute('aria-pressed', on);

// ---- Backups ----
const backups = makeBackups({
  text: documentText,
  name: () => safeName(doc.name),
  download: downloadText,
  toast,
});
// Backups that start on their own: beside the saved file or in the app's Backups folder, or kept in the browser.
async function quietStore(when, body) {
  if (window.canopyApp) await window.canopyApp.backup(when, body, safeName(doc.name));
  else await storeBackup(safeName(doc.name), when, body);
}
// The commands AI control offers, on the live document.
let ai = null;
function aiApi() {
  ai ||= makeApi({
    doc, NODE_TYPES, defaultParams, addNode, connect, removeNodes, changed, commit,
    loadGraph: (g, name) => { openGraph(g, name); },
    renderImage: (size) => view.renderImage(size),
  });
  return ai;
}
function startQuietBackups() { backups.startQuiet(prefs.backupMin, quietStore); press('backup', true); }
const backupEl = $('#backup');
$('#backup [data-close]').addEventListener('click', () => { backupEl.hidden = true; });
$('#backup [data-save]').addEventListener('click', async () => {
  backupEl.hidden = true;
  const ok = await backups.start(prefs.backupMin);
  press('backup', ok);
  if (ok) toast(`Saved. A new backup follows every ${prefs.backupMin} minutes while the plant changes.`, 4000);
});

// ---- Events ----
on('graph', () => graph.invalidate());
on('selection', () => { graph.invalidate(); view.highlight(); });
on('result', (res) => {
  renderer.refresh();
  view.apply(res);
  scanBake.refresh();
  const s = res.stats;
  $('#stats').textContent = `${s.lines.toLocaleString('en')} lines · ${s.tris.toLocaleString('en')} triangles · ${s.ms} ms${s.draft ? ' · draft' : ''}`;
  const warn = $('#warn');
  warn.hidden = !res.warnings.length;
  warn.textContent = res.warnings[0] || '';
  warn.title = res.warnings.join('\n');
  $('#building').hidden = true;
  $('[data-act=manual]').classList.remove('stale');
});
on('build-start', () => { $('#building').hidden = false; });
on('build-error', (msg) => { $('#building').hidden = true; toast(`The tree could not be built: ${String(msg).split('\n')[0]}`, 6000); });
on('stale', () => $('[data-act=manual]').classList.add('stale'));
// Switching a Spline to Cutout needs its atlas read before there is anything to build.
on('params', ({ node, key }) => {
  if (key !== 'meshType') return;
  // A cutout leaf needs a material with a leaf texture: an existing one if there is one, otherwise a new one.
  const kinds = String(node.params.meshType).split('+');
  if (kinds.includes('cutout') && !materialOf(doc.graph, node)?.texture?.startsWith?.('atlas:') && !materialOf(doc.graph, node)?.cutouts?.length) {
    const leafy = (doc.graph.materials || []).find((m) => m.cutouts?.length || String(m.texture).startsWith('atlas:'));
    const m = leafy || newMaterial('Leaves');
    if (!leafy) (doc.graph.materials ||= []).push(m);
    // A tube kept beside the cutouts keeps the bark it had.
    if (kinds.includes('tube') && !node.params.tubeMaterial) node.params.tubeMaterial = node.params.material;
    node.params.material = m.id;
    node.params.cutoutPick = null;
    // Nothing from the samples comes along: the new material waits for the person's own leaf image.
    if (!leafy) { setTimeout(() => matEditor.open(m.id), 0); toast('Load a leaf image into the Color slot, then make its cutouts.', 5000); }
  }
  changed({ layout: true }); commit();
});

// Exactly one of the two update buttons is lit, so it's clear which mode is on.
function showUpdateMode() {
  const manual = !!doc.graph.settings?.manual;
  $('[data-act=auto]').setAttribute('aria-pressed', !manual);
  $('[data-act=manual]').setAttribute('aria-pressed', manual);
}
on('document', () => {
  $('#doc-name').value = doc.name;
  showUpdateMode();
});

const saveNow = () => autosave().catch((e) => { console.error(e); toast('Automatic saving failed. Save the file by hand to keep your work.'); });
setAutosaver(saveNow);
// A tablet can close a backgrounded app at any moment, so don't wait for the delay.
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

async function openGraph(g, name, assets) {
  if (assets) doc.assets = assets;
  await ensureCutouts(g);
  view.fitNext = true;
  loadGraph(g, name);
  // Connectors moved to the node headers, so plants without a saved left-to-right layout get one.
  if (!doc.graph.settings.layoutV) {
    graph.tidy();
    doc.graph.settings.layoutV = 2;
    resetHistory();
  }
  // Layouts read the graph, so frame only after it is in place.
  graph.frameNodes(doc.graph.nodes, graphRegion(), true, 0.9, READABLE_ZOOM);
}

const okToReplace = () => !hasEdits() || confirm('Replace the current plant? Your unsaved changes will be lost.');

// A new file starts with only what it makes: no images or materials carried over from the last one.
// The built-in plants get their leaf cutouts detected; a person's own materials only get them when asked.
const openPreset = async (name) => {
  if (!okToReplace()) return;
  // The name is edited in the toolbar, so a new plant opens at once.
  const title = name;
  const g = PRESETS[name]();
  await ensureCutouts(g, { fill: true });
  openGraph(g, title, {});
};
// Samples are .canopy files in the samples folder, listed in its index.json, so they can be replaced without a
// new build. Where files can't be fetched (the PC app opens pages from disk), the built-in ones stand in.
async function sampleItems() {
  try {
    const list = await (await fetch('./samples/index.json')).json();
    return list.map((s) => ({ label: s.name, fn: () => openSample(s) }));
  } catch {
    return Object.keys(PRESETS).map((name) => ({ label: name, fn: () => openPreset(name) }));
  }
}
async function openSample(s) {
  if (!okToReplace()) return;
  try {
    const d = parseDocument(await (await fetch(`./samples/${encodeURIComponent(s.file)}`)).text());
    // The name is edited in the toolbar, so a new plant opens at once.
    const title = s.name;
    const g = d.graph || { nodes: d.nodes, links: d.links, groups: [], settings: {} };
    await ensureCutouts(g, { fill: true });
    openGraph(g, title, d.assets || {});
  } catch (e) { toast(`That sample could not be opened: ${e.message}`, 5000); }
}

async function startFresh() {
  if (!okToReplace()) return;
  // The name is edited in the toolbar, so a new plant opens at once.
  const title = 'Untitled';
  openGraph({ nodes: [], links: [], groups: [], materials: [], settings: { seed: 1 } }, title, {});
  toast('Empty. Use the Spline and Mesh icons on top, or press Space, to add your first node.');
}

async function openFile() {
  const f = await pickFile('.canopy,.zip,application/json,application/zip');
  if (!f || !okToReplace()) return;
  try {
    const d = await readDocumentFile(f);
    await openGraph(d.graph || { nodes: d.nodes, links: d.links, groups: [], settings: {} }, d.name || f.name.replace(/\.\w+$/, ''), { ...doc.assets, ...d.assets });
  } catch (e) { toast(e.message, 5000); }
}

async function importNodes() {
  const f = await pickFile('.canopy,application/json');
  if (!f) return;
  try {
    const d = parseDocument(await f.text());
    const nodes = d.graph?.nodes || d.nodes; const links = d.graph?.links || d.links;
    Object.assign(doc.assets, d.assets);
    const w = graph.toWorld(stage.clientWidth * 0.3, stage.clientHeight * 0.3);
    const x0 = Math.min(...nodes.map((n) => n.x || 0)); const y0 = Math.min(...nodes.map((n) => n.y || 0));
    select(mergeNodes(nodes, links, w.x - x0, w.y - y0));
    changed({ layout: true });
    commit();
  } catch (e) { toast(e.message, 5000); }
}

// A mesh arrives as a Scene object node, which can then be grown on, avoided, sliced with or filled.
async function importMeshFile() {
  const f = await pickFile('.obj,.fbx,.glb,.gltf');
  if (!f) return;
  try {
    const { texture, ...obj } = await importMesh(f);
    const r = stage.getBoundingClientRect();
    const w = graph.toWorld(r.width * 0.3, r.height * 0.3);
    const n = newNode('Mesh', w.x, w.y);
    n.params.shape = 'imported';
    n.params.obj = obj;
    n.name = f.name;
    // A picture that came with the mesh becomes its material.
    if (texture) {
      const id = `img:${Date.now().toString(36)}`;
      doc.assets[id] = { name: f.name, url: texture };
      const m = newMaterial(f.name.replace(/\.\w+$/, ''), { texture: id });
      (doc.graph.materials ||= []).push(m);
      n.params.material = m.id;
    }
    settleNew(n);
    toast(`Imported ${obj.v.length / 3} points as a Mesh node. Connect a Spline to grow things on it.`, 5000);
  } catch (e) { console.error(e); toast(e.message || 'That mesh could not be read.', 6000); }
}

const actions = {
  new: () => startFresh(),
  open: async (btn) => menu(under(btn), [
    { label: 'Open from file…', fn: openFile },
    { label: 'Add nodes from a file…', fn: importNodes },
    { head: 'Samples' }, ...(await sampleItems()),
  ]),
  save: () => saveDocument(prefs.texturesInFile),
  import: importMeshFile,
  backup() {
    if (backups.running()) { backups.stop(); press('backup', false); toast('Backups are off.'); return; }
    backupEl.hidden = false;
  },
  addSpline: () => addFromBar('Spline'),
  materials: () => matEditor.open(primary()?.params?.material),
  cutouts: () => {
    const mats = (doc.graph.materials || []).filter((m) => m.texture);
    const m = mats.find((x) => x.id === primary()?.params?.material) || mats.find((x) => x.cutouts?.length || !String(x.texture).startsWith('bark:')) || mats[0];
    if (m) editCutouts(m); else toast('No material has a picture yet. Make one in the material editor and load a leaf picture into its Color slot.', 5000);
  },
  bake: () => bake.open(),
  pack: () => packer.open(),
  addMesh: () => addFromBar('Mesh'),
  addMix: () => { const r = stage.getBoundingClientRect(); const w = graph.toWorld(r.width * 0.3, r.height * 0.4); settleNew(newNode('Mix', w.x, w.y)); },
  wind(btn) { const on = btn.getAttribute('aria-pressed') !== 'true'; press('wind', on); view.setWind(on); placeDials(); },
  wire(btn) { const on = btn.getAttribute('aria-pressed') !== 'true'; press('wire', on); view.setWireframe(on); },
  scale(btn) { scaleOn = btn.getAttribute('aria-pressed') !== 'true'; press('scale', scaleOn); showScale(); },
  export: () => openExport(view, toast),
  savePreset: () => seedPresets.save(),
  xform() {
    const on = !xfGizmo.on;
    xfGizmo.setOn(on); press('xform', on);
    $('#xfbar').hidden = !on;
    if (on && !xfGizmo.target) toast('Pick a Spline or Mesh node, then drag the gizmo in the 3D view. W moves, E turns, R scales.');
  },
  pen() {
    if (input.state.draw?.pen) { input.stopDraw(); return; }
    // A picked Spline is the style: the drawing grows from its parent, looking like it. A picked Mesh is a surface
    // to draw on.
    const n = primary();
    if (n?.type === 'Spline') {
      const up = doc.graph.links.find((l) => l.to === n.id && l.toSock === 'parent');
      input.startPen(up?.from || null, n.id);
      toast(up ? `Draw from ${nodeById(up.from)?.name || 'the parent'}: the new lines look like ${n.name} and carry its children.` : `Draw anywhere: the new lines look like ${n.name} and carry its children.`, 4000);
    } else input.startPen(n?.type === 'Mesh' ? n.id : null);
    press('pen', true);
  },
  presets: () => seedPresets.open(),
  auto() {
    doc.graph.settings.manual = false;
    showUpdateMode();
    regenerate({ force: true });
    commit();
  },
  // In manual mode this button is also what rebuilds, so a second press updates the plant.
  manual() {
    if (doc.graph.settings.manual) { regenerate({ force: true }); return; }
    doc.graph.settings.manual = true;
    showUpdateMode();
    commit();
  },
  render: () => renderer.quick(),
  renderSettings: () => renderer.open(),
  scanBake: () => scanBake.open(),
  life: () => life.open(),
  undo, redo,
  prefs: () => openSettings(settingsEl, prefs, setPref),
  seed() {
    doc.graph.settings.seed = Math.floor(Math.random() * 99999);
    regenerate();
    commit();
  },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) { closePopups(); actions[b.dataset.act](b); return; }
  const m = e.target.closest('[data-mode]');
  if (m) { setMode(view.mode === 'lines' ? 'mesh' : 'lines'); return; }
  const s = e.target.closest('[data-shade]');
  if (s) { setShading(s.dataset.shade); return; }
  const l = e.target.closest('[data-layout-btn]');
  if (l) setLayout(l.dataset.layoutBtn);
});

$('#doc-name').addEventListener('change', (e) => { doc.name = e.target.value || 'Untitled'; changed({ rebuild: false }); });
new ResizeObserver(layout).observe(stage);

// ---- Start ----
for (const k of ['snap', 'ui', 'text', 'varShow', 'graphDim', 'fadeStrength', 'exposure', 'shadows', 'navAt', 'units', 'windDir', 'theme', 'grid', 'gizmo', 'focus', 'toolGroups', 'wireColor', 'gizmoSize', 'sunYaw', 'navY2d', 'groundOn', 'barAt', 'glow', 'undoSteps']) applyPref(k);
if (prefs.backupOn) startQuietBackups();
if (prefs.aiBridge) startBridge(aiApi());
setShading(prefs.shading);
ui.status('graph');
layout();

(async () => {
  let saved = null;
  try { saved = await loadAutosave(); } catch (e) { console.warn('No automatic save available', e); }
  if (saved?.graph?.nodes?.length) await openGraph(saved.graph, saved.name || 'Untitled', saved.assets || {});
  else { const g = PRESETS[DEFAULT_PRESET](); await ensureCutouts(g, { fill: true }); await openGraph(g, DEFAULT_PRESET); }
  resetHistory();
  $('#boot').remove();
  if (document.fonts?.ready) document.fonts.ready.then(() => graph.invalidate());
})();

// Installs for offline use on real sites; skipped on this computer so a stale cache can't hide changes.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
