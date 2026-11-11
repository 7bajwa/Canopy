// Self-checks for the parts that are easy to get subtly wrong: the blend geometry and the cutout fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, Evaluator } from '../src/engine/evaluate.js';
import { ownerOf } from '../src/engine/expand.js';
import { PRESETS } from '../src/graph/presets.js';
import { NODE_TYPES, defaultParams } from '../src/graph/schema.js';
import { cutoutsFromImage, triangulate } from '../src/leaf/cutout.js';
import { sampleLine, newSample } from '../src/engine/line.js';

// A simple opaque ellipse on transparent ground, standing in for an atlas leaf.
function leafImage(w = 128, h = 128) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = ((x - 64) / 22) ** 2 + ((y - 64) / 54) ** 2 < 1;
    if (inside) data[(y * w + x) * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

const withCutouts = (graph) => {
  const cutouts = cutoutsFromImage(leafImage(), { rowsMax: 7 });
  for (const n of graph.nodes) if (n.type === 'LeafCutout' || n.params.meshType === 'cutout') n.params.cutouts = cutouts;
  return graph;
};

test('every preset evaluates to valid meshes', () => {
  for (const [name, make] of Object.entries(PRESETS)) {
    const res = evaluate(withCutouts(make()));
    assert.ok(res.meshes.length > 0, `${name} made no meshes`);
    assert.ok(res.stats.lines > 0, `${name} made no lines`);
    for (const m of res.meshes) {
      const nv = m.position.length / 3;
      assert.ok(m.position.every(Number.isFinite), `${name}: bad position`);
      assert.ok(m.normal.every(Number.isFinite), `${name}: bad normal`);
      assert.ok(m.index.every((i) => i < nv), `${name}: index out of range`);
    }
  }
});

test('every node type has usable defaults', () => {
  for (const type of Object.keys(NODE_TYPES)) {
    const graph = { nodes: [{ id: 'x', type, x: 0, y: 0, on: true, params: defaultParams(type) }], links: [], settings: {} };
    assert.doesNotThrow(() => evaluate(graph), type);
  }
});

test('every modifier runs on a real line without breaking it', () => {
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    if (def.chain !== 'dir') continue;
    const params = defaultParams('Path');
    const graph = {
      nodes: [
        { id: 'p', type: 'Path', on: true, params: { ...params, length: 200, steps: 20 } },
        { id: 'm', type, on: true, params: defaultParams(type) },
      ],
      links: [{ id: 'l', from: 'p', fromSock: 'dir', to: 'm', toSock: 'in' }],
      settings: {},
    };
    const ev = new Evaluator(graph);
    ev.run();
    for (const line of ev.lines) assert.ok(line.pts.every(Number.isFinite), `${type} made a bad point`);
  }
});

// The core promise of the blend: a branch's base sits on its parent's surface, not floating or buried.
test('branch blend seats the base ring on the parent surface', () => {
  const graph = PRESETS['Junction study (blend close-up)']();
  const limb = graph.nodes.find((n) => n.type === 'Spline' && n.params.blend && graph.links.some((l) => l.to === n.id));
  limb.params.blendSink = 0;
  limb.params.blendCollar = 0;
  const ev = new Evaluator(graph);
  const res = ev.run();
  const job = [...ev.jobs.values()].find((j) => j.comps.blend);
  const lines = job.lines.filter((l) => l.junction);
  assert.ok(lines.length > 0, 'no junctions were built');
  const mesh = res.meshes.find((m) => m.nodeId === ownerOf(job.node.id));
  assert.ok(mesh.uv1 && mesh.blend, 'blend data missing from mesh');
  assert.ok(mesh.blend.some((b) => b > 0.9), 'no vertex is fully blended at the joint');
  const S = newSample();
  let checked = 0;
  for (let v = 0; v < mesh.blend.length; v++) {
    if (mesh.blend[v] < 0.999) continue;
    const parent = lines[0].parent;
    const p = [mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2]];
    // Closest approach to the parent's axis should equal the parent's radius there.
    let best = Infinity; let radius = 0;
    for (let s = 0; s <= parent.length; s += 1) {
      sampleLine(parent, s, S);
      const d = Math.hypot(p[0] - S.px, p[1] - S.py, p[2] - S.pz);
      if (d < best) { best = d; radius = S.r; }
    }
    assert.ok(Math.abs(best - radius) < radius * 0.12, `base ring off the surface: ${best} vs ${radius}`);
    checked++;
  }
  assert.ok(checked > 8, 'too few base vertices checked');
});

