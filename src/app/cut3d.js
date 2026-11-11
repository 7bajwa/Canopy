// Edits a cutout's shape in 3D. Left-drag on empty space picks points in a box (Shift adds), a click picks one,
// dragging a picked point moves every picked one; right-drag pans, middle-drag revolves, the wheel zooms, and the
// icons under the gizmo do the same. Straighten lines the picked points up on one axis, Gridify pulls them into
// the rows and columns they nearly form, Snap puts moved points on the grid. Points move the geometry only, keeping
// the texture where it was, unless Preserve UVs is on; then moves across the leaf also move it on the picture.
import * as THREE from 'three';
import { ViewGizmo } from './gizmo.js';

const S = 100; // leaf lengths to scene units
const GRID = 5; // grid step, in scene units (a twentieth of the leaf length)

// The picked points lined up: each set to their average on that axis (0 x, 1 y, 2 z).
export const straighten = (list, axis) => {
  const avg = list.reduce((s, v) => s + v[axis], 0) / Math.max(1, list.length);
  return list.map((v) => { const o = [...v]; o[axis] = avg; return o; });
};
export const snapTo = (list, step) => list.map((v) => v.map((x) => Math.round(x / step) * step));

// Points that nearly share a value on an axis (within `tol`) get exactly their group's average, on every axis, so
// rough rows and columns become straight ones.
export function gridify(list, tol) {
  const out = list.map((v) => [...v]);
  for (let axis = 0; axis < 3; axis++) {
    const order = out.map((v, i) => i).sort((a, b) => out[a][axis] - out[b][axis]);
    let group = [];
    const flush = () => { if (group.length > 1) { const avg = group.reduce((s, i) => s + out[i][axis], 0) / group.length; for (const i of group) out[i][axis] = avg; } group = []; };
    for (const i of order) { if (group.length && out[i][axis] - out[group[0]][axis] > tol) flush(); group.push(i); }
    flush();
  }
  return out;
}

