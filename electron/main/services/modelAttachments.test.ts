import { describe, expect, it, vi } from 'vitest';
vi.mock('./vpk', () => ({ readVpkEntryBytes: vi.fn() }));
vi.mock('./modMerger', () => ({ runVpkmergeStdout: vi.fn() }));
import { attachmentMetadataResources, parseModelAttachments } from './modelAttachments';

const attachment = {
    m_name: 'cast', m_nInfluences: 1, m_bIgnoreRotation: false,
    m_influenceNames: ['hand', '', ''], m_influenceWeights: [1, 0, 0],
    m_bInfluenceRootTransform: [false, false, false],
    m_vInfluenceOffsets: [[2, 3, 4], [0, 0, 0], [0, 0, 0]],
    m_vInfluenceRotations: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
};
const data = (value = attachment) => ({ m_attachments: [{ key: value.m_name, value }] });

describe('authored model attachments', () => {
    it('keeps a supported local transform without unit or side compensation', () => {
        expect(parseModelAttachments(data())).toEqual([{ name: 'cast', bone: 'hand', position: [2, 3, 4], rotation: [0, 0, 0, 1] }]);
    });
    it.each([
        { m_nInfluences: 2 }, { m_bIgnoreRotation: true },
        { m_bInfluenceRootTransform: [true, false, false] },
        { m_influenceWeights: [0.5, 0.5, 0] }, { m_influenceNames: ['', '', ''] },
        { m_vInfluenceOffsets: [[NaN, 0, 0]] }, { m_vInfluenceRotations: [[0, 0, 0, 0]] },
    ])('omits unsupported or malformed transforms: %j', (fields) => {
        expect(parseModelAttachments(data({ ...attachment, ...fields }))).toEqual([]);
    });
    it('does not fabricate attachments from other resource properties', () => {
        expect(parseModelAttachments({ m_modelSkeleton: { m_boneName: ['hand'] } })).toEqual([]);
    });
    it('rejects an oversized attachment array', () => {
        expect(parseModelAttachments({ m_attachments: Array.from({ length: 257 }, () => data().m_attachments[0]) })).toEqual([]);
    });
});

describe('compiled metadata resource wrapper', () => {
    function resource() {
        const b = Buffer.alloc(44);
        b.writeUInt32LE(44, 0); b.writeUInt16LE(12, 4); b.writeUInt16LE(7, 6);
        b.writeUInt32LE(8, 8); b.writeUInt32LE(2, 12);
        b.write('MDAT', 16); b.writeUInt32LE(20, 20); b.writeUInt32LE(4, 24);
        b.write('MVTX', 28); b.writeUInt32LE(8, 32); b.writeUInt32LE(4, 36);
        b.write('KV3!', 40);
        return b;
    }
    it('wraps metadata bytes alone for the pinned generic decoder', () => {
        const wrappers = attachmentMetadataResources(resource());
        expect(wrappers).toHaveLength(1);
        const b = wrappers[0];
        expect(b.length).toBe(32); expect(b.readUInt16LE(6)).toBe(7);
        expect(b.toString('ascii', 16, 20)).toBe('DATA');
        expect(b.toString('ascii', 28)).toBe('KV3!');
        expect(20 + b.readUInt32LE(20)).toBe(28);
    });
    it.each(['table', 'payload', 'count', 'length'])('rejects unbounded %s', (field) => {
        const b = resource();
        if (field === 'table') b.writeUInt32LE(0xffffffff, 8);
        if (field === 'payload') b.writeUInt32LE(0xffffffff, 20);
        if (field === 'count') b.writeUInt32LE(0xffffffff, 12);
        if (field === 'length') b.writeUInt32LE(0xffffffff, 24);
        expect(attachmentMetadataResources(b)).toEqual([]);
    });
    it('rejects a truncated header', () => expect(attachmentMetadataResources(Buffer.alloc(15))).toEqual([]));
    it.each([129, 256, 257])('bounds %i metadata headers while retaining supported multi-LOD models', (count) => {
        const payload = 16 + 12 * count;
        const b = Buffer.alloc(payload + 4);
        b.writeUInt32LE(b.length, 0); b.writeUInt16LE(12, 4);
        b.writeUInt32LE(8, 8); b.writeUInt32LE(count, 12);
        for (let i = 0; i < count; i++) {
            const header = 16 + i * 12;
            b.write('MDAT', header); b.writeUInt32LE(payload - header - 4, header + 4);
            b.writeUInt32LE(4, header + 8);
        }
        expect(attachmentMetadataResources(b)).toHaveLength(count <= 256 ? count : 0);
    });
});
