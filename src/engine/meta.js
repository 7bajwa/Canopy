// Meta mesh: smooth-unions capsules along lines in a distance field and extracts one welded surface.
import { clamp, hexToRgb } from './math.js';

const MAX_CELLS = 6000000;

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Distance to a cone-ish capsule whose radius varies along its axis.
function capsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const dx = bx - ax; const dy = by - ay; const dz = bz - az;
  const ex = px - ax; const ey = py - ay; const ez = pz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  const h = l2 > 0 ? clamp((ex * dx + ey * dy + ez * dz) / l2, 0, 1) : 0;
  const x = ex - dx * h; const y = ey - dy * h; const z = ez - dz * h;
  return Math.sqrt(x * x + y * y + z * z) - (ra + (rb - ra) * h);
}

export function buildMeta(ev, jobs) {
  const caps = [];
  const minus = [];
  let faceSize = Infinity;
  let weight = 1;
  let host = null;
  for (const job of jobs) {
    host ||= job;
    const P = job.node.params;
    faceSize = Math.min(faceSize, +P.faceSize || 4);
    weight = Math.max(weight, +P.weight || 1);
    const list = P.operation === 'minus' ? minus : caps;
    for (const line of job.lines) {
      if (!line.radii || line.node.params.visible === false) continue;
      for (let i = 0; i + 1 < line.n; i++) {
        list.push({
          a: [line.pts[i * 3], line.pts[i * 3 + 1], line.pts[i * 3 + 2]],
          b: [line.pts[i * 3 + 3], line.pts[i * 3 + 4], line.pts[i * 3 + 5]],
          ra: line.radii[i], rb: line.radii[i + 1], line, s: line.len[i],
        });
      }
    }
  }
  if (!caps.length) return [];
  if (ev.draft) faceSize *= 1.6;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let maxR = 0;
  for (const c of caps) {
    const r = Math.max(c.ra, c.rb);
    maxR = Math.max(maxR, r);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], c.a[k] - r, c.b[k] - r);
      max[k] = Math.max(max[k], c.a[k] + r, c.b[k] + r);
    }
  }
  const pad = faceSize * 3 + maxR * 0.5;
  for (let k = 0; k < 3; k++) { min[k] -= pad; max[k] += pad; }
  let cell = faceSize;
  const dims = () => [0, 1, 2].map((k) => Math.ceil((max[k] - min[k]) / cell) + 1);
  let [nx, ny, nz] = dims();
  // Big trees coarsen the grid rather than run out of memory; the status line reports it.
  while (nx * ny * nz > MAX_CELLS) { cell *= 1.25; [nx, ny, nz] = dims(); }
  if (cell > faceSize * 1.01) ev.warnings.add(`Meta mesh face size was raised to ${cell.toFixed(1)} cm to fit in memory.`);

  const field = new Float32Array(nx * ny * nz).fill(1e6);
  const owner = new Int32Array(nx * ny * nz).fill(-1);
  const ix = (x, y, z) => x + y * nx + z * nx * ny;

  const stamp = (c, idx, sign) => {
    const r = Math.max(c.ra, c.rb);
    const blend = r * weight * 0.9;
    const m = r + blend + cell * 2;
    const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(c.a[k], c.b[k]) - m - min[k]) / cell)));
    const hi = [0, 1, 2].map((k, i) => Math.min([nx, ny, nz][i] - 1, Math.ceil((Math.max(c.a[k], c.b[k]) + m - min[k]) / cell)));
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let x = lo[0]; x <= hi[0]; x++) {
          const px = min[0] + x * cell; const py = min[1] + y * cell; const pz = min[2] + z * cell;
          const d = capsule(px, py, pz, c.a[0], c.a[1], c.a[2], c.b[0], c.b[1], c.b[2], c.ra, c.rb);
          const i = ix(x, y, z);
          if (sign > 0) {
            if (d < field[i]) owner[i] = idx;
            field[i] = smin(field[i], d, blend);
          } else field[i] = Math.max(field[i], -d);
        }
      }
    }
  };
  caps.forEach((c, i) => stamp(c, i, 1));
  minus.forEach((c, i) => stamp(c, i, -1));

  // Surface nets: one vertex per surface-crossing cell, one quad per crossing edge.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos = []; const nor = []; const uvs = []; const idx = [];
  const OFF = [0, 1, nx, nx + 1, nx * ny, nx * ny + 1, nx * ny + nx, nx * ny + nx + 1];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const uvScale = 60;
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const i0 = ix(x, y, z);
        let mask = 0;
        for (let k = 0; k < 8; k++) if (field[i0 + OFF[k]] < 0) mask |= 1 << k;
        if (mask === 0 || mask === 255) continue;
        let sx = 0; let sy = 0; let sz = 0; let n = 0;
        for (const [a, b] of EDGES) {
          if (!!(mask & (1 << a)) === !!(mask & (1 << b))) continue;
          const fa = field[i0 + OFF[a]]; const fb = field[i0 + OFF[b]];
          const t = fa / (fa - fb);
          const ax = a & 1; const ay = (a >> 1) & 1; const az = (a >> 2) & 1;
          const bx = b & 1; const by = (b >> 1) & 1; const bz = (b >> 2) & 1;
          sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t;
          n++;
        }
        const vx = min[0] + (x + sx / n) * cell; const vy = min[1] + (y + sy / n) * cell; const vz = min[2] + (z + sz / n) * cell;
        cellVert[i0] = pos.length / 3;
        pos.push(vx, vy, vz);
        // Gradient of the field gives a smooth normal without needing face data.
        const gx = field[ix(Math.min(x + 1, nx - 1), y, z)] - field[ix(Math.max(x - 1, 0), y, z)];
        const gy = field[ix(x, Math.min(y + 1, ny - 1), z)] - field[ix(x, Math.max(y - 1, 0), z)];
        const gz = field[ix(x, y, Math.min(z + 1, nz - 1))] - field[ix(x, y, Math.max(z - 1, 0))];
        const m = Math.hypot(gx, gy, gz) || 1;
        nor.push(gx / m, gy / m, gz / m);
        const own = caps[owner[i0]] || caps[0];
        const ax = own.b[0] - own.a[0]; const ay = own.b[1] - own.a[1]; const az = own.b[2] - own.a[2];
        const al = Math.hypot(ax, ay, az) || 1;
        const along = own.s + ((vx - own.a[0]) * ax + (vy - own.a[1]) * ay + (vz - own.a[2]) * az) / al;
        const angle = Math.atan2(gz / m, gx / m);
        uvs.push((angle / (Math.PI * 2)) * 2, along / uvScale);
      }
    }
  }
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = ix(x, y, z);
        const f = field[i] < 0;
        if (f !== field[i + 1] < 0) quad(cellVert[i], cellVert[i - nx], cellVert[i - nx - nx * ny], cellVert[i - nx * ny], !f);
        if (f !== field[i + nx] < 0) quad(cellVert[i], cellVert[i - nx * ny], cellVert[i - 1 - nx * ny], cellVert[i - 1], !f);
        if (f !== field[i + nx * ny] < 0) quad(cellVert[i], cellVert[i - 1], cellVert[i - 1 - nx], cellVert[i - nx], !f);
      }
    }
  }
  if (!idx.length) return [];

  const nv = pos.length / 3;
  const m = host.comps.material;
  const tint = hexToRgb('#ffffff');
  const color = new Float32Array(nv * 3).fill(tint[0]);
  const out = {
    nodeId: host.node.id, kind: 'bark',
    position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uvs), color,
    index: new Uint32Array(idx),
    material: { color: m?.params.color || '#ffffff', roughness: m?.params.roughness ?? 0.9, texture: m ? m.params.texture : 'bark:brown' },
  };
  out.wind = new Float32Array(nv * 3);
  return [out];
}
