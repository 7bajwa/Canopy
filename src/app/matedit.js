// The material editor: the scene's materials, their maps and colors, which nodes use them, and their cutouts.
import { doc, changed, commit, nodeById } from './doc.js';
import { NODE_TYPES } from '../graph/schema.js';
import { newMaterial, MATERIAL_FIELDS } from '../graph/materials.js';
import { el, numberField, selectField, checkField } from './fields.js';
import { textureChoices, atlasChoices, hasAlpha, textureSource, atlasPixels } from './textures.js';
import { openImage } from './imageview.js';
import { makeMap, shrink } from '../leaf/imgops.js';
import { contourCutouts } from '../leaf/contour.js';
import { materialPixels, detectOpts } from './atlas.js';
import { pickFile, readDataUrl, pathOf } from './io.js';

// Every map but the diffuse and normal can read one channel of its image. The color box is what the slot is
// when no texture is in it, at the value that means "no effect".
const SLOTS = [
  { k: 'color', map: 'texture', l: 'Color', hint: 'The base color. With a texture in the slot the box is ignored; a leaf texture with opacity also gives the cutouts.' },
  { k: 'normalColor', map: 'normalMap', l: 'Normal', extra: ['normalScale', 'Strength', { min: 0, max: 3 }] },
  { k: 'roughColor', map: 'roughMap', l: 'Roughness', ch: 'roughCh' },
  { k: 'aoColor', map: 'aoMap', l: 'AO', ch: 'aoCh', extra: ['aoAmount', 'Strength', { min: 0, max: 2 }] },
  { k: 'sssColor', map: 'sssMap', l: 'Subsurface', ch: 'sssCh' },
  { k: 'opacityColor', map: 'opacityMap', l: 'Opacity', ch: 'opacityCh' },
];

// Starting recipes for making a map from the Color picture (each can be changed and is kept on the material).
const GEN = {
  normalColor: { source: 'luminance', output: 'normal', strength: 2, blur: 1 },
  roughColor: { source: 'luminance', invert: true },
  aoColor: { source: 'luminance', output: 'ao', radius: 8, strength: 1 },
  sssColor: { source: 'luminance' },
  opacityColor: { source: 'colorkey', key: '#ffffff', tolerance: 0.15, softness: 0.08 },
};

const show = (canvas, img) => { canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); };

