// The Transform tool: a move, turn or scale gizmo on the picked Spline or Mesh node, at the base of its first
// entity and on the axes its Transform uses (the entity's own, or the world's on the view gizmo's axes). Dragging
// it writes the node's Position, Rotation and Scale values, so every entity of the node follows.
// The gizmo is driven by the editor's own pointer handling (the graph canvas lies over the 3D view).
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { doc, primary, regenerate, changed, commit, on } from './doc.js';

const ZUP = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
const R2D = 180 / Math.PI;

export class XfGizmo {
  constructor(view) {
    this.view = view;
    this.on = false;
    this.obj = new THREE.Object3D();
    view.scene.add(this.obj);
    // A loose element: the controls hear only what pointer() passes them.
    this.tc = new TransformControls(view.camera, document.createElement('div'));
    this.tc.setSpace('local');
    this.tc.attach(this.obj);
    this.helper = this.tc.getHelper();
    this.helper.visible = false;
    view.scene.add(this.helper);
    this.tc.addEventListener('change', () => view.invalidate());
    this.tc.addEventListener('objectChange', () => this.write(true));
    on('result', () => { if (this.on && !this.tc.dragging) this.place(); });
    on('selection', () => { if (this.on) this.place(); });
  }

  setOn(v) { this.on = v; this.place(); }
  setMode(m) { this.tc.setMode(m); this.view.invalidate(); }

  node() { const n = primary(); return n && (n.type === 'Spline' || n.type === 'Mesh') ? n : null; }

  // At the base of the node's first line, with the axes its Transform values use.
  place() {
    const n = this.on ? this.node() : null;
    const lines = doc.result?.lines;
    let i = -1;
    if (n && lines) for (let k = 0; k < lines.owner.length; k += 2) if (lines.nodeIds[lines.owner[k]] === n.id) { i = k; break; }
    this.helper.visible = i >= 0;
    this.tc.enabled = i >= 0;
    this.view.invalidate();
    if (i < 0) { this.target = null; return; }
    const P = lines.position;
    const a = new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); const b = new THREE.Vector3(P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5]);
    let axes = ZUP;
    if (n.params.xfSpace !== 'world') {
      const z = b.clone().sub(a).normalize();
      let x = new THREE.Vector3(0, 1, 0).cross(z);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const y = z.clone().cross(x).normalize();
      axes = [x.toArray(), y.toArray(), z.toArray()];
    }
    this.axes = axes.map((v) => new THREE.Vector3(...v));
    const m = new THREE.Matrix4().makeBasis(...this.axes);
    this.obj.position.copy(a);
    this.obj.quaternion.setFromRotationMatrix(m);
    this.obj.scale.set(1, 1, 1);
    this.obj.updateMatrixWorld();
    this.target = n;
    this.start = { pos: a.clone(), q: this.obj.quaternion.clone(), params: structuredClone(n.params) };
  }

  // The drag so far, from where it started, as the node's values.
  write(draft) {
    const n = this.target; if (!n) return;
    const s = this.start.params; const P = n.params;
    const d = this.obj.position.clone().sub(this.start.pos);
    ['posX', 'posY', 'posZ'].forEach((k, i) => { P[k] = (+s[k] || 0) + d.dot(this.axes[i]); });
    // The turn in the gizmo's own axes; X, then Y, then Z, as the Rotation values are read.
    const local = this.start.q.clone().invert().multiply(this.obj.quaternion);
    const e = new THREE.Euler().setFromQuaternion(local, 'ZYX');
    ['rotX', 'rotY', 'rotZ'].forEach((k, i) => { P[k] = (+s[k] || 0) + [e.x, e.y, e.z][i] * R2D; });
    ['sclX', 'sclY', 'sclZ'].forEach((k, i) => { P[k] = (s[k] ?? 1) * [this.obj.scale.x, this.obj.scale.y, this.obj.scale.z][i]; });
    regenerate({ draft });
  }

  // Pointer events from the stage, in its coordinates. True while the gizmo has the pointer.
  pointer(type, p, button = 0) {
    if (!this.on || !this.target) return false;
    const r = this.view.rect;
    const ndc = { x: ((p.x - r.x) / r.w) * 2 - 1, y: -((p.y - r.y) / r.h) * 2 + 1, button };
    if (type === 'hover') { this.tc.pointerHover(ndc); return false; }
    if (type === 'down') {
      this.tc.pointerHover(ndc);
      if (!this.tc.axis) return false;
      this.tc.pointerDown(ndc);
      return this.tc.dragging;
    }
    // Moves carry button -1, as a browser reports it while dragging; the controls ignore any other.
    if (type === 'move') { this.tc.pointerMove({ ...ndc, button: -1 }); return true; }
    if (type === 'up') {
      this.tc.pointerUp(ndc);
      this.write(false);
      changed({ layout: true }); commit();
      return true;
    }
    return false;
  }
}
