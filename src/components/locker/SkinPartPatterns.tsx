import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { previewTrippySprite } from '../../lib/api';
import { materialBasename } from '../../lib/skinParts';
import { isSkinSurface } from '../../lib/skinPartPreview';
import { adjustSkinPixels, hasColorAdjustments, hasRegionEdit, ORIGINAL_SKIN_COLOR, repaintSkinPixels } from '../../lib/skinColorAdjustments';
import { blendRegionPixels } from '../../lib/skinRegions';
import { materialIslands, regionMask } from '../../lib/skinRegionScene';
import type { SkinPartEdit, SkinPartPattern, SkinPartRegion } from '../../types/skinEditor';

async function patternImage(pattern: SkinPartPattern): Promise<HTMLImageElement> {
  const { style, phase, colors } = pattern;
  const sprite = await previewTrippySprite({ style, phase, scroll: 0, colors, scale: style === 'moo' ? pattern.scale ?? 1 : 1, intensity: 1, frames: 1, size: style === 'moo' ? 512 : 256 });
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = sprite.dataUrl; });
  return image;
}

/** Paint, pattern, then adjust a copy of `base`, the same order as the whole-part edit and the export. */
function editRegionPixels(base: ImageData, region: SkinPartRegion, pattern: HTMLImageElement | null): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = base.width; canvas.height = base.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No region preview context');
  const pixels = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  if (region.paint) repaintSkinPixels(pixels.data, region.paint);
  if (pattern && region.pattern) {
    context.putImageData(pixels, 0, 0);
    context.globalCompositeOperation = 'source-atop'; context.globalAlpha = region.pattern.intensity;
    context.drawImage(pattern, 0, 0, canvas.width, canvas.height);
    pixels.data.set(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }
  adjustSkinPixels(pixels.data, region.adjustments ?? ORIGINAL_SKIN_COLOR);
  return pixels.data;
}

