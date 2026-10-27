import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { regionOutline, rasterizeSeed } from '../../lib/skinRegions';
import { materialIslands, materialLab, overlayRegion, regionMask } from '../../lib/skinRegionScene';
import { materialBasename } from '../../lib/skinParts';
import { attachViewerHover } from '../../lib/viewerPartPicking';
import type { SkinRegionSeed } from '../../types/skinEditor';

const SIZE = 1024;
/** Alpha over the model: light enough that the texture stays readable under the selection. */
const FILL = 46, HOVER = 96, EDGE = 230;

export interface RegionPicker {
  by: 'piece' | 'color';
  tolerance: number;
}

/**
 * While selecting: a light fill and a solid edge for the selection, and a brighter fill for what a click would change.
 * Without `picker` it just shows a saved area, for example while its name is hovered.
 */
export function SkinRegionOverlay({ scene, material, seeds, picker }: {
  scene: THREE.Object3D; material: string; seeds: SkinRegionSeed[]; picker?: RegionPicker;
}) {
  const { invalidate, camera, gl } = useThree();
  const islands = useMemo(() => materialIslands(scene, material), [scene, material]);
  // The hovered texture point, snapped so small moves inside one texel cluster do not rerender.
  const [hovered, setHovered] = useState<{ u: number; v: number } | null>(null);
  const interactive = !!picker;
  useEffect(() => {
    if (!islands || !interactive) return;
    const step = 4 / SIZE;
    const detach = attachViewerHover(gl.domElement, scene, camera, (hit) => {
      const next = hit?.uv && materialBasename(hit.material) === materialBasename(material)
        ? { u: Math.round(hit.uv.x / step) * step, v: Math.round(hit.uv.y / step) * step } : null;
      setHovered((current) => current?.u === next?.u && current?.v === next?.v ? current : next);
    }, 'crosshair');
    return () => { detach(); setHovered(null); };
  }, [islands, interactive, gl, scene, camera, material]);
  const texture = useRef<THREE.DataTexture | null>(null);
  useEffect(() => {
    const alpha = new THREE.DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE, THREE.RGBAFormat);
    alpha.magFilter = THREE.LinearFilter; alpha.minFilter = THREE.LinearFilter; alpha.generateMipmaps = false;
    texture.current = alpha;
    const color = new THREE.Color();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    if (accent) color.set(accent);
    const restore = overlayRegion(scene, material, alpha, color);
    return () => { restore(); alpha.dispose(); texture.current = null; invalidate(); };
  }, [scene, material, invalidate]);
  const by = picker?.by, tolerance = picker?.tolerance;
  useEffect(() => {
    const alpha = texture.current;
    if (!islands || !alpha) return;
    const selected = regionMask(scene, material, seeds, SIZE, SIZE, 0) ?? new Uint8Array(SIZE * SIZE);
    const edge = regionOutline(selected, SIZE, SIZE, 2);
    let hoverMask: Uint8Array | null = null;
    if (hovered && by) {
      const color = by === 'color';
      hoverMask = rasterizeSeed(islands, { ...hovered, ...(color ? { by: 'color' as const, tolerance } : {}) }, SIZE, SIZE,
        color ? materialLab(scene, material, SIZE, SIZE) : null);
    }
    const data = alpha.image.data as Uint8Array;
    for (let pixel = 0; pixel < selected.length; pixel++) {
      const value = edge[pixel] ? EDGE : hoverMask?.[pixel] ? HOVER : selected[pixel] ? FILL : 0;
      data[pixel * 4] = data[pixel * 4 + 1] = data[pixel * 4 + 2] = value;
      data[pixel * 4 + 3] = 255;
    }
    alpha.needsUpdate = true;
    invalidate();
  }, [islands, seeds, hovered, by, tolerance, scene, material, invalidate]);
  return null;
}
