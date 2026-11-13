// The Library: plants to start from, each a real .canopy file with its own textures and a thumbnail. Today it lists
// the free samples (samples/index.json), in tabs by category; assets for sale will sit beside them with their price.
const CATEGORIES = ['All', 'Trees', 'Bushes', 'Flowers', 'Grass', 'Vines', 'Misc'];
const REQUEST = 'mailto:amanpreetbajwa7@gmail.com?subject=Canopy%20asset%20request';
import { el } from './fields.js';
import { readSample } from './io.js';

export function makeLibrary({ openSample, toast }) {
  let root = null; let tab = 'All';
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
    const tabs = el('div', 'library-tabs'); tabs.setAttribute('role', 'tablist');
    const grid = el('div', 'library-grid');
    const fill = () => {
      for (const b of tabs.children) b.setAttribute('aria-selected', b.textContent === tab);
      grid.replaceChildren();
      for (const s of list.filter((x) => tab === 'All' || (x.category || 'Misc') === tab)) {
        const b = el('button', 'library-item');
        b.title = `Open ${s.name}`;
        const img = el('img'); img.alt = '';
        // The picture beside the file, or the one kept inside it.
        img.addEventListener('error', async () => { try { img.src = JSON.parse(await readSample(s.file)).thumb || ''; } catch { /* no picture */ } }, { once: true });
        img.src = `./samples/${encodeURIComponent(s.thumb || s.file.replace(/\.canopy$/, '.png'))}`;
        b.append(img, el('span', 'library-name', s.name), el('span', 'library-price', s.price ? `$${s.price}` : 'Free'));
        b.addEventListener('click', () => { root.hidden = true; openSample(s); });
        grid.append(b);
      }
    };
    for (const c of CATEGORIES) {
      const b = el('button', 'library-tab', c); b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { tab = c; fill(); });
      tabs.append(b);
    }
    fill();
    const foot = el('div', 'library-foot');
    const ask = el('a', 'btn', 'Request an asset'); ask.href = REQUEST;
    ask.title = 'Ask for a plant you would like in the Library';
    foot.append(el('p', 'hint', 'Plants to start from, with their own textures. Open one, change it, save it as your own.'), ask);
    card.append(head, tabs, grid, foot);
    root.replaceChildren(card);
    root.hidden = false;
    close.focus();
  }
  return { show };
}
