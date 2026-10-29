import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

const index = z.number().int().nonnegative();
const textureInfo = z.object({ index }).passthrough();
const materialSchema = z.object({
    pbrMetallicRoughness: z.object({ baseColorTexture: textureInfo.optional(), metallicRoughnessTexture: textureInfo.optional() }).passthrough().optional(),
    normalTexture: textureInfo.optional(), occlusionTexture: textureInfo.optional(), emissiveTexture: textureInfo.optional(),
    extensions: z.record(z.unknown()).optional(),
    extras: z.object({ morphic: z.object({ shader: z.string(), textures: z.record(index).optional() }).passthrough().optional() }).passthrough().optional(),
}).passthrough();
const documentSchema = z.object({
    buffers: z.array(z.object({ byteLength: index })).max(1).default([]),
    bufferViews: z.array(z.object({ buffer: z.literal(0), byteOffset: index.default(0), byteLength: index, byteStride: index.optional() }).passthrough()).default([]),
    accessors: z.array(z.object({ bufferView: index, byteOffset: index.default(0), componentType: index,
        count: index, type: z.string(), normalized: z.boolean().optional(), min: z.array(z.number()).optional(), max: z.array(z.number()).optional() }).passthrough()).default([]),
    images: z.array(z.object({ bufferView: index, mimeType: z.string() }).passthrough()).default([]),
    samplers: z.array(z.record(z.unknown())).default([]),
    textures: z.array(z.object({ source: index, sampler: index.optional() }).passthrough()).default([]),
    materials: z.array(materialSchema).default([]),
    meshes: z.array(z.object({ primitives: z.array(z.object({ attributes: z.record(index), indices: index.optional(),
        material: index.optional(), targets: z.array(z.record(index)).optional() }).passthrough()) }).passthrough()).default([]),
    nodes: z.array(z.object({ mesh: index.optional(), children: z.array(index).optional() }).passthrough()).default([]),
    scenes: z.array(z.object({ nodes: z.array(index).default([]) })).default([{ nodes: [] }]),
    scene: index.default(0), extensionsUsed: z.array(z.string()).default([]), extensionsRequired: z.array(z.string()).default([]),
    skins: z.array(z.never()).default([]), animations: z.array(z.never()).default([]),
});
type Document = z.infer<typeof documentSchema>;
type Accessor = Document['accessors'][number];
type Material = z.infer<typeof materialSchema>;

function parseGlb(bytes: Buffer): { document: Document; binary: Buffer } {
    if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid static scene GLB.');
    const length = bytes.readUInt32LE(12);
    if (bytes.readUInt32LE(16) !== 0x4e4f534a || length + 28 > bytes.length) throw new Error('Invalid GLB JSON chunk.');
    const binaryLength = bytes.readUInt32LE(20 + length);
    if (bytes.readUInt32LE(24 + length) !== 0x004e4942 || length + 28 + binaryLength !== bytes.length) throw new Error('Invalid GLB binary chunk.');
    return { document: documentSchema.parse(JSON.parse(bytes.toString('utf8', 20, 20 + length))), binary: bytes.subarray(28 + length) };
}

