// Every node type the editor knows: its sockets, parameters and look.
// The engine and the UI both read this table, so a node is defined in one place.
import { num, int, bool, en, col, crv, vec } from './defs-helpers.js';
import { pathDefs, cloudDefs, distDefs } from './defs-paths.js';
import { modDefs } from './defs-mods.js';
import { meshDefs, compDefs, leafDefs } from './defs-mesh.js';
import { unifiedDefs, hasTabs, TABS, SHAPE_MODS, SURFACE_MODS, newMod } from './defs-unified.js';

export { hasTabs, TABS, SHAPE_MODS, SURFACE_MODS, newMod };

export const KIND = {
  parent: '#7fc241', spawn: '#e8604a', dist: '#d0413f', dir: '#35b3a0', mesh: '#7fc241', comp: '#b5d65a',
  value: '#e8c13f', curve: '#de4dbb', cloud: '#62aeea', object: '#a78af0', shape: '#f2913f',
  element: '#c6cf52', pos: '#ea88a8',
};

export const CATS = {
  plant: { label: 'Plant', color: '#3f7a2c' },
  path: { label: 'Paths', color: '#1f6b5a' },
  cloud: { label: 'Space clouds', color: '#2d6a96' },
  dist: { label: 'Distributors', color: '#a33b35' },
  mod: { label: 'Direction modifiers', color: '#2c5f8a' },
  mesh: { label: 'Mesh builders', color: '#4a8610' },
  comp: { label: 'Mesh components', color: '#6d7f24' },
  leaf: { label: 'Leaf atlas', color: '#b8651b' },
  value: { label: 'Values', color: '#8f6a14' },
  switch: { label: 'Switches', color: '#74408f' },
  scene: { label: 'Scene', color: '#54458f' },
};

