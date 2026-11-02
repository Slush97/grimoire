// Reads a compiled model (.vmdl_c) into the description the particle model functions need: skeleton,
// hitbox sets and render bounds (src/lib/particles/model.ts). Node only, no Electron: shared by the hero
// particle bundle export and the dev scripts. The KV3 blocks are decoded by a caller-supplied decoder
// (vpkmerge's generic KV3 reader over a loose single-block resource).
//
// Follows ValveResourceFormat (MIT): Model.Read takes the hitbox sets of the first MDAT block and
// SetExternalMeshData those of the first referenced mesh that has any while the model has none;
// ModelElements.Bounds unions the scene object bounds of the meshes of the most detailed level of
// detail (CTRL embedded_meshes and m_refMeshes, filtered by m_refLODGroupMasks).

import type { BundleAttachment } from '../../../src/lib/particles/host/bundle';
import { type KVObject, getArray, getString, isCollection } from '../../../src/lib/particles/kv';
import { type ModelBounds, ParticleModel, type SerializedParticleModel } from '../../../src/lib/particles/model';
import { Vector3, maxV, minV } from '../../../src/lib/particles/numerics';

const MAX_RESOURCE_BYTES = 256 * 1024 * 1024;
const MAX_BLOCKS = 4096;
const MAX_BLOCK_BYTES = 64 * 1024 * 1024;

export interface ResourceBlock {
    /** The block's position in the resource's block table, as VRF's GetBlockByIndex counts it. */
    index: number;
    type: string;
    /** The block alone, wrapped as the DATA block of a loose resource the KV3 decoder reads. */
    resource: Buffer;
}

/** The blocks of a compiled resource whose type is in `types`, each wrapped as a loose resource. */
export function resourceBlocks(bytes: Buffer, types: ReadonlySet<string>): ResourceBlock[] {
    if (bytes.length < 16 || bytes.length > MAX_RESOURCE_BYTES) throw new Error('Model resource size is outside preview limits.');
    if (bytes.readUInt16LE(4) !== 12) throw new Error('Unsupported resource header version.');
    const start = 8 + bytes.readUInt32LE(8);
    const count = bytes.readUInt32LE(12);
    if (count > MAX_BLOCKS || start + count * 12 > bytes.length) throw new Error('Invalid resource block table.');
    const blocks: ResourceBlock[] = [];
    for (let index = 0; index < count; index++) {
        const header = start + index * 12;
        const type = bytes.toString('ascii', header, header + 4);
        if (!types.has(type)) continue;
        const offset = header + 4 + bytes.readUInt32LE(header + 4);
        const length = bytes.readUInt32LE(header + 8);
        if (length > MAX_BLOCK_BYTES || offset + length > bytes.length) throw new Error(`Invalid ${type} block bounds.`);
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
        blocks.push({ index, type, resource });
    }
    return blocks;
}

/** The blocks a model's particle description reads. */
export interface ModelBlockPlan {
    data: ResourceBlock;
    ctrl: ResourceBlock | null;
    /** Every MDAT block; the first carries the hitbox sets, those of the most detailed level the bounds. */
    meshes: ResourceBlock[];
}

export function planModelBlocks(bytes: Buffer): ModelBlockPlan {
    const blocks = resourceBlocks(bytes, new Set(['DATA', 'CTRL', 'MDAT']));
    const data = blocks.find((block) => block.type === 'DATA');
    if (!data) throw new Error('Model has no DATA block.');
    return { data, ctrl: blocks.find((block) => block.type === 'CTRL') ?? null, meshes: blocks.filter((block) => block.type === 'MDAT') };
}

function numberAt(obj: KVObject, ...keys: string[]): number {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'number') return value;
    }
    return -1;
}

/** ModelLodInfo: whether a mesh is in the most detailed level any mesh is in. */
function lodFilter(modelData: KVObject): (meshIndex: number) => boolean {
    const masks = (getArray(modelData, 'm_refLODGroupMasks') ?? []).map((value) => BigInt.asIntN(64, BigInt(Math.trunc(Number(value) || 0))));
    const combined = masks.reduce((all, mask) => all | mask, 0n);
    let lowest = 0;
    if (combined !== 0n) {
        while (((combined >> BigInt(lowest)) & 1n) === 0n) lowest++;
    }
    return (meshIndex) => meshIndex >= masks.length || ((masks[meshIndex] >> BigInt(lowest)) & 1n) !== 0n;
}

