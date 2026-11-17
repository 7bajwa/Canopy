// The all-in-one Spline and Mesh nodes. Each setting says which tab shows it (`tab`) and which
// part of the plant it drives (`to`); engine/expand.js turns these into the engine's building blocks.
// A section with `fold` is a group that starts closed and opens from its heading.
import { num, int, bool, en, col, crv, section } from './defs-helpers.js';
import { WIND_BEND } from '../engine/wind.js';

// `vc` puts the variation and curve icons on a value. `abs` means variation is an amount of its own, for values that often sit at 0.
const nv = (k, l, d, o = {}) => num(k, l, d, { vc: true, sock: false, ...o });
const nb = (k, l, d, o = {}) => num(k, l, d, { sock: false, ...o });

export const TABS = {
  spline: { label: 'Spline', text: 'The line itself: length, segments and its modifiers.' },
  growth: { label: 'Growth', text: 'The tree grows itself, year by year: buds race for light, shaded branches drop, gravity and light steer the shoots, meshes block them. Pick a species, then steer it with the first few settings.' },
  place: { label: 'Placement', text: 'Where lines start: from a point, along a line, in a ring, as an urchin (a ball of lines), or on the parent. Each entity, the tip and the transform open from their headings.' },
  mesh: { label: 'Mesh', text: 'What wraps the line: a tube, leaf blades or cutout leaves.' },
  shape: { label: 'Mesh', text: 'The shape: sphere, rectangle, cone, disk or an imported file, with its transform and modifiers.' },
  material: { label: 'Material', text: 'Which scene material this uses, plus color variation, vertex colors and UVs.' },
  wind: { label: 'Wind', text: 'How this part sways: power, speed and how the bend builds up from its base.' },
};

const tag = (tab, to, list) => list.map((p) => ({ ...p, tab, to: p.to ?? to }));

export const newMod = (id, type, params = {}, o = {}) => ({ id, type, on: true, open: false, params, ...o });

const BASE_MODS = {
  noise: { title: 'Noise', desc: 'Bumps the shape with soft noise.', params: [nb('amp', 'Strength', 0, { unit: 'cm' }), nb('scale', 'Scale', 30, { unit: 'cm', min: 0.1 })] },
  bend: { title: 'Bend', desc: 'Curves the shape around its height.', params: [nb('angle', 'Angle', 45, { unit: '°' }), nb('direction', 'Direction', 0, { unit: '°' })] },
  twist: { title: 'Twist', desc: 'Turns the shape around its height.', params: [nb('angle', 'Angle', 90, { unit: '°' })] },
  taper: { title: 'Taper', desc: 'Narrows the shape toward the top.', params: [nb('amount', 'Amount %', 50, { min: -100, max: 100 })] },
  inflate: { title: 'Inflate', desc: 'Pushes the surface out along its normals.', params: [nb('amount', 'Amount', 2, { unit: 'cm' })] },
  wave: { title: 'Wave', desc: 'Ripples the surface in bands.', params: [nb('amp', 'Strength', 2, { unit: 'cm' }), nb('length', 'Wavelength', 40, { unit: 'cm', min: 0.1 })] },
};

// LOD reduction per LOD, LOD0 (left) to the last LOD (right): eases in like the old fixed steps did. A getter, so
// each new modifier gets its own copy.
const lodAmount = () => nv('amount', 'Reduction %', 80, { min: 0, max: 100, noVary: true, hint: 'How much detail is gone by the last LOD an export makes. The curve sets it per LOD, from LOD0 (left) to the last LOD (right).' });
const lodCurves = { k: 'curves', t: 'data', get d() { return { amount: { pts: [[0, 0, 's'], [0.33, 0.5, 's'], [0.67, 0.82, 's'], [1, 1, 's']] } }; } };

// On a Mesh, a modifier shapes each copy on its own, or every copy together as one (a bend across them all).
export const SHAPE_MODS = {
  ...Object.fromEntries(Object.entries(BASE_MODS).map(([k, m]) => [k, {
    ...m, params: [...m.params, en('space', 'Apply to', 'each copy', ['each copy', 'all together'], { hint: 'Each copy bends on its own; all together bends the whole set of copies as one.' })],
  }])),
  lod: {
    title: 'LOD', desc: 'Fewer segments on the copies in the lower LODs an export makes. Replaces LOD reduction %.',
    params: [lodAmount(), bool('segments', 'Segments', true, { hint: 'Sphere, cone, disk and rectangle segments. Imported meshes stay as they are.' }), lodCurves],
  },
};

