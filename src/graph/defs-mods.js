// Direction modifier node definitions. `after: true` means it may also run after the mesh is built.
import { num, int, bool, en, crv, data, vec } from './defs-helpers.js';

const objectIn = { k: 'object', kind: 'object', side: 'left', l: 'Object' };
const caps = ['none', 'planar', 'spherical'];

// Modifiers that can work on part of the line only: between Start and End, where their curves then run from 0 to 1.
export const RANGED = new Set(['Dir_Random', 'Dir_Vector', 'Dir_Noise', 'Dir_Spline', 'Dir_Droop', 'Dir_HardBend', 'Dir_Curl', 'Dir_Radial', 'Dir_Spiral', 'Dir_Zigzag']);
const range = [
  num('from', 'Start %', 0, { min: 0, max: 100, hint: 'Where along the line it starts working. Its curves run from here (left) to End (right).' }),
  num('to', 'End %', 100, { min: 0, max: 100, hint: 'Where along the line it stops working. The rest of the line carries on the way it was turned.' }),
];
const modifier = (type, title, params, o = {}) => ({
  type, title, cat: 'mod', chain: 'dir', params: RANGED.has(type) ? [...range, ...params] : params, ...o,
  in: [{ k: 'in', kind: 'dir', side: 'top' }, ...(o.in || [])],
  out: [{ k: 'out', kind: 'dir', side: 'bottom' }],
});

