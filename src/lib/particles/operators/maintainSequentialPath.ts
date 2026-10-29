// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/MaintainSequentialPath.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, FLOAT_MAX, f32, distanceSquared, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { ParticlePathParameters, calculatePathValues, evaluatePath } from '../utils/particlePath';

export class MaintainSequentialPath extends ParticleFunctionOperator {
  private readonly maxDistance: NumberProvider;
  private readonly numToAssign: NumberProvider;
  private readonly cohesionStrength: NumberProvider;
  private readonly loop: boolean;
  private readonly useParticleCount: boolean;
  private readonly pathParams: ParticlePathParameters;
  private readonly tolerance: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.maxDistance = parse.numberProvider('m_fMaxDistance', new LiteralNumberProvider(0));
    this.numToAssign = parse.numberProvider('m_flNumToAssign', new LiteralNumberProvider(100));
    this.cohesionStrength = parse.numberProvider('m_flCohesionStrength', new LiteralNumberProvider(1));
    this.loop = parse.boolean('m_bLoop', true);
    this.useParticleCount = parse.boolean('m_bUseParticleCount', false);
    this.pathParams = new ParticlePathParameters(parse);
    this.tolerance = f32(parse.float('m_flTolerance', 0) ** 2);
  }
  private slotIndex = 0;
  private slotStep = 1;
  private lastStartPosition = Vector3.splat(FLOAT_MAX);
  private lastEndPosition = Vector3.splat(FLOAT_MAX);

  reset(): void {
    this.slotIndex = 0;
    this.slotStep = 1;
    this.lastStartPosition = Vector3.splat(FLOAT_MAX);
    this.lastEndPosition = Vector3.splat(FLOAT_MAX);
  }

  get storedFields(): bigint { return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    if (this.tolerance > 0) {
      const startNow = state.getControlPoint(this.pathParams.startControlPointNumber).position;
      const endNow = state.getControlPoint(this.pathParams.endControlPointNumber).position;
      if (distanceSquared(startNow, this.lastStartPosition) < this.tolerance && distanceSquared(endNow, this.lastEndPosition) < this.tolerance) {
        return;
      }
      this.lastStartPosition = startNow;
      this.lastEndPosition = endNow;
    }
    if (this.useParticleCount || !(this.numToAssign instanceof LiteralNumberProvider)) {
      this.slotIndex = 0;
    }
    const assignCount = this.useParticleCount ? f32(particles.count) : this.numToAssign.nextNumber(state);
    const parameterStep = assignCount <= 1 ? 0 : f32(1 / f32(assignCount - 1));
    const maxOffset = this.maxDistance.nextNumber(state);
    const offsetRetention = f32(1 - this.cohesionStrength.nextNumber(state));
    const { start, mid, end } = calculatePathValues(state, this.pathParams, state.age);
    const current = particles.currentSpan;
    const positions = current.vectors(ParticleField.Position);
    const previous = current.vectors(ParticleField.PositionPrevious);
    for (let i = 0; i < current.length; i++) {
      let index = this.slotIndex;
      if (index >= assignCount || index < 0) {
        if (this.loop) {
          index = 0;
          this.slotIndex = 0;
        }
        else {
          this.slotStep = -this.slotStep;
          index = Math.max(Math.min(index, toInt(assignCount) - 1), 1);
          this.slotIndex = index;
        }
      }
      const target = evaluatePath(start, mid, end, f32(index * parameterStep));
      writeVector(positions, i, MaintainSequentialPath.pullTowards(readVector(positions, i), target, maxOffset, offsetRetention));
      writeVector(previous, i, MaintainSequentialPath.pullTowards(readVector(previous, i), target, maxOffset, offsetRetention));
      this.slotIndex += this.slotStep;
    }
  }
  private static pullTowards(position: Vector3, target: Vector3, maxDistance: number, retention: number): Vector3 {
    const offset = position.sub(target);
    const distance = offset.length();
    if (distance <= 0) {
      return target;
    }
    return target.add(offset.div(distance).scale(f32(Math.min(distance, maxDistance) * retention)));
  }
}
