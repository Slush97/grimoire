import { describe, expect, it } from 'vitest';
import { clipFloorOffset, parseGlb, stagesPose } from './heroStagedPose';

/** A standing figure: root, a pelvis 1 unit up, a head at 2, and a prop bone
 * held beside the pelvis. Every bone carries skinned weight. */
function glb(animation?: { node: number; values: number[] }, standing?: { node: number; values: number[] }): Buffer {
    const floats: number[] = [];
    const accessors: object[] = [];
    const views: object[] = [];
    const add = (values: number[], type: string, componentType = 5126) => {
        const offset = floats.length * 4;
        floats.push(...values);
        views.push({ buffer: 0, byteOffset: offset, byteLength: values.length * 4 });
        const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type] ?? 1;
        accessors.push({ bufferView: views.length - 1, componentType, count: values.length / size, type });
        return accessors.length - 1;
    };
    const position = add([0, 0, 0, 0, 1, 0, 0, 2, 0, 0.3, 1, 0], 'VEC3');
    const joints = add([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], 'VEC4');
    const weights = add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 'VEC4');
    const clip = (name: string, motion: { node: number; values: number[] }) => {
        const input = add([0, 1], 'SCALAR');
        const output = add(motion.values, 'VEC3');
        return { name, samplers: [{ input, output, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: motion.node, path: 'translation' } }] };
    };
    const animations = [...animation ? [clip('pose', animation)] : [], ...standing ? [clip('standing', standing)] : []];
    // Joint indices above are stored as floats; the reader accepts any component type.
    const json = {
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 4] }],
        nodes: [
            { name: 'root', children: [1] },
            { name: 'pelvis', translation: [0, 1, 0], children: [2, 3] },
            { name: 'head', translation: [0, 1, 0] },
            { name: 'prop', translation: [0.3, 0, 0] },
            { name: 'body', mesh: 0, skin: 0 },
        ],
        skins: [{ joints: [0, 1, 2, 3] }],
        meshes: [{ primitives: [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights } }] }],
        accessors, bufferViews: views, buffers: [{ byteLength: floats.length * 4 }],
        animations,
    };
    const bin = Buffer.alloc(floats.length * 4);
    floats.forEach((value, index) => bin.writeFloatLE(value, index * 4));
    const text = JSON.stringify(json);
    const jsonChunk = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + jsonChunk.length + 8 + bin.length, 8);
    header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonChunk, binHeader, bin]);
}

const check = (values: number[], node = 3) => {
    const model = parseGlb(glb())!;
    return stagesPose(model, parseGlb(glb({ node, values }))!, 'pose');
};
const floor = (values: number[]) => clipFloorOffset(parseGlb(glb())!, parseGlb(glb({ node: 0, values }))!, 'pose');

describe('floor-staged UI poses', () => {
    it('flags a part pulled off its parent and laid on the floor', () => {
        expect(check([0.3, 0, 0, -1, -0.95, 0])).toBe(true);
    });
    it('keeps ordinary motion, raised props and far authored hides', () => {
        expect(check([0.3, 0, 0, 0.35, 0.05, 0])).toBe(false);
        expect(check([0.3, 0, 0, 0, 1.5, 1])).toBe(false);
        expect(check([0, -20, 0, 0, -20, 0])).toBe(false);
    });
    it('keeps the graph default when the clip or data is missing', () => {
        const model = parseGlb(glb())!;
        expect(stagesPose(model, parseGlb(glb({ node: 3, values: [0.3, 0, 0, -1, -0.95, 0] }))!, 'other')).toBe(false);
        expect(parseGlb(Buffer.from('not a glb at all, really'))).toBeNull();
    });
    it('flags a clip that holds the whole figure off the floor', () => {
        expect(check([0, 0.5, 0, 0, 0.4, 0], 0)).toBe(true);
        // A hop that comes back down stands on the floor.
        expect(check([0, 0.5, 0, 0, 0, 0], 0)).toBe(false);
    });
    it('does not flag a hero that hovers as high in its standing idle', () => {
        const model = parseGlb(glb())!;
        const hovering = parseGlb(glb({ node: 0, values: [0, 0.5, 0, 0, 0.5, 0] }, { node: 0, values: [0, 0.4, 0, 0, 0.4, 0] }))!;
        expect(stagesPose(model, hovering, 'pose', 'standing')).toBe(false);
        const seated = parseGlb(glb({ node: 0, values: [0, 0.5, 0, 0, 0.5, 0] }, { node: 0, values: [0, 0, 0, 0, 0, 0] }))!;
        expect(stagesPose(model, seated, 'pose', 'standing')).toBe(true);
    });
});

describe('clip floor offsets', () => {
    it('measures how far a clip lowers or lifts the floor contact', () => {
        expect(floor([0, -0.1, 0, 0, -0.1, 0])).toBeCloseTo(-0.1, 6);
        expect(floor([0, 0.3, 0, 0, 0.2, 0])).toBeCloseTo(0.2, 6);
    });
    it('reads standing clips and noise as zero, and ignores authored hides', () => {
        expect(floor([0, 0, 0, 0, 0.004, 0])).toBe(0);
        expect(floor([0, -20, 0, 0, -20, 0])).toBeNull();
    });
});
