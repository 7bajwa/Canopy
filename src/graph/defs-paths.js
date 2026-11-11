// Path, cloud and distributor node definitions.
import { num, int, bool, en, data, vec, common, wire, shaping, section } from './defs-helpers.js';

// What the engine reads for wind. The all-in-one nodes show these on their Wind tab.
const windHidden = [
  num('windPower', 'Sway power', 100, { sock: false, along: 'pos', when: { none: true } }),
  num('windSpeed', 'Sway speed', 100, { sock: false, along: 'pos', when: { none: true } }),
  num('windFlutter', 'Flutter', 0, { sock: false, along: 'pos', when: { none: true } }),
];

// Parameters every distributor shares: how lines leave one point.
const inPoint = (div = 45, bend = 0) => [
  int('count', 'Count', 1, { min: 0, n: 1 }),
  num('countChaos', 'Variation count %', 0, { min: 0, max: 100 }),
  en('layout', 'Type', 'circular', ['circular', 'angular']),
  num('angleDiv', 'Angle divergence', div, { unit: '°', n: 1, c: 1 }),
  num('divChaos', 'Variation divergence', 0, { unit: '°' }),
  num('alignParent', 'Align to parent %', 100, { min: 0, max: 100, n: 1, sock: false, hint: 'At 100 every line lies the same way round its parent. Lower values turn each line by a random amount.' }),
  bool('moreSpread', 'Show more spread settings', false),
  num('angleBend', 'Angle bend', bend, { unit: '°', c: 1, when: 'moreSpread' }),
  num('bendChaos', 'Variation bend', 0, { unit: '°', when: 'moreSpread' }),
  num('offset', 'Offset', 0, { unit: 'cm', when: 'moreSpread' }),
  num('offsetChaos', 'Variation offset', 0, { unit: 'cm', when: 'moreSpread' }),
  num('axisAngle', 'Start vector: axis angle', 0, { unit: '°', when: 'moreSpread' }),
  num('axisChaos', 'Start vector: axis variation', 0, { unit: '°', when: 'moreSpread' }),
  num('startBend', 'Start vector: bend', 0, { unit: '°', when: 'moreSpread' }),
  num('randMin', 'Random angle: min', 0, { unit: '°', when: 'moreSpread' }),
  num('randMax', 'Random angle: max', 0, { unit: '°', when: 'moreSpread' }),
];

const distOuts = [
  { k: 'angleDiv', l: 'Angle div' }, { k: 'angleBend', l: 'Angle bend' },
  { k: 'offset', l: 'Offset' }, { k: 'distance', l: 'Distance' },
];

const pathOuts = [
  { k: 'dir', kind: 'dir', side: 'bottom', x: 0.2, l: 'Directions' },
  { k: 'mesh', kind: 'mesh', side: 'bottom', x: 0.5, l: 'Mesh' },
  { k: 'after', kind: 'dir', side: 'bottom', x: 0.8, l: 'After mesh' },
  { k: 'children', kind: 'dist', side: 'right', l: 'Children' },
];

const radiusGen = [
  num('minRadius', 'Min radius', 0.6, { unit: 'cm', min: 0.01 }),
  num('growRadius', 'Increase radius %', 60, { min: 0 }),
  en('growMode', 'Increase', 'linear', ['linear', 'exponential']),
  num('parentGrow', 'Increase parent radius %', 100, { min: 0 }),
  num('maxRadius', 'Max radius', 40, { unit: 'cm', min: 0.01 }),
];

const lineOuts = [{ k: 'length', l: 'Length' }, { k: 'level', l: 'Level' }, { k: 'radius', l: 'Radius' }];

const positionParams = [
  num('position', 'Position %', 100, { min: 0, n: 1 }),
  bool('abs', 'Absolute position', false),
  num('chaos', 'Variation position %', 0, { min: 0, max: 100 }),
  num('axis', 'Angle axis', 0, { unit: '°', n: 1 }),
  num('bend', 'Angle bend', 0, { unit: '°', n: 1 }),
  num('lengthPct', 'Length %', 100, { min: 0 }),
];

const spawnOut = [{ k: 'out', kind: 'spawn', side: 'bottom' }];
const parentIn = { k: 'parent', kind: 'dist', side: 'top', multi: true };