export const SURFACE_MODS = {
  // Strength varies per piece (each leaf or branch) and follows its curve from each piece's base to its tip.
  noise: { ...BASE_MODS.noise, params: [nv('amp', 'Strength', 0, { unit: 'cm', abs: 5 }), nb('scale', 'Scale', 30, { unit: 'cm', min: 0.1 })] },
  displace: {
    title: 'Displacement', desc: 'Moves the surface in and out using a texture.',
    params: [{ k: 'texture', l: 'Texture', t: 'texture', d: null }, en('channel', 'Channel', 'R', ['R', 'G', 'B', 'A']), nb('amount', 'Strength', 2, { unit: 'cm' }), nb('tile', 'Tile', 1, { min: 0.01 })],
  },
  inflate: BASE_MODS.inflate,
  wave: BASE_MODS.wave,
  jitter: { title: 'Jitter', desc: 'Moves every point in or out by its own random amount, for a rough, hand-made surface.', params: [nb('amount', 'Amount', 0.5, { unit: 'cm' })] },
  crumple: {
    title: 'Crumple', desc: 'Crumples and folds each leaf or card from its corners, like an old dried leaf. The base stays where it grows.',
    params: [
      nv('amount', 'Amount', 0.5, { min: 0, max: 2, hint: 'How deep the folds go. Variation changes it per leaf; the curve sets it from base to tip.' }),
      nb('curl', 'Corner curl', 0.3, { min: -1, max: 1, hint: 'Rolls the corners and edges up, or down below 0.' }),
      nb('wrinkle', 'Wrinkles', 0.2, { unit: 'cm', min: 0, hint: 'Strength of small bumps over the surface.' }),
      nb('wrinkleScale', 'Wrinkle size', 2, { unit: 'cm', min: 0.1, hint: 'Smaller is finer wrinkles.' }),
      int('seed', 'Seed', 1, { min: 0, max: 9999, sock: false }),
    ],
  },
  smooth: { title: 'Smooth', desc: 'Relaxes the surface, softening sharp folds and steps.', params: [nb('strength', 'Strength', 0.5, { min: 0, max: 1 }), int('passes', 'Passes', 2, { min: 1, max: 10, sock: false })] },
  subdivide: {
    title: 'Subdivide', desc: 'Splits every quad into four quads (and each triangle into four) for a finer, rounder surface. Smooth 0 keeps the shape exactly; 1 rounds it off.',
    params: [int('levels', 'Levels', 1, { min: 1, max: 3, sock: false }), nb('smooth', 'Smooth', 1, { min: 0, max: 1 }), bool('keepEdges', 'Keep edges', true, { hint: 'Open borders, like a leaf outline, keep their shape.' })],
  },
  thickness: {
    title: 'Thickness', desc: 'Gives a flat sheet a back and sides, with the same UVs, so leaves and petals get real thickness.',
    params: [
      nv('amount', 'Thickness', 0.1, { min: 0, hint: 'Thickness as a share of the cutout width: 1 is as thick as it is wide. Can go above 1. Variation changes it per leaf; the curve sets it from base to tip.' }),
      nv('pinch', 'Edge pinch', 0.5, { min: 0, max: 1, hint: '1 brings the outline to a thin edge; points inside keep the full thickness. The curve sets it from base to tip.' }),
      // Profile, Both sides and Measure across are no longer offered; files that set them keep their look.
      { k: 'measure', t: 'data', d: 'sides' },
      { k: 'curves', t: 'data', get d() { return { pinch: { pts: [[0, 0.15, 's'], [0.5, 0.4, 's'], [1, 1, 's']] } }; } },
      nb('sidePinch', 'Side pinch', 0.8, { min: 0, max: 1, hint: 'How thin the side columns get: 1 brings the sides to a sharp edge.' }),
      nb('sideWidth', 'Side width', 0.35, { min: 0.01, max: 1, hint: 'How far in from each side the pinch reaches, as a share of the half-width. The middle stays flat.' }),
      crv('upper', 'Upper profile', { pts: [[0, 1, 's'], [1, 1, 's']] }, { hint: 'The front face from the side (left) to the middle (right).' }),
      crv('lower', 'Lower profile', { pts: [[0, 1, 's'], [1, 1, 's']] }, { hint: 'The back face from the side (left) to the middle (right).' }),
    ],
  },
  avoid: {
    title: 'Avoid intersections', desc: 'Tilts or moves each leaf or card that runs into another so it clears it, pushes points out along their normals, or removes the parts that intersect.',
    params: [
      en('mode', 'Do', 'tilt', ['tilt', 'push', 'prune'], { hint: 'Tilt turns each touching leaf or card around its base, or shifts its tip over or under the other; its base stays on the joint. Push moves points out along their normals. Prune removes each piece that hits another.' }),
      en('with', 'Against', 'same node', ['same node', 'other nodes', 'everything'], { hint: 'Same node: leaves against leaves of this node. Other nodes: against branches and other parts.' }),
      nb('clearance', 'Clearance', 2, { unit: 'cm', min: 0.01, hint: 'Closer than this counts as touching.' }),
      nb('falloff', 'Falloff', 4, { unit: 'cm', min: 0, when: { mode: 'push' }, hint: 'Beyond the clearance the push fades out over this distance.' }),
      nb('maxTilt', 'Max tilt', 30, { unit: '°', min: 0, max: 90, when: { mode: 'tilt' }, hint: 'The most a piece is turned to clear another. Wide cards need less.' }),
      nb('amount', 'Amount', 2, { unit: 'cm', min: 0, when: { mode: ['push', 'tilt'] }, hint: 'How far a touching point is pushed, or how far the tip of a piece may shift when tilting is not enough.' }),
      nb('baseSkip', 'Ignore base %', 10, { min: 0, max: 100, hint: 'The first part of each piece, where it sits on its parent, is left alone.' }),
    ],
  },
  project: {
    title: 'Project', desc: 'Wraps the surface onto a target mesh, like a shrinkwrap: each point moves to the nearest part of the target, or along its own normal until it meets it.',
    params: [
      { k: 'target', l: 'Target', t: 'ref', d: null },
      en('mode', 'Mode', 'nearest surface', ['nearest surface', 'along normal'], { hint: 'Nearest surface moves each point to the closest spot on the target. Along normal looks out and in along the point normal.' }),
      nb('offset', 'Offset', 0, { unit: 'cm', hint: 'Keeps the surface this far off the target: above it when positive, below when negative.' }),
      nv('strength', 'Strength', 1, { min: 0, max: 1, noVary: true, hint: 'How far each point goes toward the target: 1 lands on it. The curve sets it from base to tip.' }),
      en('falloff', 'Falloff', 'none', ['none', 'toward the tip', 'toward the base'], { hint: 'Fades the strength along each piece.' }),
      nb('maxDist', 'Max distance', 0, { unit: 'cm', min: 0, hint: 'Points farther than this from the target stay put. 0 has no limit.' }),
      en('parts', 'Affects', 'all', ['all', 'first line', 'all but the first'], { hint: 'Which lines of this node are wrapped: the first one is usually the trunk.' }),
    ],
  },
  ripple: { title: 'Ripple', desc: 'Rings spreading out from the middle of the plant, like wind across a canopy.', params: [nb('amp', 'Strength', 1, { unit: 'cm' }), nb('length', 'Wavelength', 60, { unit: 'cm', min: 0.1 })] },
  merge: {
    title: 'Merge', desc: 'Welds points closer than a distance into one, closing small gaps and cracks.',
    params: [
      nb('distance', 'Distance', 0.1, { unit: 'cm', min: 0, hint: 'Points closer than this become one.' }),
      bool('seams', 'Keep UV seams', true, { hint: 'Points that meet but have different UVs stay apart in the UVs, so textures keep their seams. Off welds them fully.' }),
    ],
  },
  remesh: {
    title: 'Remesh', desc: 'Rebuilds the whole mesh as one even surface, so parts that touch or overlap blend into one. UVs, colors and wind come from the nearest part of the old mesh.',
    params: [
      int('resolution', 'Resolution', 64, { min: 8, max: 256, sock: false, hint: 'Cells along the longest side. Higher keeps more detail but is slower; thin parts need a high value.' }),
      bool('quads', 'Quad faces', true, { hint: 'Keeps the new faces as quads on export; off gives triangles.' }),
      nb('snap', 'Snap to source', 0.5, { min: 0, max: 1, hint: 'Pulls the new surface back toward the old one. 0 leaves it a little puffed out; 1 sits on it.' }),
    ],
  },
  lod: {
    title: 'LOD', desc: 'Thins this part out in the lower LODs an export makes. Replaces LOD reduction % on the Mesh tab.',
    params: [
      lodAmount(),
      bool('segments', 'Segments', true, { hint: 'Fewer points along each line.' }),
      bool('sides', 'Sides', true, { hint: 'Fewer sides around each tube.' }),
      bool('leaves', 'Leaf count', true, { hint: 'Fewer leaves, each larger, so the crown keeps its look.' }),
      int('cardFrom', 'Cards from LOD', 2, { min: 1, max: 8, sock: false, hint: 'Cutout leaves turn into plain cards from this LOD on.' }),
      lodCurves,
    ],
  },
};

