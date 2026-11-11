// The view gizmo in the corner of the 3D view: the three axes as the camera sees them. Clicking a ball looks
// straight down that axis, so a bake (or a picture) can be taken exactly from the front, side or top.
// Labelled as Blender names them: X to the right, Y away from the front view, Z up. v is the direction in the
// 3D view's own space (Y up), and clicking a ball looks from that side.
const ball = (l, v, c) => ({ l, v, c, yaw: Math.abs(v[1]) > 0.5 ? 0 : Math.atan2(v[0], v[2]), pitch: v[1] * 1.5697 });
const AXES = [
  ball('X', [1, 0, 0], '#ff5c5c'), ball('Y', [0, 0, -1], '#7ed957'), ball('Z', [0, 1, 0], '#5c9dff'),
  ball('-X', [-1, 0, 0], '#ff5c5c'), ball('-Y', [0, 0, 1], '#7ed957'), ball('-Z', [0, -1, 0], '#5c9dff'),
];

export class ViewGizmo {
  constructor(canvas, view) {
    this.canvas = canvas;
    this.view = view;
    this.resize(96, false);
    this.spots = [];
    // Dragging revolves the view; a click without a drag snaps to the ball under it.
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, start: [e.clientX, e.clientY], moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) > 4) drag.moved = true;
      if (drag.moved) view.orbitBy((e.clientX - drag.x) * 1.5, (e.clientY - drag.y) * 1.5);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = (e) => {
      if (!drag) return;
      const was = drag; drag = null;
      if (was.moved) return;
      const b = canvas.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * this.size; const y = ((e.clientY - b.top) / b.height) * this.size;
      const hit = this.spots.filter((s) => Math.hypot(s.x - x, s.y - y) < 11).sort((a, b2) => b2.z - a.z)[0];
      if (hit) view.setView(hit.a.yaw, hit.a.pitch);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    view.onCamera = () => this.draw();
    this.draw();
  }

  resize(size, redraw = true) {
    this.size = size;
    const r = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.height = size * r;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    if (redraw) this.draw();
  }

  draw() {
    const c = this.ctx; const S = this.size; const R = S * 0.36;
    const m = this.view.camera.matrixWorldInverse.elements;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(17, 22, 15, .55)';
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, 7); c.fill();
    // Axes into camera space: x right, y up, z toward the viewer.
    this.spots = AXES.map((a) => {
      const [x, y, z] = a.v;
      const vx = m[0] * x + m[4] * y + m[8] * z; const vy = m[1] * x + m[5] * y + m[9] * z; const vz = m[2] * x + m[6] * y + m[10] * z;
      return { a, x: S / 2 + vx * R, y: S / 2 - vy * R, z: vz };
    }).sort((p, q) => p.z - q.z);
    for (const s of this.spots) {
      const neg = s.a.l.startsWith('-');
      if (!neg) { c.strokeStyle = s.a.c; c.lineWidth = 2; c.beginPath(); c.moveTo(S / 2, S / 2); c.lineTo(s.x, s.y); c.stroke(); }
      c.beginPath(); c.arc(s.x, s.y, neg ? 6 : 8.5, 0, 7);
      if (neg) { c.fillStyle = 'rgba(17, 22, 15, .8)'; c.fill(); c.strokeStyle = s.a.c; c.lineWidth = 1.5; c.stroke(); } else { c.fillStyle = s.a.c; c.fill(); c.fillStyle = '#0b0f0a'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.a.l, s.x, s.y + 0.5); }
    }
  }
}
