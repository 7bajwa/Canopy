// The Settings window, in tabs, each made of sections that fold open and shut.
import { doc, regenerate, commit } from './doc.js';
import { el, numberField, checkField, selectField } from './fields.js';
import { THEMES, THEME_KEYS, themeOf } from './themes.js';

// Each tab is an icon (its name shows on hover), so they all fit in one row.
const ICON = {
  view: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  nav: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  bar: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M6 13h12M6 17h8"/>',
  render: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  scale: '<path d="M4 20V4M4 4h4M4 8h3M4 12h4M4 16h3M4 20h4"/><circle cx="15" cy="6" r="2"/><path d="M15 9v6M12 12h6M15 15l-2 5M15 15l2 5"/>',
  system: '<rect x="4" y="4" width="16" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
  dev: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
};
const TABS = [['view', 'View'], ['nav', 'Navigation'], ['bar', 'Toolbar'], ['render', 'Render'], ['wind', 'Wind'], ['scale', 'Scale and ground'], ['system', 'System'], ['dev', 'Developer']];
let tab = 'view';
const open = new Set(['Theme', 'Layout', 'Toolbar groups', 'Picture', 'Gusts', 'Scale indicator', 'Ground', 'Backups', 'AI control']);

export function openSettings(root, prefs, setPref) {
  const body = root.querySelector('.settings-body');
  body.replaceChildren();
  const bar = el('div', 'settings-tabs');
  bar.setAttribute('role', 'tablist');
  for (const [k, l] of TABS) {
    const b = el('button', 'icon-tab');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
    b.title = l; b.setAttribute('aria-label', l);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', k === tab);
    b.addEventListener('click', () => { tab = k; openSettings(root, prefs, setPref); });
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
  const add = (e) => box.append(e);
  const num = (label, key, o) => add(numberField(label, prefs[key], o, (v) => setPref(key, v)));
  const check = (label, key) => add(checkField(label, prefs[key], (v) => setPref(key, v)));
  const pick = (label, key, options) => add(selectField(label, prefs[key], options, (v) => setPref(key, v)));
  const color = (label, key) => {
    const row = el('div', 'field'); const i = el('input'); i.type = 'color'; i.value = prefs[key];
    i.setAttribute('aria-label', label);
    i.addEventListener('input', () => setPref(key, i.value));
    row.append(el('label', '', label), i); add(row);
  };
  const note = (t) => add(el('p', 'hint', t));

  body.append(el('h3', 'tab-title', TABS.find((t) => t[0] === tab)[1]));
  const again = () => openSettings(root, prefs, setPref);

  if (tab === 'view') {
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
    num('UI scale', 'ui', { min: 0.7, max: 1.75 });
    num('Text scale', 'text', { min: 0.8, max: 1.5 });
    head('Graph');
    check('Show the grid', 'grid');
    check('Snap nodes to grid', 'snap');
    num('Graph brightness', 'graphDim', { min: 0.2, max: 1 });
    pick('Variation', 'varShow', [['icon', 'Icon with a slider'], ['box', 'Its own box']]);
    pick('Units', 'units', [['metric', 'Metric (cm, m)'], ['imperial', 'Feet and inches']]);
    head('3D view');
    check('Show the view gizmo', 'gizmo');
    num('Gizmo size', 'gizmoSize', { min: 60, max: 160, int: true, unit: 'px' });
    check('Show the light and wind dials', 'dials');
    num('Dial size', 'dialSize', { min: 32, max: 90, int: true, unit: 'px' });
    num('Exposure', 'exposure', { min: 0.2, max: 2.5 });
    num('Environment light', 'envLight', { min: 0, max: 2 });
    check('Shadows', 'shadows');
    check('Soft glow behind the plant', 'glow');
    head('Wireframe');
    color('Line color', 'wireColor');
    num('Line strength', 'wireOpacity', { min: 0.05, max: 1 });
    head('Behind the plant');
    check('Fade the graph behind the plant', 'fadeOn');
    num('Fade strength', 'fadeStrength', { min: 0, max: 1 });
    num('Fade size', 'fadeSize', { min: 0.6, max: 2.5 });
  } else if (tab === 'nav') {
    head('Layout');
    pick('Layout', 'layout', [['overlay', 'One view: plant over graph'], ['split', 'Split side by side'], ['tree', 'Plant only'], ['graph', 'Graph only']]);
    num('Split: graph share', 'splitAt', { min: 0.15, max: 0.85 });
    note('In Split, drag the bar between the two halves to resize them.');
    head('Which view is in front');
    pick('In one view', 'focus', [['auto', 'Whichever is under the pointer'], ['graph', 'Graph in front, plant moves only by its icons'], ['tree', 'Plant in front, graph moves only by its icons']]);
    note('The layer button under each set of navigation icons switches this too.');
    head('Navigation icons');
    pick('Where they sit', 'navAt', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]);
    check('Swap sides: 3D view on the left, graph on the right', 'swapViews');
    note('Drag the grip of a set of icons to dock it on its own view’s side wall, or along the top or bottom of its own half. Drag the toolbar by its grip to dock it on any edge.');
    const reset = el('button', 'wide', 'Put the bars back');
    reset.addEventListener('click', () => { for (const k of ['navY2d', 'navY3d', 'navWall2d', 'navWall3d']) setPref(k, null); setPref('barAt', 'top'); });
    add(reset);
  } else if (tab === 'bar') {
    head('Toolbar groups');
    note('Each row is one group. First: fold it into one button (it does the last thing picked; hold it for the list). Then: hide the whole group. Then each button: lit shows it on the toolbar.');
    const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    const FOLD = icon('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 11l3 3 3-3"/>');
    const EYE = icon('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
    const keyOf = (b) => b.dataset.act || b.dataset.layoutBtn || b.dataset.shade || b.dataset.mode || b.getAttribute('aria-label');
    const toggle = (html, title, on, fn) => {
      const b = el('button', 'tool-toggle');
      b.innerHTML = html; b.title = title; b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', on);
      b.addEventListener('click', () => { fn(); openSettings(root, prefs, setPref); });
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
        const key = keyOf(b); const off = !!prefs.toolHidden?.[key];
        tools.append(toggle(b.querySelector('svg').outerHTML, b.getAttribute('aria-label') || b.title, !off, () => setPref('toolHidden', { ...prefs.toolHidden, [key]: !off })));
      }
      row.append(tools);
      add(row);
    }
  } else if (tab === 'render') {
    head('Picture');
    num('Size', 'renderSize', { min: 64, max: 8192, int: true, unit: 'px' });
    note('Square pictures this many pixels across; 1024, 2048 and 4096 are the usual sizes.');
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
  } else if (tab === 'scale') {
    head('Scale indicator');
    pick('Show', 'scaleShow', [['both', 'Figure and ruler'], ['figure', 'Figure only'], ['ruler', 'Ruler only']]);
    note('The ruler icon under the light and wind dials turns it on and off.');
    head('Ground');
    note('The ground stays at the origin, level, whatever the plant does; parts below it go through.');
    check('Show the ground', 'groundOn');
    color('Color', 'groundColor');
    num('Opacity', 'groundOpacity', { min: 0, max: 1 });
    num('Size across', 'groundSize', { min: 50, max: 20000, unit: 'cm' });
    check('Catch shadows', 'groundShadow');
    check('Faint grid on the ground', 'groundGrid');
  } else if (tab === 'system') {
    head('Backups');
    check('Keep backups while I work', 'backupOn');
    num('Save a backup every', 'backupMin', { min: 0.5, max: 120, unit: 'min' });
    note('The PC app keeps them beside the saved file, or in its own Backups folder before the first save; the browser keeps the latest ones on this device.');
    head('Undo');
    num('Steps to remember', 'undoSteps', { min: 5, max: 500, int: true });
    note('How many changes Undo can take back. More steps use more memory with large imported meshes.');
    // These belong to the plant and save with it.
    const s = doc.graph.settings;
    const plant = (label, key, d, o = {}) => add(numberField(label, s[key] ?? d, o, (v, draft) => { s[key] = v; regenerate({ draft: !!draft }); }, commit));
    head('This plant');
    plant('Seed', 'seed', 1, { int: true, min: 0 });
    add(checkField('Branch blending', s.blendOn !== false, (v) => { s.blendOn = v; regenerate(); commit(); }));
    plant('Reference length', 'unitCalc', 100, { min: 1, unit: 'cm' });
    plant('Max segments per line', 'segLimit', 400, { int: true, min: 2 });
    plant('Max segments', 'maxSegments', 400000, { int: true, min: 100 });
    plant('Max lines', 'maxLines', 150000, { int: true, min: 10 });
  } else {
    head('AI control');
    check('Let an AI assistant build plants here', 'aiBridge');
    note('Off unless you turn it on. In the PC app this opens a private connection on this computer only, which an MCP client can use to read the node list, build or change the plant and look at a render. The guide in the docs folder tells an assistant how plants are made here.');
    const link = el('a', 'btn wide', 'Open the node reference');
    link.href = './docs/index.html'; link.target = '_blank';
    add(link);
  }

  root.hidden = false;
  root.querySelector('[data-close]').focus();
}
