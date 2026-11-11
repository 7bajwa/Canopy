// Seed presets: a random seed worth keeping, saved with a thumbnail, its own name, and kept in the plant file.
// The viewer lists them: click one to use it, rename it, delete it, draw its thumbnail again; and export them all,
// each as its own file or side by side in one.
import { doc, on, regenerate, commit } from './doc.js';
import { el } from './fields.js';

const listOf = () => (doc.graph.settings.seedPresets ||= []);

// The next finished build, so a preset's seed can be shown before its thumbnail is taken or it is exported.
const waiting = [];
on('result', () => { for (const r of waiting.splice(0)) r(true); });
on('build-error', () => { for (const r of waiting.splice(0)) r(false); });
function buildSeed(seed) {
  return new Promise((resolve) => {
    if (doc.graph.settings.seed === seed && !doc.stale && doc.result) { resolve(true); return; }
    waiting.push(resolve);
    doc.graph.settings.seed = seed;
    regenerate({ force: true });
  });
}

export function makeSeedPresets({ view, toast, exportBatch }) {
  let root = null;
  const thumb = () => view.renderImage(256);

  function save() {
    const list = listOf();
    list.push({ id: `p${Date.now().toString(36)}`, name: `Preset ${list.length + 1}`, seed: doc.graph.settings.seed, thumb: thumb() });
    commit();
    toast(`Saved seed ${doc.graph.settings.seed} as ${list.at(-1).name}.`);
    if (root && !root.hidden) draw();
  }

  // Runs through presets one at a time, then puts the plant back on the seed it had.
  async function eachPreset(items, fn) {
    const back = doc.graph.settings.seed;
    try { for (const p of items) if (await buildSeed(p.seed)) await fn(p); } finally { await buildSeed(back); }
  }

  function draw() {
    const list = listOf();
    const card = el('div', 'settings-card presets-card');
    const grid = el('div', 'preset-tiles');
    if (!list.length) grid.append(el('p', 'hint', 'No presets yet. Find a seed you like with Random Seed, then press Save preset.'));
    list.forEach((p, i) => {
      const tile = el('div', 'preset-tile');
      tile.classList.toggle('on', p.seed === doc.graph.settings.seed);
      const img = el('img'); img.src = p.thumb || ''; img.alt = p.name; img.title = `Use seed ${p.seed}`;
      img.addEventListener('click', async () => { await buildSeed(p.seed); commit(); draw(); });
      const name = el('input', 'preset-name'); name.value = p.name; name.setAttribute('aria-label', 'Preset name');
      name.addEventListener('keydown', (e) => e.stopPropagation());
      name.addEventListener('change', () => { p.name = name.value.trim() || p.name; commit(); });
      const redo = el('button', 'mini', '↻'); redo.title = 'Draw its thumbnail again'; redo.setAttribute('aria-label', redo.title);
      redo.addEventListener('click', async () => { await eachPreset([p], async () => { p.thumb = thumb(); }); commit(); draw(); });
      const del = el('button', 'mini', '✕'); del.title = 'Delete this preset'; del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => { list.splice(i, 1); commit(); draw(); });
      const row = el('div', 'preset-row'); row.append(name, redo, del);
      tile.append(img, el('small', 'hint', `Seed ${p.seed}`), row);
      grid.append(tile);
    });
    const saveBtn = el('button', 'wide', 'Save current'); saveBtn.addEventListener('click', save);
    const all = el('button', 'wide', 'Redraw all thumbnails');
    all.disabled = !list.length;
    all.addEventListener('click', async () => { all.disabled = true; await eachPreset(list, async (p) => { p.thumb = thumb(); }); commit(); draw(); });
    const exp = el('button', 'wide primary', 'Export all…');
    exp.disabled = !list.length;
    exp.addEventListener('click', () => { root.hidden = true; exportBatch(list, eachPreset); });
    const close = el('button', 'wide', 'Done'); close.addEventListener('click', () => { root.hidden = true; });
    const foot = el('div', 'row-buttons'); foot.append(saveBtn, all, exp, close);
    card.append(el('h2', '', 'Presets'), grid, foot);
    root.replaceChildren(card);
  }

  function open() {
    if (!root) {
      root = el('section', 'modal'); root.id = 'presets'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Presets');
      root.addEventListener('pointerdown', (e) => { if (e.target === root) root.hidden = true; });
      root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') root.hidden = true; });
      document.body.append(root);
    }
    draw();
    root.hidden = false;
  }

  return { save, open };
}
