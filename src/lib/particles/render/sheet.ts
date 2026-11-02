// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Resource/ResourceTypes/Texture.cs
// (the VTEX header, its extra data and SpritesheetData) and Renderer/Renderer/Materials/MaterialLoader.cs
// (which formats have an sRGB variant).
//
// Pure: reads a compiled `.vtex_c` byte buffer, with no texture pixels decoded. The data side calls
// it in the main process and hands the result to the renderer alongside the decoded image.

/** VTexFormat: how a texture's pixels are stored. */
export const VTexFormat = {
  UNKNOWN: 0,
  DXT1: 1,
  DXT5: 2,
  I8: 3,
  RGBA8888: 4,
  R16: 5,
  RG1616: 6,
  RGBA16161616: 7,
  R16F: 8,
  RG1616F: 9,
  RGBA16161616F: 10,
  R32F: 11,
  RG3232F: 12,
  RGB323232F: 13,
  RGBA32323232F: 14,
  JPEG_RGBA8888: 15,
  PNG_RGBA8888: 16,
  JPEG_DXT5: 17,
  PNG_DXT5: 18,
  BC6H: 19,
  BC7: 20,
  ATI2N: 21,
  IA88: 22,
  ETC2: 23,
  ETC2_EAC: 24,
  R11_EAC: 25,
  RG11_EAC: 26,
  ATI1N: 27,
  BGRA8888: 28,
  WEBP_RGBA8888: 29,
  WEBP_DXT5: 30,
  R32_UINT: 31,
  A8: 32,
  R8_UNORM: 33,
} as const;

/** VTexFlags: the texture's sampling hints and kind. */
export const VTexFlags = {
  SUGGEST_CLAMPS: 1 << 0,
  SUGGEST_CLAMPT: 1 << 1,
  SUGGEST_CLAMPU: 1 << 2,
  NO_LOD: 1 << 3,
  CUBE_TEXTURE: 1 << 4,
  VOLUME_TEXTURE: 1 << 5,
  TEXTURE_ARRAY: 1 << 6,
} as const;

const VTexExtraData = {
  SHEET: 2,
  METADATA: 3,
} as const;

/** The name the sheet compiler gives a sequence that was authored without one. */
const UNNAMED_SEQUENCE_NAME = 'CDmeSheetSequence';

/** Texture.SpritesheetData.Sequence.Frame.Image: a frame's art in the atlas, in 0-1 texture coordinates. */
export interface ParticleSheetImage {
  croppedMin: [number, number];
  croppedMax: [number, number];
  uncroppedMin: [number, number];
  uncroppedMax: [number, number];
}

/** Texture.SpritesheetData.Sequence.Frame. */
export interface ParticleSheetFrame {
  images: ParticleSheetImage[];
  /** How long the frame shows, in seconds. */
  displayTime: number;
}

/** Texture.SpritesheetData.Sequence. */
export interface ParticleSheetSequence {
  /** The sequence number it was authored with. */
  id: number;
  clamp: boolean;
  alphaCrop: boolean;
  noColor: boolean;
  noAlpha: boolean;
  frames: ParticleSheetFrame[];
  /** The time the sequence spans; its frames divide it by their display times. */
  totalTime: number;
  name: string;
  floatParams: Record<string, number>;
}

/** Texture.SpritesheetData: the sprite sheet sequences a particle texture carries. Plain data, so it crosses IPC. */
export interface ParticleSheet {
  sequences: ParticleSheetSequence[];
}

/** What the renderer needs to know about a particle texture, read from its compiled header. */
export interface ParticleTextureInfo {
  width: number;
  height: number;
  /** A VTexFormat value. */
  format: number;
  /** VTexFlags bits. */
  flags: number;
  /** How many mip levels the texture stores; 1 for one sampled without mips. */
  mipLevels: number;
  /** The most texels a motion vector texture displaces by per frame, 0 for other textures. */
  motionVectorsMaxDistance: number;
  sheet: ParticleSheet | null;
}

/**
 * The position in `sheet.sequences` of the sequence a particle reaches with sequence number `id`,
 * or -1 when none answers to it (SpritesheetData.GetSequenceIndex). An unnamed sequence answers to
 * its authored id, one named with digits only to that number, and any other named one to nothing.
 */
export function getSequenceIndex(sheet: ParticleSheet, id: number): number {
  const indices = sequenceIndicesById(sheet);
  return id >= 0 && id < indices.length ? indices[id] : -1;
}

/** One past the largest sequence number any sequence of `sheet` answers to (SpritesheetData.SequenceIdCount). */
export function sequenceIdCount(sheet: ParticleSheet): number {
  return sequenceIndicesById(sheet).length;
}

const indicesCache = new WeakMap<ParticleSheet, number[]>();

function sequenceIndicesById(sheet: ParticleSheet): number[] {
  const cached = indicesCache.get(sheet);

  if (cached) {
    return cached;
  }

  const ids = sheet.sequences.map(lookupId);
  const count = ids.reduce((max, id) => Math.max(max, id + 1), 0);
  const indices = new Array<number>(count).fill(-1);

  ids.forEach((id, i) => {
    if (id >= 0) {
      indices[id] = i;
    }
  });

  indicesCache.set(sheet, indices);
  return indices;
}

// Whether an empty name counts as all digits is not known; it is treated as a name
function lookupId(sequence: ParticleSheetSequence): number {
  const name = sequence.name;

  if (name === UNNAMED_SEQUENCE_NAME) {
    return sequence.id | 0;
  }

  if (name.length === 0 || !/^[0-9]+$/.test(name)) {
    return -1;
  }

  const id = Number.parseInt(name, 10);
  return id <= 0x7fffffff ? id : -1;
}