export const modDefs = [
  modifier('Dir_Random', 'Random', [
    num('smoothing', 'Smoothing', 100, { unit: 'cm', min: 0.1, n: 1 }),
    num('min', 'Min angle', 0, { unit: '°', n: 1 }),
    num('max', 'Max angle', 25, { unit: '°', n: 1, c: 1 }),
  ], { after: true, desc: 'Bends each line in its own random direction.' }),
  modifier('Dir_Vector', 'Vector', [
    en('source', 'Vector source', 'global', ['global', 'local', 'point', 'surface'], { n: 1 }),
    vec('vector', 'Vector / target', [0, 1, 0], { sock: false }),
    en('mode', 'Orientation', 'vector', ['vector', 'horizontal']),
    num('strength', 'Strength', 0.4, { n: 1, c: 1 }),
  ], { after: true, in: [objectIn], desc: 'Turns lines toward a direction, a point or a surface. Use it for gravity and for reaching to the light.' }),
  modifier('Dir_Noise', 'Noise', [
    num('scale', 'Scale', 80, { unit: 'cm', min: 0.1, n: 1 }),
    num('phase', 'Phase', 0),
    int('seed', 'Random seed', 0),
    num('strength', 'Strength', 15, { unit: 'cm', n: 1, c: 1 }),
    num('sx', 'X scale', 1), num('sy', 'Y scale', 1),
    num('rough', 'Roughness', 0, { min: 0, max: 1 }),
    int('iter', 'Iterations', 3, { min: 1, max: 10 }),
    bool('shift', 'Shift start point', false),
  ], { after: true, desc: 'Adds an organic wobble along each line.' }),
  modifier('Dir_Deviation', 'Deviation', [
    bool('fromChild', 'Angle from child vector', false, { hint: 'Kinks more toward children that leave at a wide angle.' }),
    num('angle', 'Angle', 15, { unit: '°', n: 1, when: { fromChild: false } }),
    num('spread', 'Spread', 20, { unit: 'cm', min: 1, hint: 'How much of the line around each child moves.' }),
  ], { desc: 'Kinks the line out toward each child, the way real wood zigzags at its forks.' }),
  modifier('Dir_Spline', 'Warp', [
    crv('shapeA', 'Shape A', { pts: [[0, 0.5, 's'], [0.5, 0.8, 's'], [1, 0.3, 's']] }, { hint: 'The bend to the side (X), from base (left) to tip (right): higher than at the start bends one way, lower the other.' }),
    crv('shapeB', 'Shape B', { pts: [[0, 0.5, 's'], [0.5, 0.2, 's'], [1, 0.7, 's']] }, { hint: 'The bend in Z, the other way across the line.' }),
    num('orient', 'Orientation', 0, { unit: '°', n: 1 }),
    num('orientChaos', 'Variation angle', 0, { unit: '°' }),
    num('scale', 'Scale', 1, { min: 0, n: 1 }),
    num('scaleChaos', 'Variation scale %', 0, { min: 0, max: 100 }),
  ], { desc: 'Bends lines along two drawn profiles: Shape A to the side, Shape B in Z.' }),
  modifier('Dir_Droop', 'Droop', [
    num('strength', 'Strength', 1, { min: 0, max: 100, n: 1 }),
    num('stiffness', 'Stiffness', 300, { unit: 'cm', min: 1, n: 1, hint: 'Longer lines than this sag more, shorter ones less.' }),
  ], { desc: 'Sags under its own weight like a real branch: long and thin parts sag most, and the tip hangs down.' }),
  modifier('Dir_HardBend', 'Hard bend', [
    num('position', 'Position %', 50, { min: 0, max: 100, n: 1 }),
    num('posChaos', 'Variation position %', 0, { min: 0, max: 100 }),
    num('angle', 'Angle', 40, { unit: '°', n: 1 }),
    num('angleChaos', 'Variation angle', 0, { unit: '°' }),
    num('smooth', 'Smoothness', 0, { unit: 'cm', min: 0, hint: '0 makes a sharp corner; higher rounds the bend over this length.' }),
    num('orient', 'Orientation', 0, { unit: '°' }),
    num('applyStrength', 'Apply vector strength', 0),
    vec('applyVector', 'Apply vector', [0, -1, 0], { sock: false }),
  ], { after: true, desc: 'One abrupt kink at a chosen position.' }),
  modifier('Dir_Wind', 'Wind animation', [
    num('stiffness', 'Stiffness', 300, { unit: 'cm', min: 1, n: 1 }),
    num('flex', 'Flexibility', 8, { min: 0, n: 1 }),
    num('freq', 'Scale frequency', 1, { min: 0, n: 1 }),
    num('amp', 'Amplitude multiplier', 1, { min: 0 }),
    vec('dir', 'Wind direction', [1, 0, 0.3], { sock: false }),
    num('flutter', 'Leaf flutter', 1.5, { min: 0 }),
  ], { after: true, desc: 'Sways the mesh live in the viewport. It costs almost nothing because it runs on the graphics chip.' }),
  modifier('Dir_Curl', 'Curl', [
    num('turns', 'Turns', 1, { n: 1, c: 1, hint: 'How many full turns the line curls; below 0 it curls the other way. The curve sets where along the line it curls.' }),
    num('tighten', 'Tighten %', 60, { min: 0, max: 100, hint: 'Curls tighter toward the tip, like a fern bud.' }),
    en('axis', 'Axis', 'side', ['side', 'x', 'y', 'z'], { hint: 'Side curls across the line itself; X, Y and Z curl around an axis of the line (where it starts) or of the world.' }),
    en('space', 'Axes', 'local', ['local', 'world'], { when: { axis: ['x', 'y', 'z'] }, hint: 'Local: the own axes of the line where it starts (X its side, Z the way it heads), so every line curls the same way round. World: the axes of the scene.' }),
    num('orient', 'Direction', 0, { unit: '°', n: 1, when: { axis: 'side' }, hint: 'Which way around the line it curls.' }),
    num('orientChaos', 'Variation direction', 0, { unit: '°', when: { axis: 'side' } }),
  ], { desc: 'Curls the line in on itself, tighter toward the tip.' }),
  modifier('Dir_Copy', 'Copy direction', [num('radial', 'Radial offset', 0, { unit: 'cm', n: 1, c: 1 })],
    { retired: true, desc: 'Makes a line follow the shape of its parent, like a vine.' }),
  modifier('Dir_AlignChildren', 'Align children', [num('amount', 'Amount %', 100, { min: 0, max: 100, n: 1 })],
    { retired: true, desc: 'Keeps child lines straight on a strongly curved parent. Place it before modifiers that curve the line.' }),
  modifier('Dir_Radial', 'Radial', [
    num('smoothing', 'Bend length', 100, { unit: 'cm', min: 0.1, n: 1, hint: 'It bends by Angle over every this much of the line, all the way to the tip.' }),
    num('angle', 'Angle bend', 45, { unit: '°', n: 1, c: 1 }),
    num('orient', 'Orientation', 0, { unit: '°', n: 1 }),
  ], { after: true, desc: 'Rolls each line in a set direction along its whole length.' }),
  modifier('Dir_Spiral', 'Spiral', [
    num('radius', 'Radius', 15, { unit: 'cm', n: 1, c: 1 }),
    num('turn', 'Turn angle', 360, { unit: '°', n: 1 }),
    en('axis', 'Axis', 'line', ['line', 'x', 'y', 'z'], { hint: 'Line coils around its own direction; X, Y and Z coil around an axis of the line (where it starts) or of the world.' }),
    en('space', 'Axes', 'local', ['local', 'world'], { when: { axis: ['x', 'y', 'z'] }, hint: 'Local: the own axes of the line where it starts, so every line coils the same way round. World: the axes of the scene.' }),
  ], { desc: 'Coils the line around its own direction or a world axis.' }),
  modifier('Dir_Zigzag', 'Zigzag', [
    num('angle', 'Angle', 25, { unit: '°', min: 0, max: 85, n: 1, c: 1, hint: 'How sharply each step turns off the line.' }),
    num('angleChaos', 'Variation angle', 0, { unit: '°', min: 0 }),
    num('steps', 'Steps', 25, { unit: 'cm', min: 0.5, n: 1 }),
    en('axis', 'Axis', 'x', ['x', 'y'], { hint: 'Which side of the line it zigzags to.' }),
  ], { desc: 'Alternates the line from side to side.' }),
  modifier('Dir_Twist', 'Twist', [num('angle', 'Angle', 90, { unit: '°', n: 1, c: 1 })],
    { after: true, desc: 'Rolls the mesh around the line.' }),
  modifier('Dir_ObjReact', 'Object reaction', [
    bool('reflect', 'Reflection', true), num('reflectDist', 'Reflection distance', 40, { unit: 'cm', n: 1 }),
    bool('prevent', 'Prevent penetration', true), num('minDist', 'Min distance', 2, { unit: 'cm' }),
    bool('magnet', 'Magnetic', false), num('magnetDist', 'Magnetic distance', 80, { unit: 'cm' }),
    num('magnetStr', 'Max strength %', 50, { min: 0, max: 100 }),
  ], { retired: 'Collide', after: true, in: [objectIn], desc: 'Lines bounce off a scene object, or are pulled toward it.' }),
  modifier('Dir_PathReact', 'Path reaction', [
    bool('reflect', 'Reflection', true), num('reflectDist', 'Reflection distance', 30, { unit: 'cm', n: 1 }),
    bool('magnet', 'Magnetic', false), num('magnetDist', 'Magnetic distance', 60, { unit: 'cm' }),
    num('magnetStr', 'Max strength %', 40, { min: 0, max: 100 }),
  ], { retired: 'Avoid intersections', after: true, desc: 'Lines of this path push apart or pull together, which stops them crossing.' }),
  modifier('Dir_ObjSlice', 'Object slice', [
    num('distance', 'Distance', 0, { unit: 'cm', n: 1 }),
    en('capEnd', 'Cap end override', 'none', caps),
    bool('erase', 'Erase the affected lines', false),
  ], { retired: true, in: [objectIn], desc: 'Cuts lines where they meet a scene object, to trim a plant to a shape.' }),
  modifier('Dir_Collide', 'Collide', [
    en('target', 'With', 'floor', ['floor', 'object'], { hint: 'The floor at Height, or a scene object (an imported mesh) connected here.' }),
    en('mode', 'Reaction', 'attract', ['attract', 'bounce', 'trim'], { hint: 'Attract lays the line along the surface, bounce turns it away, trim stops it there.' }),
    num('height', 'Floor height', 0, { unit: 'cm', when: { target: 'floor' } }),
    num('distance', 'Distance', 0, { unit: 'cm', min: 0, n: 1, hint: 'How far from the surface it reacts.' }),
    num('reach', 'Attract reach', 40, { unit: 'cm', min: 0, when: { mode: 'attract' }, hint: 'From this far it starts bending onto the surface.' }),
    num('strength', 'Strength %', 100, { min: 0, max: 100, n: 1, c: 1 }),
    bool('erase', 'Erase the whole line', false, { when: { mode: 'trim' } }),
  ], { after: true, in: [objectIn], desc: 'Lines meet the floor or a scene object: they lie along it, bounce off it or are trimmed where they touch.' }),
  modifier('Dir_Avoid', 'Avoid', [
    en('mode', 'Do', 'bend', ['bend', 'push', 'trim', 'prune'], { hint: 'Bend turns the line away in a smooth curve where it meets another; Push moves its points aside; Trim cuts it where it first touches; Prune removes the whole line.' }),
    en('with', 'Against', 'everything', ['same node', 'other nodes', 'everything'], { hint: 'Same node: lines of this node only. Other nodes: lines of other nodes only.' }),
    num('clearance', 'Clearance', 8, { unit: 'cm', min: 0.1, n: 1, hint: 'Closer than this to another line counts as touching. Allow for the thickness of both lines.' }),
    num('falloff', 'Falloff', 12, { unit: 'cm', min: 0, when: { mode: ['bend', 'push'] }, hint: 'From this far beyond the clearance it starts to react.' }),
    num('strength', 'Amount %', 100, { min: 0, max: 100, n: 1, c: 1, when: { mode: ['bend', 'push'] }, hint: 'How hard it turns or is pushed away.' }),
    num('radius', 'Bend radius', 25, { unit: 'cm', min: 1, when: { mode: 'bend' }, hint: 'The tightest curve it turns away in: larger bends more gently.' }),
    num('spread', 'Spread', 20, { unit: 'cm', min: 0, when: { mode: 'push' }, hint: 'Smooths the push along the line over this length, so it bends instead of kinking.' }),
    num('baseSkip', 'Ignore base', 10, { unit: 'cm', min: 0, hint: 'Near its base a line always touches its parent; this first stretch is left alone.' }),
  ], { desc: 'Keeps lines from running into lines grown before them (other branches, or earlier ones of this part): bends them away, pushes them aside, trims them, or removes them.' }),
  modifier('Dir_VectorOrient', 'Vector orientation', [
    vec('vector', 'Vector', [0, 1, 0], { sock: false }),
    en('axis', 'Orient axis', 'y', ['x', 'y']),
    num('strength', 'Strength %', 100, { min: 0, max: 100, n: 1, c: 1 }),
  ], { retired: true, after: true, desc: 'Rolls the line around itself so its face points along a vector. Good for leaves facing the sky.' }),
  // Old files only; Trim (Dir_Cut) took its place.
  modifier('Dir_StartEndSlice', 'Start / end slice', [
    num('start', 'Start slice', 0, { unit: 'cm', min: 0, n: 1 }),
    num('startRate', 'Start count rate %', 100, { min: 0, max: 100 }),
    num('end', 'End slice', 0, { unit: 'cm', min: 0, n: 1 }),
    num('endRate', 'End count rate %', 100, { min: 0, max: 100 }),
    en('capStart', 'Cap start override', 'none', caps),
    en('capEnd', 'Cap end override', 'none', caps),
  ], { retired: true, desc: 'Removes length from the start and end of lines.' }),
  modifier('Dir_Cut', 'Trim', [
    num('at', 'Cut at %', 70, { min: 0, max: 100, n: 1, c: 1, along: 'pos', hint: 'How much of each line stays. Its curve runs along the parent, so lines can break shorter in one part of it.' }),
    num('atChaos', 'Variation %', 20, { min: 0, max: 100, hint: 'Moves each cut a random amount up or down the line.' }),
    num('rate', 'Lines cut %', 100, { min: 0, max: 100, n: 1, c: 1, along: 'pos', hint: 'How many of the lines break; the others stay whole.' }),
  ], { desc: 'Breaks lines off at random places, like snapped branches. The cut keeps its thickness, and what grew beyond it goes.' }),
  modifier('Dir_OptimizeSteps', 'Optimize steps', [num('tolerance', 'Angle tolerance', 4, { unit: '°', min: 0, n: 1 })],
    { retired: true, desc: 'Removes points on nearly straight stretches, saving triangles without changing the shape.' }),
  modifier('Dir_Eraser', 'Eraser', [data('lines', [])],
    { tool: 'erase', desc: 'Click lines in the 3D view to erase them. Use the panel to bring them back.' }),
  modifier('Dir_Trim', 'Trim', [
    en('capEnd', 'Cap end override', 'none', caps),
    data('cuts', []),
  ], { tool: 'trim', desc: 'Click a line in the 3D view to cut it there.' }),
  modifier('Dir_OverrideSteps', 'Override steps', [
    num('steps', 'Steps', 20, { unit: 'cm', min: 0.05, n: 1, c: 1 }),
    bool('uniform', 'Uniform steps', true),
  ], { retired: 'Spline segments', desc: 'Rebuilds the line with a new segment length.' }),
  modifier('Dir_Shape', 'Shape', [num('falloff', 'Falloff', 0.3, { min: 0.02, max: 1 }), data('edits', [])],
    { after: true, tool: 'shape', desc: 'Drag a line in the 3D view to reshape it.' }),
];