/** Pack only exactly representable integer attributes, then compress losslessly. */
export async function compressHideoutGeometry(bytes: Buffer, compact = true): Promise<Buffer> {
    await MeshoptEncoder.ready;
    const { document, binary } = parseGlb(bytes);
    const images = new Set(document.images.map(image => image.bufferView));
    const chunks: Uint8Array[] = [];
    let offset = 0, fallbackOffset = 0;
    let quantizedNormals = false;
    const semantics = new Map<number, Set<string>>();
    const indexAccessors = new Set<number>();
    for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
        if (primitive.indices !== undefined) indexAccessors.add(primitive.indices);
        for (const [semantic, i] of Object.entries(primitive.attributes)) {
            const names = semantics.get(i) ?? new Set<string>(); names.add(semantic); semantics.set(i, names);
        }
    }
    function append(data: Uint8Array): number {
        const start = offset;
        chunks.push(data);
        const padding = (4 - data.byteLength % 4) % 4;
        if (padding) chunks.push(Buffer.alloc(padding));
        offset += data.byteLength + padding;
        return start;
    }
    const views = document.bufferViews.map((view, i) => {
        let source = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
        const accessors = document.accessors.filter(accessor => accessor.bufferView === i);
        const accessor = accessors[0];
        const indices = document.accessors.some((accessor, index) => accessor.bufferView === i && indexAccessors.has(index));
        const component = accessor?.componentType;
        const components = accessor?.type === 'SCALAR' ? 1 : accessor?.type === 'VEC2' ? 2 : accessor?.type === 'VEC3' ? 3 : accessor?.type === 'VEC4' ? 4 : 0;
        const size = component === 5126 || component === 5125 ? 4 : component === 5123 || component === 5122 ? 2 : 1;
        let stride = view.byteStride ?? components * size;
        if (compact && !images.has(i) && accessor && !accessor.byteOffset && source.length === accessor.count * stride
            && accessors.every(a => a.componentType === component && a.type === accessor.type && a.count === accessor.count && !a.byteOffset)) {
            if (indices && component === 5125) {
                let fits = true;
                for (let n = 0; n < accessor.count; n++) if (source.readUInt32LE(n * 4) > 65535) { fits = false; break; }
                if (fits) {
                    const packed = Buffer.alloc(accessor.count * 2);
                    for (let n = 0; n < accessor.count; n++) packed.writeUInt16LE(source.readUInt32LE(n * 4), n * 2);
                    source = packed; stride = 2; accessors.forEach(a => { a.componentType = 5123; });
                }
            } else if (component === 5126 && stride === components * 4) {
                const names = document.accessors.flatMap((a, index) => a.bufferView === i ? [...(semantics.get(index) ?? [])] : []);
                const normal = names.length > 0 && names.every(name => name === 'NORMAL' || name === 'TANGENT');
                const unsigned = names.length > 0 && names.every(name => name.startsWith('TEXCOORD_') || name.startsWith('COLOR_'));
                const maximum = normal ? 32767 : 65535;
                let fits = normal || unsigned;
                for (let n = 0; fits && n < accessor.count * components; n++) {
                    const value = source.readFloatLE(n * 4);
                    fits = value >= (normal ? -1 : 0) && value <= 1 && Math.fround(Math.round(value * maximum) / maximum) === value;
                }
                if (fits) {
                    const packedStride = Math.ceil(components * 2 / 4) * 4;
                    const packed = Buffer.alloc(accessor.count * packedStride);
                    for (let vertex = 0; vertex < accessor.count; vertex++) for (let c = 0; c < components; c++) {
                        const value = Math.round(source.readFloatLE((vertex * components + c) * 4) * maximum);
                        if (normal) packed.writeInt16LE(value, vertex * packedStride + c * 2);
                        else packed.writeUInt16LE(value, vertex * packedStride + c * 2);
                    }
                    source = packed; stride = packedStride; quantizedNormals ||= normal;
                    for (const a of accessors) {
                        a.componentType = normal ? 5122 : 5123; a.normalized = true;
                        if (a.min) a.min = a.min.map(value => Math.round(value * maximum));
                        if (a.max) a.max = a.max.map(value => Math.round(value * maximum));
                    }
                }
            }
        }
        if (images.has(i) || !accessor || !stride || source.length % stride || (!indices && stride % 4)) {
            return { ...view, byteOffset: append(source) };
        }
        const count = source.length / stride;
        // INDICES retains exact indices, whereas TRIANGLES can rotate a triangle.
        const mode = indices ? 'INDICES' : 'ATTRIBUTES';
        const encoded = MeshoptEncoder.encodeGltfBuffer(source, count, stride, mode);
        const start = append(encoded);
        const fallback = Math.ceil(fallbackOffset / 4) * 4;
        fallbackOffset = fallback + source.length;
        return { ...view, buffer: 1, byteOffset: fallback, byteLength: source.length, ...(indices ? {} : { byteStride: stride }),
            extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: start, byteLength: encoded.length, byteStride: stride, count, mode, filter: 'NONE' } } };
    });
    const compressed = { ...document, asset: { version: '2.0', generator: 'Grimoire lossless scene cache' },
        bufferViews: views, buffers: [{ byteLength: offset }, { byteLength: fallbackOffset, extensions: { EXT_meshopt_compression: { fallback: true } } }],
        extensionsUsed: [...new Set([...document.extensionsUsed, 'EXT_meshopt_compression', ...(quantizedNormals ? ['KHR_mesh_quantization'] : [])])],
        extensionsRequired: [...new Set([...document.extensionsRequired, 'EXT_meshopt_compression', ...(quantizedNormals ? ['KHR_mesh_quantization'] : [])])] };
    const json = Buffer.from(JSON.stringify(compressed));
    const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
    const header = Buffer.alloc(20);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + padding.length + offset, 8);
    header.writeUInt32LE(json.length + padding.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(offset); binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, json, padding, binHeader, ...chunks]);
}

