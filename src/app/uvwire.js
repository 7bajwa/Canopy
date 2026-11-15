// The UV editor's wireframe: a node's built UV triangles, and the map that previews a box edit on them before the rebuild.

// UV triangles (u0 v0 u1 v1 u2 v2 each) of the meshes `keep` picks; past `max` triangles every n-th one is taken.
export function uvTris(meshes, keep, max = 20000) {
  const ms = (meshes || []).filter(keep);
  const total = ms.reduce((s, m) => s + m.index.length / 3, 0);
  const step = Math.max(1, Math.ceil(total / max));
  const out = new Float32Array(Math.ceil(total / step) * 6 + 6);
  let n = 0; let t = 0;
  for (const { index, uv } of ms) {
    for (let i = 0; i < index.length; i += 3, t++) {
      if (t % step) continue;
      for (let k = 0; k < 3; k++) { out[n++] = uv[index[i + k] * 2]; out[n++] = uv[index[i + k] * 2 + 1]; }
    }
  }
  return out.subarray(0, n);
}

// The affine map taking box [o, a, b] (origin, U corner, V corner) onto box [o2, a2, b2]; null when they match.
export function boxMap([o, a, b], [o2, a2, b2]) {
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  if (same(o, o2) && same(a, a2) && same(b, b2)) return null;
  const eA = [a[0] - o[0], a[1] - o[1]]; const eB = [b[0] - o[0], b[1] - o[1]];
  const fA = [a2[0] - o2[0], a2[1] - o2[1]]; const fB = [b2[0] - o2[0], b2[1] - o2[1]];
  const det = eA[0] * eB[1] - eA[1] * eB[0];
  if (Math.abs(det) < 1e-12) return null;
  return (u, v) => {
    const d0 = u - o[0]; const d1 = v - o[1];
    const s = (d0 * eB[1] - d1 * eB[0]) / det; const t = (eA[0] * d1 - eA[1] * d0) / det;
    return [o2[0] + fA[0] * s + fB[0] * t, o2[1] + fA[1] * s + fB[1] * t];
  };
}