/** The MDAT block indices of the embedded meshes of the most detailed level (CTRL embedded_meshes). */
export function embeddedMeshBlocksForLod(modelData: KVObject, ctrl: KVObject | null): number[] {
    const inLevel = lodFilter(modelData);
    const indices: number[] = [];
    for (const mesh of ctrl ? getArray(ctrl, 'embedded_meshes') ?? [] : []) {
        if (!isCollection(mesh)) continue;
        const meshIndex = numberAt(mesh, 'mesh_index', 'm_nMeshIndex');
        const dataBlock = numberAt(mesh, 'data_block', 'm_nDataBlock');
        if (dataBlock >= 0 && inLevel(meshIndex)) indices.push(dataBlock);
    }
    return indices;
}

/** The meshes a model references (m_refMeshes), all of them or those of its most detailed level, as compiled paths. */
export function externalMeshPaths(modelData: KVObject, lodOnly: boolean): string[] {
    const inLevel = lodFilter(modelData);
    return (getArray(modelData, 'm_refMeshes') ?? []).flatMap((value, meshIndex) =>
        typeof value === 'string' && value !== '' && (!lodOnly || inLevel(meshIndex)) ? [value.endsWith('_c') ? value : `${value}_c`] : []);
}

function vectorOf(value: unknown): Vector3 {
    return Array.isArray(value) ? new Vector3(Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)) : Vector3.zero;
}

/** Mesh.GetBounds: the scene objects' boxes unioned, a zero box when there are none. */
function meshBounds(mesh: KVObject): ModelBounds {
    const sceneObjects = (getArray(mesh, 'm_sceneObjects') ?? []).filter(isCollection);
    if (sceneObjects.length === 0) return { min: Vector3.zero, max: Vector3.zero };
    let min = vectorOf(sceneObjects[0].m_vMinBounds);
    let max = vectorOf(sceneObjects[0].m_vMaxBounds);
    for (const sceneObject of sceneObjects.slice(1)) {
        min = minV(min, vectorOf(sceneObject.m_vMinBounds));
        max = maxV(max, vectorOf(sceneObject.m_vMaxBounds));
    }
    return { min, max };
}

/**
 * The particle description of a decoded model. `meshesByBlock` maps MDAT block indices to their decoded
 * KV3. `externalMeshes` are the decoded DATA blocks of every mesh the model references, in order (they
 * can supply hitbox sets); `externalLodMeshes` those of its most detailed level (they add to the bounds).
 */
export function buildParticleModel(
    modelData: KVObject,
    ctrl: KVObject | null,
    firstMeshIndex: number | null,
    meshesByBlock: ReadonlyMap<number, KVObject>,
    externalMeshes: readonly KVObject[] = [],
    externalLodMeshes: readonly KVObject[] = externalMeshes,
): SerializedParticleModel {
    let bounds: ModelBounds | null = null;
    const add = (mesh: KVObject) => {
        const box = meshBounds(mesh);
        bounds = bounds ? { min: minV(bounds.min, box.min), max: maxV(bounds.max, box.max) } : box;
    };
    for (const block of embeddedMeshBlocksForLod(modelData, ctrl)) {
        const mesh = meshesByBlock.get(block);
        if (mesh) add(mesh);
    }
    externalLodMeshes.forEach(add);
    const first = firstMeshIndex === null ? undefined : meshesByBlock.get(firstMeshIndex);
    const hitboxMeshes = [...(first ? [first] : []), ...externalMeshes];
    return ParticleModel.fromModelData(modelData, hitboxMeshes, bounds ?? { min: Vector3.zero, max: Vector3.zero }).serialize();
}

/** The MDAT blocks `buildParticleModel` reads: the first one and those of the most detailed level. */
export function neededMeshBlocks(plan: ModelBlockPlan, modelData: KVObject, ctrl: KVObject | null): ResourceBlock[] {
    const wanted = new Set(embeddedMeshBlocksForLod(modelData, ctrl));
    if (plan.meshes[0]) wanted.add(plan.meshes[0].index);
    return plan.meshes.filter((block) => wanted.has(block.index));
}

