/**
 * Detects a UI graph pose staged for the game's own menu scene. Graves' shop
 * state moves the spectral hand's arm chain about fifty game units off its
 * weapon bone and lays it on the shop floor; Rem's sits him on a seat the
 * preview does not have, legs splayed in the air. As a standalone preview these
 * read as a dropped hand or a floating hero. Parts moved far below the hero are
 * an authored hide and do not count.
 *
 * It also measures how far a clip moves the hero's floor contact, so the viewer
 * can stand a figure that a UI clip lowers through the floor back on it.
 *
 * Works on the exported GLB data alone: rest transforms, skin weights and the
 * clip's node channels. No renderer is needed in the main process.
 */

type Vec3 = [number, number, number];
type Mat4 = Float64Array;

interface GltfNode { name?: string; children?: number[]; mesh?: number; skin?: number;
    translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }
interface GltfAccessor { bufferView?: number; byteOffset?: number; componentType: number; count: number;
    type: string; normalized?: boolean; sparse?: unknown }
interface Gltf {
    nodes?: GltfNode[]; scenes?: { nodes?: number[] }[]; scene?: number;
    skins?: { joints: number[] }[];
    meshes?: { primitives: { attributes: Record<string, number> }[] }[];
    accessors?: GltfAccessor[];
    bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
    animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[];
        samplers: { input: number; output: number; interpolation?: string }[] }[];
}
interface Glb { json: Gltf; bin: Buffer }

/** Growth of a bone's distance from its parent, as a fraction of hero height. */
const DETACH_FRACTION = 0.25;
/** Floor band above the model origin, as a fraction of hero height. */
const FLOOR_FRACTION = 0.1;
/** Weights below this do not visibly attach geometry to a bone. */
const MIN_WEIGHT = 0.05;
/** Bones resting within this band of the origin in the rest pose touch the floor, as fractions of hero height. */
const CONTACT_BELOW = 0.02;
const CONTACT_ABOVE = 0.05;
/** A clip that keeps every floor contact this far up (a fraction of hero height) holds the hero off the floor. */
const LIFT_FRACTION = 0.08;
/** Bones moved this far below their rest height (a fraction of hero height) are hidden, not standing. */
const HIDE_FRACTION = 0.25;
/** Floor offsets within this fraction of hero height are noise. */
const FLOOR_TOLERANCE = 0.005;
const SAMPLES = 8;

export function parseGlb(bytes: Buffer): Glb | null {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) return null;
    const end = 20 + bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.toString('utf8', 20, end)) as Gltf;
    const bin = end + 8 <= bytes.length && bytes.readUInt32LE(end + 4) === 0x004e4942
        ? bytes.subarray(end + 8, end + 8 + bytes.readUInt32LE(end)) : Buffer.alloc(0);
    return { json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(glb: Glb, index: number): { values: Float64Array; size: number } | null {
    const accessor = glb.json.accessors?.[index];
    const size = accessor ? COMPONENTS[accessor.type] : undefined;
    if (!accessor || !size || accessor.sparse || accessor.bufferView === undefined) return null;
    const view = glb.json.bufferViews?.[accessor.bufferView];
    if (!view) return null;
    const bytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
    if (!bytes) return null;
    const stride = view.byteStride || bytes * size;
    const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (base + stride * (accessor.count - 1) + bytes * size > glb.bin.length) return null;
    const values = new Float64Array(accessor.count * size);
    for (let i = 0; i < accessor.count; i++) {
        for (let c = 0; c < size; c++) {
            const at = base + i * stride + c * bytes;
            let value: number;
            switch (accessor.componentType) {
                case 5120: value = glb.bin.readInt8(at); if (accessor.normalized) value = Math.max(value / 127, -1); break;
                case 5121: value = glb.bin.readUInt8(at); if (accessor.normalized) value /= 255; break;
                case 5122: value = glb.bin.readInt16LE(at); if (accessor.normalized) value = Math.max(value / 32767, -1); break;
                case 5123: value = glb.bin.readUInt16LE(at); if (accessor.normalized) value /= 65535; break;
                case 5125: value = glb.bin.readUInt32LE(at); break;
                default: value = glb.bin.readFloatLE(at);
            }
            values[i * size + c] = value;
        }
    }
    return { values, size };
}

function compose(t: readonly number[], r: readonly number[], s: readonly number[]): Mat4 {
    const [x, y, z, w] = r;
    const m = new Float64Array(16);
    m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = 2 * (x * y + z * w) * s[0]; m[2] = 2 * (x * z - y * w) * s[0];
    m[4] = 2 * (x * y - z * w) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = 2 * (y * z + x * w) * s[1];
    m[8] = 2 * (x * z + y * w) * s[2]; m[9] = 2 * (y * z - x * w) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Float64Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
        }
    }
    return out;
}