export class MaterialEditor {
  constructor(root, deps) {
    this.root = root;
    this.deps = deps;
    this.body = root.querySelector('.settings-body');
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.tagName !== 'INPUT') this.close(); e.stopPropagation(); });
  }

  isOpen() { return !this.root.hidden; }
  close() { this.root.hidden = true; this.dock(false); commit(); }

  get list() { return (doc.graph.materials ||= []); }

  open(id) {
    this.id = id && this.list.some((m) => m.id === id) ? id : this.list[0]?.id || null;
    this.root.hidden = false;
    this.render();
  }

  // A change to a material reaches every node that uses it, since they all point at the same one.
  put(m, k, v, draft = false) {
    m[k] = v;
    changed({ draft, layout: true });
    if (!draft) commit();
  }

  render() {
    const b = this.body;
    b.replaceChildren();
    const mats = this.list;
    const m = mats.find((x) => x.id === this.id);
    // Which material, plus making, copying and removing them.
    const head = el('div', 'mat-head');
    const pick = el('select');
    pick.setAttribute('aria-label', 'Material');
    if (!mats.length) { const o = el('option', '', 'No materials yet'); o.value = ''; pick.append(o); }
    for (const x of mats) { const o = el('option', '', x.name); o.value = x.id; pick.append(o); }
    pick.value = this.id || '';
    pick.addEventListener('change', () => { this.id = pick.value; this.render(); });
    const button = (text, label, fn) => { const e = el('button', 'mini', text); e.title = label; e.setAttribute('aria-label', label); e.addEventListener('click', fn); return e; };
    head.append(pick,
      button('New', 'New material', () => { const x = newMaterial(`Material ${mats.length + 1}`); mats.push(x); this.id = x.id; changed({ layout: true }); commit(); this.render(); }),
      button('Copy', 'Duplicate this material', () => { if (!m) return; const x = { ...structuredClone(m), id: newMaterial('').id, name: `${m.name} copy` }; mats.push(x); this.id = x.id; changed({ layout: true }); commit(); this.render(); }),
      button('Delete', 'Delete this material', () => {
        if (!m) return;
        // Nodes that used it go back to plain gray rather than pointing at nothing.
        for (const n of doc.graph.nodes) if (n.params?.material === m.id) n.params.material = null;
        doc.graph.materials = mats.filter((x) => x !== m);
        this.id = doc.graph.materials[0]?.id || null;
        changed({ layout: true }); commit(); this.render();
      }));
    // Shaded sections: which material, its maps, its cutouts.
    const sec = (cls) => { const d = el('div', `mat-sec ${cls}`); b.append(d); return d; };
    const top = sec('mat-sec-top');
    top.append(head);
    if (!m) { b.append(el('p', 'empty', 'Make a material with New, then pick it on a node\'s Material tab.')); return; }

    const name = el('input', 'mat-name');
    name.value = m.name;
    name.setAttribute('aria-label', 'Material name');
    name.addEventListener('change', () => { this.put(m, 'name', name.value.trim() || 'Material'); this.render(); });
    top.append(name);

    const users = doc.graph.nodes.filter((n) => n.params?.material === m.id);
    top.append(el('p', 'mat-users', users.length ? `Used by ${users.map((n) => n.name || NODE_TYPES[n.type].title).join(', ')}` : 'Not used by any node yet.'));

    const maps = sec('mat-sec-maps');
    maps.append(el('h4', 'section', 'Maps'));
    for (const s of SLOTS) maps.append(this.slot(m, s));

    // The cutouts belong to the material's picture. They're made when asked, and new ones join the old.
    const cutSec = sec('mat-sec-cuts');
    cutSec.append(el('h4', 'section', 'Cutouts'));
    const cuts = m.cutouts || [];
    if (!m.texture) { cutSec.append(el('p', 'empty', 'Put a leaf picture in the Color slot to make cutouts from it.')); return; }
    const list = el('div', 'mat-cuts');
    for (const c of cuts) list.append(el('span', 'mat-cut', `${c.name || c.id} · ${c.stats?.quads ? `${c.stats.quads} quads` : `${c.stats?.triangles ?? 0} tris`}`));
    if (!cuts.length) list.append(el('p', 'empty', 'No cutouts yet.'));
    cutSec.append(list);
    const row = el('div', 'row-buttons');
    const make = el('button', 'wide', 'Make cutouts');
    make.title = 'Find the leaves in the picture and add a cutout for each. Cutouts already here stay.';
    make.addEventListener('click', async () => {
      const img = await materialPixels(m);
      const found = img ? contourCutouts(img, detectOpts(m)) : [];
      if (!found.length) { this.deps.toast('No leaves found. Check the Opacity slot, or draw meshes in the cutout editor.'); return; }
      m.cutouts = [...cuts, ...found.map((c, i) => ({ ...c, name: `Leaf ${cuts.length + i + 1}` }))];
      changed({ layout: true }); commit();
      this.deps.toast(`Added ${found.length} cutout${found.length > 1 ? 's' : ''}.`);
      this.render();
    });
    const editBtn = el('button', 'wide primary', 'Edit cutouts');
    editBtn.addEventListener('click', () => this.deps.editCutouts(m));
    row.append(make, editBtn);
    cutSec.append(row);
  }

  // Beside the cutout editor the material editor moves to the left and stays usable.
  dock(on) { document.body.classList.toggle('mat-docked', on); }

  slot(m, s) {
    const row = el('div', 'mat-slot');
    const label = el('label', '', s.l);
    if (s.hint) label.title = s.hint;
    const color = el('input');
    color.type = 'color';
    color.value = m[s.k] ?? MATERIAL_FIELDS[s.k];
    color.setAttribute('aria-label', `${s.l} color`);
    color.disabled = !!m[s.map];
    color.title = m[s.map] ? 'A texture is in this slot, so the color isn\'t used.' : `${s.l} color`;
    color.addEventListener('input', () => this.put(m, s.k, color.value, true));
    color.addEventListener('change', () => this.put(m, s.k, color.value));
    const thumb = el('canvas', 'mat-thumb');
    thumb.width = thumb.height = 52;
    this.paintThumb(thumb, m[s.map]);
    const tex = el('select', 'mat-tex');
    tex.setAttribute('aria-label', `${s.l} texture`);
    const add = (id, text) => { const o = el('option', '', text); o.value = id; tex.append(o); };
    add('', 'No texture');
    for (const [id, a] of Object.entries(doc.assets)) add(id, a.name);
    for (const [id, text] of [...(s.k === 'color' ? atlasChoices(m[s.map]) : []), ...textureChoices(m[s.map])]) add(id, text);
    add('__load', 'Load image…');
    tex.value = m[s.map] || '';
    const load = async () => {
      const f = await pickFile('image/*');
      if (!f) return null;
      const id = `img:${Date.now().toString(36)}`;
      doc.assets[id] = { name: f.name, url: await readDataUrl(f), path: pathOf(f) };
      return id;
    };
    // Clicking the picture opens it large, with the same list to pick another.
    thumb.title = `${s.l} map: click to see it large and pick another`;
    thumb.style.cursor = 'zoom-in';
    thumb.addEventListener('click', () => openImage({
      title: `${s.l} map`, value: m[s.map], assets: doc.assets, load,
      choices: [...Object.entries(doc.assets).map(([id, a]) => [id, a.name]), ...(s.k === 'color' ? atlasChoices(m[s.map]) : []), ...textureChoices(m[s.map])],
      onPick: (id) => {
        if (id && ![...tex.options].some((o) => o.value === id)) { const o = el('option', '', doc.assets[id]?.name || id); o.value = id; tex.insertBefore(o, tex.lastChild); }
        tex.value = id || ''; tex.dispatchEvent(new Event('change'));
      },
    }));
    tex.addEventListener('change', async () => {
      let id = tex.value || null;
      if (id === '__load') {
        tex.value = m[s.map] || '';
        id = await load();
        if (!id) return;
      }
      this.put(m, s.map, id);
      if (s.k === 'color') {
        // A color texture with its own alpha is its opacity too, and a new texture means new cutouts.
        // The cutouts stay as they are; Make cutouts finds new ones when asked.
        if (id && !m.opacityMap && await hasAlpha(id, doc.assets)) { m.opacityMap = id; m.opacityCh = 'A'; this.deps.toast('This image has an alpha channel, so it is the Opacity map too.'); }
      }
      this.render();
    });
    row.append(label, color, thumb, tex);
    if (s.k !== 'color') {
      const gen = el('button', 'mini gen-btn', '✦');
      gen.title = m.texture ? `Make the ${s.l} map from the Color picture` : 'Put a picture in the Color slot first, to make this map from it.';
      gen.setAttribute('aria-label', gen.title);
      gen.setAttribute('aria-pressed', this.gen === s.k);
      gen.disabled = !m.texture;
      gen.addEventListener('click', () => { this.gen = this.gen === s.k ? null : s.k; this.render(); });
      row.append(gen);
    }
    if (s.ch && m[s.map]) {
      const ch = el('select', 'mat-ch');
      ch.setAttribute('aria-label', `${s.l} channel`);
      for (const c of ['R', 'G', 'B', 'A']) { const o = el('option', '', c); o.value = c; ch.append(o); }
      ch.value = m[s.ch] || MATERIAL_FIELDS[s.ch];
      ch.addEventListener('change', () => this.put(m, s.ch, ch.value));
      row.append(ch);
    }
    const wrap = el('div');
    wrap.append(row);
    if (this.gen === s.k && m.texture) wrap.append(this.genPanel(m, s));
    if (!s.extra || !m[s.map]) return wrap;
    wrap.append(numberField(s.extra[1], m[s.extra[0]] ?? MATERIAL_FIELDS[s.extra[0]], s.extra[2], (v, d) => this.put(m, s.extra[0], v, !!d)));
    return wrap;
  }

  // Makes a map from the Color picture: a source (brightness, saturation, alpha or a picked color), levels and filters,
  // then what it becomes (as is, curvature, occlusion, or normals). The preview updates as values change.
  genPanel(m, s) {
    const box = el('div', 'gen');
    const r = { ...GEN[s.k], ...(m.gen?.[s.k] || {}) };
    const preview = el('canvas', 'gen-preview');
    preview.title = 'Preview. With Color key, click it to pick the color to cut away.';
    const fields = el('div', 'gen-fields');
    let small = null; let full = null; let queued = false;
    const draw = () => { if (small) show(preview, makeMap(small, r)); };
    const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
    const set = (k) => (v) => { r[k] = v; redraw(); };
    const num = (k, l, d, o) => numberField(l, r[k] ?? d, o, set(k));
    const build = () => {
      const list = [selectField('Source', r.source, [['luminance', 'Brightness'], ['saturation', 'Saturation'], ['alpha', 'Alpha'], ['colorkey', 'Color key']], (v) => { r.source = v; build(); redraw(); })];
      if (r.source === 'colorkey') {
        const row = el('div', 'field');
        const key = el('input');
        key.type = 'color'; key.value = r.key || '#ffffff';
        key.setAttribute('aria-label', 'Color to cut away');
        key.addEventListener('input', () => { r.key = key.value; redraw(); });
        row.append(el('label', '', 'Cut color'), key);
        list.push(row, num('tolerance', 'Tolerance', 0.15, { min: 0, max: 1 }), num('softness', 'Softness', 0.08, { min: 0, max: 1 }));
      }
      list.push(
        num('brightness', 'Brightness', 0, { min: -1, max: 1 }), num('contrast', 'Contrast', 0, { min: -1, max: 0.95 }),
        num('black', 'Levels black', 0, { min: 0, max: 1 }), num('white', 'Levels white', 1, { min: 0, max: 1 }), num('gamma', 'Gamma', 1, { min: 0.1, max: 4 }),
        checkField('Invert', !!r.invert, set('invert')),
        num('blur', 'Blur', 0, { min: 0, max: 16, int: true, unit: 'px' }), num('sharpen', 'Sharpen', 0, { min: 0, max: 4 }),
      );
      if (s.k !== 'normalColor') list.push(selectField('Make', r.output || 'plain', [['plain', 'As is'], ['curvature', 'Curvature'], ['ao', 'Occlusion']], (v) => { r.output = v; build(); redraw(); }));
      if (r.output === 'normal' || r.output === 'ao' || r.output === 'curvature') list.push(num('strength', 'Strength', r.output === 'curvature' ? 4 : r.output === 'ao' ? 1 : 2, { min: 0, max: 10 }));
      if (r.output === 'ao') list.push(num('radius', 'Radius', 8, { min: 1, max: 64, int: true, unit: 'px' }));
      fields.replaceChildren(...list);
    };
    preview.addEventListener('click', (e) => {
      if (r.source !== 'colorkey' || !small) return;
      const b = preview.getBoundingClientRect();
      const x = Math.floor(((e.clientX - b.left) / b.width) * small.width); const y = Math.floor(((e.clientY - b.top) / b.height) * small.height);
      const p = (y * small.width + x) * 4;
      r.key = `#${[0, 1, 2].map((i) => small.data[p + i].toString(16).padStart(2, '0')).join('')}`;
      build(); redraw();
    });
    const apply = el('button', 'wide primary', `Make ${s.l} map`);
    apply.addEventListener('click', () => {
      if (!full) return;
      const c = document.createElement('canvas');
      show(c, makeMap(full, r));
      const id = `img:gen${Date.now().toString(36)}`;
      doc.assets[id] = { name: `${m.name} ${s.l}`, url: c.toDataURL('image/png') };
      (m.gen ||= {})[s.k] = { ...r };
      m[s.map] = id;
      if (s.ch) m[s.ch] = 'R';
      this.gen = null;
      changed({ layout: true }); commit();
      this.deps.toast(`The ${s.l} map is made and in its slot.`);
      this.render();
    });
    box.append(preview, fields, apply);
    build();
    (async () => {
      full = await atlasPixels(m.texture, doc.assets);
      if (!full) return;
      const big = Math.max(full.width, full.height);
      if (big > 2048) full = shrink(full, 2048 / big);
      small = shrink(full, Math.min(1, 256 / Math.max(full.width, full.height)));
      // An image with its own alpha already says what is opaque; otherwise the corner color is the background to cut.
      if (s.k === 'opacityColor' && !m.gen?.opacityColor) {
        if (full.data.some((v, i) => i % 4 === 3 && v < 250)) r.source = 'alpha';
        else r.key = `#${[0, 1, 2].map((i) => full.data[i].toString(16).padStart(2, '0')).join('')}`;
        build();
      }
      draw();
    })();
    return box;
  }

  // A small picture of what's in the slot; a checker when it's empty.
  async paintThumb(c, name) {
    const x = c.getContext('2d');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#8a9186' : '#4c524a'; x.fillRect(i * 13, j * 13, 13, 13); }
    if (!name) return;
    try { x.drawImage(await textureSource(name, doc.assets), 0, 0, 52, 52); } catch { /* keep the checker */ }
  }
}

export const usersOf = (id) => doc.graph.nodes.filter((n) => n.params?.material === id).map((n) => nodeById(n.id));
