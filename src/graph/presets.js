// Built-in plants. Each is an ordinary graph, so it doubles as a worked example of the node system.
// Positions are left to the graph view, which lays them out when a plant opens.
import { defaultParams, newMod } from './schema.js';
import { migrateGraph } from './materials.js';

function builder() {
  const nodes = [];
  const links = [];
  let id = 0;
  const add = (type, params = {}, name) => {
    // A plain bark Spline still needs its look spelled out, so it gets a material of its own.
    const look = type === 'Spline' && params.texture === undefined && params.meshType !== 'cutout' && (params.meshType ?? 'tube') === 'tube' ? { texture: 'bark:brown' } : {};
    const n = { id: `n${++id}`, type, x: 0, y: 0, name, on: true, params: { ...defaultParams(type), ...look, ...params } };
    nodes.push(n);
    return n;
  };
  return {
    nodes, links, add,
    // The child's Placement picks up what it's connected to, the same as connecting by hand.
    grow(parent, child) {
      links.push({ id: `l${links.length + 1}`, from: parent.id, fromSock: parent.type === 'GroundPatch' ? 'out' : 'children', to: child.id, toSock: 'parent' });
      return child;
    },
    link(a, aSock, b, bSock) { links.push({ id: `l${links.length + 1}`, from: a.id, fromSock: aSock, to: b.id, toSock: bSock }); },
    done: (settings = {}) => migrateGraph({ nodes, links, groups: [], settings: { seed: 7, unitCalc: 100, segLimit: 400, maxSegments: 400000, maxLines: 150000, ...settings } }),
  };
}

// The usual stack: Noise and Gravity always there, and anything extra after them.
const stack = ({ noise = 0, noiseScale = 80, rough = 0, pull = 0, toward = [0, -1, 0], extra = [] } = {}) => [
  newMod('noise', 'Dir_Noise', { strength: noise, scale: noiseScale, rough }, { name: 'Noise' }),
  newMod('gravity', 'Dir_Vector', { vector: toward, strength: pull }, { name: 'Gravity' }),
  ...extra,
];
const randomly = (max, smoothing = 100, min = 0) => newMod('random', 'Dir_Random', { max, min, smoothing }, { name: 'Random direction' });
const curve = (...pts) => ({ pts: pts.map(([x, y]) => [x, y, 's']) });
const onParent = { place: 'spline' };
// A 0 to 1 setting as the gray of its color slot.
const grayOf = (v) => { const h = Math.round(v * 255).toString(16).padStart(2, '0'); return `#${h}${h}${h}`; };
const BARK = { roughColor: grayOf(0.85) };
const leafy = (sss = 0.45) => ({ sssColor: grayOf(sss), roughColor: grayOf(0.65) });

function broadleaf() {
  const g = builder();
  const trunk = g.add('Spline', {
    length: 640, steps: 26, mods: stack({ noise: 22, noiseScale: 140, rough: 0.4, pull: 0.25, toward: [0, 1, 0] }),
    radius: 24, sides: 16, minRadius: 1, blend: false, ...BARK, curves: { radius: curve([0, 1], [0.08, 0.72], [1, 0.1]) },
  }, 'Trunk');
  const branch = g.grow(trunk, g.add('Spline', {
    ...onParent, density: 2.1, start: 34, end: 97, tilt: 58, vary: { tilt: 12, length: 22 }, tipTilt: 20, ...BARK,
    // Branches shorten toward the top of the trunk.
    length: 340, steps: 22, wire: '#7fe0a0', curves: { length: curve([0, 1], [0.45, 0.95], [1, 0.32]), radius: curve([0, 1], [1, 0.12]) },
    mods: stack({ pull: 0.42, toward: [0, 1, 0], extra: [randomly(34, 200, 4)] }),
    radius: 11, sides: 10, autoRadius: true, autoFactor: 0.62, minRadius: 0.6, minSides: 6,
  }, 'Branches'));
  const twig = g.grow(branch, g.add('Spline', {
    ...onParent, density: 8, start: 22, end: 100, tilt: 48, vary: { tilt: 14, length: 35 }, tipTilt: 25, ...BARK,
    length: 105, steps: 16, wire: '#b5e27a', mods: stack({ pull: 0.6, toward: [0, 1, 0], extra: [randomly(28, 60)] }),
    radius: 2.4, sides: 6, autoRadius: true, autoFactor: 0.55, minRadius: 0.2, minSides: 4, capTop: false,
    blendLength: 1.2, blendFlare: 0.6, blendRings: 3, blendCollar: 0.2, curves: { radius: curve([0, 1], [1, 0.12]) },
  }, 'Twigs'));
  g.grow(twig, g.add('Spline', {
    ...onParent, density: 34, start: 8, end: 100, tilt: 52, vary: { tilt: 16, length: 30, tintColor: 100 }, tipTilt: 10,
    length: 22, steps: 4, wire: '#d7ef6e', mods: stack({ pull: 1.6 }),
    meshType: 'cutout', angleAcross: 14, incAcross: 0, sideSteps: 1, ...leafy(), tintColor: '#c9dc8e', texture: null,
  }, 'Leaves'));
  return g.done();
}