test('blend adds a collar to the parent only when enabled', () => {
  const on = PRESETS['Junction study (blend close-up)']();
  const evOn = new Evaluator(on);
  evOn.run();
  const stem = evOn.lines.find((l) => l.level === 0);
  assert.ok(stem.attach?.length > 0, 'parent has no collars');
  const off = PRESETS['Junction study (blend close-up)']();
  off.settings.blendOn = false;
  const evOff = new Evaluator(off);
  const resOff = evOff.run();
  assert.equal(evOff.lines.find((l) => l.level === 0).attach, null);
  assert.ok(resOff.meshes.every((m) => !m.blend), 'blend data present while off');
});

test('cutout fit never clips an opaque pixel and beats a quad', () => {
  const img = leafImage();
  const [cut] = cutoutsFromImage(img, { points: 14, padding: 1 });
  assert.ok(cut, 'leaf not detected');
  assert.ok(cut.outlinePx.length <= 16);
  const poly = cut.outlinePx;
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const [ax, ay] = poly[i]; const [bx, by] = poly[(i + 1) % poly.length]; area += ax * by - bx * ay; }
  area = Math.abs(area) / 2;
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  const quad = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  assert.ok(area < quad * 0.9, `only saved ${1 - area / quad}`);
  const inside = (x, y) => {
    let on = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[i]; const [bx, by] = poly[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) on = !on;
    }
    return on;
  };
  // Every opaque pixel, a pixel's width in from its edge, must sit inside the outline.
  for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) {
    if (!img.data[(y * img.width + x) * 4 + 3]) continue;
    const solid = [[-2, 0], [2, 0], [0, -2], [0, 2]].every(([a, b]) => img.data[((y + b) * img.width + x + a) * 4 + 3]);
    if (solid) assert.ok(inside(x + 0.5, y + 0.5), `pixel ${x},${y} clipped`);
  }
});

test('atlas leaves use the cutout UVs and stay inside the atlas', () => {
  const graph = withCutouts(PRESETS['Broadleaf tree']());
  const res = evaluate(graph);
  const leaf = res.meshes.find((m) => m.kind === 'leaf');
  assert.ok(leaf, 'no leaf mesh');
  assert.equal(leaf.material.texture, 'atlas:broadleaf');
  for (let i = 0; i < leaf.uv.length; i++) assert.ok(leaf.uv[i] > -0.2 && leaf.uv[i] < 1.2, `uv ${leaf.uv[i]}`);
});

// Multiply tints once compounded from line to line until every leaf was black.
test('leaf tints apply per line and do not build up', () => {
  const res = evaluate(withCutouts(PRESETS['Broadleaf tree']()));
  const { color } = res.meshes.find((m) => m.kind === 'leaf');
  let darkest = 1;
  for (let i = 0; i < color.length; i += 3) darkest = Math.min(darkest, color[i + 1]);
  assert.ok(darkest > 0.2, `leaf color fell to ${darkest}`);
});

// Inside-out triangles get culled, so far faces showed through near ones.
test('every mesh faces outward', () => {
  for (const [name, make] of Object.entries(PRESETS)) {
    const res = evaluate(withCutouts(make()));
    for (const m of res.meshes) {
      const { position: P, normal: N, index: I } = m;
      let agree = 0; let total = 0;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3; const b = I[t + 1] * 3; const c = I[t + 2] * 3;
        const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) < 1e-9) continue;
        total++;
        if (nx * N[a] + ny * N[a + 1] + nz * N[a + 2] > 0) agree++;
      }
      assert.ok(agree / total > 0.95, `${name} ${m.kind}: only ${Math.round((100 * agree) / total)}% face outward`);
    }
  }
});

test('built-in shaping and surface settings act like the separate nodes', () => {
  const graph = (path, mesh = {}) => ({
    nodes: [
      { id: 'p', type: 'Path', on: true, params: { ...defaultParams('Path'), length: 200, steps: 10, ...path } },
      { id: 'm', type: 'CylinderMesh', on: true, params: { ...defaultParams('CylinderMesh'), ...mesh } },
    ],
    links: [{ id: 'l', from: 'p', fromSock: 'mesh', to: 'm', toSock: 'in' }],
    settings: {},
  });
  const straight = new Evaluator(graph({}));
  straight.run();
  assert.ok(Math.abs(straight.lines[0].pts[straight.lines[0].pts.length - 3]) < 1e-3, 'off by default: the line stays straight');
  const pulled = new Evaluator(graph({ pullOn: true, pullVector: [1, 0, 0], pullStrength: 1 }));
  pulled.run();
  assert.ok(pulled.lines[0].pts[pulled.lines[0].pts.length - 3] > 10, 'Gravity / light bends the line');
  const noisy = new Evaluator(graph({ noiseOn: true, noiseStrength: 30 }));
  noisy.run();
  assert.ok(noisy.lines[0].pts.some((v, i) => i % 3 === 0 && Math.abs(v) > 1), 'Noise moves the line');

  const res = evaluate(graph({}, { color: '#ff0000', texture: null, roughness: 0.3 }));
  assert.equal(res.meshes[0].material.color, '#ff0000');
  assert.equal(res.meshes[0].material.texture, null);
  assert.equal(res.meshes[0].material.roughness, 0.3);
  const tiled = evaluate(graph({}, { uvOn: true, tileU: 5, absLength: false, tileV: 3 }));
  const plain = evaluate(graph({}));
  assert.ok(Math.max(...tiled.meshes[0].uv) > Math.max(...plain.meshes[0].uv), 'Custom UVs change the mapping');
  const tinted = evaluate(graph({}, { tintOn: true, tintColor: '#000000' }));
  assert.ok(tinted.meshes[0].color.some((c) => c < 0.99), 'Color variation reaches the vertices');
});

