import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { previewTrippySprite } from '../../lib/api';
import { materialBasename } from '../../lib/skinParts';
import { isSkinSurface } from '../../lib/skinPartPreview';
import type { SkinPartEdit, SkinPartPattern } from '../../types/skinEditor';

function PartPattern({ scene, material, pattern, onError }: { scene: THREE.Object3D; material: string; pattern: SkinPartPattern; onError: () => void }) {
  const textures = useRef<THREE.CanvasTexture[]>([]);
  const { style, intensity, phase, scroll } = pattern;
  useEffect(() => {
    let cancelled = false;
    const restore: Array<() => void> = [];
    const timer = setTimeout(() => {
      void (async () => {
        const sprite = await previewTrippySprite({ style, phase, scroll, intensity: 1, frames: 1, size: 256 });
        const image = new Image();
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = sprite.dataUrl; });
        if (cancelled) return;
        const seen = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
          for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!isSkinSurface(mat) || seen.has(mat) || materialBasename(mat.name) !== materialBasename(material)) continue;
            seen.add(mat);
            const original = mat.map;
            const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
            const context = canvas.getContext('2d');
            if (!context) continue;
            const source: unknown = original?.image;
            if (source instanceof HTMLImageElement || source instanceof ImageBitmap || source instanceof HTMLCanvasElement) context.drawImage(source, 0, 0, 256, 256);
            else { context.fillStyle = 'white'; context.fillRect(0, 0, 256, 256); }
            context.globalCompositeOperation = 'source-atop';
            context.globalAlpha = intensity;
            context.drawImage(image, 0, 0, 256, 256);
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
            texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
            mat.map = texture; mat.needsUpdate = true;
            textures.current.push(texture);
            restore.push(() => { mat.map = original; mat.needsUpdate = true; texture.dispose(); });
          }
        });
      })().catch(() => { if (!cancelled) onError(); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); restore.forEach((reset) => reset()); textures.current = []; };
  }, [scene, material, style, intensity, phase, scroll, onError]);
  useFrame(({ clock }) => { for (const texture of textures.current) texture.offset.set(clock.elapsedTime * pattern.scroll * 0.08, clock.elapsedTime * pattern.scroll * 0.05); });
  return null;
}

export function SkinPartPatterns({ scene, edits, onError }: { scene: THREE.Object3D; edits: SkinPartEdit[]; onError: () => void }) {
  return edits.map((edit) => edit.pattern && !edit.hidden && edit.pattern.intensity > 0
    ? <PartPattern key={edit.material} scene={scene} material={edit.material} pattern={edit.pattern} onError={onError} /> : null);
}
