import { deflateSync, inflateSync } from 'node:zlib';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = process.argv[2] ?? 'public/heroes/icons';
const outDir = process.argv[3] ?? 'public/heroes/chip-icons';
const canvasSize = 64;
const targetMax = 58;
const margin = 3;
const alphaThreshold = 16;

const overrides = new Map([
  ['mo_and_krill.png', { targetMax: 54, offsetX: -1, offsetY: 1 }],
]);

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Not a PNG file');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Unsupported PNG compression/filter/interlace mode');
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  }

  const channelsByType = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByType.get(colorType);
  if (!channels) {
    throw new Error(`Unsupported PNG color type ${colorType}`);
  }

  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(width * height * channels);
  let inOffset = 0;
  let outOffset = 0;
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = inflated[inOffset++];
    const row = Buffer.from(inflated.subarray(inOffset, inOffset + stride));
    inOffset += stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + up) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
    }

    row.copy(raw, outOffset);
    outOffset += stride;
    prev = row;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    const dst = i * 4;
    if (colorType === 0) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src];
      rgba[dst + 2] = raw[src];
      rgba[dst + 3] = 255;
    } else if (colorType === 2) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = 255;
    } else if (colorType === 3) {
      const idx = raw[src];
      rgba[dst] = palette[idx * 3] ?? 0;
      rgba[dst + 1] = palette[idx * 3 + 1] ?? 0;
      rgba[dst + 2] = palette[idx * 3 + 2] ?? 0;
      rgba[dst + 3] = transparency?.[idx] ?? 255;
    } else if (colorType === 4) {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src];
      rgba[dst + 2] = raw[src];
      rgba[dst + 3] = raw[src + 1];
    } else {
      rgba[dst] = raw[src];
      rgba[dst + 1] = raw[src + 1];
      rgba[dst + 2] = raw[src + 2];
      rgba[dst + 3] = raw[src + 3];
    }
  }

  return { width, height, rgba };
}

function writePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND'),
  ]);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sampleBilinear(image, x, y) {
  const x0 = clamp(Math.floor(x), 0, image.width - 1);
  const y0 = clamp(Math.floor(y), 0, image.height - 1);
  const x1 = clamp(x0 + 1, 0, image.width - 1);
  const y1 = clamp(y0 + 1, 0, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const result = [0, 0, 0, 0];

  for (const [px, py, weight] of [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x1, y0, fx * (1 - fy)],
    [x0, y1, (1 - fx) * fy],
    [x1, y1, fx * fy],
  ]) {
    const idx = (py * image.width + px) * 4;
    for (let channel = 0; channel < 4; channel++) {
      result[channel] += image.rgba[idx + channel] * weight;
    }
  }

  return result.map((value) => Math.round(value));
}

function normalizeIcon(name, image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let weightedX = 0;
  let weightedY = 0;
  let weightTotal = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        weightedX += x * alpha;
        weightedY += y * alpha;
        weightTotal += alpha;
      }
    }
  }

  if (maxX < 0) return { width: canvasSize, height: canvasSize, rgba: Buffer.alloc(canvasSize * canvasSize * 4) };

  const override = overrides.get(name) ?? {};
  const boundsW = maxX - minX + 1;
  const boundsH = maxY - minY + 1;
  const fitMax = override.targetMax ?? targetMax;
  const scale = fitMax / Math.max(boundsW, boundsH);
  const drawW = Math.max(1, Math.round(boundsW * scale));
  const drawH = Math.max(1, Math.round(boundsH * scale));
  const centroidX = weightedX / weightTotal - minX;
  const centroidY = weightedY / weightTotal - minY;
  const drawX = clamp(canvasSize / 2 + (override.offsetX ?? 0) - centroidX * scale, margin, canvasSize - margin - drawW);
  const drawY = clamp(canvasSize / 2 + (override.offsetY ?? 0) - centroidY * scale, margin, canvasSize - margin - drawH);
  const out = { width: canvasSize, height: canvasSize, rgba: Buffer.alloc(canvasSize * canvasSize * 4) };

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx = minX + (x + 0.5) / scale;
      const sy = minY + (y + 0.5) / scale;
      const [r, g, b, a] = sampleBilinear(image, sx, sy);
      const dstX = Math.round(drawX) + x;
      const dstY = Math.round(drawY) + y;
      if (dstX < 0 || dstX >= canvasSize || dstY < 0 || dstY >= canvasSize) continue;
      const dst = (dstY * canvasSize + dstX) * 4;
      out.rgba[dst] = r;
      out.rgba[dst + 1] = g;
      out.rgba[dst + 2] = b;
      out.rgba[dst + 3] = a;
    }
  }

  return out;
}

await mkdir(outDir, { recursive: true });
const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.png')).sort();
for (const file of files) {
  const source = readPng(await readFile(path.join(sourceDir, file)));
  const normalized = normalizeIcon(file, source);
  await writeFile(path.join(outDir, file), writePng(normalized));
  console.log(`Generated ${file}`);
}
