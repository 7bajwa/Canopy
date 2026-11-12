// The small pop-ups behind a node's value rows: variation slider, curve graph, texture and modifier pickers.
import { NODE_TYPES, SHAPE_MODS, SURFACE_MODS, newMod, defaultParams } from '../graph/schema.js';
import { doc, setRowValue, commit, changed, nodeById } from './doc.js';
import { el, numberField, checkField, gradientEditor, pointsEditor } from './fields.js';
import { curveEditor } from './curveedit.js';
import { openColor } from './colorpop.js';
import { openImage } from './imageview.js';
import { textureChoices, atlasChoices, hasAlpha, textureSource } from './textures.js';
import { readDataUrl, pickFile, importMesh } from './io.js';
import { newMaterial } from '../graph/materials.js';
import { detect } from './atlas.js';
import { showLength, parseLength } from './units.js';

let serial = 0;

// A cutout as a small picture with a check box, so a node can pick flowers, leaves or stems from one atlas.
function cutThumb(m, c, on, fn) {
  const box = el('label', `cut-thumb${on ? ' on' : ''}`);
  const check = el('input'); check.type = 'checkbox'; check.checked = on;
  check.addEventListener('change', () => fn(check.checked));
  const canvas = el('canvas'); canvas.width = canvas.height = 72;
  (async () => {
    const img = await textureSource(m.texture, doc.assets);
    if (!img) return;
    const [x0, y0, x1, y1] = c.rect || [0, 0, img.width, img.height];
    const k = 64 / Math.max(x1 - x0, y1 - y0, 1);
    const g = canvas.getContext('2d');
    g.translate(36 - ((x0 + x1) / 2) * k, 36 - ((y0 + y1) / 2) * k); g.scale(k, k);
    g.beginPath(); c.outlinePx.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.save(); g.clip(); g.drawImage(img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height); g.restore();
    g.strokeStyle = '#9be15d'; g.lineWidth = 1.5 / k; g.stroke();
  })();
  box.append(canvas, check, el('span', '', c.name || 'Cutout'));
  return box;
}

// These stay out of the stack: three need clicks in the 3D view, and wind now lives on its own tab.
export const splineMods = () => Object.values(NODE_TYPES).filter((d) => d.type.startsWith('Dir_') && !d.tool && d.type !== 'Dir_Wind');

export function modChoices(set) {
  if (set === 'spline') return splineMods().map((d) => ({ type: d.type, title: d.title, desc: d.desc }));
  return Object.entries(set === 'shape' ? SHAPE_MODS : SURFACE_MODS).map(([type, d]) => ({ type, title: d.title, desc: d.desc }));
}

function freshMod(set, type) {
  const id = `m${Date.now().toString(36)}${serial++}`;
  if (set === 'spline') return newMod(id, type, defaultParams(type), { open: true });
  const params = {};
  for (const p of (set === 'shape' ? SHAPE_MODS : SURFACE_MODS)[type].params) params[p.k] = p.d;
  return newMod(id, type, params, { open: true });
}

// Each level a value's curve can run along: this line, each parent up the chain, and the whole plant.
export function curveScopes(node, owner, key) {
  const has = (id) => !!owner.curves?.[id === 'local' ? key : `${key}@${id}`];
  const out = [{ id: 'local', label: 'This one', active: has('local') }];
  const seen = new Set([node.id]);
  let at = node;
  for (;;) {
    const l = doc.graph.links.find((x) => x.to === at.id && x.toSock === 'parent');
    const up = l && nodeById(l.from);
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    out.push({ id: up.id, label: `Along ${up.name || NODE_TYPES[up.type].title}`, active: has(up.id) });
    at = up;
  }
  out.push({ id: 'global', label: 'Whole plant', active: has('global') });
  return out;
}

