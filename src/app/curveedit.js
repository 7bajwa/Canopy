// The curve graph: scroll to zoom, right-drag to pan, points can go past the box, and a preset is one click away.
import { bakeCurve, sampleCurve } from '../engine/math.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const S = (x, y) => [x, y, 's'];

export const CURVE_PRESETS = [
  ['Gradual down', [S(0, 1), S(1, 0)]],
  ['Gradual up', [S(0, 0), S(1, 1)]],
  ['Fast fall', [S(0, 1), S(0.25, 0.28), S(0.6, 0.06), S(1, 0)]],
  ['Slow rise', [S(0, 0), S(0.4, 0.06), S(0.75, 0.28), S(1, 1)]],
  ['All up', [S(0, 1), S(1, 1)]],
  ['All mid', [S(0, 0.5), S(1, 0.5)]],
  ['All down', [S(0, 0), S(1, 0)]],
  ['Arch', [S(0, 0), S(0.5, 1), S(1, 0)]],
  ['Valley', [S(0, 1), S(0.5, 0), S(1, 1)]],
  ['S curve', [S(0, 0), S(0.25, 0.08), S(0.75, 0.92), S(1, 1)]],
  ['S falling', [S(0, 1), S(0.25, 0.92), S(0.75, 0.08), S(1, 0)]],
  ['Blade', [S(0, 0.05), S(0.3, 0.9), S(0.55, 1), S(1, 0.02)]],
];

function preview(pts, w = 56, h = 30) {
  const c = el('canvas');
  c.width = w * 2; c.height = h * 2;
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  const x = c.getContext('2d');
  x.scale(2, 2);
  const table = bakeCurve({ pts });
  x.strokeStyle = '#de4dbb'; x.lineWidth = 1.5;
  x.beginPath();
  for (let i = 0; i <= 40; i++) { const u = i / 40; const py = h - 4 - sampleCurve(table, u) * (h - 8); if (i) x.lineTo(u * w, py); else x.moveTo(u * w, py); }
  x.stroke();
  return c;
}

