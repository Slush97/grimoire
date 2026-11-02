// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/SnapshotBinding.cs and
// the attribute naming of ValveResourceFormat/Resource/Blocks/ParticleSnapshot.cs.
//
// Snapshots (.vsnap) are a separate resource the definition JSON does not carry. A host that can
// decode them hands them in through the definition loader; without one, every authored snapshot is
// absent, which is what VRF does for a snapshot it cannot load.

import { ParticleField } from '../enums';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { getString, hasKey } from '../kv';

/** One row's bones and weights, as a skinned snapshot stores them (ParticleSnapshot.SkinningData). */
export interface SnapshotSkinning {
  readonly jointNames: readonly string[];
  readonly weights: Float32Array;
}

/** A snapshot attribute's rows as VRF types them: vectors hold x, y and z per row. */
export type SnapshotColumnData =
  | { kind: 'vector'; values: Float32Array }
  | { kind: 'float'; values: Float32Array }
  | { kind: 'int'; values: Int32Array }
  | { kind: 'string'; values: readonly string[] }
  | { kind: 'skinning'; values: readonly SnapshotSkinning[] };

/** A snapshot attribute keyed by name and type, as AttributeData holds it. */
export interface SnapshotAttribute {
  readonly name: string;
  readonly type: string;
  readonly data: SnapshotColumnData;
}

/** A particle snapshot: a table of rows with one column per attribute. */
export interface ParticleSnapshot {
  readonly numParticles: number;
  /** Bumped by whoever rebuilds the snapshot in place, so readers can tell it changed. */
  readonly serial: number;
  /** The scalar columns by attribute name (`creation_time`, ...), the first of each name. */
  readonly attributes: ReadonlyMap<string, ArrayLike<number>>;
  /** Every attribute in stored order, typed. Absent on snapshots built from scalar columns only. */
  readonly columns?: readonly SnapshotAttribute[];
}

/** Loads the snapshot a definition names, or null when it cannot. */
export type SnapshotLoader = (path: string) => ParticleSnapshot | null;

const SNAPSHOT_ATTRIBUTE_NAMES: Readonly<Record<number, string>> = {
  [ParticleField.Position]: 'position',
  [ParticleField.LifeDuration]: 'lifespan',
  [ParticleField.PositionPrevious]: 'velocity',
  [ParticleField.Radius]: 'radius',
  [ParticleField.Roll]: 'rotation',
  [ParticleField.RollSpeed]: 'rotation_speed',
  [ParticleField.Color]: 'color',
  [ParticleField.Alpha]: 'opacity',
  [ParticleField.CreationTime]: 'creation_time',
  [ParticleField.SequenceNumber]: 'sequence_number',
  [ParticleField.TrailLength]: 'trail_length',
  [ParticleField.ParticleId]: 'particle_id',
  [ParticleField.Yaw]: 'yaw',
  [ParticleField.SecondSequenceNumber]: 'sequence_number1',
  [ParticleField.HitboxIndex]: 'hitbox',
  [ParticleField.HitboxOffsetPosition]: 'hitbox_offset',
  [ParticleField.AlphaAlternate]: 'alpha2',
  [ParticleField.ScratchVector]: 'scratch_vec',
  [ParticleField.ScratchFloat]: 'scratch_float',
  [ParticleField.Pitch]: 'pitch',
  [ParticleField.Normal]: 'normal',
  [ParticleField.GlowRgb]: 'glow_rgb',
  [ParticleField.GlowAlpha]: 'glow_alpha',
  [ParticleField.ForceScale]: 'force_scale',
  [ParticleField.ManualAnimationFrame]: 'manual_animation_frame',
  [ParticleField.ShaderExtraData1]: 'shader_extra_data_1',
  [ParticleField.ShaderExtraData2]: 'shader_extra_data_2',
  [ParticleField.RopeSegmentId]: 'rope_segment_id',
};

export function getSnapshotAttributeName(field: number): string | null {
  return SNAPSHOT_ATTRIBUTE_NAMES[field] ?? null;
}

/**
 * The snapshot a particle function reads from, bound to a control point and optionally narrowed to
 * a named subset of its rows. A function that authors a subset is unbound, as compiled snapshots
 * do not carry subsets.
 */
export class SnapshotBinding {
  private readonly controlPoint: number;
  private readonly hasSubset: boolean;

  constructor(parse: ParticleDefinitionParser, controlPointKey = 'm_nSnapshotControlPoint', defaultControlPoint = -1, clampControlPoint = false) {
    this.controlPoint = clampControlPoint ? parse.controlPoint(controlPointKey, defaultControlPoint) : parse.int32(controlPointKey, defaultControlPoint);
    this.hasSubset = (getString(parse.data, 'm_strSnapshotSubset') ?? '') !== '';
  }

  /** Loads the snapshot a system authors as `m_hSnapshot`, which it publishes on a control point. */
  static loadAuthored(parse: ParticleDefinitionParser, loader: SnapshotLoader | null): ParticleSnapshot | null {
    if (!hasKey(parse.data, 'm_hSnapshot')) {
      return null;
    }

    const path = getString(parse.data, 'm_hSnapshot') ?? '';

    if (path === '') {
      return null;
    }

    return loader?.(path) ?? null;
  }

  /** Whether a snapshot control point is authored at all. */
  get hasControlPoint(): boolean {
    return this.controlPoint >= 0;
  }

  /** Whether a usable snapshot control point is authored. */
  get isBound(): boolean {
    return this.hasControlPoint && !this.hasSubset;
  }

  resolve(state: ParticleSystemState): ParticleSnapshot | null {
    return this.isBound ? state.getControlPointSnapshot(this.controlPoint) : null;
  }

  /** How many rows the bound snapshot offers, or 0 when nothing is bound. */
  count(state: ParticleSystemState): number {
    return this.resolve(state)?.numParticles ?? 0;
  }

  /** The bound snapshot's column for `field`, or null. */
  resolveAttribute(state: ParticleSystemState, field: number): ArrayLike<number> | null {
    const snapshot = this.resolve(state);

    if (snapshot === null) {
      return null;
    }

    const name = getSnapshotAttributeName(field);
    return name === null ? null : (snapshot.attributes.get(name) ?? null);
  }
}
