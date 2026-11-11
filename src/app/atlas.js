// The leaf cutout editor. It opens on the texture in use: detect leaves or add meshes, then drag points, the pivot and sprouts directly.
import { contourCutouts } from '../leaf/contour.js';
import { Cut3D } from './cut3d.js';
import { fitCutout, cutoutsFromImage, meshAs, leafFromLine, addOutlinePoint, addInnerPoint, removeCutoutPoint } from '../leaf/cutout.js';
import { doc, setParam, commit, changed } from './doc.js';
import { clone } from '../graph/schema.js';
import { atlasPixels, textureSource, textureChoices, atlasChoices } from './textures.js';
import { el, numberField, checkField, selectField } from './fields.js';
import { sproutFromPixels } from './sprout.js';
import { readDataUrl, pickFile, downloadText } from './io.js';

// Auto detect's settings, kept on the material.
export const detectOpts = (p) => ({
  threshold: +(p.threshold ?? 0.5), padding: +(p.padding ?? 2), segment: +(p.segment ?? 24), inner: p.innerRings !== false, midline: !!p.midRow, holeArea: +(p.holeArea ?? 400),
});

export const fitOpts = (node) => ({
  threshold: +(node.params.threshold ?? 0.25), padding: +(node.params.padding ?? 2), points: +(node.params.polyMax ?? 32),
  midline: node.params.midline !== false, inside: node.params.cutInside || 'quads', columns: +(node.params.cutColumns ?? 1),
});

// A material's picture with its opacity taken from the Opacity map when it has one, so a picture without
// alpha (a JPG, say) still cuts out once a mask is made for it.
export async function materialPixels(m) {
  const img = await atlasPixels(m.texture, doc.assets);
  const ch = m.opacityCh || 'A';
  if (!img || !m.opacityMap || (m.opacityMap === m.texture && ch === 'A')) return img;
  const op = await atlasPixels(m.opacityMap, doc.assets);
  if (!op) return img;
  const k = 'RGBA'.indexOf(ch);
  for (let y = 0; y < img.height; y++) {
    const sy = Math.min(op.height - 1, Math.floor((y * op.height) / img.height));
    for (let x = 0; x < img.width; x++) {
      const sx = Math.min(op.width - 1, Math.floor((x * op.width) / img.width));
      img.data[(y * img.width + x) * 4 + 3] = Math.min(img.data[(y * img.width + x) * 4 + 3], op.data[(sy * op.width + sx) * 4 + k]);
    }
  }
  return img;
}

// Brings cutouts from older files up to date. With fill (the built-in plants), materials a cutout leaf uses that
// have none yet get them detected; otherwise cutouts are only made when asked for.
export async function ensureCutouts(graph, { fill = false } = {}) {
  let changedAny = false;
  const used = new Set(graph.nodes.filter((n) => String(n.params?.meshType).split('+').includes('cutout') && n.params.material).map((n) => n.params.material));
  for (const m of graph.materials || []) {
    if (!m.texture || !used.has(m.id)) continue;
    const old = m.cutouts || [];
    if (!old.length && !fill) continue;
    if (old.length && old.every((c) => c.outlinePx)) continue;
    const img = await materialPixels(m);
    if (!img) continue;
    m.cutouts = old.length
      ? old.map((c, i) => fitCutout(img, { rect: c.rect, base: c.basePx, tip: c.tipPx, enabled: c.enabled, name: c.name || `Leaf ${i + 1}` }, fitOpts({ params: m })) || c).filter((c) => c.outlinePx)
      : cutoutsFromImage(img, fitOpts({ params: m }));
    changedAny = true;
  }
  // Classic cutout nodes keep their own.
  for (const n of graph.nodes.filter((x) => x.type === 'LeafCutout')) {
    if (!n.params.atlas) continue;
    const old = n.params.cutouts || [];
    if (old.length && old.every((c) => c.outlinePx)) continue;
    const img = await atlasPixels(n.params.atlas, doc.assets);
    if (!img) continue;
    n.params.cutouts = old.length
      ? old.map((c, i) => fitCutout(img, { rect: c.rect, base: c.basePx, tip: c.tipPx, enabled: c.enabled, name: `Leaf ${i + 1}` }, fitOpts(n)) || c).filter((c) => c.outlinePx)
      : cutoutsFromImage(img, fitOpts(n));
    changedAny = true;
  }
  return changedAny;
}

export async function detect(node) {
  const img = await atlasPixels(node.params.atlas, doc.assets);
  if (!img) return;
  setParam(node, 'cutouts', cutoutsFromImage(img, fitOpts(node)));
}

// A point of the picked mesh as a key: outline:3, inner:0, hole:1:2.
const ptKey = (g) => (g.kind === 'hole' ? `hole:${g.h}:${g.i}` : `${g.kind}:${g.i}`);

const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

const segDist = (p, a, b) => {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};

function arrow(c, a, b, color, k) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = 10 / k;
  c.strokeStyle = color;
  c.lineWidth = 2 / k;
  c.beginPath();
  c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
  c.moveTo(b[0] - Math.cos(ang - 0.45) * head, b[1] - Math.sin(ang - 0.45) * head);
  c.lineTo(b[0], b[1]);
  c.lineTo(b[0] - Math.cos(ang + 0.45) * head, b[1] - Math.sin(ang + 0.45) * head);
  c.stroke();
}

// Sprout levels: children can grow from one level only. Each has a color, which can be changed.
const SPROUT_COLORS = ['#5cc8ff', '#ff9f43', '#c56cf0', '#7bed9f', '#ff6b81', '#ffd32a', '#18dcff', '#ffffff', '#a4b0be'];
const levelColor = (lv) => doc.graph.settings?.sproutColors?.[lv - 1] || SPROUT_COLORS[lv - 1];

const HINT = {
  shape3d: 'Drag a point to move it in 3D; drag anywhere else to turn the view, scroll to zoom. With "Texture follows" the picture moves with the point; without it only the shape changes.',
  select: 'Tap a mesh to pick it. Drag it, or its middle dot, to move it; drag the dot on its ring to turn and scale it. Its name (tap to rename), copy, delete and meshing sit around it.',
  edit: 'Drag a point to move it. Drag across the mesh (or Shift-drag anywhere) to box-pick points, Shift-click to add one; drag a picked point to move them all. Click an edge or inside the picked mesh to add a point, double-click or right-click one to remove it. The red arrow is the pivot and the way the leaf points.',
  add: 'Drag from where the stem meets the leaf to its tip. A simple leaf shape appears around the line; then move its points to fit the picture.',
  hole: 'Cut a hole in the picked mesh: click around the empty space, then click the first point (or double-click, or press Enter) to close it. Escape drops it.',
  sprout: 'Click on the picked mesh to add a sprout of the level picked above, and drag to aim it. Drag a point to move it or its arrow tip to aim it. Right-click or hold a point to change its level; double-click removes it. Children with Sprouts placement grow from these.',
};