interface Trs { t: number[]; r: number[]; s: number[]; matrix?: Mat4 }

function restPose(nodes: readonly GltfNode[]): Trs[] {
    return nodes.map((node) => ({
        t: node.translation ?? [0, 0, 0], r: node.rotation ?? [0, 0, 0, 1], s: node.scale ?? [1, 1, 1],
        ...(node.matrix?.length === 16 ? { matrix: Float64Array.from(node.matrix) } : {}),
    }));
}

/** World-space translation of every node, from scene roots. */
function worldPositions(json: Gltf, pose: readonly Trs[]): (Vec3 | undefined)[] {
    const nodes = json.nodes ?? [];
    const out: (Vec3 | undefined)[] = new Array(nodes.length);
    const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    const visit = (index: number, parent: Mat4 | null) => {
        const local = pose[index].matrix ?? compose(pose[index].t, pose[index].r, pose[index].s);
        const world = parent ? multiply(parent, local) : local;
        out[index] = [world[12], world[13], world[14]];
        for (const child of nodes[index]?.children ?? []) visit(child, world);
    };
    for (const root of roots) visit(root, null);
    return out;
}

function sampleChannel(times: Float64Array, output: { values: Float64Array; size: number }, interpolation: string, time: number): number[] {
    const width = interpolation === 'CUBICSPLINE' ? output.size * 3 : output.size;
    const offset = interpolation === 'CUBICSPLINE' ? output.size : 0;
    const key = (i: number) => Array.from(output.values.subarray(i * width + offset, i * width + offset + output.size));
    if (time <= times[0]) return key(0);
    const last = times.length - 1;
    if (time >= times[last]) return key(last);
    let i = 0;
    while (i < last && times[i + 1] < time) i++;
    if (interpolation === 'STEP') return key(i);
    const a = key(i), b = key(i + 1);
    const f = (time - times[i]) / Math.max(times[i + 1] - times[i], 1e-9);
    if (output.size === 4) {
        // Normalized lerp along the short arc is enough to locate a bone.
        const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
        const q = a.map((v, c) => v + (b[c] * sign - v) * f);
        const length = Math.hypot(...q) || 1;
        return q.map((v) => v / length);
    }
    return a.map((v, c) => v + (b[c] - v) * f);
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface ClipSampler {
    parent: Map<number, number>;
    joints: Set<number>;
    weighted: Set<number>;
    restWorld: (Vec3 | undefined)[];
    /** Span of the weighted bones' rest heights. */
    height: number;
    /** World position of every node `k / SAMPLES` of the way through the clip. */
    sample(k: number): (Vec3 | undefined)[];
}

/** Samples `clipName` (in `animation`, bound by node name like GLTFLoader) on the model's skeleton. */
function clipSampler(model: Glb, animation: Glb, clipName: string): ClipSampler | null {
    const nodes = model.json.nodes ?? [];
    const clip = animation.json.animations?.find((entry) => entry.name === clipName);
    if (!clip || !nodes.length) return null;

    const parent = new Map<number, number>();
    nodes.forEach((node, index) => node.children?.forEach((child) => parent.set(child, index)));
    const joints = new Set((model.json.skins ?? []).flatMap((skin) => skin.joints));
    const weighted = new Set<number>();
    for (const node of nodes) {
        if (node.mesh === undefined || node.skin === undefined) continue;
        const skinJoints = model.json.skins?.[node.skin]?.joints ?? [];
        for (const primitive of model.json.meshes?.[node.mesh]?.primitives ?? []) {
            const ids = primitive.attributes.JOINTS_0 !== undefined ? readAccessor(model, primitive.attributes.JOINTS_0) : null;
            const weights = primitive.attributes.WEIGHTS_0 !== undefined ? readAccessor(model, primitive.attributes.WEIGHTS_0) : null;
            if (!ids || !weights) continue;
            for (let i = 0; i < ids.values.length; i++) {
                if (weights.values[i] > MIN_WEIGHT && skinJoints[ids.values[i]] !== undefined) weighted.add(skinJoints[ids.values[i]]);
            }
        }
    }

    const rest = restPose(nodes);
    const restWorld = worldPositions(model.json, rest);
    const heights = [...weighted].map((index) => restWorld[index]?.[1]).filter((y): y is number => y !== undefined);
    const height = Math.max(...heights) - Math.min(...heights);
    if (!(height > 0)) return null;

    const byName = new Map<string, number>();
    nodes.forEach((node, index) => { if (node.name && !byName.has(node.name)) byName.set(node.name, index); });
    const channels = clip.channels.flatMap((channel) => {
        const sampler = clip.samplers[channel.sampler];
        const name = animation.json.nodes?.[channel.target.node ?? -1]?.name;
        const target = name === undefined ? undefined : byName.get(name);
        if (!sampler || target === undefined || !['translation', 'rotation', 'scale'].includes(channel.target.path)) return [];
        const input = readAccessor(animation, sampler.input), output = readAccessor(animation, sampler.output);
        return input && output && input.values.length ? [{ target, path: channel.target.path as 'translation' | 'rotation' | 'scale',
            times: input.values, output, interpolation: sampler.interpolation ?? 'LINEAR' }] : [];
    });
    if (!channels.length) return null;
    const duration = Math.max(...channels.map((channel) => channel.times[channel.times.length - 1]));

    return { parent, joints, weighted, restWorld, height, sample: (k) => {
        const pose = rest.map((trs) => ({ ...trs }));
        for (const channel of channels) {
            const value = sampleChannel(channel.times, channel.output, channel.interpolation, duration * k / SAMPLES);
            const trs = pose[channel.target];
            delete trs.matrix;
            if (channel.path === 'translation') trs.t = value; else if (channel.path === 'rotation') trs.r = value; else trs.s = value;
        }
        return worldPositions(model.json, pose);
    } };
}

/** A weighted bone pulled far from its parent and left on the floor, within view. */
function partOnFloor({ parent, joints, weighted, restWorld, height, sample }: ClipSampler): boolean {
    const bones = [...weighted].filter((index) => joints.has(parent.get(index) ?? -1));
    const restLength = new Map(bones.map((index) => {
        const a = restWorld[index], b = restWorld[parent.get(index) ?? -1];
        return [index, a && b ? distance(a, b) : 0];
    }));
    for (let k = 0; k <= SAMPLES; k++) {
        const world = sample(k);
        for (const index of bones) {
            const at = world[index], from = world[parent.get(index) ?? -1];
            if (!at || !from) continue;
            if (distance(at, from) - (restLength.get(index) ?? 0) > DETACH_FRACTION * height
                && at[1] < FLOOR_FRACTION * height && at[1] > -height) return true;
        }
    }
    return false;
}

/**
 * How far the clip moves the hero's floor contact from where the rest pose has it, in model
 * units: the lowest that the bones resting on the floor in the rest pose (soles, toes, a grounded
 * prop) come relative to their rest heights, over the whole clip. A Source model stands on its
 * origin, but a UI clip can lower the whole figure (feet through the floor) or hold it up (seated
 * on, or flying over, the menu's own set). Bones sent far below are an authored hide and do not
 * count. Null when nothing rests on the floor.
 */
function floorOffset({ weighted, restWorld, height, sample }: ClipSampler): number | null {
    const contacts = [...weighted].filter((index) => {
        const y = restWorld[index]?.[1];
        return y !== undefined && y >= -CONTACT_BELOW * height && y <= CONTACT_ABOVE * height;
    });
    if (!contacts.length) return null;
    let lowest = Number.POSITIVE_INFINITY;
    for (let k = 0; k <= SAMPLES; k++) {
        const world = sample(k);
        for (const index of contacts) {
            const at = world[index], from = restWorld[index];
            if (!at || !from) continue;
            const lift = at[1] - from[1];
            if (lift > -HIDE_FRACTION * height) lowest = Math.min(lowest, lift);
        }
    }
    return Number.isFinite(lowest) ? lowest : null;
}

/**
 * True when `clipName` stages the hero for the menu's own scene instead of standing it on the
 * floor: it pulls a weighted bone far from its parent and lays it on the floor in view, or it
 * keeps every floor contact well above where the hero's `standing` idle does (a hero that hovers
 * in every pose, such as Solomon, is not staged by hovering) for the whole clip. Unreadable data
 * returns false so the graph default is kept.
 */
export function stagesPose(model: Glb, animation: Glb, clipName: string, standing?: string): boolean {
    const sampler = clipSampler(model, animation, clipName);
    if (!sampler) return false;
    if (partOnFloor(sampler)) return true;
    const offset = floorOffset(sampler);
    const reference = standing ? clipSampler(model, animation, standing) : null;
    const hover = reference ? Math.max(0, floorOffset(reference) ?? 0) : 0;
    return offset !== null && offset - hover > LIFT_FRACTION * sampler.height;
}

/** How far `clipName` moves the hero's floor contact from the rest pose's, in model units
 * (negative lowers it). Null when the clip or skeleton cannot be read. */
export function clipFloorOffset(model: Glb, animation: Glb, clipName: string): number | null {
    const sampler = clipSampler(model, animation, clipName);
    const offset = sampler ? floorOffset(sampler) : null;
    return offset === null || !sampler ? null : Math.abs(offset) < FLOOR_TOLERANCE * sampler.height ? 0 : offset;
}
