import { describe, expect, it } from 'vitest';
import { blockDecompress, deserializeSnapshot, readSnapshotBlock, serializeSnapshot } from './snapshotResource';

function block(bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

describe('snapshot resources', () => {
  it('decompresses literals and overlapping back references', () => {
    // 6 bytes out: 'a', 'b', then a reference 2 back of length 4 ("abab")
    const compressed = block([6, 0, 0, 0, 0b100, 0, 0x61, 0x62, (1 << 4) | 1, 0]);
    expect(Array.from(blockDecompress(compressed))).toEqual([0x61, 0x62, 0x61, 0x62, 0x61, 0x62]);
  });

  it('copies a block stored uncompressed', () => {
    expect(Array.from(blockDecompress(block([2, 0, 0, 0x80, 7, 9])))).toEqual([7, 9]);
  });

  it('rejects a back reference before the start', () => {
    expect(() => blockDecompress(block([4, 0, 0, 0, 1, 0, 0x10, 0]))).toThrow(RangeError);
  });

  it('reads attributes in order and round-trips them', () => {
    const rows = new DataView(new ArrayBuffer(2 * 12 + 2 * 24));
    [1, 2, 3, 4, 5, 6].forEach((value, i) => rows.setFloat32(i * 4, value, true));
    for (let row = 0; row < 2; row++) {
      const base = 24 + row * 24;
      [0, 1, 1, 1].forEach((joint, k) => rows.setInt16(base + k * 2, joint, true));
      [0.75, 0.25, 0, 0].forEach((weight, k) => rows.setFloat32(base + 8 + k * 4, weight, true));
    }

    const snapshot = readSnapshotBlock(new Uint8Array(rows.buffer), {
      num_particles: 2,
      attributes: [{ name: 'position', type: 'float3' }, { name: 'skinning', type: 'skinning' }],
      string_list: ['root', 'hand_R'],
    });

    expect(snapshot.numParticles).toBe(2);
    expect(Array.from((snapshot.columns![0].data.values as Float32Array))).toEqual([1, 2, 3, 4, 5, 6]);
    const skinning = snapshot.columns![1].data;
    expect(skinning.kind === 'skinning' && skinning.values[1].jointNames).toEqual(['root', 'hand_R', 'hand_R', 'hand_R']);
    expect(serializeSnapshot(deserializeSnapshot(serializeSnapshot(snapshot)))).toEqual(serializeSnapshot(snapshot));
  });
});
