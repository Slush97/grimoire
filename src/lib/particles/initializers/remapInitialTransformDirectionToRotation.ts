// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RemapInitialTransformDirectionToRotation.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, Quaternion, PI, f32, degreesToRadians } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { transformQuaternion, quaternionToEulerAngles } from '../utils/vectorMath';

export class RemapInitialTransformDirectionToRotation extends ParticleFunctionInitializer {
  private readonly transformInput: TransformProvider;
  private readonly fieldOutput: number;
  private readonly offsetRot: number;
  private readonly component: number;
  private readonly useEulerComponent: boolean;
  private readonly addPi: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Yaw);
    this.offsetRot = parse.float('m_flOffsetRot', 0);
    this.component = parse.int32('m_nComponent', 1);
    this.useEulerComponent = parse.behaviorVersion >= 7;
    this.addPi = parse.behaviorVersion < 4;
  }

  get writtenFields(): bigint { return fieldMask(this.fieldOutput); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const offset = degreesToRadians(this.offsetRot);
    const rotation = Quaternion.fromRotationMatrix(this.transformInput.nextTransform(state));
    let value: number;
    if (this.useEulerComponent) {
      const angles = quaternionToEulerAngles(rotation);
      value = f32(offset - degreesToRadians(angles.component(this.component)));
    }
    else {
      const forward = transformQuaternion(Vector3.unitX, rotation);
      value = f32(f32(offset + f32(Math.atan2(forward.y, forward.x))) + (this.addPi ? PI : 0));
    }
    if (isScalarField(this.fieldOutput)) {
      run.floats(this.fieldOutput).fill(value);
    }
  }
}