function mapped(table: number[], i: number): number {
    const value = table[i];
    if (value === undefined) throw new Error('Static scene GLB reference is out of range.');
    return value;
}

function extensionTextures(value: unknown, textures: number[]): unknown {
    if (Array.isArray(value)) return value.map(item => extensionTextures(item, textures));
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key.endsWith('Texture')
        ? { ...textureInfo.parse(item), index: mapped(textures, textureInfo.parse(item).index) }
        : extensionTextures(item, textures)]));
}

export interface HideoutBundleJob { dir: string; names: string[]; out: string }

/** Read the exported model GLBs, merge and compress them into `out`. Runs in a
 *  worker thread in the app: the merge and meshopt encode take seconds. */
export async function prepareHideoutBundle(job: HideoutBundleJob): Promise<HideoutBundleStats> {
    const sources = [];
    for (const name of job.names) sources.push({ name, bytes: await fs.readFile(join(job.dir, name)) });
    const prepared = createHideoutBundle(sources);
    const compressed = await compressHideoutGeometry(prepared.bytes);
    await fs.writeFile(`${job.out}.pending`, compressed);
    await fs.rename(`${job.out}.pending`, job.out);
    return { ...prepared.stats, bytes: compressed.length };
}

export interface HideoutBundleStats {
    models: number; materials: number; images: number; textures: number; bytes: number;
}

/** Merge static model resources without changing positions, indices or node transforms.
 * Images, samplers, texture bindings and materials share one table across models.
 * Vertex paint is converted once here instead of on every renderer open. */