function conifer() {
  const g = builder();
  const trunk = g.add('Spline', {
    length: 900, steps: 40, radius: 20, sides: 12, minRadius: 0.6, blend: false, texture: 'bark:dark', ...BARK, curves: { radius: curve([0, 1], [1, 0.04]) },
  }, 'Trunk');
  const branch = g.grow(trunk, g.add('Spline', {
    ...onParent, density: 7, start: 14, end: 98, tilt: 82, vary: { tilt: 8, length: 18 }, tipOn: false, ...BARK,
    length: 330, steps: 22, mods: stack({ pull: 0.25 }), curves: { length: curve([0, 1], [1, 0.08]), radius: curve([0, 1], [1, 0.12]) },
    radius: 5, sides: 6, autoRadius: true, autoFactor: 0.45, minRadius: 0.3, minSides: 4, texture: 'bark:dark', blendLength: 1.2, blendFlare: 0.5, blendCollar: 0.2, blendRings: 3,
  }, 'Branches'));
  const twig = g.grow(branch, g.add('Spline', {
    ...onParent, density: 10, start: 12, pattern: 'alternate', tilt: 58, tipTilt: 5, vary: { length: 25 },
    length: 60, steps: 12, meshType: 'none',
  }, 'Side twigs'));
  // Conifer needles: a path as long as one needle, with very narrow flat leaves, costs the fewest faces.
  g.grow(twig, g.add('Spline', {
    ...onParent, density: 40, start: 0, pattern: 'pairs', tilt: 62, vary: { tilt: 8 }, tipOn: false,
    length: 11, steps: 11, meshType: 'leaf', leafType: 'card', width: 0.4, angleAcross: 0, incAcross: 0, softNormals: 0.6,
    color: '#2f5b3a', roughColor: grayOf(0.7), texture: null,
  }, 'Needles'));
  return g.done();
}

function junctionStudy() {
  const g = builder();
  const stem = g.add('Spline', { length: 260, steps: 20, radius: 26, sides: 28, minRadius: 12, blend: false, curves: { radius: curve([0, 1], [1, 0.75]) } }, 'Stem');
  g.grow(stem, g.add('Spline', {
    ...onParent, density: 1.6, start: 25, end: 85, tilt: 62, tipOn: false,
    length: 130, steps: 14, radius: 13, sides: 20, minRadius: 5, blendRings: 8, blendLength: 2.2, blendFlare: 1.1, blendCollar: 0.5, curves: { radius: curve([0, 1], [1, 0.5]) },
  }, 'Limbs'));
  return g.done();
}

function shrub() {
  const g = builder();
  const stem = g.add('Spline', {
    count: 9, tilt: 26, vary: { tilt: 16, length: 30 }, length: 190, ...BARK, steps: 16, mods: stack({ noise: 8, noiseScale: 70 }),
    radius: 3.2, sides: 7, minRadius: 0.3, minSides: 4, texture: 'bark:grey', curves: { radius: curve([0, 1], [1, 0.12]) },
  }, 'Stems');
  g.grow(stem, g.add('Spline', {
    ...onParent, density: 40, start: 18, tilt: 55, vary: { tilt: 16, length: 25 },
    length: 26, steps: 5, mods: stack({ pull: 1.2 }), meshType: 'cutout', angleAcross: 16, incAcross: 4, sideSteps: 2, ...leafy(), texture: null,
  }, 'Leaves'));
  g.grow(stem, g.add('Mesh', {
    ...onParent, density: 3, start: 45, tilt: 70, scale: 100, vary: { scale: 30, tilt: 20 }, tipOn: false,
    shape: 'sphere', radius: 3, segments: 10, color: '#b92a2a', roughColor: grayOf(0.35),
  }, 'Berries'));
  return g.done();
}

function grass() {
  const g = builder();
  const patch = g.add('Mesh', { shape: 'disk', radius: 150, segments: 32, show: false }, 'Ground patch');
  g.grow(patch, g.add('Spline', {
    place: 'mesh', count: 1400, spacing: 'random', tilt: 16, vary: { rotation: 180, tilt: 14, length: 45, tintColor: 100 },
    length: 70, steps: 9, wire: '#7fe0a0', mods: stack({ pull: 0.9, extra: [randomly(14, 40)] }),
    meshType: 'leaf', width: 1.3, angleAcross: 16, incAcross: 0, softNormals: 0.5, curves: { width: curve([0, 0.65], [0.3, 1], [1, 0.03]) },
    color: '#9cc653', ...leafy(0.3), roughColor: grayOf(0.7), texture: null, tintColor: '#7fae46', gradOn: true, gradient: [[0, '#4a6a30'], [0.6, '#ffffff']],
  }, 'Blades'));
  return g.done();
}

