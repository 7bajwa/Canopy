// The Library: plants to start from, each a real .canopy file with its own textures and a thumbnail. Today it lists
// the free samples (samples/index.json); assets for sale will sit beside them with their price.
import { el } from './fields.js';
import { readSample } from './io.js';

export function makeLibrary({ openSample, toast }) {
  let root = null;
  async function show() {
    if (!root) {
      root = el('section', 'modal'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Library');
      root.addEventListener('pointerdown', (e) => { if (e.target === root) root.hidden = true; });
      root.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.hidden = true; e.stopPropagation(); });
      document.body.append(root);
    }
    let list = [];
    try { list = JSON.parse(await readSample('index.json')); } catch { toast('The library could not be loaded.', 4000); return; }
    const card = el('div', 'settings-card library-card');
    const head = el('div', 'library-head');
    const close = el('button', 'mini', '✕'); close.setAttribute('aria-label', 'Close'); close.addEventListener('click', () => { root.hidden = true; });
    head.append(el('h2', '', 'Library'), close);
    const grid = el('div', 'library-grid');
    for (const s of list) {
      const b = el('button', 'library-item');
      b.title = `Open ${s.name}`;
      const img = el('img'); img.src = `./samples/${encodeURIComponent(s.thumb || '')}`; img.alt = ''; img.loading = 'lazy';
      b.append(img, el('span', 'library-name', s.name), el('span', 'library-price', s.price ? `$${s.price}` : 'Free'));
      b.addEventListener('click', () => { root.hidden = true; openSample(s); });
      grid.append(b);
    }
    card.append(head, el('p', 'hint', 'Plants to start from, with their own textures. Open one, change it, save it as your own.'), grid);
    root.replaceChildren(card);
    root.hidden = false;
    close.focus();
  }
  return { show };
}
