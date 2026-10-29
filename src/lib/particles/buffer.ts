// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleBuffer.cs.
//
// Structure of arrays storage for particle attributes. Floats and integers share a table of 4-byte
// columns: each column is a Float32Array with an Int32Array over the same memory, and integer
// attributes are only ever read and copied through the Int32Array, so their bits survive (an
// integer such as -1 is a NaN as a float, which a JS number would not keep). Vectors are
// Float32Arrays of three floats per particle, bone indices BigUint64Arrays.

import { ParticleField } from './enums';
import { FIELD_COUNT, SCALAR_FIELDS, VALUE_FIELD_MASK, VECTOR_FIELDS, fieldMask, isVectorField, maskContains } from './fields';
import { Vector3 } from './numerics';
import type { ParticleDefinitionParser } from './parser';
import { isArray } from './kv';

/** The value every particle has for each attribute without an array. */
export class ConstantValues {
  /** The bits of each 4-byte attribute by field, read as floats or integers. */
  private readonly memory = new ArrayBuffer(FIELD_COUNT * 4);
  readonly scalars = new Float32Array(this.memory);
  readonly scalarBits = new Int32Array(this.memory);
  readonly vectors: Vector3[] = Array.from({ length: FIELD_COUNT }, () => Vector3.zero);
  boneIndices = 0n;
}

export class ParticleBuffer {
  readonly capacity: number;

  /** The 4-byte attributes by field as floats, null for a field stored otherwise or not at all. */
  readonly scalars: (Float32Array | null)[] = new Array<Float32Array | null>(FIELD_COUNT).fill(null);

  /** The same columns as `scalars`, read as integers. */
  readonly scalarBits: (Int32Array | null)[] = new Array<Int32Array | null>(FIELD_COUNT).fill(null);

  /** The vector attributes by field, three floats per particle. */
  readonly vectors: (Float32Array | null)[] = new Array<Float32Array | null>(FIELD_COUNT).fill(null);

  boneIndices: BigUint64Array | null = null;

  constants = new ConstantValues();

  /** The system time particle ages are measured against. */
  time = 0;

  private ownedFields = 0n;

  constructor(capacity: number, fields: bigint) {
    this.capacity = capacity;
    this.setStoredFields(fields);
  }

  private owns(field: number): boolean {
    return maskContains(this.ownedFields, field);
  }

  /** The bit mask of the attributes this buffer allocated itself. */
  get owned(): bigint {
    return this.ownedFields;
  }

  /** Allocates `field`, starting as a copy of the array it shared, or else holding its constant. */
  private allocate(field: number): void {
    if (this.owns(field)) {
      return;
    }

    this.ownedFields |= fieldMask(field);

    if (field === ParticleField.BoneIndices) {
      const bones = new BigUint64Array(this.capacity);
      if (this.boneIndices) {
        bones.set(this.boneIndices);
      } else {
        bones.fill(this.constants.boneIndices);
      }
      this.boneIndices = bones;
    } else if (isVectorField(field)) {
      const vectors = new Float32Array(this.capacity * 3);
      const shared = this.vectors[field];
      if (shared) {
        vectors.set(shared);
      } else {
        fillVectors(vectors, this.constants.vectors[field]);
      }
      this.vectors[field] = vectors;
    } else {
      const memory = new ArrayBuffer(this.capacity * 4);
      const bits = new Int32Array(memory);
      const shared = this.scalarBits[field];
      if (shared) {
        bits.set(shared);
      } else {
        bits.fill(this.constants.scalarBits[field]);
      }
      this.scalars[field] = new Float32Array(memory);
      this.scalarBits[field] = bits;
    }
  }

  /** Makes the value attributes in `fields` the ones this buffer allocates. */
  setStoredFields(fields: bigint): void {
    for (let field = 0; field < FIELD_COUNT; field++) {
      if (!maskContains(VALUE_FIELD_MASK, field)) {
        continue;
      }

      if (maskContains(fields, field)) {
        this.allocate(field);
      } else if (this.owns(field)) {
        this.ownedFields &= ~fieldMask(field);
        this.scalars[field] = null;
        this.scalarBits[field] = null;
        this.vectors[field] = null;

        if (field === ParticleField.BoneIndices) {
          this.boneIndices = null;
        }
      }
    }
  }

  /**
   * Takes `source`'s constants, and points every attribute in `fields` this buffer did not allocate
   * at `source`'s array. Every other attribute this buffer did not allocate reads its constant.
   */
  shareFrom(source: ParticleBuffer, fields: bigint): void {
    this.constants = source.constants;

    for (let field = 0; field < FIELD_COUNT; field++) {
      if (this.owns(field)) {
        continue;
      }

      const shared = maskContains(fields, field);
      this.scalars[field] = shared ? source.scalars[field] : null;
      this.scalarBits[field] = shared ? source.scalarBits[field] : null;
      this.vectors[field] = shared ? source.vectors[field] : null;
    }

    if (!this.owns(ParticleField.BoneIndices)) {
      this.boneIndices = maskContains(fields, ParticleField.BoneIndices) ? source.boneIndices : null;
    }
  }

