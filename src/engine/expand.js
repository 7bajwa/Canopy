// Turns the all-in-one Spline and Mesh nodes into the engine's smaller building blocks. Hidden parts
// are named owner#part, so results can be traced back to the node a person actually sees.
import { NODE_TYPES, defaultParams, hasTabs } from '../graph/schema.js';
import { bakeShape } from './primitive.js';
import { DEG, shapeXf } from './math.js';
import { MATERIAL_FIELDS, NO_MATERIAL, materialOf } from '../graph/materials.js';

const makeNode = (id, type, on, params) => ({ id, type, on, params: { ...defaultParams(type), ...params } });

const gray = (hex) => parseInt(String(hex || '#808080').slice(1, 3), 16) / 255;

// Sorts a node's settings into the parts its `to` field names. A value's curves go with it, one per level of its chain.
function split(n) {
  const parts = {};
  for (const p of NODE_TYPES[n.type].params) {
    if (!p.to || n.params[p.k] === undefined) continue;
    const part = (parts[p.to] ||= {});
    part[p.k] = n.params[p.k];
    const vary = n.params.vary?.[p.k];
    if (vary) (part.vary ||= {})[p.k] = vary;
    for (const [key, curve] of Object.entries(n.params.curves || {})) {
      if (key === p.k || key.startsWith(`${p.k}@`)) (part.curves ||= {})[key] = curve;
    }
  }
  return parts;
}

// Placement falls back to what makes sense for what's connected.
function placeMode(stored, parentKind) {
  if (parentKind === 'mesh') return stored === 'spline' || stored === 'sprouts' ? 'mesh' : stored;
  if (parentKind === 'spline') return stored === 'mesh' ? 'spline' : stored;
  return stored === 'spline' || stored === 'mesh' || stored === 'sprouts' ? 'point' : stored;
}

function placementNode(n, parts, parentKind, extra = {}) {
  const mode = placeMode(n.params.place, parentKind);
  return makeNode(`${n.id}#place`, 'Placement', n.on, {
    ...parts.place, place: mode, levels: mode === 'spline' ? n.params.levels : 1, inst: n.params.inst, ...extra,
  });
}

// The enabled modifiers as a chain hanging from the hidden path.
function chainMods(n, pathId, nodes, links) {
  let prev = pathId; let sock = 'dir';
  for (const m of n.params.mods || []) {
    if (m.on === false || !NODE_TYPES[m.type]) continue;
    const id = `${n.id}#m${m.id}`;
    nodes.push(makeNode(id, m.type, n.on, m.params));
    links.push({ id: `${id}:in`, from: prev, fromSock: sock, to: id, toSock: 'in' });
    if (m.params.object) links.push({ id: `${id}:obj`, from: objectIdOf(m.params.object, nodes), fromSock: 'out', to: id, toSock: 'object' });
    prev = id; sock = 'out';
  }
}

const objectIdOf = (id, nodes) => (nodes.some((x) => x.id === `${id}#obj`) ? `${id}#obj` : id);

// The node's scene material, or its own settings in a file from before materials, or plain gray.
function lookOf(graph, n) {
  const mat = materialOf(graph, n);
  if (mat) return mat;
  const P = n.params;
  if (P.color !== undefined || P.texture !== undefined || P.atlas !== undefined || (P.meshType === 'cutout' && P.material === undefined)) {
    const look = { ...MATERIAL_FIELDS };
    for (const k of Object.keys(MATERIAL_FIELDS)) if (P[k] !== undefined) look[k] = P[k];
    if (P.meshType === 'cutout') look.texture = P.atlas || look.texture || 'atlas:broadleaf';
    if (P.roughColor === undefined && P.roughness !== undefined) look.roughness = +P.roughness;
    if (P.sssColor === undefined && P.sss !== undefined) { const h = Math.round(+P.sss * 255).toString(16).padStart(2, '0'); look.sssColor = `#${h}${h}${h}`; }
    if (P.tintOn && P.tintAmount === undefined) look.tintAmount = 100;
    return look;
  }
  return NO_MATERIAL;
}

// A material plus the node's own color variation and vertex colors, in the form the mesh builders read.
function surfaceOf(graph, n, parts, kind) {
  const P = n.params;
  const look = lookOf(graph, n);
  const m = { ...parts.mesh };
  for (const k of Object.keys(MATERIAL_FIELDS)) if (k !== 'cutouts') m[k] = look[k];
  // Bark on a leaf makes no sense, and a leaf's texture is its cutout atlas.
  if (kind !== 'tube' && String(m.texture).startsWith('bark:')) m.texture = null;
  if (kind === 'cutout') m.texture = null;
  // While a texture is in a slot, its color box is ignored.
  if (m.texture || kind === 'cutout') m.color = '#ffffff';
  m.roughness = look.roughness ?? gray(look.roughColor);
  const amount = +(P.tintAmount ?? look.tintAmount ?? 0);
  m.tintOn = amount > 0;
  m.tintAmount = amount;
  m.tintCurve = P.curves?.tintAmount || null;
  // Only the slots that differ from "no effect" cost anything to draw.
  if (m.normalColor === '#8080ff') m.normalColor = null;
  if (m.aoColor === '#ffffff') m.aoColor = null;
  if (m.opacityColor === '#ffffff') m.opacityColor = null;
  return { m, look };
}

