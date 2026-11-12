// Built-in bark and leaf atlas images are painted on the fly, so the app ships no image files.
import * as THREE from 'three';

const BARK = {
  'bark:brown': { label: 'Bark: brown', a: [58, 41, 28], b: [128, 98, 70] },
  'bark:dark': { label: 'Bark: dark', a: [34, 28, 24], b: [88, 74, 60] },
  'bark:grey': { label: 'Bark: grey', a: [78, 76, 70], b: [158, 154, 144] },
  'bark:light': { label: 'Bark: birch', a: [120, 112, 100], b: [226, 220, 208] },
};

const ATLAS = {
  'atlas:broadleaf': { label: 'Leaf atlas: green', a: '#2f5f1c', b: '#6ea336', vein: '#a9c96b' },
  'atlas:autumn': { label: 'Leaf atlas: autumn', a: '#a3461a', b: '#e0a22c', vein: '#f3d27c' },
};

// The painted ones are no longer offered (a new plant starts with no textures; the Library's plants carry their own),
// but a file that still uses one keeps it, listed as its current value.
export const textureChoices = (keep) => Object.entries(BARK).filter(([id]) => id === keep).map(([id, v]) => [id, v.label]);
export const atlasChoices = (keep) => Object.entries(ATLAS).filter(([id]) => id === keep).map(([id, v]) => [id, v.label]);

// Tileable value noise: lattice wraps at the period so the texture has no seam.
function tileNoise(period, seed) {
  const n = period[0] * period[1];
  const table = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) { s = Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917 >>> 0; table[i] = (s >>> 8) / 16777216; }
  return (x, y) => {
    const fx = x * period[0]; const fy = y * period[1];
    const ix = Math.floor(fx); const iy = Math.floor(fy);
    const tx = fx - ix; const ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx); const uy = ty * ty * (3 - 2 * ty);
    const at = (a, b) => table[((a % period[0]) + period[0]) % period[0] + (((b % period[1]) + period[1]) % period[1]) * period[0]];
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ux;
    const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ux;
    return top + (bot - top) * uy;
  };
}

function paintBark(spec, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  // Stretched noise makes the long furrows; the warp breaks them up so they don't look ruled.
  const warp = tileNoise([6, 4], 11);
  const ridge = tileNoise([26, 3], 23);
  const fine = tileNoise([72, 14], 37);
  const blot = tileNoise([8, 8], 41);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const w = warp(u, v) * 0.12;
      let h = 1 - Math.abs(ridge(u + w, v) * 2 - 1);
      h = h ** 1.8 * 0.75 + fine(u + w, v) * 0.25;
      const t = Math.min(1, Math.max(0, h * 0.85 + (blot(u, v) - 0.5) * 0.3 + 0.08));
      const i = (y * size + x) * 4;
      img.data[i] = spec.a[0] + (spec.b[0] - spec.a[0]) * t;
      img.data[i + 1] = spec.a[1] + (spec.b[1] - spec.a[1]) * t;
      img.data[i + 2] = spec.a[2] + (spec.b[2] - spec.a[2]) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Half width of each leaf type along its length (0 = stem, 1 = tip).
const LEAF_SHAPES = [
  (t) => Math.sin(Math.PI * t ** 0.75) * 0.34 * (1 + 0.035 * Math.sin(t * 62)),
  (t) => Math.sin(Math.PI * t ** 0.85) * (0.3 + 0.13 * Math.abs(Math.sin(t * 15.7))),
  (t) => Math.sin(Math.PI * t) ** 0.8 * 0.15,
  (t) => Math.sin(Math.PI * t ** 0.6) * 0.42 * (0.7 + 0.3 * Math.abs(Math.cos(t * 9.4))),
];

function paintLeaf(ctx, cx, cy, len, shape, spec, tilt) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  const steps = 90;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= steps; i++) { const t = i / steps; ctx.lineTo(shape(t) * len, -t * len); }
  for (let i = steps - 1; i >= 0; i--) { const t = i / steps; ctx.lineTo(-shape(t) * len, -t * len); }
  ctx.closePath();
  const g = ctx.createLinearGradient(-len * 0.3, 0, len * 0.3, -len);
  g.addColorStop(0, spec.a);
  g.addColorStop(1, spec.b);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = spec.vein;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(1, len * 0.006);
  for (let i = 1; i < 11; i++) {
    const t = i / 12;
    const w = shape(t + 0.08) * len;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -t * len);
      ctx.quadraticCurveTo(side * w * 0.6, -(t + 0.05) * len, side * w * 1.05, -(t + 0.12) * len);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Midrib plus a short stalk, so the atlas leaf points at its own base.
  ctx.strokeStyle = spec.vein;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1.5, len * 0.012);
  ctx.beginPath();
  ctx.moveTo(0, len * 0.045);
  ctx.lineTo(0, -len * 0.97);
  ctx.stroke();
  ctx.restore();
}

