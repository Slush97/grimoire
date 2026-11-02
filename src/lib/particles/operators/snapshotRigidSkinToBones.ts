// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SnapshotRigidSkinToBones.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, safeNormalize, transform, transformNormal } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { maxAxisScale } from '../utils/hitBox';
import { HitBoxCache } from '../utils/hitBoxCache';

/**
 * C_OP_SnapshotRigidSkinToBones: re-skins particles bound to bones to the current pose of a control
 * point's model every step. The rest position recorded at creation, offset by the initial previous
 * position, is carried through the particle's blend of bone transforms. Normals and radii can follow
 * the bones too.
 */
export class SnapshotRigidSkinToBones extends ParticleFunctionOperator {
  private readonly transformNormals: boolean;
  private readonly transformRadii: boolean;
  private readonly controlPoint: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformNormals = parse.boolean('m_bTransformNormals', false);
    this.transformRadii = parse.boolean('m_bTransformRadii', false);
    this.controlPoint = parse.controlPoint('m_nControlPointNumber', 0);

    parse.addInitialRead(ParticleField.Position);
    parse.addInitialRead(ParticleField.PositionPrevious);
    parse.addInitialRead(ParticleField.Radius);
    parse.addInitialRead(ParticleField.Normal);
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.Radius) | fieldMask(ParticleField.Normal);
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const cache = HitBoxCache.refresh(state, this.controlPoint, '', true);

    if (cache === null || cache.count <= 0 || !particles.currentSpan.hasBones) {
      return;
    }

    const current = particles.currentSpan;
    const initial = particles.initialSpan;
    const positions = current.vectors(ParticleField.Position);
    const previousPositions = current.vectors(ParticleField.PositionPrevious);
    const initialPreviousPositions = initial.readVectors(ParticleField.PositionPrevious);
    const restPositions = current.readVectors(ParticleField.HitboxOffsetPosition);
    const boneWeights = current.readVectors(ParticleField.BoneWeights);
    const boneIndices = current.boneIndices;

    const normals = this.transformNormals ? current.vectors(ParticleField.Normal) : null;
    const initialNormals = this.transformNormals ? initial.readVectors(ParticleField.Normal) : null;
    const radii = this.transformRadii ? current.floats(ParticleField.Radius) : null;
    const initialRadii = this.transformRadii ? initial.readFloats(ParticleField.Radius) : null;

    for (let i = 0; i < current.length; i++) {
      const skinned = cache.computeSkinningMatrix(boneIndices[i], readVector(boneWeights, i), false);

      if (skinned === null) {
        continue;
      }

      const { skin } = skinned;
      const rest = readVector(restPositions, i);

      writeVector(positions, i, transform(rest, skin));
      writeVector(previousPositions, i, transform(rest.add(readVector(initialPreviousPositions, i)), skin));

      if (normals !== null) {
        writeVector(normals, i, safeNormalize(transformNormal(readVector(initialNormals!, i), skin)));
      }

      if (radii !== null) {
        radii[i] = f32(maxAxisScale(skin) * initialRadii![i]);
      }
    }
  }
}
