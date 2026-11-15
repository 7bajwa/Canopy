// The entity editor: a move, turn and scale gizmo in the 3D view, like Blender's Transform tool. Its default tool shows
// all three at once (arrows move, rings turn, small boxes scale); Move, Rotate and Scale show one. By default it edits
// entities: click a branch, leaf or mesh copy (shift-click or drag a box for more) and the gizmo sits at their middle;
// dragging stores a per-entity move, turn and scale on its node (params.inst, by the entity's key), so only those
// change and their children follow. Each turns and scales about its own base. With "All" it writes the
// node's Position, Rotation and Scale values instead, so every entity of the node follows. Deleting an entity hides
// it (and what grows on it). The gizmo is driven by the editor's own pointer handling (the graph canvas lies over the
// 3D view).
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { doc, primary, regenerate, changed, commit, on } from './doc.js';

const ZUP = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
const R2D = 180 / Math.PI;
// The combined tool: arrows outside the rings, scale boxes inside them. First in this list wins a press: the scale
// boxes sit inside the arrows' pick zones, so they go first.
const KINDS = [['scale', 0.62], ['translate', 1.15], ['rotate', 0.95]];
// What the combined tool leaves out, so it reads like Blender's: plane handles, and the view ring and trackball.
const TRIM = { translate: ['XYZ', 'XY', 'YZ', 'XZ'], scale: ['XY', 'YZ', 'XZ'], rotate: ['XYZE', 'E'] };
const FIELDS = { translate: ['t'], rotate: ['q'], scale: ['s'], all: ['t', 'q', 's'] };
const NODE_FIELDS = { translate: ['posX', 'posY', 'posZ'], rotate: ['rotX', 'rotY', 'rotZ'], scale: ['sclX', 'sclY', 'sclZ'] };
const editable = (n) => n && (n.type === 'Spline' || n.type === 'Mesh');
const nodeOf = (id) => doc.graph.nodes.find((n) => n.id === id);

export class XfGizmo {
  constructor(view) {
    this.view = view;
    this.on = false;
    this.scope = 'copy';
    this.mode = 'all';
    this.picks = [];
    this.boxMode = 'touch';
    this.obj = new THREE.Object3D();
    view.scene.add(this.obj);
    // Loose elements: the controls hear only what pointer() passes them.
    this.tcs = KINDS.map(([kind, size]) => {
      const tc = new TransformControls(view.camera, document.createElement('div'));
      tc.setMode(kind); tc.setSize(size); tc.setSpace('local');
      tc.attach(this.obj);
      tc.addEventListener('change', () => view.invalidate());
      tc.addEventListener('objectChange', () => this.write(true));
      const helper = tc.getHelper(); helper.visible = false;
      const g = helper.children.find((c) => c.isTransformControlsGizmo);
      const parts = g ? [g.gizmo[kind], g.picker[kind]] : [];
      const extra = parts.flatMap((grp) => grp.children.filter((c) => TRIM[kind].includes(c.name)).map((c) => [grp, c]));
      return { kind, tc, helper, extra };
    });
    this.trim(true);
    // Renders hide it (see renderui.js).
    this.helper = new THREE.Group();
    this.helper.add(...this.tcs.map((t) => t.helper));
    view.scene.add(this.helper);
    on('result', () => { if (this.on && !this.dragging) this.place(); });
    on('selection', () => { if (this.on) this.place(); });
  }

  get dragging() { return this.tcs.some((t) => t.tc.dragging); }
  shown() { return this.tcs.filter((t) => this.mode === 'all' || t.kind === this.mode); }

  setOn(v) { this.on = v; this.place(); }
  setScope(v) { this.scope = v; this.place(); }
  setMode(m) { this.mode = m; this.trim(m === 'all'); this.place(); }
  trim(on) { for (const t of this.tcs) for (const [grp, c] of t.extra) { if (on) grp.remove(c); else if (!c.parent) grp.add(c); } }

