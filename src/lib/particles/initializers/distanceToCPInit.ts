// Ported from ValveResourceFormat (MIT): Particles/Initializers/DistanceToCPInit.cs.
import { readVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { applySetMethod, fieldMask, isAlphaField, isScalarField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, saturate } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { scaleDistance } from '../operators/lineOfSightTrace';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { biasClamped, remapClamped } from '../utils/particleMath';

export class DistanceToCPInit extends ParticleFunctionInitializer {
  private readonly fieldOutput: number;
  private readonly inputMin: NumberProvider;
  private readonly inputMax: NumberProvider;
  private readonly outputMin: NumberProvider;
  private readonly outputMax: NumberProvider;
  private readonly startCP: number;
  private readonly setMethod: number;
  private readonly activeRange: boolean;
  private readonly distanceScale: Vector3;
  private readonly remapBias: number;
  private readonly hasBias: boolean;
  private readonly lineOfSight: boolean;
  private readonly maxTraceLength: NumberProvider;
  private readonly lineOfSightScale: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.inputMin = parse.numberProvider('m_flInputMin', new LiteralNumberProvider(0));
    this.inputMax = parse.numberProvider('m_flInputMax', new LiteralNumberProvider(128));
    this.outputMin = parse.numberProvider('m_flOutputMin', new LiteralNumberProvider(0));
    this.outputMax = parse.numberProvider('m_flOutputMax', new LiteralNumberProvider(1));
    this.startCP = parse.controlPoint('m_nStartCP', 0);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.activeRange = parse.boolean('m_bActiveRange', false);
    this.distanceScale = parse.vector3('m_vecDistanceScale', Vector3.one);
    this.remapBias = parse.float('m_flRemapBias', 0.5);
    this.hasBias = this.remapBias !== 0.5;
    this.lineOfSight = parse.boolean('m_bLOS', false);
    this.maxTraceLength = parse.numberProvider('m_flMaxTraceLength', new LiteralNumberProvider(-1));
    this.lineOfSightScale = parse.float('m_flLOSScale', 0);
  }

  get writtenFields(): bigint { return fieldMask(this.fieldOutput); }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const controlPointPosition = state.getControlPoint(this.startCP).position;
    const inMins = this.inputMin.fillNew(run, state);
    const inMaxs = this.inputMax.fillNew(run, state);
    const outMins = this.outputMin.fillNew(run, state);
    const outMaxs = this.outputMax.fillNew(run, state);
    const traceLengths = this.maxTraceLength.fillNew(run, state);
    if (!isScalarField(this.fieldOutput)) return;
    const positions = run.readVectors(ParticleField.Position);
    const outputs = run.floats(this.fieldOutput);
    const clampOutput = isAlphaField(this.fieldOutput);
    for (let i = 0; i < run.length; i++) {
      const inMin = inMins[i], inMax = inMaxs[i];
      let outMin = outMins[i], outMax = outMaxs[i];
      if (clampOutput) { outMin = saturate(outMin); outMax = saturate(outMax); }
      const position = readVector(positions, i);
      let distance = controlPointPosition.sub(position).mul(this.distanceScale).length();
      if (this.activeRange && (distance < inMin || distance > inMax)) continue;
      if (this.lineOfSight) distance = scaleDistance(state.collision, controlPointPosition, position, distance, traceLengths[i], this.lineOfSightScale);
      let value = remapClamped(distance, inMin, inMax, outMin, outMax);
      if (this.hasBias) value = biasClamped(value, this.remapBias);
      const current = outputs[i];
      outputs[i] = applySetMethod(value, current, current, state.currentStep, this.setMethod);
    }
  }
}
