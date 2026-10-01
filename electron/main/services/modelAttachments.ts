import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readVpkEntryBytes } from './vpk';
import { runVpkmergeStdout } from './modMerger';
import type { ModelAttachment } from '../../../src/types/modelAttachment';

const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_BLOCKS = 4096;
const MAX_METADATA_BLOCK_BYTES = 8 * 1024 * 1024;
// Embedded mesh LODs can each carry MDAT (the current chessboard model exceeds
// 128). Keep the byte budgets as well as a bounded block count.
const MAX_METADATA_BLOCKS = 256;

/** Preserve the compiled KV3 bytes, changing only their resource block wrapper.
 * The pinned CLI's generic KV3 decoder reads DATA from a loose resource.
 */
export function attachmentMetadataResources(bytes: Buffer): Buffer[] {
    if (bytes.length < 16 || bytes.length > MAX_RESOURCE_BYTES || bytes.readUInt16LE(4) !== 12) return [];
    const declaredSize = bytes.readUInt32LE(0);
    const start = 8 + bytes.readUInt32LE(8);
    const count = bytes.readUInt32LE(12);
    if (declaredSize < 16 || declaredSize > bytes.length || count > MAX_BLOCKS || start < 16 || start + count * 12 > bytes.length) return [];
    const result: Buffer[] = [];
    let metadataBytes = 0;
    for (let i = 0; i < count; i++) {
        const header = start + i * 12;
        const kind = bytes.toString('ascii', header, header + 4);
        if (kind !== 'DATA' && kind !== 'MDAT') continue;
        const offset = header + 4 + bytes.readUInt32LE(header + 4);
        const length = bytes.readUInt32LE(header + 8);
        if (length < 4 || length > MAX_METADATA_BLOCK_BYTES || offset < start + count * 12 || offset + length > bytes.length) return [];
        metadataBytes += length;
        if (result.length >= MAX_METADATA_BLOCKS || metadataBytes > MAX_RESOURCE_BYTES) return [];
        const resource = Buffer.alloc(28 + length);
        resource.writeUInt32LE(resource.length, 0);
        resource.writeUInt16LE(12, 4);
        resource.writeUInt16LE(bytes.readUInt16LE(6), 6);
        resource.writeUInt32LE(8, 8);
        resource.writeUInt32LE(1, 12);
        resource.write('DATA', 16, 'ascii');
        resource.writeUInt32LE(8, 20);
        resource.writeUInt32LE(length, 24);
        bytes.copy(resource, 28, offset, offset + length);
        result.push(resource);
    }
    return result;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function vector(value: unknown, size: number): value is number[] {
    return Array.isArray(value) && value.length === size && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Multi-influence and root-space attachments require separate engine semantics.
 * Omit those records rather than substituting a bone or a guessed hand side.
 */
export function parseModelAttachments(data: unknown): ModelAttachment[] {
    const rows = record(data)?.m_attachments;
    if (!Array.isArray(rows) || rows.length > 256) return [];
    const result: ModelAttachment[] = [];
    for (const row of rows) {
        const pair = record(row);
        const attachment = record(pair?.value);
        if (!attachment || typeof attachment.m_name !== 'string' || !attachment.m_name || pair?.key !== attachment.m_name) continue;
        const names = attachment.m_influenceNames;
        const positions = attachment.m_vInfluenceOffsets;
        const rotations = attachment.m_vInfluenceRotations;
        const weights = attachment.m_influenceWeights;
        const roots = attachment.m_bInfluenceRootTransform;
        if (attachment.m_nInfluences !== 1 || attachment.m_bIgnoreRotation !== false
            || !Array.isArray(names) || typeof names[0] !== 'string' || !names[0]
            || !Array.isArray(weights) || weights[0] !== 1 || weights.slice(1).some((weight) => weight !== 0)
            || !Array.isArray(roots) || roots[0] !== false
            || !Array.isArray(positions) || !vector(positions[0], 3)
            || !Array.isArray(rotations) || !vector(rotations[0], 4)) continue;
        const rotation = rotations[0];
        if (Math.abs(Math.hypot(...rotation) - 1) > 1e-4) continue;
        result.push({ name: attachment.m_name, bone: names[0], position: [...positions[0]] as ModelAttachment['position'], rotation: [...rotation] as ModelAttachment['rotation'] });
    }
    return result;
}

export async function exportModelAttachments(vpk: string, base: string, entry: string): Promise<ModelAttachment[]> {
    const bytes = readVpkEntryBytes(vpk, entry) ?? (vpk !== base ? readVpkEntryBytes(base, entry) : null);
    if (!bytes) return [];
    const resources = attachmentMetadataResources(bytes);
    if (!resources.length) return [];
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-model-attachments-'));
    const attachments = new Map<string, ModelAttachment>();
    const conflicts = new Set<string>();
    try {
        for (let i = 0; i < resources.length; i++) {
            const file = join(dir, `${i}.vsndevts_c`);
            await fs.writeFile(file, resources[i]);
            const data: unknown = JSON.parse(await runVpkmergeStdout(['soundevents', file]));
            for (const attachment of parseModelAttachments(data)) {
                const existing = attachments.get(attachment.name);
                if (existing && JSON.stringify(existing) !== JSON.stringify(attachment)) conflicts.add(attachment.name);
                else attachments.set(attachment.name, attachment);
            }
        }
        return [...attachments.values()].filter((attachment) => !conflicts.has(attachment.name)).slice(0, 256);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
