// A sprout point in the leaf's own measure, which is what the engine reads: along and across the axis, as shares of its length.
// `level` (1-9) lets a child grow from only some of a leaf's sprouts.
export function sproutFromPixels(c, px, dir, level = 1) {
  const [bx, by] = c.basePx; const [tx, ty] = c.tipPx;
  const L = Math.hypot(tx - bx, ty - by) || 1;
  const ax = (tx - bx) / L; const ay = (ty - by) / L;
  const span = c.span || L;
  const ox = px[0] - bx; const oy = px[1] - by;
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  return {
    px, dir, level,
    t: (ox * ax + oy * ay) / span, s: (ox * -ay + oy * ax) / span,
    da: (dir[0] * ax + dir[1] * ay) / dl, db: (dir[0] * -ay + dir[1] * ax) / dl,
  };
}