export function makeEditors(ui) {
  const { popup, placePopup, closePopups, menu, toast } = ui;

  function open(p, title, body) {
    popup.replaceChildren();
    popup.classList.remove('add');
    if (title) popup.append(el('h4', '', title));
    popup.append(...body);
    placePopup(p);
  }

  // Stack changes rewrite the list, so undo and other selected nodes see a clean copy.
  const stackEdit = (node, key, fn) => {
    node.params[key] = fn(node.params[key] || []);
    changed({ layout: true });
    commit();
  };

  const edit = {
    // The variation slider: plus and minus an amount, or a percent of the value.
    vary(p, node, owner, param) {
      const set = (v, draft) => setRowValue(node, owner, 'vary', { ...owner.vary, [param.k]: v }, { draft });
      const max = param.abs || 100;
      const unit = param.abs ? param.unit || '' : '%';
      const slider = el('input', 'slider');
      slider.type = 'range'; slider.min = 0; slider.max = max; slider.step = max <= 2 ? 0.01 : 1;
      slider.value = owner.vary?.[param.k] || 0;
      slider.setAttribute('aria-label', `${param.l} variation`);
      const text = () => `± ${slider.value}${unit ? ` ${unit}` : ''}`;
      const label = el('output', 'slider-value', text());
      slider.addEventListener('input', () => { label.textContent = text(); set(+slider.value, true); });
      slider.addEventListener('change', () => { set(+slider.value, false); commit(); });
      open(p, `${param.l}: variation`, [slider, label]);
    },

    // The curve graph, for this value at any level of its chain.
    curve(p, node, owner, param, flat = true, scope = 'local') {
      const key = flat ? (scope === 'local' ? param.k : `${param.k}@${scope}`) : param.k;
      const cur = flat ? owner.curves?.[key] : owner[param.k];
      const write = (c, draft) => {
        if (flat) setRowValue(node, owner, 'curves', { ...owner.curves, [key]: c }, { draft });
        else setRowValue(node, owner, param.k, c, { draft });
      };
      const defaults = owner === node.params ? defaultParams(node.type) : {};
      const onReset = () => {
        if (!flat) { const d = defaults[param.k] ?? param.d; setRowValue(node, owner, param.k, d); return d; }
        // Back to how the node starts, which for most values is no curve at all.
        const d = scope === 'local' ? defaults.curves?.[param.k] : null;
        const { [key]: gone, ...rest } = owner.curves || {};
        setRowValue(node, owner, 'curves', d ? { ...rest, [key]: d } : rest);
        return d;
      };
      const body = curveEditor(cur, {
        onChange: write, onDone: commit, onReset,
        // Only single numbers are read per level of the chain; the rest run along the placement.
        scopes: flat && param.t === 'num' ? curveScopes(node, owner, param.k) : null, scope,
        onScope: (s) => edit.curve(p, node, owner, param, flat, s),
      });
      open(p, param.l, [body]);
      popup.classList.add('wide-pop');
      placePopup(p);
    },

    texture(p, node, owner, param) {
      const choose = (id) => {
        setRowValue(node, owner, param.k, id);
        if (param.t === 'atlas') detect(node).then(commit);
        else commit();
      };
      const pickNew = async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const id = `img:${Date.now().toString(36)}`;
        doc.assets[id] = { name: f.name, url: await readDataUrl(f) };
        setRowValue(node, owner, param.k, id);
        // A diffuse image that brings its own alpha is its opacity too.
        if (param.k === 'texture' && !owner.opacityMap && await hasAlpha(id, doc.assets)) {
          setRowValue(node, owner, 'opacityMap', id);
          setRowValue(node, owner, 'opacityCh', 'A');
          toast('This image has an alpha channel, so it is now the Opacity map too.');
        }
        if (param.t === 'atlas') await detect(node);
        commit();
      };
      // The picture opens large, with the list to pick another in its corner.
      openImage({
        title: param.l, value: owner[param.k], assets: doc.assets,
        choices: [...Object.entries(doc.assets).map(([id, a]) => [id, a.name]), ...(param.t === 'atlas' ? atlasChoices(owner[param.k]) : textureChoices(owner[param.k]))],
        onPick: (id) => choose(id),
        load: async () => { await pickNew(); return owner[param.k]; },
      });
    },

    // The scene's materials, gray when none is picked, and a new one at the bottom.
    material(p, node) {
      const mats = doc.graph.materials || [];
      const set = (id) => { node.params.material = id; node.params.cutoutPick = null; changed({ layout: true }); commit(); };
      const items = [{ label: `${node.params.material ? '' : '✓ '}No material`, fn: () => set(null) }];
      for (const m of mats) items.push({ label: `${node.params.material === m.id ? '✓ ' : ''}${m.name}`, fn: () => set(m.id) });
      items.push({ sep: true }, {
        label: 'New material',
        fn: () => {
          const m = newMaterial(`Material ${mats.length + 1}`);
          (doc.graph.materials ||= []).push(m);
          set(m.id);
          ui.openMaterials?.(m.id);
        },
      });
      menu(p, items);
    },

    // Which of the material's cutouts this node uses: all of them, or a chosen few.
    cutouts(p, node) {
      const m = (doc.graph.materials || []).find((x) => x.id === node.params.material);
      if (!m?.cutouts?.length) { toast(m ? 'This material has no cutouts yet. Use Edit cutouts to make some.' : 'Pick a material with a leaf texture first.'); return; }
      const draw = () => {
        const pick = node.params.cutoutPick;
        const body = [checkField('All of them', !Array.isArray(pick), (v) => { node.params.cutoutPick = v ? null : []; changed({ layout: true }); commit(); draw(); })];
        const grid = el('div', 'cut-grid');
        for (const c of m.cutouts) {
          const on = !Array.isArray(pick) || pick.includes(c.id);
          grid.append(cutThumb(m, c, on, (v) => {
            const now = Array.isArray(node.params.cutoutPick) ? node.params.cutoutPick : m.cutouts.map((x) => x.id);
            const next = v ? [...new Set([...now, c.id])] : now.filter((id) => id !== c.id);
            node.params.cutoutPick = next.length === m.cutouts.length ? null : next;
            changed({ layout: true }); commit(); draw();
          }));
        }
        body.push(grid);
        open(p, `Cutouts from ${m.name}`, body);
      };
      draw();
    },

    addMod(p, node, key, set) {
      menu(p, modChoices(set).map((c) => ({
        label: c.title, title: c.desc,
        fn: () => stackEdit(node, key, (list) => [...list, freshMod(set, c.type)]),
      })));
    },

    removeMod(node, key, mod) { stackEdit(node, key, (list) => list.filter((m) => m !== mod)); },
    toggleMod(mod) { mod.on = mod.on === false; changed({ layout: true }); commit(); },
    foldMod(mod) { mod.open = !mod.open; changed({ layout: true, rebuild: false }); },

    // Which object a modifier reads.
    ref(p, node, owner, param) {
      const items = doc.graph.nodes.filter((n) => n.type === 'Mesh' || n.type === 'SceneObject').map((n) => ({
        label: n.name || NODE_TYPES[n.type].title, fn: () => { setRowValue(node, owner, param.k, n.id); commit(); },
      }));
      if (owner[param.k] && nodeById(owner[param.k])) items.push({ sep: true }, { label: 'None', fn: () => { setRowValue(node, owner, param.k, null); commit(); } });
      if (!items.length) { toast('Add a Mesh node first. This modifier reads its shape.'); return; }
      menu(p, items);
    },

    async mesh(node, owner, param) {
      const f = await pickFile('.obj,.fbx,.glb,.gltf');
      if (!f) return;
      try { const { texture, ...obj } = await importMesh(f); setRowValue(node, owner, param.k, obj); commit(); } catch (e) { toast(e.message || 'That mesh could not be read.', 5000); }
    },

    // The color popup, beside the color box on the node (p is where it was clicked, in the stage).
    color(node, owner, param, p = null) {
      const s = document.querySelector('#stage').getBoundingClientRect();
      const at = p ? { x: s.left + p.x + 12, y: s.top + p.y } : { x: innerWidth / 2, y: innerHeight / 3 };
      openColor(at, owner[param.k] || '#ffffff', {
        onInput: (c) => setRowValue(node, owner, param.k, c, { draft: true }),
        onChange: (c) => { setRowValue(node, owner, param.k, c); commit(); },
      });
    },

    list(p, node, owner, param) {
      const set = (v, draft) => setRowValue(node, owner, param.k, v, { draft });
      const fill = () => {
        const make = param.t === 'gradient' ? gradientEditor : pointsEditor;
        open(p, param.l, [make(owner[param.k], set, commit, fill)]);
      };
      fill();
    },

    // Typing a value, in place of the scrub. Lengths read in whichever system is on.
    number(p, label, value, opts, write) {
      const o = opts.unit === 'cm' ? { ...opts, toText: showLength, fromText: parseLength } : opts;
      const row = numberField(label, value, o, write, () => { commit(); closePopups(); });
      open(p, null, [row]);
      row.querySelector('input').select();
    },

    rename(p, node) {
      const input = el('input', 'search');
      input.value = node.name || NODE_TYPES[node.type].title;
      input.setAttribute('aria-label', 'Node name');
      const done = (keep) => {
        if (keep) { node.name = input.value.trim() || NODE_TYPES[node.type].title; changed({ rebuild: false, layout: true }); commit(); }
        closePopups();
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      open(p, 'Rename', [input]);
      input.select();
    },
  };
  return edit;
}