// The Material tab picks a scene material; what stays on the node is its own variation, vertex colors and UVs.
const material = (o = {}) => tag('material', 'mesh', [
  { k: 'material', l: 'Material', t: 'matref', d: null, to: null },
  { k: 'cutoutPick', l: 'Use cutouts', t: 'cutpick', d: null, to: null, when: { meshType: 'cutout' } },
  { k: '_editmat', l: 'Edit material', t: 'action', act: 'mateditor', d: null, to: null },
  section('_tint', 'Color variation', { fold: true }),
  col('tintColor', 'Vary toward', '#b9cf7a'),
  nv('tintAmount', 'Amount %', 0, { min: 0, max: 100, noVary: true, hint: 'How far each part leans toward the color. The curve sets it along the length.' }),
  section('_vc', 'Vertex colors', { fold: true }),
  bool('vcAO', 'Bake ambient occlusion', false, { hint: 'Darkens where surfaces crowd together, stored in the vertex colors.' }),
  nb('vcAOStrength', 'AO strength', 0.7, { min: 0, max: 1, when: { vcAO: true } }),
  bool('gradOn', 'Gradient along length', false),
  { k: 'gradient', l: 'Along length', t: 'gradient', d: [[0, '#5a6a40'], [1, '#ffffff']], when: { gradOn: true } },
  bool('gradHOn', 'Gradient by height', false),
  { k: 'gradH', l: 'By height', t: 'gradient', d: [[0, '#6b7d4a'], [1, '#ffffff']], when: { gradHOn: true } },
  ...(o.uv ? [
    section('_uv', 'UV', { fold: true }),
    { k: '_uvedit', l: 'UV editor', t: 'action', act: 'uveditor', d: null, to: null },
    nv('tileU', 'Tile U', 1),
    nv('tileV', 'Tile V', 1),
    nv('offsetU', 'Offset U', 0, { abs: 1 }),
    nv('offsetV', 'Offset V', 0, { abs: 1 }),
    nb('uvAngle', 'UV angle', 0, { unit: '°', min: -360, max: 360, hint: 'Turns the texture on the surface about the middle of the tile (a cutout: of its own patch). 90 lays it sideways.' }),
    en('uvFix', 'Fit', 'none', ['none', 'U', 'V'], { when: { meshType: 'tube' }, hint: 'U fits the texture once around the tube, V once along its whole length. None tiles both.' }),
    nb('uvTileFrom', 'Tile from V', 0, { min: 0, max: 1, when: { meshType: 'tube' }, hint: 'The texture below this is used once at the base (where the branch blends in); above it the part up to Tile to V repeats.' }),
    nb('uvTileTo', 'Tile to V', 1, { min: 0, max: 1, when: { meshType: 'tube' } }),
    bool('flipU', 'Flip U', false),
    bool('flipV', 'Flip V', false),
    bool('uvMatch', 'Even texel size', true, { when: { meshType: 'tube' }, hint: 'The trunk wraps the texture once around and repeats it at the same scale along; thinner branches take a smaller share so the bark looks the same size everywhere.' }),
    bool('absLength', 'Repeat by distance', true, { when: { meshType: 'tube', uvMatch: false } }),
    nb('lengthV', 'Repeat every', 60, { unit: 'cm', min: 0.1, when: { meshType: 'tube', uvMatch: false, absLength: true } }),
    nv('uvTwist', 'Twist', 0, { unit: '°', abs: 360, when: { meshType: 'tube' } }),
    en('capUv', 'Cap UVs', 'continue', ['continue', 'disc'], { when: { meshType: 'tube' }, hint: 'Continue runs the bark on over the caps; Disc lays a round patch of the texture on each, like the rings of a cut log.' }),
    nb('capUvScale', 'Cap UV size', 1, { min: 0.01, when: { meshType: 'tube', capUv: 'disc' }, hint: 'How much of the texture one cap covers: 1 is the whole picture.' }),
    nb('capUvU', 'Cap UV center U', 0.5, { when: { meshType: 'tube', capUv: 'disc' } }),
    nb('capUvV', 'Cap UV center V', 0.5, { when: { meshType: 'tube', capUv: 'disc' } }),
    bool('uvFit', 'Match leaf shape', false, { when: { meshType: 'leaf' }, hint: 'Stretches the texture across the leaf outline instead of cutting it off.' }),
  ] : []),
]);

// Position, rotation and scale of each entity, one value per axis, each with its own variation and curve.
const transform = [
  section('_xf', 'Transform', { fold: true }),
  en('xfSpace', 'Axes', 'local', ['local', 'world'], { sock: false, hint: 'Local moves, turns and scales each entity along its own axes: X to its side, Z the way it heads. World uses the view gizmo\'s axes, Z up.' }),
  nv('posX', 'Position X', 0, { unit: 'cm', abs: 200 }),
  nv('posY', 'Position Y', 0, { unit: 'cm', abs: 200 }),
  nv('posZ', 'Position Z', 0, { unit: 'cm', abs: 200 }),
  nv('rotX', 'Rotation X', 0, { unit: '°', abs: 180 }),
  nv('rotY', 'Rotation Y', 0, { unit: '°', abs: 180 }),
  nv('rotZ', 'Rotation Z', 0, { unit: '°', abs: 180 }),
  nv('sclU', 'Scale', 1, { min: 0, hint: 'All three axes together.' }),
  nv('sclX', 'Scale X', 1, { min: 0 }),
  nv('sclY', 'Scale Y', 1, { min: 0 }),
  nv('sclZ', 'Scale Z', 1, { min: 0 }),
];

const P_NOT_ATTACHED = ['point', 'line', 'ring', 'urchin'];

