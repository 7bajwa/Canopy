// Direction modifier node definitions. `after: true` means it may also run after the mesh is built.
import { num, int, bool, en, crv, data, vec } from './defs-helpers.js';

const objectIn = { k: 'object', kind: 'object', side: 'left', l: 'Object' };
const caps = ['none', 'planar', 'spherical'];

const modifier = (type, title, params, o = {}) => ({
  type, title, cat: 'mod', chain: 'dir', params, ...o,
  in: [{ k: 'in', kind: 'dir', side: 'top' }, ...(o.in || [])],
  out: [{ k: 'out', kind: 'dir', side: 'bottom' }],
});

export const modDefs = [
  modifier('Dir_Random', 'Random direction', [
    num('smoothing', 'Smoothing', 100, { unit: 'cm', min: 0.1, n: 1 }),
    num('min', 'Min angle', 0, { unit: '°', n: 1 }),
    num('max', 'Max angle', 25, { unit: '°', n: 1, c: 1 }),
  ], { after: true, desc: 'Bends each line in its own random direction.' }),
  modifier('Dir_Vector', 'Vector direction', [
    en('source', 'Vector source', 'global', ['global', 'local', 'point', 'surface'], { n: 1 }),
    vec('vector', 'Vector / target', [0, 1, 0], { sock: false }),
    en('mode', 'Orientation', 'vector', ['vector', 'horizontal']),
    num('strength', 'Strength', 0.4, { n: 1, c: 1 }),
  ], { after: true, in: [objectIn], desc: 'Turns lines toward a direction, a point or a surface. Use it for gravity and for reaching to the light.' }),
  modifier('Dir_Noise', 'Noise direction', [
    num('scale', 'Scale', 80, { unit: 'cm', min: 0.1, n: 1 }),
    num('phase', 'Phase', 0),
    int('seed', 'Random seed', 0),
    num('strength', 'Strength', 15, { unit: 'cm', n: 1, c: 1 }),
    num('sx', 'X scale', 1), num('sy', 'Y scale', 1),
    num('rough', 'Roughness', 0, { min: 0, max: 1 }),
    int('iter', 'Iterations', 3, { min: 1, max: 10 }),
    bool('shift', 'Shift start point', false),
  ], { after: true, desc: 'Adds an organic wobble along each line.' }),
  modifier('Dir_Deviation', 'Deviation direction', [
    bool('fromChild', 'Angle from child vector', true),
    num('angle', 'Angle', 15, { unit: '°', n: 1 }),
    num('tolerance', 'Tolerance', 5, { unit: 'cm', min: 0 }),
  ], { desc: 'Kinks the parent away from each child where it grows, the way real wood zigzags at its forks.' }),
  modifier('Dir_Spline', 'Spline direction', [
    crv('shapeA', 'Shape A', { pts: [[0, 0.5, 's'], [0.5, 0.8, 's'], [1, 0.3, 's']] }),
    crv('shapeB', 'Shape B', { pts: [[0, 0.5, 's'], [0.5, 0.2, 's'], [1, 0.7, 's']] }),
    num('orient', 'Orientation', 0, { unit: '°', n: 1 }),
    num('orientChaos', 'Variation angle', 0, { unit: '°' }),
    num('scale', 'Scale', 1, { min: 0, n: 1 }),
    num('scaleChaos', 'Variation scale %', 0, { min: 0, max: 100 }),
    num('blend', 'Interpolation value', 0, { min: 0, max: 1 }),
  ], { desc: 'Makes lines follow a drawn profile, blending between two shapes.' }),
  modifier('Dir_HardBend', 'Hard bend', [
    num('position', 'Position %', 50, { min: 0, max: 100, n: 1 }),
    num('posChaos', 'Variation position %', 0, { min: 0, max: 100 }),
    num('angle', 'Angle', 40, { unit: '°', n: 1 }),
    num('angleChaos', 'Variation angle', 0, { unit: '°' }),
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
  modifier('Dir_Copy', 'Copy direction', [num('radial', 'Radial offset', 0, { unit: 'cm', n: 1, c: 1 })],
    { desc: 'Makes a line follow the shape of its parent, like a vine.' }),
  modifier('Dir_AlignChildren', 'Align children', [num('amount', 'Amount %', 100, { min: 0, max: 100, n: 1 })],
    { desc: 'Keeps child lines straight on a strongly curved parent. Place it before modifiers that curve the line.' }),
  modifier('Dir_Radial', 'Radial direction', [
    num('smoothing', 'Smoothing', 100, { unit: 'cm', min: 0.1, n: 1 }),
    num('angle', 'Angle bend', 45, { unit: '°', n: 1, c: 1 }),
    num('orient', 'Orientation', 0, { unit: '°', n: 1 }),
  ], { after: true, desc: 'Curls each line in a set direction.' }),
  modifier('Dir_Spiral', 'Spiral direction', [
    num('radius', 'Radius', 15, { unit: 'cm', n: 1, c: 1 }),
    num('turn', 'Turn angle', 360, { unit: '°', n: 1 }),
  ], { desc: 'Coils the line around its own direction.' }),
  modifier('Dir_Zigzag', 'Zigzag direction', [
    num('radius', 'Radius', 6, { unit: 'cm', n: 1 }),
    num('steps', 'Steps', 25, { unit: 'cm', min: 0.5, n: 1 }),
  ], { desc: 'Alternates the line from side to side.' }),
  modifier('Dir_Twist', 'Twist direction', [num('angle', 'Angle', 90, { unit: '°', n: 1, c: 1 })],
    { after: true, desc: 'Rolls the mesh around the line.' }),
  modifier('Dir_ObjReact', 'Object reaction', [
    bool('reflect', 'Reflection', true), num('reflectDist', 'Reflection distance', 40, { unit: 'cm', n: 1 }),
    bool('prevent', 'Prevent penetration', true), num('minDist', 'Min distance', 2, { unit: 'cm' }),
    bool('magnet', 'Magnetic', false), num('magnetDist', 'Magnetic distance', 80, { unit: 'cm' }),
    num('magnetStr', 'Max strength %', 50, { min: 0, max: 100 }),
  ], { after: true, in: [objectIn], desc: 'Lines bounce off a scene object, or are pulled toward it.' }),
  modifier('Dir_PathReact', 'Path reaction', [
    bool('reflect', 'Reflection', true), num('reflectDist', 'Reflection distance', 30, { unit: 'cm', n: 1 }),
    bool('magnet', 'Magnetic', false), num('magnetDist', 'Magnetic distance', 60, { unit: 'cm' }),
    num('magnetStr', 'Max strength %', 40, { min: 0, max: 100 }),
  ], { after: true, desc: 'Lines of this path push apart or pull together, which stops them crossing.' }),
  modifier('Dir_ObjSlice', 'Object slice', [
    num('distance', 'Distance', 0, { unit: 'cm', n: 1 }),
    bool('keepLength', 'No affect length', true),
    en('capEnd', 'Cap end override', 'none', caps),
    bool('erase', 'Erase the affected lines', false),
  ], { in: [objectIn], desc: 'Cuts lines where they meet a scene object, to trim a plant to a shape.' }),
  modifier('Dir_Collide', 'Collide', [
    en('target', 'With', 'floor', ['floor', 'object'], { hint: 'The floor at Height, or a scene object (an imported mesh) connected here.' }),
    en('mode', 'Reaction', 'attract', ['attract', 'bounce', 'trim'], { hint: 'Attract lays the line along the surface, bounce turns it away, trim stops it there.' }),
    num('height', 'Floor height', 0, { unit: 'cm', when: { target: 'floor' } }),
    num('distance', 'Distance', 0, { unit: 'cm', min: 0, n: 1, hint: 'How far from the surface it reacts.' }),
    num('reach', 'Attract reach', 40, { unit: 'cm', min: 0, when: { mode: 'attract' }, hint: 'From this far it starts bending onto the surface.' }),
    num('strength', 'Strength %', 100, { min: 0, max: 100, n: 1, c: 1 }),
    bool('erase', 'Erase the whole line', false, { when: { mode: 'trim' } }),
  ], { after: true, in: [objectIn], desc: 'Lines meet the floor or a scene object: they lie along it, bounce off it or are trimmed where they touch.' }),
  modifier('Dir_Avoid', 'Avoid intersections', [
    en('mode', 'Do', 'push', ['push', 'trim', 'prune'], { hint: 'Push moves the line\'s points away from lines it comes close to; Trim cuts it where it first touches; Prune removes the whole line.' }),
    num('clearance', 'Clearance', 8, { unit: 'cm', min: 0.1, n: 1, hint: 'Closer than this to another line counts as touching. Allow for both lines\' thickness.' }),
    num('falloff', 'Falloff', 12, { unit: 'cm', min: 0, hint: 'Beyond the clearance the push fades out over this distance.' }),
    num('strength', 'Amount %', 100, { min: 0, max: 100, n: 1, c: 1, when: { mode: 'push' }, hint: 'How much of the way out to the clearance a touching point is pushed.' }),
    num('spread', 'Spread', 20, { unit: 'cm', min: 0, when: { mode: 'push' }, hint: 'Smooths the push along the line over this length, so it bends instead of kinking.' }),
    num('baseSkip', 'Ignore base', 10, { unit: 'cm', min: 0, hint: 'Near its base a line always touches its parent; this first stretch is left alone.' }),
  ], { desc: 'Keeps lines from running into lines grown before them (other branches, or earlier ones of this part): pushes them aside, trims them, or removes them.' }),
  modifier('Dir_VectorOrient', 'Vector orientation', [
    vec('vector', 'Vector', [0, 1, 0], { sock: false }),
    en('axis', 'Orient axis', 'y', ['x', 'y']),
    num('strength', 'Strength %', 100, { min: 0, max: 100, n: 1, c: 1 }),
  ], { after: true, desc: 'Rolls the line around itself so its face points along a vector. Good for leaves facing the sky.' }),
  modifier('Dir_StartEndSlice', 'Start / end slice', [
    num('start', 'Start slice', 0, { unit: 'cm', min: 0, n: 1 }),
    num('startRate', 'Start count rate %', 100, { min: 0, max: 100 }),
    num('end', 'End slice', 0, { unit: 'cm', min: 0, n: 1 }),
    num('endRate', 'End count rate %', 100, { min: 0, max: 100 }),
    bool('keepLength', 'No affect length', true),
    en('capStart', 'Cap start override', 'none', caps),
    en('capEnd', 'Cap end override', 'none', caps),
  ], { desc: 'Removes length from the start and end of lines.' }),
  modifier('Dir_OptimizeSteps', 'Optimize steps', [num('tolerance', 'Angle tolerance', 4, { unit: '°', min: 0, n: 1 })],
    { desc: 'Removes points on nearly straight stretches, saving triangles without changing the shape.' }),
  modifier('Dir_Eraser', 'Eraser', [data('lines', [])],
    { tool: 'erase', desc: 'Click lines in the 3D view to erase them. Use the panel to bring them back.' }),
  modifier('Dir_Trim', 'Trim', [
    bool('keepLength', 'No affect length', true),
    en('capEnd', 'Cap end override', 'none', caps),
    data('cuts', []),
  ], { tool: 'trim', desc: 'Click a line in the 3D view to cut it there.' }),
  modifier('Dir_OverrideSteps', 'Override steps', [
    num('steps', 'Steps', 20, { unit: 'cm', min: 0.05, n: 1, c: 1 }),
    bool('uniform', 'Uniform steps', true),
  ], { desc: 'Rebuilds the line with a new segment length.' }),
  modifier('Dir_Shape', 'Shape', [num('falloff', 'Falloff', 0.3, { min: 0.02, max: 1 }), data('edits', [])],
    { after: true, tool: 'shape', desc: 'Drag a line in the 3D view to reshape it.' }),
];
