// The node graph, drawn on a 2D canvas behind the tree. Offscreen nodes are skipped and detail drops when zoomed out.
import { NODE_TYPES, CATS, KIND, TABS, SHAPE_MODS, SURFACE_MODS, socketsOf, shown, kindFits } from '../graph/schema.js';
import { textureThumb } from './textures.js';
import { bakeCurve, sampleCurve } from '../engine/math.js';
import { doc } from './doc.js';
import { showLength } from './units.js';
import { graphPalette, THEMES } from './themes.js';

// The theme's colors for the canvas; wa() is the text color at some strength.
let T = graphPalette(THEMES.forest);
const wa = (a) => `rgba(${T.inkRGB},${a})`;
export const setGraphPalette = (p) => { T = p; };

export const NODE_W = 260;
const HEADER = 28;
const TAB_H = 28;
const CURVE_ROW = 64;
const PAD = 6;
const FONT = '"Poppins", system-ui, sans-serif';
let TS = 1; // text scale from Settings
// Fingers need taller rows than a mouse does.
const ROW_BASE = globalThis.matchMedia?.('(pointer: coarse)').matches ? 28 : 20;
let ROW = ROW_BASE;
export function setTextScale(v) { TS = v; ROW = Math.round(ROW_BASE * Math.max(v, 1)); doc.layoutVersion++; }
const SOCKET_ROW = 15;

const fmt = (v) => (Number.isInteger(v) ? String(v) : (+v).toFixed(Math.abs(v) < 10 ? 2 : 1));
const fmtUnit = (v, unit) => (unit === 'cm' ? showLength(+v) : fmt(+v) + (unit ? ` ${unit}` : ''));
const hasCurve = (owner, k) => Object.keys(owner.curves || {}).some((key) => key === k || key.startsWith(`${k}@`));
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const KIND_INFO = {
  spawn: ['Start points', 'Where new lines begin. Goes from a distributor to a path.'],
  dist: ['Children', 'Grows more lines from this path through a distributor.'],
  dir: ['Directions', 'Bends the lines through a chain of direction modifiers.'],
  mesh: ['Mesh', 'Wraps the lines in a mesh builder.'],
  comp: ['Components', 'Extra mesh settings, such as a separate material or vertex colors.'],
  value: ['Value', 'A number from another node, used in place of this setting.'],
  curve: ['Curve', 'A shape that changes this setting along the line.'],
  cloud: ['Cloud', 'Points for space colonization to grow toward.'],
  object: ['Object', 'A ground patch or scene object to grow from, avoid or slice with.'],
  shape: ['Atlas shape', 'Leaf outlines fitted from an atlas texture.'],
  element: ['Element', 'An object for Instanced geometry to place.'],
  pos: ['Position', 'One exact spot along the parent path.'],
};

// The text for the tooltip under the pointer, or null when there's nothing to say.
export function describeHit(hit) {
  if (!hit) return null;
  if (hit.part === 'socket') {
    const [name, about] = KIND_INFO[hit.sock.kind] || ['Connector', ''];
    const param = hit.sock.param && NODE_TYPES[hit.node.type].params.find((p) => p.k === hit.sock.param);
    return { title: `${hit.sock.dir === 'in' ? 'Input' : 'Output'}: ${param ? param.l : hit.sock.l || name}`, text: about };
  }
  if (hit.part === 'power') return { title: hit.node.on === false ? 'Turned off' : 'Turned on', text: 'Click to switch this node on or off.' };
  if (hit.part === 'fold') return { title: 'Show more or less', text: 'Click to cycle through short, normal and all settings on the node.' };
  if (hit.part === 'tab') { const t = TABS[hit.tab]; return { title: t.label, text: t.text }; }
  if (hit.part === 'row') {
    if (hit.zone === 'var') return { title: 'Variation', text: 'Varies this value up and down per entity, as a percentage of the value.' };
    if (hit.zone === 'curve') return { title: 'Curve', text: 'Changes this value along the length, along any parent, or across the whole plant.' };
    if (hit.zone === 'fold') return { title: hit.row.label, text: hit.row.open ? 'Click to fold this group away.' : 'Click to open this group.' };
    if (hit.row.kind === 'mod') {
      const d = modDef(hit.row.set, hit.row.mod.type);
      return { title: hit.row.mod.name || d?.title || 'Modifier', text: d?.desc || '' };
    }
    if (hit.row.param?.hint) return { title: hit.row.param.l, text: hit.row.param.hint };
  }
  if (hit.node) {
    const def = NODE_TYPES[hit.node.type];
    return { title: `${hit.node.name || def.title} · ${def.title}`, text: def.desc || '' };
  }
  if (hit.part === 'group') return { title: hit.group.title, text: 'Drag this bar to move the whole group.' };
  return null;
}