function paintAtlas(spec, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cell = size / 2;
  LEAF_SHAPES.forEach((shape, i) => {
    const cx = (i % 2) * cell + cell / 2;
    const cy = Math.floor(i / 2) * cell + cell * 0.93;
    paintLeaf(ctx, cx, cy, cell * 0.84, shape, spec, 0);
  });
  return c;
}

const canvases = new Map();

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = url;
  });
}

// The drawable source of a texture name; user images come from the document's assets.
export function textureSource(name, assets) {
  if (canvases.has(name)) return canvases.get(name);
  let out = null;
  if (BARK[name]) out = paintBark(BARK[name]);
  else if (ATLAS[name]) out = paintAtlas(ATLAS[name]);
  else if (assets?.[name]) out = loadImage(assets[name].url);
  if (out) canvases.set(name, out);
  return out;
}

// Pixels of an atlas as { width, height, data }, which is what the cutout fitter reads.
export async function atlasPixels(name, assets) {
  const src = await textureSource(name, assets);
  if (!src) return null;
  const w = src.naturalWidth || src.width;
  const h = src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

export async function hasAlpha(name, assets) {
  const img = await atlasPixels(name, assets);
  if (!img) return false;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return true;
  return false;
}

// A small picture of a texture for a color slot; null until it has loaded.
const thumbs = new Map();
export function textureThumb(name, assets, onReady) {
  if (thumbs.has(name)) return thumbs.get(name);
  thumbs.set(name, null);
  const src = textureSource(name, assets);
  if (src) {
    Promise.resolve(src).then((image) => {
      const c = document.createElement('canvas');
      c.width = c.height = 44;
      c.getContext('2d').drawImage(image, 0, 0, 44, 44);
      thumbs.set(name, c);
      onReady?.();
    }).catch(() => {});
  }
  return null;
}

const maps = new Map();
const solids = new Map();

// One color as a map, for a slot that has a color but no texture.
export function solidMap(hex) {
  let t = solids.get(hex);
  if (!t) {
    const v = parseInt(hex.slice(1), 16);
    t = new THREE.DataTexture(new Uint8Array([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]), 1, 1);
    t.needsUpdate = true;
    solids.set(hex, t);
  }
  return t;
}

// Data maps (normal, roughness, opacity and so on) aren't colors, and can read one channel of their image.
export function threeMap(name, channel, assets, onLoad, maxAniso = 4) {
  const key = `${name}|${channel}`;
  if (maps.has(key)) return maps.get(key);
  if (!textureSource(name, assets)) return null;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.flipY = true;
  atlasPixels(name, assets).then((img) => {
    if (channel) {
      const off = 'RGBA'.indexOf(channel);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = img.data[i + off];
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
    }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    tex.image = c;
    tex.needsUpdate = true;
    onLoad?.();
  }).catch((e) => console.error(e));
  maps.set(key, tex);
  return tex;
}

const textures = new Map();

// Premultiplied so transparent atlas pixels don't bleed a dark fringe into mipmapped leaf edges.
export function threeTexture(name, assets, onLoad, maxAniso = 4) {
  if (textures.has(name)) return textures.get(name);
  const src = textureSource(name, assets);
  if (!src) return null;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.premultiplyAlpha = !name.startsWith('bark:');
  tex.flipY = true;
  const apply = (image) => { tex.image = image; tex.needsUpdate = true; onLoad?.(); };
  if (src instanceof Promise) src.then(apply).catch((e) => console.error(e));
  else apply(src);
  textures.set(name, tex);
  return tex;
}
