// A soft, baked darkening for the gray view and the vertex-color bake: the more surface crowds around a point, the less light reaches it.
// Works on the plant's own vertices, so it costs nothing per frame and rides along with the wind.
const SIZE = 28;

export function bakeOcclusion(meshes, box) {
  const sx = Math.max(box[3] - box[0], 1); const sy = Math.max(box[4] - box[1], 1); const sz = Math.max(box[5] - box[2], 1);
  const cell = Math.max(sx, sy, sz) / SIZE;
  const nx = Math.ceil(sx / cell) + 2; const ny = Math.ceil(sy / cell) + 2; const nz = Math.ceil(sz / cell) + 2;
  const grid = new Float32Array(nx * ny * nz);
  const at = (x, y, z) => {
    const i = Math.floor((x - box[0]) / cell) + 1; const j = Math.floor((y - box[1]) / cell) + 1; const k = Math.floor((z - box[2]) / cell) + 1;
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : i + j * nx + k * nx * ny;
  };
  for (const { position: P } of meshes) {
    for (let v = 0; v < P.length; v += 3) { const c = at(P[v], P[v + 1], P[v + 2]); if (c >= 0) grid[c]++; }
  }
  let sum = 0; let used = 0;
  for (const g of grid) if (g) { sum += g; used++; }
  const typical = used ? sum / used : 1;
  const sample = (x, y, z) => { const c = at(x, y, z); return c < 0 ? 0 : grid[c] / typical; };
  return meshes.map(({ position: P, normal: N }) => {
    const out = new Float32Array(P.length / 3);
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v]; const y = P[v + 1]; const z = P[v + 2];
      // Look a little way along the surface normal, and upward where the sky is.
      let d = 0;
      for (const r of [1, 2]) {
        d += sample(x + N[v] * cell * r, y + N[v + 1] * cell * r, z + N[v + 2] * cell * r);
        d += sample(x, y + cell * r, z) * 0.6;
      }
      out[v / 3] = 0.14 + 0.86 / (1 + d * 0.55);
    }
    return out;
  });
}
