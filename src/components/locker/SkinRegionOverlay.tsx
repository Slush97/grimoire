import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { islandsAt, rasterizeRegion, regionOutline } from '../../lib/skinRegions';
import { materialIslands, overlayRegion, regionMask } from '../../lib/skinRegionScene';
import { materialBasename } from '../../lib/skinParts';
import { attachViewerHover } from '../../lib/viewerPartPicking';
import type { SkinRegionSeed } from '../../types/skinEditor';

const SIZE = 1024;
const FILL = 72, HOVER = 120, EDGE = 255;

/**
 * While selecting: a light fill and a solid edge for the selection, and a brighter fill for what a click would change.
 * `interactive` false just shows a saved area, for example while its name is hovered.
 */
export function SkinRegionOverlay({ scene, material, seeds, interactive = true }: {
  scene: THREE.Object3D; material: string; seeds: SkinRegionSeed[]; interactive?: boolean;
}) {
  const { invalidate, camera, gl } = useThree();
  const islands = useMemo(() => materialIslands(scene, material), [scene, material]);
  // The hovered islands as a string, so moving within one island does not rerender.
  const [hovered, setHovered] = useState('');
  useEffect(() => {
    if (!islands || !interactive) return;
    const detach = attachViewerHover(gl.domElement, scene, camera, (hit) => setHovered(hit?.uv && materialBasename(hit.material) === materialBasename(material)
      ? islandsAt(islands, hit.uv.x, hit.uv.y).sort((a, b) => a - b).join(',') : ''), 'crosshair');
    return () => { detach(); setHovered(''); };
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
  useEffect(() => {
    const alpha = texture.current;
    if (!islands || !alpha) return;
    const selected = regionMask(islands, seeds, SIZE, SIZE, 0);
    const edge = regionOutline(selected, SIZE, SIZE, 2);
    const hoverMask = hovered ? rasterizeRegion(islands, new Set(hovered.split(',').map(Number)), SIZE, SIZE, 0) : null;
    const data = alpha.image.data as Uint8Array;
    for (let pixel = 0; pixel < selected.length; pixel++) {
      const value = edge[pixel] ? EDGE : hoverMask?.[pixel] ? HOVER : selected[pixel] ? FILL : 0;
      data[pixel * 4] = data[pixel * 4 + 1] = data[pixel * 4 + 2] = value;
      data[pixel * 4 + 3] = 255;
    }
    alpha.needsUpdate = true;
    invalidate();
  }, [islands, seeds, hovered, scene, material, invalidate]);
  return null;
}
