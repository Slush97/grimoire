import * as THREE from 'three';

let texture: Promise<THREE.Texture> | undefined;

/** Shared, point-sampled linear data, indexed by screen pixels in the shader. */
export function loadCitadelGlassNoise(): Promise<THREE.Texture> {
  texture ??= window.electronAPI.getHeroShaderNoise().then(async (url) => {
    const result = await new THREE.TextureLoader().loadAsync(url);
    result.colorSpace = THREE.NoColorSpace;
    result.minFilter = THREE.NearestFilter;
    result.magFilter = THREE.NearestFilter;
    result.generateMipmaps = false;
    result.flipY = false;
    return result;
  }).catch((error: unknown) => { texture = undefined; throw error; });
  return texture;
}