export function createHideoutBundle(models: { name: string; bytes: Buffer }[]): { bytes: Buffer; stats: HideoutBundleStats } {
    const views: Document['bufferViews'] = [];
    const accessors: Accessor[] = [];
    const images: Document['images'] = [];
    const samplers: Document['samplers'] = [];
    const textures: Document['textures'] = [];
    const materials: Material[] = [];
    const meshes: Document['meshes'] = [];
    const nodes: Document['nodes'] = [];
    const roots: number[] = [];
    const extensionsUsed = new Set<string>();
    const extensionsRequired = new Set<string>();
    const chunks: Buffer[] = [];
    let binaryLength = 0;
    const viewKeys = new Map<string, number>();
    const imageKeys = new Map<string, number>();
    const samplerKeys = new Map<string, number>();
    const textureKeys = new Map<string, number>();
    const materialKeys = new Map<string, number>();
    function intern<T>(table: T[], keys: Map<string, number>, value: T): number {
        const key = JSON.stringify(value);
        const existing = keys.get(key);
        if (existing !== undefined) return existing;
        keys.set(key, table.length);
        table.push(value);
        return table.length - 1;
    }
    function addView(bytes: Buffer, descriptor: Omit<Document['bufferViews'][number], 'buffer' | 'byteOffset' | 'byteLength'>): number {
        const key = createHash('sha256').update(bytes).digest('hex') + JSON.stringify(descriptor);
        const existing = viewKeys.get(key);
        if (existing !== undefined) return existing;
        const view = views.length;
        viewKeys.set(key, view);
        views.push({ ...descriptor, buffer: 0, byteOffset: binaryLength, byteLength: bytes.length });
        chunks.push(bytes);
        const padding = (4 - bytes.length % 4) % 4;
        if (padding) chunks.push(Buffer.alloc(padding));
        binaryLength += bytes.length + padding;
        return view;
    }
    for (const model of models) {
        const { document: source, binary } = parseGlb(model.bytes);
        source.extensionsUsed.forEach(value => extensionsUsed.add(value));
        source.extensionsRequired.forEach(value => extensionsRequired.add(value));
        const viewMap = new Map<number, number>();
        function addSourceView(i: number): number {
            const existing = viewMap.get(i);
            if (existing !== undefined) return existing;
            const view = source.bufferViews[i];
            if (!view || view.byteOffset + view.byteLength > binary.length) throw new Error('Truncated static scene buffer view.');
            const { buffer: _buffer, byteOffset: _offset, byteLength: _length, ...descriptor } = view;
            const result = addView(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength), descriptor);
            viewMap.set(i, result);
            return result;
        }
        const accessorMap = new Map<string, number>();
        function addAccessor(i: number, paint = false): number {
            const key = `${i}:${paint}`;
            const existing = accessorMap.get(key);
            if (existing !== undefined) return existing;
            const accessor = source.accessors[i];
            if (!accessor) throw new Error('Missing static scene accessor.');
            let prepared: Accessor;
            if (paint) {
                const values = prepareVertexPaint(source, binary, accessor);
                const { min: _min, max: _max, normalized: _normalized, ...rest } = accessor;
                prepared = { ...rest, bufferView: addView(values, { target: 34962 }), byteOffset: 0, componentType: 5126, type: 'VEC4' };
            } else prepared = { ...accessor, bufferView: addSourceView(accessor.bufferView) };
            const result = accessors.length;
            accessors.push(prepared);
            accessorMap.set(key, result);
            return result;
        }
        const imageMap = source.images.map(image => intern(images, imageKeys, { ...image, bufferView: addSourceView(image.bufferView) }));
        const samplerMap = source.samplers.map(sampler => intern(samplers, samplerKeys, sampler));
        const textureMap = source.textures.map(texture => intern(textures, textureKeys, { ...texture, source: mapped(imageMap, texture.source),
            ...(texture.sampler === undefined ? {} : { sampler: mapped(samplerMap, texture.sampler) }) }));
        const materialMap = source.materials.map(original => {
            const material = structuredClone(original);
            const remap = (value: z.infer<typeof textureInfo> | undefined) => value ? { ...value, index: mapped(textureMap, value.index) } : undefined;
            if (material.pbrMetallicRoughness?.baseColorTexture) material.pbrMetallicRoughness.baseColorTexture = remap(material.pbrMetallicRoughness.baseColorTexture);
            if (material.pbrMetallicRoughness?.metallicRoughnessTexture) material.pbrMetallicRoughness.metallicRoughnessTexture = remap(material.pbrMetallicRoughness.metallicRoughnessTexture);
            if (material.normalTexture) material.normalTexture = remap(material.normalTexture);
            if (material.occlusionTexture) material.occlusionTexture = remap(material.occlusionTexture);
            if (material.emissiveTexture) material.emissiveTexture = remap(material.emissiveTexture);
            if (material.extensions) material.extensions = z.record(z.unknown()).parse(extensionTextures(material.extensions, textureMap));
            const extra = material.extras?.morphic;
            if (extra?.textures) extra.textures = Object.fromEntries(Object.entries(extra.textures).map(([slot, i]) => [slot, mapped(textureMap, i)]));
            return intern(materials, materialKeys, material);
        });
        const meshMap = source.meshes.map(mesh => {
            const result = meshes.length;
            meshes.push({ ...mesh, primitives: mesh.primitives.map(primitive => {
                const paint = primitive.material !== undefined && source.materials[primitive.material]?.extras?.morphic?.shader.startsWith('environment_');
                return { ...primitive,
                    attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([semantic, i]) => [semantic, addAccessor(i, semantic === 'COLOR_0' && !!paint)])),
                    ...(primitive.indices === undefined ? {} : { indices: addAccessor(primitive.indices) }),
                    ...(primitive.material === undefined ? {} : { material: mapped(materialMap, primitive.material) }),
                    ...(primitive.targets ? { targets: primitive.targets.map(target => Object.fromEntries(Object.entries(target).map(([semantic, i]) => [semantic, addAccessor(i)]))) } : {}),
                };
            }) });
            return result;
        });
        const nodeOffset = nodes.length;
        for (const node of source.nodes) nodes.push({ ...node,
            ...(node.mesh === undefined ? {} : { mesh: mapped(meshMap, node.mesh) }),
            ...(node.children ? { children: node.children.map(i => {
                if (!source.nodes[i]) throw new Error('Missing static scene child node.');
                return nodeOffset + i;
            }) } : {}),
        });
        const scene = source.scenes[source.scene];
        if (!scene) throw new Error('Missing static model scene.');
        roots.push(nodes.length);
        nodes.push({ name: model.name, extras: { hideoutModel: model.name }, children: scene.nodes.map(i => {
            if (!source.nodes[i]) throw new Error('Missing static scene root node.');
            return nodeOffset + i;
        }) });
    }
    const document = { asset: { version: '2.0', generator: 'Grimoire static scene cache' }, scene: 0, scenes: [{ nodes: roots }], nodes, meshes,
        buffers: [{ byteLength: binaryLength }], bufferViews: views, accessors, images, samplers, textures, materials,
        extensionsUsed: [...extensionsUsed], extensionsRequired: [...extensionsRequired] };
    const json = Buffer.from(JSON.stringify(document));
    const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
    const header = Buffer.alloc(20);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + jsonPadding.length + binaryLength, 8);
    header.writeUInt32LE(json.length + jsonPadding.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binaryLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    const bytes = Buffer.concat([header, json, jsonPadding, binHeader, ...chunks]);
    return { bytes, stats: { models: models.length, materials: materials.length, images: images.length, textures: textures.length, bytes: bytes.length } };
}

