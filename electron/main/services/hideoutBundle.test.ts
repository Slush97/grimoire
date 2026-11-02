import { describe, expect, it } from 'vitest';
import { createHideoutBundle, compressHideoutGeometry } from './hideoutBundle';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function glb(document: object, binary: Buffer): Buffer {
    const json = Buffer.from(JSON.stringify(document));
    const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
    const header = Buffer.alloc(20);
    header.write('glTF');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + padding.length + binary.length, 8);
    header.writeUInt32LE(json.length + padding.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    const bin = Buffer.alloc(8);
    bin.writeUInt32LE(binary.length);
    bin.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, json, padding, bin, binary]);
}

function model(): Buffer {
    const binary = Buffer.alloc(48);
    [1, 2, 3, 0.5, 0.25, 1, 0.5].forEach((value, i) => binary.writeFloatLE(value, i * 4));
    binary.writeUInt32LE(0, 28);
    binary.writeUInt32LE(0x504e4700, 32);
    return glb({
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [10, 20, 30] }],
        buffers: [{ byteLength: binary.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }, { buffer: 0, byteOffset: 12, byteLength: 16 },
            { buffer: 0, byteOffset: 28, byteLength: 4 }, { buffer: 0, byteOffset: 32, byteLength: 4 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 1, type: 'VEC4' },
            { bufferView: 2, componentType: 5125, count: 1, type: 'SCALAR' }],
        images: [{ bufferView: 3, mimeType: 'image/png' }], textures: [{ source: 0 }],
        materials: [{ name: 'test', pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            extras: { morphic: { shader: 'environment_blend.vfx', textures: { g_tPacked1: 0 } } },
            extensions: { KHR_materials_transmission: { transmissionTexture: { index: 0 } } } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, material: 0 }] }],
    }, binary);
}

