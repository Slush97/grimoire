// Reads the models C_OP_RenderModels draws into the particle bundle (src/lib/particles/render/
// particleModels.ts): the meshes through the bundled vpkmerge's glTF export, read back to Source model
// space, with the flags and material groups of the model's own data. Node only, no Electron.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { type KVObject, getArray, getString, getSubCollection, isCollection } from '../../../src/lib/particles/kv';
import type { ParticleModelMesh, ParticleModelPrimitive } from '../../../src/lib/particles/render/particleModels';
import type { PackageStack, VpkmergeRunner } from './heroParticleSources';

/** The most vertices a particle model may carry into the bundle. */
const MAX_MODEL_VERTICES = 65536;

interface GltfAccessor { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }
interface GltfBufferView { byteOffset?: number; byteLength: number; byteStride?: number }
interface GltfNode { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface GltfPrimitive { attributes: Record<string, number>; indices?: number; mode?: number; material?: number }
interface Gltf { accessors: GltfAccessor[]; bufferViews: GltfBufferView[]; nodes: GltfNode[]; meshes: { primitives: GltfPrimitive[] }[]; materials?: { extras?: { morphic?: { source_material?: string } } }[]; scenes?: { nodes: number[] }[]; scene?: number }

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** One accessor's values as floats (or integers for indices), normalized integer formats scaled to 0..1. */
function readAccessor(gltf: Gltf, bin: Buffer, index: number): Float64Array {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView ?? 0];
  const components = COMPONENTS[accessor.type] ?? 1;
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType] ?? 4;
  const stride = view.byteStride ?? size * components;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float64Array(accessor.count * components);
  const scale = accessor.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[accessor.componentType] ?? 1 : 1;

  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * size;
      let value: number;
      switch (accessor.componentType) {
        case 5120: value = bin.readInt8(at); break;
        case 5121: value = bin.readUInt8(at); break;
        case 5122: value = bin.readInt16LE(at); break;
        case 5123: value = bin.readUInt16LE(at); break;
        case 5125: value = bin.readUInt32LE(at); break;
        default: value = bin.readFloatLE(at);
      }
      out[i * components + c] = value / scale;
    }
  }

  return out;
}

/** A node's local matrix, column-major as glTF stores it. */
function localMatrix(node: GltfNode): number[] {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/**
 * The meshes of a vpkmerge glTF export in Source model space: each node's world transform, then the
 * export's Source-to-glTF conversion undone (glTF X, Y, Z are Source Y, Z, X, in metres).
 */
export function readGlbMeshes(glb: Buffer): ParticleModelPrimitive[] {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a binary glTF.');
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLength;
  const bin = glb.subarray(binStart + 8, binStart + 8 + glb.readUInt32LE(binStart));
  const primitives: ParticleModelPrimitive[] = [];
  const toSource = (x: number, y: number, z: number): [number, number, number] => [z / 0.0254, x / 0.0254, y / 0.0254];

  const visit = (index: number, parent: number[]) => {
    const node = gltf.nodes[index];
    const world = multiply(parent, localMatrix(node));

    for (const primitive of node.mesh === undefined ? [] : gltf.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION === undefined) continue;
      const raw = readAccessor(gltf, bin, primitive.attributes.POSITION);
      const count = raw.length / 3;
      const positions = new Float32Array(raw.length);
      for (let i = 0; i < count; i++) {
        const [x, y, z] = [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]];
        positions.set(toSource(world[0] * x + world[4] * y + world[8] * z + world[12], world[1] * x + world[5] * y + world[9] * z + world[13],
          world[2] * x + world[6] * y + world[10] * z + world[14]), i * 3);
      }

      let normals: Float32Array | null = null;
      if (primitive.attributes.NORMAL !== undefined) {
        const n = readAccessor(gltf, bin, primitive.attributes.NORMAL);
        normals = new Float32Array(n.length);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]];
          const v = toSource(world[0] * x + world[4] * y + world[8] * z, world[1] * x + world[5] * y + world[9] * z, world[2] * x + world[6] * y + world[10] * z);
          const length = Math.hypot(...v) || 1;
          normals.set(v.map((c) => c / length), i * 3);
        }
      }

      const floats = (name: string) => (primitive.attributes[name] === undefined ? null : Float32Array.from(readAccessor(gltf, bin, primitive.attributes[name])));
      const colors = floats('COLOR_0');
      primitives.push({
        material: primitive.material === undefined ? null : gltf.materials?.[primitive.material]?.extras?.morphic?.source_material ?? null,
        positions, normals, uvs: floats('TEXCOORD_0'), uvs2: floats('TEXCOORD_1'),
        // Colours of three components take an opaque alpha
        colors: colors !== null && colors.length === count * 3 ? Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 === 3 ? 1 : colors[(i >> 2) * 3 + (i % 4)])) : colors,
        indices: primitive.indices === undefined ? null : Uint32Array.from(readAccessor(gltf, bin, primitive.indices)),
      });
    }

    for (const child of node.children ?? []) visit(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(root, identity);
  return primitives;
}

/** Exports `modelEntry` (`models/...vmdl_c`) through the package stack, highest priority owner first. */
export async function exportParticleModelMesh(stack: PackageStack, vpkmerge: VpkmergeRunner, modelEntry: string, scratchDir: string): Promise<ParticleModelMesh> {
  const owner = stack.owner(modelEntry);
  if (!owner) throw new Error(`${modelEntry} is not in any mounted package.`);
  const data = (await stack.decode(modelEntry)) as KVObject;
  const base = stack.packages.find((vpk) => /citadel[\\/]pak01_dir\.vpk$/i.test(vpk) && vpk !== owner);

  await fs.mkdir(scratchDir, { recursive: true });
  const out = join(scratchDir, `model-${process.pid}-${Date.now()}.glb`);
  try {
    // The textures are not read: an override material or the model's own material draws the mesh
    await vpkmerge.stdout(['model', 'export', '--vpk', owner, '--entry', modelEntry, ...(base ? ['--base', base] : []), '--no-anim', '--max-texture', '16', '--out', out]);
    const primitives = readGlbMeshes(await fs.readFile(out));
    const vertices = primitives.reduce((sum, primitive) => sum + primitive.positions.length / 3, 0);
    if (vertices > MAX_MODEL_VERTICES) throw new Error(`${modelEntry} has ${vertices} vertices, over the ${MAX_MODEL_VERTICES} a particle model may carry.`);

    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const primitive of primitives) {
      for (let i = 0; i < primitive.positions.length; i++) {
        min[i % 3] = Math.min(min[i % 3], primitive.positions[i]);
        max[i % 3] = Math.max(max[i % 3], primitive.positions[i]);
      }
    }

    const modelInfo = getSubCollection(data, 'm_modelInfo') ?? {};
    return {
      name: modelEntry.replace(/_c$/, ''),
      primitives,
      bounds: vertices > 0 ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] },
      flags: Number(modelInfo.m_nFlags ?? 0) | 0,
      materialGroups: (getArray(data, 'm_materialGroups') ?? []).filter(isCollection).map((group) => getString(group, 'm_name') ?? ''),
    };
  } finally {
    await fs.rm(out, { force: true });
  }
}
