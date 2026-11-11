// The scale indicator: a flat figure and a ruler standing beside the plant. Figures are drawn here, so the app ships no image files.
import * as THREE from 'three';
import { rulerMarks, showLength } from './units.js';

const INK = '#b7c2ad';

// Silhouettes of a baby, a boy and a man, chosen by the plant's size. Heights in cm; aspect is width / height.
const FIGURES = {
  baby: { height: 40, aspect: 272 / 512, under: 60 },
  boy: { height: 100, aspect: 162 / 512, under: 170 },
  man: { height: 180, aspect: 167 / 512, under: Infinity },
};

export function figureFor(plantHeight) {
  return Object.entries(FIGURES).find(([, f]) => plantHeight < f.under)[0];
}

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = INK;
  paint(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const flatMaterial = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });

export class ScaleIndicator {
  constructor(scene, onChange = () => {}) {
    this.onChange = onChange;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.figure = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatMaterial(null));
    this.ruler = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flatMaterial(null));
    this.group.add(this.figure, this.ruler);
    this.textures = new Map();
    this.key = '';
  }

  figureTexture(name) {
    let t = this.textures.get(name);
    if (!t) {
      t = new THREE.TextureLoader().load(`./figures/${name}.png`, () => this.onChange());
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.set(name, t);
    }
    return t;
  }

  // Redraws only when something a person could read has changed.
  update(box, show, units) {
    if (!box || show === 'off') { this.group.visible = false; return; }
    this.group.visible = true;
    const plantH = Math.max(box[4] - Math.min(0, box[1]), 1);
    const name = figureFor(plantH);
    const f = FIGURES[name];
    const showFig = show !== 'ruler'; const showRuler = show !== 'figure';
    this.figure.visible = showFig; this.ruler.visible = showRuler;
    const key = `${name}|${Math.round(plantH)}|${units}`;
    this.size = { fw: f.height * f.aspect, fh: f.height, H: Math.max(plantH, showFig ? f.height : 0) };
    this.box = box;
    if (key === this.key) return;
    this.key = key;
    this.figure.material.map = this.figureTexture(name);
    this.figure.material.needsUpdate = true;
    this.figure.scale.set(this.size.fw, this.size.fh, 1);
    const H = this.size.H;
    this.ruler.material.map?.dispose();
    this.ruler.material.map = canvasTexture(256, 1280, (c, cw, ch) => {
      const k = ch / (H * 1.04);
      const yOf = (cm) => ch - cm * k - 2;
      c.strokeStyle = INK; c.lineWidth = 3;
      c.beginPath(); c.moveTo(14, ch); c.lineTo(14, yOf(H)); c.stroke();
      c.font = '500 38px Poppins, system-ui, sans-serif';
      c.textBaseline = 'middle';
      for (const cm of rulerMarks(H)) {
        const y = yOf(cm);
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(14, y); c.lineTo(40, y); c.stroke();
      }
      // Only the top carries a number: the plant's height.
      c.beginPath(); c.moveTo(14, yOf(H)); c.lineTo(60, yOf(H)); c.stroke();
      c.fillText(showLength(H), 66, Math.max(26, yOf(H)));
    });
    this.ruler.material.needsUpdate = true;
    this.ruler.scale.set((H * 1.04) / 5, H * 1.04, 1);
  }

  // Stands to the camera's right of the plant, facing the camera, on the ground.
  place(camera) {
    if (!this.group.visible || !this.box) return;
    const b = this.box;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0; right.normalize();
    const reach = Math.hypot(b[3] - b[0], b[5] - b[2]) / 2;
    const cx = (b[0] + b[3]) / 2; const cz = (b[2] + b[5]) / 2;
    const y0 = Math.min(0, b[1]);
    const { fw, fh, H } = this.size;
    const gap = Math.max(H * 0.04, 4);
    const yaw = Math.atan2(camera.position.x - cx, camera.position.z - cz);
    const figAt = reach + gap + fw / 2;
    if (this.figure.visible) {
      this.figure.position.set(cx + right.x * figAt, y0 + fh / 2, cz + right.z * figAt);
      this.figure.rotation.y = yaw;
    }
    const rw = this.ruler.scale.x;
    const rulerAt = (this.figure.visible ? figAt + fw / 2 : reach) + gap + rw / 2;
    this.ruler.position.set(cx + right.x * rulerAt, y0 + (H * 1.04) / 2, cz + right.z * rulerAt);
    this.ruler.rotation.y = yaw;
  }
}
