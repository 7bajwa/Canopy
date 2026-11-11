// Mesh builder, mesh component and leaf atlas node definitions.
import { num, int, bool, en, col, crv, data, section, surface } from './defs-helpers.js';

const TAPER = { pts: [[0, 1, 's'], [1, 0.12, 's']] };
const BELL = { pts: [[0, 0.05, 's'], [0.3, 0.9, 's'], [0.55, 1, 's'], [1, 0.02, 's']] };

const meshIn = { k: 'in', kind: 'mesh', side: 'top' };
const compOut = [{ k: 'comp', kind: 'comp', side: 'bottom', l: 'Components' }];
const shapeIn = { k: 'shape', kind: 'shape', side: 'left', l: 'Atlas shape' };
const compIO = { in: [{ k: 'in', kind: 'comp', side: 'top' }], out: [{ k: 'out', kind: 'comp', side: 'bottom' }] };
const caps = ['none', 'planar', 'spherical'];

const vcShared = [
  en('blendMode', 'Blend mode', 'normal', ['normal', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'lighten', 'screen', 'colorDodge', 'linearDodge', 'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'difference', 'exclusion']),
  num('weight', 'Weight %', 100, { min: 0, max: 100, c: 1 }),
];

const leafSurface = [
  bool('flip', 'Flip normals', false),
  bool('twoSided', '2-sided leaves (for games)', false),
  num('softNormals', 'Soft canopy normals', 0.35, { min: 0, max: 1 }),
];

const blendSettings = [
  section('_blend', 'Joint'),
  bool('blend', 'Branch blend', true, { n: 1 }),
  num('blendLength', 'Fillet length', 1.6, { min: 0, max: 8, sock: false, when: 'blend', hint: 'In branch radii' }),
  num('blendFlare', 'Flare', 0.8, { min: 0, max: 4, sock: false, when: 'blend', hint: 'How far the base spreads over the parent, in branch radii' }),
  num('blendTension', 'Smoothness', 0.85, { min: 0, max: 1, sock: false, when: 'blend' }),
  num('blendCollar', 'Parent collar', 0.35, { min: 0, max: 2, sock: false, when: 'blend', hint: 'How much the parent swells around the joint, in branch radii' }),
  num('blendSink', 'Sink into parent %', 1, { min: 0, max: 40, sock: false, when: 'blend' }),
  int('blendRings', 'Quality (rings)', 4, { min: 2, max: 10, sock: false, when: 'blend' }),
  num('blendShade', 'Normal blend', 1, { min: 0, max: 1, sock: false, when: 'blend' }),
  bool('blendTexture', 'Bark cross-fade', true, { when: 'blend' }),
  num('blendMinRatio', 'Skip twigs under', 0.06, { min: 0, max: 1, sock: false, when: 'blend', hint: 'Branches thinner than this share of the parent skip the fillet to save triangles' }),
];

export const meshDefs = [
  {
    type: 'CylinderMesh', title: 'Cylinder mesh', cat: 'mesh',
    desc: 'Wraps lines in a round mesh for trunks, branches and stems, welded smoothly into the parent. Color, texture, UVs and the joint are all set here.',
    in: [meshIn], out: compOut, values: [{ k: 'radius', l: 'Radius' }],
    params: [
      num('radius', 'Radius', 12, { unit: 'cm', min: 0.01, n: 1, c: 1 }),
      int('sides', 'Sides', 10, { min: 3, max: 64, n: 1, c: 1 }),
      num('minRadius', 'Min radius', 0.2, { unit: 'cm', min: 0 }),
      int('minSides', 'Min sides', 4, { min: 3, max: 32 }),
      bool('autoRadius', 'Auto radius', false, { n: 1 }),
      num('autoFactor', 'Auto radius factor', 0.65, { min: 0.05, max: 1, when: 'autoRadius' }),
      bool('underParent', 'Radius < parent radius', true),
      crv('taper', 'Taper (no radius curve)', TAPER),
      ...blendSettings,
      ...surface({ texture: 'bark:brown', uv: 'length' }),
      section('_detail', 'Detail'),
      bool('optimize', 'Optimize faces', false),
      num('faceSize', 'Face size', 8, { unit: 'cm', min: 0.1, when: 'optimize' }),
      bool('overrideSteps', 'Override steps', false),
      num('stepSize', 'Steps', 20, { unit: 'cm', min: 0.1, when: 'overrideSteps' }),
      en('capStart', 'Cap start', 'none', caps),
      en('capEnd', 'Cap end', 'spherical', caps),
      num('radialOffset', 'Radial offset', 0, { unit: 'cm', c: 1 }),
      num('scaleOffset', 'Scale offset', 1, { min: 0, c: 1 }),
    ],
  },
  {
    type: 'MetaMesh', title: 'Meta mesh', cat: 'mesh',
    desc: 'Melts lines with the same Meta ID into one continuous surface. Slower than a cylinder mesh, but fully welded.',
    in: [meshIn], out: compOut, values: [{ k: 'radius', l: 'Radius' }],
    params: [
      num('radius', 'Radius', 12, { unit: 'cm', min: 0.01, n: 1, c: 1 }),
      num('minRadius', 'Min radius', 0.5, { unit: 'cm', min: 0 }),
      bool('autoRadius', 'Auto radius', false),
      num('autoFactor', 'Auto radius factor', 0.65, { min: 0.05, max: 1, when: 'autoRadius' }),
      bool('underParent', 'Radius < parent radius', true),
      crv('taper', 'Taper (no radius curve)', TAPER),
      int('metaId', 'Meta ID', 0, { n: 1 }),
      num('faceSize', 'Face size', 4, { unit: 'cm', min: 0.2, n: 1 }),
      en('operation', 'Operation', 'plus', ['plus', 'minus']),
      num('weight', 'Meta weight', 1, { min: 0, max: 5, n: 1 }),
      ...surface({ texture: 'bark:brown', uv: null }),
    ],
  },
  {
    type: 'LeavesMesh', title: 'Leaves mesh', cat: 'mesh',
    desc: 'Builds a leaf along each line, with a bendable fold. Load a texture here, or connect a Leaf cutout to fit it to an atlas shape.',
    in: [meshIn, shapeIn], out: compOut,
    params: [
      num('angleAcross', 'Angle across', 12, { unit: '°', n: 1 }),
      num('angleAlong', 'Angle along', 0, { unit: '°' }),
      num('angleAxis', 'Angle axis', 0, { unit: '°', c: 1 }),
      int('sideSteps', 'Sides', 1, { min: 1, max: 8, n: 1 }),
      num('width', 'Width', 8, { unit: 'cm', min: 0.01, n: 1, c: 1 }),
      num('shapeScale', 'Atlas shape width scale', 1, { min: 0.05, max: 4 }),
      bool('proportional', 'Scale proportionally', false),
      num('incAcross', 'Incremental across', 6, { unit: '°', c: 1 }),
      num('incAlong', 'Incremental along', 0, { unit: '°' }),
      num('leafTwist', 'Twist', 0, { unit: '°' }),
      num('incScale', 'Scale angle', 1),
      crv('outline', 'Outline (no atlas shape)', BELL),
      ...surface(),
      section('_detail', 'Detail'),
      bool('optimize', 'Optimize faces', false),
      num('faceSize', 'Face size', 6, { unit: 'cm', min: 0.1, when: 'optimize' }),
      bool('overrideSteps', 'Override steps', false),
      num('stepSize', 'Steps', 4, { unit: 'cm', min: 0.1, when: 'overrideSteps' }),
      bool('noCenter', 'Without central edges', false),
      ...leafSurface,
    ],
  },
  {
    type: 'StandardLeaves', title: 'Standard leaves', cat: 'mesh',
    desc: 'Fast flat leaves placed on lines. Connect a Leaf cutout to use its optimised outline.',
    in: [meshIn, shapeIn], out: compOut,
    params: [
      num('size', 'Size', 10, { unit: 'cm', min: 0.01, n: 1, c: 1 }),
      num('ratio', 'Length / width', 2, { min: 0.05, n: 1 }),
      num('position', 'Position %', 100, { min: 0, max: 100, n: 1 }),
      en('leafType', 'Leaf type', 'diamond', ['rectangle', 'diamond', 'hexagon', 'octagon'], { n: 1 }),
      ...surface(),
      section('_detail', 'Detail'),
      ...leafSurface,
    ],
  },
  {
    type: 'InstancedGeometry', title: 'Instanced geometry', cat: 'mesh',
    desc: 'Places copies of imported or built-in objects along lines (fruit, flowers, thorns).',
    in: [meshIn, { k: 'elements', kind: 'element', side: 'left', multi: true, l: 'Elements' }],
    out: compOut,
    params: [
      num('position', 'Position %', 100, { min: 0, max: 100, n: 1 }),
      num('scale', 'Scale %', 100, { min: 0, n: 1, c: 1 }),
      num('randomScale', 'Random scale %', 20, { min: 0, max: 100 }),
      ...surface({ uv: null }),
    ],
  },
];

export const compDefs = [
  {
    type: 'BranchBlend', title: 'Branch blend', cat: 'comp', ...compIO,
    desc: 'Welds each branch into its parent: the base hugs the parent\'s surface, a smooth fillet replaces the hard crease, the parent swells into a collar, and shading and bark cross-fade across the joint.',
    params: [
      bool('enabled', 'Enable', true, { n: 1 }),
      num('length', 'Fillet length', 1.6, { min: 0, max: 8, n: 1, hint: 'In branch radii' }),
      num('flare', 'Flare', 0.8, { min: 0, max: 4, n: 1, hint: 'How far the base spreads over the parent, in branch radii' }),
      num('tension', 'Smoothness', 0.85, { min: 0, max: 1, n: 1 }),
      num('collar', 'Parent collar', 0.35, { min: 0, max: 2, n: 1, hint: 'How much the parent swells around the joint, in branch radii' }),
      num('sink', 'Sink into parent %', 1, { min: 0, max: 40 }),
      int('rings', 'Quality (rings)', 4, { min: 2, max: 10, n: 1 }),
      num('shade', 'Normal blend', 1, { min: 0, max: 1 }),
      bool('textureBlend', 'Bark cross-fade', true),
      num('minRatio', 'Skip twigs under', 0.06, { min: 0, max: 1, hint: 'Branches thinner than this share of the parent skip the fillet to save triangles' }),
    ],
  },
  {
    type: 'Material', title: 'Surface material', cat: 'comp', ...compIO,
    desc: 'Color, roughness and texture of the mesh it is connected to.',
    params: [
      col('color', 'Color', '#ffffff', { n: 1 }),
      num('roughness', 'Roughness', 0.9, { min: 0, max: 1, n: 1, sock: false }),
      { k: 'texture', l: 'Texture', t: 'texture', d: 'bark:brown', n: 1 },
    ],
  },
  {
    type: 'UVWMapping', title: 'UVW mapping', cat: 'comp', ...compIO,
    desc: 'How the texture wraps around and along the mesh.',
    params: [
      bool('absWidth', 'Absolute width', false),
      num('width', 'Width', 40, { unit: 'cm', min: 0.1 }),
      num('tileU', 'Tile U', 2, { n: 1 }),
      bool('flipU', 'Flip U', false),
      num('offsetU', 'Offset U', 0),
      bool('absLength', 'Absolute length', true),
      num('lengthV', 'Length', 60, { unit: 'cm', min: 0.1, n: 1 }),
      num('tileV', 'Tile V', 1),
      bool('flipV', 'Flip V', false),
      num('offsetV', 'Offset V', 0),
      bool('scaleByRadius', 'Scale length by radius', false),
    ],
  },
  {
    type: 'UVWCustom', title: 'UVW custom', cat: 'comp', ...compIO,
    desc: 'Scales and shifts instanced object UVs.',
    params: [num('su', 'Scale U', 1), num('sv', 'Scale V', 1), num('ou', 'Offset U', 0), num('ov', 'Offset V', 0)],
  },
  {
    type: 'InstancedElement', title: 'Instanced element', cat: 'comp',
    desc: 'One object for Instanced geometry: a built-in shape or an imported OBJ file.',
    out: [{ k: 'out', kind: 'element', side: 'right', l: 'Element' }],
    params: [
      en('shape', 'Shape', 'sphere', ['sphere', 'cone', 'box', 'imported'], { n: 1 }),
      { k: 'obj', l: 'OBJ file', t: 'obj', d: null },
      num('size', 'Size', 6, { unit: 'cm', min: 0.01, n: 1 }),
      col('color', 'Color', '#c8362c', { n: 1 }),
      int('rate', 'Count rate %', 100, { min: 0, max: 100, sock: false }),
    ],
  },
  {
    type: 'ChaosMatID', title: 'Variation material ID', cat: 'comp', ...compIO,
    desc: 'Randomly gives each line one of up to four tints, each with its own rate.',
    params: [
      int('r1', 'Rate 1 %', 50, { min: 0, sock: false }), col('c1', 'Tint 1', '#ffffff'),
      int('r2', 'Rate 2 %', 30, { min: 0, sock: false }), col('c2', 'Tint 2', '#dfe8a8'),
      int('r3', 'Rate 3 %', 20, { min: 0, sock: false }), col('c3', 'Tint 3', '#a8c080'),
      int('r4', 'Rate 4 %', 0, { min: 0, sock: false }), col('c4', 'Tint 4', '#c89060'),
    ],
  },
  {
    type: 'VCMapChannel', title: 'VC map channel', cat: 'comp', ...compIO,
    desc: 'Sends the colors of later nodes to a separate export channel instead of the main one.',
    params: [int('channel', 'Map channel', 1, { min: 0, max: 1, n: 1, sock: false })],
  },
  {
    type: 'VCColorElements', title: 'VC coloring elements', cat: 'comp', ...compIO,
    desc: 'One color per line, blended from main to target by a position.',
    params: [
      ...vcShared,
      col('main', 'Main color', '#ffffff', { n: 1 }), col('target', 'Target color', '#a6c24d', { n: 1 }),
      num('position', 'Position %', 50, { min: 0, max: 100, n: 1, c: 1 }),
      num('posChaos', 'Variation position %', 100, { min: 0, max: 100 }),
    ],
  },
  {
    type: 'VCColorPaths', title: 'VC coloring along paths', cat: 'comp', ...compIO,
    desc: 'A color gradient from the start to the end of each line.',
    params: [...vcShared, { k: 'gradient', l: 'Gradient', t: 'gradient', d: [[0, '#5a4630'], [1, '#c2b280']] }],
  },
  {
    type: 'VCInherit', title: 'VC inherit from parent', cat: 'comp', ...compIO,
    desc: 'Takes the color of the parent line at the point where this line grows from it.',
    params: [...vcShared],
  },
];

export const leafDefs = [
  {
    type: 'LeafCutout', title: 'Leaf cutout', cat: 'leaf',
    desc: 'Finds leaves in an atlas texture from its opacity and fits the tightest low-poly mesh around each one. Connect it to a leaves builder.',
    out: [{ k: 'out', kind: 'shape', side: 'right', l: 'Atlas shape' }],
    tool: 'atlas',
    params: [
      { k: 'atlas', l: 'Atlas', t: 'atlas', d: 'atlas:broadleaf', n: 1 },
      num('threshold', 'Opacity threshold', 0.25, { min: 0.01, max: 0.99, n: 1, sock: false }),
      int('rowsMax', 'Max rows', 7, { min: 2, max: 32, n: 1, sock: false }),
      num('padding', 'Padding px', 2, { min: 0, max: 32, sock: false }),
      int('polyMax', 'Flat outline points', 10, { min: 3, max: 48, sock: false }),
      data('cutouts', []),
    ],
  },
];
