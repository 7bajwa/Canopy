// What baking and texture packing share at the end: export settings, the clean-up of the maps (normal extras,
// dilation), packing channels into files, saving them where the person picks, and a material that uses them.
import { doc, changed, commit } from './doc.js';
import { el, numberField, selectField, checkField } from './fields.js';
import { newMaterial } from '../graph/materials.js';
import { dilate, enhanceNormals, packChannels, colorAdjust } from '../leaf/imgops.js';
import { cutoutsFromImage } from '../leaf/cutout.js';

export const EXPORT_DEFAULTS = {
  name: 'Atlas', width: 1024, height: 1024, linked: true, format: 'png', quality: 0.92, opacityInColor: true,
  maps: { color: true, opacity: false, normal: true, roughness: true, ao: true, subsurface: false, height: false },
  // The ending added to the name of each map's file, and which maps are dilated (bled past their edges).
  suffix: { color: 'Diffuse', opacity: 'Opacity', normal: 'Normal', roughness: 'Roughness', ao: 'AO', subsurface: 'Subsurface', height: 'Height' },
  dil: { color: true, opacity: false, normal: true, roughness: true, ao: true, subsurface: true, height: true },
  // One more file with any maps in its R, G, B and A.
  packed: { on: false, suffix: 'Mask', ch: ['ao.r', 'roughness.r', 'subsurface.r', 'white'] },
  sharpen: 0, brightness: 0, contrast: 0, saturation: 1,
  bevel: 0, bevelWidth: 4, round: 0, noise: 0, noiseScale: 8, meshAo: 1,
};

// Settings saved by older versions miss the newer parts; fill them in place.
export function settle(o) {
  for (const k of ['maps', 'suffix', 'dil', 'packed']) o[k] = { ...EXPORT_DEFAULTS[k], ...(o[k] || {}) };
  if (o.dilate === false) for (const k of Object.keys(o.dil)) o.dil[k] = false;
  delete o.dilate; delete o.pack;
  return o;
}

// Whether a map has to be made: asked for itself, or used in the packed texture.
export const needs = (o, k) => !!o.maps?.[k] || (!!o.packed?.on && o.packed.ch.some((c) => c.startsWith(`${k}.`)));

const SIZES = [256, 512, 1024, 2048, 4096, 8192];
// Fills the missing settings into o itself (or a new object), keeping the object the open fields write to.
export function withDefaults(o, d) {
  o ||= {};
  for (const [k, v] of Object.entries(d)) if (o[k] === undefined) o[k] = structuredClone(v);
  return o;
}
export const sizeOf = (o) => [o.width ?? o.size ?? 1024, o.height ?? o.size ?? 1024];

// A group that folds open and shut, remembering which way it was. Everything starts closed.
const opened = new Set();
export function fold(title, items, cls = '') {
  const d = el('details', `set-sec ${cls}`);
  d.open = opened.has(title);
  d.addEventListener('toggle', () => { if (d.open) opened.add(title); else opened.delete(title); });
  d.append(el('summary', '', title), ...items);
  return d;
}

const MAPS = [['color', 'Diffuse'], ['opacity', 'Opacity'], ['normal', 'Normal'], ['roughness', 'Roughness'], ['ao', 'AO'], ['subsurface', 'Subsurface'], ['height', 'Height']];
const CHANNELS = [['white', 'White'], ['black', 'Black'], ['color.r', 'Diffuse R'], ['color.g', 'Diffuse G'], ['color.b', 'Diffuse B'], ['color.a', 'Opacity'], ['normal.r', 'Normal R'], ['normal.g', 'Normal G'], ['normal.b', 'Normal B'], ['roughness.r', 'Roughness'], ['ao.r', 'AO'], ['subsurface.r', 'Subsurface'], ['height.r', 'Height']];

