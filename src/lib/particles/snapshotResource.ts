// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Resource/Blocks/ParticleSnapshot.cs and
// ValveResourceFormat/Compression/BlockCompress.cs.
//
// Reads a compiled particle snapshot (.vsnap_c): the DATA block describes the attributes and the
// block compressed SNAP block holds their rows, one attribute after another. The DATA block arrives
// decoded to JSON (as the app decodes every KV3 block); the SNAP block is read here.

import { type KVObject, getArray, getString, isCollection } from './kv';
import type { ParticleSnapshot, SnapshotAttribute, SnapshotColumnData, SnapshotSkinning } from './utils/snapshotBinding';

/** The resource header's block table, as `Resource.Read` walks it. */
export function findResourceBlock(bytes: Uint8Array, type: string): Uint8Array | null {
  if (bytes.length < 16) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableStart = 8 + view.getUint32(8, true);
  const count = view.getUint32(12, true);

  for (let i = 0; i < count; i++) {
    const header = tableStart + i * 12;

    if (header + 12 > bytes.length) {
      return null;
    }

    const name = String.fromCharCode(bytes[header], bytes[header + 1], bytes[header + 2], bytes[header + 3]);

    if (name !== type) {
      continue;
    }

    const offset = header + 4 + view.getUint32(header + 4, true);
    const size = view.getUint32(header + 8, true);

    if (offset + size > bytes.length) {
      throw new RangeError(`Resource block ${type} is outside of the file.`);
    }

    return bytes.subarray(offset, offset + size);
  }

  return null;
}

/** BlockCompress.GetDecompressedSize and FastDecompress over a whole block. */
export function blockDecompress(input: Uint8Array): Uint8Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const declared = view.getUint32(0, true);

  // Valve sets the fourth byte to 0x80 for data stored uncompressed
  if (declared > 0x7fffffff) {
    const size = declared & 0x7fffffff;

    if (4 + size > input.length) {
      throw new RangeError('Block compressed data is truncated.');
    }

    return input.slice(4, 4 + size);
  }

  const size = declared;
  const result = new Uint8Array(size);
  let inputPosition = 4;
  let position = 0;
  let blockMask = 0;
  let i = 0;

  const readUInt16 = (): number => {
    if (input.length - inputPosition < 2) {
      throw new RangeError('Block compressed data is truncated.');
    }

    const value = view.getUint16(inputPosition, true);
    inputPosition += 2;
    return value;
  };

  while (position < size) {
    if (i === 0) {
      blockMask = readUInt16();
      i = 16;
    }

    if ((blockMask & 1) > 0) {
      const offsetSize = readUInt16();
      const offset = (offsetSize >> 4) + 1;
      const length = (offsetSize & 0xf) + 3;

      if (offset > position || length > size - position) {
        throw new RangeError('Block compressed back reference is outside of the output.');
      }

      // A back reference shorter than its distance copies as one block, else byte by byte
      for (let j = 0; j < length; j++) {
        result[position + j] = result[position - offset + j];
      }

      position += length;
    } else {
      if (inputPosition >= input.length) {
        throw new RangeError('Block compressed data is truncated.');
      }

      result[position++] = input[inputPosition++];
    }

    blockMask >>= 1;
    i--;
  }

  return result;
}

/** The most rows a snapshot is read with; larger counts are refused rather than allocated. */
const MAX_SNAPSHOT_ROWS = 1 << 20;

/**
 * Reads a compiled snapshot from its file bytes and its decoded DATA block. Attributes are read in
 * order from the start of the decompressed SNAP block, as VRF reads them; their recorded offsets are
 * not consulted.
 */
export function readSnapshotResource(fileBytes: Uint8Array, data: KVObject): ParticleSnapshot {
  const block = findResourceBlock(fileBytes, 'SNAP');

  if (block === null) {
    throw new Error('Particle snapshot has no SNAP block.');
  }

  return readSnapshotBlock(blockDecompress(block), data);
}

