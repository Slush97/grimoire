import { describe, expect, it } from 'vitest';
import { readParticleSheet } from './particleSheet';

function resource() {
  const b = Buffer.alloc(256);
  b.writeUInt16LE(12, 4); b.writeUInt32LE(8, 8); b.writeUInt32LE(1, 12);
  b.write('DATA', 16); b.writeUInt32LE(12, 20); b.writeUInt32LE(224, 24);
  b.writeUInt16LE(1, 32); b.writeUInt32LE(8, 64); b.writeUInt32LE(1, 68);
  b.writeUInt32LE(2, 72); b.writeUInt32LE(12, 76); b.writeUInt32LE(128, 80);
  b.writeUInt32LE(8, 88); b.writeUInt32LE(1, 92);
  b.writeUInt32LE(3, 96); b[100] = 1; b.writeUInt32LE(24, 104); b.writeUInt32LE(1, 108);
  b.writeFloatLE(1, 128); b.writeUInt32LE(12, 132); b.writeUInt32LE(1, 136);
  [0.1, 0.2, 0.4, 0.6, 0.05, 0.15, 0.45, 0.65].forEach((v, i) => b.writeFloatLE(v, 144+i*4));
  return b;
}
describe('particle sheet metadata', () => {
  it('retains authored ids, clamp and uncropped bounds independently of cropped bounds', () => {
    const sheet = readParticleSheet(resource())!;
    expect(sheet.sequences).toHaveLength(1);
    expect(sheet.sequences[0]).toMatchObject({ id: 3, clamp: true });
    sheet.sequences[0].uv.forEach((v, i) => expect(v).toBeCloseTo([0.05, 0.15, 0.45, 0.65][i]));
  });
  it('does not reinterpret animated, multi-image or out-of-range frames as a full atlas', () => {
    const b = resource(); b.writeUInt32LE(2, 108);
    expect(readParticleSheet(b)?.sequences).toEqual([]);
    b.writeUInt32LE(1, 108); b.writeFloatLE(2, 160);
    expect(readParticleSheet(b)?.sequences).toEqual([]);
  });
  it('bounds malicious relative pointers and sequence counts before allocation', () => {
    const b = resource(); b.writeUInt32LE(999999, 104);
    expect(() => readParticleSheet(b)).toThrow('bounds');
    const c = resource(); c.writeUInt32LE(999999, 92);
    expect(() => readParticleSheet(c)).toThrow('budget');
  });
});
