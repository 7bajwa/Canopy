// Impostor baking: the plant photographed from many directions into one atlas, for far-away LODs in a game engine
// (octahedral impostors, as used by Unreal's ImpostorBaker and Amplify Impostors). Each cell of an N × N grid is one
// view direction from the octahedral (full sphere) or hemi-octahedral (upper half) mapping; a JSON beside the atlas
// says which. Views are near-orthographic: a far camera with a narrow lens.
import * as THREE from 'three';
import { el, numberField, checkField, selectField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { zipStore } from './zip.js';
import { download, safeName } from './io.js';
import { doc } from './doc.js';

// The view direction (toward the camera) for grid cell (i, j) of n, octahedral or hemi-octahedral.
export function octDirection(i, j, n, hemi) {
  const u = ((i + 0.5) / n) * 2 - 1; const v = ((j + 0.5) / n) * 2 - 1;
  let x; let y; let z;
  if (hemi) { x = (u + v) / 2; z = (u - v) / 2; y = 1 - Math.abs(x) - Math.abs(z); } else {
    x = u; z = v; y = 1 - Math.abs(u) - Math.abs(v);
    if (y < 0) { const ox = x; x = (1 - Math.abs(z)) * Math.sign(ox || 1); z = (1 - Math.abs(ox)) * Math.sign(z || 1); }
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export function makeImpostor({ view, toast }) {
  const o = { frames: 8, size: 256, hemi: true };
  let panel = null;

  async function bake() {
    if (!view.meshes.length || !view.box) { toast('There is no plant to bake yet.'); return; }
    const b = view.box; const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const R = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
    const N = o.frames; const S = o.size;
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = N * S;
    const g = atlas.getContext('2d');
    const keep = { yaw: view.orbit.yaw, pitch: view.orbit.pitch, fov: view.camera.fov };
    const dist = R * 40;
    try {
      view.camera.fov = (2 * Math.atan(R / dist) * 180) / Math.PI;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const d = octDirection(i, j, N, o.hemi);
          view.orbit.target.copy(c); view.orbit.dist = dist;
          view.orbit.yaw = Math.atan2(d[0], d[2]);
          view.orbit.pitch = Math.max(-1.55, Math.min(1.55, Math.asin(d[1])));
          const url = view.renderImage(S, { view: true, ground: false, grid: false, bg: null });
          const img = await createImageBitmap(await (await fetch(url)).blob());
          g.drawImage(img, i * S, j * S); img.close();
        }
      }
    } finally {
      view.camera.fov = keep.fov; view.orbit.yaw = keep.yaw; view.orbit.pitch = keep.pitch; view.frameAll(true); view.invalidate();
    }
    const name = safeName(doc.name);
    const png = Uint8Array.from(atob(atlas.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0));
    const info = { atlas: `${name}_impostor.png`, frames: N, frameSize: S, mapping: o.hemi ? 'hemi-octahedral' : 'octahedral', center: c.toArray(), radius: R, units: 'cm', upAxis: 'Y', cell: 'row j from the top, column i from the left; direction from octDirection(i, j, frames) in Canopy src/app/impostor.js' };
    download(`${name}_impostor.zip`, new Blob([zipStore([{ name: info.atlas, data: png }, { name: `${name}_impostor.json`, data: JSON.stringify(info, null, 2) }])], { type: 'application/zip' }));
    toast(`Baked ${N} × ${N} views into a ${N * S} px impostor atlas.`, 5000);
  }

  function draw() {
    const go = el('button', 'wide primary', 'Bake impostor');
    go.addEventListener('click', () => { go.disabled = true; bake().finally(() => { go.disabled = false; }); });
    panel.body.replaceChildren(
      selectField('Views', String(o.frames), [4, 6, 8, 12, 16].map((n) => [String(n), `${n} × ${n}`]), (v) => { o.frames = +v; }),
      selectField('Each view', String(o.size), [128, 256, 512].map((n) => [String(n), `${n} px`]), (v) => { o.size = +v; }),
      checkField('Upper half only (hemi-octahedral)', o.hemi, (v) => { o.hemi = v; }),
      el('p', 'hint', 'Photographs the plant from every direction into one atlas for the farthest LOD. Hemi suits plants seen from above the ground; full octahedral also covers views from below. A JSON beside it gives the layout, center and radius.'),
      go,
    );
  }

  return { open() { panel ||= floatPanel('impostor', 'Impostor bake', { width: 320 }); draw(); panel.show(); } };
}
