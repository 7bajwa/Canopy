// A plain zip archive (stored, no compression), enough to hand a model and its pictures over as one file.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: Uint8Array | ArrayBuffer | string }]
export function zipStore(files) {
  const enc = new TextEncoder();
  const local = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data;
    const crc = crc32(data);
    const head = new Uint8Array(30 + name.length); const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    head.set(name, 30);
    const cen = new Uint8Array(46 + name.length); const c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true); cen.set(name, 46);
    local.push(head, data); central.push(cen);
    offset += head.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22); let at = 0;
  for (const p of [...local, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

// Reads a zip: stored files, and deflated ones (as most zip tools write them) through the browser's own
// DecompressionStream. Returns [{ name, data: Uint8Array }]. The file comes from outside, so sizes are checked.
export async function unzip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('That is not a zip file.');
  const count = v.getUint16(end + 10, true); let at = v.getUint32(end + 16, true);
  const dec = new TextDecoder(); const out = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || v.getUint32(at, true) !== 0x02014b50) throw new Error('That zip file is damaged.');
    const method = v.getUint16(at + 10, true); const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true); const extra = v.getUint16(at + 30, true); const note = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + note;
    if (name.endsWith('/')) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + size > b.length) throw new Error('That zip file is damaged.');
    const raw = b.subarray(start, start + size);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error(`${name} uses a zip compression Canopy can't read.`);
    out.push({ name, data });
  }
  return out;
}
