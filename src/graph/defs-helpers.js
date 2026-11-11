// Shorthand for declaring node parameters, shared by the defs-*.js tables.
export const num = (k, l, d, o = {}) => ({ k, l, t: 'num', d, ...o });
export const int = (k, l, d, o = {}) => ({ k, l, t: 'num', d, step: 1, int: true, ...o });
export const bool = (k, l, d, o = {}) => ({ k, l, t: 'bool', d, ...o });
export const en = (k, l, d, opts, o = {}) => ({ k, l, t: 'enum', d, opts, ...o });
export const col = (k, l, d, o = {}) => ({ k, l, t: 'color', d, ...o });
export const crv = (k, l, d, o = {}) => ({ k, l, t: 'curve', d, ...o });
export const data = (k, d) => ({ k, t: 'data', d });
export const vec = (k, l, d, o = {}) => ({ k, l, t: 'vec', d, ...o });

// A heading in the properties panel; holds no value.
export const section = (k, l, o = {}) => ({ k, l, t: 'section', d: null, ...o });

// Optional settings stay hidden until their tick box is on (`when`), so nodes start out simple.
const off = (k) => ({ when: k, sock: false, along: 'pos' });

// Surface settings every mesh node carries, so a separate material or color node is rarely needed.
export const surface = ({ texture = null, uv = 'plain' } = {}) => [
  section('_surface', 'Surface'),
  col('color', 'Color', '#ffffff', { n: 1 }),
  num('roughness', 'Roughness', 0.85, { min: 0, max: 1, sock: false }),
  { k: 'texture', l: 'Texture', t: 'texture', d: texture, n: 1 },
  ...(uv ? [
    bool('uvOn', 'Custom UVs', false),
    num('tileU', 'Tile U', uv === 'length' ? 2 : 1, off('uvOn')),
    num('tileV', 'Tile V', 1, off('uvOn')),
    num('offsetU', 'Offset U', 0, { abs: 1, ...off('uvOn') }),
    num('offsetV', 'Offset V', 0, { abs: 1, ...off('uvOn') }),
    bool('flipU', 'Flip U', false, { when: 'uvOn' }),
    bool('flipV', 'Flip V', false, { when: 'uvOn' }),
    ...(uv === 'length' ? [
      bool('absLength', 'Repeat by distance', true, { when: 'uvOn' }),
      num('lengthV', 'Repeat every', 60, { unit: 'cm', min: 0.1, ...off('uvOn') }),
    ] : []),
  ] : []),
  bool('tintOn', 'Color variation', false),
  col('tintColor', 'Vary toward', '#b9cf7a', { when: 'tintOn' }),
  num('tintAmount', 'Amount %', 100, { min: 0, max: 100, ...off('tintOn') }),
  bool('gradOn', 'Color along length', false),
  { k: 'gradient', l: 'Gradient', t: 'gradient', d: [[0, '#5a6a40'], [1, '#ffffff']], when: 'gradOn' },
];

// Shaping every path can do by itself, so a plain stem needs no extra nodes.
export const shaping = [
  section('_shape', 'Shape'),
  bool('noiseOn', 'Noise', false, { n: 1 }),
  num('noiseScale', 'Noise scale', 80, { unit: 'cm', min: 0.1, ...off('noiseOn') }),
  num('noiseStrength', 'Noise strength', 15, { unit: 'cm', ...off('noiseOn') }),
  num('noiseRough', 'Noise roughness', 0, { min: 0, max: 1, ...off('noiseOn') }),
  bool('randOn', 'Randomness', false, { n: 1 }),
  num('randSmooth', 'Smoothing', 100, { unit: 'cm', min: 0.1, ...off('randOn') }),
  num('randMin', 'Min angle', 0, { unit: '°', ...off('randOn') }),
  num('randMax', 'Max angle', 25, { unit: '°', ...off('randOn') }),
  bool('pullOn', 'Gravity / light', false, { n: 1 }),
  vec('pullVector', 'Pull toward', [0, 1, 0], { when: 'pullOn', sock: false }),
  num('pullStrength', 'Pull strength', 0.4, off('pullOn')),
];

export const common = [
  int('countRate', 'Count rate %', 100, { min: 0, max: 100, sock: false }),
  int('seedOffset', 'Seed offset', 0, { sock: false }),
];

export const wire = (d) => [
  col('wire', 'Wire color', d, { sock: false }),
  bool('visible', 'Visibility', true, { sock: false }),
];
