// A floating panel that stays open while you keep working in the views: drag it by its title bar, close it with its
// own ✕. Clicks outside don't close it, and typing in its fields doesn't reach the editor's shortcuts.
import { el } from './fields.js';

export function floatPanel(id, title, { width = 360 } = {}) {
  const root = el('section', 'float-panel'); root.id = id; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', title);
  root.style.width = `${width}px`;
  const head = el('div', 'float-head');
  const close = el('button', 'mini', '✕'); close.title = 'Close'; close.setAttribute('aria-label', 'Close');
  head.append(el('strong', '', title), close);
  const body = el('div', 'float-body');
  root.append(head, body);
  document.body.append(root);
  close.addEventListener('click', () => { root.hidden = true; });
  root.addEventListener('keydown', (e) => { if (e.target.matches('input, textarea, select')) e.stopPropagation(); });
  // Drag by the title bar; the place is kept for the session.
  let grab = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = root.getBoundingClientRect();
    grab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const x = Math.min(Math.max(e.clientX - grab.dx, 0), innerWidth - 60);
    const y = Math.min(Math.max(e.clientY - grab.dy, 0), innerHeight - 40);
    Object.assign(root.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
  });
  head.addEventListener('pointerup', () => { grab = null; });
  return {
    root, body,
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    isOpen: () => !root.hidden,
  };
}