/** Attachment(KVObject) for every attachment of a mesh, in stored order, with all of its influences. */
export function parseAttachments(mesh: KVObject): BundleAttachment[] {
    const attachments: BundleAttachment[] = [];
    for (const entry of (getArray(mesh, 'm_attachments') ?? []).filter(isCollection)) {
        const value = isCollection(entry.value ?? null) ? entry.value as KVObject : entry;
        const count = Math.max(0, Math.min(8, Number(value.m_nInfluences ?? 0) || 0));
        const names = getArray(value, 'm_influenceNames') ?? [];
        const offsets = getArray(value, 'm_vInfluenceOffsets') ?? [];
        const rotations = getArray(value, 'm_vInfluenceRotations') ?? [];
        const weights = getArray(value, 'm_influenceWeights') ?? [];
        const roots = getArray(value, 'm_bInfluenceRootTransform');
        const four = (v: unknown): [number, number, number, number] => Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0, Number(v[3] ?? 1)] : [0, 0, 0, 1];
        attachments.push({
            name: getString(value, 'm_name') ?? '',
            ignoreRotation: value.m_bIgnoreRotation === true,
            influences: Array.from({ length: count }, (_, i) => ({
                bone: typeof names[i] === 'string' ? names[i] as string : '',
                offset: ((v) => [v.x, v.y, v.z] as [number, number, number])(vectorOf(offsets[i])),
                rotation: four(rotations[i]),
                weight: Number(weights[i] ?? 0),
                rootTransform: roots !== null && roots[i] === true,
            })),
        });
    }
    return attachments;
}

/** The whole description with a synchronous decoder, for dev scripts. */
export function readParticleModelSync(bytes: Buffer, decode: (resource: Buffer) => KVObject, loadExternal: (path: string) => KVObject | null = () => null): SerializedParticleModel {
    const plan = planModelBlocks(bytes);
    const data = decode(plan.data.resource);
    const ctrl = plan.ctrl ? decode(plan.ctrl.resource) : null;
    const meshes = new Map(neededMeshBlocks(plan, data, ctrl).map((block) => [block.index, decode(block.resource)] as const));
    const load = (paths: string[]) => paths.map(loadExternal).filter((mesh): mesh is KVObject => mesh !== null);
    return buildParticleModel(data, ctrl, plan.meshes[0]?.index ?? null, meshes, load(externalMeshPaths(data, false)), load(externalMeshPaths(data, true)));
}

/** The whole description with an asynchronous decoder, decoding the mesh blocks `concurrency` at a time. */
export async function readParticleModel(
    bytes: Buffer,
    decode: (resource: Buffer) => Promise<KVObject>,
    loadExternal: (path: string) => Promise<KVObject | null> = async () => null,
    concurrency = 8,
): Promise<{ model: SerializedParticleModel; attachments: BundleAttachment[] }> {
    const plan = planModelBlocks(bytes);
    const [data, ctrl] = await Promise.all([decode(plan.data.resource), plan.ctrl ? decode(plan.ctrl.resource) : Promise.resolve(null)]);
    const needed = neededMeshBlocks(plan, data, ctrl);
    const decoded = new Map<number, KVObject>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, needed.length) }, async () => {
        while (next < needed.length) {
            const block = needed[next++];
            decoded.set(block.index, await decode(block.resource));
        }
    }));
    const load = async (paths: string[]) => (await Promise.all(paths.map(loadExternal))).filter((mesh): mesh is KVObject => mesh !== null);
    const external = await load(externalMeshPaths(data, false));
    const model = buildParticleModel(data, ctrl, plan.meshes[0]?.index ?? null, decoded, external, await load(externalMeshPaths(data, true)));
    // Model.Read takes the first mesh block's attachments, SetExternalMeshData a referenced mesh's while there are none
    let attachments = plan.meshes[0] ? parseAttachments(decoded.get(plan.meshes[0].index)!) : [];
    for (const mesh of external) {
        if (attachments.length === 0) attachments = parseAttachments(mesh);
    }
    return { model, attachments };
}