const valueDefs = [
  {
    type: 'Affect', title: 'Affect', cat: 'value',
    desc: 'Multiplies a parameter by a factor read from another value through a curve.',
    in: [
      { k: 'p:input', kind: 'value', side: 'left', l: 'Input' },
      { k: 'c:factor', kind: 'curve', side: 'right', l: 'Factor curve' },
    ],
    values: [{ k: 'result', l: 'Result' }],
    params: [
      num('min', 'Min', 0, { n: 1, sock: false }), num('max', 'Max', 100, { n: 1, sock: false }),
      en('posMode', 'Path pos', 'local', ['local', 'chain']),
      num('factor', 'Factor', 1, { n: 1, sock: false }),
      num('chaos', 'Variation %', 0, { min: 0, max: 100, sock: false }),
    ],
  },
  {
    type: 'Public', title: 'Public parameter', cat: 'value',
    desc: 'Puts a value in the Public panel so a plant can be tuned without opening the graph.',
    values: [{ k: 'value', l: 'Value' }],
    params: [
      en('kind', 'Type', 'float', ['caption', 'boolean', 'integer', 'float'], { n: 1 }),
      num('value', 'Value', 1, { n: 1, sock: false }),
      bool('show', 'Show in panel', true),
      bool('clamp', 'Clamp', false),
      num('min', 'Min value', 0, { sock: false }), num('max', 'Max value', 100, { sock: false }),
      int('order', 'Panel order', 0, { sock: false }),
    ],
  },
  {
    type: 'Value', title: 'Value', cat: 'value',
    desc: 'A fixed number you can wire to many parameters at once.',
    values: [{ k: 'value', l: 'Value' }],
    params: [en('kind', 'Type', 'float', ['integer', 'float']), num('value', 'Value', 1, { n: 1, sock: false })],
  },
  {
    type: 'Random', title: 'Random generator', cat: 'value',
    desc: 'A random number within limits, different for each line.',
    values: [{ k: 'value', l: 'Value' }],
    params: [en('kind', 'Type', 'float', ['integer', 'float']), num('min', 'Min value', 0, { n: 1, sock: false }), num('max', 'Max value', 1, { n: 1, sock: false })],
  },
  {
    type: 'Math', title: 'Math operation', cat: 'value',
    desc: 'Combines two values. Math nodes can be chained.',
    values: [{ k: 'value', l: 'Result' }],
    params: [
      en('kind', 'Type', 'float', ['integer', 'float']),
      en('op', 'Operation', 'mul', ['add', 'sub', 'mul', 'div', 'pow', 'mix', 'min', 'max'], { n: 1 }),
      num('a', 'Input A', 1, { n: 1 }), num('b', 'Input B', 1, { n: 1 }),
      num('t', 'Blend', 0.5, { n: 1, min: 0, max: 1, hint: 'For Mix: 0 gives A, 1 gives B, between blends them.' }),
    ],
  },
  {
    type: 'Mix', title: 'Blend', cat: 'value',
    desc: 'Blends two values with a math operation. Blend 0 gives A; 1 gives the full result. Each value has its own variation and curve.',
    values: [{ k: 'value', l: 'Result' }],
    params: [
      en('op', 'Operation', 'add', ['add', 'sub', 'mul', 'div', 'pow', 'min', 'max', 'mod', 'avg', 'diff', 'mix'], { n: 1 }),
      num('a', 'A', 1, { n: 1, vc: true }), num('b', 'B', 1, { n: 1, vc: true }),
      num('t', 'Blend', 1, { n: 1, min: 0, max: 1, vc: true }),
    ],
  },
  {
    type: 'Curve', title: 'Curve', cat: 'value',
    desc: 'A shape along the line (or over an Affect range). As Factor it multiplies the parameter; as Value it replaces it.',
    out: [{ k: 'out', kind: 'curve', side: 'right', l: 'Curve' }],
    params: [
      crv('curve', 'Curve', { pts: [[0, 1, 's'], [1, 0.12, 's']] }, { n: 1 }),
      en('mode', 'Use as', 'factor', ['factor', 'value'], { n: 1 }),
      num('scale', 'Scale factor', 1, { n: 1, sock: false }),
      int('repeat', 'Repeat', 1, { min: 1, max: 32, sock: false }),
    ],
  },
  ...[
    ['AttributePosition', 'Attribute position', 'The position of a point on each line as a number.', [
      en('at', 'Calculate for', 'start', ['start', 'nearest', 'mid', 'far', 'end'], { n: 1 }),
      en('axis', 'Type', 'height', ['x', 'height', 'z', 'radiusFromAxis'], { n: 1 }),
    ], []],
    ['AttributeDistance', 'Attribute distance', 'Distance from a point on each line to a target.', [
      en('at', 'Calculate for', 'start', ['start', 'nearest', 'mid', 'far', 'end'], { n: 1 }),
      en('target', 'Type', 'point', ['point', 'object'], { n: 1 }),
      vec('point', 'Target point', [0, 0, 0], { sock: false }),
    ], [{ k: 'object', kind: 'object', side: 'left', l: 'Object' }]],
    ['AttributeIDs', 'Attribute IDs', 'The line\'s number, its parent\'s number, or its level.', [
      en('kind', 'Type', 'level', ['line', 'parent', 'level'], { n: 1 }),
    ], []],
  ].map(([type, title, desc, params, inputs]) => ({
    type, title, desc, cat: 'value', in: inputs, values: [{ k: 'value', l: 'Result' }], params,
  })),
];

const switchDefs = [
  ['SwitchPaths', 'Switch: paths', 'spawn', 'Picks a different path per generated line, for example to vary branch types at random.'],
  ['SwitchDistributors', 'Switch: distributors', 'dist', 'Chooses which child distributors are active.'],
  ['SwitchModifiers', 'Switch: modifiers', 'dir', 'Chooses a branch of the modifier chain.'],
  ['SwitchMeshes', 'Switch: meshes', 'mesh', 'Chooses which mesh builder is used, for example low or high quality.'],
].map(([type, title, kind, desc]) => ({
  type, title, desc, cat: 'switch', switchKind: kind,
  in: [{ k: 'in', kind, side: kind === 'dist' ? 'left' : 'top', multi: kind === 'spawn' }],
  params: [num('value', 'Input value', 1, { n: 1 }), int('outs', 'Outputs', 2, { min: 2, max: 8, n: 1, sock: false })],
}));