export const pathDefs = [
  {
    type: 'Path', title: 'Path (classic)', cat: 'path',
    desc: 'Grows one line per start point. Modifiers bend it, builders wrap it in a mesh, child distributors grow from it.',
    in: [{ k: 'in', kind: 'spawn', side: 'top', multi: true }],
    out: pathOuts, values: [{ k: 'angle', l: 'Angle' }, { k: 'length', l: 'Length' }],
    params: [
      num('length', 'Length path', 300, { unit: 'cm', min: 0.1, n: 1, c: 1, along: 'pos' }),
      num('chaos', 'Variation %', 0, { min: 0, max: 100, n: 1 }),
      num('steps', 'Steps', 25, { unit: 'cm', min: 0.05, n: 1, c: 1 }),
      ...shaping,
      section('_more', 'More'),
      ...common, ...wire('#35d07f'),
      ...windHidden,
    ],
  },
  {
    type: 'DrawPath', title: 'Draw path', cat: 'path',
    desc: 'Lines you draw by hand over a parent path. Use the Draw tool in the properties panel.',
    in: [{ k: 'parent', kind: 'dist', side: 'left', l: 'Parent path' }],
    out: pathOuts, values: [{ k: 'pathPos', l: 'Path position' }, { k: 'length', l: 'Length' }],
    tool: 'draw',
    params: [
      num('length', 'Length path', 200, { unit: 'cm', min: 0.1, n: 1 }),
      bool('capToDrawing', 'Length < drawing length', true),
      num('offset', 'Offset', 0, { unit: 'cm' }),
      data('strokes', []), ...wire('#ffd04d'),
    ],
  },
  {
    type: 'DrawSurf', title: 'Draw on surface', cat: 'path',
    desc: 'Lines you draw by hand that crawl over a scene object.',
    in: [{ k: 'object', kind: 'object', side: 'left', l: 'Object' }],
    out: pathOuts, values: [{ k: 'length', l: 'Length' }],
    tool: 'draw',
    params: [
      num('length', 'Length path', 200, { unit: 'cm', min: 0.1, n: 1 }),
      bool('capToDrawing', 'Length < drawing length', true),
      num('lift', 'Distance above surface', 2, { unit: 'cm' }),
      data('strokes', []), ...wire('#ffd04d'),
    ],
  },
  {
    type: 'SpaceColonization', title: 'Space colonization', cat: 'path',
    desc: 'Grows a branching skeleton toward attractor points supplied by clouds, consuming them as it reaches them.',
    in: [
      { k: 'in', kind: 'spawn', side: 'top', multi: true },
      { k: 'clouds', kind: 'cloud', side: 'left', multi: true, l: 'Clouds' },
    ],
    out: pathOuts, values: lineOuts,
    params: [
      num('fullLength', 'Full length', 1500, { unit: 'cm', min: 1, n: 1 }),
      num('step', 'Segment step', 14, { unit: 'cm', min: 0.5, n: 1 }),
      bool('adaptive', 'Adaptive steps', false),
      num('minStep', 'Min step', 5, { unit: 'cm', min: 0.1 }),
      int('iterations', 'Max iterations', 200, { min: 1, max: 2000 }),
      num('minDist', 'Min distance', 18, { unit: 'cm', min: 0.1, n: 1 }),
      num('maxDist', 'Max distance', 140, { unit: 'cm', min: 1, n: 1 }),
      num('cone', 'Angle threshold', 120, { unit: '°', min: 1, max: 180 }),
      num('randomness', 'Randomness %', 12, { min: 0, max: 100 }),
      num('light', 'Light influence %', 10, { min: 0, max: 100 }),
      num('gravity', 'Gravity influence %', 0, { min: 0, max: 100 }),
      ...radiusGen, ...wire('#35d07f'),
    ],
  },
  {
    type: 'UnifiedSkeleton', title: 'Unified skeleton', cat: 'path',
    desc: 'Merges the lines of connected paths into one skeleton with shared radii, thickening parents from their children.',
    in: [{ k: 'in', kind: 'mesh', side: 'top', multi: true }],
    out: pathOuts, values: lineOuts,
    params: [...radiusGen, ...wire('#35d07f')],
  },
];

