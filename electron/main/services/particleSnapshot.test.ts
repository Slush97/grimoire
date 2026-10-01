import { describe, expect, it } from 'vitest';
import { readParticleSnapshot } from './particleSnapshot';

const metadata = { num_particles: 1, attributes: [
  { name: 'position', type: 'float3', data_offset: 0, data_size: 12 },
  { name: 'skinning', type: 'skinning', data_offset: 12, data_size: 24 },
], string_list: ['', 'head'] };
function resource(stream: Buffer) {
  const b = Buffer.alloc(28+stream.length); b.writeUInt16LE(12, 4); b.writeInt32LE(8, 8); b.writeUInt32LE(1, 12);
  b.write('SNAP', 16); b.writeInt32LE(8, 20); b.writeUInt32LE(stream.length, 24); stream.copy(b, 28); return b;
}
function raw() {
  const b = Buffer.alloc(40); b.writeUInt32LE(0x80000024, 0);
  b.writeFloatLE(2, 4); b.writeFloatLE(3, 8); b.writeFloatLE(4, 12); b.writeInt16LE(1, 16); b.writeFloatLE(1, 24); return b;
}
describe('authored particle snapshots', () => {
  it('preserves model-space coordinates and four influences without converting them', () => {
    expect(readParticleSnapshot(resource(raw()), metadata)).toEqual([{ position: [2, 3, 4], joints: ['head', '', '', ''], weights: [1, 0, 0, 0] }]);
  });
  it('decodes overlapping backward references and literal mask words', () => {
    // One literal zero followed by overlapping runs of 18 and 17 zeros.
    const b = Buffer.alloc(11); b.writeUInt32LE(36, 0); b.writeUInt16LE(6, 4); b[6] = 0; b.writeUInt16LE(15, 7); b.writeUInt16LE(14, 9);
    const d = { ...metadata, attributes: metadata.attributes.filter((a) => a.name !== 'skinning') };
    // Decompression succeeds; missing influence metadata is rejected afterwards.
    expect(() => readParticleSnapshot(resource(b), d)).toThrow('Unsupported particle snapshot attributes');
  });
  it('rejects truncated streams, allocation bombs and invalid back references', () => {
    expect(() => readParticleSnapshot(resource(raw().subarray(0, 8)), metadata)).toThrow('bounds');
    const bomb = raw(); bomb.writeUInt32LE(0x801fffff, 0); expect(() => readParticleSnapshot(resource(bomb), metadata)).toThrow('budget');
    const back = Buffer.alloc(8); back.writeUInt32LE(36); back.writeUInt16LE(1, 4);
    expect(() => readParticleSnapshot(resource(back), metadata)).toThrow('back-reference');
  });
  it('rejects invalid joints, nonfinite coordinates and nonnormalized weights', () => {
    const joint = raw(); joint.writeInt16LE(4, 16); expect(() => readParticleSnapshot(resource(joint), metadata)).toThrow('joint');
    const point = raw(); point.writeFloatLE(Infinity, 4); expect(() => readParticleSnapshot(resource(point), metadata)).toThrow('influence');
    const weight = raw(); weight.writeFloatLE(0.5, 24); expect(() => readParticleSnapshot(resource(weight), metadata)).toThrow('influence');
  });
});
