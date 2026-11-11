// The 3D view: a transparent WebGL layer drawn over the node graph. It renders only when something changes.
import * as THREE from 'three';
import { doc } from './doc.js';
import { ShaderChunk } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { threeTexture, threeMap, solidMap } from './textures.js';
import { gustAt, WIND_STRIDE } from '../engine/wind.js';
import { bakeOcclusion } from './ao.js';
import { ScaleIndicator } from './scalefig.js';

const TREE_LAYER = 1;
const MASK_CELL = 4; // CSS pixels per mask cell
const ZONE_CELLS = 5; // how far around the tree still counts as "over the tree"
const SUN_DIR = new THREE.Vector3(0.5, 1, 0.65).normalize();
const WIND_ANGLE = 0.3; // radians of bend at the top of the wind's scale of 10
const WIND_ROW = 1024; // lines per row of the wind table

// Runs in the vertex shader: bends a point around its own line's base, then carries it with each parent up the chain.
const WIND_GLSL = `
  attribute vec3 aWind;
  uniform highp sampler2D uWindTable; uniform float uTime; uniform float uWindS; uniform vec3 uWindDir;
  vec3 windTurn(vec3 v, vec3 ax, float a) { float c = cos(a); float s = sin(a); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
  void windApply(inout vec3 p, inout vec3 n) {
    if (uWindS <= 0.0002) return;
    int i = int(aWind.x + 0.5);
    float w = aWind.y;
    float fl = aWind.z;
    for (int lv = 0; lv < 10 && i >= 0; lv++) {
      ivec2 at = ivec2((i % ${WIND_ROW}) * 4, i / ${WIND_ROW});
      vec4 A = texelFetch(uWindTable, at, 0);
      vec4 B = texelFetch(uWindTable, at + ivec2(1, 0), 0);
      vec4 C = texelFetch(uWindTable, at + ivec2(2, 0), 0);
      float ph = C.z + dot(A.xyz, uWindDir) * 0.004;
      float t = uTime * C.y + ph;
      if (fl > 0.0 && C.w > 0.0) {
        float f = uWindS * C.w * fl * sin(uTime * (5.0 + C.y) + ph * 3.0) * 0.9;
        p = A.xyz + windTurn(p - A.xyz, B.xyz, f);
        n = windTurn(n, B.xyz, f);
      }
      float amt = uWindS * C.x * w;
      if (amt != 0.0) {
        vec3 ax = cross(B.xyz, uWindDir);
        float l = length(ax);
        // Lean with the wind, swing around that lean, and drift a little sideways.
        bool lean = l > 0.05;
        ax = lean ? ax / l : normalize(cross(B.xyz, vec3(0.31, 0.87, 0.38)));
        float a = amt * ((lean ? 0.7 : 0.0) + 0.3 * sin(t) + 0.08 * sin(t * 2.1 + 1.1));
        p = A.xyz + windTurn(p - A.xyz, ax, a);
        n = windTurn(n, ax, a);
        vec3 side = normalize(cross(B.xyz, ax));
        float b = amt * 0.12 * sin(t * 0.73 + 2.0);
        p = A.xyz + windTurn(p - A.xyz, side, b);
        n = windTurn(n, side, b);
      }
      w = B.w;
      // A child leaf rides its parent leaf's shiver as much as the point it grows from does.
      fl = min(1.0, texelFetch(uWindTable, at + ivec2(3, 0), 0).x * 1.6);
      i = int(floor(A.w + 0.5));
    }
  }`;

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !matchMedia('(pointer: coarse)').matches;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.fullRatio = Math.min(devicePixelRatio || 1, 2);
    this.ratio = this.fullRatio;
    this.renderer.setPixelRatio(this.ratio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 10000);
    this.camera.layers.enable(TREE_LAYER);
    // Baking looks straight on, without perspective, so what's in the frame is what goes in the atlas.
    this.oCam = new THREE.OrthographicCamera();
    this.oCam.layers.enable(TREE_LAYER);
    this.ortho = false;
    this.locked = false;
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.bias = 0; this.biasY = 0;
    this.orbit = { yaw: 0.6, pitch: 0.12, dist: 1500, target: new THREE.Vector3(0, 300, 0) };
    this.mode = 'mesh';
    this.meshes = [];
    this.helpers = [];
    this.lines = null;
    this.selLines = null;
    this.box = null;
    this.materials = new Map();
    this.u = { uTime: { value: 0 }, uWindDir: { value: new THREE.Vector3(1, 0, 0) }, uWindS: { value: 0 }, uWindTable: { value: null }, uSunDir: { value: new THREE.Vector3() } };
    this.windOn = false;
    this.windNow = 0;
    this.windClock = 0;
    this.gust = { min: 0, max: 10, freq: 6, speed: 1 };
    this.shading = 'pbr';
    this.wireframe = false;
    this.scaleShow = 'off';
    this.units = 'metric';
    this.maskDirty = true;
    this.needs = true;
    this.anim = null;
    this.lastFrame = 0;
    this.slow = 0;

    // Image-based light gives metal and glossy surfaces something to reflect; the hemisphere keeps undersides lit.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xeef4ff, 0x58503c, 0.7));
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.ShadowMaterial({ opacity: 0.32 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // The floor stays at the origin, level and see-through, whatever the plant's bounds; parts below it go through.
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.renderOrder = -1;
    this.scene.add(this.floor);
    this.groundLook = { on: true, color: '#3a4a30', opacity: 0.35, size: 200, shadow: true, grid: true };
    this.setGround(this.groundLook);

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x9be15d);
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    this.preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd04d, depthTest: false }));
    this.preview.visible = false;
    this.scene.add(this.preview);

    this.maskTarget = null;
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.exact = null;
    this.zone = null;
    this.ray = new THREE.Raycaster();
    this.scale = new ScaleIndicator(this.scene, () => this.invalidate());
    this.sunDir = SUN_DIR.clone();
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => { this.invalidate(); });
    this.loop = this.loop.bind(this);
    this.applyCamera();
    this.invalidate();
  }

  resize(x, y, w, h, bias = 0, biasY = 0) {
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    this.bias = bias; this.biasY = biasY;
    Object.assign(this.canvas.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.renderer.setSize(this.rect.w, this.rect.h, false);
    this.applyCamera();
    this.maskDirty = true;
    this.invalidate();
  }

  applyCamera() {
    const { yaw, pitch, dist, target } = this.orbit;
    const c = this.camera;
    const { w, h } = this.rect;
    c.position.set(target.x + dist * Math.sin(yaw) * Math.cos(pitch), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    c.up.set(0, 1, 0);
    c.lookAt(target);
    c.near = Math.max(0.5, dist / 200);
    c.far = dist * 60 + 4000;
    c.aspect = w / h;
    // Shifts the picture sideways without moving the orbit pivot, so the tree can sit beside the panels.
    c.setViewOffset(w, h, -this.bias, -(this.biasY || 0), w, h);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    if (this.ortho) {
      const o = this.oCam;
      const half = dist * Math.tan((c.fov * Math.PI) / 360);
      Object.assign(o, { left: -half * c.aspect, right: half * c.aspect, top: half, bottom: -half, near: -dist * 20, far: c.far });
      o.position.copy(c.position); o.quaternion.copy(c.quaternion);
      o.setViewOffset(w, h, -this.bias, -(this.biasY || 0), w, h);
      o.updateProjectionMatrix(); o.updateMatrixWorld();
    }
    this.onCamera?.();
    this.u.uSunDir.value.copy(this.sunDir).transformDirection(c.matrixWorldInverse);
    this.scale?.place(c);
    this.maskDirty = true;
  }

  invalidate() {
    if (this.needs && this.raf) return;
    this.needs = true;
    this.raf ||= requestAnimationFrame(this.loop);
  }

  moved() { this.applyCamera(); this.interacting = performance.now(); this.invalidate(); }

  loop(now) {
    this.raf = 0;
    if (this.anim) this.stepAnim(now);
    const blowing = this.stepWind(now);
    // Trade sharpness for smoothness while moving, then render one sharp frame at rest.
    const moving = now - (this.interacting || 0) < 200;
    if (moving && this.lastFrame) {
      this.slow = now - this.lastFrame > 30 ? this.slow + 1 : Math.max(0, this.slow - 1);
      if (this.slow > 6 && this.ratio > 0.6) { this.setRatio(this.ratio * 0.8); this.slow = 0; }
    } else if (!moving && this.ratio !== this.fullRatio) { this.setRatio(this.fullRatio); this.needs = true; }
    this.lastFrame = moving ? now : 0;
    if (this.needs) {
      this.needs = false;
      this.renderer.render(this.scene, this.ortho ? this.oCam : this.camera);
      this.onRender?.();
    }
    if (blowing || this.anim || moving || this.needs) this.raf = requestAnimationFrame(this.loop);
  }

  // The fan: while on, gusts come and go. Off, whatever wind is left dies down instead of snapping back.
  stepWind(now) {
    const dt = Math.min(0.1, (now - (this.windFrame || now)) / 1000);
    this.windFrame = now;
    if (!this.windOn && this.windNow <= 0.001) { this.windFrame = 0; return false; }
    this.windClock += dt;
    const target = this.windOn ? gustAt(this.windClock, this.gust) : 0;
    // Gusts ease in rather than jumping, and a fan switched off coasts down over a couple of seconds.
    this.windNow += (target - this.windNow) * Math.min(1, dt * (this.windOn ? 4 : 1.6));
    this.u.uTime.value += dt * this.gust.speed;
    this.u.uWindS.value = (this.windNow / 10) * WIND_ANGLE;
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    this.needs = true;
    return true;
  }

  setWind(on) { this.windOn = on; this.windFrame = 0; this.invalidate(); }

  setGust({ min, max, freq, speed, dir }) {
    this.gust = { min: Math.min(min, max), max: Math.max(min, max), freq, speed };
    const a = (dir * Math.PI) / 180;
    this.u.uWindDir.value.set(Math.cos(a), 0, Math.sin(a));
  }

  setShading(mode) {
    this.shading = mode;
    if (mode === 'gray') this.bakeAo();
    this.highlight();
  }

  // The wireframe lies on top of the shaded plant, in a color and strength from the settings.
  setWireframe(on) { this.wireframe = on; this.updateWire(); this.invalidate(); }

  setWireLook(color, opacity) {
    this.wireLook = { color, opacity };
    if (this.wireMat) { this.wireMat.color.set(color); this.wireMat.opacity = opacity; }
    this.invalidate();
  }

  updateWire() {
    for (const m of this.meshes) for (const ch of [...m.children]) if (ch.userData.wire) m.remove(ch);
    if (!this.wireframe) return;
    this.wireMat ||= new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, depthWrite: false, toneMapped: false });
    this.wireMat.color.set(this.wireLook?.color || '#000000');
    this.wireMat.opacity = this.wireLook?.opacity ?? 0.35;
    for (const m of this.meshes) {
      const w = new THREE.Mesh(m.geometry, this.wireMat);
      w.userData.wire = true; w.renderOrder = 2;
      m.add(w);
    }
  }

  // Turns the sun around the plant, keeping its height.
  setSunYaw(deg) {
    const a = (deg * Math.PI) / 180; const r = Math.hypot(0.5, 0.65);
    this.sunDir.set(Math.sin(a) * r, 1, Math.cos(a) * r).normalize();
    if (this.box) this.placeSun(new THREE.Box3(new THREE.Vector3(...this.box.slice(0, 3)), new THREE.Vector3(...this.box.slice(3))));
    this.renderer.shadowMap.needsUpdate = true;
    this.applyCamera();
    this.invalidate();
  }

  bakeAo() {
    if (!this.box || !this.meshes.length) return;
    const baked = bakeOcclusion(this.meshes.map((m) => ({ position: m.geometry.getAttribute('position').array, normal: m.geometry.getAttribute('normal').array })), this.box);
    this.meshes.forEach((m, i) => m.geometry.setAttribute('aAo', new THREE.BufferAttribute(baked[i], 1)));
  }

  setScale(show, units) {
    this.scaleShow = show;
    this.units = units;
    this.scale.update(this.box, show, units);
    this.scale.place(this.camera);
    this.invalidate();
  }

  setRatio(r) {
    this.ratio = r;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(this.rect.w, this.rect.h, false);
    this.needs = true;
  }

  // ---- Camera ----
  // Straight on from one side, as the view gizmo snaps to.
  setView(yaw, pitch) { this.anim = null; this.orbit.yaw = yaw; this.orbit.pitch = pitch; this.moved(); }

  setOrtho(on) { this.ortho = on; this.applyCamera(); this.invalidate(); }

  orbitBy(dx, dy) {
    if (this.locked) return;
    this.anim = null;
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.006, -1.45, 1.45);
    this.moved();
  }

  panBy(dx, dy) {
    if (this.locked) return;
    this.anim = null;
    const k = (2 * this.orbit.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.rect.h;
    const m = this.camera.matrixWorld.elements;
    this.orbit.target.x += (-m[0] * dx + m[4] * dy) * k;
    this.orbit.target.y += (-m[1] * dx + m[5] * dy) * k;
    this.orbit.target.z += (-m[2] * dx + m[6] * dy) * k;
    this.moved();
  }

  // Point on the plane through `through` facing the camera, under a screen position.
  pointAt(x, y, through = this.orbit.target) {
    const ndc = new THREE.Vector2(((x - this.rect.x) / this.rect.w) * 2 - 1, -((y - this.rect.y) / this.rect.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(through.x, through.y, through.z));
    return this.ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  // Keeps the point under the pointer still while the camera moves closer.
  zoomAt(x, y, factor) {
    if (this.locked) return;
    this.anim = null;
    const hit = this.pointAt(x, y);
    const f = THREE.MathUtils.clamp(factor, 0.2, 5);
    const next = THREE.MathUtils.clamp(this.orbit.dist * f, 2, 60000);
    const real = next / this.orbit.dist;
    if (hit) this.orbit.target.lerp(hit, 1 - real);
    this.orbit.dist = next;
    this.moved();
  }

  frameBox(b, instant = false) {
    if (!b || !Number.isFinite(b[0])) return;
    const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const r = Math.max(Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2, 4);
    const vfov = (this.camera.fov * Math.PI) / 360;
    const hfov = Math.atan(Math.tan(vfov) * Math.min(this.camera.aspect, 1.6));
    const dist = (r / Math.sin(Math.min(vfov, hfov))) * 1.02;
    if (instant) { this.orbit.target.copy(c); this.orbit.dist = dist; this.moved(); return; }
    this.anim = { t0: performance.now(), from: this.orbit.target.clone(), to: c, d0: this.orbit.dist, d1: dist };
    this.invalidate();
  }

  frameAll(instant) { this.frameBox(this.box, instant); }

  stepAnim(now) {
    const a = this.anim;
    const t = Math.min(1, (now - a.t0) / 320);
    const e = 1 - (1 - t) ** 3;
    this.orbit.target.lerpVectors(a.from, a.to, e);
    this.orbit.dist = a.d0 * (a.d1 / a.d0) ** e;
    this.moved();
    if (t >= 1) this.anim = null;
  }

  // ---- Result ----
  material(m, selected, flags) {
    const mm = m.material;
    const shade = this.shading;
    const key = `${m.kind}|${JSON.stringify(mm)}|${selected}|${flags.blend}|${shade}|${this.wireframe}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const leaf = m.kind === 'leaf';
    const aniso = this.renderer.capabilities.getMaxAnisotropy() > 4 ? 8 : 4;
    const data = (name, ch = null) => (name ? threeMap(name, ch, doc.assets, () => this.invalidate(), aniso) : null);
    const map = mm.texture ? threeTexture(mm.texture, doc.assets, () => this.invalidate(), aniso) : null;
    // The diffuse alpha already carries opacity when both slots name the same image.
    const opacity = mm.opacityMap === mm.texture && mm.opacityCh === 'A' ? null : data(mm.opacityMap, mm.opacityCh);
    const wire = false;
    const cut = !wire && !!((leaf && map) || mm.opacityMap);
    const common = {
      map, side: leaf || cut ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: cut ? 0.32 : 0, alphaToCoverage: cut, alphaMap: opacity, wireframe: wire,
    };
    const see = mm.opacityColor ? parseInt(mm.opacityColor.slice(1, 3), 16) / 255 : 1;
    if (see < 1) { common.transparent = true; common.opacity = see; }
    if (shade === 'flat') {
      mat = new THREE.MeshBasicMaterial({ ...common, color: mm.color, vertexColors: true, toneMapped: false });
    } else if (shade === 'gray') {
      mat = new THREE.MeshStandardMaterial({ ...common, color: 0xffffff, roughness: 0.92, metalness: 0 });
    } else if (shade === 'color') {
      mat = new THREE.MeshStandardMaterial({ ...common, color: mm.color, roughness: 0.8, metalness: 0, vertexColors: true });
    } else {
      mat = new THREE.MeshStandardMaterial({
        ...common, color: mm.color, roughness: mm.roughness, metalness: 0, vertexColors: true,
        roughnessMap: data(mm.roughMap, mm.roughCh), aoMap: mm.aoMap ? data(mm.aoMap, mm.aoCh) : mm.aoColor ? solidMap(mm.aoColor) : null, aoMapIntensity: mm.aoAmount ?? 1,
      });
      if (mm.normalMap) { mat.normalMap = data(mm.normalMap); mat.normalScale.setScalar(mm.normalScale ?? 1); }
      else if (mm.normalColor) mat.normalMap = solidMap(mm.normalColor);
      else if (!leaf && map) { mat.bumpMap = map; mat.bumpScale = 1.4; }
    }
    if (selected && shade !== 'flat') mat.emissive = new THREE.Color(0x12280a);
    const defines = {};
    if (flags.blend) defines.BARK_BLEND = 1;
    if (flags.wind) defines.WIND = 1;
    if (leaf && shade === 'pbr') defines.LEAF = 1;
    if (map && !mm.texture.startsWith('bark:')) defines.UNPREMUL = 1;
    if (shade === 'gray') defines.GRAY = 1;
    if (shade === 'color') defines.AVG_COLOR = 1;
    // Subsurface is a color: black means none. It only shows in the full PBR view.
    const sss = new THREE.Color().setRGB(...[1, 3, 5].map((k) => parseInt((mm.sssColor || '#000000').slice(k, k + 2), 16) / 255), THREE.LinearSRGBColorSpace);
    const hasSss = shade === 'pbr' && (mm.sssMap || sss.r + sss.g + sss.b > 0);
    if (hasSss) defines.SSS = 1;
    const sssMap = hasSss ? data(mm.sssMap, mm.sssCh) : null;
    if (sssMap) defines.SSS_MAP = 1;
    if (hasSss && mm.sssMap && sss.r + sss.g + sss.b === 0) sss.setRGB(1, 1, 1);
    mat.defines = { ...mat.defines, ...defines };
    mat.onBeforeCompile = (shader) => {
      if (hasSss) Object.assign(shader.uniforms, { uSss: { value: sss }, uSssMap: { value: sssMap } });
      this.patch(shader);
    };
    mat.customProgramCacheKey = () => Object.keys(defines).join();
    this.materials.set(key, mat);
    return mat;
  }

  // Shadows bend with the plant, so they share its wind.
  depthMaterial(map) {
    const key = `depth|${map ? map.uuid : ''}`;
    let d = this.materials.get(key);
    if (d) return d;
    d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? 0.32 : 0 });
    d.defines = { ...d.defines, WIND: 1 };
    d.onBeforeCompile = (shader) => this.patch(shader);
    d.customProgramCacheKey = () => 'wind-depth';
    this.materials.set(key, d);
    return d;
  }

  patch(shader) {
    Object.assign(shader.uniforms, this.u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <uv_vertex>', `#ifdef WIND
          vec3 windPos = position; vec3 windNormal = normal;
          windApply(windPos, windNormal);
        #endif
        #include <uv_vertex>`)
      .replace('#include <beginnormal_vertex>', `#ifdef WIND
          vec3 objectNormal = windNormal;
        #else
          #include <beginnormal_vertex>
        #endif`)
      .replace('#include <common>', `#include <common>
        #ifdef BARK_BLEND
          attribute vec2 aUv1; attribute float aBlend; varying vec2 vUv1; varying float vBlend;
        #endif
        #ifdef WIND
          ${WIND_GLSL}
        #endif
        #ifdef GRAY
          attribute float aAo; varying float vAo;
        #endif
        #ifdef SSS_MAP
          varying vec2 vUvS;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef SSS_MAP
          vUvS = uv;
        #endif
        #ifdef BARK_BLEND
          vUv1 = aUv1; vBlend = aBlend;
        #endif
        #ifdef GRAY
          vAo = aAo;
        #endif
        #ifdef WIND
          transformed = windPos;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        #ifdef BARK_BLEND
          varying vec2 vUv1; varying float vBlend;
        #endif
        #ifdef SSS
          uniform vec3 uSss; uniform vec3 uSunDir;
        #endif
        #ifdef GRAY
          varying float vAo;
        #endif
        #ifdef SSS_MAP
          uniform sampler2D uSssMap; varying vec2 vUvS;
        #endif`)
      // Light passing through thin surfaces: strongest looking toward the sun through the leaf.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #ifdef SSS
          vec3 sssAmount = uSss;
          #ifdef SSS_MAP
            sssAmount *= texture2D(uSssMap, vUvS).x;
          #endif
          vec3 sssView = normalize(vViewPosition);
          float sssBack = pow(saturate(dot(sssView, -normalize(uSunDir + normal * 0.4))), 3.0) * 1.6 + saturate(dot(-normal, uSunDir)) * 0.7;
          reflectedLight.directDiffuse += diffuseColor.rgb * sssBack * sssAmount * 2.0;
        #endif`)
      // The bump relief must cross-fade with the bark too, or the joint still shows as a shading step.
      .replace('#include <bumpmap_pars_fragment>', ShaderChunk.bumpmap_pars_fragment.replace(/vec2 dHdxy_fwd\(\) \{[\s\S]*?return vec2\( dBx, dBy \);\s*\}/, `
        #ifdef BARK_BLEND
          float bumpAt(vec2 a, vec2 b) { return mix(texture2D(bumpMap, a).x, texture2D(bumpMap, b).x, vBlend); }
          vec2 dHdxy_fwd() {
            float h = bumpAt(vBumpMapUv, vUv1);
            return bumpScale * vec2(bumpAt(vBumpMapUv + dFdx(vBumpMapUv), vUv1 + dFdx(vUv1)) - h, bumpAt(vBumpMapUv + dFdy(vBumpMapUv), vUv1 + dFdy(vUv1)) - h);
          }
        #else
          vec2 dHdxy_fwd() {
            vec2 dx = dFdx(vBumpMapUv); vec2 dy = dFdy(vBumpMapUv);
            float h = texture2D(bumpMap, vBumpMapUv).x;
            return bumpScale * vec2(texture2D(bumpMap, vBumpMapUv + dx).x - h, texture2D(bumpMap, vBumpMapUv + dy).x - h);
          }
        #endif`))
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          #ifdef BARK_BLEND
            // Fades the branch's bark into the parent's at the joint, so no texture seam shows.
            texel = mix(texel, texture2D(map, vUv1), vBlend);
          #endif
          #ifdef UNPREMUL
            texel.rgb /= max(texel.a, 0.004);
          #endif
          #ifdef AVG_COLOR
            // A texture's average, from its smallest mip: the plain color it reads as from far away.
            vec4 average = textureLod(map, vMapUv, 12.0);
            texel.rgb = average.rgb / max(average.a, 0.02);
          #endif
          diffuseColor *= texel;
        #endif
        #ifdef GRAY
          diffuseColor.rgb = vec3(0.34) * vAo;
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef LEAF
          totalEmissiveRadiance += diffuseColor.rgb * 0.1;
        #endif`);
  }

  apply(res) {
    const first = !this.box;
    for (const m of this.meshes) { m.geometry.dispose(); this.scene.remove(m); }
    for (const h of this.helpers) { h.geometry.dispose(); h.material.dispose(); this.scene.remove(h); }
    this.meshes = [];
    this.helpers = [];
    const box = new THREE.Box3();
    this.setWindTable(res.windLines);
    for (const m of res.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
      if (m.uv1) { g.setAttribute('aUv1', new THREE.BufferAttribute(m.uv1, 2)); g.setAttribute('aBlend', new THREE.BufferAttribute(m.blend, 1)); }
      if (m.wind) g.setAttribute('aWind', new THREE.BufferAttribute(m.wind, 3));
      if (m.color2) g.setAttribute('color_1', new THREE.BufferAttribute(m.color2, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      box.union(g.boundingBox);
      const flags = { blend: !!m.uv1, wind: !!m.wind };
      const mesh = new THREE.Mesh(g, this.material(m, doc.sel.has(m.nodeId), flags));
      mesh.userData = { src: m, flags };
      mesh.layers.enable(TREE_LAYER);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.depthMaterial(m.kind === 'leaf' ? mesh.material.map : null);
      mesh.visible = this.mode === 'mesh';
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.buildLines(res);
    this.buildHelpers(res);
    if (box.isEmpty() && res.lines.position.length) {
      const g = this.lines.geometry; g.computeBoundingBox(); box.copy(g.boundingBox);
    }
    if (!box.isEmpty()) {
      this.box = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
      this.placeSun(box);
    }
    if (this.shading === 'gray') this.bakeAo();
    this.scale.update(this.box, this.scaleShow, this.units);
    this.scale.place(this.camera);
    this.highlight();
    if (this.wireframe) this.updateWire();
    if (first || this.fitNext) { this.fitNext = false; this.frameAll(true); }
    this.renderer.shadowMap.needsUpdate = true;
    this.maskDirty = true;
    this.invalidate();
  }

  // One row holds 1024 lines of four pixels each; texelFetch reads them without any filtering.
  setWindTable(table) {
    this.windLines = table;
    const lines = table.length / WIND_STRIDE;
    const h = Math.max(1, Math.ceil(lines / WIND_ROW));
    const data = new Float32Array(WIND_ROW * 4 * h * 4);
    data.set(table);
    this.u.uWindTable.value?.dispose();
    const t = new THREE.DataTexture(data, WIND_ROW * 4, h, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    this.u.uWindTable.value = t;
  }

  placeSun(box) {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
    this.sun.position.copy(c).add(this.sunDir.clone().multiplyScalar(r * 2.4));
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -r * 1.25; s.right = s.top = r * 1.25; s.near = 1; s.far = r * 5;
    s.updateProjectionMatrix();
    this.sun.shadow.normalBias = r / 700;
    this.ground.scale.setScalar(Math.max(r * 1.5, (+this.groundLook.size || 200) / 2));
  }

  buildLines(res) {
    if (this.lines) { this.lines.geometry.dispose(); this.scene.remove(this.lines); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(res.lines.position, 3));
    g.setAttribute('color', new THREE.BufferAttribute(res.lines.color, 3));
    this.lines ||= new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.lines.geometry = g;
    this.lines.visible = this.mode === 'lines';
    this.lines.layers.enable(TREE_LAYER);
    this.scene.add(this.lines);
  }

  buildHelpers(res) {
    for (const h of res.helpers) {
      if (h.kind === 'cloud' && h.points.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(h.points, 3));
        const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x62aeea, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
        this.scene.add(p);
        this.helpers.push(p);
      } else if (h.kind === 'object') {
        let g;
        if (h.obj?.v?.length) {
          g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(h.obj.v, 3));
          g.setIndex(h.obj.idx);
          g.computeVertexNormals();
        // Sizes here are half-widths, the same measure the engine grows from.
        } else if (h.shape === 'box') g = new THREE.BoxGeometry(h.size[0] * 2, h.size[1] * 2, h.size[2] * 2);
        else if (h.shape === 'plane' || h.shape === 'square') g = new THREE.PlaneGeometry(h.size[0] * 2, h.size[2] * 2).rotateX(-Math.PI / 2);
        else if (h.shape === 'disk') g = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2).scale(h.size[0], 1, h.size[2]);
        else g = new THREE.SphereGeometry(1, 32, 20).scale(h.size[0], h.size[1], h.size[2]);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: h.color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
        m.position.set(h.pos[0], h.pos[1], h.pos[2]);
        if (h.obj?.v?.length) m.scale.setScalar(h.size[0] / 100);
        this.scene.add(m);
        this.helpers.push(m);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    for (const m of this.meshes) m.visible = mode === 'mesh';
    if (this.lines) this.lines.visible = mode === 'lines';
    this.showGround();
    this.maskDirty = true;
    this.invalidate();
  }

  // How much of the screen the plant covers, so the graph can fade behind it.
  plantScreen() {
    if (!this.box || this.mode !== 'mesh') return null;
    const v = new THREE.Vector3();
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(this.box[i & 1 ? 3 : 0], this.box[i & 2 ? 4 : 1], this.box[i & 4 ? 5 : 2]).project(this.camera);
      const x = this.rect.x + ((v.x + 1) / 2) * this.rect.w; const y = this.rect.y + ((1 - v.y) / 2) * this.rect.h;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }

  // The sun off leaves only the soft light from around.
  setSunOn(on) { this.sun.visible = on; this.renderer.shadowMap.needsUpdate = true; this.invalidate(); }

  setGround(look) {
    this.groundLook = { ...this.groundLook, ...look };
    const g = this.groundLook; const r = Math.max(1, +g.size || 200) / 2;
    this.floor.scale.setScalar(r);
    this.floor.position.set(0, 0, 0); this.ground.position.set(0, 0.05, 0);
    this.floor.material.opacity = +g.opacity;
    this.floor.material.map?.dispose();
    this.floor.material.map = groundTexture(g.color, r, g.grid);
    this.floor.material.needsUpdate = true;
    this.showGround();
  }

  showGround() {
    const g = this.groundLook; const mesh = this.mode === 'mesh';
    this.floor.visible = mesh && g.on && +g.opacity > 0;
    this.ground.visible = mesh && g.shadow && this.renderer.shadowMap.enabled;
    // Not while the view is still being made: its frame loop isn't bound yet.
    if (Object.hasOwn(this, 'loop')) this.invalidate();
  }

  setLook(exposure, env) {
    this.renderer.toneMappingExposure = exposure;
    this.scene.environmentIntensity = env;
    this.invalidate();
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.showGround();
    for (const m of this.materials.values()) m.needsUpdate = true;
    this.renderer.shadowMap.needsUpdate = on;
    this.invalidate();
  }

  // Tints what the selected nodes built, and boxes the first one so modifiers show their reach.
  highlight() {
    const res = doc.result;
    if (this.selLines) { this.selLines.geometry.dispose(); this.scene.remove(this.selLines); this.selLines = null; }
    this.selBox.visible = false;
    for (const mesh of this.meshes) {
      const { src, flags } = mesh.userData;
      mesh.material = this.material(src, doc.sel.has(src.nodeId), flags);
    }
    if (!res || !doc.sel.size) { this.invalidate(); return; }
    const owners = new Set();
    res.lines.nodeIds.forEach((id, i) => { if (doc.sel.has(id)) owners.add(i); });
    if (owners.size) {
      const { owner, position } = res.lines;
      const list = [];
      for (let i = 0; i < owner.length; i++) if (owners.has(owner[i])) list.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      this.selLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9be15d }));
      this.selLines.renderOrder = 5;
      this.scene.add(this.selLines);
    }
    // Paths and modifiers have no mesh of their own to tint, so a box shows what they reach.
    const tinted = this.mode === 'mesh' && this.meshes.some((m) => doc.sel.has(m.userData.src.nodeId));
    const b = this.boxOf([...doc.sel]);
    if (b && !tinted && (!owners.size || this.mode === 'mesh')) {
      this.selBox.box.min.set(b[0], b[1], b[2]);
      this.selBox.box.max.set(b[3], b[4], b[5]);
      this.selBox.visible = true;
    }
    this.invalidate();
  }

  boxOf(ids) {
    const boxes = doc.result?.boxes;
    if (!boxes) return null;
    let out = null;
    for (const id of ids) {
      const b = boxes[id];
      if (!b || !Number.isFinite(b[0])) continue;
      out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.min(out[2], b[2]), Math.max(out[3], b[3]), Math.max(out[4], b[4]), Math.max(out[5], b[5])] : [...b];
    }
    return out;
  }

  // ---- What is under the pointer ----
  // A small silhouette of the tree, read back only when the view has changed.
  updateMask() {
    if (!this.maskDirty) return;
    this.maskDirty = false;
    const w = Math.ceil(this.rect.w / MASK_CELL);
    const h = Math.ceil(this.rect.h / MASK_CELL);
    if (!this.maskTarget || this.maskTarget.width !== w || this.maskTarget.height !== h) {
      this.maskTarget?.dispose();
      this.maskTarget = new THREE.WebGLRenderTarget(w, h);
      this.maskRead = new Uint8Array(w * h * 4);
      this.exact = new Uint8Array(w * h);
      this.zone = new Uint8Array(w * h);
      this.zoneTmp = new Uint8Array(w * h);
    }
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    this.camera.layers.set(TREE_LAYER);
    this.scene.overrideMaterial = this.maskMat;
    r.setRenderTarget(this.maskTarget);
    r.clear();
    r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    r.setRenderTarget(prevTarget);
    this.camera.layers.enable(0);
    r.readRenderTargetPixels(this.maskTarget, 0, 0, w, h, this.maskRead);
    for (let y = 0; y < h; y++) {
      const flip = (h - 1 - y) * w;
      for (let x = 0; x < w; x++) this.exact[y * w + x] = this.maskRead[(flip + x) * 4 + 3] > 0 ? 1 : 0;
    }
    this.w = w; this.h = h;
    dilate(this.exact, this.zoneTmp, this.zone, w, h, ZONE_CELLS);
    this.needs = true;
  }

  cellAt(arr, x, y) {
    const cx = Math.floor((x - this.rect.x) / MASK_CELL);
    const cy = Math.floor((y - this.rect.y) / MASK_CELL);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0;
    return arr[cy * this.w + cx];
  }

  isOverTree(x, y) { this.updateMask(); return !!this.cellAt(this.zone, x, y); }
  isOnTree(x, y) { this.updateMask(); return !!this.cellAt(this.exact, x, y); }

  // Nearest line under the pointer, so clicking a branch selects the node that made it.
  pick(x, y, onlyOwner = null, tol = 14) {
    const res = doc.result;
    if (!res) return null;
    const { position: P, owner, nodeIds, lineId } = res.lines;
    const px = x - this.rect.x; const py = y - this.rect.y;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const w2 = this.rect.w / 2; const h2 = this.rect.h / 2;
    const proj = (i) => {
      const a = P[i]; const b = P[i + 1]; const c = P[i + 2];
      const w = m[3] * a + m[7] * b + m[11] * c + m[15];
      if (w <= 0) return null;
      return [((m[0] * a + m[4] * b + m[8] * c + m[12]) / w + 1) * w2, (1 - (m[1] * a + m[5] * b + m[9] * c + m[13]) / w) * h2, w];
    };
    let best = null; let bestScore = tol * tol;
    for (let i = 0; i + 1 < owner.length; i += 2) {
      if (onlyOwner !== null && nodeIds[owner[i]] !== onlyOwner) continue;
      const s = proj(i * 3);
      const e = s && proj((i + 1) * 3);
      if (!e) continue;
      const dx = e[0] - s[0]; const dy = e[1] - s[1];
      const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / (dx * dx + dy * dy || 1)));
      const qx = s[0] + dx * t - px; const qy = s[1] + dy * t - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < bestScore) {
        bestScore = d2;
        best = { nodeId: nodeIds[owner[i]], lineId: lineId[i], seg: i, t, point: [P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * t, P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * t, P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * t] };
      }
    }
    return best;
  }

  // Which parent line a drawn stroke starts on, and how far along it.
  strokeAnchor(hit) {
    const { lineId, owner, nodeIds } = doc.result.lines;
    const ids = [];
    let first = -1; let count = 0;
    for (let i = 0; i < lineId.length; i += 2) {
      if (nodeIds[owner[i]] !== hit.nodeId) continue;
      if (!ids.includes(lineId[i])) ids.push(lineId[i]);
      if (lineId[i] === hit.lineId) { if (first < 0) first = i; count++; }
    }
    return { parent: ids.indexOf(hit.lineId), t: ((hit.seg - first) / 2 + hit.t) / Math.max(1, count) };
  }

  showPreview(pts) {
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    this.preview.visible = pts.length > 1;
    this.invalidate();
  }

  // A picture of the whole plant on a transparent background, independent of the window and the panels.
  renderImage(size = 2048, opts = {}) {
    const keep = { rect: this.rect, bias: this.bias, biasY: this.biasY, sel: doc.sel, target: this.orbit.target.clone(), dist: this.orbit.dist, ground: this.ground.visible, floor: this.floor.visible, clear: this.renderer.getClearColor(new THREE.Color()), alpha: this.renderer.getClearAlpha() };
    this.scale.group.visible = false;
    if (opts.figure) this.scale.update(this.box, opts.figure, this.units);
    if (opts.ground === false) { this.ground.visible = false; this.floor.visible = false; }
    if (opts.bg) this.renderer.setClearColor(opts.bg, 1);
    doc.sel = new Set();
    this.highlight();
    this.anim = null;
    this.rect = { x: 0, y: 0, w: size, h: size };
    this.bias = 0; this.biasY = 0;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.applyCamera();
    this.frameAll(true);
    if (opts.figure) this.scale.place(this.camera);
    this.renderer.render(this.scene, this.camera);
    // Read back in the same task, before the browser clears the canvas.
    const url = this.canvas.toDataURL('image/png');
    this.ground.visible = keep.ground; this.floor.visible = keep.floor;
    this.renderer.setClearColor(keep.clear, keep.alpha);
    doc.sel = keep.sel;
    this.scale.update(this.box, this.scaleShow, this.units);
    this.rect = keep.rect;
    this.bias = keep.bias; this.biasY = keep.biasY;
    this.orbit.target.copy(keep.target);
    this.orbit.dist = keep.dist;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(this.rect.w, this.rect.h, false);
    this.applyCamera();
    this.highlight();
    this.invalidate();
    return url;
  }

}

// The ground's picture: its color fading out toward the rim, with a faint 10 cm grid that fades with it.
function groundTexture(color, radius, grid) {
  const S = 512; const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  if (grid) {
    const step = (S / (radius * 2)) * 10;
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
    if (step >= 3) for (let x = S / 2 % step; x < S; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.moveTo(0, x); g.lineTo(S, x); g.stroke(); }
  }
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  // Fade both color and grid out toward the edge.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.55, 'rgba(0,0,0,.85)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dilate(src, tmp, out, w, h, r) {
  for (let y = 0; y < h; y++) {
    let last = -1e6;
    for (let x = 0; x < w; x++) { if (src[y * w + x]) last = x; tmp[y * w + x] = x - last <= r ? 1 : 0; }
    last = 1e6;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e6;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; out[y * w + x] = y - last <= r ? 1 : 0; }
    last = 1e6;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
}
