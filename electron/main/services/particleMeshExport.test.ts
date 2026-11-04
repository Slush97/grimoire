import { describe, expect, it } from 'vitest';
import { readGlbMeshes } from './particleMeshExport';
import { deserializeModelMesh, serializeModelMesh } from '../../../src/lib/particles/render/particleModels';

describe('particle model draw materials', () => {
  it('retains full paths for separate draws with the same material basename', () => {
    const positions = Buffer.from(new Float32Array([0, 0, 0, 0.0254, 0, 0, 0, 0.0254, 0]).buffer);
    const paths = ['models/a/smoke.vmat', 'models/b/smoke.vmat'];
    const json = Buffer.from(JSON.stringify({ accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ byteLength: positions.length }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }],
      meshes: [{ primitives: paths.map((_, material) => ({ attributes: { POSITION: 0 }, material })) }],
      materials: paths.map(source_material => ({ name: 'smoke.vmat', extras: { morphic: { source_material } } })),
    }));
    const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + positions.length, 8);
    header.writeUInt32LE(padded.length, 12); header.write('JSON', 16);
    binHeader.writeUInt32LE(positions.length); binHeader.write('BIN\0', 4);
    const primitives = readGlbMeshes(Buffer.concat([header, padded, binHeader, positions]));
    expect(primitives.map(draw => draw.material)).toEqual(paths);
    const mesh = { name: 'models/test.vmdl', primitives, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, flags: 0, materialGroups: [] };
    const restored = deserializeModelMesh(serializeModelMesh({ ...mesh, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }));
    expect(restored.primitives.map(draw => draw.material)).toEqual(paths);
    expect(restored.primitives[0].positions[4]).toBeCloseTo(1);
  });
});
