// The texture packer: every cutout of the chosen materials laid out on one square, like a UV editor. Each piece
// moves by its middle dot and turns and scales by the dot on its ring (both work with a finger). Packing draws
// every map of every piece into one set of textures, turns normals with their pieces, and can move the plant
// over to the new material.
import { doc, commit, changed } from './doc.js';
import { el, numberField } from './fields.js';
import { atlasPixels, textureSource } from './textures.js';
import { meshCutout } from '../leaf/cutout.js';
import { rotateNormal } from '../leaf/imgops.js';
import { sproutFromPixels } from './sprout.js';
import { EXPORT_DEFAULTS, exportFields, saveMaps, fold, sizeOf, withDefaults } from './texout.js';

const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};

// Shelf packing at one scale for all pieces (so texel density stays even), as large as still fits the sheet:
// `aspect` wide (its width over its height) and 1 high.
export function autoPack(list, pad = 0.01, aspect = 1) {
  if (!list.length) return list;
  const order = [...list].sort((a, b) => b.h - a.h);
  const fits = (k) => {
    let x = pad; let y = pad; let row = 0;
    const at = [];
    for (const it of order) {
      const w = it.w * k; const h = it.h * k;
      if (x + w + pad > aspect) { x = pad; y += row + pad; row = 0; }
      if (x + w + pad > aspect || y + h + pad > 1) return null;
      at.push([it, x + w / 2, y + h / 2]);
      x += w + pad; row = Math.max(row, h);
    }
    return at;
  };
  let lo = 0; let hi = Math.max(1, aspect) / Math.max(...list.map((i) => Math.max(i.w, i.h)));
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  for (const [it, cx, cy] of fits(lo) || []) Object.assign(it, { cx, cy, k: lo, rot: 0 });
  return list;
}

// Where a point of a piece's source picture lands on the packed sheet, S pixels high.
export function place(it, [px, py], S = 1) {
  const c = Math.cos(it.rot); const s = Math.sin(it.rot);
  const x = (px - it.sc[0]) * it.k; const y = (py - it.sc[1]) * it.k;
  return [(it.cx + x * c - y * s) * S, (it.cy + x * s + y * c) * S];
}

