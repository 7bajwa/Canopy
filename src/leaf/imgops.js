// Image maps made from a color picture, and the clean-ups shared by baking and packing. Pure functions on
// { width, height, data } images, so they run the same in tests and on the page. Gray images hold 0..1 floats;
// color images are RGBA bytes like ImageData.

export const grayImage = (width, height, fill = 0) => ({ width, height, data: new Float32Array(width * height).fill(fill) });

const hexRgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Where a gray map comes from.
export function sourceGray(img, source = 'luminance', o = {}) {
  const { width, height, data } = img;
  const g = grayImage(width, height);
  const key = hexRgb(o.key || '#ffffff');
  const tol = (o.tolerance ?? 0.15) * 441.7; const soft = Math.max((o.softness ?? 0.1) * 441.7, 1e-3);
  for (let i = 0, p = 0; i < g.data.length; i++, p += 4) {
    const r = data[p]; const gg = data[p + 1]; const b = data[p + 2];
    let v;
    if (source === 'alpha') v = data[p + 3] / 255;
    else if (source === 'colorkey') {
      // Far from the picked color is kept (1), at it is cut (0), with a soft ramp between.
      const d = Math.hypot(r - key[0], gg - key[1], b - key[2]);
      v = Math.min(1, Math.max(0, (d - tol) / soft));
    } else if (source === 'saturation') { const mx = Math.max(r, gg, b); v = mx ? (mx - Math.min(r, gg, b)) / mx : 0; } else v = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    g.data[i] = v;
  }
  return g;
}

// Brightness, contrast, levels (black and white points, gamma) and invert, in that order.
export function levels(g, o = {}) {
  const { brightness = 0, contrast = 0, black = 0, white = 1, gamma = 1, invert = false } = o;
  const span = Math.max(white - black, 1e-4);
  const cf = contrast >= 0 ? 1 / Math.max(1 - contrast, 0.02) : 1 + contrast;
  const out = grayImage(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) {
    let v = (g.data[i] - 0.5) * cf + 0.5 + brightness;
    v = Math.min(1, Math.max(0, (v - black) / span));
    v = v ** (1 / Math.max(gamma, 0.01));
    out.data[i] = invert ? 1 - v : v;
  }
  return out;
}

// Box blur three times over, which is close to a Gaussian.
export function blur(g, radius) {
  const r = Math.round(radius);
  if (r < 1) return g;
  const { width: w, height: h } = g;
  let a = Float32Array.from(g.data); let b = new Float32Array(a.length);
  const pass = (src, dst, horizontal) => {
    const n = horizontal ? w : h; const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      const at = (i) => (horizontal ? l * w + i : i * w + l);
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[at(Math.min(n - 1, Math.max(0, i)))];
      for (let i = 0; i < n; i++) {
        dst[at(i)] = sum / (2 * r + 1);
        sum += src[at(Math.min(n - 1, i + r + 1))] - src[at(Math.max(0, i - r))];
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
  return { width: w, height: h, data: a };
}

// Unsharp mask: adds back the difference from a blurred copy.
export function sharpen(g, amount, radius = 1) {
  if (!amount) return g;
  const soft = blur(g, radius);
  const out = grayImage(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) out.data[i] = Math.min(1, Math.max(0, g.data[i] + (g.data[i] - soft.data[i]) * amount));
  return out;
}

const at = (g, x, y) => g.data[Math.min(g.height - 1, Math.max(0, y)) * g.width + Math.min(g.width - 1, Math.max(0, x))];

// Curvature from a height map: ridges light, creases dark, flat 0.5.
export function curvature(h, strength = 4) {
  const out = grayImage(h.width, h.height);
  for (let y = 0; y < h.height; y++) {
    for (let x = 0; x < h.width; x++) {
      const lap = at(h, x - 1, y) + at(h, x + 1, y) + at(h, x, y - 1) + at(h, x, y + 1) - 4 * at(h, x, y);
      out.data[y * h.width + x] = Math.min(1, Math.max(0, 0.5 - lap * strength));
    }
  }
  return out;
}

// Ambient occlusion from a height map: places lower than their surroundings get darker.
export function occlusion(h, radius = 8, strength = 1) {
  const around = blur(h, radius);
  const out = grayImage(h.width, h.height);
  for (let i = 0; i < h.data.length; i++) out.data[i] = Math.min(1, Math.max(0, 1 - Math.max(0, around.data[i] - h.data[i]) * strength * 4));
  return out;
}

// A tangent-space normal map (RGBA bytes, +Y up as in OpenGL) from a height map.
export function normalsFromHeight(h, strength = 2) {
  const { width: w, height: hh } = h;
  const out = { width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) };
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel; images count down, so the Y slope flips for +Y up.
      const dx = (at(h, x + 1, y - 1) + 2 * at(h, x + 1, y) + at(h, x + 1, y + 1)) - (at(h, x - 1, y - 1) + 2 * at(h, x - 1, y) + at(h, x - 1, y + 1));
      const dy = (at(h, x - 1, y + 1) + 2 * at(h, x, y + 1) + at(h, x + 1, y + 1)) - (at(h, x - 1, y - 1) + 2 * at(h, x, y - 1) + at(h, x + 1, y - 1));
      let nx = -dx * strength; let ny = dy * strength; let nz = 1;
      const m = Math.hypot(nx, ny, nz); nx /= m; ny /= m; nz /= m;
      const p = (y * w + x) * 4;
      out.data[p] = (nx * 0.5 + 0.5) * 255; out.data[p + 1] = (ny * 0.5 + 0.5) * 255; out.data[p + 2] = (nz * 0.5 + 0.5) * 255; out.data[p + 3] = 255;
    }
  }
  return out;
}

