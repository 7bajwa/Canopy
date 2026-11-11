// Bake from scan: textures for a tube taken from a scanned (imported) trunk. Draw or pick a Spline that runs up the
// middle of the scan; the scan is unwrapped around it like a cylinder (u around, v along), at a size that keeps the
// tube's own aspect (width you pick, height from length over circumference, or the nearest power of two), and baked
// on the GPU: color from the scan's own texture, height from how far the surface stands out from the fitted
// radius, and a normal map from that height. The Spline can take the scan's thickness along its length, and the
// maps become its bark material, laid once around and once along.
import * as THREE from 'three';
import { doc, commit, changed } from './doc.js';
import { el, numberField, checkField, selectField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { newMaterial } from '../graph/materials.js';
import { dilate } from '../leaf/imgops.js';
import { zipStore } from './zip.js';
import { download, safeName } from './io.js';
import { lineFrames, cylCoords, fitRadius, unwrapSize, heightToNormal } from '../engine/unwrap.js';

const BINS = 24;

// The spline's first line, as flat xyz, from the last build.
function splinePts(id) {
  const L = doc.result?.lines; if (!L) return null;
  let first = null; const pts = [];
  for (let k = 0; k < L.owner.length; k += 2) {
    if (L.nodeIds[L.owner[k]] !== id) continue;
    if (first === null) first = L.lineId[k];
    if (L.lineId[k] !== first) break;
    if (!pts.length) pts.push(L.position[k * 3], L.position[k * 3 + 1], L.position[k * 3 + 2]);
    pts.push(L.position[k * 3 + 3], L.position[k * 3 + 4], L.position[k * 3 + 5]);
  }
  return pts.length >= 6 ? new Float32Array(pts) : null;
}

const scanMesh = (view, id) => view.meshes.map((m) => m.userData.src).find((s) => s?.nodeId === id && s.position?.length);

function toImage(buf, W, H) {
  // GL rows run bottom up; pictures top down, with the tip of the tube at the top.
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  return img;
}
function dataUrl(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c.toDataURL('image/png');
}

export function makeScanBake({ view, toast }) {
  const o = { scan: '', spline: '', width: 1024, pow2: false, depth: 4, strength: 2, flipV: false, fit: true };
  let panel = null; let info = null;

  function measure() {
    const s = scanMesh(view, o.scan); const P = splinePts(o.spline);
    if (!s || !P) return null;
    const F = lineFrames(P);
    const C = cylCoords(s.position, P, F);
    const fit = fitRadius(C, BINS);
    return { s, P, F, C, fit, H: unwrapSize(o.width, F.L, fit.mean, o.pow2) };
  }

  async function bake(m) {
    const { s, C, fit } = m; const W = Math.min(8192, o.width); const H = Math.min(8192, m.H);
    const I = s.index; const R = fit.r; const range = Math.max(0.01, o.depth);
    const rAt = (t) => { const f = Math.min(BINS - 1, Math.max(0, t * BINS - 0.5)); const i = Math.floor(f); const j = Math.min(BINS - 1, i + 1); return R[i] + (R[j] - R[i]) * (f - i); };
    const rmax = Math.max(...R) * 2 + range;
    const pos = []; const suv = []; const hgt = [];
    const uvOf = (v) => (s.uv ? [s.uv[v * 2], o.flipV ? 1 - s.uv[v * 2 + 1] : s.uv[v * 2 + 1]] : [0, 0]);
    for (let t = 0; t < I.length; t += 3) {
      const c = [I[t], I[t + 1], I[t + 2]];
      const us = c.map((v) => C[v * 3 + 1]);
      // A triangle across the seam is drawn twice, once on each side, so the seam has no gap.
      const wrap = Math.max(...us) - Math.min(...us) > 0.5;
      for (const shift of wrap ? [0, -1] : [0]) {
        for (const v of c) {
          let u = C[v * 3 + 1]; if (wrap && u < 0.5) u += 1;
          const tt = C[v * 3]; const r = C[v * 3 + 2];
          pos.push((u + shift) * 2 - 1, tt * 2 - 1, 1 - 2 * Math.min(1, r / rmax));
          suv.push(...uvOf(v));
          hgt.push(Math.min(1, Math.max(0, 0.5 + (r - rAt(tt)) / (2 * range))));
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('suv', new THREE.Float32BufferAttribute(suv, 2));
    g.setAttribute('hgt', new THREE.Float32BufferAttribute(hgt, 1));
    const matId = doc.graph.nodes.find((n) => n.id === o.scan)?.params.material;
    const url = doc.assets[(doc.graph.materials || []).find((x) => x.id === matId)?.texture]?.url;
    const map = url ? await new THREE.TextureLoader().loadAsync(url) : null;
    if (map) map.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, useMap: { value: map ? 1 : 0 }, mode: { value: 0 } },
      vertexShader: 'attribute vec2 suv; attribute float hgt; varying vec2 vUv; varying float vH; void main() { vUv = suv; vH = hgt; gl_Position = vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float useMap; uniform int mode; varying vec2 vUv; varying float vH; void main() { if (mode == 1) { gl_FragColor = vec4(vec3(vH), 1.0); return; } gl_FragColor = useMap > 0.5 ? vec4(texture2D(map, vUv).rgb, 1.0) : vec4(0.45, 0.36, 0.28, 1.0); }',
      side: THREE.DoubleSide, depthTest: true,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
    const scene = new THREE.Scene(); scene.add(mesh);
    const cam = new THREE.OrthographicCamera();
    const r = view.renderer;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
    rt.texture.colorSpace = THREE.NoColorSpace;
    const keep = { tone: r.toneMapping, clear: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha() };
    const out = {};
    try {
      r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0);
      for (const [name, mode] of [['color', 0], ['height', 1]]) {
        mat.uniforms.mode.value = mode;
        r.setRenderTarget(rt); r.clear(); r.render(scene, cam);
        const buf = new Uint8Array(W * H * 4);
        r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        out[name] = toImage(buf, W, H);
      }
    } finally {
      r.setRenderTarget(null); r.toneMapping = keep.tone; r.setClearColor(keep.clear, keep.alpha);
      rt.dispose(); g.dispose(); mat.dispose(); map?.dispose(); view.invalidate();
    }
    // Holes where the scan doesn't reach are filled from around them; then the maps are solid.
    for (const k of ['color', 'height']) { out[k] = dilate(out[k], 128); for (let i = 3; i < out[k].data.length; i += 4) out[k].data[i] = 255; }
    out.normal = heightToNormal(out.height, o.strength);
    return out;
  }

  function fitThickness(m) {
    const n = doc.graph.nodes.find((x) => x.id === o.spline); if (!n) return;
    const max = Math.max(...m.fit.r);
    n.params.radius = Math.round(max * 100) / 100;
    n.params.curves = { ...n.params.curves, radius: { pts: [...m.fit.r].map((r, i) => [i / (BINS - 1), Math.round((r / max) * 1000) / 1000, 's']) } };
  }

  async function run(apply) {
    const m = measure();
    if (!m) { toast('Pick an imported scan (a Mesh node) and a Spline that runs up its middle, and let the plant build.', 6000); return; }
    toast('Baking from the scan…', 2000);
    let maps;
    try { maps = await bake(m); } catch (e) { console.error(e); toast(`Could not bake: ${e.message}`, 6000); return; }
    const name = safeName(doc.graph.nodes.find((x) => x.id === o.spline)?.name || 'trunk');
    if (!apply) {
      download(`${name}_scan_maps.zip`, new Blob([zipStore(['color', 'height', 'normal'].map((k) => ({ name: `${name}_${k}.png`, data: Uint8Array.from(atob(dataUrl(maps[k]).split(',')[1]), (c) => c.charCodeAt(0)) })))], { type: 'application/zip' }));
      toast(`Saved ${maps.color.width} × ${maps.color.height} color, height and normal maps.`);
      return;
    }
    const n = doc.graph.nodes.find((x) => x.id === o.spline);
    const stamp = Date.now().toString(36);
    const ids = {};
    for (const k of ['color', 'normal', 'height']) { ids[k] = `img:scan-${k}-${stamp}`; doc.assets[ids[k]] = { name: `${name}_${k}.png`, url: dataUrl(maps[k]) }; }
    const mat = newMaterial(`${n.name} scan`, { texture: ids.color, normalMap: ids.normal });
    (doc.graph.materials ||= []).push(mat);
    Object.assign(n.params, { material: mat.id, tileU: 0.5, tileV: 1, absLength: false, uvTwist: 0 });
    if (o.fit) fitThickness(m);
    changed({ layout: true }); commit();
    toast(`${n.name} now wears the scan: ${maps.color.width} × ${maps.color.height}. Turn its UV Offset U to line the seam up.`, 6000);
  }

  function draw() {
    const scans = doc.graph.nodes.filter((n) => n.type === 'Mesh');
    const splines = doc.graph.nodes.filter((n) => n.type === 'Spline');
    if (!scans.some((n) => n.id === o.scan)) o.scan = scans.find((n) => n.params.shape === 'imported')?.id || scans[0]?.id || '';
    if (!splines.some((n) => n.id === o.spline)) o.spline = splines[0]?.id || '';
    info = el('p', 'hint');
    const refresh = () => {
      const m = measure();
      info.textContent = m ? `Unwrapped size ${o.width} × ${m.H} (1 : ${(m.H / o.width).toFixed(2)}): ${Math.round(m.F.L)} cm long, about ${Math.round(m.fit.mean * 10) / 10} cm thick on average.` : 'Pick the scan and a Spline running up inside it (the plant must have built).';
    };
    const fitBtn = el('button', 'wide', 'Fit Spline thickness to the scan');
    fitBtn.addEventListener('click', () => { const m = measure(); if (!m) { refresh(); return; } fitThickness(m); changed({ layout: true }); commit(); toast('The Spline now follows the scan\'s thickness.'); });
    const go = el('button', 'wide primary', 'Bake and apply to the Spline'); go.addEventListener('click', () => run(true));
    const save = el('button', 'wide', 'Bake and save the maps'); save.addEventListener('click', () => run(false));
    panel.body.replaceChildren(
      selectField('Scan (Mesh)', o.scan, scans.map((n) => [n.id, n.name]), (v) => { o.scan = v; refresh(); }),
      selectField('Spline', o.spline, splines.map((n) => [n.id, n.name]), (v) => { o.spline = v; refresh(); }),
      selectField('Width', String(o.width), [256, 512, 1024, 2048, 4096].map((w) => [String(w), `${w} px`]), (v) => { o.width = +v; refresh(); }),
      checkField('Height to the nearest power of two', o.pow2, (v) => { o.pow2 = v; refresh(); }),
      info,
      numberField('Depth range', o.depth, { min: 0.1, max: 50, unit: 'cm' }, (v) => { o.depth = v; }),
      numberField('Normal strength', o.strength, { min: 0, max: 10 }, (v) => { o.strength = v; }),
      checkField('Flip the scan texture V', o.flipV, (v) => { o.flipV = v; }),
      checkField('Fit thickness when applying', o.fit, (v) => { o.fit = v; }),
      fitBtn, go, save,
    );
    refresh();
  }

  return {
    open() {
      panel ||= floatPanel('scan-bake', 'Bake from scan', { width: 380 });
      draw();
      panel.show();
    },
  };
}
