// Cards bake: the plant as picture cards for far-away LODs. Cross is two cards at 90°, Triple three at 60°; Billboard
// is one card meant to turn toward the camera in the engine; Views sprite is one card too, with a frame per angle
// around the plant in a grid atlas, for engines that pick the frame by view angle. Each card is photographed straight
// on (a far camera, narrow lens) into its own cell of one packed atlas: a diffuse map with alpha, and a normal map in
// the card's own space (DirectX by default: X right, Y down, Z toward the viewer; OpenGL keeps Y up). The export is
// an FBX with the cards and both maps packed, plus the two PNGs.
import * as THREE from 'three';
import { el, selectField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { zipStore } from './zip.js';
import { download, safeName } from './io.js';
import { writeFbx } from './fbx.js';
import { doc } from './doc.js';

export const CARD_KINDS = {
  cross: { label: 'Cross (2 cards)', n: 2 },
  triple: { label: 'Triple (3 cards)', n: 3 },
  billboard: { label: 'Billboard (one card, turns to the camera)', n: 1 },
  views: { label: 'Views sprite (one card, a frame per angle)', n: 1, views: true },
};

// The card quads: card i turned i·180°/n around the plant's middle, w wide and h tall, standing on bottom y0.
// Each card's UVs cover column i of n in the atlas. Positions in cm.
export function cardMesh(n, w, h, c, y0) {
  const position = []; const normal = []; const uv = []; const index = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI) / n;
    const r = [Math.cos(a), 0, -Math.sin(a)]; const d = [Math.sin(a), 0, Math.cos(a)];
    const u0 = i / n; const u1 = (i + 1) / n; const b = position.length / 3;
    for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      position.push(c[0] + r[0] * (s - 0.5) * w, y0 + t * h, c[2] + r[2] * (s - 0.5) * w);
      normal.push(...d);
      uv.push(u0 + (u1 - u0) * s, t);
    }
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv), index: new Uint32Array(index) };
}

// The views sprite grid: frame i of n at column i % cols, row floor(i / cols) from the top.
export const viewsGrid = (n) => { const cols = Math.ceil(Math.sqrt(n)); return { cols, rows: Math.ceil(n / cols) }; };

// Draws the plant's normals in the camera's space, keeping leaf cutouts (the picture's alpha). flipY: DirectX green.
function normalMaterial(map, side, flipY) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, useMap: { value: map ? 1 : 0 }, flipY: { value: flipY ? -1 : 1 } }, side, transparent: false,
    vertexShader: 'varying vec3 vN; varying vec2 vUv; void main() { vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float useMap; uniform float flipY; varying vec3 vN; varying vec2 vUv; void main() { if (useMap > 0.5 && texture2D(map, vUv).a < 0.32) discard; vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); n.y *= flipY; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
  });
}

// Photographs the plant in the view into the atlases. o: { kind, size, views, pitch (degrees), normals: 'dx'|'gl' }.
// Returns the card mesh (cm), the two atlases as canvases, and for a views sprite its grid.
export async function bakeCards(view, o) {
  const kind = CARD_KINDS[o.kind] || CARD_KINDS.billboard; const S = o.size || 1024;
  const frames = kind.views ? Math.max(2, o.views || 8) : kind.n;
  const { cols, rows } = kind.views ? viewsGrid(frames) : { cols: kind.n, rows: 1 };
  const pitch = kind.views ? ((o.pitch || 0) * Math.PI) / 180 : 0;
  const b = view.box; const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const cw = Math.floor(S / cols); const ch = Math.floor(S / rows);
  // Each view must hold the plant's height and its widest spread, in that cell's shape; seen from above, both show.
  const spread = Math.hypot(b[3] - b[0], b[5] - b[2]) * 1.02;
  const tall = (b[4] - b[1]) * 1.02 * Math.cos(pitch) + spread * Math.sin(pitch);
  const H = Math.max(tall, (spread * ch) / cw);
  const W = (H * cw) / ch;
  const dist = Math.max(H, W) * 40;
  const shot = async () => {
    const atlas = document.createElement('canvas'); atlas.width = S; atlas.height = S;
    const g = atlas.getContext('2d');
    for (let i = 0; i < frames; i++) {
      const a = kind.views ? (i * 2 * Math.PI) / frames : (i * Math.PI) / kind.n;
      view.orbit.target.set(c[0], kind.views ? c[1] : b[1] + H / 2, c[2]); view.orbit.dist = dist; view.orbit.yaw = a; view.orbit.pitch = pitch;
      const url = view.renderImage(0, { width: cw, height: ch, view: true, ground: false, grid: false, bg: null });
      const img = await createImageBitmap(await (await fetch(url)).blob());
      g.drawImage(img, (i % cols) * cw, Math.floor(i / cols) * ch); img.close();
    }
    return atlas;
  };
  const keep = { yaw: view.orbit.yaw, pitch: view.orbit.pitch, fov: view.camera.fov, wind: view.u.uWindS.value, material: view.material };
  const normals = new Map();
  let diffuse; let normalMap;
  try {
    view.camera.fov = (2 * Math.atan(H / 2 / dist) * 180) / Math.PI;
    view.u.uWindS.value = 0;
    diffuse = await shot();
    // Rendering reapplies each mesh's material from view.material, so the normal pass swaps it there.
    for (const m of view.meshes) normals.set(m.userData.src, normalMaterial(m.material.map || null, m.material.side, o.normals !== 'gl'));
    view.material = (src, ...rest) => normals.get(src) || keep.material.call(view, src, ...rest);
    normalMap = await shot();
  } finally {
    view.material = keep.material;
    for (const m of normals.values()) m.dispose();
    view.highlight();
    view.camera.fov = keep.fov; view.orbit.yaw = keep.yaw; view.orbit.pitch = keep.pitch; view.u.uWindS.value = keep.wind;
    view.frameAll(true); view.invalidate();
  }
  const mesh = cardMesh(kind.n, W, H, c, b[1]);
  // A views sprite card shows frame 0 (top left); the engine moves the UVs to the frame for the view angle.
  if (kind.views) for (let i = 0; i < mesh.uv.length; i += 2) { mesh.uv[i] /= cols; mesh.uv[i + 1] = 1 - (1 - mesh.uv[i + 1]) / rows; }
  return { mesh, diffuse, normal: normalMap, grid: kind.views ? { frames, cols, rows, pitch: o.pitch || 0, firstYaw: 0, stepDegrees: 360 / frames } : null };
}

