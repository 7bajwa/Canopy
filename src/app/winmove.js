// Every window can be moved by its title bar and resized from its corner. Places and sizes are kept in the
// preferences (prefs.win) until the layout is reset.
let store = { win: {} };
let save = () => {};
const all = new Map();

export function initWindows(prefs, persist) {
  store = prefs; save = persist;
  store.win ||= {};
  addEventListener('resize', () => { for (const w of all.values()) w.clamp(); });
}


// el: the box that moves; handle: what to drag it by; id: its name in the preferences (none: kept for the session).
export function movable(el, handle, id, { resize = true } = {}) {
  if (!el || !handle || el.dataset.movable) return null;
  el.dataset.movable = id || '1';
  handle.classList.add('win-handle');
  if (resize) el.classList.add('win-resize');
  // How much the page's UI scale enlarges this box: its drawn size over its own size.
  const zoomOf = () => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1) || 1;
  const kept = () => (id ? store.win[id] : null);
  const apply = () => {
    const k = kept();
    if (!k) return;
    if (k.x != null) Object.assign(el.style, { position: 'fixed', left: `${k.x}px`, top: `${k.y}px`, right: 'auto', bottom: 'auto', margin: '0', transform: 'none' });
    if (resize && k.w) Object.assign(el.style, { width: `${k.w}px`, height: k.h ? `${k.h}px` : '', maxWidth: 'none', maxHeight: 'none' });
  };
  // Never lost off screen: a corner of the title stays in reach.
  const clamp = () => {
    if (el.style.position !== 'fixed' || !el.offsetWidth) return;
    const z = zoomOf(); const W = innerWidth / z; const H = innerHeight / z;
    const x = parseFloat(el.style.left) || 0; const y = parseFloat(el.style.top) || 0;
    const w = el.offsetWidth || 200;
    el.style.left = `${Math.max(60 - w, Math.min(W - 60, x))}px`;
    el.style.top = `${Math.max(0, Math.min(H - 30, y))}px`;
  };
  apply();
  let grab = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('button, input, select, textarea, a, [role=tab], .win-nodrag')) return;
    const r = el.getBoundingClientRect(); const z = zoomOf();
    grab = { dx: e.clientX / z - r.left / z, dy: e.clientY / z - r.top / z, z };
    handle.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!grab) return;
    Object.assign(el.style, { position: 'fixed', left: `${e.clientX / grab.z - grab.dx}px`, top: `${e.clientY / grab.z - grab.dy}px`, right: 'auto', bottom: 'auto', margin: '0', transform: 'none' });
    clamp();
  });
  const drop = () => {
    if (!grab) return;
    grab = null;
    if (id) { store.win[id] = { ...store.win[id], x: parseFloat(el.style.left), y: parseFloat(el.style.top) }; save(); }
  };
  handle.addEventListener('pointerup', drop);
  handle.addEventListener('pointercancel', drop);
  handle.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input')) { reset(); } });
  // The corner handle writes an inline size; that is what gets kept.
  if (resize && id) {
    let t = 0;
    new ResizeObserver(() => {
      if (!el.style.width || el.hidden) return;
      clearTimeout(t);
      t = setTimeout(() => { store.win[id] = { ...store.win[id], w: el.offsetWidth, h: el.offsetHeight }; save(); }, 300);
    }).observe(el);
  }
  const reset = () => {
    for (const k of ['position', 'left', 'top', 'right', 'bottom', 'margin', 'transform', 'width', 'height', 'maxWidth', 'maxHeight']) el.style[k] = '';
    if (id) { delete store.win[id]; save(); }
  };
  const w = { el, apply, clamp, reset };
  all.set(el, w);
  return w;
}

// Back to where every window starts.
export function resetWindows() {
  for (const w of all.values()) w.reset();
  store.win = {};
  save();
}
