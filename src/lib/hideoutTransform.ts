import * as THREE from 'three';

// morphic converts Source inches/Z-up to glTF metres/Y-up with this basis.
export const SOURCE_TO_GLTF = new THREE.Matrix4().set(
  0, 0.0254, 0, 0,
  0, 0, 0.0254, 0,
  0.0254, 0, 0, 0,
  0, 0, 0, 1,
);

/**
 * Map yaw the viewer camera sits at, seen from the hero, for a spawn yaw. The
 * game's third-person camera looks along the spawn angles from behind the
 * player; the viewer shows the hero's front, so the map turns to keep that
 * camera side. NPR ambient samples the map probes toward the camera, so this
 * side decides the hero's ambient color.
 */
export function hideoutViewHeading(spawnYaw: number): number {
  return spawnYaw + 180;
}

export function hideoutInstanceMatrix(source: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(SOURCE_TO_GLTF, new THREE.Matrix4().fromArray(source)).multiply(SOURCE_TO_GLTF.clone().invert());
}

/** A primitive's own draw tint (vpkmerge `morphic_tint`: the draw call's linear
 * m_vTintColor and m_flAlpha), or null when absent or malformed. */
export function hideoutDrawTint(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  return [value[0], value[1], value[2], value[3]];
}

/**
 * The linear color an instance's materials are multiplied by. As in VRF's scene
 * (Scene.cs), the object tint is the node's sRGB tint times the draw call's tint
 * re-encoded to sRGB, decoded once in the shader.
 */
export function hideoutObjectTint(nodeTint: readonly number[], drawTint: [number, number, number, number] | null): THREE.Color {
  return new THREE.Color().setRGB(...hideoutGammaTint(nodeTint, drawTint)).convertSRGBToLinear();
}

/** The same object tint still in sRGB, for shaders that decode it themselves (world cards). */
export function hideoutGammaTint(nodeTint: readonly number[], drawTint: [number, number, number, number] | null): [number, number, number] {
  const draw = drawTint ? new THREE.Color().setRGB(drawTint[0], drawTint[1], drawTint[2]).convertLinearToSRGB() : new THREE.Color(1, 1, 1);
  return [nodeTint[0] * draw.r, nodeTint[1] * draw.g, nodeTint[2] * draw.b];
}

/**
 * The linear color an exported map material's authored g_vColorTint1 multiplies by, or null
 * to keep the glTF factor. The exporter writes the sRGB tint as the factor; the engine decodes
 * it (VRF MatrixColorTint3: mode 0 multiplies, 2 doubles). pbr.vfx's luminance-preserving
 * mode 1 is left to its NPR material's tint plan.
 */
export function hideoutMaterialTint(morphic: { shader: string; vectors?: Record<string, number[]>; ints?: Record<string, number | number[]> }): THREE.Color | null {
  const tint = morphic.vectors?.g_vColorTint1;
  const value = morphic.ints?.g_nTextureColorTintMode1;
  const mode = Number(Array.isArray(value) ? value[0] : value ?? 0);
  const supported = morphic.shader.startsWith('environment_') || (morphic.shader === 'pbr.vfx' && mode !== 1);
  if (!supported || !tint || tint.length < 3 || !tint.slice(0, 3).every(Number.isFinite)) return null;
  return new THREE.Color().setRGB(tint[0], tint[1], tint[2]).convertSRGBToLinear().multiplyScalar(mode === 2 ? 2 : 1);
}