// The mesh types a Spline has switched on, 'tube+leaf' and the like.
export const meshKinds = (P) => String(P.meshType || 'none').split('+').filter((k) => k && k !== 'none');

function meshBuilder(graph, n, parts, nodes, links, pathId) {
  const kinds = meshKinds(n.params);
  for (const kind of kinds) {
    // Leaves keep the #mesh name (sprout points and wind look for it); a tube beside them is #tube.
    const both = kinds.length > 1;
    const id = kind === 'tube' && both ? `${n.id}#tube` : `${n.id}#mesh`;
    const src = kind === 'tube' && both && n.params.tubeMaterial ? { ...n, params: { ...n.params, material: n.params.tubeMaterial } } : n;
    const { m, look } = surfaceOf(graph, src, parts, kind);
    const common = { ...m, meshMods: n.params.meshMods, uvOn: true, owned: true };
    if (kind === 'tube') {
      // No floor on thickness or sides: a twig's tip tapers as thin as its curve says.
      nodes.push(makeNode(id, 'CylinderMesh', n.on, { ...common, minRadius: 0, minSides: 3, capEnd: n.params.capTop === false ? 'none' : 'spherical', capStart: n.params.capBottom ? 'spherical' : 'none' }));
    } else {
      if (kind === 'cutout') {
        const cutId = `${n.id}#cut`;
        // The material carries the cutouts; the node can use some of them.
        const all = look.cutouts?.length ? look.cutouts : n.params.cutouts || [];
        const pick = n.params.cutoutPick;
        const cutouts = Array.isArray(pick) ? all.filter((c, i) => pick.includes(c.id ?? i)) : all;
        nodes.push(makeNode(cutId, 'LeafCutout', n.on, { ...parts.cut, cutouts, none: Array.isArray(pick) && !pick.length, atlas: look.texture ?? n.params.atlas ?? null }));
        links.push({ id: `${cutId}:out`, from: cutId, fromSock: 'out', to: id, toSock: 'shape' });
      } else if (common.leafType === 'card' && common.curves) {
        // A card is a plain rectangle, so the outline on Width doesn't apply.
        const { width, ...rest } = common.curves;
        common.curves = rest;
      }
      nodes.push(makeNode(id, 'LeavesMesh', n.on, { ...common, meshType: kind, outline: { pts: [[0, 1, 'c'], [1, 1, 'c']] } }));
    }
    links.push({ id: `${id}:in`, from: pathId, fromSock: 'mesh', to: id, toSock: 'in' });
    // Lines that carry leaves: the Season and Health sliders work on them (see engine/life.js).
    if (kind !== 'tube') { const path = nodes.find((x) => x.id === pathId); if (path) path.params.leafy = true; }
  }
}

function expandSpline(graph, n, parentKind, nodes, links) {
  const parts = split(n);
  const placeId = `${n.id}#place`; const pathId = `${n.id}#path`;
  if (n.params.strokes?.length) {
    // Lines drawn by hand in the 3D view (the Draw tool): they stand where they were drawn, on their parent's lines.
    nodes.push(makeNode(pathId, 'DrawPath', n.on, { strokes: n.params.strokes, length: 1e6, capToDrawing: true, wire: n.params.wire }));
  } else {
    nodes.push(placementNode(n, parts, parentKind));
    // Growth: the line grows itself into a whole branching tree from each start point (engine/growth.js).
    nodes.push(makeNode(pathId, n.params.growOn ? 'GrowthPath' : 'Path', n.on, { ...parts.path, visible: true }));
    links.push({ id: `${pathId}:in`, from: placeId, fromSock: 'out', to: pathId, toSock: 'in' });
  }
  chainMods(n, pathId, nodes, links);
  meshBuilder(graph, n, parts, nodes, links, pathId);
}

