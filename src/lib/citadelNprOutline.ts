import * as THREE from 'three';
import { flag, getMorphic, hasDynamicTextureOverride } from './source2NprMaterial';
import { decodedAlbedoAverage } from './source2ColorCorrection';

/** Only suppress reconstruction when the game requests no procedural growth. */
function hasZeroOutlineGrowth(material: THREE.Material): boolean {
  const data = getMorphic(material);
  if (!data) return false;
  if (flag(data, 'F_DISABLE_NPR_OUTLINE')) return true;
  const mask = data.resolvedTextures?.g_tNprOutlineMask;
  const image: unknown = mask?.image;
  return !!mask && !!image && typeof image === 'object'
    && 'width' in image && typeof image.width === 'number' && image.width > 0 && image.width <= 4
    && 'height' in image && typeof image.height === 'number' && image.height > 0 && image.height <= 4
    && decodedAlbedoAverage(mask)?.x === 0;
}

/** The marker belongs to a glTF primitive, independent of its material name. */
export function hasAuthoredShellMarker(object: THREE.Object3D): boolean {
  return Object.hasOwn(object.userData, 'morphic_shell');
}

/** Fail closed before any render, including legacy/disabled material modes. */
export function hideAuthoredShells(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    // GLTFLoader attaches primitive extras to BufferGeometry, while node extras
    // go on Object3D. Normalize that boundary before clones and viewer effects.
    if (object instanceof THREE.Mesh && Object.hasOwn(object.geometry.userData, 'morphic_shell')) {
      object.userData.morphic_shell = object.geometry.userData.morphic_shell;
    }
    if (hasAuthoredShellMarker(object)) object.visible = false;
  });
}

/** Authored inverted geometry uses the ordinary single-sided opaque PBR pass.
 * Animated jitter/translucency needs more than the viewer's approximate path. */
export function canRenderAuthoredShell(mesh: THREE.Mesh): boolean {
  const marker: unknown = mesh.userData.morphic_shell;
  if (!marker || typeof marker !== 'object' || !('version' in marker) || marker.version !== 1
    || !('role' in marker) || marker.role !== 'authored_shell') return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.length > 0 && materials.every((material) => {
    const data = getMorphic(material);
    return !!data && data.shader.toLowerCase() === 'pbr.vfx' && flag(data, 'F_USE_NPR_LIGHTING')
      && !['F_GLASS', 'F_TRANSLUCENT', 'F_ADVANCED_TRANSLUCENCY', 'F_ADDITIVE_BLEND',
        'F_ALPHA_TEST', 'F_CLOAK', 'F_UNLIT', 'F_JITTER_VERTICES', 'F_RENDER_BACKFACES']
        .some((name) => flag(data, name))
      && (!data.blend_mode || data.blend_mode === 'opaque') && hasZeroOutlineGrowth(material)
      && Object.keys(data.dynamic_params ?? {}).length === 0
      && Object.keys(data.dynamic_texture_params ?? {}).length === 0;
  });
}

/** Eligibility from pbr's NprLitOutline attribute. Its NprSolidOutline twin
 * covers F_SOLID_COLOR_OUTLINE materials instead, drawn with the runtime
 * D_SOLID_OUTLINE combo: the authored team color the game shows on enemies
 * only. The viewer presents a player's own hero, so those materials get no hull. */
export function hasCitadelNprOutline(material: THREE.Material): boolean {
  const data = getMorphic(material);
  return !!data && data.shader.toLowerCase() === 'pbr.vfx'
    && flag(data, 'F_USE_NPR_LIGHTING') && !flag(data, 'F_UNLIT')
    && !flag(data, 'F_SOLID_COLOR_OUTLINE')
    && !flag(data, 'F_GLASS') && !flag(data, 'F_TRANSLUCENT')
    && !flag(data, 'F_ADVANCED_TRANSLUCENCY')
    && !flag(data, 'F_CLOAK') && !flag(data, 'F_DISABLE_NPR_OUTLINE')
    && !hasDynamicTextureOverride(data, 'g_tNprOutlineMask');
}

/** Share deformed geometry and bone palettes with the visible mesh. */
export function citadelOutlineMesh(source: THREE.Mesh, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  let shell: THREE.Mesh;
  if (source instanceof THREE.SkinnedMesh) {
    const skinned = new THREE.SkinnedMesh(source.geometry, material);
    skinned.skeleton = source.skeleton;
    skinned.bindMode = source.bindMode;
    skinned.bindMatrix.copy(source.bindMatrix);
    skinned.bindMatrixInverse.copy(source.bindMatrixInverse);
    shell = skinned;
  } else {
    shell = new THREE.Mesh(source.geometry, material);
  }
  shell.name = `${source.name}:npr-outline`;
  shell.userData.citadelNprOutline = true;
  shell.morphTargetInfluences = source.morphTargetInfluences;
  shell.morphTargetDictionary = source.morphTargetDictionary;
  shell.layers.mask = source.layers.mask;
  shell.frustumCulled = false;
  shell.renderOrder = source.renderOrder;
  shell.raycast = () => {};
  return shell;
}
