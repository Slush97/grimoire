import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSource2ParticleLights, source2ConeFade, source2ShadowChannelMask } from './source2DynamicLights';
import { source2CookieLayers } from './source2LightCookies';
import { source2CookieMean } from './source2LightCookies';

describe('Source 2 baked shadow channel masks', () => {
  it('selects only the light\'s own channel', () => {
    // The shader computes 1 - dot(shadows, mask). Any other set component
    // would darken the light by an unrelated light's shadow channel.
    expect(source2ShadowChannelMask(0).toArray()).toEqual([1, 0, 0, 0]);
    expect(source2ShadowChannelMask(3).toArray()).toEqual([0, 0, 0, 1]);
  });

  it('leaves lights without a channel unshadowed', () => {
    expect(source2ShadowChannelMask(null).toArray()).toEqual([0, 0, 0, 0]);
  });
});

describe('Source 2 light cookies', () => {
  it('averages a cookie in linear light', () => {
    // sRGB 188 is linear 0.5; a black and a 188 texel average to 0.25.
    const mean = source2CookieMean([0, 0, 0, 255, 188, 188, 188, 255]);
    expect(mean.x).toBeCloseTo(0.25, 2);
    expect(mean.z).toBeCloseTo(0.25, 2);
  });
});

describe('Source 2 particle lights', () => {
  it('fades an omni cone as VRF SceneLight.ComputeAngleFade does', () => {
    // The fireplace light: outer 140, inner 24 degrees. The fade is bias + scale * cos(angle to the
    // light's axis seen from the point), so straight ahead (-1) is full and past the outer cone is none.
    const fade = source2ConeFade(140, 24);
    const at = (degrees: number) => Math.min(Math.max(fade.x + fade.y * -Math.cos(THREE.MathUtils.degToRad(degrees)), 0), 1);
    expect(at(0)).toBe(1);
    expect(at(24)).toBeCloseTo(1, 5);
    expect(at(130)).toBeCloseTo(0.073, 3);
    expect(at(150)).toBe(0);
    expect(source2ConeFade(180, 0).toArray()).toEqual([1, 0]);
  });

  it('places each light in its own frame and colours it as SceneLight.ComputeOmni2Color', () => {
    const lights = createSource2ParticleLights();
    lights.cookies = { texture: new THREE.Texture(), layers: ['cookies/a.png', 'particles/tex/fire.png'], size: 512, means: [] };
    lights.cookieFiles = { 'materials/fire.vtex': 'particles/tex/fire.png' };
    lights.update([{
      color: [1, 0.5, 0], linearBrightness: 2, brightnessScale: 0.5, range: 250, spotInnerAngle: 24, spotOuterAngle: 140,
      luminaireSize: 0, fallOff: 0.1, position: new THREE.Vector3(100, 200, 300), direction: new THREE.Vector3(0, -1, 0),
      left: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1), cookie: 'materials/fire.vtex', castShadows: true, tubeHalfLength: 0,
    }]);
    const u = lights.uniforms;
    // A point one unit along the light's forward axis is +x in its frame.
    expect(new THREE.Vector3(100, 199, 300).applyMatrix4(u.source2ParticleLightFromMap.value[0]).toArray().map(v => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
    expect(u.source2ParticleLightColor.value[0].x).toBeCloseTo(1, 6);
    expect(u.source2ParticleLightColor.value[0].y).toBeCloseTo(new THREE.Color().setRGB(0.5, 0, 0, THREE.SRGBColorSpace).r, 6);
    expect(u.source2ParticleLightFalloff.value[0].toArray()).toEqual([250, 0.1, 0, 0]);
    expect(u.source2ParticleLightCookie.value[0].toArray()).toEqual([1, 2, 0.5 / 512, 0.5 / 512]);
    // Slots without a light stay dark.
    expect(u.source2ParticleLightColor.value[1].toArray()).toEqual([0, 0, 0]);
    expect(u.source2ParticleLightFalloff.value[1].x).toBe(0);
    // Materials receive the same values, flattened once per update.
    for (const [name, uniform] of Object.entries(u)) {
      const flat = lights.shaderUniforms[name].value as unknown;
      if (Array.isArray(uniform.value)) expect(flat).toEqual(new Float32Array((uniform.value as (THREE.Matrix4 | THREE.Vector4 | THREE.Vector3 | THREE.Vector2)[])
        .flatMap(value => value instanceof THREE.Matrix4 ? Array.from(value.elements) : value.toArray())));
      else expect(flat).toBe(uniform.value);
    }
    lights.update([]);
    expect(u.source2ParticleLightColor.value[0].toArray()).toEqual([0, 0, 0]);
    lights.dispose();
  });
});

describe('Source 2 cookie atlas layers', () => {
  it('holds the map lights\' cookies, omni and barn, then the particle lights\'', () => {
    const light = (kind: string, cookie?: string) => ({ distribution: { kind }, cookie }) as never;
    expect(source2CookieLayers({ lights: [light('barn', 'cookies/a.png'), light('omni', 'cookies/b.png'), light('sun'), light('barn', 'cookies/a.png')],
      particles: { file: 'particles/bundle.json', entities: [], lightCookies: { 'materials/c.vtex': 'particles/tex/c.png' } } }))
      .toEqual(['cookies/a.png', 'cookies/b.png', 'particles/tex/c.png']);
  });
});
