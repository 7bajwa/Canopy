// The color popup: opens right beside the color box that was clicked, styled like the nodes. A saturation and
// brightness square, a hue strip, and the values in Hex, RGB or HSV; every number drags sideways to change (Shift
// is finer) and takes typing on a click. It stands in for the browser's own picker on every color box in the app.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const hexToRgb = (h) => { const n = parseInt(String(h || '#ffffff').slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}
export function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

let current = null;
export const closeColor = () => { current?.close(); };

// anchor: the element (or a point {x, y}) it opens beside. onInput runs while dragging; onChange once a change is done.
export function openColor(anchor, value, { onInput, onChange } = {}) {
  closeColor();
  let [h, s, v] = rgbToHsv(...hexToRgb(value));
  let mode = localStorage.getItem('canopy-color-mode') || 'hex';
  const pop = el('div', 'colorpop');
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Color');
  const sv = el('canvas', 'cp-sv'); const hue = el('canvas', 'cp-hue');
  const W = 196; const H = 132; const r = Math.min(devicePixelRatio || 1, 2);
  sv.width = W * r; sv.height = H * r; hue.width = W * r; hue.height = 12 * r;
  const head = el('div', 'cp-head'); const swatch = el('span', 'cp-swatch');
  const tabs = el('div', 'cp-tabs');
  const fields = el('div', 'cp-fields');
  head.append(swatch, tabs);
  pop.append(sv, hue, head, fields);
  // Typing here never reaches the editor's shortcuts.
  pop.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(pop);

  const hex = () => rgbToHex(...hsvToRgb(h, s, v));
  const paint = () => {
    const g = sv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
    g.fillStyle = rgbToHex(...hsvToRgb(h, 1, 1)); g.fillRect(0, 0, W, H);
    const wx = g.createLinearGradient(0, 0, W, 0); wx.addColorStop(0, '#fff'); wx.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = wx; g.fillRect(0, 0, W, H);
    const bk = g.createLinearGradient(0, 0, 0, H); bk.addColorStop(0, 'rgba(0,0,0,0)'); bk.addColorStop(1, '#000'); g.fillStyle = bk; g.fillRect(0, 0, W, H);
    g.strokeStyle = v > 0.55 ? '#000' : '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(s * W, (1 - v) * H, 5, 0, 7); g.stroke();
    const k = hue.getContext('2d'); k.setTransform(r, 0, 0, r, 0, 0);
    const hg = k.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, rgbToHex(...hsvToRgb(i * 60, 1, 1)));
    k.fillStyle = hg; k.fillRect(0, 0, W, 12);
    k.strokeStyle = '#fff'; k.lineWidth = 2; k.strokeRect((h / 360) * W - 2, 1, 4, 10);
    swatch.style.background = hex();
    for (const f of fields.querySelectorAll('input')) if (document.activeElement !== f) f.value = f.read();
  };
  const changedNow = (draft) => { paint(); (draft ? onInput : onChange)?.(hex()); };

  const drag = (canvas, at) => {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const go = (ev) => { const b = canvas.getBoundingClientRect(); at(clamp((ev.clientX - b.left) / b.width, 0, 1), clamp((ev.clientY - b.top) / b.height, 0, 1)); changedNow(true); };
      go(e);
      const move = (ev) => go(ev);
      const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); changedNow(false); };
      canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    });
  };
  drag(sv, (x, y) => { s = x; v = 1 - y; });
  drag(hue, (x) => { h = x * 359.9; });

  // A value that drags sideways to change and takes typing on a click.
  const scrub = (label, read, write, step, lo, hi) => {
    const wrap = el('label', 'cp-field'); wrap.append(el('span', '', label));
    const i = el('input'); i.read = read; i.value = read();
    let d = null;
    i.addEventListener('pointerdown', (e) => {
      if (document.activeElement === i) return;
      e.preventDefault(); i.setPointerCapture(e.pointerId);
      d = { x: e.clientX, v: parseFloat(read()) || 0, moved: false };
    });
    i.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 3) return;
      d.moved = true;
      write(clamp(d.v + dx * step * (e.shiftKey ? 0.1 : 1), lo, hi)); changedNow(true);
    });
    i.addEventListener('pointerup', () => { if (!d) return; const was = d; d = null; if (was.moved) changedNow(false); else { i.focus(); i.select(); } });
    const typed = () => { const n = parseFloat(i.value); if (Number.isFinite(n)) { write(clamp(n, lo, hi)); changedNow(false); } };
    i.addEventListener('change', typed);
    i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { typed(); i.blur(); } if (e.key === 'Escape') close(); });
    wrap.append(i);
    return wrap;
  };
  const setRgb = (k) => (n) => { const c = hsvToRgb(h, s, v); c[k] = n; [h, s, v] = rgbToHsv(...c); };
  const MODES = {
    hex: () => {
      const wrap = el('label', 'cp-field cp-hex'); wrap.append(el('span', '', 'Hex'));
      const i = el('input'); i.read = () => hex().slice(1); i.value = i.read(); i.spellcheck = false;
      const typed = () => { const t = i.value.replace(/[^0-9a-f]/gi, ''); const full = t.length === 3 ? t.split('').map((x) => x + x).join('') : t; if (full.length === 6) { [h, s, v] = rgbToHsv(...hexToRgb(`#${full}`)); changedNow(false); } };
      i.addEventListener('change', typed);
      i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { typed(); i.blur(); } if (e.key === 'Escape') close(); });
      wrap.append(i);
      return [wrap];
    },
    rgb: () => [0, 1, 2].map((k) => scrub('RGB'[k], () => String(Math.round(hsvToRgb(h, s, v)[k])), setRgb(k), 1, 0, 255)),
    hsv: () => [
      scrub('H', () => String(Math.round(h)), (n) => { h = n; }, 1, 0, 359.9),
      scrub('S', () => String(Math.round(s * 100)), (n) => { s = n / 100; }, 0.5, 0, 100),
      scrub('V', () => String(Math.round(v * 100)), (n) => { v = n / 100; }, 0.5, 0, 100),
    ],
  };
  const showMode = () => {
    tabs.replaceChildren(...Object.keys(MODES).map((k) => {
      const b = el('button', 'cp-tab', k.toUpperCase()); b.setAttribute('aria-pressed', k === mode);
      b.addEventListener('click', () => { mode = k; localStorage.setItem('canopy-color-mode', k); showMode(); });
      return b;
    }));
    fields.replaceChildren(...MODES[mode]());
    paint();
  };
  showMode();

  // Beside the box: to its right, or to its left where the right edge is too close; kept inside the window.
  const b = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const pw = pop.offsetWidth; const ph = pop.offsetHeight;
  const x = b.right + 8 + pw < innerWidth ? b.right + 8 : Math.max(4, b.left - 8 - pw);
  pop.style.left = `${x}px`; pop.style.top = `${clamp(b.top - 8, 4, innerHeight - ph - 4)}px`;

  const away = (e) => { if (!pop.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key); }, 0);
  function close() {
    document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key);
    pop.remove(); if (current === handle) current = null;
  }
  const handle = { close };
  current = handle;
  return handle;
}

// Every <input type="color"> in the app opens this popup instead of the browser's picker, and still fires its
// own input and change events, so the code behind each box stays as it was.
export function takeOverColorInputs() {
  document.addEventListener('click', (e) => {
    const i = e.target.closest?.('input[type=color]');
    if (!i || i.disabled) return;
    e.preventDefault();
    openColor(i, i.value, {
      onInput: (c) => { i.value = c; i.dispatchEvent(new Event('input', { bubbles: true })); },
      onChange: (c) => { i.value = c; i.dispatchEvent(new Event('change', { bubbles: true })); },
    });
  }, true);
}
