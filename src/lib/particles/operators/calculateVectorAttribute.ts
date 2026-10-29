// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/CalculateVectorAttribute.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { isCollection } from '../kv';
import { Vector3, f32 } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { FLOAT_MIN_NORMAL, FLOAT_EPSILON } from '../utils/particleMath';

export class CalculateVectorAttribute extends ParticleFunctionOperator {
  private readonly startValue: Vector3;
  private readonly fieldInput1: number;
  private readonly inputScale1: number;
  private readonly fieldInput2: number;
  private readonly inputScale2: number;
  private readonly controlPointInput1: number;
  private readonly controlPointScale1: number;
  private readonly controlPointInput2: number;
  private readonly controlPointScale2: number;
  private readonly fieldOutput: number;
  private readonly finalOutputScale: Vector3;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.startValue = parse.vector3('m_vStartValue', Vector3.zero);
    this.fieldInput1 = parse.particleField('m_nFieldInput1', ParticleField.Position);
    this.inputScale1 = parse.float('m_flInputScale1', 1);
    this.fieldInput2 = parse.particleField('m_nFieldInput2', ParticleField.Position);
    this.inputScale2 = parse.float('m_flInputScale2', 0);
    this.controlPointInput1 = CalculateVectorAttribute.readControlPointReference(parse, 'm_nControlPointInput1');
    this.controlPointScale1 = parse.float('m_flControlPointScale1', -1);
    this.controlPointInput2 = CalculateVectorAttribute.readControlPointReference(parse, 'm_nControlPointInput2');
    this.controlPointScale2 = parse.float('m_flControlPointScale2', 0);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Normal);
    this.finalOutputScale = parse.vector3('m_vFinalOutputScale', Vector3.one);
  }
  private static readControlPointReference(parse: ParticleDefinitionParser, key: string): number {
    const value = parse.data[key];
    return isCollection(value) ? parse.nested(value).int32('m_controlPointNameString', 0) : parse.int32(key, 0);
  }

  get storedFields(): bigint { return fieldMask(this.fieldOutput); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    let baseValue = this.startValue;
    if (this.controlPointScale1 !== 0 && this.controlPointInput1 !== -1) {
      baseValue = baseValue.add(state.getControlPoint(this.controlPointInput1).position.scale(this.controlPointScale1));
    }
    if (this.controlPointScale2 !== 0 && this.controlPointInput1 !== -1) {
      baseValue = baseValue.add(state.getControlPoint(this.controlPointInput2).position.scale(this.controlPointScale2));
    }
    if (!isVectorField(this.fieldOutput)) {
      return;
    }
    const current = particles.currentSpan;
    const outputs = current.vectors(this.fieldOutput);
    const inputs1 = this.inputScale1 !== 0 ? current.readVectors(this.fieldInput1) : null;
    const inputs2 = this.inputScale2 !== 0 ? current.readVectors(this.fieldInput2) : null;
    for (let i = 0; i < current.length; i++) {
      let value = baseValue;
      if (inputs1 !== null) {
        value = value.add(readVector(inputs1, i).scale(this.inputScale1));
      }
      if (inputs2 !== null) {
        value = value.add(readVector(inputs2, i).scale(this.inputScale2));
      }
      value = value.mul(this.finalOutputScale);
      if (this.fieldOutput === ParticleField.Normal) {
        const lengthSquared = value.lengthSquared();
        value = value.div(f32(Math.sqrt(lengthSquared < FLOAT_MIN_NORMAL ? FLOAT_EPSILON : lengthSquared)));
      }
      writeVector(outputs, i, value);
    }
  }
}