// How lines leave wherever they start. Shared by both nodes.
const placement = (o = {}) => tag('place', 'place', [
  en('place', 'Type', 'point', ['point', 'line', 'ring', 'grid', 'urchin', 'spline', 'mesh', 'sprouts'], { hint: 'Connecting a parent picks Spline or Mesh for you. Point, Line, Ring, Grid and Urchin then start at the tip of each parent line.' }),
  nv('count', 'Count', o.count ?? 1, { min: 0, step: 1, int: true, when: { place: [...P_NOT_ATTACHED, 'mesh'] }, sock: true }),
  // Line
  { k: 'lineDir', l: 'Direction', t: 'vec', d: [1, 0, 0], when: { place: 'line' } },
  nv('lineLen', 'Length', 200, { unit: 'cm', min: 0, when: { place: 'line' } }),
  // Ring
  nv('ringRadius', 'Radius', 100, { unit: 'cm', min: 0, when: { place: 'ring' } }),
  en('ringFill', 'Placement', 'edge', ['edge', 'inside'], { when: { place: 'ring' }, hint: 'Edge sits on the circle; Inside fills it. On Inside, curves run from the center to the edge.' }),
  // Grid: rows and columns on the ground plane (an orchard, a hedge, a test layout)
  int('gridX', 'Columns', 4, { min: 1, max: 200, sock: false, when: { place: 'grid' } }),
  int('gridZ', 'Rows', 4, { min: 1, max: 200, sock: false, when: { place: 'grid' } }),
  nb('gridStep', 'Spacing', 100, { unit: 'cm', min: 0.01, when: { place: 'grid' } }),
  nb('gridStepZ', 'Row spacing', 0, { unit: 'cm', min: 0, when: { place: 'grid' }, hint: '0 uses the same as Spacing.' }),
  nb('gridJitter', 'Jitter %', 0, { min: 0, max: 100, when: { place: 'grid' }, hint: 'Moves each one off its spot by up to this share of the spacing.' }),
  bool('gridStagger', 'Stagger rows', false, { when: { place: 'grid' }, hint: 'Shifts every other row by half a spacing, like bricks.' }),
  // Urchin: lines spread over a ball, like a sea urchin's spines
  nv('sproutRadius', 'Radius', 50, { unit: 'cm', min: 0, when: { place: 'urchin' } }),
  nv('sproutHeight', 'Height', 100, { unit: 'cm', min: 0, when: { place: 'urchin' } }),
  nb('sproutStart', 'Start %', 0, { min: 0, max: 100, when: { place: 'urchin' } }),
  nb('sproutEnd', 'End %', 100, { min: 0, max: 100, when: { place: 'urchin' } }),
  en('sproutAlign', 'Align', 'radial', ['radial', 'axis', 'orthogonal'], { when: { place: 'urchin' } }),
  en('sproutFactor', 'Factor', 'along', ['along', 'order', 'outward'], { when: { place: 'sprouts' }, hint: 'What curves on this part run along, from 0 to 1: along the parent leaf, the order the points were placed in, or from their middle outward.' }),
  int('sproutLevel', 'Sprout level', 0, { min: 0, max: 9, sock: false, when: { place: 'sprouts' }, hint: 'Grow only from sprout points of this level (set in the cutout editor). 0 uses every level.' }),
  en('spacing', 'Spacing', 'even', ['even', 'random'], { when: { place: ['line', 'ring', 'mesh'] }, hint: 'Even keeps a minimum distance between entities.' }),
  // Spline
  en('amountBy', 'Amount', 'density', ['density', 'count'], { when: { place: 'spline' }, hint: 'Density puts more on a longer parent; Count puts the same number on each parent, whatever its length.' }),
  nv('density', 'Density', 8, { min: 0, when: { place: 'spline', amountBy: 'density' }, hint: 'Lines per reference length', sock: true }),
  nv('splineCount', 'Count', 5, { min: 0, step: 1, int: true, when: { place: 'spline', amountBy: 'count' }, hint: 'How many on each parent line, spread between Start and End.' }),
  nv('start', 'Start %', 15, { min: 0, max: 100, abs: 50, when: { place: 'spline' } }),
  nv('end', 'End %', 100, { min: 0, max: 100, abs: 50, when: { place: 'spline' } }),
  en('pattern', 'Growth', 'spiral', ['spiral', 'alternate', 'pairs', 'alternate pairs', 'whorl'], { when: { place: 'spline' }, hint: 'Pairs grow opposite each other, level; alternate pairs turn each pair a quarter turn from the last.' }),
  nv('turn', 'Spiral angle', 137.5, { unit: '°', abs: 45, when: { place: 'spline', pattern: 'spiral' } }),
  int('whorl', 'Per whorl', 3, { min: 1, max: 24, sock: false, when: { place: 'spline', pattern: 'whorl' } }),
  int('levels', 'Iterations', 1, { min: 1, max: 5, sock: false, when: { place: 'spline' } }),
  // Mesh
  en('meshFactor', 'Factor', 'height', ['height', 'order'], { when: { place: 'mesh' }, hint: 'What curves on this part run along, from 0 to 1: bottom to top between Height from and to, or the order they are placed in.' }),
  en('meshOn', 'On the mesh', 'random', ['random', 'faces', 'vertices', 'layers'], { when: { place: 'mesh' }, hint: 'Random spreads them over the surface; Faces puts one on each face, Vertices one on each point; Layers lays rows around it from the bottom up, like roof tiles.' }),
  int('layers', 'Layers', 8, { min: 1, max: 200, sock: false, when: { place: 'mesh', meshOn: 'layers' } }),
  int('layerPer', 'Per layer', 8, { min: 1, max: 500, sock: false, when: { place: 'mesh', meshOn: 'layers' } }),
  en('layerAxis', 'Axis', 'Z', ['X', 'Y', 'Z'], { when: { place: 'mesh', meshOn: 'layers' }, hint: 'The layers stack along this axis, Z up, and ring around it.' }),
  bool('layerStagger', 'Stagger layers', true, { when: { place: 'mesh', meshOn: 'layers' }, hint: 'Each row sits between the ones below it, like tiles.' }),
  nb('meshAlign', 'Follow normal %', 100, { min: 0, max: 100, when: { place: 'mesh' }, hint: 'At 100 lines follow the mesh surface. At 0 they point straight up.' }),
  nb('minDist', 'Min distance', 5, { unit: 'cm', min: 0.01, when: { place: 'mesh', spacing: 'even' } }),
  nb('prune', 'Noise prune %', 0, { min: 0, max: 100, when: { place: 'mesh' }, hint: 'Removes patches using soft noise.' }),
  nb('pruneScale', 'Prune scale', 50, { unit: 'cm', min: 0.1, when: { place: 'mesh' } }),
  nb('heightStart', 'Height from %', 0, { min: 0, max: 100, when: { place: 'mesh' } }),
  nb('heightEnd', 'Height to %', 100, { min: 0, max: 100, when: { place: 'mesh' } }),
  nb('slope', 'Max slope', 180, { unit: '°', min: 0, max: 180, when: { place: 'mesh' }, hint: 'Only surfaces within this angle of straight up.' }),
  section('_var', 'Each entity', { fold: true }),
  nv('tilt', 'Angle', o.tilt ?? 0, { unit: '°', abs: 90, sock: true, hint: 'Pitch: leans away from the parent, outward.' }),
  nv('rotation', 'Rotation', 0, { unit: '°', abs: 180, hint: 'Yaw: turns where it sits around the parent line. In pairs and alternate growth the other side turns the opposite way, like wings.' }),
  nv('roll', 'Roll', 0, { unit: '°', abs: 180, hint: 'Turns it on its own axis, the way it heads. Mirrored on the other side of pairs.' }),
  nv('scale', 'Scale %', 100, { min: 0 }),
  nb('scaleParent', 'Follow parent scale %', 0, { min: 0, max: 100, hint: 'Takes on the size its parent was given (by its own Scale, its curves and variation): at 100 a part on a half-size branch is half size too, tips included. Needs a parent.' }),
  nb('alignParent', 'Align to parent %', 100, { min: 0, max: 100, hint: 'At 100 every line lies the same way round its parent. Lower values turn each line by a random amount.' }),
  section('_tip', 'Tip', { fold: true, when: { place: 'spline' } }),
  bool('tipOn', 'Grow from tip', true, { when: { place: 'spline' } }),
  nv('tipCount', 'Count', 1, { min: 1, max: 32, step: 1, int: true, when: { place: 'spline', tipOn: true } }),
  nv('tipTilt', 'Angle', 15, { unit: '°', abs: 45, when: { place: 'spline', tipOn: true } }),
  nv('tipRot', 'Rotation', 0, { unit: '°', abs: 180, when: { place: 'spline', tipOn: true } }),
  nv('tipRoll', 'Roll', 0, { unit: '°', abs: 180, when: { place: 'spline', tipOn: true } }),
  nv('tipScale', 'Scale %', 100, { min: 0, when: { place: 'spline', tipOn: true }, hint: 'Its variation gives each tip its own size.' }),
  ...(o.transform === false ? [] : transform),
]);

