// The UV editor: a floating panel with the picked node's UVs over its texture, kept beside the other panels.
// Drag inside the box to move it (Offset), its corner dot to scale it (Tile), the dot past its U edge to turn it
// (Angle). Cutout leaves show their meshes on the picture; those are shaped in the cutout editor.
import { doc, on, changed, commit, primary } from './doc.js';
import { el, numberField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { textureSource } from './textures.js';
import { meshKinds } from '../engine/expand.js';
import { tubeUv, tubeMatKey, remapTubeUv } from './pack.js';
import { snapBar, snapOn, snapTo, TURN_STEP, SCALE_STEP } from './snap.js';
import { uvTris, boxMap } from './uvwire.js';

const FIELDS = [['tileU', 'Tile U'], ['tileV', 'Tile V'], ['offsetU', 'Offset U'], ['offsetV', 'Offset V'], ['uvAngle', 'Angle', '°']];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
// Moves snap to sixteenths of a tile.
const UV_STEP = 1 / 16;
// Without a picture the UVs sit on a plain checker.
let checkerPic = null;
function checker() {
  if (checkerPic) return checkerPic;
  checkerPic = document.createElement('canvas'); checkerPic.width = checkerPic.height = 64;
  const c = checkerPic.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? '#3b4135' : '#4b5244'; c.fillRect(i * 8, j * 8, 8, 8); }
  return checkerPic;
}

