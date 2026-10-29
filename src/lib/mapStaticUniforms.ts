import * as THREE from 'three';

// Only authored map inputs, immutable for a prepared scene. Three's own light
// uniforms include animated particle lights and must keep their normal updates.
const STATIC_MAP_ARRAYS = new Set([
  'source2LightFromMap', 'source2LightColor', 'source2LightSize', 'source2LightShearSoft',
  'source2LightFalloff', 'source2LightShadow', 'source2LightCone', 'source2LightCookie', 'source2LightBounds', 'source2LightCookieMean',
  'source2VolumeFromMap', 'source2VolumeSize', 'source2VolumeOffset', 'source2VolumeFade',
]);

/** WebGLUniforms.flatten's layout, computed once for immutable authored arrays. */
export function flattenMapUniform(value: unknown): Float32Array | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  if (!(first instanceof THREE.Matrix4 || first instanceof THREE.Matrix3 || first instanceof THREE.Vector4
    || first instanceof THREE.Vector3 || first instanceof THREE.Vector2)) return null;
  const width = first instanceof THREE.Matrix4 ? 16 : first instanceof THREE.Matrix3 ? 9
    : first instanceof THREE.Vector4 ? 4 : first instanceof THREE.Vector3 ? 3 : first instanceof THREE.Vector2 ? 2 : 0;
  if (!width) return null;
  const flattened = new Float32Array(value.length * width);
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (!(item instanceof THREE.Matrix4 || item instanceof THREE.Matrix3 || item instanceof THREE.Vector4
      || item instanceof THREE.Vector3 || item instanceof THREE.Vector2) || item.constructor !== first.constructor) return null;
    const offset = i * width;
    if (item instanceof THREE.Matrix4 || item instanceof THREE.Matrix3) flattened.set(item.elements, offset);
    else if (item instanceof THREE.Vector4) flattened.set([item.x, item.y, item.z, item.w], offset);
    else if (item instanceof THREE.Vector3) flattened.set([item.x, item.y, item.z], offset);
    else flattened.set([item.x, item.y], offset);
  }
  return flattened;
}

const installed = new WeakMap<THREE.Material, { restore: () => void }>();

export function cacheMapUniformValues(uniforms: Record<string, THREE.IUniform>): () => void {
  const originals: { uniform: THREE.IUniform; value: unknown }[] = [];
  for (const name of STATIC_MAP_ARRAYS) {
    const uniform = uniforms[name];
    if (!uniform) continue;
    const flattened = flattenMapUniform(uniform.value);
    if (!flattened) continue;
    originals.push({ uniform, value: uniform.value });
    uniform.value = flattened;
  }
  return () => { for (const { uniform, value } of originals) uniform.value = value; };
}

/** Reversible representation change only. Shader math and uniform values stay identical. */
export function cacheMapStaticUniforms(material: THREE.Material, enabled = true): () => void {
  const previous = installed.get(material);
  if (previous) {
    if (!enabled) previous.restore();
    else return previous.restore;
  }
  if (!enabled) return () => {};
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey, cacheKey = key.call(material);
  const restores: (() => void)[] = [];
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    restores.push(cacheMapUniformValues(shader.uniforms));
  };
  const entry = { restore: () => {
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = key;
    restores.forEach(restore => restore());
    installed.delete(material);
  } };
  installed.set(material, entry);
  return entry.restore;
}
