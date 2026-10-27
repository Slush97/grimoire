import * as THREE from 'three';
import { materialBasename } from './skinParts';
import { buildUvIslands, islandsFingerprint, padMask, rasterizeSeeds, rasterizeUsed, texelsToLab, type UvGeometry, type UvIslands } from './skinRegions';
import { getMorphic } from './source2NprMaterial';
import type { SkinRegionSeed } from '../types/skinEditor';

const islandCache = new WeakMap<THREE.Object3D, Map<string, UvIslands | null>>();

function readAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: 2 | 3): Float32Array {
  const values = new Float32Array(attribute.count * size);
  for (let index = 0; index < attribute.count; index++) {
    values[index * size] = attribute.getX(index);
    values[index * size + 1] = attribute.getY(index);
    if (size === 3) values[index * size + 2] = attribute.getZ(index);
  }
  return values;
}

export function isSkinRegionHelper(object: THREE.Object3D): boolean {
  return !!object.userData.skinPartHighlight || !!object.userData.skinRegionOverlay;
}

/** Meshes drawing `material`, with the index range of the matching group when a mesh has several. */
export function materialMeshes(scene: THREE.Object3D, material: string): Array<{ mesh: THREE.Mesh; start?: number; count?: number }> {
  const name = materialBasename(material);
  const found: Array<{ mesh: THREE.Mesh; start?: number; count?: number }> = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || isSkinRegionHelper(object)) return;
    if (!Array.isArray(object.material)) {
      if (materialBasename(object.material.name) === name) found.push({ mesh: object });
      return;
    }
    const materials = object.material;
    for (const group of object.geometry.groups) {
      if (materialBasename(materials[group.materialIndex ?? 0]?.name ?? '') === name) found.push({ mesh: object, start: group.start, count: group.count });
    }
  });
  return found;
}

/** UV islands of every triangle drawing `material`. Cached per scene, since geometry never changes once loaded. */
export function materialIslands(scene: THREE.Object3D, material: string): UvIslands | null {
  let cache = islandCache.get(scene);
  if (!cache) { cache = new Map(); islandCache.set(scene, cache); }
  const key = materialBasename(material);
  if (cache.has(key)) return cache.get(key) ?? null;
  const geometries: UvGeometry[] = [];
  for (const { mesh, start, count } of materialMeshes(scene, material)) {
    const { uv, position } = mesh.geometry.attributes;
    if (!uv || !position) continue;
    const index = mesh.geometry.index;
    geometries.push({ uv: readAttribute(uv, 2), position: readAttribute(position, 3), index: index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : null, start, count });
  }
  const islands = geometries.length ? buildUvIslands(geometries) : null;
  cache.set(key, islands);
  return islands;
}

const texelCache = new WeakMap<THREE.Object3D, Map<string, Float32Array | null>>();

/** The image a material was loaded with, before any preview edit replaced its map. */
function sourceImage(material: THREE.Material): CanvasImageSource | null {
  const candidates: unknown[] = [getMorphic(material)?.resolvedTextures?.g_tColor?.image];
  if ('map' in material && material.map instanceof THREE.Texture) candidates.push(material.map.userData.skinSourceImage, material.map.image);
  const image = candidates.find((value) => value instanceof HTMLImageElement || value instanceof ImageBitmap || value instanceof HTMLCanvasElement);
  return image instanceof HTMLImageElement || image instanceof ImageBitmap || image instanceof HTMLCanvasElement ? image : null;
}