export const cloudDefs = [
  ['SphereCloud', 'Sphere cloud', 'Attractor points filling a sphere or ellipsoid.', [
    num('radius', 'Radius', 300, { unit: 'cm', min: 1, n: 1 }),
    num('zScale', 'Height scale', 1, { min: 0.05, n: 1 }),
    num('bottomSlice', 'Bottom slice %', 25, { min: 0, max: 95 }),
  ], []],
  ['BoxCloud', 'Box cloud', 'Attractor points filling a box.', [
    num('sx', 'Length (X)', 500, { unit: 'cm', min: 1, n: 1 }),
    num('sy', 'Height', 400, { unit: 'cm', min: 1, n: 1 }),
    num('sz', 'Width (Z)', 500, { unit: 'cm', min: 1, n: 1 }),
  ], []],
  ['MeshCloud', 'Object cloud', 'Attractor points filling the inside of a scene object.', [],
    [{ k: 'object', kind: 'object', side: 'left', l: 'Object' }]],
  ['PathCloud', 'Path cloud', 'Attractor points around the lines of a parent path.', [
    num('spread', 'Spread radius', 40, { unit: 'cm', min: 0, n: 1 }),
  ], [{ k: 'parent', kind: 'dist', side: 'left', l: 'Parent path' }]],
].map(([type, title, desc, params, inputs]) => ({
  type, title, desc, cat: 'cloud', in: inputs, out: [{ k: 'out', kind: 'cloud', side: 'right', l: 'Cloud' }],
  params: [
    en('algo', 'Algorithm', 'poisson', ['poisson', 'hcp', 'fcc', 'cubic', 'one'], { n: 1 }),
    num('density', 'Point spacing', 40, { min: 1, unit: 'cm', n: 1 }),
    num('randomize', 'Randomize', 0.3, { min: 0, max: 1 }),
    bool('overrideDist', 'Override min / max distance', false),
    num('minDist', 'Min dist', 18, { unit: 'cm' }),
    num('maxDist', 'Max dist', 140, { unit: 'cm' }),
    vec('center', 'Center', [0, 500, 0], { sock: false }),
    bool('display', 'Display in viewport', true),
    ...params,
  ],
}));

export const distDefs = [
  {
    type: 'Distributor', title: 'Distributor', cat: 'dist',
    desc: 'The plant\'s origin: places start points from a single location.',
    out: spawnOut, values: distOuts,
    params: [vec('origin', 'Origin', [0, 0, 0], { sock: false }), ...inPoint(0), ...common],
  },
  {
    type: 'PointDistributor', title: 'Point distributor', cat: 'dist',
    desc: 'Starts lines from a list of points. Add a point per row in the properties panel.',
    out: spawnOut, values: distOuts,
    params: [{ k: 'points', l: 'Points', t: 'points', d: [[0, 0, 0]] }, ...inPoint(0), ...common],
  },
  {
    type: 'PathDistributor', title: 'Path distributor', cat: 'dist',
    desc: 'Grows lines along a parent path, like branches along a trunk.',
    in: [parentIn], out: spawnOut,
    values: [{ k: 'level', l: 'Level' }, { k: 'pathPos', l: 'Path position' }, ...distOuts],
    params: [
      int('levels', 'Levels', 1, { min: 1, max: 5, n: 1 }),
      num('density', 'Density', 8, { min: 0, n: 1, c: 1, hint: 'Lines per reference length' }),
      num('densityChaos', 'Variation density %', 20, { min: 0, max: 100 }),
      num('turn', 'Turn axis', 137.5, { unit: '°', n: 1 }),
      num('start', 'Start', 15, { unit: '%', min: 0, n: 1 }),
      bool('startAbs', 'Start absolute (cm)', false),
      num('end', 'End', 100, { unit: '%', min: 0, n: 1 }),
      bool('endAbs', 'End absolute (cm)', false),
      bool('instant', 'Start instantly', true),
      bool('lastLevel', 'Use last level', false),
      ...inPoint(50), ...common,
    ],
  },
  {
    type: 'PathPosDistributor', title: 'Path position distributor', cat: 'dist',
    desc: 'Grows lines at exact positions along a parent path. Connect Path position nodes.',
    in: [parentIn, { k: 'positions', kind: 'pos', side: 'left', multi: true, l: 'Positions' }],
    out: spawnOut,
    values: [{ k: 'level', l: 'Level' }, { k: 'pathPos', l: 'Path position' }, ...distOuts],
    params: [
      int('levels', 'Levels', 1, { min: 1, max: 5, n: 1 }),
      bool('lastLevel', 'Use last level', false),
      ...inPoint(50), ...common,
    ],
  },
  {
    type: 'PathPosition', title: 'Path position', cat: 'dist',
    desc: 'One position for a Path position distributor.',
    out: [{ k: 'out', kind: 'pos', side: 'right', l: 'Position' }],
    params: positionParams,
  },
  {
    type: 'SimplePathPos', title: 'Simple path position', cat: 'dist',
    desc: 'One position on the parent that connects straight to a child path.',
    in: [parentIn], out: spawnOut,
    params: [...positionParams, bool('lastLevel', 'Use last level', false)],
  },
  {
    type: 'SurfaceDistributor', title: 'Surface distributor', cat: 'dist',
    desc: 'Starts lines from the surface of a scene object, along its normals.',
    in: [{ k: 'object', kind: 'object', side: 'left', l: 'Object' }],
    out: spawnOut,
    values: [{ k: 'surfaceLevel', l: 'Surface level' }, ...distOuts],
    params: [
      en('mode', 'Path formation', 'even', ['even', 'random', 'edges', 'vertices'], { n: 1 }),
      num('density', 'Density', 2, { min: 0, n: 1, c: 1, hint: 'Lines per reference area' }),
      ...inPoint(0), ...common,
    ],
  },
];