export class AtlasEditor {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.controls = root.querySelector('.atlas-controls');
    this.matPick = root.querySelector('.atlas-mat');
    this.detectBox = root.querySelector('.atlas-detect');
    this.hint = root.querySelector('.atlas-hint');
    this.bg = 'albedo';
    this.active = -1;
    this.tool = 'edit';
    this.preview = null;
    this.view = { x: 0, y: 0, k: 1 };
    this.touches = new Map();
    this.hole = [];
    this.picks = new Set();
    this.level = 1;
    this.sproutBar = root.querySelector('.atlas-sprouts');
    this.shape3d = new Cut3D(root.querySelector('.atlas-3d'), {
      save: (c) => { this.saveActive(c); return this.cut; },
      onClose: () => this.setTool('select'),
    });
    root.querySelector('[data-detect-close]').addEventListener('click', () => { this.detectBox.hidden = true; this.preview = null; this.draw(); });
    root.querySelector('[data-bgpick]').addEventListener('click', (e) => this.bgMenu(e.currentTarget));
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) this.setTool(b.dataset.tool); });
    root.querySelector('[data-fit]').addEventListener('click', () => this.fitView());
    const open = root.querySelector('[data-detect-open]');
    open.addEventListener('click', () => { this.detectBox.hidden = !this.detectBox.hidden; open.setAttribute('aria-expanded', !this.detectBox.hidden); });
    root.querySelector('[data-detect]').addEventListener('click', () => this.runDetect());
    root.querySelector('[data-create]').addEventListener('click', () => this.createFromPreview());
    root.querySelector('[data-clear]').addEventListener('click', () => this.clearAll());
    const undoBtn = el('button', 'icon'); undoBtn.title = 'Undo (Ctrl+Z)'; undoBtn.setAttribute('aria-label', 'Undo');
    undoBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3"/></svg>';
    undoBtn.addEventListener('click', () => this.undo());
    root.querySelector('[data-clear]').before(undoBtn);
    root.querySelector('[data-export]').addEventListener('click', () => this.exportFile());
    root.querySelector('[data-import]').addEventListener('click', () => this.importFile());
    this.matPick.addEventListener('change', () => {
      const m = (doc.graph.materials || []).find((x) => x.id === this.matPick.value);
      if (m) { this.record(); this.open(m); this.deps.onMaterial?.(m); }
    });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (this.shape3d?.isOpen()) this.shape3d.undo(); else this.undo(); return; }
      if (this.hole.length && e.key === 'Escape') { this.hole = []; this.draw(); return; }
      if (this.hole.length && e.key === 'Enter') { this.closeHole(); return; }
      if (e.key === 'Escape') this.close();
    });
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => { this.touches.delete(e.pointerId); this.drag = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('dblclick', (e) => this.doubleClick(e));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const b = c.getBoundingClientRect();
      this.zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002));
    }, { passive: false });
    new ResizeObserver(() => { if (this.isOpen()) this.resize(); }).observe(c.parentElement);
  }

  isOpen() { return !this.root.hidden; }
  get cuts() { return this.node.params.cutouts || []; }
  get cut() { return this.cuts[this.active]; }

  // Works on a material: its texture and the cutouts that belong to it. A shim keeps the old node-shaped access.
  put(k, v) { this.node.params[k] = clone(v); changed({ layout: true }); }

  // The editor's own undo: each saved change keeps a copy of the cutouts as they were after it.
  record() {
    const s = JSON.stringify(this.cuts);
    if (s !== this.hist.at(-1)) { this.hist.push(s); if (this.hist.length > 80) this.hist.shift(); }
    commit();
  }

  undo() {
    if (this.hist.length < 2) { this.deps.toast?.('Nothing to undo here.'); return; }
    this.hist.pop();
    this.put('cutouts', JSON.parse(this.hist.at(-1)));
    if (this.active >= this.cuts.length) this.active = -1;
    this.draw();
    commit();
  }

  async open(material) {
    this.material = material;
    this.node = { params: material, name: material.name };
    this.hist = [JSON.stringify(material.cutouts || [])];
    this.root.hidden = false;
    this.active = -1;
    this.preview = null;
    this.detectBox.hidden = true;
    this.setTool(this.tool || 'select');
    this.fillMaterials();
    await this.loadAtlas();
    this.buildControls();
    this.draw();
    this.root.querySelector('[data-close]').focus();
  }

  close() {
    this.root.hidden = true;
    this.renameBox?.remove();
    this.record();
    this.deps.onClose?.();
  }

  setTool(tool) {
    if (tool === 'shape3d') {
      if (!this.cut) { this.deps.toast('Pick a mesh first, then shape it in 3D.'); return; }
      this.shape3d.open(this.cut, this.image);
    } else if (this.shape3d?.isOpen()) this.shape3d.host.hidden = true;
    this.tool = tool;
    this.hole = [];
    this.sproutBar.hidden = tool !== 'sprout';
    if (tool === 'sprout') this.fillSprouts();
    for (const b of this.root.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === tool);
    this.hint.textContent = HINT[tool];
    this.draw();
  }

  async loadAtlas() {
    const { node } = this;
    const m = node.params;
    this.image = await textureSource(m.texture, doc.assets);
    this.pixels = await materialPixels(m);
    // What can show behind the meshes: the color picture, the normal map, and the opacity as gray.
    const op = document.createElement('canvas');
    op.width = this.pixels.width; op.height = this.pixels.height;
    const g = op.getContext('2d'); const d = g.createImageData(op.width, op.height);
    for (let i = 0; i < d.data.length; i += 4) { const v = this.pixels.data[i + 3]; d.data[i] = v; d.data[i + 1] = v; d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    const map = async (k) => (m[k] ? textureSource(m[k], doc.assets) : null);
    this.bgImages = { albedo: this.image, normal: await map('normalMap'), opacity: op, roughness: await map('roughMap'), ao: await map('aoMap'), subsurface: await map('sssMap') };
    if (!this.bgImages[this.bg]) this.bg = 'albedo';
    this.markBg();
    this.resize();
    this.fitView();
  }

  buildControls() {
    const { node } = this;
    const o = detectOpts(node.params);
    const set = (k) => (v) => { node.params[k] = v; if (this.preview) this.runDetect(); };
    this.controls.replaceChildren(
      numberField('Opacity threshold', o.threshold, { min: 0.01, max: 0.99 }, set('threshold')),
      numberField('Padding', o.padding, { min: 0, max: 32, unit: 'px' }, set('padding')),
      numberField('Edge length', o.segment, { min: 4, max: 200, int: true, unit: 'px' }, set('segment')),
      checkField('Inner points', o.inner, set('innerRings')),
      checkField('Middle line', o.midline, set('midRow')),
      numberField('Smallest hole', o.holeArea, { min: 0, max: 20000, int: true, unit: 'px²' }, set('holeArea')),
    );
  }

  // The materials with a picture; picking one switches the editor (and the material editor) to it.
  fillMaterials() {
    this.matPick.replaceChildren();
    for (const m of (doc.graph.materials || []).filter((x) => x.texture)) { const o = el('option', '', m.name); o.value = m.id; this.matPick.append(o); }
    this.matPick.value = this.material.id;
  }

  markBg() { this.root.querySelector('[data-bgpick]').className = `ball ${this.bg}`; }

  // The background picker: every map the material has.
  bgMenu(btn) {
    this.closeMenu();
    const m = el('div', 'sprout-menu');
    m.setAttribute('role', 'menu');
    const r = btn.getBoundingClientRect();
    m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 6}px`;
    for (const [k, label] of [['albedo', 'Color'], ['normal', 'Normal'], ['opacity', 'Opacity'], ['roughness', 'Roughness'], ['ao', 'Ambient occlusion'], ['subsurface', 'Subsurface']]) {
      const b = el('button', `bg-item ${k}`, `${k === this.bg ? '✓ ' : ''}${label}`);
      b.disabled = !this.bgImages?.[k];
      b.addEventListener('click', () => { this.closeMenu(); this.bg = k; this.markBg(); this.draw(); });
      m.append(b);
    }
    document.body.append(m);
    this.menu = m;
    const away = (e) => { if (!m.contains(e.target)) this.closeMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', away, { capture: true }), 0);
    this.menuAway = away;
  }

  clearAll() {
    const n = this.cuts.length;
    if (!n || !confirm(`Delete all ${n} meshes of ${this.material.name}?`)) return;
    this.put('cutouts', []);
    this.active = -1;
    this.draw();
    this.record();
  }

  // ---- Auto detect shows first, and only joins the list on Create. ----
  runDetect() {
    this.preview = contourCutouts(this.pixels, detectOpts(this.node.params));
    this.root.querySelector('[data-create]').disabled = !this.preview.length;
    if (!this.preview.length) this.deps.toast('No leaves found. Lower the opacity threshold, or add a mesh by hand.');
    this.draw();
  }

  // What was found joins the meshes already there; none of them is replaced.
  createFromPreview() {
    if (!this.preview?.length) return;
    const kept = this.cuts;
    const made = this.preview.map((c, i) => ({ ...c, name: `Leaf ${kept.length + i + 1}` }));
    this.put('cutouts', [...kept, ...made]);
    this.preview = null;
    this.root.querySelector('[data-create]').disabled = true;
    this.active = -1;
    this.fillList();
    this.draw();
    this.record();
  }

  fillList() { this.draw(); }

  markList() { if (this.tool === 'sprout') this.fillSprouts(); this.draw(); }

  // ---- The picked mesh's own controls, around it on the canvas ----
  toScreen([x, y]) { return [this.view.x + x * this.view.k, this.view.y + y * this.view.k]; }

  widgets() {
    const c = this.cut;
    if (!c) return null;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of c.outlinePx) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const [sx0, sy0] = this.toScreen([x0, y0]); const [sx1, sy1] = this.toScreen([x1, y1]);
    const mx = (sx0 + sx1) / 2; const my = (sy0 + sy1) / 2;
    const R = Math.hypot(sx1 - sx0, sy1 - sy0) / 4 + 12;
    const mode = c.meshMode ? { tris: 'Triangles', quads: 'Quads', mixed: 'Mixed' }[c.meshMode] : c.faces ? 'Fitted quads' : 'Triangles';
    return {
      pivot: [(x0 + x1) / 2, (y0 + y1) / 2], center: [mx, my], R, ring: [mx + R, my],
      name: { x: mx, y: sy0 - 18, text: c.name || 'Mesh' },
      dup: [sx0 - 14, sy0 - 14], del: [sx1 + 14, sy0 - 14], eye: [sx1 + 14, sy1 + 14],
      mode: { x: sx0, y: sy1 + 16, text: `▦ ${mode}`, align: 'left' },
    };
  }

  labelBox(ctx, w) { ctx.font = '600 12px sans-serif'; const tw = ctx.measureText(w.text).width + 16; return [w.x - (w.align === 'left' ? 0 : tw / 2), w.y - 11, tw, 22]; }

  drawWidgets(ctx) {
    const w = this.widgets();
    if (!w) return;
    const pill = (box, text) => {
      ctx.fillStyle = 'rgba(17, 22, 15, .88)';
      ctx.beginPath(); ctx.roundRect(...box, 11); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 228, 92, .7)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#f0f5ec'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, box[0] + box[2] / 2, box[1] + box[3] / 2 + 0.5);
    };
    pill(this.labelBox(ctx, w.name), w.name.text);
    pill(this.labelBox(ctx, w.mode), w.mode.text);
    const knob = ([x, y], text, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 12px sans-serif'; ctx.fillText(text, x, y + 0.5); };
    knob(w.dup, '⧉', '#3d5a2a');
    knob(w.del, '×', '#a8382c');
    knob(w.eye, this.cut.enabled === false ? '○' : '●', '#3d5a2a');
    if (this.tool === 'select') {
      ctx.strokeStyle = 'rgba(255, 228, 92, .8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(...w.center, w.R, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffe45c';
      ctx.beginPath(); ctx.arc(...w.center, 6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(...w.ring, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#11160f'; ctx.beginPath(); ctx.arc(...w.ring, 3, 0, 7); ctx.fill();
    }
  }

  // A press on one of the controls around the picked mesh; true when it took the press.
  widgetPress(s, e) {
    const w = this.widgets();
    if (!w || e.button !== 0) return false;
    const near = (p, r = 13) => Math.hypot(s[0] - p[0], s[1] - p[1]) < r;
    const inBox = (b) => s[0] >= b[0] && s[0] <= b[0] + b[2] && s[1] >= b[1] && s[1] <= b[1] + b[3];
    const i = this.active;
    if (near(w.del)) { this.put('cutouts', this.cuts.filter((_, k) => k !== i)); this.active = -1; this.draw(); this.record(); return true; }
    if (near(w.dup)) {
      const copy = this.transformed({ ...structuredClone(this.cut), id: undefined, name: `${this.cut.name || 'Mesh'} copy`, auto: false }, [0, 0], { dx: 20, dy: 20 });
      this.put('cutouts', [...this.cuts.slice(0, i + 1), this.remesh(copy), ...this.cuts.slice(i + 1)]);
      this.active = i + 1; this.draw(); this.record();
      return true;
    }
    if (near(w.eye)) { this.update(i, { enabled: this.cut.enabled === false }); return true; }
    if (inBox(this.labelBox(this.ctx, w.mode))) {
      const order = ['tris', 'quads', 'mixed'];
      this.saveActive({ ...this.cut, meshMode: order[(order.indexOf(this.cut.meshMode) + 1) % 3] });
      return true;
    }
    if (inBox(this.labelBox(this.ctx, w.name))) { this.rename(w.name); return true; }
    if (this.tool === 'select' && near(w.ring, 15)) {
      const p = this.toImage(e);
      this.drag = { xform: structuredClone(this.cut), pivot: w.pivot, a0: Math.atan2(p[1] - w.pivot[1], p[0] - w.pivot[0]), d0: Math.hypot(p[0] - w.pivot[0], p[1] - w.pivot[1]), turn: true };
      return true;
    }
    return false;
  }

  // Renames in place: a box over the name, Enter or leaving it keeps the name.
  rename(at) {
    this.renameBox?.remove();
    const box = el('input', 'atlas-rename');
    box.value = this.cut.name || '';
    box.setAttribute('aria-label', 'Mesh name');
    Object.assign(box.style, { left: `${at.x}px`, top: `${at.y}px` });
    const i = this.active;
    // Removing the box blurs it, so the first of Enter or blur wins.
    let over = false;
    const done = (keep = true) => { if (over) return; over = true; box.remove(); if (keep) this.update(i, { name: box.value.trim() || 'Mesh' }); };
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(); if (e.key === 'Escape') done(false); });
    box.addEventListener('blur', () => done());
    this.canvas.parentElement.append(box);
    box.focus(); box.select();
    this.renameBox = box;
  }

  // Moves, turns and scales a whole mesh (points, holes, pivot and sprouts) about a point.
  transformed(c, pivot, { dx = 0, dy = 0, a = 0, f = 1 }) {
    const cs = Math.cos(a) * f; const sn = Math.sin(a) * f;
    const T = ([x, y]) => { const u = x - pivot[0]; const v = y - pivot[1]; return [pivot[0] + u * cs - v * sn + dx, pivot[1] + u * sn + v * cs + dy]; };
    return {
      ...c, outlinePx: c.outlinePx.map(T), innerPx: (c.innerPx || []).map(T), holesPx: (c.holesPx || []).map((h) => h.map(T)),
      basePx: T(c.basePx), tipPx: T(c.tipPx),
      sprouts: (c.sprouts || []).map((sp) => ({ ...sp, px: T(sp.px), dir: [sp.dir[0] * cs - sp.dir[1] * sn, sp.dir[0] * sn + sp.dir[1] * cs] })),
    };
  }

  update(i, patch) {
    this.put('cutouts', this.cuts.map((c, k) => (k === i ? { ...c, ...patch } : c)));
    if (this.tool === 'sprout') this.fillSprouts();
    this.draw();
    this.record();
  }

  // ---- Sprout levels ----
  // Across the top: the level new points get, how many of each the picked mesh has, and the picked level's color.
  fillSprouts() {
    const bar = this.sproutBar;
    const counts = new Array(10).fill(0);
    for (const s of this.cut?.sprouts || []) counts[s.level || 1]++;
    bar.replaceChildren(el('span', 'atlas-sprouts-label', 'Sprout level'));
    for (let lv = 1; lv <= 9; lv++) {
      const b = el('button', 'sprout-chip', String(lv));
      b.style.setProperty('--c', levelColor(lv));
      b.setAttribute('aria-pressed', lv === this.level);
      b.title = `Level ${lv}: ${counts[lv]} on this mesh`;
      if (counts[lv]) b.append(el('small', '', String(counts[lv])));
      b.addEventListener('click', () => { this.level = lv; this.fillSprouts(); });
      bar.append(b);
    }
    const pick = el('input');
    pick.type = 'color';
    pick.value = levelColor(this.level);
    pick.title = `Color of level ${this.level}`;
    pick.setAttribute('aria-label', pick.title);
    const setColor = () => {
      const s = doc.graph.settings;
      s.sproutColors = Array.from({ length: 9 }, (_, i) => levelColor(i + 1));
      s.sproutColors[this.level - 1] = pick.value;
      bar.querySelector('[aria-pressed=true]').style.setProperty('--c', pick.value);
      this.draw();
    };
    pick.addEventListener('input', setColor);
    pick.addEventListener('change', () => { setColor(); this.record(); });
    bar.append(pick);
  }

  sproutAt(x, y) {
    const near = (matchMedia('(pointer: coarse)').matches ? 16 : 10) / this.view.k;
    return (this.cut?.sprouts || []).findIndex((s) => Math.hypot(s.px[0] - x, s.px[1] - y) < near);
  }

  // The arrow tip of each sprout, a fixed distance on screen from its point.
  tipOf(s) { const l = Math.hypot(s.dir[0], s.dir[1]) || 1; const r = 34 / this.view.k; return [s.px[0] + (s.dir[0] / l) * r, s.px[1] + (s.dir[1] / l) * r]; }

  sproutTipAt(x, y) {
    const near = (matchMedia('(pointer: coarse)').matches ? 16 : 9) / this.view.k;
    return (this.cut?.sprouts || []).findIndex((s) => { const t = this.tipOf(s); return Math.hypot(t[0] - x, t[1] - y) < near; });
  }

  // Holding a sprout point (finger or mouse) opens its level menu, the same as a right-click.
  holdFor(e, i) {
    const at = [e.clientX, e.clientY];
    this.cancelHold();
    this.press = setTimeout(() => { this.press = null; this.drag = null; this.levelMenu(at[0], at[1], i); }, 500);
  }

  cancelHold() { clearTimeout(this.press); this.press = null; }

  levelMenu(cx, cy, i) {
    this.closeMenu();
    const m = el('div', 'sprout-menu');
    m.setAttribute('role', 'menu');
    m.style.left = `${Math.min(cx, innerWidth - 170)}px`;
    m.style.top = `${Math.min(cy, innerHeight - 330)}px`;
    const item = (label, color, fn) => {
      const b = el('button', '', label);
      b.setAttribute('role', 'menuitem');
      if (color) b.style.setProperty('--c', color);
      b.addEventListener('click', () => { this.closeMenu(); fn(); });
      m.append(b);
    };
    const c = this.cut;
    const cur = c.sprouts[i]?.level || 1;
    for (let lv = 1; lv <= 9; lv++) {
      item(`${lv === cur ? '✓ ' : ''}Level ${lv}`, levelColor(lv), () => {
        this.update(this.active, { sprouts: c.sprouts.map((s, k) => (k === i ? { ...s, level: lv } : s)) });
      });
    }
    item('Delete', null, () => this.update(this.active, { sprouts: c.sprouts.filter((_, k) => k !== i) }));
    document.body.append(m);
    m.querySelector('button').focus();
    this.menu = m;
    const away = (e) => { if (!m.contains(e.target)) this.closeMenu(); };
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeMenu(); } });
    setTimeout(() => document.addEventListener('pointerdown', away, { capture: true }), 0);
    this.menuAway = away;
  }

  closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    document.removeEventListener('pointerdown', this.menuAway, { capture: true });
    this.menu = null;
  }

  // ---- New meshes ----
  addMesh(shape) {
    const made = this.remesh({ meshMode: 'mixed', ...shape, name: `Mesh ${this.cuts.length + 1}` });
    this.put('cutouts', [...this.cuts, made]);
    this.active = this.cuts.length - 1;
    this.setTool('edit');
    this.fillList();
    this.draw();
    this.record();
  }

  // The + button: a leaf standing in the middle of the view, pivot at the bottom pointing up.
  addLeaf() {
    if (!this.pixels || !this.size) return;
    const { k, x, y } = this.view;
    const cx = (this.size[0] / 2 - x) / k; const cy = (this.size[1] / 2 - y) / k;
    const L = Math.min(this.pixels.height, this.size[1] / k) * 0.35;
    this.addMesh(leafFromLine([cx, cy + L / 2], [cx, cy - L / 2]));
  }

  finishLine([x0, y0, x1, y1]) {
    if (Math.hypot(x1 - x0, y1 - y0) * this.view.k < 8) { this.deps.toast('Drag from where the stem meets the leaf to its tip.'); this.draw(); return; }
    this.addMesh(leafFromLine([x0, y0], [x1, y1]));
  }

  // Rebuilds a mesh from its points. While dragging only the picture updates; the plant rebuilds on release.
  remesh(c) { return meshAs(c, this.pixels.width, this.pixels.height); }

  saveActive(c) {
    const fixed = this.remesh({ ...c, auto: false });
    fixed.sprouts = (fixed.sprouts || []).map((s) => sproutFromPixels(fixed, s.px, s.dir, s.level));
    this.put('cutouts', this.cuts.map((x, i) => (i === this.active ? fixed : x)));
    this.fillList();
    this.draw();
    this.record();
  }

  // ---- Files ----
  exportFile() {
    if (!this.cuts.length) { this.deps.toast('There are no meshes to export yet.'); return; }
    const id = this.node.params.texture;
    downloadText(`${(this.node.name || 'leaf').replace(/[^\w\- ]+/g, '') || 'leaf'}.cutouts.json`, JSON.stringify({ app: 'canopy', kind: 'cutouts', atlas: id, asset: doc.assets[id] || null, cutouts: this.cuts }));
  }

  async importFile() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { data = null; }
    // Files come from outside, so only meshes with the points the editor needs get in.
    const points = (a) => Array.isArray(a) && a.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const list = data?.kind === 'cutouts' && Array.isArray(data.cutouts)
      ? data.cutouts.filter((c) => points(c?.outlinePx) && c.outlinePx.length >= 3 && points([c.basePx, c.tipPx]) && points(c.innerPx || []))
      : null;
    if (!list?.length) { this.deps.toast('That file has no cutouts in it.'); return; }
    if (data.asset?.url && typeof data.asset.url === 'string' && data.asset.url.startsWith('data:image/')) doc.assets[data.atlas] = { name: String(data.asset.name || 'Imported'), url: data.asset.url };
    if (typeof data.atlas === 'string' && textureSource(data.atlas, doc.assets)) {
      this.put('texture', data.atlas);
      this.fillSource();
      await this.loadAtlas();
    }
    this.put('cutouts', [...this.cuts, ...list.map((c) => this.remesh(c))]);
    this.fillList();
    this.draw();
    this.record();
  }

  // ---- View ----
  resize() {
    const host = this.canvas.parentElement.getBoundingClientRect();
    if (!host.width) return;
    const r = Math.min(devicePixelRatio || 1, 2);
    this.ratio = r;
    this.canvas.width = host.width * r; this.canvas.height = host.height * r;
    // CSS sizes are in the editor's own (scaled) pixels; the drawing and the pointer work in screen pixels.
    const box = this.canvas.parentElement;
    this.canvas.style.width = `${box.clientWidth}px`; this.canvas.style.height = `${box.clientHeight}px`;
    this.size = [host.width, host.height];
    this.draw();
  }

  fitView() {
    if (!this.pixels || !this.size) return;
    const k = Math.min(this.size[0] / this.pixels.width, this.size[1] / this.pixels.height) * 0.94;
    this.view = { k, x: (this.size[0] - this.pixels.width * k) / 2, y: (this.size[1] - this.pixels.height * k) / 2 };
    this.draw();
  }

  zoomAt(sx, sy, f) {
    const v = this.view;
    const k = Math.min(60, Math.max(0.02, v.k * f));
    v.x = sx - ((sx - v.x) / v.k) * k;
    v.y = sy - ((sy - v.y) / v.k) * k;
    v.k = k;
    this.draw();
  }

  screen(e) { const b = this.canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
  toImage(e) { const [x, y] = this.screen(e); return [(x - this.view.x) / this.view.k, (y - this.view.y) / this.view.k]; }

  // What's under the pointer on the picked mesh.
  grab(x, y) {
    const c = this.cut;
    if (!c) return null;
    const near = (matchMedia('(pointer: coarse)').matches ? 16 : 9) / this.view.k;
    // The closest wins. Where a point sits exactly on the pivot, the pivot comes first.
    let best = null; let bestD = near;
    const offer = (p, found) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bestD) { bestD = d; best = found; } };
    c.outlinePx.forEach((p, i) => offer(p, { kind: 'outline', i }));
    (c.innerPx || []).forEach((p, i) => offer(p, { kind: 'inner', i }));
    (c.holesPx || []).forEach((h, hi) => h.forEach((p, i) => offer(p, { kind: 'hole', h: hi, i })));
    bestD += 1e-6;
    offer(c.tipPx, { kind: 'tip' });
    offer(c.basePx, { kind: 'base' });
    return best;
  }

  pickAt(x, y) { return this.cuts.findIndex((c) => inPoly(c.outlinePx, x, y)); }

  removePoint(g) {
    const c = this.cut;
    if (!c || !g) return;
    if (g.kind === 'outline' && c.outlinePx.length <= 3) { this.deps.toast('A mesh needs at least three outline points.'); return; }
    if (g.kind === 'outline' || g.kind === 'inner') this.saveActive(removeCutoutPoint(c, g.kind, g.i));
    if (g.kind === 'hole') {
      // A hole needs three points; one with fewer goes.
      const holes = c.holesPx.map((h, k) => (k === g.h ? h.filter((_, j) => j !== g.i) : h)).filter((h) => h.length >= 3);
      this.saveActive({ ...c, holesPx: holes, faces: null });
    }
  }

  // A finished hole is saved on the picked mesh, which then joins as triangles around it.
  closeHole() {
    const c = this.cut;
    // A double-click leaves its last point twice, so near-duplicates go.
    const pts = this.hole.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) * this.view.k > 3);
    this.hole = [];
    if (!c || pts.length < 3) { this.draw(); return; }
    if (!pts.every((p) => inPoly(c.outlinePx, p[0], p[1]))) { this.deps.toast('A hole has to sit inside the mesh.'); this.draw(); return; }
    // Inner points inside the hole or on its edge would have nothing to join, so they go.
    const edge = 10 / this.view.k;
    const innerPx = (c.innerPx || []).filter((q) => !inPoly(pts, q[0], q[1]) && pts.every((p, i) => segDist(q, p, pts[(i + 1) % pts.length]) > edge));
    this.saveActive({ ...c, innerPx, faces: null, holesPx: [...(c.holesPx || []), pts] });
    this.setTool('edit');
  }

  doubleClick(e) {
    const [x, y] = this.toImage(e);
    if (this.tool === 'hole') { if (this.hole.length >= 3) this.closeHole(); return; }
    if (this.tool === 'sprout') {
      const c = this.cut;
      const near = 10 / this.view.k;
      const i = (c?.sprouts || []).findIndex((s) => Math.hypot(s.px[0] - x, s.px[1] - y) < near);
      if (i >= 0) this.update(this.active, { sprouts: c.sprouts.filter((_, k) => k !== i) });
      return;
    }
    if (this.tool === 'edit') this.removePoint(this.grab(x, y));
  }

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const s = this.screen(e);
    this.touches.set(e.pointerId, s);
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    const [x, y] = this.toImage(e);
    if (this.widgetPress(s, e)) { this.draw(); return; }
    if (this.tool === 'select' && e.button === 0) {
      this.active = this.pickAt(x, y);
      if (this.active >= 0) this.drag = { xform: structuredClone(this.cut), pivot: this.widgets().pivot, start: [x, y] };
      this.markList();
      return;
    }
    if (e.button === 2 && this.tool === 'sprout') {
      const i = this.sproutAt(x, y);
      if (i >= 0) { this.levelMenu(e.clientX, e.clientY, i); return; }
    }
    if (e.button === 1 || e.button === 2) { this.drag = { pan: s, moved: false, at: [x, y] }; return; }
    if (this.tool === 'add') { this.drag = { line: [x, y, x, y] }; this.draw(); return; }
    if (this.tool === 'hole') {
      const c = this.cut;
      if (!c || (!this.hole.length && !inPoly(c.outlinePx, x, y))) { this.active = this.pickAt(x, y); this.markList(); this.draw(); return; }
      const first = this.hole[0];
      if (first && this.hole.length >= 3 && Math.hypot(first[0] - x, first[1] - y) * this.view.k < 10) { this.closeHole(); return; }
      this.hole.push([x, y]);
      this.draw();
      return;
    }
    if (this.tool === 'sprout') {
      const c = this.cut;
      // An existing point moves, its arrow tip aims it; holding either opens the level menu.
      const i = this.sproutAt(x, y);
      if (i >= 0) { this.drag = { sproutMove: i, start: [x, y], moved: false }; this.holdFor(e, i); return; }
      const tip = this.sproutTipAt(x, y);
      if (tip >= 0) { this.drag = { sproutTip: tip, start: [x, y], moved: false }; this.holdFor(e, tip); return; }
      const inside = c && inPoly(c.outlinePx, x, y);
      if (!inside) { this.active = this.pickAt(x, y); this.markList(); this.draw(); return; }
      this.drag = { sprout: true, start: [x, y], end: [x, y] };
      return;
    }
    // Edit: points, then the edge, then inside. Anywhere else picks whatever mesh is there.
    const g = this.grab(x, y);
    // A point that is one of several picked moves them all; Shift adds or drops a point from the pick.
    if (g && e.shiftKey && g.kind !== 'base' && g.kind !== 'tip') { this.togglePick(ptKey(g)); this.draw(); return; }
    if (g && this.picks.has(ptKey(g)) && this.picks.size > 1) { this.drag = { group: this.pickedPoints().map((q) => ({ ...q, from: [...q.p] })), start: [x, y], moved: false }; return; }
    if (g) { this.picks.clear(); this.drag = { point: g, start: [x, y], moved: false }; return; }
    const c = this.cut;
    // Shift-drag anywhere draws a box around points to pick.
    if (c && e.shiftKey) { this.drag = { marquee: [x, y, x, y], add: true }; return; }
    if (c) {
      const near = 8 / this.view.k;
      let edge = -1; let best = near;
      c.outlinePx.forEach((p, i) => { const d = segDist([x, y], p, c.outlinePx[(i + 1) % c.outlinePx.length]); if (d < best) { best = d; edge = i; } });
      if (edge >= 0) {
        this.node.params.cutouts[this.active] = this.remesh(addOutlinePoint(c, edge, [x, y]));
        this.drag = { point: { kind: 'outline', i: edge + 1 }, start: [x, y], moved: true };
        this.draw();
        return;
      }
      for (let h = 0; h < (c.holesPx || []).length; h++) {
        const loop = c.holesPx[h];
        const e2 = loop.findIndex((p, i) => segDist([x, y], p, loop[(i + 1) % loop.length]) < near);
        if (e2 < 0) continue;
        const holesPx = c.holesPx.map((l, k) => (k === h ? [...l.slice(0, e2 + 1), [x, y], ...l.slice(e2 + 1)] : l));
        this.node.params.cutouts[this.active] = this.remesh({ ...c, holesPx, faces: null });
        this.drag = { point: { kind: 'hole', h, i: e2 + 1 }, start: [x, y], moved: true };
        this.draw();
        return;
      }
      // Inside, a click adds a point and a drag draws a box to pick points; outside, a click picks another mesh.
      const inside = inPoly(c.outlinePx, x, y) && !(c.holesPx || []).some((h) => inPoly(h, x, y));
      this.drag = { pending: inside ? 'inner' : 'pick', start: [x, y], at: s };
      return;
    }
    this.pickMeshAt(x, y);
  }

  pickMeshAt(x, y) {
    this.active = this.pickAt(x, y);
    this.picks.clear();
    this.markList();
    this.draw();
  }

  // ---- Picked points (several at once, by box or Shift) ----
  togglePick(k) { if (this.picks.has(k)) this.picks.delete(k); else this.picks.add(k); }
  // Every editable point of the picked mesh with its key, place and a way to set it.
  allPoints() {
    const c = this.cut; if (!c) return [];
    return [
      ...c.outlinePx.map((p, i) => ({ k: `outline:${i}`, p, set: (v) => { c.outlinePx[i] = v; } })),
      ...(c.innerPx || []).map((p, i) => ({ k: `inner:${i}`, p, set: (v) => { c.innerPx[i] = v; } })),
      ...(c.holesPx || []).flatMap((h, hi) => h.map((p, i) => ({ k: `hole:${hi}:${i}`, p, set: (v) => { c.holesPx[hi][i] = v; } }))),
    ];
  }
  pickedPoints() { return this.allPoints().filter((q) => this.picks.has(q.k)); }

  move(e) {
    if (!this.drag) return;
    const s = this.screen(e);
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, s);
    const d = this.drag;
    if (d.pinch !== undefined) {
      if (this.touches.size < 2) return;
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      this.view.x += mid[0] - d.mid[0]; this.view.y += mid[1] - d.mid[1];
      this.zoomAt(mid[0], mid[1], dist / Math.max(d.pinch, 1));
      d.pinch = dist; d.mid = mid;
      return;
    }
    if (d.pan) {
      if (Math.hypot(s[0] - d.pan[0], s[1] - d.pan[1]) > 3) d.moved = true;
      if (d.moved) { this.view.x += s[0] - d.pan[0]; this.view.y += s[1] - d.pan[1]; d.pan = s; this.draw(); }
      return;
    }
    const [x, y] = this.toImage(e);
    if (d.pending) {
      if (Math.hypot(s[0] - d.at[0], s[1] - d.at[1]) < 5) return;
      this.drag = { marquee: [d.start[0], d.start[1], x, y] };
      this.draw();
      return;
    }
    if (d.marquee) { d.marquee[2] = x; d.marquee[3] = y; this.draw(); return; }
    if (d.group) {
      if (!d.moved && Math.hypot(x - d.start[0], y - d.start[1]) * this.view.k < 3) return;
      d.moved = true;
      const pts = this.allPoints();
      for (const q of d.group) pts.find((o) => o.k === q.k)?.set([q.from[0] + x - d.start[0], q.from[1] + y - d.start[1]]);
      this.node.params.cutouts[this.active] = this.remesh(this.cut);
      this.draw();
      return;
    }
    if (d.xform) {
      const o = d.turn
        ? { a: Math.atan2(y - d.pivot[1], x - d.pivot[0]) - d.a0, f: Math.max(0.05, Math.hypot(x - d.pivot[0], y - d.pivot[1]) / Math.max(d.d0, 1e-3)) }
        : { dx: x - d.start[0], dy: y - d.start[1] };
      d.moved = true;
      this.node.params.cutouts[this.active] = this.transformed(d.xform, d.pivot, o);
      this.draw();
      return;
    }
    if (d.sproutMove !== undefined || d.sproutTip !== undefined) {
      if (!d.moved && Math.hypot(x - d.start[0], y - d.start[1]) * this.view.k < 5) return;
      d.moved = true;
      this.cancelHold();
      const sp = this.cut.sprouts[d.sproutMove ?? d.sproutTip];
      if (d.sproutMove !== undefined) sp.px = [x, y]; else sp.dir = [x - sp.px[0], y - sp.px[1]];
    } else if (d.line) { d.line[2] = x; d.line[3] = y; } else if (d.sprout) { d.end = [x, y]; } else if (d.point) {
      const c = this.cut;
      if (!d.moved && Math.hypot(x - d.start[0], y - d.start[1]) * this.view.k < 3) return;
      d.moved = true;
      if (d.point.kind === 'base') c.basePx = [x, y];
      else if (d.point.kind === 'tip') c.tipPx = [x, y];
      else if (d.point.kind === 'outline') c.outlinePx[d.point.i] = [x, y];
      else if (d.point.kind === 'hole') c.holesPx[d.point.h][d.point.i] = [x, y];
      else c.innerPx[d.point.i] = [x, y];
      this.node.params.cutouts[this.active] = this.remesh(c);
    }
    this.draw();
  }

  up(e) {
    this.touches.delete(e.pointerId);
    this.cancelHold();
    const d = this.drag;
    if (!d) return;
    if (d.pinch !== undefined) { if (!this.touches.size) this.drag = null; return; }
    this.drag = null;
    if (d.pan) { if (!d.moved) this.removePoint(this.grab(d.at[0], d.at[1])); return; }
    if (d.pending === 'pick') { this.pickMeshAt(d.start[0], d.start[1]); return; }
    if (d.pending === 'inner') { this.picks.clear(); this.saveActive(addInnerPoint(this.cut, d.start)); return; }
    if (d.marquee) {
      const [x0, y0, x1, y1] = d.marquee;
      if (!d.add) this.picks.clear();
      for (const q of this.allPoints()) if (q.p[0] >= Math.min(x0, x1) && q.p[0] <= Math.max(x0, x1) && q.p[1] >= Math.min(y0, y1) && q.p[1] <= Math.max(y0, y1)) this.picks.add(q.k);
      this.draw();
      return;
    }
    if (d.group) { if (d.moved) this.saveActive(this.cut); return; }
    if (d.line) { this.finishLine(d.line); return; }
    if (d.xform) { if (d.moved) this.saveActive(this.cut); return; }
    if (d.sproutMove !== undefined || d.sproutTip !== undefined) {
      if (!d.moved) return;
      const c = this.cut; const i = d.sproutMove ?? d.sproutTip; const sp = c.sprouts[i];
      this.update(this.active, { sprouts: c.sprouts.map((s, k) => (k === i ? sproutFromPixels(c, sp.px, sp.dir, sp.level) : s)) });
      return;
    }
    if (d.sprout) { this.finishSprout(d); return; }
    if (d.point && d.moved) this.saveActive(this.cut);
  }

  // Without a drag, a new point aims away from the leaf's pivot.
  finishSprout(d) {
    const c = this.cut;
    const moved = Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) * this.view.k > 8;
    const px = d.start;
    const dir = moved ? [d.end[0] - px[0], d.end[1] - px[1]] : [px[0] - c.basePx[0], px[1] - c.basePx[1]];
    this.update(this.active, { sprouts: [...(c.sprouts || []), sproutFromPixels(c, px, dir, this.level)] });
  }

  // ---- Drawing ----
  drawMesh(c, cut, on, dashed) {
    const k = this.view.k;
    const all = [...cut.outlinePx, ...(cut.innerPx || []), ...(cut.holesPx || []).flat()];
    c.globalAlpha = cut.enabled === false ? 0.35 : 1;
    c.strokeStyle = dashed ? '#ffffff' : on ? '#ffe45c' : '#7fff6a';
    if (dashed) c.setLineDash([6 / k, 5 / k]);
    c.lineWidth = (on ? 2 : 1.25) / k;
    const path = () => {
      c.beginPath();
      for (const loop of [cut.outlinePx, ...(cut.holesPx || [])]) {
        loop.forEach((p, i) => { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
        c.closePath();
      }
    };
    if (!dashed) { path(); c.fillStyle = on ? 'rgba(255,228,92,.22)' : 'rgba(127,255,106,.12)'; c.fill('evenodd'); }
    c.beginPath();
    cut.outlinePx.forEach((p, i) => { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    c.closePath();
    c.stroke();
    c.setLineDash([]);
    // Holes: the negative space inside a mesh.
    c.strokeStyle = '#ff7a6b';
    c.setLineDash([5 / k, 4 / k]);
    for (const h of cut.holesPx || []) {
      c.beginPath();
      h.forEach((p, i) => { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
      c.closePath();
      c.stroke();
    }
    c.setLineDash([]);
    // The inner edges show what the leaf costs and where it can fold.
    const t = cut.mesh?.tris;
    if (cut.faces) {
      c.globalAlpha *= 0.55;
      c.lineWidth = 1 / k;
      c.beginPath();
      for (const f of cut.faces) {
        f.forEach((i, j) => { const p = all[i]; if (j) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
        c.closePath();
      }
      c.stroke();
    } else if (t) {
      c.globalAlpha *= 0.5;
      c.lineWidth = 1 / k;
      c.beginPath();
      for (let i = 0; i + 2 < t.length; i += 3) {
        const [a, b, d] = [all[t[i]], all[t[i + 1]], all[t[i + 2]]];
        c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.closePath();
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  draw() {
    const c = this.ctx;
    const { pixels, image, ratio, view, size } = this;
    if (!pixels || !image || !size) return;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, size[0], size[1]);
    c.setTransform(ratio * view.k, 0, 0, ratio * view.k, ratio * view.x, ratio * view.y);
    const k = view.k;
    c.imageSmoothingEnabled = k < 4;
    c.drawImage(this.bgImages?.[this.bg] || image, 0, 0, pixels.width, pixels.height);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1 / k;
    c.strokeRect(0, 0, pixels.width, pixels.height);
    this.cuts.forEach((cut, i) => this.drawMesh(c, cut, i === this.active, false));
    for (const cut of this.preview || []) this.drawMesh(c, cut, false, true);
    const cut = this.cut;
    if (cut) {
      const d = 5 / k;
      if (this.tool === 'edit') {
        c.fillStyle = '#ffe45c';
        for (const p of cut.outlinePx) { c.beginPath(); c.arc(p[0], p[1], d * 0.85, 0, 7); c.fill(); }
        c.fillStyle = '#ffffff';
        for (const p of cut.innerPx || []) { c.beginPath(); c.arc(p[0], p[1], d * 0.7, 0, 7); c.fill(); }
        c.fillStyle = '#ff7a6b';
        for (const h of cut.holesPx || []) for (const p of h) { c.beginPath(); c.arc(p[0], p[1], d * 0.8, 0, 7); c.fill(); }
        // Picked points ringed in orange; the box while it is drawn.
        c.strokeStyle = '#ff9d2e'; c.lineWidth = 2 / k;
        for (const q of this.pickedPoints()) { c.beginPath(); c.arc(q.p[0], q.p[1], d * 1.5, 0, 7); c.stroke(); }
        const mq = this.drag?.marquee;
        if (mq) {
          c.setLineDash([5 / k, 4 / k]); c.fillStyle = 'rgba(255,157,46,.08)';
          c.fillRect(Math.min(mq[0], mq[2]), Math.min(mq[1], mq[3]), Math.abs(mq[2] - mq[0]), Math.abs(mq[3] - mq[1]));
          c.strokeRect(Math.min(mq[0], mq[2]), Math.min(mq[1], mq[3]), Math.abs(mq[2] - mq[0]), Math.abs(mq[3] - mq[1]));
          c.setLineDash([]);
        }
      }
      // The pivot and the way the leaf points.
      arrow(c, cut.basePx, cut.tipPx, '#ff6a5c', k);
      c.fillStyle = '#ff6a5c';
      c.beginPath(); c.arc(cut.basePx[0], cut.basePx[1], d * 1.3, 0, 7); c.fill();
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold ${9 / k}px sans-serif`;
      for (const s of cut.sprouts || []) {
        const col = levelColor(s.level || 1);
        const tip = this.tipOf(s);
        arrow(c, s.px, tip, col, k);
        c.fillStyle = col;
        c.beginPath(); c.arc(s.px[0], s.px[1], d * 1.3, 0, 7); c.fill();
        if (this.tool === 'sprout') { c.beginPath(); c.arc(tip[0], tip[1], d * 0.7, 0, 7); c.fill(); }
        c.fillStyle = '#0b0f0a';
        c.fillText(String(s.level || 1), s.px[0], s.px[1]);
      }
      if (this.drag?.sprout) arrow(c, this.drag.start, this.drag.end, levelColor(this.level), k);
    }
    if (this.hole.length) {
      c.strokeStyle = '#ff7a6b'; c.lineWidth = 2 / k;
      c.beginPath();
      this.hole.forEach((p, i) => { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
      c.stroke();
      c.fillStyle = '#ff7a6b';
      for (const p of this.hole) { c.beginPath(); c.arc(p[0], p[1], 4 / k, 0, 7); c.fill(); }
    }
    if (this.drag?.line) {
      const [x0, y0, x1, y1] = this.drag.line;
      if (Math.hypot(x1 - x0, y1 - y0) * k > 8) this.drawMesh(c, leafFromLine([x0, y0], [x1, y1]), false, true);
      arrow(c, [x0, y0], [x1, y1], '#ff6a5c', k);
    }
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.drawWidgets(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}

