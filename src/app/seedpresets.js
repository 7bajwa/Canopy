// Variations: a version of the plant worth keeping — every node's settings, the links, materials and the seed — saved
// with a thumbnail and its own name, in the plant file. The floating panel stays open while you change the view or
// the plant: click a thumbnail to bring that version back, rename, delete, redraw thumbnails (from the current view,
// with the render settings' filters and no grid), save over one, and export them all, one file each or side by side.
// Older files kept only a seed; those still work and only change the seed.
import { doc, on, regenerate, commit, changed } from './doc.js';
import { el } from './fields.js';
import { floatPanel } from './floatpanel.js';

const listOf = () => (doc.graph.settings.seedPresets ||= []);

// Everything a variation keeps. The variation list itself stays out, so versions never nest.
function capture() {
  const { seedPresets, ...settings } = doc.graph.settings;
  return JSON.stringify({ nodes: doc.graph.nodes, links: doc.graph.links, groups: doc.graph.groups, materials: doc.graph.materials, settings });
}

// The next finished build, so a variation can be shown before its thumbnail is taken or it is exported.
const waiting = [];
on('result', () => { for (const r of waiting.splice(0)) r(true); });
on('build-error', () => { for (const r of waiting.splice(0)) r(false); });
const nextBuild = () => new Promise((resolve) => { waiting.push(resolve); });

// Puts a variation's state (or an older seed-only preset) on the plant and waits for it to build.
function applyState(p) {
  const list = listOf();
  if (p.state) {
    const s = JSON.parse(p.state);
    Object.assign(doc.graph, { nodes: s.nodes, links: s.links, groups: s.groups, materials: s.materials });
    doc.graph.settings = { ...s.settings, seedPresets: list };
    changed({ layout: true });
  } else {
    if (doc.graph.settings.seed === p.seed && !doc.stale && doc.result) return Promise.resolve(true);
    doc.graph.settings.seed = p.seed;
  }
  const done = nextBuild();
  regenerate({ force: true });
  return done;
}

export function makeSeedPresets({ view, toast, exportBatch, thumb = () => view.renderImage(256) }) {
  let panel = null;
  const current = () => ({ id: '', seed: doc.graph.settings.seed, state: capture() });

  function save() {
    const list = listOf();
    list.push({ id: `p${Date.now().toString(36)}`, name: `Variation ${list.length + 1}`, seed: doc.graph.settings.seed, state: capture(), thumb: thumb() });
    commit();
    toast(`Saved ${list.at(-1).name}.`);
    if (panel?.isOpen()) draw();
  }

  // Runs through variations one at a time, then puts the plant back the way it was.
  async function eachPreset(items, fn) {
    const back = current();
    try { for (const p of items) if (await applyState(p)) await fn(p); } finally { await applyState(back); }
  }

  const sameAs = (p) => (p.state ? p.state === capture() : p.seed === doc.graph.settings.seed);

  function draw() {
    const list = listOf();
    const grid = el('div', 'preset-tiles');
    if (!list.length) grid.append(el('p', 'hint', 'No variations yet. Change the plant (or press Random Seed), then Save current.'));
    list.forEach((p, i) => {
      const tile = el('div', 'preset-tile');
      tile.classList.toggle('on', sameAs(p));
      const img = el('img'); img.src = p.thumb || ''; img.alt = p.name; img.title = `Use ${p.name}`;
      img.addEventListener('click', async () => { await applyState(p); commit(); draw(); });
      const name = el('input', 'preset-name'); name.value = p.name; name.setAttribute('aria-label', 'Variation name');
      name.addEventListener('change', () => { p.name = name.value.trim() || p.name; commit(); });
      const over = el('button', 'mini', '⤓'); over.title = 'Save the plant as it is now into this variation'; over.setAttribute('aria-label', over.title);
      over.addEventListener('click', () => { Object.assign(p, { seed: doc.graph.settings.seed, state: capture(), thumb: thumb() }); commit(); draw(); });
      const redo = el('button', 'mini', '↻'); redo.title = 'Draw its thumbnail again from the current view'; redo.setAttribute('aria-label', redo.title);
      redo.addEventListener('click', async () => { await eachPreset([p], async () => { p.thumb = thumb(); }); commit(); draw(); });
      const del = el('button', 'mini', '✕'); del.title = 'Delete this variation'; del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => { list.splice(i, 1); commit(); draw(); });
      const row = el('div', 'preset-row'); row.append(name, over, redo, del);
      tile.append(img, el('small', 'hint', p.state ? `Seed ${p.seed} · all settings` : `Seed ${p.seed} only`), row);
      grid.append(tile);
    });
    const saveBtn = el('button', 'wide', 'Save current'); saveBtn.addEventListener('click', save);
    const all = el('button', 'wide', 'Redraw all thumbnails');
    all.disabled = !list.length;
    all.addEventListener('click', async () => { all.disabled = true; await eachPreset(list, async (p) => { p.thumb = thumb(); }); commit(); draw(); });
    const exp = el('button', 'wide primary', 'Export all…');
    exp.disabled = !list.length;
    exp.addEventListener('click', () => exportBatch(list, eachPreset));
    const foot = el('div', 'row-buttons'); foot.append(saveBtn, all, exp);
    panel.body.replaceChildren(grid, foot);
  }

  function open() {
    panel ||= floatPanel('presets', 'Variations', { width: 380 });
    draw();
    panel.show();
  }

  // Keeps the "in use" outline right while the panel stays open.
  on('result', () => { if (panel?.isOpen()) for (const [i, t] of [...panel.body.querySelectorAll('.preset-tile')].entries()) t.classList.toggle('on', sameAs(listOf()[i])); });

  return { save, open, isOpen: () => !!panel?.isOpen() };
}