const TAPER = { pts: [[0, 1, 's'], [1, 0.12, 's']] };
const BLADE = { pts: [[0, 0.05, 's'], [0.3, 0.9, 's'], [0.55, 1, 's'], [1, 0.02, 's']] };
// A quarter circle: the rim (left) rises fast, then levels off in the middle (right).
const ROUND = { pts: [[0, 0, 's'], [0.1, 0.44, 's'], [0.3, 0.71, 's'], [0.6, 0.92, 's'], [1, 1, 's']] };
const LEAFY = ['leaf', 'cutout'];

const meshing = tag('mesh', 'mesh', [
  // Switches rather than a list: a tube can carry leaves or cutouts on the same line (a palm frond's stem and
  // blades). Leaf and cutout exclude each other. Stored as 'tube', 'tube+leaf' and so on; 'none' when all are off.
  { k: 'meshType', l: 'Type', t: 'toggles', d: 'tube', opts: ['tube', 'leaf', 'cutout'], excl: ['leaf', 'cutout'], to: null },
  bool('blendBase', 'Blend into the base', false, { to: 'path', when: { place: 'mesh' }, hint: 'Starts each line a little inside the mesh it grows on; with Crop under branches on that Mesh, its surface opens where the branch enters.' }),
  nb('lodReduce', 'LOD reduction %', 100, { min: 0, max: 100, to: 'path', hint: 'How much this part thins out in the lower LODs an export makes: tubes lose sides and segments, leaves get fewer and larger. 0 keeps it as it is in every LOD.' }),
  // Tube
  section('_tube', 'Tube', { when: { meshType: 'tube' } }),
  { k: 'tubeMaterial', l: 'Tube material', t: 'matref', d: null, to: null, when: { meshType: ['tube+leaf', 'tube+cutout'] }, hint: 'With leaves on the same line, the tube can have its own material (bark); the Material tab is the leaves\' one.' },
  nv('radius', 'Thickness', 12, { unit: 'cm', min: 0.01, when: { meshType: 'tube' }, sock: true }),
  nv('sides', 'Sides', 10, { min: 3, max: 64, step: 1, int: true, when: { meshType: 'tube' } }),
  bool('autoRadius', 'Relative thickness', false, { when: { meshType: 'tube' }, hint: 'Keeps each branch no thicker than its parent times the factor.' }),
  nb('autoFactor', 'Factor', 0.65, { min: 0.05, max: 1, when: { meshType: 'tube', autoRadius: true } }),
  section('_ends', 'Start and end', { fold: true, when: { meshType: 'tube' } }),
  nv('tubeStart', 'Start %', 0, { min: 0, max: 100, when: { meshType: 'tube' } }),
  nv('tubeEnd', 'Finish %', 100, { min: 0, max: 100, when: { meshType: 'tube' } }),
  nv('tubeRot', 'Rotation', 0, { unit: '°', abs: 180, when: { meshType: 'tube' } }),
  // Caps close the tube's ends: rings from the rim (left of the profile) to the middle (right), each as high as the
  // profile says times Height. A flat profile is a flat cap. Border steps in first, like bark around cut wood.
  section('_caps', 'Caps', { fold: true, when: { meshType: 'tube' } }),
  bool('capTop', 'Top cap', true, { when: { meshType: 'tube' } }),
  int('capEndSegs', 'Top segments', 3, { min: 1, max: 24, sock: false, when: { meshType: 'tube', capTop: true }, hint: 'Rings from the rim to the middle.' }),
  nb('capEndHeight', 'Top height', 1, { min: 0, max: 6, when: { meshType: 'tube', capTop: true }, hint: 'In radii of the end: 1 with the round profile is a half ball.' }),
  crv('capEndProfile', 'Top profile', ROUND, { when: { meshType: 'tube', capTop: true }, hint: 'Height from the rim (left) to the middle (right). Flatten it for a flat cut.' }),
  nb('capEndBorder', 'Top border', 0, { min: 0, max: 0.9, when: { meshType: 'tube', capTop: true }, hint: 'A flat ring of bark around the cap, as a share of the radius: the skin of a broken branch.' }),
  bool('capBottom', 'Bottom cap', false, { when: { meshType: 'tube' }, hint: 'Only where the tube does not blend into a parent.' }),
  int('capStartSegs', 'Bottom segments', 3, { min: 1, max: 24, sock: false, when: { meshType: 'tube', capBottom: true }, hint: 'Rings from the rim to the middle.' }),
  nb('capStartHeight', 'Bottom height', 1, { min: 0, max: 6, when: { meshType: 'tube', capBottom: true }, hint: 'In radii of the end: 1 with the round profile is a half ball.' }),
  crv('capStartProfile', 'Bottom profile', ROUND, { when: { meshType: 'tube', capBottom: true }, hint: 'Height from the rim (left) to the middle (right). Flatten it for a flat cut.' }),
  nb('capStartBorder', 'Bottom border', 0, { min: 0, max: 0.9, when: { meshType: 'tube', capBottom: true }, hint: 'A flat ring of bark around the cap, as a share of the radius: the skin of a broken branch.' }),
  // Blend welds a branch into its parent, and a line with no parent into the floor, with the same settings.
  section('_blend', 'Blend', { fold: true, when: { meshType: 'tube' } }),
  bool('blend', 'Blend', true, { when: { meshType: 'tube' }, hint: 'Into the parent; a line with no parent blends into the floor, which flares a trunk.' }),
  nb('blendLength', 'Height', 1.6, { min: 0, max: 20, when: { meshType: 'tube', blend: true }, hint: 'How far up the blend reaches, in radii.' }),
  nb('blendFlare', 'Spread', 0.8, { min: 0, max: 6, when: { meshType: 'tube', blend: true }, hint: 'How far the base spreads over the parent or the floor, in radii.' }),
  nb('blendTension', 'Smoothness', 0.85, { min: 0, max: 1, when: { meshType: 'tube', blend: true } }),
  int('blendRoots', 'Roots', 0, { min: 0, max: 16, sock: false, when: { meshType: 'tube', blend: true }, hint: 'Ridges around the base, like the buttress roots of a trunk; 0 spreads evenly.' }),
  nb('blendRootDepth', 'Root depth', 0.45, { min: 0, max: 1, when: { meshType: 'tube', blend: true }, hint: 'How much the roots stand out from the hollows between them.' }),
  nb('blendRootTurn', 'Root turn', 0, { unit: '°', when: { meshType: 'tube', blend: true } }),
  nb('blendOffset', 'Offset', 0.5, { min: 0, max: 1, when: { meshType: 'tube', blend: true }, hint: 'Leans the spread to one side: the underside of a branch (a trunk toward Root turn). 0 is even; 1 puts it all on that side, leaving the other almost flat.' }),
  nb('blendCollar', 'Parent collar', 0.35, { min: 0, max: 2, when: { meshType: 'tube', blend: true }, hint: 'How much the parent swells around the joint, in branch radii' }),
  nb('blendSink', 'Sink %', 1, { min: 0, max: 40, when: { meshType: 'tube', blend: true } }),
  int('blendRings', 'Quality', 4, { min: 2, max: 10, sock: false, when: { meshType: 'tube', blend: true } }),
  nb('blendShade', 'Normal blend', 1, { min: 0, max: 1, when: { meshType: 'tube', blend: true } }),
  bool('blendTexture', 'Texture cross-fade', true, { when: { meshType: 'tube', blend: true } }),
  nb('blendMinRatio', 'Skip twigs under', 0.06, { min: 0, max: 1, when: { meshType: 'tube', blend: true }, hint: 'Branches thinner than this share of the parent skip the blend to save triangles' }),
  // Leaf: its outline is the curve on Width, so the shape shows when that curve opens.
  section('_leaf', 'Leaf', { when: { meshType: LEAFY } }),
  int('blades', 'Count', 1, { min: 1, max: 12, sock: false, when: { meshType: LEAFY }, hint: 'Copies around the line, crossed evenly.' }),
  nv('bladeRot', 'Rotation', 0, { unit: '°', abs: 180, when: { meshType: LEAFY }, hint: 'Turns the leaf around its line.' }),
  nv('width', 'Width', 8, { unit: 'cm', min: 0.01, when: { meshType: 'leaf' }, sock: true, hint: 'The outline across is the curve on this value.' }),
  nv('shapeScale', 'Width', 1, { min: 0.05, max: 4, when: { meshType: 'cutout' }, hint: 'Widens or narrows the cutout, 1 as drawn.' }),
  nv('leafStart', 'Start %', 0, { min: 0, max: 100, when: { meshType: LEAFY } }),
  nv('leafEnd', 'Finish %', 100, { min: 0, max: 100, when: { meshType: LEAFY } }),
  int('sideSteps', 'Width segments', 1, { min: 1, max: 8, sock: false, when: { meshType: 'leaf' } }),
  // The leaf's base wraps onto its parent's bark: points near the base snap onto the parent's surface.
  bool('leafBlend', 'Blend into parent', false, { when: { meshType: LEAFY }, hint: 'Snaps the base of each leaf onto the surface of the branch it grows from.' }),
  nb('leafBlendHeight', 'Blend height', 2, { min: 0.1, max: 20, when: { meshType: LEAFY, leafBlend: true }, hint: 'How far up the leaf the blend reaches, in radii of the parent.' }),
  nb('leafBlendSpread', 'Blend spread', 0.5, { min: 0, max: 4, when: { meshType: LEAFY, leafBlend: true }, hint: 'Widens the base as it meets the parent.' }),
  nb('leafBlendSmooth', 'Blend smoothness', 0.5, { min: 0, max: 1, when: { meshType: LEAFY, leafBlend: true } }),
  nb('leafBlendSink', 'Blend sink %', 5, { min: 0, max: 60, when: { meshType: LEAFY, leafBlend: true } }),
  // Cutout leaf
  section('_cut', 'Cutouts', { when: { meshType: 'cutout' } }),
  { k: 'material', l: 'Material', t: 'matref', d: null, to: null, when: { meshType: 'cutout' } },
  { k: 'cutoutPick', l: 'Use cutouts', t: 'cutpick', d: null, to: null, when: { meshType: 'cutout' } },
  { k: '_atlas', l: 'Edit cutouts', t: 'action', act: 'atlas', d: null, to: null, when: { meshType: 'cutout' } },
  // The node's own order of its cutouts (ids), set in Use cutouts; null keeps the material's order.
  { k: 'cutoutOrder', t: 'data', d: null, to: null },
  en('cutDist', 'Spread', 'random', ['random', 'by curve'], { when: { meshType: 'cutout' }, hint: 'Random picks any cutout for each leaf. By curve picks along the parent: the curve goes from base (left) to tip (right), low is the first cutout in the list, high the last.' }),
  crv('cutCurve', 'Pick curve', { pts: [[0, 0, 's'], [1, 1, 's']] }, { when: { meshType: 'cutout', cutDist: 'by curve' } }),
  nb('cutVary', 'Variation %', 0, { min: 0, max: 100, when: { meshType: 'cutout', cutDist: 'by curve' }, hint: 'Shifts each pick up or down the list at random.' }),
  section('_fold', 'Deformation', { fold: true, when: { meshType: LEAFY } }),
  nv('angleAcross', 'Fold', 12, { unit: '°', abs: 45, when: { meshType: LEAFY }, hint: 'Lifts both halves up from the midrib in a V.' }),
  nv('incAcross', 'Curl', 6, { unit: '°', abs: 90, when: { meshType: LEAFY }, hint: 'Rolls the edges in (or out, below 0) as a smooth arc.' }),
  nv('angleAlong', 'Angle', 0, { unit: '°', abs: 45, when: { meshType: LEAFY }, hint: 'Tilts the whole leaf up or down from its line at the pivot.' }),
  nv('incAlong', 'Bend', 0, { unit: '°', abs: 90, when: { meshType: LEAFY }, hint: 'Bends the leaf along its length; the tip has turned this far.' }),
  nv('leafTwist', 'Twist', 0, { unit: '°', abs: 180, when: { meshType: LEAFY }, hint: 'Turns the leaf around its midrib, more toward the tip.' }),
  section('_lsurf', 'Faces and normals', { fold: true, when: { meshType: LEAFY } }),
  bool('flip', 'Flip normals', false, { when: { meshType: LEAFY } }),
  bool('twoSided', '2-sided (for games)', false, { when: { meshType: LEAFY } }),
  nb('softNormals', 'Soft canopy normals', 0.35, { min: 0, max: 1, when: { meshType: LEAFY } }),
  // Noise stays at the top of the stack and can't be removed; it does nothing until its strength is raised.
  {
    k: 'meshMods', l: 'Mesh modifiers', t: 'mods', set: 'surface', when: { meshType: ['tube', 'leaf', 'cutout'] },
    d: [newMod('noise', 'noise', { amp: 0, scale: 30 }, { fixed: true })],
  },
]);