export function grayToRGBA(g) {
  const out = { width: g.width, height: g.height, data: new Uint8ClampedArray(g.data.length * 4) };
  for (let i = 0; i < g.data.length; i++) { const v = g.data[i] * 255; out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
  return out;
}

// Half size, for previews and for dilation's coarser levels.
export function shrink(img, f) {
  const w = Math.max(1, Math.round(img.width * f)); const h = Math.max(1, Math.round(img.height * f));
  const out = { width: w, height: h, data: new img.data.constructor(w * h * (img.data.length / (img.width * img.height))) };
  const ch = img.data.length / (img.width * img.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / f)); const sy = Math.min(img.height - 1, Math.floor(y / f));
      for (let c = 0; c < ch; c++) out.data[(y * w + x) * ch + c] = img.data[(sy * img.width + sx) * ch + c];
    }
  }
  return out;
}

// One map from a color picture, by a recipe: where it comes from, its levels and filters, then what it becomes.
export function makeMap(img, r = {}) {
  let g = sourceGray(img, r.source, r);
  g = levels(g, r);
  if (r.blur) g = blur(g, r.blur);
  if (r.sharpen) g = sharpen(g, r.sharpen, 1);
  if (r.output === 'normal') return normalsFromHeight(g, r.strength ?? 2);
  if (r.output === 'ao') g = occlusion(g, r.radius ?? 8, r.strength ?? 1);
  if (r.output === 'curvature') g = curvature(g, r.strength ?? 4);
  return grayToRGBA(g);
}

// Soft infinite dilation: every empty pixel (alpha under the threshold) takes the color of the nearest filled ones,
// averaged over coarser and coarser copies (push-pull), so edges bleed out smoothly to the whole texture.
export function dilate(img, threshold = 8) {
  const { width: w, height: h, data } = img;
  // Pull: halve until one pixel, averaging only filled pixels.
  const levelsUp = [{ w, h, c: Float32Array.from({ length: w * h * 3 }, (_, i) => data[Math.floor(i / 3) * 4 + (i % 3)]), a: Float32Array.from({ length: w * h }, (_, i) => (data[i * 4 + 3] >= threshold ? 1 : 0)) }];
  for (;;) {
    const L = levelsUp[levelsUp.length - 1];
    if (L.w === 1 && L.h === 1) break;
    const nw = Math.max(1, Math.ceil(L.w / 2)); const nh = Math.max(1, Math.ceil(L.h / 2));
    const c = new Float32Array(nw * nh * 3); const a = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let s = 0; const acc = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(L.w - 1, x * 2 + dx); const sy = Math.min(L.h - 1, y * 2 + dy);
            const k = sy * L.w + sx; const wgt = L.a[k];
            s += wgt; acc[0] += L.c[k * 3] * wgt; acc[1] += L.c[k * 3 + 1] * wgt; acc[2] += L.c[k * 3 + 2] * wgt;
          }
        }
        const k = y * nw + x;
        if (s > 0) { c[k * 3] = acc[0] / s; c[k * 3 + 1] = acc[1] / s; c[k * 3 + 2] = acc[2] / s; }
        a[k] = Math.min(1, s);
      }
    }
    levelsUp.push({ w: nw, h: nh, c, a });
  }
  // Push: fill each level's gaps from the coarser one, smoothly.
  for (let l = levelsUp.length - 2; l >= 0; l--) {
    const L = levelsUp[l]; const C = levelsUp[l + 1];
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const k = y * L.w + x;
        if (L.a[k] >= 1) continue;
        // Bilinear from the coarser level.
        const fx = Math.min(C.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)); const fy = Math.min(C.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx); const y0 = Math.floor(fy); const x1 = Math.min(C.w - 1, x0 + 1); const y1 = Math.min(C.h - 1, y0 + 1);
        const tx = fx - x0; const ty = fy - y0;
        for (let ch = 0; ch < 3; ch++) {
          const v = (C.c[(y0 * C.w + x0) * 3 + ch] * (1 - tx) + C.c[(y0 * C.w + x1) * 3 + ch] * tx) * (1 - ty)
            + (C.c[(y1 * C.w + x0) * 3 + ch] * (1 - tx) + C.c[(y1 * C.w + x1) * 3 + ch] * tx) * ty;
          L.c[k * 3 + ch] = L.c[k * 3 + ch] * L.a[k] + v * (1 - L.a[k]);
        }
        L.a[k] = 1;
      }
    }
  }
  const out = { width: w, height: h, data: new Uint8ClampedArray(data) };
  const top = levelsUp[0];
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] >= threshold) continue;
    out.data[i * 4] = top.c[i * 3]; out.data[i * 4 + 1] = top.c[i * 3 + 1]; out.data[i * 4 + 2] = top.c[i * 3 + 2];
  }
  return out;
}

