import * as THREE from 'three';

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
  };
}

export const NPR_LIGHTING_GLSL = /* glsl */ `
uniform float uNprLighting;
uniform vec4 uNprDirect;
uniform vec2 uNprAmbientRange;
uniform vec3 uNprAmbientWeights;
uniform float uNprAmbientSteps;
uniform vec4 uNprRim;

bool useNprLighting() {
  return uNprLighting > 0.5 && uCelV2 > 0.5;
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