// Starting points for the Wind tab: power and speed in percent, flutter, and how the bend builds from the base.
export const WIND_PRESETS = {
  Grass: { windPower: 160, windSpeed: 120, windFlutter: 20, windCurve: { pts: [[0, 0, 's'], [0.5, 0.25, 's'], [1, 1, 's']] } },
  Stem: { windPower: 120, windSpeed: 100, windFlutter: 10, windCurve: { pts: [[0, 0, 's'], [0.4, 0.15, 's'], [1, 1, 's']] } },
  Bush: { windPower: 80, windSpeed: 90, windFlutter: 30, windCurve: { pts: [[0, 0, 's'], [0.5, 0.35, 's'], [1, 1, 's']] } },
  Trunk: { windPower: 25, windSpeed: 60, windFlutter: 0, windCurve: { pts: [[0, 0, 's'], [0.6, 0.15, 's'], [1, 1, 's']] } },
  Branch: { windPower: 70, windSpeed: 80, windFlutter: 0, windCurve: WIND_BEND },
  Leaves: { windPower: 60, windSpeed: 110, windFlutter: 70, windCurve: { pts: [[0, 0, 's'], [0.3, 0.2, 's'], [1, 1, 's']] } },
  Palm: { windPower: 90, windSpeed: 70, windFlutter: 25, windCurve: { pts: [[0, 0, 's'], [0.2, 0.05, 's'], [0.7, 0.45, 's'], [1, 1, 's']] } },
};

