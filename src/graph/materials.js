// Scene materials: shared by every node that picks one, and the home of a leaf texture's cutouts.
export const MATERIAL_FIELDS = {
  color: '#ffffff', texture: null,
  normalColor: '#8080ff', normalMap: null, normalScale: 1,
  roughColor: '#808080', roughMap: null, roughCh: 'G',
  aoColor: '#ffffff', aoMap: null, aoCh: 'R', aoAmount: 1,
  sssColor: '#000000', sssMap: null, sssCh: 'R',
  opacityColor: '#ffffff', opacityMap: null, opacityCh: 'A',
  cutouts: [],
};

// What a node shows with no material picked.
export const NO_MATERIAL = { ...MATERIAL_FIELDS, color: '#9a9a9a', roughColor: '#b3b3b3' };

let serial = 0;
export const materialId = () => `mat${Date.now().toString(36)}${(serial++).toString(36)}`;

export const newMaterial = (name, fields = {}) => ({ id: materialId(), name, ...MATERIAL_FIELDS, ...fields });

export const materialOf = (graph, node) => (graph.materials || []).find((m) => m.id === node.params.material) || null;

const TABBED = new Set(['Spline', 'Mesh']);
const keys = Object.keys(MATERIAL_FIELDS);
const gray = (v) => { const h = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return `#${h}${h}${h}`; };

// Brings a graph from before materials and per-axis transforms up to date. Nodes that looked the same share one material.
export function migrateGraph(graph) {
  graph.materials ||= [];
  const byLook = new Map(graph.materials.map((m) => [JSON.stringify(keys.map((k) => m[k])), m]));
  for (const n of graph.nodes) {
    if (!TABBED.has(n.type)) continue;
    const P = n.params;
    // Transforms, once three-number boxes, are one value per axis now.
    if (P.origin) { [P.posX, P.posY, P.posZ] = P.origin.map(Number); delete P.origin; }
    if (n.type === 'Mesh') {
      if (P.pos) { [P.posX, P.posY, P.posZ] = P.pos.map(Number); delete P.pos; }
      if (P.rot) { [P.rotX, P.rotY, P.rotZ] = P.rot.map(Number); delete P.rot; }
      if (P.scl) { [P.sclX, P.sclY, P.sclZ] = P.scl.map(Number); delete P.scl; }
    }
    for (const [from, to] of [['origin', 'pos'], ['pos', 'pos'], ['rot', 'rot']]) {
      if (P.vary?.[from] === undefined) continue;
      for (const a of 'XYZ') P.vary[`${to}${a}`] = P.vary[from];
      delete P.vary[from];
    }
    if (P.vary?.scl !== undefined) { P.vary.sclU = P.vary.scl; delete P.vary.scl; }
    // Trunk flare became part of Blend (the floor is a trunk's parent). Older blends spread evenly, and a line with
    // no parent didn't blend at all, so those keep their look.
    if (n.type === 'Spline' && P.blendOffset === undefined) {
      P.blendOffset = 0;
      if (P.flareOn) Object.assign(P, { blend: true, blendLength: P.flareHeight ?? 3, blendFlare: P.flareSpread ?? 1, blendRoots: P.flareRoots ?? 5, blendRootDepth: P.flareRootDepth ?? 0.45, blendRootTurn: P.flareTwist ?? 0 });
      else if (graph.links && !graph.links.some((l) => l.to === n.id && l.toSock === 'parent')) P.blend = false;
      for (const k of ['flareOn', 'flareHeight', 'flareSpread', 'flareShape', 'flareRoots', 'flareRootDepth', 'flareTwist', 'flareSink', 'flareRings']) delete P[k];
    }
    // Caps were a choice of none, flat or round; now each end is on or off, shaped by its profile and height.
    if (n.type === 'Spline' && P.capTop === undefined && (P.capEnd !== undefined || P.capStart !== undefined)) {
      P.capTop = (P.capEnd ?? 'spherical') !== 'none';
      if (P.capEnd === 'planar') P.capEndHeight = 0;
      P.capBottom = !!P.capStart && P.capStart !== 'none';
      if (P.capStart === 'planar') P.capStartHeight = 0;
    }
    // The ball of lines was once called Sprout, which clashed with a leaf's sprout points.
    if (P.place === 'sprout') P.place = 'urchin';
    // Transforms were once in world axes with Y up; now they use the gizmo's axes (Z up), and new ones the entity's own.
    if (P.xfSpace === undefined) {
      P.xfSpace = 'world';
      const swap = (o, k, neg) => { if (!o) return; const y = o[`${k}Y`]; const z = o[`${k}Z`]; if (y === undefined && z === undefined) return; o[`${k}Y`] = neg && typeof z === 'number' ? -z : z; o[`${k}Z`] = y; if (o[`${k}Y`] === undefined) delete o[`${k}Y`]; if (o[`${k}Z`] === undefined) delete o[`${k}Z`]; };
      for (const k of ['pos', 'rot', 'scl']) { swap(P, k, k !== 'scl'); swap(P.vary, k, false); swap(P.curves, k, false); }
    }
    if (P.vary?.tintColor !== undefined) { P.tintAmount = P.vary.tintColor; delete P.vary.tintColor; }
    if (P.material) continue;
    // A node from before materials carries its look in its own settings.
    const legacy = keys.some((k) => P[k] !== undefined && k !== 'cutouts') || P.atlas || P.roughness !== undefined || P.sss !== undefined;
    if (!legacy) { P.material = null; continue; }
    const look = { ...MATERIAL_FIELDS };
    for (const k of keys) if (P[k] !== undefined) look[k] = P[k];
    if (P.roughness !== undefined && P.roughColor === undefined) look.roughColor = gray(+P.roughness);
    if (P.sss !== undefined && P.sssColor === undefined) look.sssColor = gray(+P.sss);
    // A cutout leaf's atlas is its texture.
    if (P.meshType === 'cutout') look.texture = P.atlas || look.texture || 'atlas:broadleaf';
    else if (P.meshType && P.meshType !== 'tube' && String(look.texture).startsWith('bark:')) look.texture = null;
    const sig = JSON.stringify(keys.map((k) => look[k]));
    let m = byLook.get(sig);
    if (!m) {
      m = { id: materialId(), name: n.name || n.type, ...look };
      graph.materials.push(m);
      byLook.set(sig, m);
    }
    P.material = m.id;
    for (const k of [...keys, 'atlas', 'roughness', 'sss', 'metalness']) delete P[k];
  }
  return graph;
}
