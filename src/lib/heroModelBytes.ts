import * as THREE from 'three';
import { materialTextures } from './loadGltfPreview';
import { getMorphic } from './source2NprMaterial';

export interface HeroModelBytes {
  /** Uploaded texture levels: RGBA8, plus a third for the mip chain where one is generated. */
  textures: number;
  /** Vertex and index buffers, held on the GPU and, as three keeps them, in the JS heap too. */
  geometry: number;
  /** Each skeleton's float bone texture. */
  skinning: number;
  /** Animation keyframes, in the JS heap only. */
  animation: number;
  /** What the GPU holds for the model: textures, geometry and skinning. */
  gpu: number;
}

function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number; depth?: number; data?: ArrayBufferView } | null;
  if (!image?.width || !image.height) return 0;
  const level = image.data && !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)
    ? image.data.byteLength : image.width * image.height * (image.depth ?? 1) * 4;
  const mipmapped = texture.generateMipmaps && texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
  return Math.round(level * (mipmapped ? 4 / 3 : 1));
}

/** An estimate of the memory a loaded hero model holds, for the viewer's cache budget. */
export function heroModelBytes(root: THREE.Object3D, clips: readonly THREE.AnimationClip[] = []): HeroModelBytes {
  const textures = new Set<THREE.Texture>();
  const buffers = new Set<ArrayBufferView>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) skeletons.add(skinned.skeleton);
    const geometry = mesh.geometry;
    for (const attribute of [...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat(), geometry.index]) {
      if (!attribute) continue;
      buffers.add((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
        ? (attribute as THREE.InterleavedBufferAttribute).data.array : (attribute as THREE.BufferAttribute).array);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      materialTextures(material).forEach((texture) => textures.add(texture));
      Object.values(getMorphic(material)?.resolvedTextures ?? {}).forEach((texture) => textures.add(texture));
    }
  });
  const sizes = {
    textures: [...textures].reduce((sum, texture) => sum + textureBytes(texture), 0),
    geometry: [...buffers].reduce((sum, array) => sum + array.byteLength, 0),
    // three packs four texels per bone into the smallest power-of-two square, at least 4 wide.
    skinning: [...skeletons].reduce((sum, skeleton) => {
      const size = Math.max(4, THREE.MathUtils.ceilPowerOfTwo(Math.ceil(Math.sqrt(skeleton.bones.length * 4))));
      return sum + size * size * 4 * 4;
    }, 0),
    animation: clips.reduce((sum, clip) => sum + clip.tracks.reduce((total, track) => total + track.times.byteLength + track.values.byteLength, 0), 0),
  };
  return { ...sizes, gpu: sizes.textures + sizes.geometry + sizes.skinning };
}
