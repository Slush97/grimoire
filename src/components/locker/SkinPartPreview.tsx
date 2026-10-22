import { useEffect } from 'react';
import * as THREE from 'three';
import { applySkinPartEdits, highlightSkinPart, skinPartColors } from '../../lib/skinPartPreview';
import type { SkinPartEdit } from '../../types/skinEditor';

export function SkinPartPreview({ scene, edits, wireframe, highlight, onColors }: {
  scene: THREE.Object3D; edits: SkinPartEdit[]; wireframe: boolean; highlight: string | null;
  onColors?: (colors: Record<string, string>) => void;
}) {
  useEffect(() => applySkinPartEdits(scene, edits, wireframe), [scene, edits, wireframe]);
  useEffect(() => {
    if (!highlight) return;
    const color = new THREE.Color();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    if (accent) color.set(accent);
    return highlightSkinPart(scene, highlight, color);
  }, [scene, highlight, edits]);
  useEffect(() => {
    if (onColors) onColors(skinPartColors(scene));
  }, [scene, onColors]);
  return null;
}
