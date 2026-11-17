// The Settings window, in tabs, each made of sections that fold open and shut. Notes stay to one line; the rest of
// what a setting does is in its tooltip and in the status bar.
import { VERSION } from './updater.js';
import { doc, regenerate, commit } from './doc.js';
import { el, numberField, checkField, selectField } from './fields.js';
import { THEMES, THEME_KEYS, themeOf } from './themes.js';
import { FIGURES } from './figures.js';
import { COMMANDS, keysFor, keyOf, showKey } from './shortcuts.js';
import { showLength } from './units.js';

// Each tab is an icon (its name shows on hover), so they all fit in one row.
const ICON = {
  ui: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h5M7 16h8"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M15 9l2 3-2 3M9 9l-2 3 2 3"/>',
  view: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5L12 12l8-4.5M12 12v9"/>',
  nav: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  bar: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M6 13h12M6 17h8"/>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  render: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  system: '<rect x="4" y="4" width="16" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
  dev: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
};
const TABS = [['ui', 'Interface'], ['layout', 'Layout and graph'], ['view', '3D view'], ['nav', 'Navigation'], ['bar', 'Toolbar'], ['keys', 'Shortcuts'], ['render', 'Render'], ['wind', 'Wind'], ['system', 'System'], ['dev', 'Developer']];
let tab = 'ui';
const open = new Set(['Theme', 'Size', 'Views', 'Graph', 'Look', 'Navigation icons', 'Toolbar groups', 'Picture', 'Gusts', 'Units', 'Backups', 'AI control', 'Edit', 'Status bar', 'Tooltips', 'Scale figure']);