// Growth (engine/growth.js): the settings of the simulation, on the Growth node's Growth tab. A Spline keeps them
// hidden, so a file from when Growth was a Spline tab still grows the same tree.
const growth = (node) => tag('growth', 'path', [
  { k: 'growOn', t: 'data', d: node },
  { k: '_growPreset', l: 'Species…', t: 'action', act: 'growpreset', d: null, to: null },
  ...(node ? [col('wire', 'Wire color', '#7fbf4a')] : []),
  int('growYears', 'Years', 18, { min: 1, max: 80, sock: false, hint: 'How many seasons it grows. More years: a taller, fuller tree. Age on the Age panel shortens or lengthens this.' }),
  nb('apical', 'Leader strength', 0.52, { min: 0.3, max: 0.7, hint: 'How much the main stem wins over the side limbs. Above 0.5: one leader, a cone like a pine. Below 0.5: strong limbs, a round or spreading crown like an oak. Small steps change a lot.' }),
  nb('growSpeed', 'Vigor', 2, { min: 0.1, max: 6, hint: 'How much of the light it catches turns into new shoots each year: more vigor, a bigger and denser tree.' }),
  nb('branchAngle', 'Branch angle', 45, { unit: '°', min: 0, max: 120, hint: 'How far a new shoot leaves the stem it grows from.' }),
  nb('gravAngle', 'Limb angle', 70, { unit: '°', min: 0, max: 180, hint: 'The angle from straight up that limbs bend toward as they grow: 0 upright, 90 level, above 90 hanging.' }),
  nb('droop', 'Hanging twigs', 0, { min: 0, max: 3, hint: 'Twigs past the main limbs bend down under their weight: a little for a birch, a lot for a weeping willow.' }),
  nb('shedding', 'Bare trunk', 0.25, { min: 0, max: 1, hint: 'Branches that get too little light drop off. Higher: shaded lower limbs drop sooner, so the trunk is bare higher up.' }),
  nb('trunkThick', 'Trunk thickness', 0.65, { min: 0, max: 2, hint: 'How much the trunk and limbs thicken over the twigs. 1 is the natural thickness for what a branch carries; lower is slimmer.' }),
  int('leafYears', 'Leaves on the last years', 0, { min: 0, max: 40, sock: false, hint: '0: leaves and other children grow along every branch. Above 0: only on wood that grew in the last N years, so old limbs stay bare and leaves crowd the outside.' }),
  nb('lean', 'Lean', 0, { min: 0, max: 2, hint: '0: grows evenly all round. Above 0: the whole tree leans one way, as in steady wind or light from one side.' }),
  nb('leanDir', 'Lean direction', 0, { unit: '°', min: -180, max: 180, hint: 'Which way it leans, around the base.' }),
  bool('avoidMeshes', 'Grow around meshes', true, { hint: 'Meshes in the scene shade the tree and block it: shoots slide along them instead of growing through.' }),
  section('_growLight', 'Light and shadow', { fold: true }),
  nb('photoInfluence', 'Turn to light', 0.4, { min: 0, max: 2, hint: 'How strongly shoots bend toward brighter, less shaded space.' }),
  nb('shadowStrength', 'Shadow strength', 1, { min: 0, max: 4, hint: 'How dark each bud makes the space below it. Darker: inner and lower shoots get less energy.' }),
  int('shadowSize', 'Shadow reach', 6, { min: 1, max: 12, sock: false, hint: 'How many steps down each bud shades. Longer: a hollower crown with growth on the outside.' }),
  nb('lightInfluence', 'Light matters', 1, { min: 0, max: 1, hint: '1: buds in shade grow less. 0: every bud grows as if in full sun.' }),
  nb('favorUp', 'Favor upward buds', 0, { min: -1, max: 1, hint: 'Above 0: buds pointing up get more energy. Below 0: less.' }),
  nb('favorSides', 'Favor sideways buds', 0, { min: -1, max: 1, hint: 'Above 0: buds pointing sideways get more energy, for a wider crown.' }),
  section('_growShape', 'Shoots and buds', { fold: true }),
  nb('internode', 'Step length', 30, { unit: 'cm', min: 1, hint: 'The length of one shoot step between buds; also the size of a light cell.' }),
  nb('shootMax', 'Longest shoot a year', 6, { min: 0.2, max: 12, hint: 'The most steps the leader can grow in one year; side shoots get less, by Side share.' }),
  nb('decay', 'Side share', 0.9, { min: 0, max: 1, hint: 'How much energy each side branch keeps compared with the stem it leaves. Lower: shorter side limbs.' }),
  nb('leaderFade', 'Leader fades', 0, { min: 0, max: 2, hint: 'The leader loses its lead as the tree ages, so the crown opens into big limbs. 0 keeps one leader to the top.' }),
  nb('verticalTrunk', 'Straight trunk', 0.8, { min: 0, max: 1, hint: '1: the trunk grows straight up. Lower: it wanders toward the light.' }),
  nb('gravInfluence', 'Limb angle pull', 0.25, { min: 0, max: 2, hint: 'How strongly limbs bend toward the Limb angle.' }),
  nb('angNoise', 'Crookedness', 0.2, { min: 0, max: 2, hint: 'Random wiggle in every shoot.' }),
  nb('phyllotaxis', 'Bud turn', 137.5, { unit: '°', min: 0, max: 360, hint: 'How far each new bud turns around the stem from the last: 137.5 spirals, 180 alternates, 90 pairs.' }),
  int('budsPerNode', 'Buds per step', 1, { min: 1, max: 8, sock: false, hint: '2 for opposite pairs (ash, maple), 4 to 6 for whorls (pine).' }),
  nb('budRadius', 'Twig thickness', 0.5, { unit: 'cm', min: 0.01, hint: 'The thickness at the tips; everything below thickens with what it carries.' }),
  nb('pipeExp', 'Thickening', 2.5, { min: 1.5, max: 4, hint: 'How forks add up: 2 thickens fast, 3 stays slender.' }),
  section('_growCuts', 'Cuts and limits', { fold: true }),
  nb('cutTop', 'Max height', 0, { unit: 'cm', min: 0, hint: '0: no limit. Shoots stop at this height above the base, like a hedge or a pruned crown.' }),
  nb('cutSpread', 'Max spread', 0, { unit: 'cm', min: 0, hint: '0: no limit. Nothing grows farther than this from the trunk.' }),
  nb('cutClear', 'Clear trunk', 0, { unit: 'cm', min: 0, hint: 'No side branches below this height: a cleared trunk, as in a park or an orchard.' }),
  int('growMax', 'Max steps', 6000, { min: 100, max: 200000, sock: false, hint: 'A cap on the size: each step is one piece of branch. Lower is faster.' }),
  ...(node ? [section('_growMods', 'Modifiers', { fold: true }), { k: 'mods', l: 'Modifiers', t: 'mods', set: 'spline', d: [] }] : []),
]);

