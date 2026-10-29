import type { ParticleSystemSimulation } from '../simulation';

interface RuntimeInput {
  controlPoint: number;
  component: 'x' | 'y' | 'z';
  value: number;
  evidence: string;
}

/**
 * Non-spatial inputs supplied by game code, after authored defaults and attachment placement.
 * Values describe an idle showcase, not live weapon state. Keep the evidence with each input.
 */
export const IDLE_PARTICLE_INPUTS: Readonly<Record<string, readonly RuntimeInput[]>> = {
  'particles/abilities/familiar/familiar_ambient_candle.vpcf': [{
    controlPoint: 2, component: 'x', value: 1,
    evidence: 'familiar_ambient_candle_flame_rope: CP2.x curves map 0..1 to lifetime 0.05..0.26 s and radius multiplier 0.35..1. ' +
      'abilities.vdata ability_familiar_primary_weapon_bubblegun has clip size 13 and no idle CP default. ' +
      'The authored familiar_ambient_ui_candle_flame_rope uses literal lifetime 0.25 s and radius multiplier 1. ' +
      'Vanilla showcase rem.mp4 shows the full teardrop flame. Use the saturated curve endpoint for that idle state. ' +
      'The data and recording establish the visible state, not whether game code supplies ammo count or a fraction.',
  }],
};

export function applyIdleParticleInputs(system: ParticleSystemSimulation, effect: string): void {
  const key = effect.replace(/\\/g, '/').replace(/_c$/, '');
  for (const input of IDLE_PARTICLE_INPUTS[key] ?? []) {
    const cp = system.getControlPoint(input.controlPoint);
    switch (input.component) {
      case 'x': cp.position = cp.position.withX(input.value); break;
      case 'y': cp.position = cp.position.withY(input.value); break;
      case 'z': cp.position = cp.position.withZ(input.value); break;
    }
  }
}
