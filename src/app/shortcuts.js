// Every keyboard shortcut, in one list the Shortcuts tab can show and change. Commands without a key are there
// so one can be given to them. Keys read like ctrl+shift+z; changes are kept in prefs.keys as { id: [keys] }.
export const COMMANDS = [
  // Edit
  ['undo', 'Undo', 'Edit', ['ctrl+z']],
  ['redo', 'Redo', 'Edit', ['ctrl+y', 'ctrl+shift+z']],
  ['copy', 'Copy nodes', 'Edit', ['ctrl+c']],
  ['paste', 'Paste nodes', 'Edit', ['ctrl+v']],
  ['duplicate', 'Duplicate nodes', 'Edit', ['ctrl+d']],
  ['group', 'Group nodes', 'Edit', ['ctrl+g']],
  ['selectAll', 'Select all nodes', 'Edit', ['ctrl+a']],
  ['remove', 'Delete', 'Edit', ['delete', 'backspace', 'x']],
  ['toggleNode', 'Turn nodes on or off', 'Edit', ['h']],
  ['addNode', 'Add a node', 'Edit', ['space']],
  ['escape', 'Cancel or pick nothing', 'Edit', ['escape']],
  // File
  ['new', 'New plant', 'File', []],
  ['open', 'Open a file', 'File', ['ctrl+o']],
  ['save', 'Save', 'File', ['ctrl+s']],
  ['saveAs', 'Save As', 'File', ['ctrl+shift+s']],
  ['import', 'Import a mesh', 'File', []],
  ['export', 'Export', 'File', ['ctrl+e']],
  ['library', 'Library', 'File', []],
  // View
  ['frame', 'Frame under the pointer', 'View', ['f']],
  ['cycleLayout', 'Next layout', 'View', ['tab']],
  ['layoutOverlay', 'One view', 'View', []],
  ['layoutSplit', 'Split view', 'View', []],
  ['layoutTree', 'Plant only', 'View', []],
  ['layoutGraph', 'Graph only', 'View', []],
  ['lines', 'Show splines only', 'View', ['l']],
  ['wind', 'Wind on or off', 'View', []],
  ['scale', 'Scale figure on or off', 'View', []],
  ['toolbar', 'Fold the toolbar', 'View', []],
  // Tools
  ['xform', 'Transform tool', 'Tools', []],
  ['pen', 'Draw tool', 'Tools', []],
  ['xfAll', 'Transform: all in one', 'Tools', ['q']],
  ['xfMove', 'Transform: move', 'Tools', ['w']],
  ['xfRotate', 'Transform: rotate', 'Tools', ['e']],
  ['xfScale', 'Transform: scale', 'Tools', ['r']],
  ['seed', 'Random seed', 'Tools', []],
  ['nextTab', 'Next tab on the node', 'Tools', []],
  ['prevTab', 'Previous tab on the node', 'Tools', []],
  // Windows
  ['prefs', 'Settings', 'Windows', ['ctrl+,']],
  ['materials', 'Materials', 'Windows', []],
  ['cutouts', 'Cutout editor', 'Windows', []],
  ['uv', 'UV editor', 'Windows', []],
  ['life', 'Age and season', 'Windows', []],
  ['presets', 'Variations', 'Windows', []],
  ['savePreset', 'Save variation', 'Windows', []],
  ['render', 'Quick render', 'Windows', []],
  ['renderSettings', 'Render settings', 'Windows', []],
  ['bake', 'Atlas Bake', 'Windows', []],
  ['cards', 'Cards bake', 'Windows', []],
  ['scanBake', 'Scan Bake', 'Windows', []],
  ['pack', 'Texture Pack', 'Windows', []],
  ['welcome', 'Welcome', 'Windows', []],
].map(([id, label, group, keys]) => ({ id, label, group, keys }));

const NAMES = { ' ': 'space', esc: 'escape', del: 'delete' };
// The key a press makes, as text: modifiers first, in a fixed order.
export function keyOf(e) {
  let k = (e.key || '').toLowerCase();
  k = NAMES[k] || k;
  if (['control', 'shift', 'alt', 'meta'].includes(k)) return '';
  return [(e.ctrlKey || e.metaKey) && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', k].filter(Boolean).join('+');
}

export const keysFor = (id, prefs) => prefs?.keys?.[id] ?? COMMANDS.find((c) => c.id === id)?.keys ?? [];

// The command a press runs. Shift on its own is let through for keys that have no shifted binding (shift+x deletes).
export function commandFor(e, prefs) {
  const k = keyOf(e);
  if (!k) return null;
  const find = (key) => COMMANDS.find((c) => keysFor(c.id, prefs).includes(key))?.id || null;
  return find(k) || (e.shiftKey && !e.ctrlKey && !e.metaKey ? find(k.replace('shift+', '')) : null);
}

// How a key shows: Ctrl+Shift+Z.
export const showKey = (k) => k.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+');