// Brightness, contrast, saturation and an unsharp-mask sharpen for a color picture (alpha untouched).
export function colorAdjust(img, { brightness = 0, contrast = 0, saturation = 1, sharpen: amount = 0 } = {}) {
  if (!brightness && !contrast && saturation === 1 && !amount) return img;
  const { width: w, height: h, data } = img;
  const out = { width: w, height: h, data: new Uint8ClampedArray(data) };
  const ch = [0, 1, 2].map((c) => ({ width: w, height: h, data: Float32Array.from({ length: w * h }, (_, i) => data[i * 4 + c] / 255) }));
  const sharp = amount ? ch.map((g) => sharpen(g, amount, 1)) : ch;
  const cf = contrast >= 0 ? 1 / Math.max(1 - contrast, 0.02) : 1 + contrast;
  for (let i = 0; i < w * h; i++) {
    let r = sharp[0].data[i]; let g = sharp[1].data[i]; let b = sharp[2].data[i];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * saturation; g = l + (g - l) * saturation; b = l + (b - l) * saturation;
    out.data[i * 4] = ((r - 0.5) * cf + 0.5 + brightness) * 255;
    out.data[i * 4 + 1] = ((g - 0.5) * cf + 0.5 + brightness) * 255;
    out.data[i * 4 + 2] = ((b - 0.5) * cf + 0.5 + brightness) * 255;
  }
  return out;
}

// Turns tangent-space normals by an angle in the image plane, for a piece of texture rotated by that angle.
export function rotateNormal(r, g, angle) {
  const x = r / 127.5 - 1; const y = g / 127.5 - 1;
  const c = Math.cos(angle); const s = Math.sin(angle);
  return [((x * c - y * s) + 1) * 127.5, ((x * s + y * c) + 1) * 127.5];
}

// Normal map extras for baking: a bevel along cut-out edges, an overall dome, and fine noise. All tilt the normals
// of an RGBA normal map in place, guided by its alpha (or a separate coverage mask).
export function enhanceNormals(img, mask, o = {}) {
  const { bevel = 0, bevelWidth = 4, round = 0, noise = 0, noiseScale = 8 } = o;
  if (!bevel && !round && !noise) return img;
  const { width: w, height: h } = img;
  const cover = mask || { width: w, height: h, data: Float32Array.from({ length: w * h }, (_, i) => img.data[i * 4 + 3] / 255) };
  const near = bevel ? blur(cover, bevelWidth) : null;
  const far = round ? blur(cover, Math.max(4, Math.round(Math.min(w, h) / 24))) : null;
  const grad = (g, x, y) => [at(g, x + 1, y) - at(g, x - 1, y), at(g, x, y - 1) - at(g, x, y + 1)];
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y); const tx = x - xi; const ty = y - yi;
    const a = hash(xi, yi); const b = hash(xi + 1, yi); const c = hash(xi, yi + 1); const d = hash(xi + 1, yi + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const out = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let nx = out.data[p] / 127.5 - 1; let ny = out.data[p + 1] / 127.5 - 1; let nz = out.data[p + 2] / 127.5 - 1;
      // Coverage falls off outward, so its slope points in; the surface leans the other way, out over the edge.
      if (near) { const [gx, gy] = grad(near, x, y); nx -= gx * bevel * bevelWidth; ny -= gy * bevel * bevelWidth; }
      if (far) { const [gx, gy] = grad(far, x, y); nx -= gx * round * Math.min(w, h) / 6; ny -= gy * round * Math.min(w, h) / 6; }
      if (noise) {
        const f = 1 / Math.max(noiseScale, 1);
        nx += (vnoise(x * f, y * f) - vnoise((x + 1) * f, y * f)) * noise * noiseScale;
        ny += (vnoise(x * f, (y + 1) * f) - vnoise(x * f, y * f)) * noise * noiseScale;
      }
      const m = Math.hypot(nx, ny, nz) || 1;
      out.data[p] = (nx / m * 0.5 + 0.5) * 255; out.data[p + 1] = (ny / m * 0.5 + 0.5) * 255; out.data[p + 2] = (nz / m * 0.5 + 0.5) * 255;
    }
  }
  return out;
}

// Puts channels of several maps into one picture: `spec` names a source for R, G, B and A, each
// 'map.channel' (like 'color.r', 'opacity.r', 'normal.g') or 'white' / 'black'.
export function packChannels(maps, spec, width, height) {
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const pick = (s) => {
    if (s === 'white' || !s) return () => 255;
    if (s === 'black') return () => 0;
    const [name, ch] = s.split('.');
    const m = maps[name]; const k = 'rgba'.indexOf(ch);
    return m ? (i) => m.data[i * 4 + k] : () => (s.endsWith('.a') ? 255 : 0);
  };
  const f = spec.map(pick);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 4; c++) out.data[i * 4 + c] = f[c](i);
  return out;
}
