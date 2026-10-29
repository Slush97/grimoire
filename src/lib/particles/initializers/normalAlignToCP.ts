// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/NormalAlignToCP.cs.

import { writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleControlPointAxis, ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, transformNormal } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';

export class NormalAlignToCP extends ParticleFunctionInitializer {
  private readonly transformInput: TransformProvider;
  private readonly controlPointAxis: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_transformInput', new ControlPointTransformProvider());
    this.controlPointAxis = parse.enum('m_nControlPointAxis', ParticleControlPointAxis, ParticleControlPointAxis.PARTICLE_CP_AXIS_X);
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Normal);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const axis = this.controlPointAxis === ParticleControlPointAxis.PARTICLE_CP_AXIS_Y ? Vector3.unitY
      : this.controlPointAxis === ParticleControlPointAxis.PARTICLE_CP_AXIS_Z ? Vector3.unitZ
        : this.controlPointAxis === ParticleControlPointAxis.PARTICLE_CP_AXIS_NEGATIVE_X ? Vector3.unitX.negate()
          : this.controlPointAxis === ParticleControlPointAxis.PARTICLE_CP_AXIS_NEGATIVE_Y ? Vector3.unitY.negate()
            : this.controlPointAxis === ParticleControlPointAxis.PARTICLE_CP_AXIS_NEGATIVE_Z ? Vector3.unitZ.negate()
              : Vector3.unitX;
    const normals = run.vectors(ParticleField.Normal);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    for (let i = 0; i < run.length; i++) {
      const matrix = this.transformInput.nextTransformAtTime(state, creationTimes[i]);
      writeVector(normals, i, transformNormal(axis, matrix));
    }
  }
}