export class GraphView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.pan = { x: 300, y: 120 };
    this.z = 0.7;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.layouts = new Map();
    this.layoutVersion = -1;
    this.drag = null; // { kind, from: {x,y,side}, to: {x,y}, sock } while dragging a new wire
    this.box = null;
    this.hover = null;
    this.anim = null;
    this.snap = false;
    this.dirty = true;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.frame = this.frame.bind(this);
    this.invalidate();
  }

  resize(x, y, w, h) {
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    const r = Math.min(devicePixelRatio || 1, 2);
    this.ratio = r;
    this.canvas.width = Math.round(this.rect.w * r);
    this.canvas.height = Math.round(this.rect.h * r);
    Object.assign(this.canvas.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.invalidate();
  }

  invalidate() { this.dirty = true; this.raf ||= requestAnimationFrame(this.frame); }

  frame(now) {
    this.raf = 0;
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / 280);
      const e = 1 - (1 - t) ** 3;
      this.z = a.z0 * (a.z1 / a.z0) ** e;
      this.pan.x = a.x0 + (a.x1 - a.x0) * e;
      this.pan.y = a.y0 + (a.y1 - a.y0) * e;
      if (t >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.draw(); }
    if (this.anim) this.raf = requestAnimationFrame(this.frame);
  }

  // ---- Coordinates ----
  toWorld(sx, sy) { return { x: (sx - this.rect.x - this.pan.x) / this.z, y: (sy - this.rect.y - this.pan.y) / this.z }; }

  panBy(dx, dy) { this.anim = null; this.pan.x += dx; this.pan.y += dy; this.invalidate(); }

  zoomAt(sx, sy, factor) {
    this.anim = null;
    const z = Math.min(2.5, Math.max(0.08, this.z * factor));
    const x = sx - this.rect.x; const y = sy - this.rect.y;
    this.pan.x = x - ((x - this.pan.x) / this.z) * z;
    this.pan.y = y - ((y - this.pan.y) / this.z) * z;
    this.z = z;
    this.invalidate();
  }

  // Frames nodes inside a region of the canvas; region lets the tree keep its part of the screen.
  frameNodes(nodes, region = null, instant = false, maxZoom = 1.3, minZoom = 0.08) {
    if (!nodes.length) return;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of nodes) {
      const l = this.layout(n);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + l.w); y1 = Math.max(y1, n.y + l.h);
    }
    const r = region || { x: 0, y: 0, w: this.rect.w, h: this.rect.h };
    const fit = Math.min((r.w - 60) / (x1 - x0), (r.h - 60) / (y1 - y0));
    const z = Math.min(maxZoom, Math.max(minZoom, fit));
    // When a readable zoom can't fit everything, start from the root instead of the middle.
    const px = z > fit ? r.x + 30 - x0 * z : r.x + r.w / 2 - ((x0 + x1) / 2) * z;
    const py = z > fit ? r.y + 30 - y0 * z : r.y + r.h / 2 - ((y0 + y1) / 2) * z;
    if (instant) { this.z = z; this.pan = { x: px, y: py }; this.anim = null; this.invalidate(); return; }
    this.anim = { t0: performance.now(), z0: this.z, z1: z, x0: this.pan.x, x1: px, y0: this.pan.y, y1: py };
    this.invalidate();
  }

  // ---- Layout ----
  layout(node) {
    if (this.layoutVersion !== doc.layoutVersion) { this.layouts.clear(); this.layoutVersion = doc.layoutVersion; }
    let l = this.layouts.get(node.id);
    if (!l) { l = buildLayout(node); this.layouts.set(node.id, l); }
    return l;
  }

  socketPos(node, key) {
    const s = this.layout(node).sockets.get(key);
    return s ? { x: node.x + s.x, y: node.y + s.y, side: s.side, kind: s.kind } : null;
  }

  // Arranges nodes in columns from left to right, following the wires.
  tidy() {
    const nodes = doc.graph.nodes;
    const incoming = new Map(nodes.map((n) => [n.id, []]));
    for (const l of doc.graph.links) incoming.get(l.to)?.push(l.from);
    const ranks = new Map();
    const rank = (id, trail = new Set()) => {
      if (ranks.has(id)) return ranks.get(id);
      if (trail.has(id)) return 0; // a looped file: stop here instead of hanging
      trail.add(id);
      const r = Math.max(-1, ...incoming.get(id).filter((f) => incoming.has(f)).map((f) => rank(f, trail))) + 1;
      trail.delete(id);
      ranks.set(id, r);
      return r;
    };
    const columns = [];
    for (const n of nodes) (columns[rank(n.id)] ||= []).push(n);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    columns.forEach((col, x) => {
      const pull = (n) => { const from = incoming.get(n.id); return from.length ? from.reduce((s, f) => s + (byId.get(f)?.y || 0), 0) / from.length : 0; };
      if (x) col.sort((a, b) => pull(a) - pull(b));
      let y = 0;
      for (const n of col) {
        n.x = x * (NODE_W + 110);
        n.y = y;
        y += this.layout(n).h + 34;
      }
    });
    this.invalidate();
  }

  // ---- Hit testing ----
  hit(sx, sy) {
    const { x, y } = this.toWorld(sx, sy);
    const reach = (this.touch ? 16 : 9) / this.z;
    const nodes = this.drawOrder();
    let closest = null; let cd = reach * reach;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const l = this.layout(n);
      if (x < n.x - reach || x > n.x + l.w + reach || y < n.y - reach || y > n.y + l.h + reach) continue;
      // The eye on the header wins over the output socket beside it.
      if (y - n.y < HEADER && y >= n.y && x - n.x > l.w - 34 && x - n.x < l.w - 6) continue;
      for (const s of l.sockets.values()) {
        if (s.hidden) continue;
        const d = (n.x + s.x - x) ** 2 + (n.y + s.y - y) ** 2;
        if (d < cd) { cd = d; closest = { part: 'socket', node: n, sock: s }; }
      }
    }
    if (closest) return closest;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const l = this.layout(n);
      const lx = x - n.x; const ly = y - n.y;
      if (lx < 0 || ly < 0 || lx > l.w || ly > l.h) continue;
      if (l.tabs && ly >= l.tabY && ly < l.tabY + TAB_H) return { part: 'tab', node: n, tab: l.tabs[Math.min(l.tabs.length - 1, Math.floor((lx / l.w) * l.tabs.length))] };
      if (ly < l.header) {
        if (ly < HEADER && lx > l.w - 34 && lx < l.w - 6) return { part: 'power', node: n };
        if (ly < HEADER && lx < 22 && !l.tabs) return { part: 'fold', node: n };
        return { part: 'header', node: n };
      }
      const row = l.rows.find((r) => ly >= r.y && ly < r.y + r.h);
      if (row) return { part: 'row', node: n, row, zone: rowZone(row, lx, this.varBox), lx };
      return { part: 'body', node: n };
    }
    for (const g of doc.graph.groups || []) {
      const b = this.groupBox(g);
      if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + 26) return { part: 'group', group: g };
    }
    const link = this.linkAt(x, y);
    return link ? { part: 'link', link } : null;
  }

  linkAt(x, y) {
    const near = (this.touch ? 12 : 6) / this.z;
    for (const l of doc.graph.links) {
      const p = this.linkEnds(l);
      if (!p) continue;
      const [a, c1, c2, b] = p;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24; const u = 1 - t;
        const px = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
        const py = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
        if (Math.hypot(px - x, py - y) < near) return l;
      }
    }
    return null;
  }

  linkEnds(l) {
    const a = doc.graph.nodes.find((n) => n.id === l.from);
    const b = doc.graph.nodes.find((n) => n.id === l.to);
    if (!a || !b) return null;
    const p = this.socketPos(a, l.fromSock);
    const q = this.socketPos(b, l.toSock);
    if (!p || !q) return null;
    return [p, ...curveCtl(p, q), q];
  }

  groupBox(g) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const id of g.nodes) {
      const n = doc.graph.nodes.find((m) => m.id === id);
      if (!n) continue;
      const l = this.layout(n);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + l.w); y1 = Math.max(y1, n.y + l.h);
    }
    return x0 === Infinity ? null : { x: x0 - 16, y: y0 - 38, w: x1 - x0 + 32, h: y1 - y0 + 54 };
  }

  // ---- Drawing ----
  draw() {
    const c = this.ctx;
    const { w, h } = this.rect;
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    this.drawGrid(c, w, h);
    c.translate(this.pan.x, this.pan.y);
    c.scale(this.z, this.z);
    const view = { x0: -this.pan.x / this.z, y0: -this.pan.y / this.z, x1: (w - this.pan.x) / this.z, y1: (h - this.pan.y) / this.z };
    this.drawGroups(c);
    this.drawLinks(c, view);
    for (const n of this.drawOrder()) this.drawNode(c, n, view);
    if (this.drag) this.drawDrag(c);
    if (this.box) {
      c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      c.strokeStyle = '#9be15d'; c.fillStyle = 'rgba(155,225,93,.08)'; c.lineWidth = 1;
      const { x0, y0, x1, y1 } = this.box;
      c.fillRect(x0 - this.rect.x, y0 - this.rect.y, x1 - x0, y1 - y0);
      c.strokeRect(x0 - this.rect.x, y0 - this.rect.y, x1 - x0, y1 - y0);
    }
  }

  // Open and selected nodes sit on top, since a node's settings unfold over whatever is below it.
  drawOrder() {
    const rank = (n) => (doc.sel.has(n.id) ? 2 : n.tab ? 1 : 0);
    return doc.graph.nodes.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((e) => e[0]);
  }

  drawGrid(c, w, h) {
    if (this.showGrid === false) return;
    const step = this.z > 0.4 ? 50 * this.z : 250 * this.z;
    if (step < 8) return;
    c.fillStyle = T.grid;
    const ox = ((this.pan.x % step) + step) % step;
    const oy = ((this.pan.y % step) + step) % step;
    for (let x = ox; x < w; x += step) c.fillRect(Math.round(x), 0, 1, h);
    for (let y = oy; y < h; y += step) c.fillRect(0, Math.round(y), w, 1);
    const major = step * 5;
    c.fillStyle = T.grid2;
    const mx = ((this.pan.x % major) + major) % major;
    const my = ((this.pan.y % major) + major) % major;
    for (let x = mx; x < w; x += major) c.fillRect(Math.round(x), 0, 1, h);
    for (let y = my; y < h; y += major) c.fillRect(0, Math.round(y), w, 1);
  }

  drawGroups(c) {
    for (const g of doc.graph.groups || []) {
      const b = this.groupBox(g);
      if (!b) continue;
      c.fillStyle = 'rgba(74,134,16,.10)';
      c.strokeStyle = 'rgba(155,225,93,.35)';
      c.lineWidth = 1.5 / this.z;
      c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, 8); c.fill(); c.stroke();
      c.fillStyle = 'rgba(74,134,16,.5)';
      c.beginPath(); c.roundRect(b.x, b.y, b.w, 26, [8, 8, 0, 0]); c.fill();
      c.fillStyle = '#e8f3dd';
      c.font = `600 13px ${FONT}`;
      c.textBaseline = 'middle';
      c.fillText(g.title, b.x + 10, b.y + 13);
    }
  }

  drawLinks(c, view) {
    const nodes = new Map(doc.graph.nodes.map((n) => [n.id, n]));
    const paths = new Map();
    let hot = null;
    for (const l of doc.graph.links) {
      const a = nodes.get(l.from); const b = nodes.get(l.to);
      if (!a || !b) continue;
      const p = this.socketPos(a, l.fromSock); const q = this.socketPos(b, l.toSock);
      if (!p || !q) continue;
      if (Math.max(p.x, q.x) < view.x0 - 200 || Math.min(p.x, q.x) > view.x1 + 200 || Math.max(p.y, q.y) < view.y0 - 200 || Math.min(p.y, q.y) > view.y1 + 200) continue;
      const [c1, c2] = curveCtl(p, q);
      const off = a.on === false || b.on === false;
      const lit = doc.link === l.id || doc.sel.has(l.from) || doc.sel.has(l.to);
      const key = `${KIND[p.kind] || '#999'}|${off ? 1 : 0}|${lit ? 1 : 0}`;
      let path = paths.get(key);
      if (!path) { path = new Path2D(); paths.set(key, path); }
      path.moveTo(p.x, p.y);
      path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
      if (doc.link === l.id) { hot = new Path2D(); hot.moveTo(p.x, p.y); hot.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y); }
    }
    for (const [key, path] of paths) {
      const [color, off, lit] = key.split('|');
      c.strokeStyle = color;
      c.globalAlpha = off === '1' ? 0.25 : lit === '1' ? 1 : 0.7;
      c.lineWidth = (lit === '1' ? 3 : 2) / Math.max(this.z, 0.5);
      c.stroke(path);
    }
    c.globalAlpha = 1;
    if (hot) { c.strokeStyle = '#ffffff'; c.lineWidth = 3.5 / Math.max(this.z, 0.5); c.stroke(hot); }
  }

  drawNode(c, n, view) {
    const l = this.layout(n);
    if (n.x > view.x1 + 20 || n.x + l.w < view.x0 - 20 || n.y > view.y1 + 20 || n.y + l.h < view.y0 - 20) return;
    const def = NODE_TYPES[n.type];
    const cat = CATS[def.cat];
    const sel = doc.sel.has(n.id);
    const off = n.on === false;
    c.globalAlpha = off ? 0.5 : 1;
    // Far away, a colored block is all that can be read, and it is much cheaper.
    if (this.z < 0.22) {
      c.fillStyle = sel ? T.accent : def.cat === 'plant' ? T.head : cat.color;
      c.fillRect(n.x, n.y, l.w, l.h);
      // Names stay readable at any distance, so the graph can still be navigated from far out.
      c.fillStyle = sel ? '#10160c' : '#fff';
      c.font = `600 ${(this.z < 0.1 ? 9 : 10.5) / this.z}px ${FONT}`;
      c.textBaseline = 'top';
      c.fillText(short(n.name || def.title, 16), n.x + 8, n.y + 8, l.w - 12);
      c.globalAlpha = 1;
      return;
    }
    c.fillStyle = T.body;
    c.beginPath(); c.roundRect(n.x, n.y, l.w, l.h, 6); c.fill();
    c.fillStyle = off ? '#454a44' : def.cat === 'plant' ? T.head : cat.color;
    c.beginPath(); c.roundRect(n.x, n.y, l.w, l.header, l.h > l.header ? [6, 6, 0, 0] : 6); c.fill();
    if (sel) { c.strokeStyle = '#9be15d'; c.lineWidth = 2 / Math.min(this.z, 1); c.beginPath(); c.roundRect(n.x - 1, n.y - 1, l.w + 2, l.h + 2, 7); c.stroke(); }
    c.textBaseline = 'middle';
    const titleX = l.tabs ? 10 : 24;
    c.fillStyle = '#fff';
    c.font = `600 ${12.5 * TS}px ${FONT}`;
    const title = n.name || def.title;
    c.fillText(short(title, 22), n.x + titleX, n.y + HEADER / 2 + 0.5);
    // A renamed node still says what kind of node it is.
    if (n.name && n.name !== def.title) {
      const tw = c.measureText(short(title, 22)).width;
      c.font = `400 ${9.5 * TS}px ${FONT}`;
      c.fillStyle = wa(.65);
      c.textAlign = 'right';
      if (titleX + tw + 70 < l.w) c.fillText(short(def.title, 14), n.x + l.w - 36, n.y + HEADER / 2 + 0.5);
      c.textAlign = 'left';
    }
    // The eye on the right turns the node on and off; it closes while the node is off.
    drawEye(c, n.x + l.w - 20, n.y + HEADER / 2, !off);
    if (!l.tabs) {
      c.fillStyle = wa(.75);
      c.font = `600 13px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(n.view === 0 ? '▸' : n.view === 2 ? '▾' : '▿', n.x + 12, n.y + HEADER / 2);
      c.textAlign = 'left';
    }
    if (l.tabs) this.drawTabs(c, n, l);
    if (this.z >= 0.42) {
      this.drawRows(c, n, l);
      c.font = `500 ${10 * TS}px ${FONT}`;
      c.fillStyle = wa(.85);
      for (const s of l.sockets.values()) {
        if (!s.tag) continue;
        c.textAlign = s.side === 'right' ? 'right' : 'left';
        c.fillText(short(s.tag, 15), n.x + (s.side === 'right' ? l.w - 11 : 11), n.y + s.y + 0.5);
      }
      c.textAlign = 'left';
    }
    this.drawSockets(c, n, l);
    c.globalAlpha = 1;
  }

  drawTabs(c, n, l) {
    const w = l.w / l.tabs.length;
    c.fillStyle = T.tabBg;
    c.fillRect(n.x, n.y + l.tabY, l.w, TAB_H);
    l.tabs.forEach((tab, i) => {
      const x = n.x + i * w;
      if (n.tab === tab) {
        c.fillStyle = 'rgba(155,225,93,.28)';
        c.fillRect(x, n.y + l.tabY, w, TAB_H);
        c.fillStyle = '#9be15d';
        c.fillRect(x, n.y + l.tabY + TAB_H - 2, w, 2);
      }
      drawTabIcon(c, tab, x + w / 2, n.y + l.tabY + TAB_H / 2, n.tab === tab ? T.ink : wa(.8));
    });
  }

  drawRows(c, n, l) {
    c.font = `400 ${11 * TS}px ${FONT}`;
    for (const r of l.rows) {
      const y = n.y + r.y + r.h / 2;
      if (r.kind === 'head') {
        c.fillStyle = '#9be15d';
        c.font = `600 ${10 * TS}px ${FONT}`;
        if (r.fold) {
          c.fillStyle = 'rgba(155,225,93,.1)';
          c.beginPath(); c.roundRect(n.x + 6, n.y + r.y + 2, l.w - 12, r.h - 3, 3); c.fill();
          c.fillStyle = '#9be15d';
          c.fillText(r.open ? '▾' : '▸', n.x + 12, y + 1);
        }
        c.fillText(r.label.toUpperCase(), n.x + (r.fold ? 24 : 12), y + 2);
        c.font = `400 ${11 * TS}px ${FONT}`;
      } else if (r.kind === 'sock') {
        c.fillStyle = T.muted;
        c.textAlign = r.side === 'right' ? 'right' : 'left';
        c.fillText(r.label, n.x + (r.side === 'right' ? l.w - 14 : 14), y);
        c.textAlign = 'left';
      } else if (r.kind === 'mod') {
        this.drawModRow(c, n, l, r, y);
      } else if (r.kind === 'add') {
        c.fillStyle = 'rgba(155,225,93,.14)';
        c.beginPath(); c.roundRect(n.x + 10, n.y + r.y + 2, l.w - 20, r.h - 4, 4); c.fill();
        c.fillStyle = '#c8efa4';
        c.textAlign = 'center';
        c.fillText('+  Add modifier', n.x + l.w / 2, y);
        c.textAlign = 'left';
      } else if (r.param?.t === 'curve' && r.h === CURVE_ROW) {
        this.drawCurve(c, n, r);
      } else this.drawParamRow(c, n, l, r, y);
    }
  }

  drawModRow(c, n, l, r, y) {
    const on = r.mod.on !== false;
    c.fillStyle = wa(.07);
    c.beginPath(); c.roundRect(n.x + 6, n.y + r.y + 1, l.w - 12, r.h - 2, 3); c.fill();
    c.fillStyle = wa(.8);
    c.textAlign = 'center';
    c.fillText(r.mod.open ? '▾' : '▸', n.x + 15, y);
    c.textAlign = 'left';
    if (!r.mod.fixed) {
      c.strokeStyle = T.muted; c.lineWidth = 1;
      c.strokeRect(n.x + 25, y - 6, 12, 12);
      if (on) { c.fillStyle = '#9be15d'; c.fillRect(n.x + 27, y - 4, 8, 8); }
    }
    c.fillStyle = on ? T.ink : T.muted;
    c.fillText(short(r.mod.name || modDef(r.set, r.mod.type)?.title || r.mod.type, 26), n.x + (r.mod.fixed ? 26 : 44), y);
    if (!r.mod.fixed) {
      // The move pad: six dots, dragged up or down to reorder.
      c.fillStyle = wa(.5);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(n.x + l.w - 41 + j * 5, y - 5 + i * 5, 1.2, 0, 7); c.fill(); }
      c.fillStyle = wa(.55);
      c.textAlign = 'center';
      c.fillText('×', n.x + l.w - 16, y);
      c.textAlign = 'left';
    }
  }

  drawParamRow(c, n, l, r, y) {
    const p = r.param;
    const g = rowGeom(r, this.varBox);
    const x0 = n.x + (r.mod ? 12 : 0);
    c.fillStyle = r.linked ? T.muted : T.label;
    c.fillText(short(p.l || '', r.mod ? 15 : 17), x0 + 14, y, g.box[0] - (r.mod ? 30 : 18));
    const v = r.owner[p.k] ?? p.d;
    const bx = n.x + g.box[0]; const bw = g.box[1] - g.box[0];
    const by = n.y + r.y + 2; const bh = r.h - 4;
    const box = (fill = T.field) => { c.fillStyle = fill; c.beginPath(); c.roundRect(bx, by, bw, bh, 3); c.fill(); };
    const text = (t, color = T.ink) => {
      c.fillStyle = color;
      c.textAlign = 'right';
      c.fillText(t, bx + bw - 6, y);
      c.textAlign = 'left';
    };
    if (p.t === 'action') {
      c.fillStyle = '#4a8610';
      c.beginPath(); c.roundRect(n.x + 12, by, l.w - 24, bh, 3); c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center';
      c.fillText(p.l, n.x + l.w / 2, y);
      c.textAlign = 'left';
      return;
    }
    if (p.t === 'matslot') {
      // Two small squares at the right: the color, then the picture (empty when there is none).
      const s = bh; const mx = bx + bw - s; const cx = mx - s - 4;
      c.fillStyle = r.owner[p.k] || p.d;
      c.beginPath(); c.roundRect(cx, by, s, s, 3); c.fill();
      c.strokeStyle = wa(.35); c.lineWidth = 1;
      c.beginPath(); c.roundRect(mx, by, s, s, 3); c.stroke();
      const name = r.owner[p.map];
      const thumb = name ? textureThumb(name, doc.assets, () => this.invalidate()) : null;
      if (thumb) c.drawImage(thumb, mx + 1, by + 1, s - 2, s - 2);
      return;
    }
    if (p.t === 'bool') {
      const cx = n.x + g.box[1] - 14;
      c.strokeStyle = T.muted; c.lineWidth = 1;
      c.strokeRect(cx, y - 6, 12, 12);
      if (v) { c.fillStyle = '#9be15d'; c.fillRect(cx + 2, y - 4, 8, 8); }
    } else if (p.t === 'color') {
      c.fillStyle = v || '#fff';
      c.beginPath(); c.roundRect(bx, by, bw, bh, 3); c.fill();
    } else if (p.t === 'vec') {
      const w3 = (bw - 4) / 3;
      (v || []).slice(0, 3).forEach((a, i) => {
        c.fillStyle = T.field;
        c.beginPath(); c.roundRect(bx + i * (w3 + 2), by, w3, bh, 3); c.fill();
        c.fillStyle = T.ink; c.textAlign = 'center';
        c.fillText(p.unit === 'cm' ? showLength(+a).replace(' cm', '') : fmt(+a), bx + i * (w3 + 2) + w3 / 2, y, w3 - 2);
        c.textAlign = 'left';
      });
    } else if (p.t === 'toggles') {
      // One switch per option, lit while it is on.
      const on = String(v || 'none').split('+'); const k = p.opts.length; const w = (bw - (k - 1) * 2) / k;
      p.opts.forEach((o, i) => {
        const lit = on.includes(o);
        c.fillStyle = lit ? 'rgba(74,134,16,.9)' : T.field;
        c.beginPath(); c.roundRect(bx + i * (w + 2), by, w, bh, 3); c.fill();
        c.fillStyle = lit ? '#fff' : T.muted; c.textAlign = 'center';
        c.fillText(o, bx + i * (w + 2) + w / 2, y, w - 2);
        c.textAlign = 'left';
      });
    } else if (p.t === 'num') {
      box();
      if (p.min !== undefined && p.max !== undefined && !r.linked) {
        c.fillStyle = 'rgba(74,134,16,.55)';
        const f = Math.max(0, Math.min(1, (+v - p.min) / (p.max - p.min || 1)));
        c.beginPath(); c.roundRect(bx, by, bw * f, bh, 3); c.fill();
      }
      text(r.linked ? '⟵ linked' : fmtUnit(v, p.unit), r.linked ? T.muted : T.ink);
    } else {
      box();
      let t = '';
      if (p.t === 'enum') t = `${v} ▾`;
      else if (p.t === 'curve') t = 'curve';
      else if (p.t === 'texture' || p.t === 'atlas') t = v ? String(doc.assets[v]?.name || v).replace(/^.*:/, '') : 'none';
      else if (p.t === 'points' || p.t === 'gradient') t = `${(v || []).length} items`;
      else if (p.t === 'obj') t = v ? 'loaded' : 'choose file';
      else if (p.t === 'ref') t = v ? doc.graph.nodes.find((x) => x.id === v)?.name || 'object' : 'choose';
      else if (p.t === 'matref') t = (doc.graph.materials || []).find((m) => m.id === v)?.name || 'No material';
      else if (p.t === 'cutpick') {
        const all = (doc.graph.materials || []).find((m) => m.id === r.owner.material)?.cutouts || [];
        t = Array.isArray(v) ? `${all.filter((c) => v.includes(c.id)).length} of ${all.length}` : `All (${all.length})`;
      }
      text(short(t, 15) + (p.t === 'matref' || p.t === 'cutpick' ? ' ▾' : ''), v || p.t === 'cutpick' ? T.ink : T.muted);
    }
    if (g.vary) {
      const pct = +r.owner.vary?.[p.k] || 0;
      if (this.varBox) {
        c.fillStyle = T.field;
        c.beginPath(); c.roundRect(n.x + g.vary[0], by, g.vary[1] - g.vary[0], bh, 3); c.fill();
        c.fillStyle = pct ? '#ffd04d' : T.muted; c.textAlign = 'center';
        c.fillText(`±${+pct.toFixed(1)}`, n.x + (g.vary[0] + g.vary[1]) / 2, y, g.vary[1] - g.vary[0] - 2);
        c.textAlign = 'left';
      } else {
        c.fillStyle = pct ? '#ffd04d' : wa(.5); c.textAlign = 'center';
        c.fillText('±', n.x + (g.vary[0] + g.vary[1]) / 2, y);
        c.textAlign = 'left';
      }
    }
    if (g.curve) {
      const active = hasCurve(r.owner, p.k);
      c.strokeStyle = active ? '#de4dbb' : wa(.5); c.lineWidth = 1.4;
      const cx = n.x + (g.curve[0] + g.curve[1]) / 2;
      c.beginPath(); c.moveTo(cx - 6, y + 4); c.bezierCurveTo(cx - 2, y + 4, cx - 2, y - 5, cx + 6, y - 5); c.stroke();
    }
  }

  drawCurve(c, n, r) {
    const x = n.x + 12; const y = n.y + r.y + 4; const w = NODE_W - 24; const h = r.h - 8;
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(x, y, w, h);
    r.baked ||= bakeCurve(r.owner[r.param.k]);
    c.strokeStyle = KIND.curve;
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const py = y + h - Math.min(1.1, Math.max(0, sampleCurve(r.baked, t))) * (h - 4) - 2;
      if (i) c.lineTo(x + t * w, py); else c.moveTo(x + t * w, py);
    }
    c.stroke();
  }

  drawSockets(c, n, l) {
    const drag = this.drag;
    for (const s of l.sockets.values()) {
      if (s.hidden) continue;
      const x = n.x + s.x; const y = n.y + s.y;
      const fits = drag && drag.dir !== s.dir && drag.nodeId !== n.id && (drag.dir === 'out' ? kindFits(drag.kind, s) : kindFits(s.kind, drag.sock));
      c.fillStyle = KIND[s.kind] || '#999';
      c.globalAlpha = drag && !fits ? 0.25 : n.on === false ? 0.5 : 1;
      c.beginPath();
      const r = fits ? 7.5 : s.main ? 6 : 4.5;
      if (s.main) { c.roundRect(x - r, y - r, r * 2, r * 2, 2.5); } else { c.arc(x, y, r, 0, 7); }
      c.fill();
      if (fits) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
    }
    c.globalAlpha = 1;
  }

  drawDrag(c) {
    const { from, to, kind } = this.drag;
    const end = { ...to, side: from.side === 'bottom' ? 'top' : from.side === 'top' ? 'bottom' : from.side === 'right' ? 'left' : 'right' };
    const [c1, c2] = curveCtl(from, end);
    c.strokeStyle = KIND[kind] || '#fff';
    c.lineWidth = 2.5 / Math.max(this.z, 0.5);
    c.beginPath(); c.moveTo(from.x, from.y); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y); c.stroke();
  }
}

const DIRS = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

function curveCtl(p, q) {
  const k = Math.max(36, Math.hypot(q.x - p.x, q.y - p.y) * 0.42);
  const a = DIRS[p.side] || [1, 0]; const b = DIRS[q.side] || [-1, 0];
  return [{ x: p.x + a[0] * k, y: p.y + a[1] * k }, { x: q.x + b[0] * k, y: q.y + b[1] * k }];
}

// The definition behind one row of a modifier stack.
export function modDef(set, type) {
  if (set === 'shape') return SHAPE_MODS[type];
  if (set === 'surface') return SURFACE_MODS[type];
  return NODE_TYPES[type];
}

const REF = { k: 'object', l: 'Object', t: 'ref', d: null };

function modParams(set, mod) {
  const d = modDef(set, mod.type);
  if (!d) return [];
  // A separate "variation" setting would just repeat the icon each value already has.
  const list = d.params.filter((p) => p.t !== 'data' && !/Chaos$/.test(p.k));
  return set === 'spline' && d.in.some((s) => s.kind === 'object') ? [REF, ...list] : list;
}

// Which columns of a row do what, in node coordinates.
function rowGeom(r, varBox) {
  const w = NODE_W;
  const p = r.param;
  if (p?.t === 'action') return { box: [12, w - 12] };
  const canCurve = !!p && (p.vc || (p.t === 'num' && r.set === 'spline'));
  const canVary = canCurve && !p.noVary;
  const iconsW = (canCurve ? 18 : 0) + (canVary ? (varBox ? 32 : 16) : 0);
  const right = w - 10 - iconsW;
  // Three small boxes need more room than one, so their label gets less.
  const g = { box: [p?.t === 'vec' ? 74 : Math.min(w * 0.5, right - 40), right] };
  if (canCurve) g.curve = [w - 28, w - 10];
  if (canVary) g.vary = canCurve ? [g.curve[0] - (varBox ? 32 : 16), g.curve[0] - 1] : [w - 10 - (varBox ? 32 : 16), w - 10];
  return g;
}

export const rowBox = (r) => rowGeom(r, false).box;

function rowZone(r, lx, varBox) {
  if (r.kind === 'add') return 'add';
  if (r.kind === 'mod') return r.mod.fixed ? 'arrow' : lx < 22 ? 'arrow' : lx < 42 ? 'check' : lx > NODE_W - 28 ? 'del' : lx > NODE_W - 48 ? 'grip' : 'arrow';
  if (r.kind === 'head') return r.fold ? 'fold' : 'label';
  if (!r.param) return 'label';
  const g = rowGeom(r, varBox);
  if (g.curve && lx >= g.curve[0] && lx <= g.curve[1] + 6) return 'curve';
  if (g.vary && lx >= g.vary[0] && lx < g.vary[1]) return 'var';
  if (lx >= g.box[0] && lx <= g.box[1]) return 'box';
  return 'label';
}

function drawEye(c, x, y, open) {
  c.save(); c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 1.4; c.lineCap = 'round';
  c.globalAlpha *= open ? 0.95 : 0.7;
  c.beginPath();
  if (open) {
    c.moveTo(x - 7, y); c.quadraticCurveTo(x, y - 7, x + 7, y); c.quadraticCurveTo(x, y + 7, x - 7, y); c.stroke();
    c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fill();
  } else {
    c.moveTo(x - 7, y - 1); c.quadraticCurveTo(x, y + 5, x + 7, y - 1); c.stroke();
    c.beginPath(); for (const d of [-4, 0, 4]) { c.moveTo(x + d, y + 2.5); c.lineTo(x + d * 1.2, y + 5.5); } c.stroke();
  }
  c.restore();
}

// Small drawn icons, so the tabs read the same on every device and need no icon font.
function drawTabIcon(c, tab, x, y, color) {
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.6; c.lineCap = 'round';
  c.beginPath();
  if (tab === 'spline') {
    c.moveTo(x - 8, y + 6); c.bezierCurveTo(x - 3, y + 6, x - 3, y - 6, x + 8, y - 6);
    c.stroke();
    c.beginPath(); c.arc(x - 8, y + 6, 2, 0, 7); c.arc(x + 8, y - 6, 2, 0, 7); c.fill();
  } else if (tab === 'place') {
    for (const [a, b] of [[-6, -5], [6, -5], [0, 0], [-6, 5], [6, 5]]) { c.moveTo(x + a + 2, y + b); c.arc(x + a, y + b, 2, 0, 7); }
    c.fill();
  } else if (tab === 'mesh' || tab === 'shape') {
    c.moveTo(x, y - 8); c.lineTo(x + 7, y - 4); c.lineTo(x + 7, y + 4); c.lineTo(x, y + 8); c.lineTo(x - 7, y + 4); c.lineTo(x - 7, y - 4); c.closePath();
    c.moveTo(x, y - 8); c.lineTo(x, y + 8);
    c.stroke();
  } else if (tab === 'wind') {
    c.moveTo(x - 8, y - 3); c.lineTo(x + 3, y - 3); c.bezierCurveTo(x + 7, y - 3, x + 7, y - 8, x + 3, y - 8);
    c.moveTo(x - 8, y + 1); c.lineTo(x + 6, y + 1); c.bezierCurveTo(x + 10, y + 1, x + 10, y + 7, x + 5, y + 7);
    c.moveTo(x - 8, y + 5); c.lineTo(x, y + 5);
    c.stroke();
  } else if (tab === 'growth') {
    // A sprout: a stem forking into two shoots, a bud on each.
    c.moveTo(x, y + 8); c.lineTo(x, y);
    c.moveTo(x, y + 1); c.quadraticCurveTo(x - 1, y - 4, x - 6, y - 6);
    c.moveTo(x, y + 3); c.quadraticCurveTo(x + 2, y - 2, x + 6, y - 3);
    c.stroke();
    c.beginPath(); c.arc(x - 6, y - 6, 1.8, 0, 7); c.arc(x + 6, y - 3, 1.8, 0, 7); c.arc(x, y - 1, 1.8, 0, 7); c.fill();
  } else {
    c.arc(x, y, 7, 0, 7);
    c.stroke();
    c.beginPath(); c.arc(x - 2, y - 2, 2.4, 0, 7); c.fill();
  }
}

// The material's own values shown on a node, so quick changes don't need the material editor.
const MAT_ROWS = [
  { k: 'color', map: 'texture', l: '  Color', t: 'matslot', d: '#ffffff' },
  { k: 'roughColor', map: 'roughMap', l: '  Roughness', t: 'matslot', d: '#808080' },
  { k: 'normalColor', map: 'normalMap', l: '  Normal', t: 'matslot', d: '#8080ff' },
  { k: 'opacityColor', map: 'opacityMap', l: '  Opacity', t: 'matslot', d: '#ffffff' },
];

function buildLayout(node) {
  const def = NODE_TYPES[node.type];
  const tabs = def.tabs || null;
  const view = node.view ?? 1;
  const { inputs, outputs } = socketsOf(node);
  const links = doc.graph.links;
  const connected = (k, dir) => links.some((l) => (dir === 'in' ? l.to === node.id && l.toSock === k : l.from === node.id && l.fromSock === k));
  const rows = [];
  const sockets = new Map();
  const exposed = node.exposed || [];

  // Main connectors sit on the header: inputs left, outputs right. One shares the title line;
  // several get a labelled line each below it.
  const left = inputs.filter((s) => !s.param);
  const right = outputs.filter((s) => !s.outValue);
  const lines = (list) => (list.length > 1 ? list.length : 0);
  const extra = Math.max(lines(left), lines(right));
  const tabY = HEADER + (extra ? extra * SOCKET_ROW + 4 : 0);
  const header = tabY + (tabs ? TAB_H : 0);
  const place = (list, x, side) => list.forEach((s, i) => {
    const many = list.length > 1;
    sockets.set(s.k, { ...s, side, main: true, x, y: many ? HEADER + 8 + i * SOCKET_ROW : HEADER / 2, tag: many ? s.l || KIND_INFO[s.kind]?.[0] || s.k : null });
  });
  place(left, 0, 'left');
  place(right, NODE_W, 'right');

  let y = header + (view === 0 && !tabs ? 0 : 3);
  const addRow = (row) => { row.y = y; row.h = row.h || ROW; rows.push(row); y += row.h; return row; };

  let closed = false;
  for (const p of def.params) {
    if (p.t === 'data') continue;
    // Tabbed nodes show one tab's settings at a time, all of them; classic nodes fold by view.
    const inTab = tabs ? p.tab === node.tab : true;
    if (p.t === 'section') {
      // A group that folds starts closed; its heading opens it.
      closed = false;
      if (tabs && inTab && shown(p, node.params)) {
        const open = !p.fold || !!node.folds?.[p.k];
        addRow({ kind: 'head', label: p.l, h: ROW + 2, fold: p.fold ? p.k : null, open });
        closed = !open;
      }
      continue;
    }
    if (p.t === 'mods') closed = false;
    if (closed) continue;
    if (p.t === 'mods') {
      if (!inTab || !shown(p, node.params)) continue;
      addRow({ kind: 'head', label: p.l, h: ROW + 2 });
      for (const mod of node.params[p.k] || []) {
        addRow({ kind: 'mod', mod, set: p.set, key: p.k });
        if (!mod.open) continue;
        for (const q of modParams(p.set, mod)) {
          // Stacks saved with only a few values still need something to show in every row.
          if (mod.params[q.k] === undefined && q.d !== undefined) mod.params[q.k] = q.d;
          if (shown(q, mod.params)) addRow({ kind: 'param', param: q, owner: mod.params, mod, set: p.set });
        }
      }
      addRow({ kind: 'add', set: p.set, key: p.k });
      continue;
    }
    const linkedV = connected(`p:${p.k}`, 'in');
    const linkedC = connected(`c:${p.k}`, 'in');
    const show = tabs ? inTab && shown(p, node.params)
      : (linkedV || linkedC || shown(p, node.params)) && (view === 2 || (view === 1 && (p.n || linkedV || linkedC)));
    if (show) {
      const curveRow = p.t === 'curve' && def.type === 'Curve';
      const r = addRow({ kind: 'param', param: p, owner: node.params, linked: linkedV || linkedC, h: curveRow ? CURVE_ROW : ROW });
      if (p.t === 'matref' && p.tab === 'material') {
        const m = (doc.graph.materials || []).find((x) => x.id === node.params.material);
        if (m) for (const q of MAT_ROWS) addRow({ kind: 'param', param: q, owner: m });
      }
      if (exposed.includes(p.k)) {
        sockets.set(`p:${p.k}`, { k: `p:${p.k}`, kind: 'value', side: 'left', dir: 'in', param: p.k, x: 0, y: r.y + r.h / 2 });
        sockets.set(`o:${p.k}`, { k: `o:${p.k}`, kind: 'value', side: 'right', dir: 'out', param: p.k, outValue: true, x: NODE_W, y: r.y + r.h / 2 });
      }
      // A setting's sockets start hidden: they show once exposed from its menu, or while a wire uses them.
      if (p.sock && linkedV) sockets.set(`p:${p.k}`, { k: `p:${p.k}`, kind: 'value', side: 'left', dir: 'in', param: p.k, x: 0, y: r.y + r.h / 2 });
      if (p.c && linkedC) sockets.set(`c:${p.k}`, { k: `c:${p.k}`, kind: 'curve', side: 'right', dir: 'in', param: p.k, x: NODE_W, y: r.y + r.h / 2 });
    } else {
      // Folded settings keep any wires by attaching to the header.
      if (exposed.includes(p.k)) {
        sockets.set(`p:${p.k}`, { k: `p:${p.k}`, kind: 'value', side: 'left', dir: 'in', param: p.k, x: 0, y: HEADER / 2, hidden: !linkedV });
        sockets.set(`o:${p.k}`, { k: `o:${p.k}`, kind: 'value', side: 'right', dir: 'out', param: p.k, outValue: true, x: NODE_W, y: HEADER / 2, hidden: !connected(`o:${p.k}`, 'out') });
      }
      if (p.sock) sockets.set(`p:${p.k}`, { k: `p:${p.k}`, kind: 'value', side: 'left', dir: 'in', param: p.k, x: 0, y: HEADER / 2, hidden: !linkedV });
      if (p.c) sockets.set(`c:${p.k}`, { k: `c:${p.k}`, kind: 'curve', side: 'right', dir: 'in', param: p.k, x: NODE_W, y: HEADER / 2, hidden: !linkedC });
    }
  }
  // Number outputs (Length, Angle and so on) stay as rows, since most nodes never use them.
  for (const s of outputs) {
    if (!s.outValue || s.param) continue;
    if (view === 0) { sockets.set(s.k, { ...s, x: NODE_W, y: HEADER / 2, hidden: !connected(s.k, 'out') }); continue; }
    const r = addRow({ kind: 'sock', side: 'right', label: s.l || s.k });
    sockets.set(s.k, { ...s, side: 'right', x: NODE_W, y: r.y + r.h / 2 });
  }
  const open = !tabs ? view !== 0 : !!node.tab;
  return { w: NODE_W, h: y + (open ? PAD : 0), header, tabY, tabs, rows, sockets };
}