export function openSettings(root, prefs, setPrefRaw, { resetLayout = () => {}, status = () => {} } = {}) {
  const body = root.querySelector('.settings-body');
  const scroll = body.scrollTop;
  body.replaceChildren();
  // Every change reads back in the status bar.
  const setPref = (k, v, label) => { setPrefRaw(k, v); if (label) status(label, typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'object' ? 'changed' : String(v)); };
  const again = () => openSettings(root, prefs, setPrefRaw, { resetLayout, status });
  const bar = el('div', 'settings-tabs');
  bar.setAttribute('role', 'tablist');
  // The Developer tab shows only where it has been switched on.
  if (tab === 'dev' && !prefs.devMode) tab = 'ui';
  let hoverT = 0;
  for (const [k, l] of TABS.filter(([k]) => k !== 'dev' || prefs.devMode)) {
    const b = el('button', 'icon-tab');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
    b.title = l; b.setAttribute('aria-label', l);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', k === tab);
    const go = () => { if (tab !== k) { tab = k; again(); } };
    b.addEventListener('click', go);
    // Hover to open (Navigation): resting on a tab opens it.
    b.addEventListener('pointerenter', (e) => { if (prefs.hoverOpen && e.pointerType !== 'touch') { clearTimeout(hoverT); hoverT = setTimeout(go, prefs.hoverDelay * 1000); } });
    b.addEventListener('pointerleave', () => clearTimeout(hoverT));
    bar.append(b);
  }
  body.append(bar);
  let box = body;
  // A section folds open and shut from its heading, and remembers which way it was.
  const head = (t) => {
    const d = el('details', 'set-sec');
    d.open = open.has(t);
    d.addEventListener('toggle', () => { if (d.open) open.add(t); else open.delete(t); });
    d.append(el('summary', '', t));
    body.append(d);
    box = d;
  };
  const add = (e, tip) => { if (tip) e.title = tip; box.append(e); return e; };
  const num = (label, key, o, tip) => add(numberField(label, prefs[key], o, (v) => setPref(key, v, label)), tip);
  const check = (label, key, tip) => add(checkField(label, !!prefs[key], (v) => setPref(key, v, label)), tip);
  const pick = (label, key, options, tip) => add(selectField(label, prefs[key], options, (v) => { setPref(key, v, label); again(); }), tip);
  const color = (label, key, tip) => {
    const row = el('div', 'field'); const i = el('input'); i.type = 'color'; i.value = prefs[key];
    i.setAttribute('aria-label', label);
    i.addEventListener('input', () => setPref(key, i.value));
    row.append(el('label', '', label), i); add(row, tip);
  };
  const button = (label, fn, tip) => { const b = el('button', 'wide', label); b.addEventListener('click', fn); return add(b, tip); };
  const note = (t) => add(el('p', 'hint', t), t);

  body.append(el('h3', 'tab-title', TABS.find((t) => t[0] === tab)[1]));

  if (tab === 'ui') {
    head('Theme');
    const custom = prefs.customThemes || {};
    pick('Theme', 'theme', [...Object.entries(THEMES), ...Object.entries(custom)].map(([k, t]) => [k, t.name]));
    const row = el('div', 'row-buttons');
    const dup = el('button', 'wide', 'Duplicate');
    dup.title = 'Make your own copy of this theme to change its colors';
    dup.addEventListener('click', () => {
      const base = themeOf(prefs); const id = `my${Date.now().toString(36)}`;
      setPref('customThemes', { ...custom, [id]: { ...base, name: `${base.name} copy` } });
      setPref('theme', id); again();
    });
    row.append(dup);
    if (custom[prefs.theme]) {
      const del = el('button', 'wide', 'Delete');
      del.addEventListener('click', () => { const rest = { ...custom }; delete rest[prefs.theme]; setPref('customThemes', rest); setPref('theme', 'forest'); again(); });
      row.append(del);
    }
    add(row);
    // The colors sit folded under the theme; changing one on a built-in theme makes a copy first.
    const colors = el('details', 'set-sub'); colors.append(el('summary', '', 'Theme colors'));
    const t = themeOf(prefs);
    if (custom[prefs.theme]) {
      const name = el('input', 'mat-name'); name.value = t.name; name.setAttribute('aria-label', 'Theme name');
      name.addEventListener('change', () => setPref('customThemes', { ...custom, [prefs.theme]: { ...t, name: name.value || t.name } }));
      colors.append(name);
    }
    for (const [k, l] of THEME_KEYS) {
      const r = el('div', 'field'); const i = el('input'); i.type = 'color'; i.value = t[k] || THEMES.forest[k]; i.setAttribute('aria-label', l);
      i.addEventListener('input', () => {
        let id = prefs.theme; const all = prefs.customThemes || {};
        if (!all[id]) { id = `my${Date.now().toString(36)}`; prefs.theme = id; }
        setPref('customThemes', { ...all, [id]: { ...(all[id] || { ...t, name: `${t.name} copy` }), [k]: i.value } });
        if (prefs.theme !== id || !custom[id]) setPref('theme', id);
      });
      r.append(el('label', '', l), i); colors.append(r);
    }
    const dark = checkField('Dark theme', t.dark, (v) => { if (custom[prefs.theme]) setPref('customThemes', { ...custom, [prefs.theme]: { ...t, dark: v } }); });
    if (custom[prefs.theme]) colors.append(dark);
    add(colors);
    head('Size');
    num('UI scale', 'ui', { min: 0.7, max: 1.75 }, 'The size of every bar, window and button');
    num('Text scale', 'text', { min: 0.8, max: 1.5 }, 'The size of the writing, on top of the UI scale');
    head('Status bar');
    check('Show the status bar', 'statusOn', 'The bar at the bottom: what is under the pointer, and what each tool does');
    num('Status bar size', 'statusSize', { min: 0.8, max: 1.8 });
    head('Tooltips');
    check('Show tooltips', 'tipOn', 'A box beside the pointer about what it rests on. The status bar shows the same at once');
    num('Wait before showing', 'tipDelay', { min: 0, max: 10, unit: 's' });
    head('Start');
    check('Show the welcome window', 'welcome');
    head('Reset');
    button('Reset the layout and scales', () => { resetLayout(); again(); }, 'Every window, bar and panel back to where it starts, and the UI and text scale to 1');
  } else if (tab === 'layout') {
    head('Views');
    pick('Layout', 'layout', [['overlay', 'One view: plant over graph'], ['split', 'Split side by side'], ['tree', 'Plant only'], ['graph', 'Graph only']]);
    num('Split: graph share', 'splitAt', { min: 0.15, max: 0.85 }, 'In Split, drag the bar between the halves too');
    check('3D view on the left', 'swapViews', 'Off: the graph on the left and the 3D view on the right');
    pick('In front', 'focus', [['auto', 'Whichever is under the pointer'], ['graph', 'Graph: the plant moves by its icons'], ['tree', 'Plant: the graph moves by its icons']], 'The layer button under each set of navigation icons switches this too');
    head('Graph');
    check('Show the grid', 'grid');
    check('Snap nodes to grid', 'snap');
    num('Graph brightness', 'graphDim', { min: 0.2, max: 1 });
    pick('Variation shows as', 'varShow', [['box', 'Its own box'], ['icon', 'An icon with a slider']], 'Box: drag it to change, tap it for Percent or Absolute');
    head('Shadow behind the plant');
    check('Fade the graph behind the plant', 'fadeOn', 'Keeps the plant readable over the nodes in One view');
    num('Fade strength', 'fadeStrength', { min: 0, max: 1 });
    num('Fade size', 'fadeSize', { min: 0.6, max: 2.5 });
  } else if (tab === 'view') {
    head('Look');
    num('Exposure', 'exposure', { min: 0.2, max: 2.5 });
    num('Environment light', 'envLight', { min: 0, max: 2 });
    check('Shadows', 'shadows');
    check('Soft glow behind the plant', 'glow');
    head('Gizmo and dials');
    check('Show the view gizmo', 'gizmo', 'Click an axis to look straight down it');
    num('Gizmo size', 'gizmoSize', { min: 60, max: 160, int: true, unit: 'px' });
    check('Show the light and wind dials', 'dials', 'Click the middle to switch, drag the dot to turn');
    num('Dial size', 'dialSize', { min: 32, max: 90, int: true, unit: 'px' });
    head('Wiremesh');
    color('Line color', 'wireColor');
    num('Line strength', 'wireOpacity', { min: 0.05, max: 1 });
    head('Scale figure');
    pick('Show', 'scaleShow', [['both', 'Figure and ruler'], ['figure', 'Figure only'], ['ruler', 'Ruler only']], 'The ruler icon under the dials turns it on and off');
    note('Figures to use, smallest to tallest:');
    for (const f of FIGURES) {
      const on = prefs.figures?.[f.id] !== false;
      const row = checkField(`${f.name} · ${showLength(f.height)}`, on, (v) => setPref('figures', { ...prefs.figures, [f.id]: v }, f.name));
      row.classList.add('fig-row');
      row.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${f.w} ${f.h}" aria-hidden="true"><path fill-rule="evenodd" d="${f.d}"/></svg>`);
      add(row, `Shown beside plants up to ${showLength(f.upTo === Infinity ? 1e9 : f.upTo).replace(/^1e.*$/, 'any height')}`);
    }
    head('Ground');
    check('Show the ground', 'groundOn', 'Stays level at the origin; parts below it go through');
    color('Color', 'groundColor');
    num('Opacity', 'groundOpacity', { min: 0, max: 1 });
    num('Size across', 'groundSize', { min: 50, max: 20000, unit: 'cm' });
    check('Catch shadows', 'groundShadow');
    check('Faint grid on the ground', 'groundGrid');
  } else if (tab === 'nav') {
    head('Navigation icons');
    pick('Where they sit', 'navAt', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], 'Or drag a set by its grip to any wall of its own view');
    button('Put the icons and toolbar back', () => { for (const k of ['navY2d', 'navY3d', 'navWall2d', 'navWall3d', 'navPW2d', 'navPW3d', 'navPY2d', 'navPY3d']) setPref(k, null); setPref('barAt', 'top'); });
    head('Hover to open');
    check('Open by resting the pointer', 'hoverOpen', 'Node tabs, Settings tabs and folded toolbar lists open when a mouse or pen rests on them');
    num('Wait before opening', 'hoverDelay', { min: 0.1, max: 2, unit: 's' });
    head('Entity editor');
    pick('A box picks', 'xfBox', [['touch', 'What it touches'], ['cover', 'Only what it fully covers']]);
  } else if (tab === 'bar') {
    head('Toolbar groups');
    note('Fold a group into one button, hide it, or light the buttons to show.');
    const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    const FOLD = icon('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 11l3 3 3-3"/>');
    const EYE = icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
    const keyOf2 = (b) => b.dataset.act || b.dataset.layoutBtn || b.dataset.shade || b.dataset.mode || b.getAttribute('aria-label');
    const toggle = (html, title, on, fn) => {
      const b = el('button', 'tool-toggle');
      b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', on);
      b.addEventListener('click', () => { fn(); again(); });
      return b;
    };
    for (const g of document.querySelectorAll('#bar .group[data-group]')) {
      const k = g.dataset.group;
      const mode = g.classList.contains('compact') ? 'compact' : 'full';
      const hiddenGroup = (prefs.toolGroups?.[k] ?? (g.hidden ? 'hidden' : mode)) === 'hidden';
      const row = el('div', 'tool-row');
      row.append(
        toggle(FOLD, `${g.dataset.label}: fold into one button`, mode === 'compact' && !hiddenGroup, () => setPref('toolGroups', { ...prefs.toolGroups, [k]: mode === 'compact' ? 'full' : 'compact' })),
        toggle(EYE, `${g.dataset.label}: show on the toolbar`, !hiddenGroup, () => setPref('toolGroups', { ...prefs.toolGroups, [k]: hiddenGroup ? (mode === 'compact' ? 'compact' : 'full') : 'hidden' })),
        el('span', 'tool-row-label', g.dataset.label),
      );
      const tools = el('div', 'tool-row-icons');
      for (const b of g.querySelectorAll(':scope > button:not(.group-more), :scope > a')) {
        const key = keyOf2(b); const off = !!prefs.toolHidden?.[key];
        tools.append(toggle(b.querySelector('svg').outerHTML, b.getAttribute('aria-label') || b.title || b.dataset.tip, !off, () => setPref('toolHidden', { ...prefs.toolHidden, [key]: !off })));
      }
      row.append(tools);
      add(row);
    }
    head('Size');
    num('Rows', 'barRows', { min: 1, max: 4, int: true }, 'Or drag the corner at the end of the toolbar');
    button('Fit the toolbar to its buttons', () => { setPref('barW', null); setPref('barRows', 1); again(); });
  } else if (tab === 'keys') {
    note('Click a key to change it, then press the new one. Esc cancels; Backspace clears.');
    let group = '';
    for (const c of COMMANDS) {
      if (c.group !== group) { group = c.group; add(el('div', 'key-group', group)); }
      const row = el('div', 'key-row');
      row.append(el('span', '', c.label));
      const keys = el('div', 'keys');
      const list = keysFor(c.id, prefs);
      const chip = el('button', `key-chip${list.length ? '' : ' empty'}`, list.length ? list.map(showKey).join(', ') : 'Add a key');
      chip.title = `${c.label}: click, then press the keys`;
      chip.addEventListener('click', () => {
        chip.classList.add('listen'); chip.textContent = 'Press keys…';
        const listen = (e) => {
          e.preventDefault(); e.stopPropagation();
          const k = keyOf(e);
          if (!k) return;
          removeEventListener('keydown', listen, true);
          if (k === 'escape') { again(); return; }
          const next = k === 'backspace' || k === 'delete' ? [] : [k];
          // A key belongs to one command: it leaves any other that had it.
          const all = { ...prefs.keys };
          if (next.length) for (const o of COMMANDS) if (o.id !== c.id && keysFor(o.id, prefs).includes(k)) all[o.id] = keysFor(o.id, prefs).filter((x) => x !== k);
          all[c.id] = next;
          setPref('keys', all, c.label);
          again();
        };
        addEventListener('keydown', listen, true);
      });
      keys.append(chip);
      if (prefs.keys?.[c.id]) {
        const back = el('button', 'mini', '↺'); back.title = 'Back to its own key'; back.setAttribute('aria-label', `${c.label}: back to its own key`);
        back.addEventListener('click', () => { const all = { ...prefs.keys }; delete all[c.id]; setPref('keys', all); again(); });
        keys.append(back);
      }
      row.append(keys);
      add(row);
    }
    button('Every key back to how it starts', () => { setPref('keys', {}); again(); });
  } else if (tab === 'render') {
    head('Picture');
    num('Width', 'renderSize', { min: 16, max: 8192, int: true, unit: 'px' });
    num('Height', 'renderHeight', { min: 16, max: 8192, int: true, unit: 'px' });
    pick('Camera', 'renderCamera', [['frame', 'Frame the whole plant'], ['view', 'The current view']], 'Filters and a live preview are in Render settings, beside the render button');
    check('Include the ground grid', 'renderGrid');
    check('Include the scale figure', 'renderFigure');
    check('Include the ground shadow', 'renderGround');
    pick('Background', 'renderBg', [['clear', 'See-through (PNG)'], ['color', 'A color']]);
    color('Background color', 'renderBgColor');
  } else if (tab === 'wind') {
    head('Gusts');
    num('Least gust', 'windMin', { min: 0 });
    num('Strongest gust', 'windMax', { min: 0 });
    num('Gusts per minute', 'gustFreq', { min: 0.5, max: 60 });
    num('Speed', 'windSpeed', { min: 0.1, max: 5 });
    num('Direction', 'windDir', { min: 0, max: 360, unit: '°' });
  } else if (tab === 'system') {
    head('Units');
    pick('System', 'units', [['metric', 'Metric'], ['imperial', 'Feet and inches']], 'Lengths are kept in centimetres; this changes how they read and type');
    if (prefs.units === 'imperial') pick('Inches as', 'unitLen', [['dec', 'Decimals (5.5")'], ['frac', 'Fractions (5 1/2")']]);
    else pick('Show lengths in', 'unitLen', [['m', 'Metres'], ['cm', 'Centimetres'], ['mm', 'Millimetres']]);
    head('Project folder');
    const dir = note(window.canopyApp ? 'Documents › Canopy' : window.Capacitor?.isNativePlatform?.() ? 'Documents › Canopy on this tablet' : 'Downloads, or kept in this browser');
    window.canopyApp?.projectDir?.().then((p) => { dir.textContent = p; dir.title = p; }).catch(() => {});
    head('Saving');
    pick('Textures', 'texturesInFile', [['embed', 'Inside the .canopy file'], ['folder', 'Beside it, in a textures folder'], ['linked', 'Where they are in your files']], 'Inside: one file. Beside: a textures folder (a .zip in a browser). Where they are: the file points at your pictures; PC app only');
    head('Backups');
    check('Save a backup while I work', 'backupOn', 'Only when the plant changed. Canopy-YYMMDD_HHMM before the first save, <name>_YYMMDD_HHMM after');
    num('Every', 'backupMin', { min: 1, max: 120, unit: 'min' });
    if (!window.canopyApp && !window.Capacitor?.isNativePlatform?.()) pick('In a browser', 'webBackup', [['ask', 'Ask me first'], ['download', 'Download them'], ['keep', 'Keep them in this browser']]);
    head('Variation');
    num('New nodes start with', 'varyDefault', { min: 0, max: 50, unit: '%' }, 'Every value that can vary starts with this much, as a percent, on nodes added from now on');
    head('Updates');
    check('Check for updates at start', 'updateCheck');
    check('Install updates without asking', 'updateAuto');
    const now = el('button', 'btn wide', 'Check now');
    now.addEventListener('click', () => document.dispatchEvent(new CustomEvent('canopy:check-update')));
    add(now, 'Updates come from the Canopy releases on GitHub');
    note(`Canopy ${VERSION}`);
    head('Undo');
    num('Steps to remember', 'undoSteps', { min: 5, max: 500, int: true }, 'More steps use more memory with large imported meshes');
    // These belong to the plant and save with it.
    const st = doc.graph.settings;
    const plant = (label, key, d, o = {}) => add(numberField(label, st[key] ?? d, o, (v, draft) => { st[key] = v; regenerate({ draft: !!draft }); }, commit));
    head('This plant');
    plant('Seed', 'seed', 1, { int: true, min: 0 });
    add(checkField('Branch blending', st.blendOn !== false, (v) => { st.blendOn = v; regenerate(); commit(); }));
    plant('Reference length', 'unitCalc', 100, { min: 1, unit: 'cm' });
    plant('Max segments per line', 'segLimit', 400, { int: true, min: 2 });
    plant('Max segments', 'maxSegments', 400000, { int: true, min: 100 });
    plant('Max lines', 'maxLines', 150000, { int: true, min: 10 });
  } else {
    head('AI control');
    check('Let an AI assistant build plants here', 'aiBridge', 'Off unless turned on. The PC app opens a private connection on this computer for an MCP client');
  }

  root.hidden = false;
  body.scrollTop = scroll;
  root.querySelector('[data-close]').focus();
}