const sceneDefs = [
  {
    type: 'GroundPatch', title: 'Ground patch', cat: 'scene',
    desc: 'A flat piece of ground for plants to grow from: a round disk, a square, or an imported mesh. Connect it to a Surface distributor.',
    out: [{ k: 'out', kind: 'object', side: 'right', l: 'Object' }],
    params: [
      en('shape', 'Shape', 'disk', ['disk', 'square', 'imported'], { n: 1 }),
      num('radius', 'Radius', 150, { unit: 'cm', min: 0.1, n: 1, sock: false }),
      vec('pos', 'Position', [0, 0, 0], { sock: false }),
      num('sizeX', 'Size X %', 100, { min: 0.1, sock: false }),
      num('sizeZ', 'Size Z %', 100, { min: 0.1, sock: false }),
      { k: 'obj', l: 'OBJ file', t: 'obj', d: null, when: 'imported' },
      bool('display', 'Display in viewport', false),
      col('color', 'Viewport color', '#7a5a3a'),
    ],
  },
  {
    type: 'SceneObject', title: 'Scene object', cat: 'scene',
    desc: 'A shape to grow on, react to or slice with: a built-in primitive or an imported OBJ file.',
    out: [{ k: 'out', kind: 'object', side: 'right', l: 'Object' }],
    params: [
      en('shape', 'Shape', 'sphere', ['sphere', 'box', 'plane', 'imported'], { n: 1 }),
      { k: 'obj', l: 'OBJ file', t: 'obj', d: null },
      vec('pos', 'Position', [0, 150, 0], { sock: false }),
      vec('size', 'Size', [150, 150, 150], { sock: false }),
      bool('display', 'Display in viewport', true),
      col('color', 'Viewport color', '#a78af0'),
    ],
  },
];

export const NODE_TYPES = Object.fromEntries(
  [...unifiedDefs, ...pathDefs, ...cloudDefs, ...distDefs, ...modDefs, ...meshDefs, ...compDefs, ...leafDefs, ...valueDefs, ...switchDefs, ...sceneDefs].map((d) => {
    d.in ||= [];
    d.out ||= [];
    d.values ||= [];
    for (const p of d.params) if (p.t === 'num' && p.sock !== false) p.sock = true;
    return [d.type, d];
  }),
);

export const clone = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));

export function defaultParams(type) {
  return Object.fromEntries(NODE_TYPES[type].params.map((p) => [p.k, clone(p.d)]));
}

// All sockets on a node. Value and curve sockets belong to parameter rows.
export function socketsOf(node) {
  const def = NODE_TYPES[node.type];
  const inputs = def.in.map((s) => ({ ...s, dir: 'in' }));
  const outputs = def.out.map((s) => ({ ...s, dir: 'out' }));
  // Any number can be exposed from its menu: an input to drive it and an output to pass it on.
  const exposed = node.exposed || [];
  for (const p of def.params) {
    if (p.sock || exposed.includes(p.k)) inputs.push({ k: `p:${p.k}`, kind: 'value', side: 'left', param: p.k, dir: 'in' });
    if (exposed.includes(p.k)) outputs.push({ k: `o:${p.k}`, kind: 'value', side: 'right', param: p.k, dir: 'out', outValue: true });
    if (p.c) inputs.push({ k: `c:${p.k}`, kind: 'curve', side: 'right', param: p.k, dir: 'in' });
  }
  for (const v of def.values) outputs.push({ k: v.k, kind: 'value', side: 'right', l: v.l, dir: 'out', outValue: true });
  if (def.switchKind) {
    const n = Math.round(node.params.outs) || 2;
    for (let i = 1; i <= n; i++) {
      const bottom = def.switchKind !== 'dist';
      outputs.push({ k: `out${i}`, kind: def.switchKind, side: bottom ? 'bottom' : 'right', x: i / (n + 1), l: `${i}`, dir: 'out' });
    }
  }
  return { inputs, outputs };
}

// A parameter with `when` only shows while it applies: a switch being on, a ground patch's file row
// following its shape, or an object naming the values other settings must have.
export function shown(p, params) {
  const w = p.when;
  if (!w) return true;
  if (typeof w === 'string') return w === 'imported' ? params.shape === 'imported' : !!params[w];
  for (const [k, want] of Object.entries(w)) {
    const have = params[k];
    // A switch set such as 'tube+leaf' (the mesh types) matches each of its parts, and itself.
    const is = (v) => have === v || (typeof have === 'string' && have.includes('+') && have.split('+').includes(v));
    if (Array.isArray(want) ? !want.some(is) : want === true ? !have : !is(want)) return false;
  }
  return true;
}

export const kindFits = (kind, inSock) => kind === inSock.kind || !!inSock.also?.includes(kind);

export function canLink(fromSock, toSock) {
  return fromSock.dir === 'out' && toSock.dir === 'in' && kindFits(fromSock.kind, toSock);
}
