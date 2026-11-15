// Scan Bake: textures for a tube taken from a scanned (imported) trunk. Draw or pick a Spline that runs up the
// middle of the scan; the scan is unwrapped around it like a cylinder (u around, v along), at a size that keeps the
// tube's own aspect (width you pick, height from length over circumference, or the nearest power of two), and baked
// on the GPU: color from the scan's own texture, height from how far the surface stands out from the fitted
// radius, a normal map and occlusion from that height, and roughness, AO and subsurface from the scan material's
// own maps where it has them. Fit wraps the Spline's tube onto the scan with a Project modifier, and the maps
// become its bark material, laid once around and once along.
import * as THREE from 'three';
import { doc, commit, changed, primary, on } from './doc.js';
import { el, numberField, checkField, selectField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { newMaterial } from '../graph/materials.js';
import { SURFACE_MODS, newMod } from '../graph/defs-unified.js';
import { dilate } from '../leaf/imgops.js';
import { zipStore } from './zip.js';
import { download, safeName } from './io.js';
import { EXPORT_DEFAULTS, exportFields, finishMaps, planFiles, needs, withDefaults, toCanvas } from './texout.js';
import { lineFrames, cylCoords, fitRadius, unwrapSize, heightToNormal, tileAlong } from '../engine/unwrap.js';

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

// The average thickness (radius) of the spline's own tube along its first line: the surface the maps go on.
function tubeRadius(id) {
  const L = doc.result?.lines; if (!L?.radius) return 0;
  let first = null; let sum = 0; let n = 0;
  for (let k = 0; k < L.owner.length; k++) {
    if (L.nodeIds[L.owner[k]] !== id) continue;
    if (first === null) first = L.lineId[k];
    if (L.lineId[k] !== first) break;
    if (L.radius[k] > 0) { sum += L.radius[k]; n++; }
  }
  return n ? sum / n : 0;
}

const scanMesh = (view, id) => view.meshes.map((m) => m.userData.src).find((s) => s?.nodeId === id && s.position?.length);

function toImage(buf, W, H) {
  // GL rows run bottom up; pictures top down, with the tip of the tube at the top.
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  return img;
}

// Occlusion from the height map: points lower than the blurred surface around them sit in a crevice and darken.
// Rows wrap around the tube; along it they wrap too when the maps tile.
function cavity(h, wrapY) {
  const { width: W, height: H } = h; const r = Math.max(2, Math.round(W / 96));
  const src = new Float32Array(W * H); for (let i = 0; i < W * H; i++) src[i] = h.data[i * 4];
  const blur = (a, alongX) => {
    const out = new Float32Array(W * H); const n = alongX ? W : H; const m = alongX ? H : W;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        const q = alongX || wrapY ? (i + k + n) % n : Math.min(n - 1, Math.max(0, i + k));
        s += alongX ? a[j * W + q] : a[q * W + j];
      }
      out[alongX ? j * W + i : i * W + j] = s / (2 * r + 1);
    }
    return out;
  };
  const b = blur(blur(src, true), false);
  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let i = 0; i < W * H; i++) { const v = 255 * Math.min(1, Math.max(0, 1 - (3 * (b[i] - src[i])) / 255)); out.data.set([v, v, v, 255], i * 4); }
  return out;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const CHN = { R: 0, G: 1, B: 2, A: 3 };

