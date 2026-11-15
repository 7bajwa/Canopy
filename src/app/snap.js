// Snap toggles for the 2D editors (cutouts, UVs, packer): move to a grid, turn by 15°, scale by tenths.
// Holding Ctrl while dragging flips them. Each editor keeps its own toggles.
import { el } from './fields.js';

const KEY = 'canopy.snap';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private window: toggles last this session */ } };

export const TURN_STEP = Math.PI / 12;
export const SCALE_STEP = 0.1;
export const snapTo = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
export const snapOn = (where, kind, e) => !!state[`${where}.${kind}`] !== !!(e?.ctrlKey || e?.metaKey);

const ICONS = {
  move: ['Snap moves to the grid', '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/><circle cx="12" cy="12" r="2.2"/>'],
  turn: ['Snap turns to 15°', '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/><path d="M12 12l4-4"/>'],
  scale: ['Snap scale to steps of 10%', '<path d="M4 20h7v-7H4zM11 13l9-9M14 4h6v6"/>'],
};

// A group of toggle buttons for one editor; `onChange` lets it redraw (to show or hide its grid).
export function snapBar(where, kinds = ['move', 'turn', 'scale'], onChange) {
  const box = el('div', 'atlas-tools');
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Snapping');
  for (const k of kinds) {
    const [title, svg] = ICONS[k];
    const b = el('button', '');
    b.title = `${title} (hold Ctrl to flip it while dragging)`; b.setAttribute('aria-label', title);
    b.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg>`;
    const id = `${where}.${k}`;
    b.setAttribute('aria-pressed', !!state[id]);
    b.addEventListener('click', () => { state[id] = !state[id]; b.setAttribute('aria-pressed', state[id]); save(); onChange?.(); });
    box.append(b);
  }
  return box;
}