test('a disk ground patch keeps plants inside its radius', () => {
  const graph = {
    nodes: [
      { id: 'g', type: 'GroundPatch', on: true, params: { ...defaultParams('GroundPatch'), radius: 50, pos: [100, 0, 0] } },
      { id: 'd', type: 'SurfaceDistributor', on: true, params: { ...defaultParams('SurfaceDistributor'), mode: 'random', density: 200 } },
      { id: 'p', type: 'Path', on: true, params: { ...defaultParams('Path'), length: 10, steps: 5 } },
    ],
    links: [{ id: 'a', from: 'g', fromSock: 'out', to: 'd', toSock: 'object' }, { id: 'b', from: 'd', fromSock: 'out', to: 'p', toSock: 'in' }],
    settings: {},
  };
  const ev = new Evaluator(graph);
  ev.run();
  assert.ok(ev.lines.length > 100, `only ${ev.lines.length} lines`);
  let far = 0;
  for (const l of ev.lines) far = Math.max(far, Math.hypot(l.pts[0] - 100, l.pts[2]));
  assert.ok(far <= 50.001, `a plant started ${far} from the center`);
  assert.ok(far > 40, 'plants reach the edge of the disk');
});

test('aligned lines lie the same way round the parent, and the setting loosens it', () => {
  const graph = (alignParent) => ({
    nodes: [
      { id: 'p', type: 'Path', on: true, params: { ...defaultParams('Path'), length: 200, steps: 10 } },
      { id: 'd', type: 'PathDistributor', on: true, params: { ...defaultParams('PathDistributor'), density: 20, start: 10, angleDiv: 60, alignParent } },
      { id: 'c', type: 'Path', on: true, params: { ...defaultParams('Path'), length: 20, steps: 5 } },
    ],
    links: [{ id: 'a', from: 'p', fromSock: 'children', to: 'd', toSock: 'parent' }, { id: 'b', from: 'd', fromSock: 'out', to: 'c', toSock: 'in' }],
    settings: {},
  });
  // Fully aligned, a child's side axis is square to the plane holding the parent's axis and the child.
  const worst = (g) => {
    const ev = new Evaluator(g);
    ev.run();
    const S = newSample();
    let w = 0;
    for (const l of ev.lines.filter((x) => x.parent)) {
      sampleLine(l, 0, S);
      const up = [0, 1, 0];
      const n = [S.ty * up[2] - S.tz * up[1], S.tz * up[0] - S.tx * up[2], S.tx * up[1] - S.ty * up[0]];
      const m = Math.hypot(...n);
      w = Math.max(w, 1 - Math.abs(S.ux * n[0] + S.uy * n[1] + S.uz * n[2]) / m);
    }
    return w;
  };
  assert.ok(worst(graph(100)) < 0.01, `aligned off by ${worst(graph(100))}`);
  assert.ok(worst(graph(0)) > 0.2, 'zero alignment turns lines freely');
});

test('triangulate handles a concave outline', () => {
  const poly = [[0, 0], [4, 0], [4, 4], [2, 1.5], [0, 4]];
  assert.equal(triangulate(poly).length, 9);
});

test('generation is deterministic for a seed and changes with it', () => {
  const a = evaluate(withCutouts(PRESETS['Broadleaf tree']()));
  const b = evaluate(withCutouts(PRESETS['Broadleaf tree']()));
  assert.deepEqual(a.meshes[0].position.slice(0, 300), b.meshes[0].position.slice(0, 300));
  const other = PRESETS['Broadleaf tree']();
  other.settings.seed = 99;
  const c = evaluate(withCutouts(other));
  assert.notEqual(a.stats.tris, c.stats.tris);
});
