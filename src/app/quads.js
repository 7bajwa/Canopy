// Faces for export. Tubes and leaf blades are built as quads, each as two triangles in a row sharing an edge;
// here those pairs join back into quads, so OBJ and FBX files come out mostly quads. quadTri marks which
// triangles may join (cutouts and imported shapes stay triangles). A quad with two corners in the same place
// (the tip of a round cap) becomes the triangle it really is.
// Returns corners (flat), sizes (3 or 4 per face) and tri (the first triangle of each face, for its material).
export function facesOf(index, quadTri, position) {
  const corners = []; const sizes = []; const tri = [];
  const same = (a, b) => position[a * 3] === position[b * 3] && position[a * 3 + 1] === position[b * 3 + 1] && position[a * 3 + 2] === position[b * 3 + 2];
  const emit = (list, t) => {
    const out = list.filter((v, i) => !list.some((w, j) => j < i && same(v, w)));
    if (out.length < 3) return;
    corners.push(...out); sizes.push(out.length); tri.push(t);
  };
  const n = index.length / 3;
  for (let t = 0; t < n; t++) {
    const A = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    if (quadTri?.[t] && t + 1 < n && quadTri[t + 1]) {
      const B = [index[t * 3 + 3], index[t * 3 + 4], index[t * 3 + 5]];
      const lone = B.filter((v) => !A.includes(v));
      if (lone.length === 1) {
        // The shared edge as A runs it (x then y): B's other corner goes between them, keeping the winding.
        const k = [0, 1, 2].find((i) => B.includes(A[i]) && B.includes(A[(i + 1) % 3]));
        emit([A[k], lone[0], A[(k + 1) % 3], A[(k + 2) % 3]], t);
        t++;
        continue;
      }
    }
    emit(A, t);
  }
  return { corners, sizes, tri };
}