const wind = (leaves) => tag('wind', 'path', [
  { k: '_windPreset', l: 'Preset…', t: 'action', act: 'windpreset', d: null, to: null },
  nv('windPower', 'Sway power', 100, { min: 0, along: 'pos' }),
  nv('windSpeed', 'Sway speed', 100, { min: 0, along: 'pos' }),
  ...(leaves ? [
    nv('windFlutter', 'Flutter', 60, { min: 0, along: 'pos', hint: 'A quick shiver around the line, for leaves.', when: { meshType: LEAFY } }),
    crv('windCurve', 'Bend from base', WIND_BEND, { hint: 'How much of the bend each point along the line takes: none at its base, all at its tip.' }),
  ] : []),
]);

export const unifiedDefs = [
  {
    type: 'Spline', title: 'Spline', cat: 'plant', tabs: ['spline', 'place', 'mesh', 'material', 'wind'],
    desc: 'One complete part of a plant: a line, where it starts, what wraps it, how it looks and how it moves. Connect a parent to grow it from another Spline or Mesh.',
    in: [{ k: 'parent', kind: 'parent', side: 'left', also: ['object'], multi: true, l: 'Parent' }],
    out: [{ k: 'children', kind: 'parent', side: 'right', l: 'Children' }],
    params: [
      ...tag('spline', 'path', [
        nv('length', 'Length', 300, { unit: 'cm', min: 0.1, sock: true }),
        en('segMode', 'Segments', 'relative', ['relative', 'absolute'], { sock: false, hint: 'Relative: a point every Segment length, so longer lines get more. Absolute: every line gets the same number of segments.' }),
        nv('steps', 'Segment length', 25, { unit: 'cm', min: 0.05, when: { segMode: 'relative' } }),
        int('segCount', 'Segment count', 12, { min: 1, max: 400, sock: false, when: { segMode: 'absolute' } }),
        bool('onSurface', 'On parent surface', true, { hint: 'Lines on a parent start on its bark, by its thickness, instead of at its center line.' }),
        bool('alignWith', 'Align with parent', true, { to: 'place', hint: 'Each one lines up square to its parent, like the ribs of an umbrella: blades lie flat across the parent and keep that at any angle the parent has. Off, their sides lie level with the ground.' }),
        col('wire', 'Wire color', '#35d07f'),
        {
          k: 'mods', l: 'Modifiers', t: 'mods', set: 'spline',
          d: [newMod('noise', 'Dir_Noise', { strength: 0 }, { name: 'Noise' }), newMod('gravity', 'Dir_Vector', { vector: [0, -1, 0], strength: 0 }, { name: 'Gravity' })],
        },
      ]),
      ...growth(false),
      ...placement(),
      ...meshing,
      ...material({ uv: true }),
      ...wind(true),
      { k: 'curves', t: 'data', d: { radius: TAPER, width: BLADE } },
      // Strokes drawn with the Draw tool; while there are any, they are this Spline's lines.
      { k: 'strokes', t: 'data', d: [] },
    ],
  },
  {
    type: 'Mesh', title: 'Mesh', cat: 'plant', tabs: ['shape', 'place', 'material', 'wind'],
    desc: 'A sphere, rectangle, cone, disk or imported object. Place copies on a parent like fruit, or connect it as the parent of a Spline to grow things on it.',
    in: [{ k: 'parent', kind: 'parent', side: 'left', also: ['object'], multi: true, l: 'Parent' }],
    out: [{ k: 'children', kind: 'parent', side: 'right', l: 'Grow on it' }],
    params: [
      ...tag('shape', null, [
        section('_shape', 'Shape'),
        en('shape', 'Shape', 'sphere', ['sphere', 'rectangle', 'cone', 'disk', 'imported']),
        { k: 'obj', l: 'Mesh file', t: 'obj', d: null, when: { shape: 'imported' } },
        nb('radius', 'Radius', 50, { unit: 'cm', min: 0.01, when: { shape: ['sphere', 'cone', 'disk'] } }),
        nv('profile', 'Profile', 1, { min: 0, when: { shape: 'sphere' }, hint: 'The width at each height, bottom to top: its curve shapes the ball into an egg, a pear, a gourd or a bud.' }),
        nb('topRadius', 'Top radius', 0, { unit: 'cm', min: 0, when: { shape: 'cone' } }),
        nb('height', 'Height', 100, { unit: 'cm', min: 0.01, when: { shape: 'cone' } }),
        { k: 'size', l: 'Size', t: 'vec', d: [100, 100, 100], unit: 'cm', when: { shape: 'rectangle' } },
        nb('bevel', 'Bevel', 5, { unit: 'cm', min: 0, when: { shape: 'rectangle' } }),
        int('segments', 'Segments', 16, { min: 3, max: 64, sock: false, when: { shape: ['sphere', 'rectangle', 'cone', 'disk'] } }),
        bool('show', 'Show mesh', true, { hint: 'Off keeps it as something to grow on, without drawing it.' }),
        bool('cropUnder', 'Crop under branches', false, { hint: 'Cuts this mesh away where Splines with "Blend into the base" start on it, so a scanned trunk and the branches grown on it join as one surface.' }),
      ]),
      ...tag('shape', null, [{ k: 'mods', l: 'Modifiers', t: 'mods', set: 'shape', d: [newMod('noise', 'noise', { amp: 0 })] }]),
      ...placement({ transform: false }),
      ...tag('place', 'place', transform),
      ...material(),
      ...wind(false),
      { k: 'wire', t: 'data', d: '#a78af0' },
    ],
  },
  // A tree that grows itself (engine/growth.js): it makes the trunk and branch lines; Splines connected as children
  // (leaves, twigs, fruit) grow on every branch it makes.
  {
    type: 'Growth', title: 'Growth', cat: 'plant', tabs: ['growth', 'place', 'mesh', 'material', 'wind'],
    desc: 'A whole tree that grows itself by light, shadow, gravity and the meshes around it. Connect Splines as children for leaves and twigs on every branch.',
    in: [{ k: 'parent', kind: 'parent', side: 'left', also: ['object'], multi: true, l: 'Parent' }],
    out: [{ k: 'children', kind: 'parent', side: 'right', l: 'Children' }],
    params: [
      ...growth(true),
      ...placement(),
      ...meshing,
      ...material({ uv: true }),
      ...wind(true),
      { k: 'curves', t: 'data', d: { radius: TAPER, width: BLADE } },
    ],
  },
  // What the Placement tab runs on. Never in the menu: expand.js creates it.
  {
    type: 'Placement', title: 'Placement', cat: 'plant', hidden: true,
    in: [{ k: 'parent', kind: 'dist', side: 'left', multi: true }, { k: 'object', kind: 'object', side: 'left' }],
    out: [{ k: 'out', kind: 'spawn', side: 'right' }],
    params: placement().filter((p) => p.t !== 'section').map(({ tab, to, when, sock, ...p }) => p),
  },
];

export const hasTabs = (type) => type === 'Spline' || type === 'Mesh' || type === 'Growth';
