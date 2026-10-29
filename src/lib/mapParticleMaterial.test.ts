import { expect, it } from 'vitest';
import * as THREE from 'three';
import { isWorldParticleCard, worldCardData } from './mapParticleMaterial';

it('keeps authored material clocks, secondary UV and jitter values for world cards', () => {
  const material = new THREE.MeshBasicMaterial();
  material.userData.morphic = { shader: 'pbr.vfx', ints: { F_UNLIT: [1], F_JITTER_VERTICES: 2, g_bUseSecondaryUvForAltTranslucency: 1 },
    floats: { g_flTranslucentScrollQuantize0_1: [0.15], g_flJitterSpeedA1: 0.056 },
    vectors: { g_vTranslucentScrollSpeed0_1: [0, 0.1, 0, 0] }, texture_slots: { g_tColor: 'models/effects/color.vtex' } };
  expect(isWorldParticleCard(material)).toBe(true);
  const data = worldCardData(material);
  expect(data.intParams).toEqual({ F_UNLIT: 1, F_JITTER_VERTICES: 2, g_bUseSecondaryUvForAltTranslucency: 1 });
  expect(data.floatParams).toEqual({ g_flTranslucentScrollQuantize0_1: 0.15, g_flJitterSpeedA1: 0.056 });
  expect(data.vectorParams.g_vTranslucentScrollSpeed0_1).toEqual([0, 0.1, 0, 0]);
  expect(data.textureParams.g_tColor).toBe('models/effects/color.vtex');
  material.dispose();
});
