// Reads only 8-bit, non-interlaced RGB and RGBA PNGs: what Chromium's screenshots are.
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function pngChunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG: bad signature');
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    if (crc32(png.subarray(offset + 4, offset + 8 + length)) !== crc) {
      throw new Error(`PNG chunk ${type} has a bad CRC`);
    }
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

export function pngHeader(png) {
  const first = pngChunks(png)[0];
  if (first?.type !== 'IHDR') throw new Error('PNG does not start with IHDR');
  const { data } = first;
  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colorType: data[9],
    interlace: data[12],
  };
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

export function addTextChunk(png, keyword, text) {
  const text_ = chunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1'));
  const at = pngChunks(png).findIndex(({ type }) => type === 'IDAT');
  let offset = 8;
  for (let i = 0; i < at; i++) offset += 12 + png.readUInt32BE(offset);
  return Buffer.concat([png.subarray(0, offset), text_, png.subarray(offset)]);
}

export function textChunks(png) {
  const out = {};
  for (const { type, data } of pngChunks(png)) {
    if (type !== 'tEXt') continue;
    const split = data.indexOf(0);
    out[data.toString('latin1', 0, split)] = data.toString('latin1', split + 1);
  }
  return out;
}

export function decodePng(png) {
  const { width, height, bitDepth, colorType, interlace } = pngHeader(png);
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth ${bitDepth}, colour type ${colorType}, ${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(
    Buffer.concat(
      pngChunks(png)
        .filter(({ type }) => type === 'IDAT')
        .map(({ data }) => data),
    ),
  );
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      let predictor;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      rows[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0; i < width * height; i++) rows.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return { width, height, rgba };
}

// PNG entries in an ICO need Vista or later.
export function buildIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const { width, height } = pngHeader(png);
    const entry = Buffer.alloc(16);
    entry[0] = width >= 256 ? 0 : width;
    entry[1] = height >= 256 ? 0 : height;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([head, ...entries, ...pngs]);
}

export function readIco(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('not an ICO');
  const images = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const at = 6 + 16 * i;
    const size = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    const png = ico.subarray(offset, offset + size);
    const { width, height } = pngHeader(png);
    images.push({ width, height, png });
  }
  return images;
}
