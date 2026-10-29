// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SpinUpdate.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32 } from '../numerics';
import type { ParticleSystemState } from '../state';

/** C_OP_SpinUpdate ("Rotation Basic"): integrates each particle's rotation speed into its rotation. */
export class SpinUpdate extends ParticleFunctionOperator {
  get storedFields(): bigint {
    return fieldMask(ParticleField.Roll);
  }

  operate(particles: ParticleCollection, frameTime: number, _state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const roll = current.floats(ParticleField.Roll);

    // RollSpeed is stored in radians per second by everything that writes it
    const rollSpeeds = current.readFloats(ParticleField.RollSpeed);
    const steps = current.readAges();

    for (let i = 0; i < roll.length; i++) {
      const step = f32(Math.min(steps[i], frameTime) * strength);
      // TensorPrimitives.MultiplyAdd rounds the product before the add
      roll[i] = f32(rollSpeeds[i] * step) + roll[i];
    }
  }
}