export function makeScanBake({ view, toast }) {
  const o = { scan: '', spline: '', width: 1024, pow2: false, depth: 4, strength: 2, flipV: false, fit: false, tile: false, tileBand: 15 };
  // The maps and their settings, as the Bake panel and the texture packer have them.
  o.out = withDefaults({ name: '', maps: { ...EXPORT_DEFAULTS.maps, roughness: false, height: true } }, EXPORT_DEFAULTS);
  let panel = null; let info = null; let listed = ''; let measureInfo = null; let autoName = '';
  const nodeList = () => doc.graph.nodes.filter((n) => n.type === 'Mesh' || n.type === 'Spline').map((n) => n.id + n.name).join('|');

  function measure() {
    const s = scanMesh(view, o.scan); const P = splinePts(o.spline);
    if (!s || !P) return null;
    const F = lineFrames(P);
    const C = cylCoords(s.position, P, F);
    const fit = fitRadius(C, BINS);
    // The size follows the Spline's own tube, which the maps go on; the scan's thickness until it has one.
    const tube = tubeRadius(o.spline);
    return { s, P, F, C, fit, tube, H: unwrapSize(o.width, F.L, tube || fit.mean, o.pow2) };
  }

  const scanMaterial = () => {
    const matId = doc.graph.nodes.find((n) => n.id === o.scan)?.params.material;
    return (doc.graph.materials || []).find((x) => x.id === matId) || {};
  };

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
    // Each pass reads one of the scan material's maps (a channel, or all three for color), or its plain value.
    const mm = scanMaterial();
    const passes = [['color', mm.texture, -1, '#735c47'], ['height']];
    if (needs(o.out, 'roughness')) passes.push(['roughness', mm.roughMap, CHN[mm.roughCh] ?? 1, mm.roughColor || '#808080']);
    if (needs(o.out, 'ao')) passes.push(['ao', mm.aoMap, CHN[mm.aoCh] ?? 0, mm.aoColor || '#ffffff']);
    if (needs(o.out, 'subsurface')) passes.push(['subsurface', mm.sssMap, CHN[mm.sssCh] ?? 0, mm.sssColor || '#000000']);
    const load = async (id) => { const url = id && doc.assets[id]?.url; if (!url) return null; const t = await new THREE.TextureLoader().loadAsync(url); t.colorSpace = THREE.NoColorSpace; return t; };
    const maps = await Promise.all(passes.map((p) => load(p[1])));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, useMap: { value: 0 }, mode: { value: 0 }, ch: { value: -1 }, plain: { value: new THREE.Color() } },
      vertexShader: 'attribute vec2 suv; attribute float hgt; varying vec2 vUv; varying float vH; void main() { vUv = suv; vH = hgt; gl_Position = vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float useMap; uniform int mode; uniform int ch; uniform vec3 plain; varying vec2 vUv; varying float vH;
        void main() {
          if (mode == 1) { gl_FragColor = vec4(vec3(vH), 1.0); return; }
          if (useMap < 0.5) { gl_FragColor = vec4(plain, 1.0); return; }
          vec4 t = texture2D(map, vUv);
          gl_FragColor = ch < 0 ? vec4(t.rgb, 1.0) : vec4(vec3(ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a), 1.0);
        }`,
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
      passes.forEach(([name, , ch, plain], i) => {
        const u = mat.uniforms;
        u.mode.value = name === 'height' ? 1 : 0; u.map.value = maps[i]; u.useMap.value = maps[i] ? 1 : 0; u.ch.value = ch ?? -1;
        // Plain values are written as they are, like the picture data around them.
        u.plain.value.set(plain || '#000000');
        r.setRenderTarget(rt); r.clear(); r.render(scene, cam);
        const buf = new Uint8Array(W * H * 4);
        r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        out[name] = toImage(buf, W, H);
      });
    } finally {
      r.setRenderTarget(null); r.toneMapping = keep.tone; r.setClearColor(keep.clear, keep.alpha);
      rt.dispose(); g.dispose(); mat.dispose(); maps.forEach((t) => t?.dispose()); view.invalidate();
    }
    // Holes where the scan doesn't reach are filled from around them; then the maps are solid.
    for (const k of Object.keys(out)) { out[k] = dilate(out[k], 128); for (let i = 3; i < out[k].data.length; i += 4) out[k].data[i] = 255; }
    if (o.tile) for (const k of Object.keys(out)) out[k] = tileAlong(out[k], o.tileBand / 100);
    out.normal = heightToNormal(out.height, o.strength);
    if (out.ao) {
      const cav = cavity(out.height, o.tile);
      for (let i = 0; i < cav.data.length; i += 4) for (let c = 0; c < 3; c++) out.ao.data[i + c] = (out.ao.data[i + c] * cav.data[i]) / 255;
    }
    return out;
  }

  function fitThickness(m) {
    const n = doc.graph.nodes.find((x) => x.id === o.spline); if (!n) return;
    const max = Math.max(...m.fit.r);
    n.params.radius = Math.round(max * 100) / 100;
    n.params.curves = { ...n.params.curves, radius: { pts: [...m.fit.r].map((r, i) => [i / (BINS - 1), Math.round((r / max) * 1000) / 1000, 's']) } };
  }

  // Fit: the Spline's tube gets a Project modifier onto the picked scan (or its existing one now targets it).
  function fitProject() {
    const n = doc.graph.nodes.find((x) => x.id === o.spline);
    if (!n || n.type !== 'Spline' || !o.scan) { toast('Pick a Spline and the high-poly mesh first.'); return; }
    const list = n.params.meshMods ||= [];
    let mod = list.find((x) => x.type === 'project');
    if (!mod) {
      const params = Object.fromEntries(SURFACE_MODS.project.params.map((p) => [p.k, structuredClone(p.d)]));
      mod = newMod(`m${Date.now().toString(36)}`, 'project', params, { open: true });
      list.push(mod);
    }
    mod.on = true; mod.params.target = o.scan;
    const m = o.fit && measure();
    if (m) fitThickness(m);
    changed({ layout: true }); commit();
    toast(`${n.name} now wraps onto ${doc.graph.nodes.find((x) => x.id === o.scan)?.name || 'the scan'}. Its Project modifier is on the Mesh tab.`, 5000);
  }

  async function run(apply) {
    const m = measure();
    if (!m) { toast('Pick the high-poly mesh (a Mesh node) and a Spline that runs up its middle, and let the plant build.', 6000); return; }
    toast('Baking from the scan…', 2000);
    let files;
    const out = o.out;
    try {
      const maps = await bake(m);
      out.width = maps.color.width; out.height = maps.color.height;
      files = planFiles(finishMaps(maps, out), out);
    } catch (e) { console.error(e); toast(`Could not bake: ${e.message}`, 6000); return; }
    const n = doc.graph.nodes.find((x) => x.id === o.spline);
    const name = safeName(out.name || n?.name || 'trunk');
    const W = out.width; const H = out.height;
    const urls = files.map((f) => toCanvas(f.img).toDataURL(MIME[out.format] || 'image/png', out.quality));
    const fileName = (f) => `${name}_${f.suffix}.${out.format}`;
    if (!apply) {
      download(`${name}_scan_maps.zip`, new Blob([zipStore(files.map((f, i) => ({ name: fileName(f), data: Uint8Array.from(atob(urls[i].split(',')[1]), (c) => c.charCodeAt(0)) })))], { type: 'application/zip' }));
      toast(`Saved ${files.length} maps of ${W} × ${H}.`);
      return;
    }
    const stamp = Date.now().toString(36);
    const mat = newMaterial(`${n.name} scan`);
    files.forEach((f, i) => {
      const id = `img:scan-${f.key}-${stamp}`;
      doc.assets[id] = { name: fileName(f), url: urls[i] };
      // The scan covers the whole tube, so the bark stays solid: no opacity slot.
      for (const [slot, ch] of Object.entries(f.slots)) {
        if (slot === 'opacityMap') continue;
        mat[slot] = id;
        if (ch) mat[{ opacityMap: 'opacityCh', aoMap: 'aoCh', roughMap: 'roughCh', sssMap: 'sssCh' }[slot]] = ch;
        // A map is read as it is, not tinted by the plain value under it.
        const plain = { roughMap: 'roughColor', aoMap: 'aoColor', sssMap: 'sssColor', texture: 'color' }[slot];
        if (plain) mat[plain] = '#ffffff';
      }
    });
    (doc.graph.materials ||= []).push(mat);
    Object.assign(n.params, { material: mat.id, tileU: 0.5, tileV: 1, absLength: false, uvTwist: 0 });
    if (o.fit) fitThickness(m);
    changed({ layout: true }); commit();
    toast(`${n.name} now wears the scan: ${W} × ${H}. Turn its UV Offset U to line the seam up.`, 6000);
  }

  function draw() {
    listed = nodeList();
    const scans = doc.graph.nodes.filter((n) => n.type === 'Mesh');
    const splines = doc.graph.nodes.filter((n) => n.type === 'Spline');
    if (!scans.some((n) => n.id === o.scan)) o.scan = scans.find((n) => n.params.shape === 'imported')?.id || scans[0]?.id || '';
    if (primary()?.type === 'Spline') o.spline = primary().id;
    if (!splines.some((n) => n.id === o.spline)) o.spline = splines[0]?.id || '';
    // The file names follow the Spline, until a name of its own is typed.
    const auto = safeName(splines.find((n) => n.id === o.spline)?.name || 'trunk');
    if (!o.out.name || o.out.name === autoName) o.out.name = auto;
    autoName = auto;
    info = el('p', 'hint');
    const refresh = measureInfo = () => {
      const m = measure();
      const cm = (v) => Math.round(v * 10) / 10;
      info.textContent = m ? `Map size ${o.width} × ${m.H} (1 : ${(m.H / o.width).toFixed(2)}) for the Spline's tube: ${Math.round(m.F.L)} cm long, ${cm(m.tube || m.fit.mean)} cm thick${m.tube ? ` (the scan: ${cm(m.fit.mean)} cm)` : ''}.` : 'Pick the high-poly mesh, and a Spline running up inside it (select it, or pick it here).';
    };
    const pickList = (nodes, none) => (nodes.length ? nodes.map((n) => [n.id, n.name]) : [['', none]]);
    const fitBtn = el('button', 'wide', 'Fit: wrap the Spline onto the mesh');
    fitBtn.title = 'Adds a Project modifier to the Spline, with the high-poly mesh as its target.';
    fitBtn.addEventListener('click', fitProject);
    const go = el('button', 'wide primary', 'Bake and apply to the Spline'); go.addEventListener('click', () => run(true));
    const save = el('button', 'wide', 'Bake and save the maps'); save.addEventListener('click', () => run(false));
    // The size comes from the tube, so the export settings keep their name and format but not their size boxes.
    const [exp, mapsFold] = exportFields(o.out, { only: ['color', 'normal', 'height', 'ao', 'roughness', 'subsurface'] });
    exp.querySelector('.size-row')?.remove();
    panel.body.replaceChildren(
      selectField('Spline', o.spline, pickList(splines, 'No Spline yet'), (v) => { o.spline = v; draw(); }),
      selectField('High-poly mesh', o.scan, pickList(scans, 'No Mesh yet'), (v) => { o.scan = v; refresh(); }),
      fitBtn,
      selectField('Width', String(o.width), [256, 512, 1024, 2048, 4096].map((w) => [String(w), `${w} px`]), (v) => { o.width = +v; refresh(); }),
      checkField('Height to the nearest power of two', o.pow2, (v) => { o.pow2 = v; refresh(); }),
      info,
      numberField('Depth range', o.depth, { min: 0.1, max: 50, unit: 'cm' }, (v) => { o.depth = v; }),
      numberField('Normal strength', o.strength, { min: 0, max: 10 }, (v) => { o.strength = v; }),
      checkField('Flip the scan texture V', o.flipV, (v) => { o.flipV = v; }),
      checkField('Tileable along the length', o.tile, (v) => { o.tile = v; draw(); }),
      ...(o.tile ? [numberField('Blend band', o.tileBand, { min: 2, max: 45, unit: '%' }, (v) => { o.tileBand = v; })] : []),
      checkField('Fit the Spline’s thickness to the scan too', o.fit, (v) => { o.fit = v; }),
      mapsFold, exp,
      go, save,
    );
    refresh();
  }

  // Selecting a Spline (in the graph or the 3D view) picks it here.
  on('selection', () => { const n = primary(); if (panel?.isOpen() && n?.type === 'Spline' && n.id !== o.spline) draw(); });

  return {
    open() {
      panel ||= floatPanel('scan-bake', 'Scan Bake', { width: 380 });
      draw();
      panel.show();
    },
    // Meshes imported or Splines added while the panel is open show up in its lists.
    refresh() {
      if (panel?.isOpen()) { if (nodeList() !== listed) draw(); else measureInfo?.(); }
    },
  };
}
