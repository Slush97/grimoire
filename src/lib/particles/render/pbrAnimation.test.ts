import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pbrJitterWave, pbrScrollTime } from './pbrAnimation';
import { ModelMaterial } from './modelMaterial';
import { DEADLOCK_GAME_SETTINGS, ParticleRendererContext } from './context';
import { Vector3 } from '../numerics';
import { VTexFormat } from './sheet';
import type { ParticleTextureEntry } from './textures';

describe('VRF PBR animation', () => {
  it('uses the authored scroll interval independently for each mask', () => {
    expect(pbrScrollTime(0.224, 0.15)).toBeCloseTo(0.15);
    expect(pbrScrollTime(0.226, 0.15)).toBeCloseTo(0.3);
    expect(pbrScrollTime(0.224, 0)).toBe(0.224);
    expect(pbrScrollTime(-0.226, 0.15)).toBeCloseTo(-0.3);
  });
  it.each([
    [0, 0.02, 10, 0, 0.5], [12.5, 0.02, 10, 0, 0], [25, 0.02, 10, 0, -0.5],
    [-12.5, 0.02, 10, 0, 0], [0, -0.02, 10, 0.025, 0], [0, 0, 10, 123, 0.5],
  ])('evaluates the smoothed triangle wave at %s, %s, %s, %s', (position, frequency, speed, time, expected) => {
    expect(pbrJitterWave(position, frequency, speed, time)).toBeCloseTo(expected, 7);
  });
  it('keeps Source world transforms, signed jitter mode and independent clocks in the shared material', () => {
    const view = { location: Vector3.zero, forward: Vector3.unitX, right: Vector3.unitY, up: Vector3.unitZ,
      projectionM22: 1, windowSize: [720, 720] satisfies [number, number], sourceUnitsPerViewerUnit: 1 };
    const context = new ParticleRendererContext({ get: () => null }, DEADLOCK_GAME_SETTINGS, [0, 0, 0], () => view);
    const built = new ModelMaterial({ name: 'test', shader: 'pbr.vfx', intParams: { F_UNLIT: 1, F_JITTER_VERTICES: 2 },
      floatParams: { g_flTranslucentScrollQuantize0_1: 0.15 }, vectorParams: {}, textureParams: {}, intAttributes: {} }, context, false);
    const transform = new THREE.Matrix4().makeTranslation(12000, -6000, -300);
    built.setModelTransform(transform); context.time = 1.25; built.update(view, context);
    const uniforms = built.material.uniforms;
    expect(uniforms.uModelToSource.value.elements).toEqual(transform.elements);
    expect(uniforms.uSourceToModel.value.elements[12]).toBe(-12000);
    expect(built.material.defines.F_JITTER_VERTICES).toBe(2);
    expect(uniforms.g_flTime.value).toBe(1.25);
    expect(uniforms.g_flTranslucentScrollQuantize0_1.value).toBe(0.15);
    expect(uniforms.g_flTranslucentScrollQuantize1_1.value).toBe(0);
    expect(uniforms.g_vJitterFrequenciesA1.value.toArray()).toEqual([0.02, 0.04, 0.08]);
    expect(built.material.forceSinglePass).toBe(true);
    built.dispose(); context.dispose();
  });
  it('waits for authored textures instead of drawing opaque white fallback cards', () => {
    const view = { location: Vector3.zero, forward: Vector3.unitX, right: Vector3.unitY, up: Vector3.unitZ,
      projectionM22: 1, windowSize: [720, 720] satisfies [number, number], sourceUnitsPerViewerUnit: 1 };
    const entry: ParticleTextureEntry = { texture: null, info: { width: 4, height: 4, format: VTexFormat.RGBA8888,
      flags: 0, mipLevels: 1, motionVectorsMaxDistance: 0, sheet: null } };
    const context = new ParticleRendererContext({ get: () => entry }, DEADLOCK_GAME_SETTINGS, [0, 0, 0], () => view);
    const built = new ModelMaterial({ name: 'test', shader: 'pbr.vfx', intParams: { F_UNLIT: 1 }, floatParams: {},
      vectorParams: {}, textureParams: { g_tColor: 'models/effects/color.vtex' }, intAttributes: {} }, context, false);
    built.update(view, context); expect(built.material.visible).toBe(false);
    entry.texture = new THREE.Texture();
    built.update(view, context); expect(built.material.visible).toBe(true);
    built.dispose(); entry.texture.dispose(); context.dispose();
  });
  it('adds a premultiplied additive colour once, as the compiled game pbr blend states do', () => {
    const view = { location: Vector3.zero, forward: Vector3.unitX, right: Vector3.unitY, up: Vector3.unitZ,
      projectionM22: 1, windowSize: [720, 720] satisfies [number, number], sourceUnitsPerViewerUnit: 1 };
    const context = new ParticleRendererContext({ get: () => null }, DEADLOCK_GAME_SETTINGS, [0, 0, 0], () => view);
    const data = (intParams: Record<string, number>) => ({ name: 'test', shader: 'pbr.vfx', intParams, floatParams: {}, vectorParams: {}, textureParams: {}, intAttributes: {} });
    // The shader already multiplies an additive colour by its opacity, so the source factor is One.
    const additive = new ModelMaterial(data({ F_UNLIT: 1, F_TRANSLUCENT: 1, F_ADDITIVE_BLEND: 1 }), context, false);
    expect([additive.material.blendSrc, additive.material.blendDst]).toEqual([THREE.OneFactor, THREE.OneFactor]);
    const blended = new ModelMaterial(data({ F_UNLIT: 1, F_TRANSLUCENT: 1 }), context, false);
    expect([blended.material.blendSrc, blended.material.blendDst]).toEqual([THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor]);
    additive.dispose(); blended.dispose(); context.dispose();
  });
  it('poses a rigged map prop through its bones only when the mesh is skinned', () => {
    const view = { location: Vector3.zero, forward: Vector3.unitX, right: Vector3.unitY, up: Vector3.unitZ,
      projectionM22: 1, windowSize: [720, 720] satisfies [number, number], sourceUnitsPerViewerUnit: 1 };
    const context = new ParticleRendererContext({ get: () => null }, DEADLOCK_GAME_SETTINGS, [0, 0, 0], () => view);
    const data = { name: 'ghost', shader: 'pbr.vfx', intParams: { F_UNLIT: 1, F_TRANSLUCENT: 1 }, floatParams: {}, vectorParams: {}, textureParams: {}, intAttributes: {} };
    const rigged = new ModelMaterial(data, context, false, true), card = new ModelMaterial(data, context, false);
    expect(rigged.material.defines.USE_SKINNING).toBe(1);
    expect(card.material.defines.USE_SKINNING).toBe(0);
    // Jitter and the model transform run on the posed position, as three.js skins before its own transforms.
    expect(rigged.material.vertexShader).toMatch(/modelPosition = \(skin \* vec4\(position, 1\.0\)\)\.xyz;[\s\S]*uModelToSource \* vec4\(modelPosition, 1\.0\)/);
    rigged.dispose(); card.dispose(); context.dispose();
  });
});
