import { describe, expect, it } from 'vitest';
import { particleWorldVelocity } from './particleWorldVelocity';
import type { FxDescriptor } from './fxDescriptor';
const system = (): FxDescriptor => ({ name: 'smoke', controlPoints: [{ cp: 0, attachType: 'PATTACH_WORLDORIGIN', attachment: null, entity: 'self' }],
  emitters: [], operators: [], renderers: [], children: [], initializers: [{ class: 'C_INIT_VelocityRandom', params: {
    m_LocalCoordinateSystemSpeedMin: [0, 0, 50], m_LocalCoordinateSystemSpeedMax: [0, 0, 50],
  } }] });
describe('authored world-origin initial velocity', () => {
  it('retains separate upward velocity independent of the weapon attachment', () => {
    const d = system(); d.controlPoints[0].attachType = null;
    expect(particleWorldVelocity(d, () => .5)).toEqual([0, 0, 50]);
  });
  it('adds initializer contributions and world speed per component', () => {
    const d = system(); d.initializers.push({ class: 'C_INIT_VelocityRandom', params: { m_fSpeedMin: 10, m_fSpeedMax: 20 } });
    expect(particleWorldVelocity(d, () => .5)).toEqual([15, 15, 65]);
  });
  it('omits unresolved attached frames and raw per-step displacement', () => {
    const d = system(); d.controlPoints[0].attachType = 'PATTACH_POINT_FOLLOW';
    expect(particleWorldVelocity(d)).toEqual([0, 0, 0]);
    const raw = system(); raw.initializers[0].params.m_bIgnoreDT = true;
    expect(particleWorldVelocity(raw)).toEqual([0, 0, 0]);
  });
});
