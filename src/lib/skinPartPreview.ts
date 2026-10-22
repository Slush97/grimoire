import * as THREE from 'three';
import { editForMaterial, materialBasename } from './skinParts';
import { getMorphic } from './source2NprMaterial';
import type { SkinPartEdit, SkinPartTexture } from '../types/skinEditor';

export function isSkinSurface(material: THREE.Material): material is THREE.Material & Pick<THREE.MeshStandardMaterial, 'map' | 'color'> {
  return 'map' in material && (material.map === null || material.map instanceof THREE.Texture)
    && 'color' in material && material.color instanceof THREE.Color;
}

export function isEditorMaterial(material: THREE.Material): material is THREE.Material & {
  uniforms: { uEditorSelected: THREE.IUniform<number>; uEditorSelectedColor: THREE.IUniform<THREE.Color> };
} {
  if (!('uniforms' in material) || !material.uniforms || typeof material.uniforms !== 'object') return false;
  const selected: unknown = Reflect.get(material.uniforms, 'uEditorSelected');
  const tint: unknown = Reflect.get(material.uniforms, 'uEditorSelectedColor');
  return !!selected && typeof selected === 'object' && 'value' in selected && typeof selected.value === 'number'
    && !!tint && typeof tint === 'object' && 'value' in tint && tint.value instanceof THREE.Color;
}

export function applySkinPartEdits(scene: THREE.Object3D, edits: SkinPartEdit[], wireframe: boolean): () => void {
  const restore: Array<() => void> = [];
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      const edit = editForMaterial(material.name, edits);
      const visible = material.visible;
      material.visible = visible && !edit?.hidden;
      restore.push(() => { material.visible = visible; });
      if ('wireframe' in material && typeof material.wireframe === 'boolean') {
        const previous = material.wireframe;
        material.wireframe = wireframe;
        restore.push(() => { material.wireframe = previous; });
      }
      if (isSkinSurface(material) && !('uniforms' in material)) {
        const color = material.color.clone();
        if (edit?.tint) material.color.set(edit.tint);
        restore.push(() => { material.color.copy(color); });
      }
    }
  });
  return () => restore.forEach((reset) => reset());
}

export function highlightSkinPart(scene: THREE.Object3D, name: string, color: THREE.Color): () => void {
  const meshes: THREE.Mesh[] = [];
  const restore: Array<() => void> = [];
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (materialBasename(material.name) !== materialBasename(name) || !material.visible) continue;
      if (isEditorMaterial(material)) {
        if (seen.has(material)) continue;
        seen.add(material);
        const previous = material.uniforms.uEditorSelected.value;
        const tint = material.uniforms.uEditorSelectedColor.value.clone();
        material.uniforms.uEditorSelected.value = 1;
        material.uniforms.uEditorSelectedColor.value.copy(color);
        restore.push(() => { material.uniforms.uEditorSelected.value = previous; material.uniforms.uEditorSelectedColor.value.copy(tint); });
      } else meshes.push(object);
    }
  });
  const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const wire = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, transparent: true, opacity: 0.95, depthWrite: false });
  wire.onBeforeCompile = (shader) => {
    shader.uniforms.skinPartOutlineWidth = { value: 0.012 };
    shader.vertexShader = `uniform float skinPartOutlineWidth;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * skinPartOutlineWidth;');
  };
  wire.customProgramCacheKey = () => 'skin-part-outline-v2';
  const overlays = meshes.flatMap((mesh) => [fill, wire].map((material) => {
    const overlay = mesh instanceof THREE.SkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
    if (overlay instanceof THREE.SkinnedMesh && mesh instanceof THREE.SkinnedMesh) {
      overlay.bind(mesh.skeleton, mesh.bindMatrix);
      overlay.bindMatrixInverse.copy(mesh.bindMatrixInverse);
    }
    overlay.userData.skinPartHighlight = true;
    overlay.raycast = () => {};
    mesh.add(overlay);
    return overlay;
  }));
  return () => { restore.forEach((reset) => reset()); overlays.forEach((overlay) => overlay.removeFromParent()); fill.dispose(); wire.dispose(); };
}

/** Dominant opaque albedo bucket, excluding black outlines and transparent padding. */
export function dominantSkinColor(pixels: Uint8ClampedArray | Uint8Array): string {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const opaque = { count: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.subarray(i, i + 4);
    if (a < 128) continue;
    opaque.count++; opaque.r += r; opaque.g += g; opaque.b += b;
    if (Math.max(r, g, b) < 32) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0] ?? (opaque.count ? opaque : null);
  return best ? `#${[best.r, best.g, best.b].map((value) => Math.round(value / best.count).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
}

export function skinPartColors(scene: THREE.Object3D): Record<string, string> {
  const colors: Record<string, string> = {};
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const name = materialBasename(material.name);
      if (colors[name]) continue;
      const morphic = getMorphic(material);
      const tint = morphic?.vectors?.g_vColorTint1;
      const source = morphic?.resolvedTextures?.g_tColor ?? (isSkinSurface(material) ? material.map : null);
      const image: unknown = source?.image;
      if (context && (image instanceof HTMLImageElement || image instanceof ImageBitmap || image instanceof HTMLCanvasElement)) {
        context.clearRect(0, 0, 64, 64);
        context.drawImage(image, 0, 0, 64, 64);
        const pixels = context.getImageData(0, 0, 64, 64).data;
        if (tint && tint.length >= 3) for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] *= tint[0]; pixels[i + 1] *= tint[1]; pixels[i + 2] *= tint[2];
        }
        colors[name] = dominantSkinColor(pixels);
      } else {
        const color = isSkinSurface(material) ? material.color : new THREE.Color();
        colors[name] = `#${color.getHexString()}`;
      }
    }
  });
  return colors;
}

export function skinPartTextures(scene: THREE.Object3D): Record<string, SkinPartTexture> {
  const result: Record<string, SkinPartTexture> = {};
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return result;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const name = materialBasename(material.name);
      if (result[name]) continue;
      const morphic = getMorphic(material);
      const source = morphic?.resolvedTextures?.g_tColor ?? (isSkinSurface(material) ? material.map : null);
      const image: unknown = source?.image;
      if (!(image instanceof HTMLImageElement || image instanceof ImageBitmap || image instanceof HTMLCanvasElement)) continue;
      context.clearRect(0, 0, 64, 64);
      context.drawImage(image, 0, 0, 64, 64);
      result[name] = { thumbnail: canvas.toDataURL('image/png'), width: image.width, height: image.height };
    }
  });
  return result;
}