function PartTexture({ scene, edit, onError, onPending }: { scene: THREE.Object3D; edit: SkinPartEdit; onError: () => void; onPending?: (material: string, pending: boolean) => void }) {
  const textures = useRef(new Map<THREE.Material & Pick<THREE.MeshStandardMaterial, 'map' | 'color'>,
    { original: THREE.Texture | null; texture: THREE.CanvasTexture }>());
  const animationOffset = useRef(new THREE.Vector2());
  const { material, pattern, adjustments = ORIGINAL_SKIN_COLOR, repaint, tint } = edit;
  const paintColor = repaint ? tint : null;
  const { hue, saturation, brightness } = adjustments;
  const style = pattern?.style, intensity = pattern?.intensity ?? 0, phase = pattern?.phase ?? 0, scroll = pattern?.scroll ?? 0;
  const scale = style === 'moo' ? pattern?.scale ?? 1 : 1;
  const colors = pattern?.colors;
  // A string, so the effect reruns only when an applied region actually changes.
  const regionKey = JSON.stringify(edit.regions?.filter(hasRegionEdit) ?? []);
  useEffect(() => {
    const current = textures.current;
    animationOffset.current.set(0, 0);
    return () => {
      for (const [mat, { original, texture }] of current) {
        mat.map = original; mat.needsUpdate = true; texture.dispose();
      }
      current.clear();
    };
  }, [scene, material]);
  useEffect(() => {
    let cancelled = false;
    onPending?.(material, true);
    const replacements = new Map<THREE.Material & Pick<THREE.MeshStandardMaterial, 'map' | 'color'>,
      { original: THREE.Texture | null; texture: THREE.CanvasTexture }>();
    const timer = setTimeout(() => {
      void (async () => {
        const wholePattern = style && intensity > 0 ? await patternImage({ style, intensity, phase, scroll: 0, scale, colors }) : null;
        const regions: SkinPartRegion[] = JSON.parse(regionKey);
        const regionPatterns = await Promise.all(regions.map((region) => region.pattern && region.pattern.intensity > 0 ? patternImage(region.pattern) : null));
        const islands = regions.length ? materialIslands(scene, material) : null;
        if (cancelled) return;
        const seen = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!isSkinSurface(mat) || seen.has(mat) || materialBasename(mat.name) !== materialBasename(material)) continue;
            seen.add(mat);
            const previous = textures.current.get(mat);
            const original = previous ? previous.original : mat.map;
            const source: unknown = original?.image;
            const image = source instanceof HTMLImageElement || source instanceof ImageBitmap || source instanceof HTMLCanvasElement ? source : null;
            const scale = image ? Math.min(1, 1024 / Math.max(image.width, image.height)) : 1;
            const canvas = document.createElement('canvas');
            canvas.width = image ? Math.max(1, Math.round(image.width * scale)) : 256;
            canvas.height = image ? Math.max(1, Math.round(image.height * scale)) : 256;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('No texture preview context');
            if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
            else { context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); }
            // Paint goes on the base first so the pattern keeps its own colors on top, matching vpkmerge's export.
            if (paintColor) {
              const base = context.getImageData(0, 0, canvas.width, canvas.height);
              repaintSkinPixels(base.data, paintColor);
              context.putImageData(base, 0, 0);
            }
            if (wholePattern) {
              context.globalCompositeOperation = 'source-atop'; context.globalAlpha = intensity;
              context.drawImage(wholePattern, 0, 0, canvas.width, canvas.height);
            }
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            adjustSkinPixels(pixels.data, { hue, saturation, brightness });
            if (islands) regions.forEach((region, index) => {
              blendRegionPixels(pixels.data, editRegionPixels(pixels, region, regionPatterns[index]), regionMask(islands, region.seeds, canvas.width, canvas.height));
            });
            context.putImageData(pixels, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = original?.flipY ?? false;
            texture.wrapS = original?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = original?.wrapT ?? THREE.RepeatWrapping;
            if (original) { texture.repeat.copy(original.repeat); texture.offset.copy(original.offset); texture.rotation = original.rotation; texture.center.copy(original.center); }
            texture.offset.add(animationOffset.current);
            replacements.set(mat, { original, texture });
          }
        });
        // Keep the applied maps alive until every replacement is ready.
        for (const [mat, next] of replacements) {
          mat.map = next.texture; mat.needsUpdate = true;
        }
        for (const [mat, previous] of textures.current) {
          if (!replacements.has(mat)) { mat.map = previous.original; mat.needsUpdate = true; }
          previous.texture.dispose();
        }
        textures.current.clear();
        for (const [mat, next] of replacements) textures.current.set(mat, next);
        replacements.clear();
      })().catch(() => {
        replacements.forEach(({ texture }) => texture.dispose());
        if (!cancelled) onError();
      }).finally(() => { if (!cancelled) onPending?.(material, false); });
    }, 75);
    return () => { cancelled = true; onPending?.(material, false); clearTimeout(timer); };
  }, [scene, material, style, intensity, phase, colors, scale, hue, saturation, brightness, paintColor, regionKey, onError, onPending]);
  useFrame((_state, delta) => {
    if (scroll <= 0) return;
    const x = delta * scroll * .08, y = delta * scroll * .05;
    animationOffset.current.x += x; animationOffset.current.y += y;
    for (const { original, texture } of textures.current.values()) {
      texture.offset.set((original?.offset.x ?? 0) + animationOffset.current.x, (original?.offset.y ?? 0) + animationOffset.current.y);
    }
  });
  return null;
}

export function SkinPartPatterns({ scene, edits, onError, onPending }: { scene: THREE.Object3D; edits: SkinPartEdit[]; onError: () => void; onPending?: (material: string, pending: boolean) => void }) {
  return edits.map((edit) => !edit.hidden && ((edit.pattern?.intensity ?? 0) > 0 || hasColorAdjustments(edit.adjustments) || (edit.repaint && edit.tint) || edit.regions?.some(hasRegionEdit))
    ? <PartTexture key={edit.material} scene={scene} edit={edit} onError={onError} onPending={onPending} /> : null);
}