// A mesh is placed as copies along short hidden lines; its baked shape also serves as a surface to grow on.
function expandMesh(graph, n, parentKind, nodes, links) {
  const parts = split(n);
  const placeId = `${n.id}#place`; const pathId = `${n.id}#path`; const buildId = `${n.id}#mesh`; const elId = `${n.id}#el`;
  nodes.push(placementNode(n, parts, parentKind, { identity: true }));
  nodes.push(makeNode(pathId, 'Path', n.on, { ...parts.path, length: 1, steps: 1, wire: n.params.wire, windRigid: true }));
  links.push({ id: `${pathId}:in`, from: placeId, fromSock: 'out', to: pathId, toSock: 'in' });
  const P0 = n.params;
  const local = (P0.mods || []).filter((m) => m.params?.space !== 'all together');
  // The transform values use the gizmo's axes (Z up); a lone Mesh's own axes are the world's.
  const pos = [+P0.posX || 0, +P0.posZ || 0, -(+P0.posY || 0)];
  const u = P0.sclU ?? 1;
  const xf = shapeXf([+P0.rotX || 0, +P0.rotY || 0, +P0.rotZ || 0].map((a) => a * DEG), [(P0.sclX ?? 1) * u, (P0.sclY ?? 1) * u, (P0.sclZ ?? 1) * u]);
  const surface = bakeShape({ ...P0, mods: local, pos, rot: [0, 0, 0], scl: [1, 1, 1], xf });
  // copyFrom lets children find the same spot on every copy: the surface is the first copy, baked where it stands.
  nodes.push(makeNode(`${n.id}#obj`, 'SceneObject', n.on, { shape: 'imported', obj: surface, pos: [0, 0, 0], size: [100, 100, 100], display: false, copyFrom: { pos, sclU: u } }));
  if (n.params.show === false) return;
  // Each copy gets its own transform from the Placement, so the shape it copies is baked without one.
  const obj = bakeShape({ ...n.params, mods: local, pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] });
  const globalMods = (P0.mods || []).filter((m) => m.on !== false && m.params?.space === 'all together');
  nodes.push(makeNode(buildId, 'InstancedGeometry', n.on, { ...surfaceOf(graph, n, parts, 'tube').m, position: 0, scale: 100, randomScale: 0, owned: true, globalMods, cropUnder: !!P0.cropUnder }));
  nodes.push(makeNode(elId, 'InstancedElement', n.on, { shape: 'imported', obj, size: 100, color: '#ffffff', rate: 100 }));
  links.push(
    { id: `${buildId}:in`, from: pathId, fromSock: 'mesh', to: buildId, toSock: 'in' },
    { id: `${elId}:out`, from: elId, fromSock: 'out', to: buildId, toSock: 'elements' },
  );
}

export function expandGraph(graph) {
  if (!graph.nodes.some((n) => hasTabs(n.type))) return graph;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = graph.nodes.filter((n) => !hasTabs(n.type));
  const links = [];
  const kindOfParent = new Map();
  for (const l of graph.links) {
    const to = byId.get(l.to); const from = byId.get(l.from);
    if (!to || !from || l.toSock !== 'parent' || !hasTabs(to.type)) continue;
    kindOfParent.set(to.id, from.type === 'Spline' ? 'spline' : 'mesh');
  }
  // Meshes first, so anything that names one as an object finds its baked surface.
  const unified = graph.nodes.filter((n) => hasTabs(n.type)).sort((a, b) => (a.type === 'Mesh' ? 0 : 1) - (b.type === 'Mesh' ? 0 : 1));
  for (const n of unified) {
    if (n.type === 'Mesh') expandMesh(graph, n, kindOfParent.get(n.id), nodes, links);
    else expandSpline(graph, n, kindOfParent.get(n.id), nodes, links);
  }
  for (let l of graph.links) {
    const to = byId.get(l.to); let from = byId.get(l.from);
    if (!to || !from) continue;
    // An exposed setting's output comes from the part that setting drives.
    if (l.fromSock.startsWith('o:') && hasTabs(from.type)) {
      const p = NODE_TYPES[from.type].params.find((x) => x.k === l.fromSock.slice(2));
      if (!p?.to) continue;
      l = { ...l, from: `${from.id}#${p.to}` };
      from = { type: 'part' };
    }
    if (!hasTabs(to.type)) {
      // A classic node reading a Mesh as its object.
      links.push(from.type === 'Mesh' ? { ...l, from: `${from.id}#obj`, fromSock: 'out' } : l);
      continue;
    }
    if (l.toSock === 'parent') {
      if (to.params.strokes?.length) { if (from.type === 'Spline') links.push({ ...l, from: `${from.id}#path`, fromSock: 'children', to: `${to.id}#path`, toSock: 'parent' }); } else if (from.type === 'Spline') links.push({ ...l, from: `${from.id}#path`, fromSock: 'children', to: `${to.id}#place`, toSock: 'parent' });
      else if (from.type === 'Mesh') {
        // The surface to grow on, and the copies themselves, so children spread over every copy and ride it in the wind.
        links.push({ ...l, from: `${from.id}#obj`, fromSock: 'out', to: `${to.id}#place`, toSock: 'object' });
        links.push({ ...l, id: `${l.id}:copies`, from: `${from.id}#path`, fromSock: 'children', to: `${to.id}#place`, toSock: 'parent' });
      }
      else links.push({ ...l, fromSock: 'out', to: `${to.id}#place`, toSock: 'object' });
      continue;
    }
    // A value or curve wired into one setting goes to the part that setting drives.
    const key = l.toSock.slice(2);
    const p = NODE_TYPES[to.type].params.find((x) => x.k === key);
    if (p?.to) links.push({ ...l, to: `${to.id}#${p.to}` });
  }
  return { ...graph, nodes, links };
}

export const ownerOf = (id) => { const i = id.indexOf('#'); return i < 0 ? id : id.slice(0, i); };
