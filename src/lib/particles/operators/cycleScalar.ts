// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/CycleScalar.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { fieldMask, isScalarField, applySetMethod } from '../fields';
import { ParticleFunctionOperator, type ControlPointDefaults } from '../functions';
import { FLOAT_MAX, f32, clamp, lerp } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';

export class CycleScalar extends ParticleFunctionOperator {
  private readonly destField: number;
  private readonly startValue: number;
  private readonly endValue: number;
  private readonly cycleTime: number;
  private readonly doNotRepeatCycle: boolean;
  private readonly synchronizeParticles: boolean;
  private readonly cpScale: number;
  private readonly cpFieldMin: number;
  private readonly cpFieldMax: number;
  private readonly setMethod: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.destField = parse.particleField('m_nDestField', ParticleField.Alpha);
    this.startValue = parse.float('m_flStartValue', 0);
    this.endValue = parse.float('m_flEndValue', 1);
    this.cycleTime = parse.float('m_flCycleTime', 1);
    this.doNotRepeatCycle = parse.boolean('m_bDoNotRepeatCycle', false);
    this.synchronizeParticles = parse.boolean('m_bSynchronizeParticles', false);
    this.cpScale = clamp(parse.int32('m_nCPScale', -1), -1, 64);
    this.cpFieldMin = clamp(parse.int32('m_nCPFieldMin', 0), -1, 2);
    this.cpFieldMax = clamp(parse.int32('m_nCPFieldMax', 0), -1, 2);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.destField);
  }

  addControlPointDefaults(defaults: ControlPointDefaults): void { defaults.addScale(this.cpScale, this.cpFieldMin); defaults.addScale(this.cpScale, this.cpFieldMax); }

  get storedFields(): bigint { return fieldMask(this.destField); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    let start = this.startValue;
    let end = this.endValue;
    if (this.cpScale >= 0) {
      const cp = state.getControlPoint(this.cpScale).position;
      if (this.cpFieldMin >= 0) {
        start = f32(start * cp.component(this.cpFieldMin));
      }
      if (this.cpFieldMax >= 0) {
        end = f32(end * cp.component(this.cpFieldMax));
      }
    }
    let rate = f32(1 / Math.max(FLOAT_EPSILON, this.cycleTime));
    const limit = this.doNotRepeatCycle ? this.cycleTime : FLOAT_MAX;
    if (this.doNotRepeatCycle) {
      rate = f32(rate * 0.5);
    }
    if (!isScalarField(this.destField)) {
      return;
    }
    const current = particles.currentSpan;
    const ages = current.readAges();
    const outputs = current.floats(this.destField);
    const initials = particles.initialSpan.readFloats(this.destField);
    for (let i = 0; i < outputs.length; i++) {
      const time = this.synchronizeParticles ? state.age : ages[i];
      let phase = f32(Math.min(time, limit) * rate);
      phase = f32(phase - Math.trunc(phase));
      const triangle = f32(2 * Math.min(phase, f32(1 - phase)));
      const value = lerp(start, end, triangle);
      outputs[i] = applySetMethod(value, initials[i], outputs[i], state.currentStep, this.setMethod);
    }
  }
}
