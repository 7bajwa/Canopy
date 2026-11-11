// Themes: one set of colors drives the panels (CSS variables), the node graph's canvas and the 3D view's backdrop.
// People can duplicate a theme and change its colors; those live in the preferences.
export const THEME_KEYS = [
  ['bg', 'Background'], ['glow', 'Background glow'], ['side', 'Panels'], ['panel', 'Pop-ups'], ['ink', 'Text'], ['muted', 'Quiet text'],
  ['accent', 'Accent'], ['accentHi', 'Accent light'], ['head', 'Node headers'], ['node', 'Node body'], ['field', 'Value boxes'], ['grid', 'Grid lines'],
];

export const THEMES = {
  forest: { name: 'Forest', dark: true, bg: '#11160f', glow: '#1c2619', side: '#253525', panel: '#161d14', ink: '#e9efe4', muted: '#a3b09a', accent: '#4a8610', accentHi: '#7fc241', head: '#3f7a2c', node: '#1a2119', field: '#000000', grid: '#bedcaa' },
  charcoal: { name: 'Charcoal', dark: true, bg: '#141516', glow: '#202224', side: '#2a2c2e', panel: '#1e1f21', ink: '#e8e9ea', muted: '#a2a6aa', accent: '#4f7fbf', accentHi: '#7fa8e0', head: '#45586e', node: '#1f2123', field: '#000000', grid: '#c8cdd2' },
  midnight: { name: 'Midnight', dark: true, bg: '#0c1220', glow: '#16203a', side: '#1d2638', panel: '#141c2c', ink: '#e4e9f4', muted: '#9aa6bf', accent: '#3f6fd8', accentHi: '#79a2ff', head: '#2f4f8f', node: '#141c2e', field: '#000000', grid: '#a8bce8' },
  light: { name: 'Light', dark: false, bg: '#eef1eb', glow: '#ffffff', side: '#e2e8de', panel: '#f4f7f2', ink: '#1d2419', muted: '#5d6a56', accent: '#4a8610', accentHi: '#3d7a0c', head: '#5f9a3c', node: '#fbfcfa', field: '#dfe6da', grid: '#2e4a20' },
};

export const themeOf = (prefs) => prefs.customThemes?.[prefs.theme] || THEMES[prefs.theme] || THEMES.forest;

const rgb = (hex) => { const v = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
export const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

// Puts a theme on the page; returns the palette the node graph draws with.
export function applyTheme(t) {
  const s = document.documentElement.style;
  const vars = { '--bg': t.bg, '--glow': t.glow, '--side': t.side, '--panel': rgba(t.panel, 0.95), '--ink': t.ink, '--muted': t.muted, '--line': rgba(t.ink, t.dark ? 0.1 : 0.16), '--green': t.accent, '--green-hi': t.accentHi, '--bar-bg': rgba(t.panel, t.dark ? 0.86 : 0.82) };
  for (const [k, v] of Object.entries(vars)) s.setProperty(k, v);
  s.colorScheme = t.dark ? 'dark' : 'light';
  document.documentElement.dataset.dark = t.dark ? 'true' : 'false';
  return graphPalette(t);
}

export function graphPalette(t) {
  return {
    body: rgba(t.node, 0.96), head: t.head || '#3f7a2c', ink: t.ink, inkRGB: rgb(t.ink).join(','), label: t.dark ? rgba(t.ink, 0.82) : rgba(t.ink, 0.86), muted: t.muted,
    field: t.dark ? rgba(t.field, 0.42) : rgba(t.field, 0.95), grid: rgba(t.grid, t.dark ? 0.055 : 0.08), grid2: rgba(t.grid, t.dark ? 0.07 : 0.12),
    tabBg: t.dark ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.06)', title: t.dark ? '#d8f5b8' : t.accentHi, accent: t.dark ? '#9be15d' : t.accentHi,
  };
}