  // A click in the 3D view: that entity, or with add, one more (or one less if it is already picked).
  picked(hit, add = false) {
    const e = hit && editable(nodeOf(hit.nodeId)) && hit.inst ? { nodeId: hit.nodeId, inst: hit.inst } : null;
    if (!add) this.picks = e ? [e] : [];
    else if (e) {
      const i = this.picks.findIndex((p) => p.nodeId === e.nodeId && p.inst === e.inst);
      if (i >= 0) this.picks.splice(i, 1); else this.picks.push(e);
    }
    this.place();
  }
  // Box selection, of the selected nodes (of every node when none is selected): with boxMode 'touch' every entity a
  // line of which crosses the screen rectangle (stage coordinates), with 'cover' only those lying wholly inside it.
  pickBox(b, add = false) {
    const L = doc.result?.lines; if (!L) return 0;
    const r = this.view.rect; const v = new THREE.Vector3();
    const cover = this.boxMode === 'cover';
    const seen = new Map(); // key -> { e, any, all }
    const at = (k) => { v.set(L.position[k * 3], L.position[k * 3 + 1], L.position[k * 3 + 2]).project(this.view.camera); return v.z < 1 ? [r.x + ((v.x + 1) / 2) * r.w, r.y + ((1 - v.y) / 2) * r.h] : null; };
    for (let k = 0; k < L.owner.length; k += 2) {
      const id = L.nodeIds[L.owner[k]]; const inst = L.inst?.[k];
      if (!inst || (doc.sel.size && !doc.sel.has(id)) || !editable(nodeOf(id))) continue;
      const key = `${id}:${inst}`;
      let s = seen.get(key);
      if (!s) seen.set(key, s = { e: { nodeId: id, inst }, any: false, all: true });
      if (cover ? !s.all : s.any) continue;
      const p = at(k); const q = at(k + 1);
      if (!p || !q) { s.all = false; continue; }
      if (!inBox(p, b) || !inBox(q, b)) s.all = false;
      if (segHitsBox(p, q, b)) s.any = true;
    }
    const found = [...seen.values()].filter((s) => (cover ? s.all : s.any)).map((s) => s.e);
    if (!add) this.picks = [];
    for (const e of found) if (!this.picks.some((p) => p.nodeId === e.nodeId && p.inst === e.inst)) this.picks.push(e);
    this.place();
    return found.length;
  }

  // Undoes the edit of the current tool (all of it with the Transform tool): on the picked entities, or on the node.
  reset() {
    if (this.scope === 'copy' && this.picks.length) {
      let any = false;
      for (const p of this.picks) {
        const n = nodeOf(p.nodeId); const o = n?.params.inst?.[p.inst];
        if (!o) continue;
        for (const f of FIELDS[this.mode]) if (o[f]) { delete o[f]; any = true; }
        if (!Object.keys(o).length) delete n.params.inst[p.inst];
        if (!Object.keys(n.params.inst).length) delete n.params.inst;
      }
      if (any) { changed({ layout: true }); commit(); }
      return any;
    }
    const n = this.node(); if (!n) return false;
    const keys = this.mode === 'all' ? Object.values(NODE_FIELDS).flat() : NODE_FIELDS[this.mode];
    for (const k of keys) n.params[k] = k.startsWith('scl') ? 1 : 0;
    if (this.mode === 'all') delete n.params.inst;
    changed({ layout: true }); commit();
    return true;
  }

  // Deletes the picked entities (and what grows on them); undo brings them back.
  removePicked() {
    if (!this.picks.length) return 0;
    for (const p of this.picks) {
      const n = nodeOf(p.nodeId); if (!n) continue;
      n.params.inst = { ...(n.params.inst || {}), [p.inst]: { ...(n.params.inst?.[p.inst] || {}), hide: true } };
    }
    const count = this.picks.length;
    this.picks = [];
    changed({ layout: true }); commit();
    return count;
  }

  node() { const n = primary(); return editable(n) ? n : null; }