describe('prepared hideout bundle', () => {
    it('loads exact integer packing through the production glTF decoder, retaining nonrepresentable floats', async () => {
        const binary = Buffer.alloc(56);
        [10.25, -3.125, 0.001, 0, 0, 1, Math.fround(123 / 65535), Math.fround(32768 / 65535), 0.1, 0.2, 0.3].forEach((value, i) => binary.writeFloatLE(value, i * 4));
        const source = glb({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: binary.length }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }, { buffer: 0, byteOffset: 12, byteLength: 12 },
                { buffer: 0, byteOffset: 24, byteLength: 8 }, { buffer: 0, byteOffset: 32, byteLength: 12 }, { buffer: 0, byteOffset: 44, byteLength: 12, target: 34963 }],
            accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3', min: [10.25, -3.125, 0.001], max: [10.25, -3.125, 0.001] },
                { bufferView: 1, componentType: 5126, count: 1, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 1, type: 'VEC2' },
                { bufferView: 3, componentType: 5126, count: 1, type: 'VEC3' }, { bufferView: 4, componentType: 5125, count: 3, type: 'SCALAR' }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 3 }, indices: 4 }] }],
        }, binary);
        const packed = await compressHideoutGeometry(source);
        const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(Uint8Array.from(packed).buffer, '');
        const geometries: THREE.BufferGeometry[] = [];
        loaded.scene.traverse(object => { if (object instanceof THREE.Mesh) geometries.push(object.geometry); });
        expect(geometries).toHaveLength(1);
        const geometry = geometries[0];
        expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
        expect(geometry.getAttribute('color').array).toBeInstanceOf(Float32Array);
        expect(geometry.getAttribute('normal').array).toBeInstanceOf(Int16Array);
        expect(geometry.getAttribute('uv').array).toBeInstanceOf(Uint16Array);
        expect(geometry.index?.array).toBeInstanceOf(Uint16Array);
        expect(Math.fround(geometry.getAttribute('uv').getX(0))).toBe(Math.fround(123 / 65535));
        expect(geometry.getAttribute('normal').getZ(0)).toBe(1);
        geometry.dispose();
    });
    it('round trips every geometry and image byte through the real meshopt decoder', async () => {
        const prepared = createHideoutBundle([{ name: 'a.glb', bytes: model() }]);
        const compressed = await compressHideoutGeometry(prepared.bytes, false);
        await MeshoptDecoder.ready;
        const read = (bytes: Buffer) => {
            const length = bytes.readUInt32LE(12);
            return { document: JSON.parse(bytes.toString('utf8', 20, 20 + length)), binary: bytes.subarray(28 + length) };
        };
        const before = read(prepared.bytes), after = read(compressed);
        for (let i = 0; i < before.document.bufferViews.length; i++) {
            const original = before.document.bufferViews[i], view = after.document.bufferViews[i];
            const extension = view.extensions?.EXT_meshopt_compression;
            let decoded: Uint8Array;
            if (extension) {
                decoded = new Uint8Array(extension.count * extension.byteStride);
                MeshoptDecoder.decodeGltfBuffer(decoded, extension.count, extension.byteStride,
                    after.binary.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength), extension.mode, extension.filter);
            } else decoded = after.binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
            expect(Buffer.from(decoded)).toEqual(before.binary.subarray(original.byteOffset, original.byteOffset + original.byteLength));
        }
    });
    it('shares identical resources and preserves every source node transform and index', () => {
        const result = createHideoutBundle([{ name: 'a.glb', bytes: model() }, { name: 'b.glb', bytes: model() }]);
        expect(result.stats).toMatchObject({ models: 2, materials: 1, textures: 1, images: 1 });
        const length = result.bytes.readUInt32LE(12);
        const document = JSON.parse(result.bytes.toString('utf8', 20, 20 + length));
        const binary = result.bytes.subarray(28 + length);
        expect(document.scenes[0].nodes.map((i: number) => document.nodes[i].extras.hideoutModel)).toEqual(['a.glb', 'b.glb']);
        for (const mesh of document.meshes) {
            const primitive = mesh.primitives[0];
            const position = document.accessors[primitive.attributes.POSITION];
            const view = document.bufferViews[position.bufferView];
            expect([0, 4, 8].map(offset => binary.readFloatLE(view.byteOffset + position.byteOffset + offset))).toEqual([1, 2, 3]);
            const indices = document.accessors[primitive.indices];
            expect(binary.readUInt32LE(document.bufferViews[indices.bufferView].byteOffset + indices.byteOffset)).toBe(0);
        }
        expect(document.nodes.filter((node: { translation?: number[] }) => node.translation).map((node: { translation: number[] }) => node.translation)).toEqual([[10, 20, 30], [10, 20, 30]]);
        expect(document.materials[0].extras.morphic.textures.g_tPacked1).toBe(document.materials[0].pbrMetallicRoughness.baseColorTexture.index);
        expect(document.materials[0].extensions.KHR_materials_transmission.transmissionTexture.index).toBe(0);
    });

    it('prepares sRGB vertex paint and opacity once without changing the source buffer', () => {
        const original = model();
        const copy = Buffer.from(original);
        const result = createHideoutBundle([{ name: 'a.glb', bytes: original }]);
        const length = result.bytes.readUInt32LE(12);
        const document = JSON.parse(result.bytes.toString('utf8', 20, 20 + length));
        const accessor = document.accessors[document.meshes[0].primitives[0].attributes.COLOR_0];
        const start = 28 + length + document.bufferViews[accessor.bufferView].byteOffset;
        expect(result.bytes.readFloatLE(start)).toBeCloseTo(1 + (((0.5 + 0.055) / 1.055) ** 2.4 - 1) * 0.5, 6);
        expect(result.bytes.readFloatLE(start + 12)).toBe(1);
        expect(original).toEqual(copy);
    });

    it('rejects malformed input rather than writing a partially indexed bundle', () => {
        expect(() => createHideoutBundle([{ name: 'broken.glb', bytes: Buffer.alloc(20) }])).toThrow('Invalid static scene GLB');
    });
});