/** The material's original color texture in CIELAB at a size, for color selection. */
export function materialLab(scene: THREE.Object3D, material: string, width: number, height: number): Float32Array | null {
  let cache = texelCache.get(scene);
  if (!cache) { cache = new Map(); texelCache.set(scene, cache); }
  const key = `${materialBasename(material)}|${width}x${height}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let lab: Float32Array | null = null;
  for (const { mesh } of materialMeshes(scene, material)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const image = materials.filter((item) => materialBasename(item.name) === materialBasename(material)).map(sourceImage).find(Boolean);
    if (!image) continue;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) break;
    context.drawImage(image, 0, 0, width, height);
    lab = texelsToLab(context.getImageData(0, 0, width, height).data);
    break;
  }
  cache.set(key, lab);
  return lab;
}

/** Masks per texture layout, so two layouts with the same seeds never share one. */
const maskCache = new WeakMap<UvIslands, Map<string, Uint8Array>>();
/** The last unpadded mask per layout and size, so a growing selection only rasterizes its new seeds. */
const lastMask = new WeakMap<UvIslands, Map<string, { seeds: SkinRegionSeed[]; mask: Uint8Array }>>();

/** Region mask at a size, cached so slider drags reuse the raster. */
export function regionMask(scene: THREE.Object3D, material: string, seeds: SkinRegionSeed[], width: number, height: number, padding = 2, area = ''): Uint8Array | null {
  const islands = materialIslands(scene, material);
  if (!islands) return null;
  let masks = maskCache.get(islands);
  if (!masks) { masks = new Map(); maskCache.set(islands, masks); }
  const key = JSON.stringify([seeds, width, height, padding]);
  const cached = masks.get(key);
  if (cached) { masks.delete(key); masks.set(key, cached); return cached; }
  const lab = seeds.some((seed) => seed.by === 'color') ? materialLab(scene, material, width, height) : null;
  let lasts = lastMask.get(islands);
  if (!lasts) { lasts = new Map(); lastMask.set(islands, lasts); }
  // One running mask per area, so painting one color does not make another replay its whole history.
  const size = `${width}x${height}|${area}`;
  const last = lasts.get(size);
  const grows = last && last.seeds.length <= seeds.length && last.seeds.every((seed, index) => seed === seeds[index]);
  const unpadded = rasterizeSeeds(islands, grows ? seeds.slice(last.seeds.length) : seeds, width, height, lab, 0, grows ? last.mask : undefined);
  lasts.set(size, { seeds, mask: unpadded });
  const mask = padding ? padMask(unpadded, rasterizeUsed(islands, width, height), width, height, padding) : unpadded;
  masks.set(key, mask);
  while (masks.size > 24) {
    const oldest = masks.keys().next().value;
    if (oldest !== undefined) masks.delete(oldest);
  }
  return mask;
}

/** What the editor needs from a loaded model to save areas. */
export interface RegionBaker {
  /** A white-on-black mask PNG data URL, or null when the material is not in this model. */
  bake: (material: string, seeds: SkinRegionSeed[], width: number, height: number) => Promise<string | null>;
  /** The material's texture layout fingerprint, or null when it is not in this model. */
  layout: (material: string) => string | null;
}

export function regionBaker(scene: THREE.Object3D): RegionBaker {
  return {
    bake: async (material, seeds, width, height) => {
      const mask = regionMask(scene, material, seeds, width, height);
      return mask ? regionMaskPng(mask, width, height) : null;
    },
    layout: (material) => {
      const islands = materialIslands(scene, material);
      return islands ? islandsFingerprint(islands) : null;
    },
  };
}

/** White-on-black PNG data URL for the native export. */
export async function regionMaskPng(mask: Uint8Array, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No mask canvas');
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < mask.length; pixel++) {
    image.data[pixel * 4] = image.data[pixel * 4 + 1] = image.data[pixel * 4 + 2] = mask[pixel];
    image.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the area mask');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Draw a UV-space alpha map over every mesh drawing `material`, following skinning. */
export function overlayRegion(scene: THREE.Object3D, material: string, alpha: THREE.Texture, color: THREE.Color): () => void {
  const overlay = new THREE.MeshBasicMaterial({ color, alphaMap: alpha, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // Multi-material meshes share their geometry and hide every group drawing another material.
  const skip = new THREE.MeshBasicMaterial({ visible: false });
  const name = materialBasename(material);
  const added: Array<[THREE.Mesh, THREE.Mesh]> = [];
  for (const mesh of new Set(materialMeshes(scene, material).map(({ mesh }) => mesh))) {
    const materials = Array.isArray(mesh.material) ? mesh.material.map((item) => materialBasename(item.name) === name ? overlay : skip) : overlay;
    const child = mesh instanceof THREE.SkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, materials) : new THREE.Mesh(mesh.geometry, materials);
    if (child instanceof THREE.SkinnedMesh && mesh instanceof THREE.SkinnedMesh) {
      child.bind(mesh.skeleton, mesh.bindMatrix);
      child.bindMatrixInverse.copy(mesh.bindMatrixInverse);
    }
    child.userData.skinRegionOverlay = true;
    child.raycast = () => {};
    child.frustumCulled = mesh.frustumCulled;
    child.renderOrder = mesh.renderOrder + 1;
    mesh.add(child);
    added.push([mesh, child]);
  }
  return () => {
    for (const [mesh, child] of added) mesh.remove(child);
    overlay.dispose(); skip.dispose();
  };
}
