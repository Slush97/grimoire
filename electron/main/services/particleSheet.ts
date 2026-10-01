import type { FxSheet } from '../../../src/components/locker/fxDescriptor';

/** Bounded read of VTEX v1's SHEET v8 metadata. No texture pixels are decoded here.
 * Multi-frame/image sequences remain unsupported instead of displaying the atlas. */
export function readParticleSheet(bytes: Buffer): FxSheet | undefined {
  const check = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) throw new Error('Invalid particle sheet bounds.');
  };
  const u32 = (offset: number) => { check(offset, 4); return bytes.readUInt32LE(offset); };
  const relative = (offset: number) => { check(offset, 4); return offset + bytes.readInt32LE(offset); };
  check(0, 16);
  if (bytes.readUInt16LE(4) !== 12) return undefined;
  const table = relative(8), blocks = u32(12);
  if (blocks > 64) throw new Error('Particle resource block budget exceeded.');
  check(table, blocks * 12);
  for (let i = 0; i < blocks; i++) {
    const block = table + i * 12;
    if (bytes.toString('ascii', block, block + 4) !== 'DATA') continue;
    const data = relative(block + 4), size = u32(block + 8);
    check(data, size); check(data, 40);
    if (bytes.readUInt16LE(data) !== 1) return undefined;
    const extras = relative(data + 32), count = u32(data + 36);
    if (count > 64) throw new Error('Particle texture metadata budget exceeded.');
    check(extras, count * 12);
    for (let j = 0; j < count; j++) {
      const extra = extras + j * 12;
      if (u32(extra) !== 2) continue;
      const sheet = relative(extra + 4), length = u32(extra + 8);
      check(sheet, length);
      const within = (p: number, n: number) => {
        check(p, n);
        if (p < sheet || p + n > sheet + length) throw new Error('Invalid particle sequence bounds.');
      };
      within(sheet, 8);
      const result: FxSheet = { sequences: [] };
      if (u32(sheet) !== 8) return result;
      const sequences = u32(sheet + 4);
      if (sequences > 256) throw new Error('Particle sequence budget exceeded.');
      within(sheet + 8, sequences * 32);
      for (let k = 0; k < sequences; k++) {
        const sequence = sheet + 8 + k * 32;
        const frames = relative(sequence + 8), frameCount = u32(sequence + 12);
        if (frameCount !== 1 || bytes[sequence + 5] || bytes[sequence + 6] || bytes[sequence + 7]) continue;
        within(frames, 12);
        const image = relative(frames + 4);
        if (u32(frames + 8) !== 1) continue;
        within(image, 32);
        // Uncropped texel-center UVs preserve the authored full quad. PNGs use
        // top-down image coordinates; TextureLoader's flipY owns that conversion.
        const uv = Array.from({ length: 4 }, (_, n) => bytes.readFloatLE(image + 16 + n * 4));
        if (!uv.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || uv[2] <= uv[0] || uv[3] <= uv[1]) continue;
        result.sequences.push({ id: u32(sequence), clamp: !!bytes[sequence + 4], uv: uv as [number, number, number, number] });
      }
      return result;
    }
  }
  return undefined;
}
