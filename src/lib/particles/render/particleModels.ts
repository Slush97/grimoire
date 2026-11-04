// The models and materials C_OP_RenderModels draws, as a host supplies them: VRF loads them through
// its file loader as Model and Material resources; here the data side reads them once and hands the
// renderer plain arrays (see renderModels.ts). Pure, no DOM.

/** One draw of a model: a triangle list in model space, Source units. */
export interface ParticleModelPrimitive {
  /** The draw's own compiled material path, before a renderer applies an override. */
  material?: string | null;
  positions: Float32Array;
  normals: Float32Array | null;
  /** UV1, two floats per vertex. */
  uvs: Float32Array | null;
  /** UV2, two floats per vertex. */
  uvs2: Float32Array | null;
  /** Vertex colours, four floats per vertex, gamma encoded as stored. */
  colors: Float32Array | null;
  indices: Uint32Array | null;
}

export interface ParticleModelMesh {
  /** The compiled model path, `models/...vmdl`. */
  name: string;
  primitives: ParticleModelPrimitive[];
  /** The model space bounds of every primitive, for m_bCenterOffset. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** m_modelInfo.m_nFlags. */
  flags: number;
  /** The names of the model's material groups (skins), in order. */
  materialGroups: string[];
}

/** A material as its compiled resource lists it (`m_shaderName`, the int, float, vector and texture params). */
export interface ParticleMaterialData {
  name: string;
  shader: string;
  intParams: Record<string, number>;
  floatParams: Record<string, number>;
  vectorParams: Record<string, [number, number, number, number]>;
  /** By param name, the texture path (`materials/...vtex`). */
  textureParams: Record<string, string>;
  /** The material's int attributes (`translucent`, `IgnoreMaterialOverride`, ...). */
  intAttributes: Record<string, number>;
}

export interface ParticleModelSource {
  /** The model a renderer's model list names (`models/x.vmdl`), or null when it is not available. */
  model(path: string): ParticleModelMesh | null;
  /** A material by path (`materials/x.vmat` or `models/.../x.vmat`), or null when it is not available. */
  material(path: string): ParticleMaterialData | null;
}

/** The key a model or material path is stored under: lower case, forward slashes, without `_c`. */
export function particleResourceKey(path: string): string {
  return path.replace(/_c$/, '').replace(/\\/g, '/').toLowerCase();
}

/** A primitive as JSON carries it: every array as base64 of its little-endian bytes. */
export interface SerializedModelPrimitive {
  material?: string | null;
  positions: string;
  normals: string | null;
  uvs: string | null;
  uvs2: string | null;
  colors: string | null;
  indices: string | null;
}

export interface SerializedModelMesh extends Omit<ParticleModelMesh, 'primitives'> {
  primitives: SerializedModelPrimitive[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encode = (values: Float32Array | Uint32Array | null) => (values === null ? null : toBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)));

function floats(text: string | null): Float32Array | null {
  if (text === null) return null;
  const bytes = fromBase64(text);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function serializeModelMesh(mesh: ParticleModelMesh): SerializedModelMesh {
  return {
    ...mesh,
    primitives: mesh.primitives.map((primitive) => ({
      material: primitive.material ?? null,
      positions: encode(primitive.positions)!,
      normals: encode(primitive.normals),
      uvs: encode(primitive.uvs),
      uvs2: encode(primitive.uvs2),
      colors: encode(primitive.colors),
      indices: encode(primitive.indices),
    })),
  };
}

export function deserializeModelMesh(mesh: SerializedModelMesh): ParticleModelMesh {
  return {
    ...mesh,
    primitives: mesh.primitives.map((primitive) => {
      const indexBytes = primitive.indices === null ? null : fromBase64(primitive.indices);
      return {
        material: primitive.material ?? null,
        positions: floats(primitive.positions)!,
        normals: floats(primitive.normals),
        uvs: floats(primitive.uvs),
        uvs2: floats(primitive.uvs2),
        colors: floats(primitive.colors),
        indices: indexBytes === null ? null : new Uint32Array(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength / 4),
      };
    }),
  };
}

/** Reads a compiled material decoded to JSON (`soundevents <x>.vmat_c`) into the params the renderer reads. */
export function readParticleMaterial(data: Record<string, unknown>): ParticleMaterialData {
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : []);
  const named = <T>(key: string, value: (entry: Record<string, unknown>) => T | undefined) => {
    const out: Record<string, T> = {};
    for (const entry of list(key)) {
      const name = typeof entry.m_name === 'string' ? entry.m_name : null;
      const read = value(entry);
      if (name !== null && read !== undefined) out[name] = read;
    }
    return out;
  };
  const number = (key: string) => (entry: Record<string, unknown>) => (typeof entry[key] === 'number' ? (entry[key] as number) : undefined);
  return {
    name: typeof data.m_materialName === 'string' ? data.m_materialName : '',
    shader: typeof data.m_shaderName === 'string' ? data.m_shaderName : '',
    intParams: named('m_intParams', number('m_nValue')),
    floatParams: named('m_floatParams', number('m_flValue')),
    vectorParams: named('m_vectorParams', (entry) => {
      const value = entry.m_value;
      return Array.isArray(value) && value.length >= 4 ? (value.slice(0, 4).map(Number) as [number, number, number, number]) : undefined;
    }),
    textureParams: named('m_textureParams', (entry) => (typeof entry.m_pValue === 'string' ? entry.m_pValue.replace(/\\/g, '/').replace(/_c$/, '') : undefined)),
    intAttributes: named('m_intAttributes', number('m_nValue')),
  };
}