  /** Copies `count` particles from `source` at `sourceIndex` to this buffer at `index`, for every attribute this buffer allocated. */
  copy(source: ParticleBuffer, sourceIndex: number, index: number, count: number): void {
    for (const field of SCALAR_FIELDS) {
      if (!this.owns(field)) {
        continue;
      }

      const target = this.scalarBits[field]!;
      const from = source.scalarBits[field];

      if (from) {
        target.set(from.subarray(sourceIndex, sourceIndex + count), index);
      } else {
        target.fill(source.constants.scalarBits[field], index, index + count);
      }
    }

    for (const field of VECTOR_FIELDS) {
      if (!this.owns(field)) {
        continue;
      }

      const target = this.vectors[field]!;
      const from = source.vectors[field];

      if (from) {
        target.set(from.subarray(sourceIndex * 3, (sourceIndex + count) * 3), index * 3);
      } else {
        fillVectors(target.subarray(index * 3, (index + count) * 3), source.constants.vectors[field]);
      }
    }

    if (this.owns(ParticleField.BoneIndices)) {
      if (source.boneIndices) {
        this.boneIndices!.set(source.boneIndices.subarray(sourceIndex, sourceIndex + count), index);
      } else {
        this.boneIndices!.fill(source.constants.boneIndices, index, index + count);
      }
    }
  }

  /** Sets the particle at `index` to the constants, for every attribute this buffer allocated. */
  resetToConstants(index: number): void {
    for (const field of SCALAR_FIELDS) {
      if (this.owns(field)) {
        this.scalarBits[field]![index] = this.constants.scalarBits[field];
      }
    }

    for (const field of VECTOR_FIELDS) {
      if (this.owns(field)) {
        writeVector(this.vectors[field]!, index, this.constants.vectors[field]);
      }
    }

    if (this.owns(ParticleField.BoneIndices)) {
      this.boneIndices![index] = this.constants.boneIndices;
    }
  }

  /** Moves particles within the buffer, each move in turn copying the particle at its source index over the one at its destination. */
  move(moves: readonly (readonly [number, number])[]): void {
    for (let field = 0; field < FIELD_COUNT; field++) {
      if (!this.owns(field)) {
        continue;
      }

      const bits = this.scalarBits[field];
      const vectors = this.vectors[field];

      if (bits) {
        for (const [from, to] of moves) {
          bits[to] = bits[from];
        }
      } else if (vectors) {
        for (const [from, to] of moves) {
          vectors.copyWithin(to * 3, from * 3, from * 3 + 3);
        }
      }
    }

    if (this.owns(ParticleField.BoneIndices)) {
      const bones = this.boneIndices!;
      for (const [from, to] of moves) {
        bones[to] = bones[from];
      }
    }
  }

  /** What every new particle of a system starts as: the attribute defaults with the definition's constants on top. */
  static createConstants(parse: ParticleDefinitionParser): ConstantValues {
    const constants = new ConstantValues();
    const scalars = constants.scalars;
    const vectors = constants.vectors;

    // The defaults a particle has before any constant or function sets it
    scalars[ParticleField.LifeDuration] = 1;
    scalars[ParticleField.Alpha] = 1;
    scalars[ParticleField.AlphaAlternate] = 1;
    vectors[ParticleField.Color] = Vector3.one;
    scalars[ParticleField.Radius] = 5;
    scalars[ParticleField.TrailLength] = 0.1;
    scalars[ParticleField.ForceScale] = 1;
    vectors[ParticleField.Normal] = new Vector3(0, 0, 1);
    constants.scalarBits[ParticleField.ParentParticleIndex] = -1;
    constants.scalarBits[ParticleField.ParentParticleId] = -2147483648;
    vectors[ParticleField.GlowRgb] = Vector3.one;
    scalars[ParticleField.GlowAlpha] = 1;
    scalars[ParticleField.ShaderExtraData1] = 1;
    scalars[ParticleField.ShaderExtraData2] = 1;

    const constantColor = parse.data['m_ConstantColor'];

    if (constantColor !== undefined && isArray(constantColor)) {
      vectors[ParticleField.Color] = parse.color24('m_ConstantColor', Vector3.one);

      if (constantColor.length > 3) {
        const alpha = constantColor[3];
        scalars[ParticleField.Alpha] = alpha === null ? 0 : Math.trunc(Number(alpha)) / 255;
      }
    }

    const setConstant = (field: number, key: string) => {
      scalars[field] = parse.float(key, scalars[field]);
    };

    setConstant(ParticleField.Radius, 'm_flConstantRadius');
    setConstant(ParticleField.LifeDuration, 'm_flConstantLifespan');
    // Unlike every other source of these attributes, the constants are not converted from degrees
    scalars[ParticleField.Roll] = parse.float('m_flConstantRotation', 0);
    scalars[ParticleField.RollSpeed] = parse.float('m_flConstantRotationSpeed', 0);

    vectors[ParticleField.Normal] = parse.vector3('m_ConstantNormal', vectors[ParticleField.Normal]);

    setConstant(ParticleField.SequenceNumber, 'm_nConstantSequenceNumber');
    setConstant(ParticleField.SecondSequenceNumber, 'm_nConstantSequenceNumber1');

    return constants;
  }
}

export function readVector(column: Float32Array, index: number): Vector3 {
  return new Vector3(column[index * 3], column[index * 3 + 1], column[index * 3 + 2]);
}

export function writeVector(column: Float32Array, index: number, value: Vector3): void {
  column[index * 3] = value.x;
  column[index * 3 + 1] = value.y;
  column[index * 3 + 2] = value.z;
}

export function fillVectors(column: Float32Array, value: Vector3): void {
  for (let i = 0; i < column.length; i += 3) {
    column[i] = value.x;
    column[i + 1] = value.y;
    column[i + 2] = value.z;
  }
}