// One map: its checkbox in front, its name, and an arrow at the end that opens its settings.
function mapRow(label, on, setOn, settings, disabled = false) {
  const wrap = el('div', 'map-item');
  const row = el('div', 'map-row');
  const box = el('input'); box.type = 'checkbox'; box.checked = on; box.disabled = disabled; box.setAttribute('aria-label', label);
  box.addEventListener('change', () => setOn(box.checked));
  const arrow = el('button', 'mini map-arrow', '▾'); arrow.title = `${label} settings`; arrow.setAttribute('aria-expanded', 'false');
  const body = el('div', 'map-settings'); body.hidden = true; body.append(...settings);
  arrow.addEventListener('click', () => { body.hidden = !body.hidden; arrow.setAttribute('aria-expanded', String(!body.hidden)); arrow.textContent = body.hidden ? '▾' : '▴'; });
  row.append(box, el('span', 'map-name', label), arrow);
  wrap.append(row, body);
  return wrap;
}

const textField = (label, value, set) => {
  const row = el('div', 'field'); const i = el('input', 'mat-name'); i.value = value; i.setAttribute('aria-label', label);
  i.addEventListener('input', () => set(i.value.trim().replace(/[^\w\- ]+/g, '')));
  row.append(el('label', '', label), i);
  return row;
};

