// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleSpan.cs.
//
// A span's columns are subarrays of the buffer's, so writes through them reach the particles as a
// C# Span does. Vector columns hold three floats per particle; read and write them with
// readVector/writeVector from ./buffer. Columns read for a field the system does not store are new
// arrays holding the constant, standing in for VRF's scratch columns.

import { type ParticleBuffer, fillVectors } from './buffer';
import { ParticleField, particleFieldName } from './enums';
import { FIELD_COUNT } from './fields';
import { Vector3, f32 } from './numerics';
import type { ParticleSystemState } from './state';
import type { VectorProvider } from './vectorProviders';

/** One block of four by storage index, with its offset in the span it was taken from. */
export interface SpanBlock {
  offset: number;
  block: ParticleSpan;
}

/** One block a function evaluates its vector inputs in, with the lane its first particle reads. */
export interface InputBlock extends SpanBlock {
  lane: number;
}

export class ParticleSpan {
  readonly buffer: ParticleBuffer;
  /** The storage index of the first particle in the span. */
  readonly start: number;
  readonly length: number;

  constructor(buffer: ParticleBuffer, start: number, length: number) {
    this.buffer = buffer;
    this.start = start;
    this.length = length;
  }

  get isEmpty(): boolean {
    return this.length === 0;
  }

  /** The particles from `offset`, `length` long. */
  slice(offset: number, length: number): ParticleSpan {
    if (offset < 0 || offset > this.length || length < 0 || length > this.length - offset) {
      throw new RangeError('offset');
    }

    return new ParticleSpan(this.buffer, this.start + offset, length);
  }

  /** The particles from offset `from` up to `to`, as a C# range `[from..to]`. */
  range(from: number, to: number): ParticleSpan {
    return this.slice(from, to - from);
  }

  /** The span from this one's first particle to the collection index `end`. */
  withEnd(end: number): ParticleSpan {
    return new ParticleSpan(this.buffer, this.start, end - this.start);
  }

  /** The span block by block of four by storage index, the unit a varying random input draws once for. */
  *blocks(): Generator<SpanBlock> {
    let offset = 0;

    while (offset < this.length) {
      const length = Math.min(4 - ((this.start + offset) & 3), this.length - offset);
      yield { offset, block: this.slice(offset, length) };
      offset += length;
    }
  }

  /** The block of four by storage index holding the particle at `index`. */
  blockAt(index: number): SpanBlock {
    const offset = Math.max(0, index - ((this.start + index) & 3));
    const length = Math.min(4 - ((this.start + offset) & 3), this.length - offset);
    return { offset, block: this.slice(offset, length) };
  }

  /**
   * Evaluates two vector inputs for every particle in the span, as a function that sets up the first
   * and then the second, and evaluates them in that order in each block.
   */
  fillVectorInputs(first: VectorProvider, second: VectorProvider, state: ParticleSystemState): [Float32Array, Float32Array] {
    const firstValues = first.prepare(this, state);
    const secondValues = second.prepare(this, state);

    for (const { offset, block, lane } of this.inputBlocks()) {
      first.fillPerBlock(block, lane, state, firstValues.subarray(offset * 3));
      second.fillPerBlock(block, lane, state, secondValues.subarray(offset * 3));
    }

    return [firstValues, secondValues];
  }

  /**
   * The blocks of four a function walks its vector inputs in, by storage index, or with
   * `blocksFromStart` from the span's first particle.
   */
  *inputBlocks(blocksFromStart = false): Generator<InputBlock> {
    let offset = 0;

    while (offset < this.length) {
      const lane = blocksFromStart ? 0 : (this.start + offset) & 3;
      const length = Math.min(4 - lane, this.length - offset);
      yield { offset, block: this.slice(offset, length), lane };
      offset += length;
    }
  }

  /** The system time the ages of the particles are measured against. */
  get time(): number {
    return this.buffer.time;
  }

  /** The float `field` of every particle. The field must be stored. */
  floats(field: number): Float32Array {
    const column = this.buffer.scalars[field];

    if (!column) {
      throw notStored(field);
    }

    return column.subarray(this.start, this.start + this.length);
  }

  /** The integer `field` of every particle. The field must be stored. */
  integers(field: number): Int32Array {
    const column = this.buffer.scalarBits[field];

    if (!column) {
      throw notStored(field);
    }

    return column.subarray(this.start, this.start + this.length);
  }

