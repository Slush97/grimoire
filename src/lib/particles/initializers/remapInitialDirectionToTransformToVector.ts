// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RemapInitialDirectionToTransformToVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { degreesToRadians, f32, Vector3, safeNormalize } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';

export class RemapInitialDirectionToTransformToVector extends ParticleFunctionInitializer {
  private readonly transformInput: TransformProvider;
  private readonly fieldOutput: number;
  private readonly scale: number;
  private readonly normalize: boolean;
  private readonly rotationRowX: Vector3;
  private readonly rotationRowY: Vector3;
  private readonly rotationRowZ: Vector3;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.scale = parse.float('m_flScale', 1);
    const rotationDegrees = parse.float('m_flOffsetRot', 0);
    const axis = parse.vector3('m_vecOffsetAxis', Vector3.zero);
    this.normalize = parse.boolean('m_bNormalize', false);
    const angle = degreesToRadians(rotationDegrees);
    const sin = f32(Math.sin(angle));
    const cos = f32(Math.cos(angle));
    const reverse = f32(1 - cos);
    const a = axis;
    this.rotationRowX = new Vector3(
      f32(f32(f32(1 - f32(a.x * a.x)) * cos) + f32(a.x * a.x)),
      f32(f32(f32(a.x * a.y) * reverse) - f32(a.z * sin)),
      f32(f32(f32(a.x * a.z) * reverse) + f32(a.y * sin)),
    );
    this.rotationRowY = new Vector3(
      f32(f32(f32(a.y * a.x) * reverse) + f32(a.z * sin)),
      f32(f32(f32(1 - f32(a.y * a.y)) * cos) + f32(a.y * a.y)),
      f32(f32(f32(a.y * a.z) * reverse) - f32(a.x * sin)),
    );
    this.rotationRowZ = new Vector3(
      f32(f32(f32(a.x * a.z) * reverse) - f32(a.y * sin)),
      f32(f32(f32(a.y * a.z) * reverse) + f32(a.x * sin)),
      f32(f32(f32(1 - f32(a.z * a.z)) * cos) + f32(a.z * a.z)),
    );
  }

  get writtenFields(): bigint { return fieldMask(this.fieldOutput); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const origin = this.transformInput.nextTransform(state).translation;
    if (!isVectorField(this.fieldOutput)) {
      return;
    }
    const positions = run.readVectors(ParticleField.Position);
    const outputs = run.vectors(this.fieldOutput);
    for (let i = 0; i < run.length; i++) {
      const delta = readVector(positions, i).sub(origin);
      let direction = new Vector3(delta.dot(this.rotationRowX), delta.dot(this.rotationRowY), delta.dot(this.rotationRowZ));
      if (this.normalize) {
        direction = safeNormalize(direction);
      }
      writeVector(outputs, i, direction.scale(this.scale));
    }
  }
}
