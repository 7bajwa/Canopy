import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { zipStore, unzip, crc32 } from '../src/app/zip.js';

test('unzip reads back stored zips and deflated entries', async () => {
  const files = await unzip(zipStore([{ name: 'a.canopy', data: '{"x":1}' }, { name: 'textures/b.png', data: new Uint8Array([1, 2, 3]) }]));
  assert.deepEqual(files.map((f) => f.name), ['a.canopy', 'textures/b.png']);
  assert.equal(new TextDecoder().decode(files[0].data), '{"x":1}');
  assert.deepEqual([...files[1].data], [1, 2, 3]);
  // Patch one entry to deflate (method 8), as other zip tools write it.
  const text = new TextEncoder().encode('hello hello hello hello');
  const z = deflateRawSync(text);
  const name = new TextEncoder().encode('d.txt');
  const head = new Uint8Array(30 + name.length); const h = new DataView(head.buffer);
  h.setUint32(0, 0x04034b50, true); h.setUint16(8, 8, true); h.setUint32(14, crc32(text), true); h.setUint32(18, z.length, true); h.setUint32(22, text.length, true); h.setUint16(26, name.length, true); head.set(name, 30);
  const cen = new Uint8Array(46 + name.length); const c = new DataView(cen.buffer);
  c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, crc32(text), true); c.setUint32(20, z.length, true); c.setUint32(24, text.length, true); c.setUint16(28, name.length, true); cen.set(name, 46);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, cen.length, true); e.setUint32(16, head.length + z.length, true);
  const all = new Uint8Array([...head, ...z, ...cen, ...end]);
  const [d] = await unzip(all);
  assert.equal(new TextDecoder().decode(d.data), 'hello hello hello hello');
});