  /** The vector `field` of every particle, three floats each. The field must be stored. */
  vectors(field: number): Float32Array {
    const column = this.buffer.vectors[field];

    if (!column) {
      throw notStored(field);
    }

    return column.subarray(this.start * 3, (this.start + this.length) * 3);
  }

  /** The float `field` for reading; a field the system does not store reads as its constant. */
  readFloats(field: number): Float32Array {
    const found = this.tryGetFloats(field);

    if (found.values) {
      return found.values;
    }

    return new Float32Array(this.length).fill(found.constant);
  }

  /** The integer `field` for reading, as readFloats does. */
  readIntegers(field: number): Int32Array {
    const column = field >= 0 && field < FIELD_COUNT ? this.buffer.scalarBits[field] : null;

    if (column) {
      return column.subarray(this.start, this.start + this.length);
    }

    const constant = field >= 0 && field < FIELD_COUNT ? this.buffer.constants.scalarBits[field] : 0;
    return new Int32Array(this.length).fill(constant);
  }

  /** The vector `field` for reading, as readFloats does. */
  readVectors(field: number): Float32Array {
    const found = this.tryGetVectors(field);

    if (found.values) {
      return found.values;
    }

    const column = new Float32Array(this.length * 3);
    fillVectors(column, found.constant);
    return column;
  }

  readFloat(field: number, index: number): number {
    const found = this.tryGetFloats(field);
    return found.values ? found.values[index] : found.constant;
  }

  readInteger(field: number, index: number): number {
    const column = field >= 0 && field < FIELD_COUNT ? this.buffer.scalarBits[field] : null;

    if (column) {
      return column[this.start + index];
    }

    return field >= 0 && field < FIELD_COUNT ? this.buffer.constants.scalarBits[field] : 0;
  }

  readVector(field: number, index: number): Vector3 {
    const found = this.tryGetVectors(field);

    if (!found.values) {
      return found.constant;
    }

    return new Vector3(found.values[index * 3], found.values[index * 3 + 1], found.values[index * 3 + 2]);
  }

  /** Whether the particles hold their own bone indices and bone weights rather than the constants. */
  get hasBones(): boolean {
    return this.buffer.boneIndices !== null && this.buffer.vectors[ParticleField.BoneWeights] !== null;
  }

  /** The bone indices of every particle in the span. They must be stored. */
  get boneIndices(): BigUint64Array {
    const column = this.buffer.boneIndices;

    if (column === null) {
      throw notStored(ParticleField.BoneIndices);
    }

    return column.subarray(this.start, this.start + this.length);
  }

  /** The bone indices of every particle in the span for reading, a column of their constant when not stored. */
  readBoneIndices(): BigUint64Array {
    return this.buffer.boneIndices?.subarray(this.start, this.start + this.length)
      ?? new BigUint64Array(this.length).fill(this.buffer.constants.boneIndices);
  }

  /** The age of every particle in the span, in a new column. */
  readAges(): Float32Array {
    const creationTimes = this.floats(ParticleField.CreationTime);
    const ages = new Float32Array(this.length);
    const time = this.time;

    for (let i = 0; i < ages.length; i++) {
      ages[i] = f32(time - creationTimes[i]);
    }

    return ages;
  }

  /**
   * The scalar `field` of every particle as functions read and write it, or null values and the
   * constant every particle has when the field has no column (0 for a field that is not a scalar).
   */
  tryGetFloats(field: number): { values: Float32Array | null; constant: number } {
    if (field < 0 || field >= FIELD_COUNT) {
      return { values: null, constant: 0 };
    }

    const column = this.buffer.scalars[field];

    if (!column) {
      return { values: null, constant: this.buffer.constants.scalars[field] };
    }

    return { values: column.subarray(this.start, this.start + this.length), constant: 0 };
  }

  /** The vector `field` of every particle, or the constant when the field has no column. */
  tryGetVectors(field: number): { values: Float32Array | null; constant: Vector3 } {
    if (field < 0 || field >= FIELD_COUNT) {
      return { values: null, constant: Vector3.zero };
    }

    const column = this.buffer.vectors[field];

    if (!column) {
      return { values: null, constant: this.buffer.constants.vectors[field] };
    }

    return { values: column.subarray(this.start * 3, (this.start + this.length) * 3), constant: Vector3.zero };
  }
}

function notStored(field: number): Error {
  return new Error(`Particle attribute ${particleFieldName(field)} is not stored by this system, so it has no column; read its constant instead.`);
}
