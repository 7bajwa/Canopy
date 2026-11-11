// The Bake panel: the 3D view fills the screen with a frame over it, and the panel on the right holds the
// bake cameras (each a view plus a frame, kept in the plant file), and the maps and export settings. The view
// gizmo picks straight views, and the navigation icons frame the plant.
import { doc, commit } from './doc.js';
import { el } from './fields.js';
import { bakeMaps } from './bake.js';
import { EXPORT_DEFAULTS, exportFields, saveMaps, fold, sizeOf, withDefaults } from './texout.js';

export class BakePanel {
  constructor(root, frameEl, deps) {
    this.root = root;
    this.frameEl = frameEl;
    this.deps = deps;
    this.body = root.querySelector('.bake-body');
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && e.target.tagName !== 'INPUT') this.close(); });
    this.wireFrame();
    this.body.addEventListener('change', () => this.placeFrame());
  }

  isOpen() { return !this.root.hidden; }

  get state() {
    const b = (doc.graph.bake ||= { cameras: [], active: 0 });
    // Defaults fill in place: a fresh copy each time would lose what the open size boxes write.
    b.settings = withDefaults(b.settings, EXPORT_DEFAULTS);
    return b;
  }

  get cam() { const s = this.state; return s.cameras[s.active] || s.cameras[0]; }

  viewOf() { const o = this.deps.view.orbit; return { yaw: o.yaw, pitch: o.pitch, dist: o.dist, target: [o.target.x, o.target.y, o.target.z] }; }

  addCamera() {
    const s = this.state;
    s.cameras.push({ id: `cam${Date.now().toString(36)}`, name: `Camera ${s.cameras.length + 1}`, ...this.viewOf(), frame: { x: 0.5, y: 0.5, s: 0.8 }, locked: false });
    s.active = s.cameras.length - 1;
    commit();
  }

  goTo(cam) {
    const o = this.deps.view.orbit;
    this.going = true;
    o.yaw = cam.yaw; o.pitch = cam.pitch; o.dist = cam.dist; o.target.set(...cam.target);
    this.deps.view.anim = null;
    this.deps.view.locked = !!cam.locked;
    this.deps.view.moved();
    this.going = false;
    this.placeFrame();
  }

  open() {
    this.root.hidden = false;
    this.deps.enter(true);
    if (!this.state.cameras.length) { this.deps.view.setView(0, 0); this.deps.view.frameAll(true); this.addCamera(); }
    this.goTo(this.cam);
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.frameEl.hidden = true;
    this.deps.view.locked = false;
    this.deps.enter(false);
    commit();
  }

  // The live view is the picked camera's, unless the camera is locked.
  viewMoved() {
    if (!this.isOpen() || this.going || !this.cam || this.cam.locked) return;
    Object.assign(this.cam, this.viewOf());
    this.placeFrame();
  }

  render() {
    const s = this.state;
    const b = this.body;
    // Bake first, where it's always in reach.
    const top = el('div', 'bake-actions');
    const one = el('button', 'wide primary', 'Bake this camera');
    one.addEventListener('click', () => this.bake([this.cam]));
    top.append(one);
    if (s.cameras.length > 1) {
      const all = el('button', 'wide', 'Bake every camera');
      all.addEventListener('click', () => this.bake(s.cameras));
      top.append(all);
    }
    const rows = s.cameras.map((c, i) => {
      const row = el('div', `bake-cam${i === s.active ? ' on' : ''}`);
      const pick = el('button', 'mini', i === s.active ? '●' : '○');
      pick.title = 'Use this camera'; pick.setAttribute('aria-label', `Use ${c.name}`);
      pick.addEventListener('click', () => { s.active = i; this.goTo(c); this.render(); });
      const name = el('input', 'atlas-name');
      name.value = c.name; name.setAttribute('aria-label', 'Camera name');
      name.addEventListener('change', () => { c.name = name.value.trim() || `Camera ${i + 1}`; commit(); });
      // One lock holds both the camera and its frame.
      const lock = el('button', `mini lock${c.locked ? ' on' : ''}`, c.locked ? '🔒' : '🔓');
      lock.title = c.locked ? 'Locked: the view and frame stay put. Press to unlock.' : 'Lock this camera and its frame';
      lock.setAttribute('aria-pressed', !!c.locked);
      lock.addEventListener('click', () => { c.locked = !c.locked; if (i === s.active) this.deps.view.locked = c.locked; this.placeFrame(); this.render(); commit(); });
      const del = el('button', 'mini', '×');
      del.title = 'Delete this camera'; del.setAttribute('aria-label', `Delete ${c.name}`);
      del.addEventListener('click', () => { s.cameras.splice(i, 1); s.active = 0; if (!s.cameras.length) this.addCamera(); this.goTo(this.cam); this.render(); commit(); });
      row.append(pick, name, lock, del);
      return row;
    });
    const add = el('button', 'wide', '+ Camera from this view');
    add.addEventListener('click', () => { this.addCamera(); this.render(); this.placeFrame(); });
    b.replaceChildren(top, fold('Cameras', [...rows, add, el('p', 'hint', 'Use the view gizmo for straight views and the navigation icons to frame the plant.')]),
      ...exportFields(s.settings, { meshAo: true }));
    this.deps.view.locked = !!this.cam?.locked;
    this.placeFrame();
  }

  async bake(cams) {
    const s = this.state;
    for (const cam of cams) {
      this.goTo(cam);
      await new Promise((r) => requestAnimationFrame(r));
      const o = { ...s.settings, name: cams.length > 1 ? `${s.settings.name}_${cam.name.replace(/[^\w-]+/g, '')}` : s.settings.name };
      this.deps.toast(`Baking ${cam.name}…`, 1500);
      try {
        const maps = await bakeMaps(this.deps.view, cam.frame, o);
        await saveMaps(maps, o, this.deps.toast);
      } catch (e) {
        console.error(e);
        this.deps.toast(`Could not bake ${cam.name}: ${e.message}`, 6000);
      }
    }
    this.goTo(this.cam);
  }

  // ---- The frame over the view: as wide as the picture's width over its height ----
  placeFrame() {
    const f = this.frameEl;
    const c = this.cam;
    if (!this.isOpen() || !c) { f.hidden = true; return; }
    const r = this.deps.view.rect;
    const [W, H] = sizeOf(this.state.settings);
    const tall = c.frame.s * r.h; const wide = tall * (W / H);
    f.hidden = false;
    Object.assign(f.style, { left: `${r.x + c.frame.x * r.w - wide / 2}px`, top: `${r.y + c.frame.y * r.h - tall / 2}px`, width: `${wide}px`, height: `${tall}px` });
    f.classList.toggle('locked', !!c.locked);
  }

  // Drag the frame's edge or middle handle to move it, its corner to resize it; inside it the view still orbits.
  wireFrame() {
    const f = this.frameEl;
    let drag = null;
    f.addEventListener('pointerdown', (e) => {
      const c = this.cam;
      if (!c || c.locked) return;
      e.stopPropagation(); e.preventDefault();
      f.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, frame: { ...c.frame }, resize: !!e.target.closest('.bake-corner') };
    });
    f.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = this.deps.view.rect;
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      const fr = this.cam.frame;
      if (drag.resize) fr.s = Math.max(0.05, Math.min(1.5, drag.frame.s + (Math.max(dx, dy) * 2) / r.h));
      else { fr.x = drag.frame.x + dx / r.w; fr.y = drag.frame.y + dy / r.h; }
      this.placeFrame();
    });
    const end = () => { if (drag) commit(); drag = null; };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
  }
}
