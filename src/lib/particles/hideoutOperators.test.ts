import { describe, expect, it } from 'vitest';
import { ConstantValues, writeVector } from './buffer';
import { ParticleCollection } from './collection';
import { ParticleDiagnostics } from './diagnostics';
import { ParticleField, ScalarExpressionType } from './enums';
import { fieldMask } from './fields';
import { TwistAroundAxis } from './forces/twistAroundAxis';
import { DistanceToCPInit } from './initializers/distanceToCPInit';
import type { KVObject } from './kv';
import { Vector3 } from './numerics';
import { SetAttributeToScalarExpression } from './operators/setAttributeToScalarExpression';
import { ParticleDefinitionParser } from './parser';
import { SetControlPointPositions } from './preEmission/setControlPointPositions';
import { ParticleSystemState } from './state';

const parse = (data: KVObject, version = 12) => new ParticleDefinitionParser(data, new ParticleDiagnostics(), { value: 0n }, version);
function collection(positions: Vector3[]) {
  const particles = new ParticleCollection(new ConstantValues(), positions.length);
  particles.setStorage(fieldMask(ParticleField.Position) | fieldMask(ParticleField.Radius) | fieldMask(ParticleField.Alpha), fieldMask(ParticleField.Radius), 0n);
  for (let i = 0; i < positions.length; i++) particles.add();
  positions.forEach((position, index) => writeVector(particles.currentSpan.vectors(ParticleField.Position), index, position));
  particles.currentSpan.floats(ParticleField.Radius).fill(4);
  particles.initialSpan.floats(ParticleField.Radius).fill(10);
  return particles;
}

describe('fixed control point positions', () => {
  it('transforms all four offsets and copies the complete head basis into children', () => {
    const state = new ParticleSystemState(null, null), child = new ParticleSystemState(state, null);
    state.setControlPointValue(0, new Vector3(10, 20, 30));
    state.setControlPointAxes(0, Vector3.unitY, Vector3.unitX.negate(), Vector3.unitZ);
    new SetControlPointPositions(parse({ m_bOrient: true })).operate(state);
    expect(state.getControlPoint(1).position).toEqual(new Vector3(10, 148, 30));
    expect(state.getControlPoint(2).position).toEqual(new Vector3(-118, 20, 30));
    expect(state.getControlPoint(3).position).toEqual(new Vector3(10, -108, 30));
    expect(state.getControlPoint(4).position).toEqual(new Vector3(138, 20, 30));
    expect(child.getControlPoint(1).left).toEqual(Vector3.unitX.negate());
    expect(child.getControlPoint(1).up).toEqual(Vector3.unitZ);
  });
  it('uses world positions without orienting and resets set-once on restart', () => {
    const state = new ParticleSystemState(null, null);
    const op = new SetControlPointPositions(parse({ m_bSetOnce: true, m_bUseWorldLocation: true, m_bOrient: true }));
    state.setControlPointOrientation(0, Vector3.unitY);
    op.operate(state);
    state.setControlPointValue(1, Vector3.zero);
    op.operate(state);
    expect(state.getControlPoint(1).position).toEqual(Vector3.zero);
    op.restart(); op.operate(state);
    expect(state.getControlPoint(1).position).toEqual(new Vector3(128, 0, 0));
    expect(state.getControlPoint(1).forward).toEqual(Vector3.unitX);
  });
});