// scopes: [{ id, label, active }] for the chain above this value, or nothing for a curve that has no chain.
export function curveEditor(curve, { onChange, onDone, onReset, scopes, scope, onScope }) {
  const W = 320; const H = 190;
  const wrap = el('div', 'curve');
  const head = el('div', 'curve-head');
  const reset = el('button', 'icon-mini', '↺');
  reset.title = 'Reset this curve';
  reset.setAttribute('aria-label', 'Reset this curve');
  head.append(reset);
  if (scopes) {
    const pick = el('select', 'curve-scope');
    pick.setAttribute('aria-label', 'Which level of the chain this curve runs along');
    for (const s of scopes) { const o = el('option', '', `${s.active ? '● ' : ''}${s.label}`); o.value = s.id; pick.append(o); }
    pick.value = scope;
    pick.addEventListener('change', () => onScope(pick.value));
    head.append(pick);
  } else head.append(el('span', 'curve-spacer'));
  const presetBtn = el('button', 'preset-btn');
  presetBtn.title = 'Curve presets';
  presetBtn.setAttribute('aria-label', 'Curve presets');
  presetBtn.append(preview(CURVE_PRESETS[0][1], 26, 16), el('span', 'chev', '▾'));
  head.append(presetBtn);
  const grid = el('div', 'preset-grid');
  grid.hidden = true;

  const stage = el('div', 'curve-stage');
  const c = el('canvas');
  const r = Math.min(devicePixelRatio || 1, 2);
  c.width = W * r; c.height = H * r;
  c.style.width = '100%';
  c.style.touchAction = 'none';
  // The picked point's X and Y, typed in.
  const readout = el('div', 'curve-readout curve-point');
  // Drag a box sideways to change it; a click without dragging types into it.
  const box = (label, axis) => {
    const l = el('label', '', label); const i = el('input');
    i.type = 'text'; i.inputMode = 'decimal'; i.setAttribute('aria-label', `Point ${label}`);
    let scrub = null;
    i.addEventListener('pointerdown', (e) => {
      if (document.activeElement === i) return;
      e.preventDefault(); i.setPointerCapture(e.pointerId);
      scrub = { x: e.clientX, v: parseFloat(i.value) || 0, moved: false };
    });
    i.addEventListener('pointermove', (e) => {
      if (!scrub) return;
      const dx = e.clientX - scrub.x;
      if (!scrub.moved && Math.abs(dx) < 3) return;
      scrub.moved = true;
      const span = axis === 'x' ? view.x1 - view.x0 : view.y1 - view.y0;
      i.value = (scrub.v + dx * span * 0.004 * (e.shiftKey ? 0.1 : 1)).toFixed(3);
      typed(true);
    });
    i.addEventListener('pointerup', () => {
      if (!scrub) return;
      const was = scrub; scrub = null;
      if (was.moved) { send(false); onDone?.(); } else { i.focus(); i.select(); }
    });
    l.append(i); readout.append(l); return i;
  };
  const inX = box('X', 'x'); const inY = box('Y', 'y');
  stage.append(c, readout);
  const ctx = c.getContext('2d');
  let pts = (curve?.pts || [S(0, 1), S(1, 1)]).map((p) => [...p]);
  let active = -1;
  // Shows a little past 0 to 1 at the start, so it's plain that points can leave the box.
  const view = { x0: -0.08, x1: 1.08, y0: -0.14, y1: 1.18 };
  const fit = () => {
    const ys = pts.map((p) => p[1]);
    view.y0 = Math.min(-0.14, Math.min(...ys) - 0.14); view.y1 = Math.max(1.18, Math.max(...ys) + 0.18);
  };
  fit();
  const toX = (x) => ((x - view.x0) / (view.x1 - view.x0)) * W;
  const toY = (y) => H - ((y - view.y0) / (view.y1 - view.y0)) * H;
  const fromX = (px) => view.x0 + (px / W) * (view.x1 - view.x0);
  const fromY = (py) => view.y0 + ((H - py) / H) * (view.y1 - view.y0);
  const gridStep = (span) => { const raw = span / 6; const m = 10 ** Math.floor(Math.log10(raw)); const n = raw / m; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * m; };

  const draw = () => {
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    const sx = gridStep(view.x1 - view.x0); const sy = gridStep(view.y1 - view.y0);
    for (let g = Math.ceil(view.x0 / sx) * sx; g <= view.x1; g += sx) { ctx.beginPath(); ctx.moveTo(toX(g), 0); ctx.lineTo(toX(g), H); ctx.stroke(); }
    for (let g = Math.ceil(view.y0 / sy) * sy; g <= view.y1; g += sy) { ctx.beginPath(); ctx.moveTo(0, toY(g)); ctx.lineTo(W, toY(g)); ctx.stroke(); }
    // The 0 to 1 box.
    ctx.strokeStyle = 'rgba(155,225,93,.4)';
    ctx.strokeRect(toX(0), toY(1), toX(1) - toX(0), toY(0) - toY(1));
    const table = bakeCurve({ pts });
    ctx.strokeStyle = '#de4dbb'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const x = i / 120; const y = toY(sampleCurve(table, x)); if (i) ctx.lineTo(toX(x), y); else ctx.moveTo(toX(x), y); }
    ctx.stroke();
    pts.forEach((p, i) => {
      ctx.fillStyle = i === active ? '#fff' : '#f0bfe4';
      ctx.beginPath();
      if (p[2] === 'c') ctx.rect(toX(p[0]) - 4.5, toY(p[1]) - 4.5, 9, 9); else ctx.arc(toX(p[0]), toY(p[1]), 5, 0, 7);
      ctx.fill();
    });
    const a = pts[active];
    readout.hidden = !a;
    if (a) { if (document.activeElement !== inX) inX.value = a[0].toFixed(3); if (document.activeElement !== inY) inY.value = a[1].toFixed(3); }
  };
  const typed = (draft = false) => {
    const p = pts[active];
    if (!p) return;
    const x = parseFloat(inX.value); const y = parseFloat(inY.value);
    // X stays between its neighbours, so the points keep their order.
    const lo = active ? pts[active - 1][0] + 0.002 : -Infinity;
    const hi = active < pts.length - 1 ? pts[active + 1][0] - 0.002 : Infinity;
    if (Number.isFinite(x)) p[0] = Math.max(lo, Math.min(hi, x));
    if (Number.isFinite(y)) p[1] = y;
    if (draft) { draw(); send(true); return; }
    fit(); draw(); send(false); onDone?.();
  };
  for (const i of [inX, inY]) {
    i.addEventListener('change', () => typed());
    i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { typed(); i.blur(); } });
  }

  const at = (e) => { const b = c.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * W, ((e.clientY - b.top) / b.height) * H]; };
  const send = (draft) => onChange({ pts: pts.map((p) => [...p]) }, draft);
  const nearest = (mx, my) => pts.findIndex((p) => Math.hypot(toX(p[0]) - mx, toY(p[1]) - my) < (matchMedia('(pointer: coarse)').matches ? 18 : 11));
  const remove = (i) => {
    if (i < 0 || pts.length <= 2) return;
    pts.splice(i, 1);
    active = -1;
    draw(); send(false); onDone?.();
  };
  const zoom = (mx, my, f) => {
    const px = fromX(mx); const py = fromY(my);
    view.x0 = px + (view.x0 - px) * f; view.x1 = px + (view.x1 - px) * f;
    view.y0 = py + (view.y0 - py) * f; view.y1 = py + (view.y1 - py) * f;
    draw();
  };
  const panBy = (dx, dy) => {
    const kx = (view.x1 - view.x0) / W; const ky = (view.y1 - view.y0) / H;
    view.x0 -= dx * kx; view.x1 -= dx * kx; view.y0 += dy * ky; view.y1 += dy * ky;
    draw();
  };

  const touching = new Map();
  let drag = null; let lastTap = { t: 0, i: -1 };
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    const [mx, my] = at(e);
    touching.set(e.pointerId, [mx, my]);
    if (touching.size === 2) { const [a, b] = [...touching.values()]; drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
    const hit = nearest(mx, my);
    if (e.button === 1 || e.button === 2) { drag = { pan: [mx, my], hit, moved: false }; return; }
    // Two quick taps on a point remove it, for fingers and pens.
    const now = performance.now();
    if (hit >= 0 && lastTap.i === hit && now - lastTap.t < 450) { lastTap = { t: 0, i: -1 }; remove(hit); drag = null; return; }
    lastTap = { t: now, i: hit };
    active = hit;
    if (active < 0) {
      const x = fromX(mx); const y = fromY(my);
      pts.push(S(x, y));
      pts.sort((a, b) => a[0] - b[0]);
      active = pts.findIndex((p) => p[0] === x && p[1] === y);
      send(true);
    }
    drag = { point: true, from: [mx, my], moved: false };
    // Holding still on a point turns it smooth or sharp.
    if (hit >= 0) {
      drag.hold = setTimeout(() => {
        if (!drag?.point || drag.moved || active !== hit) return;
        pts[hit][2] = pts[hit][2] === 'c' ? 's' : 'c';
        drag.held = true;
        draw(); send(false); onDone?.();
      }, 550);
    }
    draw();
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag || !c.hasPointerCapture(e.pointerId)) return;
    const [mx, my] = at(e);
    if (touching.has(e.pointerId)) touching.set(e.pointerId, [mx, my]);
    if (drag.pinch !== undefined) {
      if (touching.size < 2) return;
      const [a, b] = [...touching.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      panBy(mid[0] - drag.mid[0], mid[1] - drag.mid[1]);
      zoom(mid[0], mid[1], drag.pinch / Math.max(d, 1));
      drag.pinch = d; drag.mid = mid;
      return;
    }
    if (drag.pan) {
      if (Math.hypot(mx - drag.pan[0], my - drag.pan[1]) > 3) drag.moved = true;
      if (drag.moved) { panBy(mx - drag.pan[0], my - drag.pan[1]); drag.pan = [mx, my]; }
      return;
    }
    if (active < 0) return;
    // A small wobble while holding isn't a drag.
    if (!drag.moved) { if (Math.hypot(mx - drag.from[0], my - drag.from[1]) < 4) return; drag.moved = true; clearTimeout(drag.hold); }
    if (drag.held) return;
    const p = pts[active];
    // Neighbors keep their order; everything else is free, past the box in any direction.
    const lo = active ? pts[active - 1][0] + 0.002 : -Infinity;
    const hi = active < pts.length - 1 ? pts[active + 1][0] - 0.002 : Infinity;
    p[0] = Math.max(lo, Math.min(hi, fromX(mx)));
    p[1] = fromY(my);
    draw();
    send(true);
  });
  const up = (e) => {
    touching.delete(e.pointerId);
    const d = drag;
    if (!d) return;
    if (d.pinch !== undefined) { if (!touching.size) drag = null; return; }
    clearTimeout(d.hold);
    drag = null;
    if (d.held) return;
    if (d.pan) { if (!d.moved && d.hit >= 0) remove(d.hit); return; }
    if (d.point && active >= 0) { send(false); onDone?.(); }
    draw();
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('dblclick', (e) => { e.preventDefault(); const [mx, my] = at(e); remove(nearest(mx, my)); });
  c.addEventListener('wheel', (e) => { e.preventDefault(); const [mx, my] = at(e); zoom(mx, my, Math.exp(Math.max(-200, Math.min(200, e.deltaY)) * 0.002)); }, { passive: false });

  const apply = (list, fresh) => {
    pts = list.map((p) => [...p]);
    active = -1;
    fit();
    draw();
    if (fresh) { send(false); onDone?.(); }
  };
  reset.addEventListener('click', () => {
    const back = onReset?.();
    apply((back?.pts || [S(0, 1), S(1, 1)]), false);
    onDone?.();
  });
  for (const [name, list] of CURVE_PRESETS) {
    const b = el('button', 'preset-item');
    b.title = name;
    b.setAttribute('aria-label', name);
    b.append(preview(list), el('small', '', name));
    b.addEventListener('click', () => { grid.hidden = true; apply(list, true); });
    grid.append(b);
  }
  presetBtn.addEventListener('click', () => { grid.hidden = !grid.hidden; });

  const tips = el('small', 'curve-tips', 'Click to add • Double-click to remove • Hold to sharpen or smooth • Scroll zooms');
  wrap.append(head, grid, stage, tips);
  draw();
  return wrap;
}
