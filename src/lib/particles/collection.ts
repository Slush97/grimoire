// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleCollection.cs.
//
// Not ported: Blended (the particles blended between two steps for a renderer to draw after an
// overshooting step). It is drawing-side and the simulation never reads it.

import { type ConstantValues, ParticleBuffer } from './buffer';
import { BLENDED_FIELD_MASK } from './fields';
import { ParticleSpan } from './span';

/** The most particles a CPU simulated system can hold. */
export const MAX_PARTICLES = 20000;

/** The most particles a GPU simulated system can hold. */
export const MAX_GPU_PARTICLES = 100000;

/** A queued event other than a kill, handed to the listening children once the running function returns. */
export interface PendingEvent {
  type: number;
  index: number;
}

/** Manages the initial and current state arrays for all live particles in a system. */
export class ParticleCollection {
  private readonly initial: ParticleBuffer;
  private readonly current: ParticleBuffer;
  private previousStep: ParticleBuffer | null = null;
  private previousStepCaptured = false;

  readonly capacity: number;
  count = 0;

  /** Whether removing particles keeps the survivors in order, rather than filling each slot with the last particle. */
  preserveOrderOnKill = false;

  private blendedFieldMask = BLENDED_FIELD_MASK;
  private readonly kills: number[] = [];
  private readonly moves: [number, number][] = [];
  private readonly handleColumns: Int32Array[] = [];
  private readonly releasedHandles: number[][] = [];

  /** The queued events, in the order they were raised. */
  readonly pendingEvents: PendingEvent[] = [];

  constructor(constants: ConstantValues, maxParticles: number) {
    this.capacity = Math.min(Math.max(maxParticles, 1), MAX_GPU_PARTICLES);
    this.initial = new ParticleBuffer(this.capacity, 0n);
    this.initial.constants = constants;
    this.current = new ParticleBuffer(this.capacity, 0n);
    this.current.constants = constants;
  }

  /** The initial (spawn-time) particle states. */
  get initialSpan(): ParticleSpan {
    return new ParticleSpan(this.initial, 0, this.count);
  }

  /** The current (this-frame) particle states. */
  get currentSpan(): ParticleSpan {
    return new ParticleSpan(this.current, 0, this.count);
  }

  /** The vector `field` held in the first slot, whether or not a live particle holds it. */
  firstSlotVector(field: number) {
    return new ParticleSpan(this.current, 0, 1).readVector(field, 0);
  }

  /**
   * Chooses which attributes get arrays. The current particles store `stored`; the initial particles
   * keep a copy of `initialStored`, read `initialShared` from the current particles, and read the
   * constant for the rest.
   */
  setStorage(stored: bigint, initialStored: bigint, initialShared: bigint): void {
    this.current.setStoredFields(stored);
    this.initial.setStoredFields(initialStored);
    this.initial.shareFrom(this.current, initialShared);
    this.previousStep?.setStoredFields(stored & this.blendedFieldMask);
  }

  addBlendedFields(fields: bigint): void {
    this.blendedFieldMask |= fields;
  }

  /** The bit mask of the attributes the current particles store. */
  get storedFields(): bigint {
    return this.current.owned;
  }

  /** Adds a new particle slot holding the constants and returns its index, or -1 if the collection is full. */
  add(): number {
    if (this.count >= this.capacity) {
      return -1;
    }

    this.current.resetToConstants(this.count);
    return this.count++;
  }

  /** Marks the particle at `index` for removal once the running function returns. */
  kill(index: number): void {
    this.kills.push(index);
  }

  get hasKills(): boolean {
    return this.kills.length > 0;
  }

  /** The indices of the particles marked for removal, ascending and each once. */
  sortKills(): number[] {
    this.kills.sort((a, b) => a - b);

    let unique = 0;

    for (let i = 0; i < this.kills.length; i++) {
      if (i === 0 || this.kills[i] !== this.kills[unique - 1]) {
        this.kills[unique++] = this.kills[i];
      }
    }

    this.kills.length = unique;
    return this.kills;
  }