export const pngBytes = (cv) => Uint8Array.from(atob(cv.toDataURL('image/png').split(',')[1]), (x) => x.charCodeAt(0));

export function makeCards({ view, toast }) {
  const o = { kind: 'cross', size: 1024, views: 8, pitch: 30, normals: 'dx' };
  let panel = null;

  async function bake() {
    if (!view.meshes.length || !view.box) { toast('There is no plant to bake yet.'); return; }
    const kind = CARD_KINDS[o.kind];
    const r = await bakeCards(view, o);
    const name = safeName(doc.name);
    const files = { diffuse: { file: `${name}_cards_diffuse.png`, bytes: pngBytes(r.diffuse) }, normal: { file: `${name}_cards_normal.png`, bytes: pngBytes(r.normal) } };
    const m = r.mesh;
    const fbx = writeFbx([{
      name: `${name}_${o.kind === 'cross' || o.kind === 'triple' ? 'Cards' : o.kind === 'views' ? 'Sprite' : 'Billboard'}`, ...m, color: new Float32Array((m.position.length / 3) * 3).fill(1),
      materials: [{ name: `${name}_cards`, rgb: [1, 1, 1], maps: { diffuse: files.diffuse, normal: files.normal, opacity: files.diffuse } }],
    }]);
    const out = [{ name: `${name}_${o.kind}.fbx`, data: fbx }, { name: files.diffuse.file, data: files.diffuse.bytes }, { name: files.normal.file, data: files.normal.bytes }];
    if (r.grid) out.push({ name: `${name}_sprite.json`, data: JSON.stringify(r.grid, null, 2) });
    download(`${name}_cards.zip`, new Blob([zipStore(out)], { type: 'application/zip' }));
    toast(`Baked ${kind.label.toLowerCase()} into a ${o.size} px diffuse and normal atlas.`, 5000);
  }

  function draw() {
    const go = el('button', 'wide primary', 'Bake cards');
    go.addEventListener('click', () => { go.disabled = true; bake().catch((e) => { console.error(e); toast(`Could not bake: ${e.message}`, 6000); }).finally(() => { go.disabled = false; }); });
    const views = o.kind === 'views' ? [
      selectField('Views', String(o.views), [4, 8, 16].map((n) => [String(n), `${n} around`]), (v) => { o.views = +v; }),
      selectField('Camera', String(o.pitch), [['0', 'Level'], ['30', 'Isometric (30° above)']], (v) => { o.pitch = +v; }),
    ] : [];
    panel.body.replaceChildren(
      selectField('Cards', o.kind, Object.entries(CARD_KINDS).map(([k, v]) => [k, v.label]), (v) => { o.kind = v; draw(); }),
      ...views,
      selectField('Atlas', String(o.size), [512, 1024, 2048].map((s) => [String(s), `${s} px`]), (v) => { o.size = +v; }),
      selectField('Normals', o.normals, [['dx', 'DirectX (Unreal)'], ['gl', 'OpenGL (Unity, Blender, Godot)']], (v) => { o.normals = v; }),
      el('p', 'hint', o.kind === 'views'
        ? 'One card with the plant photographed from each angle around it, in one atlas grid. The card shows the first frame; the engine picks the frame for the view angle. The zip has the FBX, both maps and a JSON with the grid.'
        : 'For the farthest LOD: the plant photographed straight on for each card into one packed atlas, a diffuse map with alpha and a normal map. The zip has an FBX with the cards and both maps.'),
      go,
    );
  }

  return { open() { panel ||= floatPanel('cards', 'Cards bake', { width: 320 }); draw(); panel.show(); } };
}
