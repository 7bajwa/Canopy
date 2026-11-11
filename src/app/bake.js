// Baking: renders what is inside a square frame, straight on from the view, into one picture per map.
// Every pass draws the same plant with a plain material that outputs one thing (color, normal, roughness...).
import * as THREE from 'three';
import { doc } from './doc.js';
import { threeMap, solidMap } from './textures.js';
import { sizeOf, needs } from './texout.js';

const lin2srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

// The camera that sees exactly the frame: the frame is a share of the view (center x, y and size, of its height),
// as wide as the picture's width over its height.
export function frameCamera(vp, frame, aspect = 1) {
  const c = vp.camera;
  const { w, h } = vp.rect;
  const halfH = vp.orbit.dist * Math.tan((c.fov * Math.PI) / 360);
  const unit = (2 * halfH) / h;
  const m = c.matrixWorld.elements;
  const right = new THREE.Vector3(m[0], m[1], m[2]); const up = new THREE.Vector3(m[4], m[5], m[6]);
  const fwd = new THREE.Vector3(); c.getWorldDirection(fwd);
  const half = frame.s * halfH;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 10);
  cam.position.copy(c.position).addScaledVector(right, (frame.x - 0.5) * w * unit - vp.bias * unit).addScaledVector(up, -(frame.y - 0.5) * h * unit);
  cam.quaternion.copy(c.quaternion);
  // Near and far hug the plant, so the height map uses its whole range.
  const b = vp.box || [-100, 0, -100, 100, 200, 100];
  let lo = Infinity; let hi = -Infinity;
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const d = new THREE.Vector3(x, y, z).sub(cam.position).dot(fwd);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  cam.near = lo - 1; cam.far = hi + 1;
  cam.layers.enableAll();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

// What cuts a mesh's leaves out of their quads: the opacity map, or the color picture's own alpha.
function cutOf(src, invalidate) {
  const mm = src.material;
  const ch = mm.opacityCh || 'A';
  if (mm.opacityMap && !(mm.opacityMap === mm.texture && ch === 'A')) return threeMap(mm.opacityMap, ch, doc.assets, invalidate);
  if (mm.texture && !String(mm.texture).startsWith('bark:')) return threeMap(mm.texture, 'A', doc.assets, invalidate);
  return null;
}

function passMaterial(pass, mesh, o, invalidate) {
  const src = mesh.userData.src;
  const mm = src.material;
  const cut = cutOf(src, invalidate);
  const data = (name, ch) => (name ? threeMap(name, ch, doc.assets, invalidate) : null);
  const clip = { alphaMap: cut, alphaTest: cut ? 0.5 : 0, side: THREE.DoubleSide };
  let mat;
  if (pass === 'color') {
    mat = new THREE.MeshBasicMaterial({ ...clip, map: mesh.material.map, color: mm.color || '#ffffff', vertexColors: true, toneMapped: false });
  } else if (pass === 'normal') {
    mat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, normalMap: data(mm.normalMap) || solidMap('#8080ff') });
    mat.normalScale.setScalar(mm.normalScale ?? 1);
    if (cut) {
      mat.onBeforeCompile = (s) => {
        s.uniforms.uCut = { value: cut };
        s.fragmentShader = `uniform sampler2D uCut;\n${s.fragmentShader.replace('void main() {', 'void main() {\n  if (texture2D(uCut, vNormalMapUv).g < 0.5) discard;')}`;
      };
      mat.customProgramCacheKey = () => 'bake-normal-cut';
    }
  } else if (pass === 'height') {
    mat = new THREE.MeshDepthMaterial({ ...clip, depthPacking: THREE.BasicDepthPacking });
  } else {
    const map = {
      roughness: data(mm.roughMap, mm.roughCh) || solidMap(mm.roughColor || '#b3b3b3'),
      ao: data(mm.aoMap, mm.aoCh) || solidMap(mm.aoColor || '#ffffff'),
      subsurface: data(mm.sssMap, mm.sssCh) || solidMap(mm.sssColor || '#000000'),
    }[pass];
    mat = new THREE.MeshBasicMaterial({ ...clip, map, toneMapped: false });
    if (pass === 'ao' && o.meshAo > 0 && mesh.geometry.getAttribute('aAo')) {
      // The plant's own occlusion, blended with the material's AO map.
      mat.onBeforeCompile = (s) => {
        s.uniforms.uMeshAo = { value: o.meshAo };
        s.vertexShader = `attribute float aAo;\nvarying float vAo;\n${s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = aAo;')}`;
        s.fragmentShader = `varying float vAo;\nuniform float uMeshAo;\n${s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, vAo, uMeshAo);')}`;
      };
      mat.customProgramCacheKey = () => 'bake-ao';
    }
  }
  return mat;
}

