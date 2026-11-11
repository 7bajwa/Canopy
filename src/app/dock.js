// Docking the floating bars on the walls of the window or the stage.
// Where a box dropped at (x, y) docks: the nearest wall it may use, and how far along it.
export function dockAt(x, y, w, h, side, divide) {
  const walls = { left: x, right: w - x, top: y, bottom: h - y };
  delete walls[side === 'left' ? 'right' : 'left'];
  const wall = Object.entries(walls).sort((a, b) => a[1] - b[1])[0][0];
  if (wall === 'left' || wall === 'right') return { wall, at: Math.max(0.1, Math.min(0.9, y / h)) };
  const lo = side === 'left' ? 0 : divide * w; const hi = side === 'left' ? divide * w : w;
  return { wall, at: Math.max(0.05, Math.min(0.95, (x - lo) / Math.max(1, hi - lo))) };
}