  // The base of a line: its first point and the way it heads, for one entity (inst) or the node's first line.
  base(nodeId, inst) {
    const L = doc.result?.lines; if (!L) return null;
    for (let k = 0; k < L.owner.length; k += 2) {
      if (L.nodeIds[L.owner[k]] !== nodeId || (inst && L.inst?.[k] !== inst)) continue;
      const P = L.position;
      return { a: new THREE.Vector3(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]), b: new THREE.Vector3(P[k * 3 + 3], P[k * 3 + 4], P[k * 3 + 5]) };
    }
    return null;
  }

  // At the middle of the picked entities (or the node's first line), with the axes its Transform values use.
  place() {
    const n = this.on ? this.node() : null;
    const copies = this.on && this.scope === 'copy' ? this.picks.filter((p) => nodeOf(p.nodeId)) : [];
    const bases = copies.map((p) => this.base(p.nodeId, p.inst)).filter(Boolean);
    const one = !bases.length && n ? this.base(n.id, 0) : null;
    this.target = bases.length ? nodeOf(copies[0].nodeId) : one ? n : null;
    this.copies = bases.length ? copies : [];
    const show = new Set(this.target ? this.shown() : []);
    for (const t of this.tcs) { t.helper.visible = show.has(t); t.tc.enabled = show.has(t); }
    this.view.invalidate();
    if (!this.target) return;
    const first = bases[0] || one;
    let axes = ZUP;
    if (this.target.params.xfSpace !== 'world') {
      const z = first.b.clone().sub(first.a).normalize();
      let x = new THREE.Vector3(0, 1, 0).cross(z);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const y = z.clone().cross(x).normalize();
      axes = [x.toArray(), y.toArray(), z.toArray()];
    }
    this.axes = axes.map((v) => new THREE.Vector3(...v));
    const mid = new THREE.Vector3();
    for (const b of bases.length ? bases : [one]) mid.add(b.a);
    this.obj.position.copy(mid.divideScalar(bases.length || 1));
    this.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...this.axes));
    this.obj.scale.set(1, 1, 1);
    this.obj.updateMatrixWorld();
    this.start = {
      pos: this.obj.position.clone(), q: this.obj.quaternion.clone(),
      params: structuredClone(this.target.params),
      inst: this.copies.map((p) => structuredClone(nodeOf(p.nodeId).params.inst?.[p.inst] || {})),
    };
  }

  // The drag so far, from where it started: on each picked entity, or as the node's values.
  write(draft) {
    const n = this.target; if (!n) return;
    const d = this.obj.position.clone().sub(this.start.pos);
    const r = (v) => Math.round(v * 1e4) / 1e4;
    if (this.copies.length) {
      // The turn so far in world space, on top of each entity's earlier turn; scale on its own axes.
      const qd = this.obj.quaternion.clone().multiply(this.start.q.clone().invert());
      const sc = [this.obj.scale.x, this.obj.scale.y, this.obj.scale.z];
      this.copies.forEach((p, i) => {
        const node = nodeOf(p.nodeId); const o = this.start.inst[i];
        const t0 = o.t || [0, 0, 0]; const q = qd.clone().multiply(new THREE.Quaternion(...(o.q || [0, 0, 0, 1]))); const s0 = o.s || [1, 1, 1];
        node.params.inst = { ...(node.params.inst || {}), [p.inst]: { ...o, t: [t0[0] + d.x, t0[1] + d.y, t0[2] + d.z].map(r), q: [q.x, q.y, q.z, q.w].map(r), s: s0.map((v, j) => r(v * sc[j])) } };
      });
      regenerate({ draft });
      return;
    }
    const s = this.start.params; const P = n.params;
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
    const shown = this.shown();
    if (type === 'hover') {
      // Only the first handle under the pointer lights up.
      let lit = false;
      for (const t of shown) { if (lit) { t.tc.axis = null; continue; } t.tc.pointerHover(ndc); lit = !!t.tc.axis; }
      return false;
    }
    if (type === 'down') {
      for (const t of shown) {
        t.tc.pointerHover(ndc);
        if (!t.tc.axis) continue;
        t.tc.pointerDown(ndc);
        this.active = t.tc;
        return t.tc.dragging;
      }
      return false;
    }
    // Moves carry button -1, as a browser reports it while dragging; the controls ignore any other.
    if (type === 'move') { this.active?.pointerMove({ ...ndc, button: -1 }); return true; }
    if (type === 'up') {
      this.active?.pointerUp(ndc);
      this.active = null;
      this.write(false);
      changed({ layout: true }); commit();
      return true;
    }
    return false;
  }
}

const inBox = (p, b) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
// Whether a screen segment crosses a box: clipped against its four sides (Liang-Barsky).
export function segHitsBox(p, q, b) {
  let t0 = 0; let t1 = 1;
  const dx = q[0] - p[0]; const dy = q[1] - p[1];
  for (const [d, e] of [[-dx, p[0] - b.x0], [dx, b.x1 - p[0]], [-dy, p[1] - b.y0], [dy, b.y1 - p[1]]]) {
    if (d === 0) { if (e < 0) return false; continue; }
    const t = e / d;
    if (d < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