// Textures load on their own time; a pass waits (briefly) until its pictures are in.
async function ready(mats) {
  const texs = mats.flatMap((m) => [m.map, m.alphaMap, m.normalMap]).filter(Boolean);
  for (let i = 0; i < 60 && texs.some((t) => !t.image); i++) await new Promise((r) => setTimeout(r, 50));
}

// Reads one tile of a float render into the picture, top row first. Coverage at the edges is undone so colors don't darken.
function readBack(renderer, rt, out, ox, oy, tw, th, srgb) {
  const buf = new Float32Array(tw * th * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, tw, th, buf);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const s = ((th - 1 - y) * tw + x) * 4; const d = ((oy + y) * out.width + ox + x) * 4;
      const a = Math.min(1, buf[s + 3]);
      for (let c = 0; c < 3; c++) {
        const v = a > 0 ? Math.min(1, Math.max(0, buf[s + c] / a)) : 0;
        out.data[d + c] = (srgb ? lin2srgb(v) : v) * 255 + 0.5;
      }
      out.data[d + 3] = a * 255 + 0.5;
    }
  }
}

// One picture per map. `o.maps` says which; color is always made, since its alpha is the opacity.
export async function bakeMaps(vp, frame, o) {
  const [W, H] = sizeOf(o);
  const renderer = vp.renderer;
  const cam = frameCamera(vp, frame, W / H);
  // Big pictures render in tiles, so no single render needs more memory than a 2K one.
  const TILE = 2048;
  if (needs(o, 'ao') && o.meshAo > 0) vp.bakeAo();
  const hide = [vp.ground, vp.selBox, vp.preview, vp.lines, vp.scale?.group, vp.wireMat, ...vp.helpers].filter(Boolean);
  const was = hide.map((x) => x.visible);
  hide.forEach((x) => { x.visible = false; });
  const shown = vp.meshes.map((m) => m.visible);
  vp.meshes.forEach((m) => { m.visible = true; });
  const keep = { tone: renderer.toneMapping, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), mats: vp.meshes.map((m) => m.material) };
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  const rt = new THREE.WebGLRenderTarget(Math.min(W, TILE), Math.min(H, TILE), { type: THREE.FloatType, samples: 4 });
  const out = {};
  const invalidate = () => vp.invalidate();
  try {
    for (const pass of ['color', 'normal', 'roughness', 'ao', 'subsurface', 'height']) {
      if (pass !== 'color' && !needs(o, pass)) continue;
      const mats = vp.meshes.map((m) => passMaterial(pass, m, o, invalidate));
      vp.meshes.forEach((m, i) => { m.material = mats[i]; });
      await ready(mats);
      const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
      for (let oy = 0; oy < H; oy += TILE) {
        for (let ox = 0; ox < W; ox += TILE) {
          const tw = Math.min(TILE, W - ox); const th = Math.min(TILE, H - oy);
          rt.setSize(tw, th);
          cam.setViewOffset(W, H, ox, oy, tw, th);
          renderer.setRenderTarget(rt);
          renderer.clear();
          renderer.render(vp.scene, cam);
          readBack(renderer, rt, img, ox, oy, tw, th, pass === 'color');
        }
      }
      out[pass] = img;
      mats.forEach((m) => m.dispose());
    }
  } finally {
    renderer.setRenderTarget(null);
    rt.dispose();
    vp.meshes.forEach((m, i) => { m.material = keep.mats[i]; m.visible = shown[i]; });
    hide.forEach((x, i) => { x.visible = was[i]; });
    renderer.toneMapping = keep.tone;
    renderer.setClearColor(keep.clear, keep.alpha);
    vp.invalidate();
  }
  if (!out.color.data.some((v, i) => i % 4 === 3 && v > 0)) throw new Error('Nothing of the plant is inside the frame.');
  return out;
}