// The settings, as folding groups. `o` is changed in place; `only` leaves out maps a source can't make.
export function exportFields(o, { meshAo = false, only = null } = {}) {
  settle(o);
  const set = (k) => (v) => { o[k] = v; };
  const name = textField('Name', o.name, (v) => { o.name = v || 'Atlas'; });
  // Width and height, linked unless the chain is broken; any size can be typed in.
  const size = el('div', 'size-row');
  const pickSize = (k) => {
    // A box that takes any size, with the usual ones offered in its list.
    const box = el('input', 'size-num');
    box.type = 'number'; box.min = 16; box.max = 8192; box.step = 1;
    box.value = sizeOf(o)[k === 'width' ? 0 : 1];
    box.setAttribute('list', 'canopy-sizes');
    box.setAttribute('aria-label', k === 'width' ? 'Width' : 'Height');
    box.addEventListener('change', () => {
      const v = Math.max(16, Math.min(8192, Math.round(+box.value) || 1024));
      o[k] = v;
      if (o.linked) o[k === 'width' ? 'height' : 'width'] = v;
      size.replaceWith(exportFields(o, { meshAo, only })[0].querySelector('.size-row'));
    });
    return box;
  };
  if (!document.getElementById('canopy-sizes')) {
    const list = el('datalist'); list.id = 'canopy-sizes';
    for (const s of SIZES) { const op = el('option'); op.value = s; list.append(op); }
    document.body.append(list);
  }
  const link = el('button', 'mini link', o.linked ? '🔗' : '⛓');
  link.title = o.linked ? 'Width and height are linked: press to set them apart' : 'Press to link width and height';
  link.setAttribute('aria-pressed', !!o.linked);
  link.addEventListener('click', () => {
    o.linked = !o.linked; if (o.linked) o.height = o.width;
    const row = exportFields(o, { meshAo, only })[0].querySelector('.size-row');
    size.replaceWith(row);
    // Linking can change the height, so the frame and the sheet take the new shape too.
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });
  size.append(el('label', '', 'Size'), pickSize('width'), el('span', '', '×'), pickSize('height'), link);
  if (Math.max(...sizeOf(o)) > 4096) size.append(el('p', 'hint', '8K maps need a lot of memory; save your work first.'));
  const exp = fold('Export', [name, size, selectField('Format', o.format, [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']], set('format'))]);
  // Each map's own settings, under its arrow: the file ending, dilation, and what only that map has.
  const common = (k) => [
    textField('Suffix', o.suffix[k], (v) => { o.suffix[k] = v || EXPORT_DEFAULTS.suffix[k]; }),
    checkField('Dilate', o.dil[k], (v) => { o.dil[k] = v; }),
  ];
  const extras = {
    color: [checkField('Add opacity in alpha', o.opacityInColor !== false, set('opacityInColor')),
      numberField('Sharpen', o.sharpen, { min: 0, max: 3 }, set('sharpen')), numberField('Brightness', o.brightness, { min: -0.5, max: 0.5 }, set('brightness')),
      numberField('Contrast', o.contrast, { min: -0.5, max: 0.9 }, set('contrast')), numberField('Saturation', o.saturation, { min: 0, max: 2 }, set('saturation'))],
    normal: [numberField('Edge bevel', o.bevel, { min: 0, max: 2 }, set('bevel')), numberField('Bevel width', o.bevelWidth, { min: 1, max: 32, int: true, unit: 'px' }, set('bevelWidth')),
      numberField('Roundness', o.round, { min: 0, max: 2 }, set('round')), numberField('Noise', o.noise, { min: 0, max: 2 }, set('noise')), numberField('Noise scale', o.noiseScale, { min: 1, max: 64, unit: 'px' }, set('noiseScale'))],
    ao: meshAo ? [numberField('Mesh AO', o.meshAo, { min: 0, max: 1 }, set('meshAo'))] : [],
  };
  const maps = [];
  for (const [k, l] of MAPS) {
    if (only && !only.includes(k) && k !== 'opacity') continue;
    maps.push(mapRow(l, k === 'color' || !!o.maps[k], (v) => { o.maps[k] = v; }, [...common(k), ...(extras[k] || [])], k === 'color'));
  }
  // The packed texture: any map into each of R, G, B and A.
  const P = o.packed;
  const chans = ['R', 'G', 'B', 'A'].map((c, i) => selectField(c, P.ch[i], CHANNELS.filter(([v]) => !only || ['white', 'black'].includes(v) || only.includes(v.split('.')[0]) || v === 'color.a'), (v) => { P.ch[i] = v; }));
  maps.push(mapRow('Packed texture', P.on, (v) => { P.on = v; }, [
    el('p', 'hint', 'One more file that carries chosen maps in its channels, for engines that read masks (for example AO, roughness and subsurface in R, G and B).'),
    textField('Suffix', P.suffix, (v) => { P.suffix = v || 'Mask'; }), ...chans,
  ]));
  return [exp, fold('Maps', maps)];
}

// Cleans the maps up: normal extras guided by coverage, then each map bled out past its edges if asked.
export function finishMaps(maps, o) {
  settle(o);
  const { width: S, height: H } = maps.color;
  const cover = new Uint8ClampedArray(S * H);
  for (let i = 0; i < S * H; i++) cover[i] = maps.color.data[i * 4 + 3];
  const out = {};
  for (const [k, img] of Object.entries(maps)) {
    if (!img) continue;
    let m = { width: S, height: H, data: new Uint8ClampedArray(img.data) };
    for (let i = 0; i < S * H; i++) m.data[i * 4 + 3] = cover[i];
    if (k === 'normal') m = enhanceNormals(m, null, o);
    if (k === 'color') m = colorAdjust(m, o);
    if (o.dil[k] !== false) m = dilate(m, 128);
    // Only color keeps its coverage as alpha; the data maps are solid.
    if (k !== 'color') for (let i = 0; i < S * H; i++) m.data[i * 4 + 3] = 255;
    else for (let i = 0; i < S * H; i++) m.data[i * 4 + 3] = cover[i];
    out[k] = m;
  }
  // Opacity is the coverage itself, never bled unless asked.
  const op = { width: S, height: H, data: new Uint8ClampedArray(S * H * 4) };
  for (let i = 0; i < S * H; i++) { op.data[i * 4] = op.data[i * 4 + 1] = op.data[i * 4 + 2] = cover[i]; op.data[i * 4 + 3] = 255; }
  out.opacity = o.dil.opacity ? dilate(op, 128) : op;
  return out;
}

// Which files to write and how each slot of the new material reads them.
export function planFiles(maps, o) {
  settle(o);
  const S = maps.color.width; const H = maps.color.height;
  const has = (k) => !!maps[k] && (k === 'color' || o.maps[k]);
  const sfx = (k) => o.suffix[k] || EXPORT_DEFAULTS.suffix[k];
  // JPG has no alpha, so opacity then goes in its own file.
  const inAlpha = o.opacityInColor !== false && o.format !== 'jpg';
  const files = [{ key: 'color', suffix: sfx('color'), img: packChannels(maps, ['color.r', 'color.g', 'color.b', inAlpha ? 'color.a' : 'white'], S, H), slots: { texture: null, ...(inAlpha ? { opacityMap: 'A' } : {}) } }];
  const alone = (k) => has(k) || (k === 'opacity' && !inAlpha);
  if (alone('opacity')) files.push({ key: 'opacity', suffix: sfx('opacity'), img: maps.opacity, slots: inAlpha ? {} : { opacityMap: 'R' } });
  const one = { normal: { normalMap: null }, roughness: { roughMap: 'R' }, ao: { aoMap: 'R' }, subsurface: { sssMap: 'R' }, height: {} };
  for (const [k, slots] of Object.entries(one)) if (has(k)) files.push({ key: k, suffix: sfx(k), img: maps[k], slots });
  if (o.packed.on) {
    const src = o.packed.ch.map((c) => (c === 'color.a' ? 'opacity.r' : c));
    // The material reads a map from the packed file only when that map has no file of its own.
    const slotOf = { 'ao.r': ['aoMap', has('ao')], 'roughness.r': ['roughMap', has('roughness')], 'subsurface.r': ['sssMap', has('subsurface')] };
    const slots = {};
    src.forEach((c, i) => { const s = slotOf[c]; if (s && !s[1] && maps[c.split('.')[0]]) slots[s[0]] = 'RGBA'[i]; });
    files.push({ key: 'packed', suffix: o.packed.suffix || 'Mask', img: packChannels(maps, src.map((c) => (maps[c.split('.')[0]] || ['white', 'black'].includes(c) ? c : 'black')), S, H), slots });
  }
  return files;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

const blobOf = (img, o) => new Promise((resolve) => toCanvas(img).toBlob(resolve, MIME[o.format], o.quality));
const dataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });

// Asks for a folder where the browser can (Chrome, Edge and the PC app); otherwise each file downloads.
async function saveFiles(named) {
  if (window.showDirectoryPicker) {
    let dir = null;
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'canopy-textures' }); } catch (e) { if (e.name === 'AbortError') return false; }
    if (dir) {
      for (const f of named) {
        const h = await dir.getFileHandle(f.file, { create: true });
        const w = await h.createWritable();
        await w.write(f.blob);
        await w.close();
      }
      return dir.name;
    }
  }
  for (const f of named) {
    const a = el('a');
    a.href = URL.createObjectURL(f.blob); a.download = f.file;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return 'Downloads';
}

// Saves the files, then adds a material that uses them (kept inside the plant file) and returns it.
export async function saveMaps(maps, o, toast) {
  const files = planFiles(finishMaps(maps, o), o);
  const named = [];
  for (const f of files) named.push({ ...f, file: `${o.name}_${f.suffix}.${o.format}`, blob: await blobOf(f.img, o) });
  const where = await saveFiles(named);
  if (where === false) { toast('Not saved.'); return null; }
  const m = newMaterial(o.name, { color: '#ffffff', roughColor: '#ffffff', aoColor: '#ffffff' });
  for (const f of named) {
    const id = `img:${o.name.replace(/\s+/g, '')}${f.suffix}${Date.now().toString(36)}`;
    doc.assets[id] = { name: f.file, url: await dataUrl(f.blob) };
    for (const [slot, ch] of Object.entries(f.slots)) {
      m[slot] = id;
      if (ch) m[{ opacityMap: 'opacityCh', aoMap: 'aoCh', roughMap: 'roughCh', sssMap: 'sssCh' }[slot]] = ch;
      if (slot === 'sssMap') m.sssColor = '#ffffff';
    }
  }
  // The cutouts of the new atlas, found from its opacity.
  const color = named.find((f) => f.key === 'color').img;
  const op = named.find((f) => f.key === 'opacity')?.img;
  const withAlpha = { width: color.width, height: color.height, data: new Uint8ClampedArray(color.data) };
  if (op) for (let i = 0; i < color.width * color.height; i++) withAlpha.data[i * 4 + 3] = op.data[i * 4];
  m.cutouts = cutoutsFromImage(withAlpha, { threshold: 0.5, padding: 2, points: 32 });
  (doc.graph.materials ||= []).push(m);
  changed({ layout: true });
  commit();
  toast(`Saved ${named.length} file${named.length > 1 ? 's' : ''} to ${where}, and added the material "${m.name}".`, 6000);
  return m;
}