function bounds(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

// A gray picture of one channel of a map, as a canvas for drawing.
async function channelCanvas(name, ch) {
  const img = await atlasPixels(name, doc.assets);
  if (!img) return null;
  const k = 'RGBA'.indexOf(ch || 'R');
  for (let i = 0; i < img.data.length; i += 4) { const v = img.data[i + k]; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

export class TexturePacker {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.side = root.querySelector('.pack-body');
    this.view = { x: 0, y: 0, k: 400 };
    this.images = new Map();
    this.sel = -1;
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.querySelector('[data-pack]').addEventListener('click', () => this.packAndSave());
    // A new sheet size reshapes the sheet and lays the pieces out again to fit it.
    this.side.addEventListener('change', async () => {
      if (this.aspect === this.shownAspect) return;
      this.shownAspect = this.aspect;
      await this.sync(true); this.fit(); this.draw();
    });
    for (const [k, d] of [['remap', true], ['prune', false]]) {
      const box = root.querySelector(`[data-${k}]`);
      box.addEventListener('change', () => { this.state[k] = box.checked; });
      this.boxes = { ...this.boxes, [k]: [box, d] };
    }
    root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && e.target.tagName !== 'INPUT') this.close(); });
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = this.screen(e);
      const f = Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002);
      const v = this.view; const k = Math.min(8000, Math.max(50, v.k * f));
      v.x = sx - ((sx - v.x) / v.k) * k; v.y = sy - ((sy - v.y) / v.k) * k; v.k = k;
      this.draw();
    }, { passive: false });
    new ResizeObserver(() => { if (this.isOpen()) this.resize(); }).observe(c.parentElement);
  }

  isOpen() { return !this.root.hidden; }

  get state() {
    const p = (doc.graph.pack ||= { mats: null, items: [] });
    p.settings = withDefaults(p.settings, { ...EXPORT_DEFAULTS, name: 'Packed' });
    return p;
  }

  // Materials that have cutouts can be packed.
  get candidates() { return (doc.graph.materials || []).filter((m) => m.texture && m.cutouts?.length); }

  get aspect() { const [W, H] = sizeOf(this.state.settings); return W / H; }

  async open() {
    this.root.hidden = false;
    const s = this.state;
    for (const [k, [box, d]] of Object.entries(this.boxes)) box.checked = s[k] ?? d;
    s.mats ||= this.candidates.map((m) => m.id);
    await this.sync();
    this.shownAspect = this.aspect;
    this.resize();
    this.fit();
    this.render();
  }

  close() { this.root.hidden = true; commit(); }

  // One piece per enabled cutout of the chosen materials; pieces already placed keep their place.
  async sync(repack = false) {
    const s = this.state;
    const old = new Map(s.items.map((it) => [`${it.mat}|${it.cut}`, it]));
    const items = [];
    let fresh = false;
    for (const m of this.candidates.filter((x) => s.mats.includes(x.id))) {
      if (!this.images.has(m.texture)) this.images.set(m.texture, await textureSource(m.texture, doc.assets));
      for (const c of m.cutouts.filter((x) => x.enabled !== false && !s.skip?.includes(`${m.id}|${x.id}`))) {
        const [x0, y0, x1, y1] = bounds(c.outlinePx);
        const it = old.get(`${m.id}|${c.id}`) || { mat: m.id, cut: c.id, cx: 0.5, cy: 0.5, rot: 0, k: 0 };
        if (!old.has(`${m.id}|${c.id}`)) fresh = true;
        Object.assign(it, { w: x1 - x0, h: y1 - y0, sc: [(x0 + x1) / 2, (y0 + y1) / 2] });
        items.push(it);
      }
    }
    if (fresh || repack) autoPack(items, s.pad ?? 0.01, this.aspect);
    s.items = items;
    this.sel = Math.min(this.sel, items.length - 1);
  }

  partOf(it) {
    const m = doc.graph.materials.find((x) => x.id === it.mat);
    return { m, c: m?.cutouts.find((x) => x.id === it.cut) };
  }

  render() {
    const s = this.state;
    const b = this.side;
    b.replaceChildren();
    const mats = [];
    const cands = this.candidates;
    if (!cands.length) mats.push(el('p', 'empty', 'No materials with cutouts yet. Make cutouts in the cutout editor first.'));
    for (const m of cands) {
      const row = el('label', 'field check');
      const box = el('input'); box.type = 'checkbox'; box.checked = s.mats.includes(m.id);
      box.addEventListener('change', async () => { s.mats = box.checked ? [...s.mats, m.id] : s.mats.filter((x) => x !== m.id); await this.sync(); this.render(); this.draw(); });
      row.append(box, el('span', '', `${m.name} (${m.cutouts.length})`));
      mats.push(row);
      // Its cutouts in a list that drops open; all are packed until one is unticked.
      if (!s.mats.includes(m.id)) continue;
      const cuts = m.cutouts.filter((x) => x.enabled !== false);
      const skipped = cuts.filter((c) => s.skip?.includes(`${m.id}|${c.id}`)).length;
      const drop = el('details', 'pack-cuts');
      drop.append(el('summary', '', `Cutouts: ${cuts.length - skipped} of ${cuts.length}`));
      cuts.forEach((c, i) => {
        const key = `${m.id}|${c.id}`;
        const line = el('label', 'field check');
        const tick = el('input'); tick.type = 'checkbox'; tick.checked = !s.skip?.includes(key);
        tick.addEventListener('change', async () => {
          s.skip = tick.checked ? (s.skip || []).filter((x) => x !== key) : [...(s.skip || []), key];
          await this.sync(); this.render(); this.draw();
          this.side.querySelectorAll('.pack-cuts')[[...cands.filter((x) => s.mats.includes(x.id))].indexOf(m)]?.setAttribute('open', '');
        });
        line.append(tick, el('span', '', c.name || `Cutout ${i + 1}`));
        drop.append(line);
      });
      mats.push(drop);
    }
    const auto = el('button', 'wide', 'Auto pack');
    auto.addEventListener('click', async () => { await this.sync(true); this.draw(); commit(); });
    const layout = [numberField('Padding', (s.pad ?? 0.01) * 100, { min: 0, max: 10, unit: '%' }, (v) => { s.pad = v / 100; }), auto];
    const it = s.items[this.sel];
    if (it) {
      const { c } = this.partOf(it);
      layout.push(el('h4', 'section', c?.name || 'Piece'),
        numberField('Rotation', Math.round((it.rot * 180) / Math.PI), { unit: '°' }, (v) => { it.rot = (v * Math.PI) / 180; this.draw(); }),
        numberField('Scale %', Math.round(it.k * 1e5) / 1e3, { min: 0.001 }, (v) => { it.k = v / 100; this.draw(); }));
    }
    b.append(fold('Materials', mats), fold('Layout', layout), ...exportFields(s.settings, { only: ['color', 'normal', 'roughness', 'ao', 'subsurface'] }));
    this.root.querySelector('[data-pack]').disabled = !s.items.length;
  }

  // ---- View ----
  resize() {
    const host = this.canvas.parentElement.getBoundingClientRect();
    if (!host.width) return;
    const r = Math.min(devicePixelRatio || 1, 2);
    this.ratio = r;
    this.canvas.width = host.width * r; this.canvas.height = host.height * r;
    this.canvas.style.width = `${host.width}px`; this.canvas.style.height = `${host.height}px`;
    this.size = [host.width, host.height];
    this.draw();
  }

  fit() {
    if (!this.size) return;
    const a = this.aspect;
    const k = Math.min(this.size[0] / a, this.size[1]) * 0.9;
    this.view = { k, x: (this.size[0] - k * a) / 2, y: (this.size[1] - k) / 2 };
    this.draw();
  }

  screen(e) { const b = this.canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
  toUnit([sx, sy]) { return [(sx - this.view.x) / this.view.k, (sy - this.view.y) / this.view.k]; }

  ringOf(it) {
    const R = 0.25 * Math.hypot(it.w, it.h) * it.k + 10 / this.view.k;
    const a = it.rot - Math.PI / 2;
    return { R, dot: [it.cx + R * Math.cos(a), it.cy + R * Math.sin(a)] };
  }

  hit(u) {
    const items = this.state.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const { c } = this.partOf(it);
      if (!c) continue;
      const cs = Math.cos(-it.rot); const sn = Math.sin(-it.rot);
      const x = (u[0] - it.cx) / it.k; const y = (u[1] - it.cy) / it.k;
      if (inPoly(c.outlinePx, x * cs - y * sn + it.sc[0], x * sn + y * cs + it.sc[1])) return i;
    }
    return -1;
  }

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const s = this.screen(e); const u = this.toUnit(s);
    if (e.button === 1 || e.button === 2) { this.drag = { pan: s }; return; }
    const near = (matchMedia('(pointer: coarse)').matches ? 18 : 10) / this.view.k;
    const it = this.state.items[this.sel];
    if (it) {
      const { dot } = this.ringOf(it);
      if (Math.hypot(dot[0] - u[0], dot[1] - u[1]) < near) {
        this.drag = { ring: it, a0: Math.atan2(u[1] - it.cy, u[0] - it.cx), d0: Math.hypot(u[0] - it.cx, u[1] - it.cy), rot0: it.rot, k0: it.k };
        return;
      }
      if (Math.hypot(it.cx - u[0], it.cy - u[1]) < near) { this.drag = { item: it, u, c0: [it.cx, it.cy] }; return; }
    }
    const i = this.hit(u);
    this.sel = i;
    if (i >= 0) { const t = this.state.items[i]; this.drag = { item: t, u, c0: [t.cx, t.cy] }; }
    this.render();
    this.draw();
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const s = this.screen(e); const u = this.toUnit(s);
    if (d.pan) { this.view.x += s[0] - d.pan[0]; this.view.y += s[1] - d.pan[1]; d.pan = s; } else if (d.ring) {
      const it = d.ring;
      it.rot = d.rot0 + Math.atan2(u[1] - it.cy, u[0] - it.cx) - d.a0;
      it.k = Math.max(1e-6, d.k0 * (Math.hypot(u[0] - it.cx, u[1] - it.cy) / Math.max(d.d0, 1e-6)));
    } else if (d.item) { d.item.cx = d.c0[0] + u[0] - d.u[0]; d.item.cy = d.c0[1] + u[1] - d.u[1]; }
    this.draw();
  }

  up() { if (this.drag && !this.drag.pan) { this.render(); commit(); } this.drag = null; }

  // ---- Drawing ----
  outline(c, it, cut, S = 1) {
    c.beginPath();
    for (const loop of [cut.outlinePx, ...(cut.holesPx || [])]) {
      loop.forEach((p, i) => { const q = place(it, p, S); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
      c.closePath();
    }
  }

  draw() {
    const c = this.ctx; const { view, ratio, size } = this;
    if (!size) return;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, size[0], size[1]);
    c.setTransform(ratio * view.k, 0, 0, ratio * view.k, ratio * view.x, ratio * view.y);
    const px = 1 / view.k;
    // The sheet keeps its own shape: square grid cells across its width and height.
    const a = this.aspect;
    c.fillStyle = 'rgba(255,255,255,.04)'; c.fillRect(0, 0, a, 1);
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = px;
    c.beginPath();
    for (let i = 1; i < 8 * a; i++) { c.moveTo(i / 8, 0); c.lineTo(i / 8, 1); }
    for (let i = 1; i < 8; i++) { c.moveTo(0, i / 8); c.lineTo(a, i / 8); }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.strokeRect(0, 0, a, 1);
    this.state.items.forEach((it, i) => {
      const { m, c: cut } = this.partOf(it);
      if (!cut) return;
      const img = this.images.get(m.texture);
      c.save();
      this.outline(c, it, cut);
      c.clip('evenodd');
      if (img) {
        c.translate(it.cx, it.cy); c.rotate(it.rot); c.scale(it.k, it.k); c.translate(-it.sc[0], -it.sc[1]);
        c.drawImage(img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height);
      }
      c.restore();
      this.outline(c, it, cut);
      c.strokeStyle = i === this.sel ? '#ffe45c' : 'rgba(127,255,106,.8)'; c.lineWidth = (i === this.sel ? 2 : 1) * px;
      c.stroke();
    });
    const it = this.state.items[this.sel];
    if (it) {
      const { R, dot } = this.ringOf(it);
      c.strokeStyle = 'rgba(255,228,92,.8)'; c.lineWidth = 1.5 * px;
      c.beginPath(); c.arc(it.cx, it.cy, R, 0, 7); c.stroke();
      c.fillStyle = '#ffe45c';
      c.beginPath(); c.arc(it.cx, it.cy, 6 * px, 0, 7); c.fill();
      c.beginPath(); c.arc(dot[0], dot[1], 7 * px, 0, 7); c.fill();
      c.fillStyle = '#11160f';
      c.beginPath(); c.arc(dot[0], dot[1], 2.5 * px, 0, 7); c.fill();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- Packing ----
  async sources(m) {
    const color = this.images.get(m.texture) || await textureSource(m.texture, doc.assets);
    const tw = color.naturalWidth || color.width; const th = color.naturalHeight || color.height;
    const pix = await atlasPixels(m.texture, doc.assets);
    const ownAlpha = pix.data.some((v, i) => i % 4 === 3 && v < 250);
    const sameAlpha = m.opacityMap === m.texture && (m.opacityCh || 'A') === 'A';
    return {
      tw, th, color,
      opacity: m.opacityMap && !sameAlpha ? await channelCanvas(m.opacityMap, m.opacityCh) : ownAlpha ? await channelCanvas(m.texture, 'A') : null,
      normal: m.normalMap ? await textureSource(m.normalMap, doc.assets) : null,
      roughness: m.roughMap ? await channelCanvas(m.roughMap, m.roughCh) : null,
      ao: m.aoMap ? await channelCanvas(m.aoMap, m.aoCh) : null,
      subsurface: m.sssMap ? await channelCanvas(m.sssMap, m.sssCh) : null,
    };
  }

  async compose(W, S) {
    const items = this.state.items;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = S; return c.getContext('2d', { willReadFrequently: true }); };
    const ctx = { color: mk(), opacity: mk(), roughness: mk(), ao: mk(), subsurface: mk() };
    const tmp = mk();
    const normal = new ImageData(W, S);
    for (let i = 0; i < W * S; i++) normal.data.set([128, 128, 255, 0], i * 4);
    const src = new Map();
    for (const it of items) {
      const { m, c: cut } = this.partOf(it);
      if (!cut) continue;
      if (!src.has(m.id)) src.set(m.id, await this.sources(m));
      const s = src.get(m.id);
      const paint = (g, img, fill) => {
        g.save();
        this.outline(g, it, cut, S);
        g.clip('evenodd');
        g.translate(it.cx * S, it.cy * S); g.rotate(it.rot); g.scale(it.k * S, it.k * S); g.translate(-it.sc[0], -it.sc[1]);
        if (img) g.drawImage(img, 0, 0, s.tw, s.th); else { g.fillStyle = fill; g.fillRect(0, 0, s.tw, s.th); }
        g.restore();
      };
      paint(ctx.color, s.color, m.color || '#ffffff');
      paint(ctx.opacity, s.opacity, '#ffffff');
      paint(ctx.roughness, s.roughness, m.roughColor || '#b3b3b3');
      paint(ctx.ao, s.ao, m.aoColor || '#ffffff');
      paint(ctx.subsurface, s.subsurface, m.sssColor || '#000000');
      // Normals turn with their piece, so the light still comes from the same side.
      const [x0, y0, x1, y1] = bounds(cut.outlinePx.map((p) => place(it, p, S)));
      const bx = Math.max(0, Math.floor(x0)); const by = Math.max(0, Math.floor(y0));
      const bw = Math.min(W, Math.ceil(x1) + 1) - bx; const bh = Math.min(S, Math.ceil(y1) + 1) - by;
      if (bw <= 0 || bh <= 0) continue;
      tmp.clearRect(0, 0, W, S);
      paint(tmp, s.normal, '#8080ff');
      const d = tmp.getImageData(bx, by, bw, bh).data;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const p = (y * bw + x) * 4; const a = d[p + 3] / 255;
          if (!a) continue;
          // The picture turns clockwise on screen (y down), which is the other way for normals (y up).
          const [r, g] = rotateNormal(d[p], d[p + 1], -it.rot);
          const q = ((by + y) * W + bx + x) * 4;
          normal.data[q] = normal.data[q] * (1 - a) + r * a;
          normal.data[q + 1] = normal.data[q + 1] * (1 - a) + g * a;
          normal.data[q + 2] = normal.data[q + 2] * (1 - a) + d[p + 2] * a;
          normal.data[q + 3] = Math.max(normal.data[q + 3], d[p + 3]);
        }
      }
    }
    const read = (g) => g.getImageData(0, 0, W, S);
    const color = read(ctx.color); const op = read(ctx.opacity);
    for (let i = 0; i < W * S; i++) color.data[i * 4 + 3] = Math.round((op.data[i * 4] * op.data[i * 4 + 3]) / 255);
    return { color, normal, roughness: read(ctx.roughness), ao: read(ctx.ao), subsurface: read(ctx.subsurface) };
  }

  async packAndSave() {
    const s = this.state;
    const o = { ...s.settings };
    const [W, S] = sizeOf(o);
    this.deps.toast('Packing…', 1500);
    let packed;
    try {
      packed = await saveMaps(await this.compose(W, S), o, this.deps.toast);
    } catch (e) {
      console.error(e);
      this.deps.toast(`Could not pack: ${e.message}`, 6000);
      return;
    }
    if (!packed) return;
    // The new material's cutouts are the pieces, where they now sit; ids map old to new for the plant.
    const ids = new Map();
    packed.cutouts = s.items.map((it) => {
      const { m, c } = this.partOf(it);
      const T = (p) => place(it, p, S);
      const made = meshCutout({
        name: `${m.name} ${c.name || ''}`.trim(), auto: false, enabled: c.enabled,
        basePx: T(c.basePx), tipPx: T(c.tipPx), outlinePx: c.outlinePx.map(T), innerPx: (c.innerPx || []).map(T),
        holesPx: (c.holesPx || []).map((h) => h.map(T)), faces: c.faces, sprouts: [],
      }, W, S);
      made.sprouts = (c.sprouts || []).map((sp) => {
        const a = T(sp.px); const b = T([sp.px[0] + sp.dir[0], sp.px[1] + sp.dir[1]]);
        return sproutFromPixels(made, a, [b[0] - a[0], b[1] - a[1]], sp.level);
      });
      ids.set(`${m.id}|${c.id}`, made.id);
      return made;
    });
    const used = new Set(s.items.map((it) => it.mat));
    const leaves = doc.graph.nodes.filter((n) => String(n.params?.meshType).split('+').includes('cutout') && used.has(n.params.material));
    // Ticked boxes do the switch and the clean-up straight away, without asking.
    if (leaves.length && (s.remap ?? true)) {
      for (const n of leaves) {
        const old = doc.graph.materials.find((x) => x.id === n.params.material);
        const picked = n.params.cutoutPick || old.cutouts.map((c) => c.id);
        const next = picked.map((id) => ids.get(`${old.id}|${id}`)).filter(Boolean);
        n.params.material = packed.id;
        n.params.cutoutPick = next.length ? next : null;
      }
      const unused = [...used].filter((id) => !doc.graph.nodes.some((n) => n.params?.material === id));
      if (unused.length && s.prune) {
        doc.graph.materials = doc.graph.materials.filter((x) => !unused.includes(x.id));
        s.mats = s.mats.filter((id) => !unused.includes(id));
      }
    }
    changed({ layout: true });
    commit();
    await this.sync();
    this.render();
    this.draw();
  }
}
