import * as THREE from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';

export type NprAmbientCube = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
export type ViewerAmbientProbe = { kind: 'pending' } | { kind: 'fallback' } | { kind: 'ready'; sh: THREE.SphericalHarmonics3 };

export const VIEWER_SKY_COLOR = new THREE.Color(96 / 255, 135 / 255, 183 / 255);
export const VIEWER_GROUND_COLOR = new THREE.Color(0.32, 0.25, 0.2);
export const VIEWER_HEMISPHERE_INTENSITY = 1.5;
/** `scene.environmentIntensity` per lighting preset; the ambient cube scales its probe to match. */
export const VIEWER_ENVIRONMENT_INTENSITY = { midtown: 1.6, studio: 1.1 } as const;

/** Diffuse irradiance in world-space +X, -X, +Y, -Y, +Z, -Z order. */
export function viewerAmbientCube(sh: THREE.SphericalHarmonics3, intensity: number, includeHemisphere = true): NprAmbientCube {
  const sample = (x: number, y: number, z: number) => {
    const direction = new THREE.Vector3(x, y, z);
    const irradiance = sh.getIrradianceAt(direction, new THREE.Vector3()).multiplyScalar(intensity);
    const hemisphere = VIEWER_GROUND_COLOR.clone().lerp(VIEWER_SKY_COLOR, y * 0.5 + 0.5);
    if (includeHemisphere) irradiance.add(new THREE.Vector3(hemisphere.r, hemisphere.g, hemisphere.b).multiplyScalar(VIEWER_HEMISPHERE_INTENSITY));
    return irradiance.max(new THREE.Vector3());
  };
  return [sample(1, 0, 0), sample(-1, 0, 0), sample(0, 1, 0), sample(0, -1, 0), sample(0, 0, 1), sample(0, 0, -1)];
}

/** Capture once per environment; reflections keep their full-resolution PMREM. */
export async function captureViewerAmbient(renderer: THREE.WebGLRenderer, environment: THREE.Scene): Promise<THREE.SphericalHarmonics3> {
  const target = new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType, generateMipmaps: false });
  try {
    new THREE.CubeCamera(0.1, 100, target).update(renderer, environment);
    const { sh } = await LightProbeGenerator.fromCubeRenderTarget(renderer, target);
    if (!sh.coefficients.every((coefficient) => coefficient.toArray().every(Number.isFinite))) {
      throw new Error('Non-finite diffuse environment probe');
    }
    return sh;
  } finally {
    target.dispose();
  }
}
