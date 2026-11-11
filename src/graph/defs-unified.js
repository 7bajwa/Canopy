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

// On a Mesh, a modifier shapes each copy on its own, or every copy together as one (a bend across them all).
export const SHAPE_MODS = Object.fromEntries(Object.entries(BASE_MODS).map(([k, m]) => [k, {
  ...m, params: [...m.params, en('space', 'Apply to', 'each copy', ['each copy', 'all together'], { hint: 'Each copy bends on its own; all together bends the whole set of copies as one.' })],
}]));

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
  smooth: { title: 'Smooth', desc: 'Relaxes the surface, softening sharp folds and steps.', params: [nb('strength', 'Strength', 0.5, { min: 0, max: 1 }), int('passes', 'Passes', 2, { min: 1, max: 10, sock: false })] },
  subdivide: {
    title: 'Subdivide', desc: 'Splits every triangle into four for a finer, rounder surface. Smooth 0 keeps the shape exactly; 1 rounds it off.',
    params: [int('levels', 'Levels', 1, { min: 1, max: 3, sock: false }), nb('smooth', 'Smooth', 1, { min: 0, max: 1 }), bool('keepEdges', 'Keep edges', true, { hint: 'Open borders, like a leaf outline, keep their shape.' })],
  },
  thickness: {
    title: 'Thickness', desc: 'Gives a flat sheet a back and sides, with the same UVs, so leaves and petals get real thickness.',
    params: [
      nb('amount', 'Width scale', 0.1, { min: 0, hint: 'Thickness as a share of the cutout width: 1 is as thick as it is wide. Can go above 1.' }),
      nv('pinch', 'Edge pinch', 0.5, { min: 0, max: 1, hint: '1 brings the outline to a thin edge; points inside keep the full thickness. The curve sets it from base to tip.' }),
      crv('profile', 'Profile', { pts: [[0, 1, 's'], [1, 1, 's']] }, { hint: 'Thickness from the edge (left) to the middle (right). Lower the left end for an arch.' }),
      bool('both', 'Both sides', true, { hint: 'Grows half each way; off grows only backward.' }),
      // Across the leaf, as if it were a card with columns along its length: only the side columns pinch.
      en('measure', 'Measure across', 'sides', ['sides', 'outline'], { hint: 'Sides measures each point across the leaf, side to side, so only the side columns thin out and the length keeps its own pinch. Outline measures from the nearest edge, tip and base included.' }),
      nb('sidePinch', 'Side pinch', 0.8, { min: 0, max: 1, hint: 'How thin the side columns get: 1 brings the sides to a sharp edge.' }),
      nb('sideWidth', 'Side width', 0.35, { min: 0.01, max: 1, hint: 'How far in from each side the pinch reaches, as a share of the half-width. The middle stays flat.' }),
      crv('upper', 'Upper profile', { pts: [[0, 1, 's'], [1, 1, 's']] }, { hint: 'The front face from the side (left) to the middle (right).' }),
      crv('lower', 'Lower profile', { pts: [[0, 1, 's'], [1, 1, 's']] }, { hint: 'The back face from the side (left) to the middle (right).' }),
    ],
  },
  avoid: {
    title: 'Avoid intersections', desc: 'Pushes the surface away from other parts it runs into, along its normals, or removes the parts that intersect.',
    params: [
      en('mode', 'Do', 'push', ['push', 'prune'], { hint: 'Push moves points out along their normals; Prune removes each leaf or branch piece that hits another.' }),
      en('with', 'Against', 'same node', ['same node', 'other nodes', 'everything'], { hint: 'Same node: leaves against leaves of this node. Other nodes: against branches and other parts.' }),
      nb('clearance', 'Clearance', 2, { unit: 'cm', min: 0.01, hint: 'Closer than this counts as touching.' }),
      nb('falloff', 'Falloff', 4, { unit: 'cm', min: 0, hint: 'Beyond the clearance the push fades out over this distance.' }),
      nb('amount', 'Amount', 2, { unit: 'cm', min: 0, when: { mode: 'push' }, hint: 'How far a touching point is pushed.' }),
      nb('baseSkip', 'Ignore base %', 10, { min: 0, max: 100, hint: 'The first part of each piece, where it sits on its parent, is left alone.' }),
    ],
  },
  ripple: { title: 'Ripple', desc: 'Rings spreading out from the middle of the plant, like wind across a canopy.', params: [nb('amp', 'Strength', 1, { unit: 'cm' }), nb('length', 'Wavelength', 60, { unit: 'cm', min: 0.1 })] },
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
    nv('tileU', 'Tile U', 1),
    nv('tileV', 'Tile V', 1),
    nv('offsetU', 'Offset U', 0, { abs: 1 }),
    nv('offsetV', 'Offset V', 0, { abs: 1 }),
    bool('flipU', 'Flip U', false),
    bool('flipV', 'Flip V', false),
    bool('absLength', 'Repeat by distance', true, { when: { meshType: 'tube' } }),
    nb('lengthV', 'Repeat every', 60, { unit: 'cm', min: 0.1, when: { meshType: 'tube', absLength: true } }),
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
  en('place', 'Type', 'point', ['point', 'line', 'ring', 'urchin', 'spline', 'mesh', 'sprouts'], { hint: 'Connecting a parent picks Spline or Mesh for you. Point, Line, Ring and Urchin then start at the tip of each parent line.' }),
  nv('count', 'Count', o.count ?? 1, { min: 0, step: 1, int: true, when: { place: [...P_NOT_ATTACHED, 'mesh'] }, sock: true }),
  // Line
  { k: 'lineDir', l: 'Direction', t: 'vec', d: [1, 0, 0], when: { place: 'line' } },
  nv('lineLen', 'Length', 200, { unit: 'cm', min: 0, when: { place: 'line' } }),
  // Ring
  nv('ringRadius', 'Radius', 100, { unit: 'cm', min: 0, when: { place: 'ring' } }),
  en('ringFill', 'Placement', 'edge', ['edge', 'inside'], { when: { place: 'ring' }, hint: 'Edge sits on the circle; Inside fills it. On Inside, curves run from the center to the edge.' }),
  // Urchin: lines spread over a ball, like a sea urchin's spines
  nv('sproutRadius', 'Radius', 50, { unit: 'cm', min: 0, when: { place: 'urchin' } }),
  nv('sproutHeight', 'Height', 100, { unit: 'cm', min: 0, when: { place: 'urchin' } }),
  nb('sproutStart', 'Start %', 0, { min: 0, max: 100, when: { place: 'urchin' } }),
  nb('sproutEnd', 'End %', 100, { min: 0, max: 100, when: { place: 'urchin' } }),
  en('sproutAlign', 'Align', 'radial', ['radial', 'axis', 'orthogonal'], { when: { place: 'urchin' } }),
  int('sproutLevel', 'Sprout level', 0, { min: 0, max: 9, sock: false, when: { place: 'sprouts' }, hint: 'Grow only from sprout points of this level (set in the cutout editor). 0 uses every level.' }),
  en('spacing', 'Spacing', 'even', ['even', 'random'], { when: { place: ['line', 'ring', 'mesh'] }, hint: 'Even keeps a minimum distance between entities.' }),
  // Spline
  nv('density', 'Density', 8, { min: 0, when: { place: 'spline' }, hint: 'Lines per reference length', sock: true }),
  nv('start', 'Start %', 15, { min: 0, max: 100, abs: 50, when: { place: 'spline' } }),
  nv('end', 'End %', 100, { min: 0, max: 100, abs: 50, when: { place: 'spline' } }),
  en('pattern', 'Growth', 'spiral', ['spiral', 'alternate', 'pairs', 'alternate pairs', 'whorl'], { when: { place: 'spline' }, hint: 'Pairs grow opposite each other, level; alternate pairs turn each pair a quarter turn from the last.' }),
  nv('turn', 'Spiral angle', 137.5, { unit: '°', abs: 45, when: { place: 'spline', pattern: 'spiral' } }),
  int('whorl', 'Per whorl', 3, { min: 1, max: 24, sock: false, when: { place: 'spline', pattern: 'whorl' } }),
  int('levels', 'Iterations', 1, { min: 1, max: 5, sock: false, when: { place: 'spline' } }),
  // Mesh
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
        col('wire', 'Wire color', '#35d07f'),
        {
          k: 'mods', l: 'Modifiers', t: 'mods', set: 'spline',
          d: [newMod('noise', 'Dir_Noise', { strength: 0 }, { name: 'Noise' }), newMod('gravity', 'Dir_Vector', { vector: [0, -1, 0], strength: 0 }, { name: 'Gravity' })],
        },
      ]),
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
        nb('topRadius', 'Top radius', 0, { unit: 'cm', min: 0, when: { shape: 'cone' } }),
        nb('height', 'Height', 100, { unit: 'cm', min: 0.01, when: { shape: 'cone' } }),
        { k: 'size', l: 'Size', t: 'vec', d: [100, 100, 100], unit: 'cm', when: { shape: 'rectangle' } },
        nb('bevel', 'Bevel', 5, { unit: 'cm', min: 0, when: { shape: 'rectangle' } }),
        int('segments', 'Segments', 16, { min: 3, max: 64, sock: false, when: { shape: ['sphere', 'rectangle', 'cone', 'disk'] } }),
        bool('show', 'Show mesh', true, { hint: 'Off keeps it as something to grow on, without drawing it.' }),
      ]),
      ...tag('shape', null, [{ k: 'mods', l: 'Modifiers', t: 'mods', set: 'shape', d: [newMod('noise', 'noise', { amp: 0 })] }]),
      ...placement({ transform: false }),
      ...tag('place', 'place', transform),
      ...material(),
      ...wind(false),
      { k: 'wire', t: 'data', d: '#a78af0' },
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

export const hasTabs = (type) => type === 'Spline' || type === 'Mesh';
