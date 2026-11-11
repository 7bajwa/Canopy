// Render settings: picture size (any aspect), which camera (frame the whole plant, or the view as it is now),
// what to include, the background, and post filters (exposure, color, sharpen, vignette, grain). The toolbar's camera
// button renders straight away with these; the settings button opens them in a floating panel with a live preview.
import { el, numberField, checkField, selectField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { fold } from './texout.js';
import { postFilter, POST_DEFAULTS } from '../leaf/imgops.js';

const SIZES = [['1:1', 1, 1], ['4:3', 4, 3], ['3:4', 3, 4], ['16:9', 16, 9], ['9:16', 9, 16], ['1:2', 1, 2]];
const FILTERS = [
  ['Exposure', 'exposure', -3, 3, 'stops'], ['Gamma', 'gamma', 0.3, 3], ['Brightness', 'brightness', -0.5, 0.5],
  ['Contrast', 'contrast', -0.5, 0.9], ['Saturation', 'saturation', 0, 2], ['Vibrance', 'vibrance', -1, 1],
  ['Temperature', 'temperature', -1, 1], ['Tint', 'tint', -1, 1], ['Sharpen', 'sharpen', 0, 3],
  ['Vignette', 'vignette', 0, 1], ['Vignette softness', 'vignetteSoft', 0, 1], ['Grain', 'grain', 0, 1],
];

export function makeRender({ view, prefs, setPref, toast, download, hide = () => [] }) {
  const post = () => ({ ...POST_DEFAULTS, ...prefs.renderPost });
  const size = () => {
    const w = Math.max(16, Math.round(+prefs.renderSize || 2048));
    return { w, h: Math.max(16, Math.round(+prefs.renderHeight || w)) };
  };
  const neutral = () => Object.entries(post()).every(([k, v]) => POST_DEFAULTS[k] === v);

  // The options for view.renderImage. thumb: a small picture from the current view (variations' thumbnails).
  function options({ width, height, thumb = false } = {}) {
    const { w, h } = size();
    const s = thumb ? Math.min(1, 256 / Math.max(w, h)) : 1;
    return {
      width: Math.round((width || w) * s), height: Math.round((height || h) * s),
      view: thumb || prefs.renderCamera === 'view',
      figure: prefs.renderFigure ? prefs.scaleShow : null,
      ground: prefs.renderGround, grid: !!prefs.renderGrid,
      bg: prefs.renderBg === 'color' ? prefs.renderBgColor : null,
      hide: hide(),
      filter: neutral() ? null : (img) => postFilter(img, post()),
    };
  }
  const image = (o) => view.renderImage(0, options(o));

  async function quick() {
    if (!view.meshes.length) { toast('There is no plant to render yet.'); return; }
    const { w, h } = size();
    await download(image());
    toast(`Saved a ${w} × ${h} image${prefs.renderBg === 'color' ? '' : ' with a see-through background'}.`);
  }

  let panel = null; let img = null; let timer = 0;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!panel?.isOpen() || !view.meshes.length) return;
      const { w, h } = size(); const k = 320 / Math.max(w, h);
      img.src = image({ width: Math.round(w * k), height: Math.round(h * k) });
    }, 120);
  };
  const set = (k, v) => { setPref(k, v); preview(); };
  const setPost = (k, v) => { setPref('renderPost', { ...prefs.renderPost, [k]: v }); preview(); };

  function draw() {
    const { w, h } = size();
    const b = panel.body;
    img = el('img', 'render-preview'); img.alt = 'Render preview';
    const ratios = el('div', 'row-buttons');
    for (const [label, a, c] of SIZES) {
      const btn = el('button', 'mini', label);
      btn.addEventListener('click', () => { set('renderHeight', Math.round(size().w * c / a)); draw(); });
      ratios.append(btn);
    }
    const filters = FILTERS.map(([label, k, min, max, unit]) => numberField(label, post()[k], { min, max, unit }, (v) => setPost(k, v)));
    const resetF = el('button', 'mini', 'Reset filters');
    resetF.addEventListener('click', () => { set('renderPost', {}); draw(); });
    const go = el('button', 'wide primary', 'Render and save');
    go.addEventListener('click', quick);
    b.replaceChildren(
      img,
      numberField('Width', w, { min: 16, max: 8192, int: true, unit: 'px' }, (v) => set('renderSize', v)),
      numberField('Height', h, { min: 16, max: 8192, int: true, unit: 'px' }, (v) => set('renderHeight', v)),
      ratios,
      selectField('Camera', prefs.renderCamera || 'frame', [['frame', 'Frame the whole plant'], ['view', 'The current view']], (v) => set('renderCamera', v)),
      checkField('Ground', prefs.renderGround, (v) => set('renderGround', v)),
      checkField('Ground grid', !!prefs.renderGrid, (v) => set('renderGrid', v)),
      checkField('Scale figure', prefs.renderFigure, (v) => set('renderFigure', v)),
      selectField('Background', prefs.renderBg, [['clear', 'See-through (PNG)'], ['color', 'A color']], (v) => { set('renderBg', v); draw(); }),
      ...(prefs.renderBg === 'color' ? [colorRow()] : []),
      fold('Filters', [...filters, resetF]),
      go,
    );
    preview();
  }
  function colorRow() {
    const row = el('div', 'field'); row.append(el('label', '', 'Background color'));
    const c = el('input'); c.type = 'color'; c.value = prefs.renderBgColor; c.setAttribute('aria-label', 'Background color');
    c.addEventListener('input', () => set('renderBgColor', c.value));
    row.append(c);
    return row;
  }

  function open() {
    panel ||= floatPanel('render-settings', 'Render settings', { width: 360 });
    draw();
    panel.show();
  }

  // The preview follows the plant while the panel is open.
  return { quick, open, options, image, refresh: preview, isOpen: () => !!panel?.isOpen() };
}