function prepareVertexPaint(document: Document, binary: Buffer, accessor: Accessor): Buffer {
    const view = document.bufferViews[accessor.bufferView];
    if (!view || !['VEC3', 'VEC4'].includes(accessor.type)) throw new Error('Invalid vertex paint accessor.');
    const components = accessor.type === 'VEC4' ? 4 : 3;
    const size = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5121 ? 1 : 0;
    if (!size) throw new Error('Unsupported vertex paint component format.');
    const stride = view.byteStride ?? size * components;
    const start = view.byteOffset + accessor.byteOffset;
    if (accessor.count && start + (accessor.count - 1) * stride + components * size > view.byteOffset + view.byteLength) throw new Error('Truncated vertex paint.');
    const read = (offset: number) => size === 4 ? binary.readFloatLE(offset) : size === 2
        ? binary.readUInt16LE(offset) / (accessor.normalized ? 65535 : 1) : binary.readUInt8(offset) / (accessor.normalized ? 255 : 1);
    const linear = (color: number) => color < 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4;
    const result = Buffer.alloc(accessor.count * 16);
    for (let i = 0; i < accessor.count; i++) {
        const offset = start + i * stride;
        const amount = components === 4 ? read(offset + size * 3) : 1;
        for (let c = 0; c < 3; c++) result.writeFloatLE(1 + (linear(read(offset + c * size)) - 1) * amount, i * 16 + c * 4);
        result.writeFloatLE(1, i * 16 + 12);
    }
    return result;
}
