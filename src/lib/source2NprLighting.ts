import * as THREE from 'three';

/** Ambient irradiance target per viewer lighting preset, before the Lambert PI. */
export const NPR_AMBIENT_TARGET = { midtown: 0.55, studio: 0.5 } as const;
/** Share of the original scene brightness the ambient and rim exposure retains. */
export const NPR_EXPOSURE_RETAINED = 0.15;

/** Preview lighting coefficients. Scene irradiance still comes from Three's lights and IBL. */
export function nprLightingUniforms({ enabled }: { enabled: boolean }): Record<string, THREE.IUniform> {
  return {
    uNprLighting: { value: enabled ? 1 : 0 },
    // Wrap, power-step sharpness, direct normalization, Lambert blend.
    uNprDirect: { value: new THREE.Vector4(0.8, 0.9, 0.625, 0.25) },
    uNprAmbientRange: { value: new THREE.Vector2(0.2, 0.9) },
    uNprAmbientWeights: { value: new THREE.Vector3(0.6, 0.15, 0.5) },
    uNprAmbientSteps: { value: 2 },
    // View cutoff, exponent, strength, world-up threshold.
    uNprRim: { value: new THREE.Vector4(0.7, 0.7, 2, 0.2) },
    uNprAmbientCubeOn: { value: 0 },
    uNprAmbientCube: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    // Irradiance target and the share of the original scene brightness retained.
    uNprExposure: { value: new THREE.Vector2(NPR_AMBIENT_TARGET.midtown * Math.PI, NPR_EXPOSURE_RETAINED) },
  };
}

export const NPR_LIGHTING_GLSL = /* glsl */ `
uniform float uNprLighting;
uniform vec4 uNprDirect;
uniform vec2 uNprAmbientRange;
uniform vec3 uNprAmbientWeights;
uniform float uNprAmbientSteps;
uniform vec4 uNprRim;
uniform float uNprAmbientCubeOn;
uniform vec3 uNprAmbientCube[6];
uniform vec2 uNprExposure;

bool useNprLighting() {
  return uNprLighting > 0.5 && uCelV2 > 0.5;
}

vec3 nprCubeIrradiance(vec3 worldNormal) {
  vec3 weights = worldNormal * worldNormal;
  return weights.x * (worldNormal.x >= 0.0 ? uNprAmbientCube[0] : uNprAmbientCube[1]) +
    weights.y * (worldNormal.y >= 0.0 ? uNprAmbientCube[2] : uNprAmbientCube[3]) +
    weights.z * (worldNormal.z >= 0.0 ? uNprAmbientCube[4] : uNprAmbientCube[5]);
}

vec3 nprAmbientAverage() {
  return (uNprAmbientCube[0] + uNprAmbientCube[1] + uNprAmbientCube[2] +
    uNprAmbientCube[3] + uNprAmbientCube[4] + uNprAmbientCube[5]) / 6.0;
}

vec3 nprAmbientExposure(vec3 irradiance, vec3 reference) {
  if (uNprExposure.x <= 0.0) return irradiance;
  vec3 luma = vec3(0.2126, 0.7152, 0.0722);
  float brightness = dot(irradiance, luma);
  if (brightness <= 1e-5) return vec3(0.0);
  float referenceBrightness = dot(reference, luma);
  vec3 chroma = irradiance / brightness;
  if (referenceBrightness > 1e-5) {
    chroma = mix(reference / referenceBrightness, chroma, clamp(brightness / referenceBrightness, 0.0, 1.0));
  }
  return mix(chroma * uNprExposure.x, irradiance, uNprExposure.y);
}

vec3 nprAmbientIrradiance(vec3 viewNormal, vec3 fallbackIrradiance) {
  vec3 ambient = fallbackIrradiance;
  vec3 reference = fallbackIrradiance;
  if (uNprAmbientCubeOn > 0.5) {
    ambient = nprCubeIrradiance(inverseTransformDirection(viewNormal, viewMatrix));
    reference = nprAmbientAverage();
  }
  return nprAmbientExposure(ambient, reference);
}

float nprRimExposure(vec3 incidentLight) {
  if (uNprExposure.x <= 0.0) return 1.0;
  float brightness = dot(incidentLight, vec3(0.2126, 0.7152, 0.0722));
  return mix(min(1.0, uNprExposure.x / max(brightness, 1e-5)), 1.0, uNprExposure.y);
}

float nprPowerStep(float value, float sharpness) {
  float x = clamp(value, 0.0, 1.0);
  float exponent = 1.0 / max(1.0 - sharpness, 0.02);
  float edge = 0.5 * pow(2.0 * min(x, 1.0 - x), exponent);
  return x > 0.5 ? 1.0 - edge : edge;
}

float nprDirectResponse(float nDotL) {
  float lambert = clamp(nDotL, 0.0, 1.0);
  float wrapped = 2.0 * (lambert + uNprDirect.x) - 1.5;
  return mix(uNprDirect.z * nprPowerStep(wrapped, uNprDirect.y), lambert, uNprDirect.w);
}

float nprAmbientBand(vec3 surfaceNormal, vec3 viewDirection, vec3 lightDirection) {
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 direction = up * uNprAmbientWeights.x + viewDirection * uNprAmbientWeights.y + lightDirection * uNprAmbientWeights.z;
  direction /= max(length(direction), 1e-4);
  float fraction = clamp((dot(surfaceNormal, direction) - uNprAmbientRange.x) /
    max(uNprAmbientRange.y - uNprAmbientRange.x, 1e-4), 0.0, 1.0);
  float steps = max(uNprAmbientSteps, 1.0);
  float band = clamp(fraction * steps - 0.5, 0.0, steps - 1.0);
  return (floor(band) + nprPowerStep(fract(band), uNprDirect.y) + 0.5) / steps;
}
`;