/** Reads the decompressed SNAP rows described by the DATA block. */
export function readSnapshotBlock(rows: Uint8Array, data: KVObject): ParticleSnapshot {
  const numParticles = Number(data.num_particles ?? 0);

  if (!Number.isInteger(numParticles) || numParticles < 0 || numParticles > MAX_SNAPSHOT_ROWS) {
    throw new RangeError(`Unsupported snapshot row count ${String(data.num_particles)}.`);
  }

  const stringList = (getArray(data, 'string_list') ?? []).map((value) => (typeof value === 'string' ? value : ''));
  const view = new DataView(rows.buffer, rows.byteOffset, rows.byteLength);
  let position = 0;

  const need = (bytes: number) => {
    if (position + bytes > rows.length) {
      throw new RangeError('Unable to read beyond end of stream.');
    }
  };

  const readStringArray = (): string[] => {
    need(numParticles * 4);
    const result: string[] = [];

    for (let i = 0; i < numParticles; i++) {
      const index = view.getInt32(position, true);
      position += 4;
      result.push(index < stringList.length && index >= 0 ? stringList[index] : `${index} <INVALID: string not in DATA string list>`);
    }

    return result;
  };

  const readSkinning = (): SnapshotSkinning[] => {
    need(numParticles * 24);
    const result: SnapshotSkinning[] = [];

    for (let i = 0; i < numParticles; i++) {
      const jointNames: string[] = [];

      for (let j = 0; j < 4; j++) {
        const index = view.getInt16(position, true);
        position += 2;

        if (index < 0 || index >= stringList.length) {
          throw new RangeError('Index was outside the bounds of the array.');
        }

        jointNames.push(stringList[index]);
      }

      const weights = new Float32Array(4);

      for (let j = 0; j < 4; j++) {
        weights[j] = view.getFloat32(position, true);
        position += 4;
      }

      result.push({ jointNames, weights });
    }

    return result;
  };

  const readFloats = (components: number): Float32Array => {
    need(numParticles * components * 4);
    const result = new Float32Array(numParticles * components);

    for (let i = 0; i < result.length; i++) {
      result[i] = view.getFloat32(position, true);
      position += 4;
    }

    return result;
  };

  const readInts = (): Int32Array => {
    need(numParticles * 4);
    const result = new Int32Array(numParticles);

    for (let i = 0; i < result.length; i++) {
      result[i] = view.getInt32(position, true);
      position += 4;
    }

    return result;
  };

  const columns: SnapshotAttribute[] = [];

  for (const attribute of getArray(data, 'attributes') ?? []) {
    if (!isCollection(attribute)) {
      continue;
    }

    const name = getString(attribute, 'name') ?? '';
    const type = getString(attribute, 'type') ?? '';
    let column: SnapshotColumnData;

    switch (type) {
      case 'skinning':
        column = { kind: 'skinning', values: readSkinning() };
        break;
      case 'string':
      case 'bone':
        column = { kind: 'string', values: readStringArray() };
        break;
      case 'float3':
      case 'vector':
        column = { kind: 'vector', values: readFloats(3) };
        break;
      case 'float':
        column = { kind: 'float', values: readFloats(1) };
        break;
      case 'int':
        column = { kind: 'int', values: readInts() };
        break;
      default:
        throw new Error(`Unsupported SNAP array type ${type}.`);
    }

    if (columns.some((existing) => existing.name === name && existing.type === type)) {
      throw new Error(`An item with the same key has already been added. Key: (${name}, ${type})`);
    }

    columns.push({ name, type, data: column });
  }

  return snapshotFromColumns(numParticles, columns);
}

/** A snapshot over typed columns, with the plain numeric view the emitters read. */
export function snapshotFromColumns(numParticles: number, columns: readonly SnapshotAttribute[]): ParticleSnapshot {
  const attributes = new Map<string, ArrayLike<number>>();
  const seen = new Set<string>();

  // ResolveAttribute takes the first attribute of a name; only a scalar column reads as numbers
  for (const { name, data } of columns) {
    if (seen.has(name)) {
      continue;
    }

    seen.add(name);

    if (data.kind === 'float' || data.kind === 'int') {
      attributes.set(name, data.values);
    }
  }

  return { numParticles, serial: 0, attributes, columns };
}

/** A snapshot as the hero particle bundle stores it: JSON numbers and strings, columns in order. */
export interface SerializedSnapshot {
  numParticles: number;
  columns: { name: string; type: string; kind: SnapshotColumnData['kind']; values: number[] | readonly string[] | { jointNames: readonly string[]; weights: number[] }[] }[];
}

export function serializeSnapshot(snapshot: ParticleSnapshot): SerializedSnapshot {
  return {
    numParticles: snapshot.numParticles,
    columns: (snapshot.columns ?? []).map(({ name, type, data }) => ({
      name,
      type,
      kind: data.kind,
      values: data.kind === 'skinning'
        ? data.values.map(({ jointNames, weights }) => ({ jointNames, weights: Array.from(weights) }))
        : data.kind === 'string' ? data.values : Array.from(data.values),
    })),
  };
}

export function deserializeSnapshot(serialized: SerializedSnapshot): ParticleSnapshot {
  const columns: SnapshotAttribute[] = serialized.columns.map(({ name, type, kind, values }) => {
    switch (kind) {
      case 'skinning':
        return { name, type, data: { kind, values: (values as { jointNames: string[]; weights: number[] }[]).map((row) => ({ jointNames: row.jointNames, weights: Float32Array.from(row.weights) })) } };
      case 'string':
        return { name, type, data: { kind, values: values as string[] } };
      case 'int':
        return { name, type, data: { kind, values: Int32Array.from(values as number[]) } };
      default:
        return { name, type, data: { kind, values: Float32Array.from(values as number[]) } };
    }
  });

  return snapshotFromColumns(serialized.numParticles, columns);
}