export class Cut3D {
  constructor(host, deps) {
    this.host = host;
    this.deps = deps;
    this.canvas = host.querySelector('canvas');
    this.follow = host.querySelector('[data-follow]');
    this.snap = host.querySelector('[data-snap]');
    const on = (sel, fn) => host.querySelector(sel)?.addEventListener('click', fn);
    on('[data-flat]', () => this.flatten());
    on('[data-back]', () => this.close());
    on('[data-undo3d]', () => this.undo());
    on('[data-gridify]', () => { if (!this.picked.size) this.cut.mesh.pts.forEach((_, i) => this.picked.add(i)); this.paint(); this.apply((l) => gridify(l, GRID * 0.6)); });
    on('[data-all]', () => { const all = this.picked.size === this.cut.mesh.pts.length; this.picked.clear(); if (!all) this.cut.mesh.pts.forEach((_, i) => this.picked.add(i)); this.paint(); });
    on('[data-none]', () => { this.picked.clear(); this.paint(); });
    for (const b of host.querySelectorAll('[data-straight]')) b.addEventListener('click', () => this.apply((l) => straighten(l, +b.dataset.straight)));
    this.picked = new Set();
    this.hist = [];
    const box = document.createElement('canvas'); box.className = 'cut3d-gizmo'; host.append(box);
    this.gizmoCanvas = box;
    this.mark = document.createElement('div'); this.mark.className = 'cut3d-box'; this.mark.hidden = true; host.append(this.mark);
    this.navIcons(host.querySelector('.cut3d-nav'));
    this.renderer = null;
    this.orbit = { yaw: 0.6, pitch: 0.4, dist: 260 };
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.001)); }, { passive: false });
  }

  // Drag an icon to pan, revolve or zoom; the last one frames the leaf.
  navIcons(bar) {
    if (!bar) return;
    for (const b of bar.querySelectorAll('[data-n3]')) {
      let last = null;
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); last = [e.clientX, e.clientY]; e.stopPropagation(); });
      b.addEventListener('pointermove', (e) => {
        if (!last) return;
        const dx = e.clientX - last[0]; const dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
        if (b.dataset.n3 === 'pan') this.panBy(dx, dy); else if (b.dataset.n3 === 'orbit') this.orbitBy(dx * 1.6, dy * 1.6); else if (b.dataset.n3 === 'zoom') this.zoomBy(Math.exp(dy * 0.01));
      });
      b.addEventListener('pointerup', () => { last = null; });
      if (b.dataset.n3 === 'frame') b.addEventListener('click', () => { this.frame(); });
    }
  }

  zoomBy(f) { this.orbit.dist = Math.min(1200, Math.max(40, this.orbit.dist * f)); this.render(); }
  panBy(dx, dy) {
    const k = this.orbit.dist / Math.max(200, this.size?.[1] || 400);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0); const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.render();
  }
  frame() { const mid = this.cut.mesh.pts.reduce((a, p) => a + p.t, 0) / this.cut.mesh.pts.length; this.target.set(0, mid * S, 0); this.orbit.dist = 260; this.render(); }
  isOpen() { return !this.host.hidden; }

  open(cut, image) {
    this.cut = structuredClone(cut);
    this.hist = [JSON.stringify(this.cut)];
    this.image = image;
    this.host.hidden = false;
    this.picked.clear();
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 2, 3); this.scene.add(sun);
      // The grid lies in the leaf's own plane: across (X) and along (Y).
      const grid = new THREE.GridHelper(GRID * 60, 60, 0x6f8a5c, 0x34422c);
      grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.55;
      this.scene.add(grid);
      this.camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
      this.texture = new THREE.Texture();
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.gizmo = new ViewGizmo(this.gizmoCanvas, this);
      this.gizmo.resize(84);
    }
    this.texture.image = image; this.texture.flipY = true; this.texture.needsUpdate = true;
    this.build();
    this.resize();
  }

  // What the view gizmo needs from a view.
  orbitBy(dx, dy) { this.orbit.yaw -= dx * 0.005; this.orbit.pitch = Math.max(-1.55, Math.min(1.55, this.orbit.pitch + dy * 0.005)); this.render(); }
  setView(yaw, pitch) { this.orbit.yaw = yaw; this.orbit.pitch = Math.max(-1.5697, Math.min(1.5697, pitch)); this.render(); }

  close() { this.host.hidden = true; this.deps.onClose?.(); }

  // Where each point sits in 3D: its place on the leaf plus any offset (x across, t along, z off the leaf).
  spot(i) {
    const p = this.cut.mesh.pts[i]; const o = this.cut.deform?.[i] || [0, 0, 0];
    return new THREE.Vector3((p.x + o[0]) * S, (p.t + o[1]) * S, o[2] * S);
  }

  build() {
    for (const o of [this.mesh, this.dots, this.wire]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
    const { pts, tris } = this.cut.mesh;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(pts.length * 3); const uv = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => { this.spot(i).toArray(pos, i * 3); uv[i * 2] = p.u; uv[i * 2 + 1] = p.v; });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(tris);
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.texture, side: THREE.DoubleSide, alphaTest: 0.3, roughness: 0.8 }));
    this.wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffe45c, transparent: true, opacity: 0.45 }));
    // The dots share the points but color themselves: picked ones orange.
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', g.getAttribute('position'));
    dg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, depthTest: false, vertexColors: true }));
    this.scene.add(this.mesh, this.wire, this.dots);
    const mid = pts.reduce((a, p) => a + p.t, 0) / pts.length;
    this.target = new THREE.Vector3(0, mid * S, 0);
    this.paint();
  }

  paint() {
    const col = this.dots.geometry.getAttribute('color');
    for (let i = 0; i < col.count; i++) { if (this.picked.has(i)) col.setXYZ(i, 1, 0.55, 0.1); else col.setXYZ(i, 1, 1, 1); }
    col.needsUpdate = true;
    this.render();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.size = [r.width, r.height];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(r.height, 1);
    this.render();
  }

  render() {
    if (!this.renderer) return;
    const { yaw, pitch, dist } = this.orbit;
    const c = this.camera;
    c.position.set(this.target.x + dist * Math.sin(yaw) * Math.cos(pitch), this.target.y + dist * Math.sin(pitch), this.target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.renderer.render(this.scene, c);
    this.gizmo?.draw();
  }

  screenOf(v) { const p = v.clone().project(this.camera); return [(p.x * 0.5 + 0.5) * this.size[0], (-p.y * 0.5 + 0.5) * this.size[1]]; }

  down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const b = this.canvas.getBoundingClientRect(); const s = [e.clientX - b.left, e.clientY - b.top];
    if (e.button === 2) { this.drag = { pan: [e.clientX, e.clientY] }; return; }
    if (e.button === 1) { e.preventDefault(); this.drag = { orbit: [e.clientX, e.clientY] }; return; }
    // A finger (or a scaled-up interface) needs a bigger reach than a mouse; picked points reach further still,
    // so a press that lands a little off one moves the picked points instead of starting a box.
    const reach = (e.pointerType === 'mouse' ? 16 : 32) * (b.width / Math.max(1, this.canvas.clientWidth));
    let best = -1; let bd = reach;
    this.cut.mesh.pts.forEach((_, i) => { const q = this.screenOf(this.spot(i)); const d = Math.hypot(q[0] - s[0], q[1] - s[1]) * (this.picked.has(i) ? 0.6 : 1); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) {
      if (e.shiftKey) { if (this.picked.has(best)) this.picked.delete(best); else this.picked.add(best); } else if (!this.picked.has(best)) { this.picked.clear(); this.picked.add(best); }
      this.paint();
      // The points move in the plane facing the camera, through the one under the pointer.
      const n = new THREE.Vector3(); this.camera.getWorldDirection(n);
      const list = [...this.picked];
      this.drag = { point: best, list, start: list.map((i) => this.spot(i)), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.spot(best)), from: this.spot(best) };
    } else this.drag = { box: s, add: e.shiftKey };
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const b = this.canvas.getBoundingClientRect();
    if (d.box) {
      const s = [e.clientX - b.left, e.clientY - b.top]; d.to = s;
      // The box is drawn in the editor's own (scaled) pixels.
      const k = this.canvas.clientWidth / Math.max(1, b.width);
      Object.assign(this.mark.style, { left: `${this.canvas.offsetLeft + Math.min(s[0], d.box[0]) * k}px`, top: `${this.canvas.offsetTop + Math.min(s[1], d.box[1]) * k}px`, width: `${Math.abs(s[0] - d.box[0]) * k}px`, height: `${Math.abs(s[1] - d.box[1]) * k}px` });
      this.mark.hidden = false;
      return;
    }
    if (d.orbit || d.pan) {
      const last = d.orbit || d.pan; const dx = e.clientX - last[0]; const dy = e.clientY - last[1];
      if (d.orbit) { this.orbitBy(dx * 1.6, dy * 1.6); d.orbit = [e.clientX, e.clientY]; } else { this.panBy(dx, dy); d.pan = [e.clientX, e.clientY]; }
      return;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), this.camera);
    const hit = ray.ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!hit) return;
    const shift = hit.sub(d.from);
    let spots = d.start.map((v) => v.clone().add(shift).toArray());
    if (this.snap?.checked) spots = snapTo(spots, GRID);
    this.place(d.list, spots);
    d.moved = true;
  }
  // Puts points at scene positions, as offsets from where they sit on the flat leaf.
  place(list, spots) {
    const deform = (this.cut.deform ||= this.cut.mesh.pts.map(() => [0, 0, 0]));
    const attr = this.mesh.geometry.attributes.position;
    list.forEach((i, j) => {
      const p = this.cut.mesh.pts[i]; const v = spots[j];
      deform[i] = [v[0] / S - p.x, v[1] / S - p.t, v[2] / S];
      attr.setXYZ(i, v[0], v[1], v[2]);
    });
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.render();
  }

  // A tool on the picked points, then saved like a drag.
  apply(fn) {
    const list = [...this.picked];
    if (!list.length) { this.deps.toast?.('Pick some points first: click one, Shift-click more, or Shift-drag a box.'); return; }
    this.place(list, fn(list.map((i) => this.spot(i).toArray())));
    this.save(list);
  }

  up(e) {
    const d = this.drag; this.drag = null;
    this.mark.hidden = true;
    if (!d) return;
    if (d.box && !d.to) { if (!d.add) { this.picked.clear(); this.paint(); } return; }
    if (d.box && d.to) {
      if (!d.add) this.picked.clear();
      const [x0, x1] = [Math.min(d.box[0], d.to[0]), Math.max(d.box[0], d.to[0])]; const [y0, y1] = [Math.min(d.box[1], d.to[1]), Math.max(d.box[1], d.to[1])];
      this.cut.mesh.pts.forEach((_, i) => { const q = this.screenOf(this.spot(i)); if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) this.picked.add(i); });
      this.paint();
      return;
    }
    if (d.orbit || d.pan) return;
    if (d.moved) this.save(d.list);
  }

  save(list) {
    const c = this.cut;
    if (this.follow.checked) {
      // The move across the leaf goes into the picture too, so the texture slides with the point.
      const [bx, by] = c.basePx; const [tx, ty] = c.tipPx;
      const L = Math.hypot(tx - bx, ty - by) || 1; const dx = (tx - bx) / L; const dy = (ty - by) / L;
      const all = [c.outlinePx, c.innerPx || [], ...(c.holesPx || [])];
      for (const i of list) {
        const o = c.deform[i];
        const shift = [(dx * o[1] + -dy * o[0]) * c.span, (dy * o[1] + dx * o[0]) * c.span];
        let k = i;
        for (const pts of all) { if (k < pts.length) { pts[k] = [pts[k][0] + shift[0], pts[k][1] + shift[1]]; break; } k -= pts.length; }
        c.deform[i] = [0, 0, o[2]];
      }
    }
    this.cut = this.deps.save(c);
    this.hist.push(JSON.stringify(this.cut)); if (this.hist.length > 80) this.hist.shift();
    this.build();
    this.render();
  }

  undo() {
    if (this.hist.length < 2) { this.deps.toast?.('Nothing to undo here.'); return; }
    this.hist.pop();
    this.cut = this.deps.save(JSON.parse(this.hist.at(-1)));
    this.build();
    this.render();
  }

  flatten() { delete this.cut.deform; this.save([]); }
}