/** Sequence.EffectiveTotalTime: the span a sequence plays over, or one second when it has none of its own. */
export function effectiveTotalTime(sequence: ParticleSheetSequence): number {
  return sequence.totalTime > 0 ? sequence.totalTime : 1;
}

/**
 * Reads the header and sheet of a compiled `.vtex_c` (Resource with a VTEX v1 DATA block), or null
 * when the buffer is not one. Throws on a malformed buffer.
 */
export function readParticleTextureInfo(bytes: Uint8Array): ParticleTextureInfo | null {
  const reader = new Reader(bytes);

  // The resource header: file size, header version, version, then the block table
  if (bytes.length < 16 || reader.u16(4) !== 12) {
    return null;
  }

  const blockTable = reader.relative(8);
  const blockCount = reader.u32(12);

  for (let i = 0; i < blockCount; i++) {
    const block = blockTable + i * 12;

    if (reader.ascii(block, 4) !== 'DATA') {
      continue;
    }

    return readTexture(reader, reader.relative(block + 4));
  }

  return null;
}

function readTexture(reader: Reader, offset: number): ParticleTextureInfo | null {
  if (reader.u16(offset) !== 1) {
    return null;
  }

  const flags = reader.u16(offset + 2);
  const width = reader.u16(offset + 20);
  const height = reader.u16(offset + 22);
  const format = reader.u8(offset + 26);
  const mipLevels = reader.u8(offset + 27);
  const extraDataOffset = reader.relative(offset + 32);
  const extraDataCount = reader.u32(offset + 36);

  let sheet: ParticleSheet | null = null;
  let motionVectorsMaxDistance = 0;

  for (let i = 0; i < extraDataCount; i++) {
    const entry = extraDataOffset + i * 12;
    const type = reader.u32(entry);
    const data = reader.relative(entry + 4);
    const size = reader.u32(entry + 8);
    reader.check(data, size);

    if (type === VTexExtraData.METADATA) {
      // A leading zero, the display rect, then the motion vector distance
      motionVectorsMaxDistance = reader.i16(data + 6);
    } else if (type === VTexExtraData.SHEET) {
      sheet = readSheet(new Reader(reader.bytes.subarray(data, data + size)));
    }
  }

  return { width, height, format, flags, mipLevels, motionVectorsMaxDistance, sheet };
}

// The layout Texture.GetSpriteSheetData reads: offsets are relative to where they are stored
function readSheet(reader: Reader): ParticleSheet {
  const sequencesOffset = reader.i32(0);
  const sequenceCount = reader.u32(4);
  const sequences: ParticleSheetSequence[] = [];

  for (let s = 0; s < sequenceCount; s++) {
    const header = sequencesOffset + s * 32;
    const framesOffset = reader.relative(header + 8);
    const frameCount = reader.u32(header + 12);
    const floatParamsOffset = reader.relative(header + 24);
    const floatParamsCount = reader.u32(header + 28);
    const floatParams: Record<string, number> = {};

    for (let p = 0; p < floatParamsCount; p++) {
      const param = floatParamsOffset + p * 8;
      floatParams[reader.offsetString(param)] = reader.f32(param + 4);
    }

    const frames: ParticleSheetFrame[] = [];

    for (let f = 0; f < frameCount; f++) {
      const frame = framesOffset + f * 12;
      const imagesOffset = reader.relative(frame + 4);
      const imageCount = reader.u32(frame + 8);
      const images: ParticleSheetImage[] = [];

      for (let i = 0; i < imageCount; i++) {
        const image = imagesOffset + i * 32;
        const v = (n: number) => reader.f32(image + n * 4);
        images.push({
          croppedMin: [v(0), v(1)],
          croppedMax: [v(2), v(3)],
          uncroppedMin: [v(4), v(5)],
          uncroppedMax: [v(6), v(7)],
        });
      }

      frames.push({ displayTime: reader.f32(frame), images });
    }

    sequences.push({
      id: reader.u32(header),
      clamp: reader.u8(header + 4) !== 0,
      alphaCrop: reader.u8(header + 5) !== 0,
      noColor: reader.u8(header + 6) !== 0,
      noAlpha: reader.u8(header + 7) !== 0,
      frames,
      totalTime: reader.f32(header + 16),
      name: reader.offsetString(header + 20),
      floatParams,
    });
  }

  return { sequences };
}

/** Bounds-checked little-endian reads over a byte buffer. */
class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  check(offset: number, size: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > this.bytes.length) {
      throw new RangeError(`Texture read out of bounds at ${offset} (${size} bytes)`);
    }
  }

  u8(offset: number): number {
    this.check(offset, 1);
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, true);
  }

  i16(offset: number): number {
    this.check(offset, 2);
    return this.view.getInt16(offset, true);
  }

  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  i32(offset: number): number {
    this.check(offset, 4);
    return this.view.getInt32(offset, true);
  }

  f32(offset: number): number {
    this.check(offset, 4);
    return this.view.getFloat32(offset, true);
  }

  /** The offset stored at `offset`, which counts from `offset` itself. */
  relative(offset: number): number {
    return offset + this.i32(offset);
  }

  ascii(offset: number, length: number): string {
    this.check(offset, length);
    return String.fromCharCode(...this.bytes.subarray(offset, offset + length));
  }

  /** The null terminated UTF-8 string the offset stored at `offset` points to; a zero offset is an empty string. */
  offsetString(offset: number): string {
    const relative = this.i32(offset);
    return relative === 0 ? '' : this.string(offset + relative);
  }

  /** A null terminated UTF-8 string starting at `offset`. */
  string(offset: number): string {
    this.check(offset, 0);
    let end = offset;

    while (end < this.bytes.length && this.bytes[end] !== 0) {
      end++;
    }

    return new TextDecoder().decode(this.bytes.subarray(offset, end));
  }
}