function flowers() {
  const g = builder();
  const patch = g.add('Mesh', { shape: 'disk', radius: 90, segments: 32, show: false }, 'Ground patch');
  const stem = g.grow(patch, g.add('Spline', {
    place: 'mesh', count: 22, spacing: 'even', minDist: 12, tilt: 6, vary: { tilt: 5, length: 30 },
    length: 75, steps: 8, wire: '#7fe0a0', mods: stack({ extra: [randomly(10, 30)] }),
    radius: 0.55, sides: 6, minRadius: 0.2, minSides: 4, capTop: false, blend: false, color: '#4f8a35', texture: null, roughColor: grayOf(0.7), curves: { radius: curve([0, 1], [1, 0.6]) },
  }, 'Stems'));
  g.grow(stem, g.add('Spline', {
    ...onParent, density: 7, start: 8, end: 70, tilt: 55, vary: { tilt: 15, length: 25 }, tipOn: false,
    length: 20, steps: 5, mods: stack({ pull: 0.7 }), meshType: 'leaf', width: 2.4, angleAcross: 14, incAcross: 0, softNormals: 0.4, color: '#5c9a3a', ...leafy(0.35), roughColor: grayOf(0.7), texture: null,
  }, 'Stem leaves'));
  // A ring of petals at the stem tip, around a round center.
  g.grow(stem, g.add('Spline', {
    place: 'ring', count: 10, ringRadius: 0.5, tilt: 62, vary: { tilt: 8, length: 12, tintColor: 100 },
    length: 12, steps: 3, meshType: 'leaf', width: 3.4, angleAcross: 8, incAcross: 0, softNormals: 0.6, curves: { width: curve([0, 0.06], [0.6, 1], [1, 0.45]) },
    color: '#f0659a', ...leafy(0.5), roughColor: grayOf(0.6), texture: null, tintColor: '#e4a0c4',
  }, 'Petals'));
  g.grow(stem, g.add('Mesh', {
    place: 'point', count: 1, shape: 'sphere', radius: 2.2, segments: 12, scl: [1, 0.7, 1], vary: { scale: 15 }, color: '#f4c542', roughColor: grayOf(0.75),
  }, 'Flower center'));
  return g.done();
}

// One leafy branch lying flat to the front view: the starting point for baking a branch atlas.
function branchForBaking() {
  const g = builder();
  const branch = g.add('Spline', {
    // Turned so its twigs spread left and right in the front view.
    length: 120, steps: 12, rotZ: 90, mods: stack({ noise: 4, noiseScale: 60 }), ...BARK,
    radius: 1.6, sides: 8, minRadius: 0.3, minSides: 4, blend: false, capTop: false, curves: { radius: curve([0, 1], [1, 0.2]) },
  }, 'Branch');
  const twig = g.grow(branch, g.add('Spline', {
    ...onParent, density: 4, start: 20, end: 92, pattern: 'alternate', tilt: 48, vary: { tilt: 8, length: 20 }, tipTilt: 10, ...BARK,
    // Alternate twigs stay in the branch's plane, so the front view sees them flat.
    length: 34, steps: 8, mods: stack({ pull: 0.2, toward: [0, 1, 0] }), radius: 0.6, sides: 6, minRadius: 0.15, minSides: 4, capTop: false,
    blendLength: 1, blendFlare: 0.5, blendRings: 3, curves: { radius: curve([0, 1], [1, 0.2]) },
  }, 'Twigs'));
  g.grow(twig, g.add('Spline', {
    ...onParent, density: 24, start: 12, end: 100, pattern: 'alternate', tilt: 52, vary: { tilt: 10, length: 20, tintColor: 100 }, tipTilt: 6,
    length: 13, steps: 3, mods: stack({ pull: 0.4 }), meshType: 'cutout', angleAcross: 10, incAcross: 0, ...leafy(), tintColor: '#c9dc8e', texture: null,
  }, 'Leaves'));
  return g.done();
}

export const PRESETS = {
  'Broadleaf tree': broadleaf,
  'Branch for baking': branchForBaking,
  'Conifer': conifer,
  'Shrub with berries': shrub,
  'Grass patch': grass,
  'Flowers': flowers,
  'Junction study (blend close-up)': junctionStudy,
};

export const DEFAULT_PRESET = 'Broadleaf tree';
