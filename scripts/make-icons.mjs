// Generates simple PNG icons (amber rounded square with a white "K") without any image library.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Draw a `size`×`size` icon and return PNG bytes. */
export function iconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // "K" strokes in normalized coords
  const stroke = size * 0.16;
  const inK = (x, y) => {
    const nx = x / size, ny = y / size;
    const s = stroke / size;
    if (nx > 0.28 && nx < 0.28 + s && ny > 0.2 && ny < 0.8) return true; // vertical bar
    // upper diagonal from (0.28+s, 0.5) to (0.72, 0.2)
    const d1 = Math.abs((ny - 0.5) + (nx - 0.3) * (0.3 / 0.42)) < s * 0.7 && nx >= 0.3 && nx <= 0.74 && ny <= 0.52;
    const d2 = Math.abs((ny - 0.5) - (nx - 0.3) * (0.3 / 0.42)) < s * 0.7 && nx >= 0.3 && nx <= 0.74 && ny >= 0.48;
    return d1 || d2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) continue;
      if (inK(x + 0.5, y + 0.5)) px.set([26, 19, 0, 255], i);
      else px.set([245, 165, 36, 255], i);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function createIcons(dir) {
  mkdirSync(dir, { recursive: true });
  for (const s of [16, 32, 48, 128, 256, 512]) writeFileSync(resolve(dir, `icon${s}.png`), iconPng(s));
}
if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
  createIcons(process.argv[2] ?? resolve(import.meta.dirname, '../build'));
  console.log('icons written');
}
