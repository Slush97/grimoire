// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RandomSequence.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';

const TABLE_SIZE = 64;

/**
 * C_INIT_RandomSequence: sets the sequence to a value between min and max, picked linearly,
 * shuffled, or at random. A weighted list replaces the range, picking in proportion to weight.
 */
export class RandomSequence extends ParticleFunctionInitializer {
  private readonly sequenceMin: number;
  private readonly sequenceMax: number;
  private readonly shuffle: boolean;
  private readonly linear: boolean;

  private readonly weightedList: { sequence: number; weight: number }[] = [];
  private readonly totalWeight: number = 0;
  private readonly initialWeightedCursor: number = 0;
  private weightedCursor = 0;

  /** The order a shuffled or linear pick walks, indexed by sequence number. */
  private readonly table = new Int32Array(TABLE_SIZE);
  private next = 0;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    let sequenceMin = parse.int32('m_nSequenceMin', 0);
    let sequenceMax = parse.int32('m_nSequenceMax', 0);
    this.shuffle = parse.boolean('m_bShuffle', false);
    this.linear = parse.boolean('m_bLinear', false);

    const entries = parse.array('m_WeightedList');

    if (entries.length > 0) {
      sequenceMin = 2147483647;
      sequenceMax = 0;
      let totalWeight = 0;

      for (const entry of entries) {
        const sequence = entry.int32('m_nSequence');
        const weight = entry.float('m_flRelativeWeight', 1);

        this.weightedList.push({ sequence, weight });
        sequenceMin = Math.min(sequenceMin, sequence);
        sequenceMax = Math.max(sequenceMax, sequence);

        if (weight > 0) {
          totalWeight = f32(totalWeight + weight);
        }
      }

      this.totalWeight = totalWeight;
      this.initialWeightedCursor = this.shuffle || this.linear ? sequenceMin : 0;
      this.weightedCursor = this.initialWeightedCursor;
    }

    this.sequenceMin = sequenceMin;
    this.sequenceMax = sequenceMax;
  }

  /** Lays out the walk, shuffling it with draws from the system's table when asked to. */
  initialize(state: ParticleSystemState): void {
    this.weightedCursor = this.initialWeightedCursor;
    this.table.fill(0);
    this.next = 0;

    if (!(this.shuffle || this.linear)) {
      return;
    }

    // A weighted list never reads the table, but the shuffle still takes its draws from the shared stream
    this.next = this.sequenceMin;

    for (let sequence = Math.max(this.sequenceMin, 0); sequence <= Math.min(this.sequenceMax, TABLE_SIZE - 1); sequence++) {
      this.setEntry(sequence, sequence);
    }

    if (this.shuffle) {
      this.shuffleTable(state);
    }
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.SequenceNumber);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const sequences = run.floats(ParticleField.SequenceNumber);

    for (let i = 0; i < sequences.length; i++) {
      if (this.weightedList.length > 0) {
        sequences[i] = this.nextWeightedSequence(state);
      } else if (this.shuffle || this.linear) {
        if (this.next > this.sequenceMax) {
          if (this.shuffle) {
            this.shuffleTable(state);
          }

          this.next = this.sequenceMin;
        }

        sequences[i] = this.getEntry(this.next);
        this.next++;
      } else {
        sequences[i] = this.sequenceMin + state.random.nextIndex(this.sequenceMax - this.sequenceMin + 1);
      }
    }
  }

  /** Picks the next weighted entry: a linear list walks it with the cursor, otherwise one draw scaled by the total weight. */
  private nextWeightedSequence(state: ParticleSystemState): number {
    let sequence = 0;

    if (this.totalWeight > 0) {
      let pick = this.linear ? this.weightedCursor : f32(this.totalWeight * state.random.next());

      for (const { sequence: entrySequence, weight } of this.weightedList) {
        if (weight <= 0) {
          continue;
        }

        pick = f32(pick - weight);
        sequence = entrySequence;

        if (pick < 0) {
          break;
        }
      }
    }

    if (this.linear) {
      this.weightedCursor++;

      if (this.weightedCursor >= Math.ceil(this.totalWeight)) {
        this.weightedCursor = 0;
      }
    }

    return sequence;
  }

  private shuffleTable(state: ParticleSystemState): void {
    for (let i = this.sequenceMax; i > this.sequenceMin; i--) {
      const j = this.sequenceMin + state.random.nextIndex(i - this.sequenceMin + 1);
      const swapped = this.getEntry(i);
      this.setEntry(i, this.getEntry(j));
      this.setEntry(j, swapped);
    }
  }

  // Sequences outside 0..63 overrun the table in the game; here they read as 0 and are not written
  private getEntry(sequence: number): number {
    return sequence >= 0 && sequence < TABLE_SIZE ? this.table[sequence] : 0;
  }

  private setEntry(sequence: number, value: number): void {
    if (sequence >= 0 && sequence < TABLE_SIZE) {
      this.table[sequence] = value;
    }
  }
}