describe('scalar expression operator', () => {
  it.each([
    [ScalarExpressionType.SCALAR_EXPRESSION_ADD, 4, 2, 3],
    [ScalarExpressionType.SCALAR_EXPRESSION_DIVIDE, 4, 0, 0],
    [ScalarExpressionType.SCALAR_EXPRESSION_MOD, 7, 3, 0.5],
    [ScalarExpressionType.SCALAR_EXPRESSION_EQUAL, 4, 4, 1],
    [ScalarExpressionType.SCALAR_EXPRESSION_GT, 4, 2, 1],
    [ScalarExpressionType.SCALAR_EXPRESSION_LT, 4, 2, 0],
  ])('evaluates expression %s with half strength', (expression, a, b, expected) => {
    const particles = collection([Vector3.zero]);
    const op = new SetAttributeToScalarExpression(parse({ m_nExpression: expression, m_flInput1: a, m_flInput2: b }));
    op.operate(particles, 0.25, new ParticleSystemState(null, null), 0.5);
    expect(particles.currentSpan.floats(ParticleField.Radius)[0]).toBe(expected);
  });
  it('scales the initial value after the arithmetic result and clamps alpha', () => {
    const particles = collection([Vector3.zero]);
    const state = new ParticleSystemState(null, null);
    new SetAttributeToScalarExpression(parse({ m_flInput1: 3, m_nSetMethod: 'PARTICLE_SET_SCALE_INITIAL_VALUE' })).operate(particles, 0, state, 0.5);
    expect(particles.currentSpan.floats(ParticleField.Radius)[0]).toBe(15);
    new SetAttributeToScalarExpression(parse({ m_flInput1: 3, m_nOutputField: ParticleField.Alpha })).operate(particles, 0, state, 1);
    expect(particles.currentSpan.floats(ParticleField.Alpha)[0]).toBe(1);
  });
});

describe('distance initializer', () => {
  it('measures linear component-scaled distance, skipping outside the active range', () => {
    const particles = collection([new Vector3(3, 4, 0), new Vector3(0, 4, 0), new Vector3(50, 0, 0)]);
    const op = new DistanceToCPInit(parse({ m_vecDistanceScale: [0, 2, 1], m_flInputMin: 2, m_flInputMax: 10,
      m_flOutputMin: 0, m_flOutputMax: 8, m_bActiveRange: true }));
    op.initializeParticles(particles.currentSpan, particles, new ParticleSystemState(null, null));
    expect([...particles.currentSpan.floats(ParticleField.Radius)]).toEqual([6, 6, 4]);
  });
  it('handles a nonzero subspan and clamps alpha endpoints before remapping', () => {
    const particles = collection([Vector3.zero, new Vector3(5, 0, 0)]);
    const op = new DistanceToCPInit(parse({ m_nFieldOutput: ParticleField.Alpha, m_flInputMax: 10, m_flOutputMin: -1, m_flOutputMax: 2, m_bLOS: true }));
    op.initializeParticles(particles.currentSpan.slice(1, 1), particles, new ParticleSystemState(null, null));
    expect([...particles.currentSpan.floats(ParticleField.Alpha)]).toEqual([0, 0.5]);
  });
  it('applies bias after the distance remap', () => {
    const particles = collection([new Vector3(5, 0, 0)]);
    new DistanceToCPInit(parse({ m_flInputMax: 10, m_flRemapBias: 0.25 })).initializeParticles(particles.currentSpan, particles, new ParticleSystemState(null, null));
    expect(particles.currentSpan.floats(ParticleField.Radius)[0]).toBe(0.25);
  });
});

describe('twist force', () => {
  it('adds tangential force, leaving center and poles unchanged', () => {
    const particles = collection([Vector3.unitX, Vector3.zero, Vector3.unitZ, Vector3.unitZ.negate()]);
    const forces = new Float32Array(12).fill(1);
    new TwistAroundAxis(parse({ m_fForceAmount: 4 })).generateForces(particles, forces, 0, new ParticleSystemState(null, null), 0.5);
    expect([...forces]).toEqual([1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
  it.each([2, 3])('uses the version %s axis control point for local space', version => {
    const state = new ParticleSystemState(null, null);
    state.setControlPointAxes(1, Vector3.unitZ, Vector3.unitY, Vector3.unitX.negate());
    const particles = collection([Vector3.unitY]);
    const forces = new Float32Array(3);
    new TwistAroundAxis(parse({ m_fForceAmount: 2, m_bLocalSpace: true, m_nControlPointNumber: 1 }, version)).generateForces(particles, forces, 0, state, 1);
    expect([...forces]).toEqual(version < 3 ? [2, 0, 0] : [0, 0, 2]);
  });
});
