// A map's picture in a popup: the list in its top-left corner picks another (or loads one), the cross closes it.
// The wheel zooms at the pointer, dragging pans, a double click fits it again. It opens even when the slot is
// empty, so a picture can be chosen from here.
import { textureSource } from './textures.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// choices: [[id, label]]; onPick(id) applies a choice (null for none) and may return a new id; load() asks for a file and returns its id.
export function openImage({ title, value, choices, assets, onPick, load }) {
  document.querySelector('.imgpop')?.remove();
  const pop = el('div', 'imgpop');
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', title);
  const head = el('div', 'imgpop-head');
  const pick = el('select', 'imgpop-pick'); pick.setAttribute('aria-label', `${title}: picture`);
  const add = (id, text) => { const o = el('option', '', text); o.value = id; pick.append(o); };
  add('', 'No texture');
  for (const [id, text] of choices) add(id, text);
  if (load) add('__load', 'Load image…');
  const name = el('span', 'imgpop-title', title);
  const close = el('button', 'icon-mini', '✕'); close.title = 'Close'; close.setAttribute('aria-label', 'Close');
  head.append(pick, name, close);
  const view = el('div', 'imgpop-view'); const c = el('canvas'); const empty = el('p', 'imgpop-empty', 'No picture in this slot. Pick one from the list above.');
  view.append(c, empty);
  pop.append(head, view);
  document.body.append(pop);

  let img = null; const v = { k: 1, x: 0, y: 0 };
  const draw = () => {
    const r = Math.min(devicePixelRatio || 1, 2); const W = view.clientWidth; const H = view.clientHeight;
    c.width = W * r; c.height = H * r; c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, W, H);
    empty.hidden = !!img;
    if (!img) return;
    // A checkerboard shows through where the picture is see-through.
    const w = img.width * v.k; const h = img.height * v.k;
    g.save(); g.beginPath(); g.rect(v.x, v.y, w, h); g.clip();
    for (let y = 0; y < h; y += 12) for (let x = 0; x < w; x += 12) { g.fillStyle = ((x + y) / 12) % 2 ? '#2a2f28' : '#3a4037'; g.fillRect(v.x + x, v.y + y, 12, 12); }
    g.imageSmoothingEnabled = v.k < 4;
    g.drawImage(img, v.x, v.y, w, h); g.restore();
  };
  const fit = () => { if (!img) return draw(); const W = view.clientWidth; const H = view.clientHeight; v.k = Math.min((W - 48) / img.width, (H - 48) / img.height); v.x = (W - img.width * v.k) / 2; v.y = (H - img.height * v.k) / 2; draw(); };
  // The popup takes the picture's shape (square for a square map), with a border around it; empty, it is square.
  const sizeTo = () => {
    const pad = 24; const head = pop.firstChild.offsetHeight;
    const w = img?.width || 1; const h = img?.height || 1;
    const k = Math.min((innerWidth * 0.92 - pad * 2) / w, (innerHeight * 0.85 - head - pad * 2) / h, img ? Math.max(1, 360 / Math.min(w, h)) : 480);
    pop.style.width = `${Math.max(320, w * k + pad * 2)}px`; pop.style.height = `${head + h * k + pad * 2}px`;
  };
  const show = async (id) => { img = id ? await textureSource(id, assets) : null; sizeTo(); fit(); };

  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = c.getBoundingClientRect(); const mx = e.clientX - b.left; const my = e.clientY - b.top;
    const f = Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.0015);
    v.x = mx - (mx - v.x) * f; v.y = my - (my - v.y) * f; v.k *= f; draw();
  }, { passive: false });
  const touches = new Map(); let last = null;
  c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); touches.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
  c.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    const prev = touches.get(e.pointerId); touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      // Two fingers pinch to zoom around their middle.
      const [a, b2] = [...touches.values()]; const d = Math.hypot(a[0] - b2[0], a[1] - b2[1]);
      const r = c.getBoundingClientRect(); const mx = (a[0] + b2[0]) / 2 - r.left; const my = (a[1] + b2[1]) / 2 - r.top;
      if (last) { const f = d / last; v.x = mx - (mx - v.x) * f; v.y = my - (my - v.y) * f; v.k *= f; }
      last = d; draw(); return;
    }
    v.x += e.clientX - prev[0]; v.y += e.clientY - prev[1]; draw();
  });
  const lift = (e) => { touches.delete(e.pointerId); last = null; };
  c.addEventListener('pointerup', lift); c.addEventListener('pointercancel', lift);
  c.addEventListener('dblclick', fit);

  pick.value = value || '';
  pick.addEventListener('change', async () => {
    let id = pick.value || null;
    if (id === '__load') {
      pick.value = value || '';
      id = await load();
      if (!id) return;
      if (![...pick.options].some((o) => o.value === id)) { const o = el('option', '', assets[id]?.name || id); o.value = id; pick.insertBefore(o, pick.lastChild); }
      pick.value = id;
    }
    value = id;
    await onPick(id);
    show(id);
  });
  const done = () => { pop.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  close.addEventListener('click', done);
  pop.addEventListener('keydown', (e) => e.stopPropagation());
  document.addEventListener('keydown', key, true);
  show(value);
  return { close: done };
}
