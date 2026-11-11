// The Transform tool: a move, turn or scale gizmo in the 3D view. By default it edits one copy: click a branch, leaf
// or mesh copy and the gizmo sits at that copy's base, on its own axes; dragging stores a per-copy move, turn and
// scale on the node (params.inst, by the copy's key), so only that copy changes and its children follow it.
// With "All copies" it writes the node's Position, Rotation and Scale values instead, so every copy follows.
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
    this.scope = 'copy';
    this.pick = null;
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
  setScope(v) { this.scope = v; this.place(); }
  // The last click in the 3D view: which node and which of its copies.
  picked(hit) { this.pick = hit ? { nodeId: hit.nodeId, inst: hit.inst || 0 } : null; }
  // Drops the picked copy's own edit.
  resetCopy() {
    const n = this.target; const k = this.copyKey;
    if (!n || !k || !n.params.inst?.[k]) return false;
    delete n.params.inst[k];
    if (!Object.keys(n.params.inst).length) delete n.params.inst;
    changed({ layout: true }); commit();
    return true;
  }
  setMode(m) { this.tc.setMode(m); this.view.invalidate(); }

  node() { const n = primary(); return n && (n.type === 'Spline' || n.type === 'Mesh') ? n : null; }

  // At the base of the node's first line, with the axes its Transform values use.
  place() {
    const n = this.on ? this.node() : null;
    const lines = doc.result?.lines;
    let i = -1;
    const key = n && this.scope === 'copy' && this.pick?.nodeId === n.id ? this.pick.inst : 0;
    if (n && lines) for (let k = 0; k < lines.owner.length; k += 2) if (lines.nodeIds[lines.owner[k]] === n.id && (!key || lines.inst?.[k] === key)) { i = k; break; }
    this.copyKey = i >= 0 && key ? key : 0;
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
    this.view.invalidate();
  }

  // The drag so far, from where it started, as the node's values.
  write(draft) {
    const n = this.target; if (!n) return;
    const s = this.start.params; const P = n.params;
    const d = this.obj.position.clone().sub(this.start.pos);
    if (this.copyKey) {
      const k = this.copyKey; const o = s.inst?.[k] || {};
      const t0 = o.t || [0, 0, 0]; const q0 = new THREE.Quaternion(...(o.q || [0, 0, 0, 1])); const s0 = o.s || [1, 1, 1];
      // The turn so far in world space, on top of the copy's earlier turn.
      const qd = this.obj.quaternion.clone().multiply(this.start.q.clone().invert());
      const q = qd.multiply(q0);
      const sc = [this.obj.scale.x, this.obj.scale.y, this.obj.scale.z];
      const r = (v) => Math.round(v * 1e4) / 1e4;
      P.inst = { ...(P.inst || {}), [k]: { t: [t0[0] + d.x, t0[1] + d.y, t0[2] + d.z].map(r), q: [q.x, q.y, q.z, q.w].map(r), s: s0.map((v, i) => r(v * sc[i])) } };
      regenerate({ draft });
      return;
    }
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
