import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { previewTrippySprite } from '../../lib/api';
import { materialBasename } from '../../lib/skinParts';
import { isSkinSurface } from '../../lib/skinPartPreview';
import { adjustSkinPixels, hasColorAdjustments, ORIGINAL_SKIN_COLOR } from '../../lib/skinColorAdjustments';
import type { SkinPartEdit } from '../../types/skinEditor';

function PartTexture({ scene, edit, onError, onPending }: { scene: THREE.Object3D; edit: SkinPartEdit; onError: () => void; onPending?: (material: string, pending: boolean) => void }) {
  const textures = useRef<THREE.CanvasTexture[]>([]);
  const { material, pattern, adjustments = ORIGINAL_SKIN_COLOR } = edit;
  const { hue, saturation, brightness } = adjustments;
  const style = pattern?.style, intensity = pattern?.intensity ?? 0, phase = pattern?.phase ?? 0, scroll = pattern?.scroll ?? 0;
  useEffect(() => {
    let cancelled = false;
    onPending?.(material, true);
    const restore: Array<() => void> = [];
    const timer = setTimeout(() => {
      void (async () => {
        let patternImage: HTMLImageElement | null = null;
        if (style && intensity > 0) {
          const sprite = await previewTrippySprite({ style, phase, scroll, intensity: 1, frames: 1, size: 256 });
          patternImage = new Image();
          const image = patternImage;
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = sprite.dataUrl; });
        }
        if (cancelled) return;
        const seen = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!isSkinSurface(mat) || seen.has(mat) || materialBasename(mat.name) !== materialBasename(material)) continue;
            seen.add(mat);
            const original = mat.map;
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
            if (patternImage) {
              context.globalCompositeOperation = 'source-atop'; context.globalAlpha = intensity;
              context.drawImage(patternImage, 0, 0, canvas.width, canvas.height);
            }
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            adjustSkinPixels(pixels.data, { hue, saturation, brightness });
            context.putImageData(pixels, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = original?.flipY ?? false;
            texture.wrapS = original?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = original?.wrapT ?? THREE.RepeatWrapping;
            if (original) { texture.repeat.copy(original.repeat); texture.offset.copy(original.offset); texture.rotation = original.rotation; texture.center.copy(original.center); }
            mat.map = texture; mat.needsUpdate = true; textures.current.push(texture);
            restore.push(() => { mat.map = original; mat.needsUpdate = true; texture.dispose(); });
          }
        });
      })().catch(() => { if (!cancelled) onError(); }).finally(() => { if (!cancelled) onPending?.(material, false); });
    }, 75);
    return () => { cancelled = true; onPending?.(material, false); clearTimeout(timer); restore.forEach((reset) => reset()); textures.current = []; };
  }, [scene, material, style, intensity, phase, scroll, hue, saturation, brightness, onError, onPending]);
  useFrame(({ clock }) => { if (scroll > 0) for (const texture of textures.current) texture.offset.set(clock.elapsedTime * scroll * 0.08, clock.elapsedTime * scroll * 0.05); });
  return null;
}

export function SkinPartPatterns({ scene, edits, onError, onPending }: { scene: THREE.Object3D; edits: SkinPartEdit[]; onError: () => void; onPending?: (material: string, pending: boolean) => void }) {
  return edits.map((edit) => !edit.hidden && ((edit.pattern?.intensity ?? 0) > 0 || hasColorAdjustments(edit.adjustments))
    ? <PartTexture key={edit.material} scene={scene} edit={edit} onError={onError} onPending={onPending} /> : null);
}