export function makeUvEditor({ editCutouts }) {
  let panel; let canvas; let info; let fieldBox; let node = null; let mat = null; let img = null;
  let view = { x: 0, y: 0, k: 200 }; let drag = null; let size = [340, 300];
  // The node's built UV triangles, and its params when they were built (edits since are previewed on them).
  let wire = new Float32Array(0); let builtP = null; let sentP = null; let sentNode = null;
  const kinds = () => meshKinds(node.params);
  // Old tubes (Even texel size off) wrap two tiles of Tile U round; everything else one.
  const wrap = () => (kinds().includes('tube') && node.params.uvMatch === false ? 2 : 1);
  const F = (a, b, P = node.params) => tubeUv(P, a, b, wrap());
  const quad = () => [F(0, 0), F(1, 0), F(1, 1), F(0, 1)];
  const toS = ([u, v]) => [view.x + u * view.k, view.y + (1 - v) * view.k];
  const toUv = ([x, y]) => [(x - view.x) / view.k, 1 - (y - view.y) / view.k];
  // A cutout leaf keeps its UVs from its meshes on the picture, which are shaped in the cutout editor; any other mesh has a box.
  // Without a material carrying cutouts the leaf is a plain card, so it gets the box too.
  const cutLeaf = () => kinds().includes('cutout') && !kinds().includes('tube') && !!(mat?.cutouts?.length || node.params.cutouts?.length);
  const boxed = () => !cutLeaf() && kinds().length > 0;
  const turnDot = (q) => { const e = sub(q[1], q[0]); return [q[1][0] + e[0] * 0.2, q[1][1] + e[1] * 0.2]; };

  // A tube beside leaves with its own material shows only its own UVs over its picture.
  function readWire(res, P) {
    const own = tubeMatKey(node.params) === 'tubeMaterial';
    wire = uvTris(res?.meshes, (m) => m.nodeId === node.id && (!own || m.kind === 'bark'));
    builtP = P;
  }

  function fit() {
    const pts = node ? [...quad(), [0, 0], [1, 1]] : [[0, 0], [1, 1]];
    for (let i = 0; i < wire.length; i += 2) pts.push([wire[i], wire[i + 1]]);
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const [u, v] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const k = Math.min(size[0] / (u1 - u0 || 1), size[1] / (v1 - v0 || 1)) * 0.85;
    view = { k, x: size[0] / 2 - ((u0 + u1) / 2) * k, y: size[1] / 2 - (1 - (v0 + v1) / 2) * k };
  }

  function draw() {
    const r = Math.min(devicePixelRatio || 1, 2);
    canvas.width = size[0] * r; canvas.height = size[1] * r;
    const c = canvas.getContext('2d');
    c.setTransform(r, 0, 0, r, 0, 0);
    c.fillStyle = '#15190f'; c.fillRect(0, 0, size[0], size[1]);
    if (!node) return;
    const q = quad().map(toS);
    const path = () => { c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath(); };
    {
      // The texture repeats, as it does on the mesh: dim outside the box, full inside it.
      const pic = img || checker();
      const w = pic.naturalWidth || pic.width; const h = pic.naturalHeight || pic.height;
      const pat = c.createPattern(pic, 'repeat');
      pat.setTransform(new DOMMatrix([view.k / w, 0, 0, view.k / h, view.x, view.y]));
      c.fillStyle = pat;
      c.globalAlpha = 0.35; c.fillRect(0, 0, size[0], size[1]); c.globalAlpha = 1;
      c.save(); if (boxed()) { path(); c.clip(); } c.fillRect(0, 0, size[0], size[1]); c.restore();
      // A cutout leaf's meshes, where they read the picture: turned by the angle about the middle of their own patch.
      const pick = node.params.cutoutPick;
      const ang = (+node.params.uvAngle || 0) * (Math.PI / 180); const cs = Math.cos(ang); const sn = Math.sin(ang);
      for (const cut of img && kinds().includes('cutout') ? (mat?.cutouts || []).filter((x) => x.enabled !== false && (!Array.isArray(pick) || pick.includes(x.id))) : []) {
        const xs = cut.outlinePx.map((p) => p[0] / w); const ys = cut.outlinePx.map((p) => 1 - p[1] / h);
        const cu = (Math.min(...xs) + Math.max(...xs)) / 2; const cv = (Math.min(...ys) + Math.max(...ys)) / 2;
        const turn = ([x, y]) => { const u = x / w - cu; const v = 1 - y / h - cv; return toS([cu + u * cs - v * sn, cv + u * sn + v * cs]); };
        c.beginPath();
        for (const loop of [cut.outlinePx, ...(cut.holesPx || [])]) loop.forEach((p, i) => { const s = turn(p); if (i) c.lineTo(...s); else c.moveTo(...s); });
        c.strokeStyle = 'rgba(127,255,106,.9)'; c.lineWidth = 1; c.stroke();
      }
    }
    // The grid: tile lines, finer steps as the view zooms in, brighter on the 0..1 tile.
    const [lo, hi] = [toUv([0, size[1]]), toUv([size[0], 0])];
    const seg = (p, q2) => { c.beginPath(); c.moveTo(...toS(p)); c.lineTo(...toS(q2)); c.stroke(); };
    const lines = (step, inside, outside) => {
      for (const ax of [0, 1]) {
        for (let t = Math.ceil(lo[ax] / step) * step; t <= hi[ax]; t += step) {
          c.strokeStyle = outside; seg(ax ? [lo[0], t] : [t, lo[1]], ax ? [hi[0], t] : [t, hi[1]]);
          if (t > -1e-9 && t < 1 + 1e-9) { c.strokeStyle = inside; seg(ax ? [0, t] : [t, 0], ax ? [1, t] : [t, 1]); }
        }
      }
    };
    c.lineWidth = 1;
    const fine = view.k >= 240 ? 1 / 8 : view.k >= 100 ? 1 / 4 : 0;
    if (fine && (hi[0] - lo[0]) / fine < 400) lines(fine, 'rgba(255,255,255,.14)', 'rgba(255,255,255,.05)');
    if (hi[0] - lo[0] < 400) lines(1, 'rgba(255,255,255,.3)', 'rgba(255,255,255,.14)');
    // The built UVs; box edits made since that build move them with the box until the rebuild lands.
    const map = boxed() && builtP ? boxMap([[0, 0], [1, 0], [0, 1]].map(([x, y]) => F(x, y, builtP)), [F(0, 0), F(1, 0), F(0, 1)]) : null;
    c.beginPath();
    for (let i = 0; i < wire.length; i += 6) {
      for (let k = i; k < i + 6; k += 2) { const p = toS(map ? map(wire[k], wire[k + 1]) : [wire[k], wire[k + 1]]); if (k > i) c.lineTo(...p); else c.moveTo(...p); }
      c.closePath();
    }
    c.strokeStyle = 'rgba(120,210,255,.6)'; c.lineWidth = 0.6; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1;
    const [a, b] = [toS([0, 1]), toS([1, 0])]; c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    if (!boxed()) return;
    path(); c.strokeStyle = '#ffe45c'; c.lineWidth = 2; c.stroke();
    const dot = (p, rad) => { c.beginPath(); c.arc(p[0], p[1], rad, 0, 7); c.fill(); };
    c.fillStyle = '#ffe45c'; dot(q[0], 5); dot(q[2], 6); dot(toS(turnDot(quad())), 6);
    c.fillStyle = '#11160f'; dot(toS(turnDot(quad())), 2.5);
  }

  function fillFields() {
    fieldBox.replaceChildren();
    if (!node) return;
    snaps.hidden = hint.hidden = !boxed();
    if (!boxed()) return;
    for (const [k, label, unit] of FIELDS) {
      fieldBox.append(numberField(label, +node.params[k] || (k.startsWith('tile') ? 1 : 0), { unit }, (v, draft) => { apply({ [k]: v }, draft); draw(); }, () => commit()));
    }
  }

  let self = false;
  function apply(patch, draft = true) { Object.assign(node.params, patch); self = true; changed({ draft, layout: !draft }); self = false; }

  async function load(n = primary()) {
    node = n && n.params?.tileU !== undefined ? n : null;
    mat = null; img = null; wire = new Float32Array(0); builtP = null;
    if (!node) { info.textContent = 'Pick a Spline or Mesh node to see its UVs.'; fillFields(); draw(); return; }
    const key = kinds().includes('tube') ? tubeMatKey(node.params) : 'material';
    mat = (doc.graph.materials || []).find((m) => m.id === node.params[key]) || null;
    info.textContent = `${node.name || 'Node'}${mat ? ` · ${mat.name}` : ' · no material'}`;
    cutBtn.hidden = !(kinds().includes('cutout') && mat);
    readWire(doc.result, { ...node.params });
    fillFields(); fit(); draw();
    const want = node;
    const pic = mat?.texture ? await textureSource(mat.texture, doc.assets).catch(() => null) : null;
    if (want === node) { img = pic; draw(); }
  }

  let cutBtn; let snaps; let hint;
  function build() {
    panel = floatPanel('uv-editor', 'UV editor', { width: 372 });
    info = el('p', 'hint', '');
    canvas = el('canvas', '');
    canvas.style.cssText = `width:${size[0]}px;height:${size[1]}px;touch-action:none;border-radius:4px;cursor:crosshair`;
    const bar = el('div', '');
    bar.style.cssText = 'display:flex;gap:6px';
    const fitBtn = el('button', 'mini', 'Fit'); fitBtn.title = 'Fit the UVs and the texture to the view';
    fitBtn.addEventListener('click', () => { fit(); draw(); });
    cutBtn = el('button', 'mini', 'Edit cutouts…'); cutBtn.title = 'Shape the cutout meshes of this material';
    cutBtn.addEventListener('click', () => mat && editCutouts(mat));
    snaps = snapBar('uv', ['move', 'turn', 'scale']);
    bar.append(fitBtn, cutBtn, snaps);
    fieldBox = el('div', '');
    fieldBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    hint = el('p', 'hint', 'Drag inside the box to move it, its corner dot to scale it, the dot past its edge to turn it. Right-drag pans, the wheel zooms.');
    panel.body.append(info, canvas, bar, fieldBox, hint);
    const at = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (!node) return;
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      const s = at(e); const P = { ...node.params }; const q = quad();
      if (!boxed() && e.button === 0) return;
      const near = (p) => Math.hypot(...sub(toS(p), s)) < (matchMedia('(pointer: coarse)').matches ? 18 : 10);
      if (e.button === 1 || e.button === 2) drag = { pan: s };
      else if (near(turnDot(q))) { const m = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2]; drag = { turn: true, P, m, a0: Math.atan2(...sub(toUv(s), m).reverse()) }; }
      else if (near(q[2])) drag = { scale: true, P, q };
      else drag = { move: true, P, u0: toUv(s) };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const s = at(e); const u = toUv(s); const { P } = drag;
      if (drag.pan) { view.x += s[0] - drag.pan[0]; view.y += s[1] - drag.pan[1]; drag.pan = s; draw(); return; }
      const by = (v) => (snapOn('uv', 'move', e) ? snapTo(v, UV_STEP) : v);
      if (drag.move) apply({ offsetU: by((+P.offsetU || 0) + u[0] - drag.u0[0]), offsetV: by((+P.offsetV || 0) + u[1] - drag.u0[1]) });
      else if (drag.turn) {
        // Turned about the box's middle, so it spins in place.
        const a = Math.atan2(...sub(u, drag.m).reverse()) - drag.a0; const da = snapOn('uv', 'turn', e) ? snapTo(a, TURN_STEP) : a; const cs = Math.cos(da); const sn = Math.sin(da); const { m } = drag;
        apply(remapTubeUv(P, ([x, y]) => [m[0] + (x - m[0]) * cs - (y - m[1]) * sn, m[1] + (x - m[0]) * sn + (y - m[1]) * cs], wrap()));
      } else {
        // The far corner follows the pointer along the box's own U and V; the first corner stays put.
        const { q } = drag; const eA = sub(q[1], q[0]); const eB = sub(q[3], q[0]); const p = sub(u, q[0]);
        const det = eA[0] * eB[1] - eA[1] * eB[0] || 1;
        const lim = (x) => (Math.abs(x) < 0.01 ? Math.sign(x || 1) * 0.01 : x);
        const sn = (x) => (snapOn('uv', 'scale', e) ? snapTo(x, SCALE_STEP) : x);
        const sa = lim(sn((p[0] * eB[1] - p[1] * eB[0]) / det)); const sb = lim(sn((eA[0] * p[1] - eA[1] * p[0]) / det));
        apply(remapTubeUv(P, ([x, y]) => {
          const d = sub([x, y], q[0]); const a = (d[0] * eB[1] - d[1] * eB[0]) / det; const b = (eA[0] * d[1] - eA[1] * d[0]) / det;
          return [q[0][0] + eA[0] * a * sa + eB[0] * b * sb, q[0][1] + eA[1] * a * sa + eB[1] * b * sb];
        }, wrap()));
      }
      draw();
    });
    const up = () => { if (drag && !drag.pan) { changed({ layout: true }); commit(); fillFields(); } drag = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [sx, sy] = at(e); const f = Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002);
      const k = Math.min(20000, Math.max(10, view.k * f));
      view.x = sx - ((sx - view.x) / view.k) * k; view.y = sy - ((sy - view.y) / view.k) * k; view.k = k;
      draw();
    }, { passive: false });
    on('selection', () => { if (panel.isOpen()) load(); });
    on('document', () => { if (panel.isOpen()) load(); });
    // The params each build was sent with, so its UVs can follow any box edit made since.
    on('build-start', () => { sentNode = node; sentP = node ? { ...node.params } : null; });
    on('result', (res) => { if (!panel.isOpen() || !node) return; readWire(res, sentNode === node && sentP ? sentP : { ...node.params }); draw(); });
    // Changes made elsewhere (the properties, undo) show here; fields being typed in are left alone.
    on('graph', () => {
      if (!panel.isOpen() || drag || self) return;
      if (node && !doc.graph.nodes.includes(node)) { load(); return; }
      if (!panel.root.contains(document.activeElement)) fillFields();
      draw();
    });
  }

  return {
    open(n) { if (!panel) build(); panel.show(); load(n || undefined); },
    isOpen: () => !!panel?.isOpen(),
  };
}