  /**
   * Removes all particles marked for removal. Survivors keep their order when preserveOrderOnKill is
   * set; otherwise, walking the removed slots from the front, each is filled with the last particle
   * once trailing removed particles are dropped.
   */
  pruneExpired(): void {
    const before = this.count;
    const killed = this.sortKills();
    this.moves.length = 0;

    if (killed.length > 0 && this.preserveOrderOnKill) {
      let alive = killed[0];
      let next = 0;

      for (let i = killed[0]; i < this.count; i++) {
        if (next < killed.length && killed[next] === i) {
          next++;
          continue;
        }

        this.moves.push([i, alive]);
        alive++;
      }

      this.count = alive;
    } else if (killed.length > 0) {
      let end = this.count;
      let back = killed.length - 1;

      for (let front = 0; front <= back && killed[front] < end; front++) {
        const index = killed[front];

        while (back > front && killed[back] === end - 1) {
          back--;
          end--;
        }

        if (end - 1 > index) {
          this.moves.push([end - 1, index]);
        }

        end--;
      }

      this.count = end;
    }

    if (this.moves.length > 0) {
      this.initial.move(this.moves);
      this.current.move(this.moves);

      if (this.previousStepCaptured) {
        this.previousStep!.move(this.moves);
      }

      // Handles are swapped rather than copied, so the handles of the particles moved over end up past the survivors
      for (const handles of this.handleColumns) {
        for (const [from, to] of this.moves) {
          const swapped = handles[to];
          handles[to] = handles[from];
          handles[from] = swapped;
        }
      }
    }

    this.kills.length = 0;
    this.releaseHandles(this.count, before);
  }

  /** Removes all particles without deallocating the backing arrays. */
  clear(): void {
    this.kills.length = 0;
    this.releaseHandles(0, this.count);
    this.count = 0;
  }

  /** Adds a column in which the caller keeps a handle per particle, and returns its index. */
  claimHandleColumn(): number {
    this.handleColumns.push(new Int32Array(this.capacity));
    this.releasedHandles.push([]);
    return this.handleColumns.length - 1;
  }

  handles(column: number): Int32Array {
    return this.handleColumns[column].subarray(0, this.count);
  }

  releasedHandlesOf(column: number): number[] {
    return this.releasedHandles[column];
  }

  private releaseHandles(first: number, end: number): void {
    for (let column = 0; column < this.handleColumns.length; column++) {
      const released = this.releasedHandles[column];
      const handles = this.handleColumns[column];

      for (let i = first; i < end; i++) {
        if (handles[i] !== 0) {
          released.push(handles[i]);
          handles[i] = 0;
        }
      }
    }
  }

  /** The system time particle ages are measured against. */
  get time(): number {
    return this.current.time;
  }

  set time(value: number) {
    this.current.time = value;
    this.initial.time = value;
  }

  /** The particles as they were before an overshooting step, or an empty span. */
  get previousStepSpan(): ParticleSpan | null {
    return this.previousStepCaptured ? new ParticleSpan(this.previousStep!, 0, this.count) : null;
  }

  /** Copies the current particles as the state before the step about to run. */
  capturePreviousStep(): void {
    if (this.previousStep === null) {
      this.previousStep = new ParticleBuffer(this.current.capacity, this.storedFields & this.blendedFieldMask);
      this.previousStep.constants = this.current.constants;
    }

    this.previousStep.copy(this.current, 0, 0, this.count);
    this.previousStep.time = this.current.time;
    this.previousStepCaptured = true;
  }

  releasePreviousStep(): void {
    this.previousStepCaptured = false;
  }

  /** Queues an event other than a kill for the particle at `index`. */
  raiseEvent(index: number, type: number): void {
    this.pendingEvents.push({ type, index });
  }

  /** Takes the current state of the `count` particles from `first` as their initial state. */
  saveInitial(first: number, count: number): void {
    this.initial.copy(this.current, first, first, count);
  }

  /** Records the particles created during the step as their own previous state. */
  setPreviousStep(first: number, count: number): void {
    if (this.previousStepCaptured) {
      this.previousStep!.copy(this.current, first, first, count);
    }
  }
}
