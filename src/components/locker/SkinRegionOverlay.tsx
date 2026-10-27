import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rasterizeBrush, rasterizeIslandIds, regionOutline, rasterizeSeed } from '../../lib/skinRegions';
import { materialIslands, materialLab, overlayRegion, regionMask } from '../../lib/skinRegionScene';
import { materialBasename } from '../../lib/skinParts';
import { attachViewerHover, viewerPartAt, type ViewerPartHit } from '../../lib/viewerPartPicking';
import type { SkinRegionSeed } from '../../types/skinEditor';

const SIZE = 1024;
/** Alpha over the model: light enough that the texture stays readable under the selection. */
const FILL = 46, HOVER = 96, EDGE = 230;

export interface RegionPicker {
  by: 'piece' | 'color' | 'brush';
  tolerance: number;
  /** Brush radius in screen pixels. */
  brushSize: number;
  remove: boolean;
  /** A finished brush stroke, as one dab per seed. */
  onStroke: (seeds: SkinRegionSeed[]) => void;
}

type Dab = { u: number; v: number; radius: number };
const NO_DABS: SkinRegionSeed[] = [];

/**
 * While selecting: a light fill and a solid edge for the selection, and a brighter fill for what a click,
 * or the brush under the pointer, would change. Without `picker` it just shows a saved area.
 */
export function SkinRegionOverlay({ scene, material, seeds, picker }: {
  scene: THREE.Object3D; material: string; seeds: SkinRegionSeed[]; picker?: RegionPicker;
}) {
  const { invalidate, camera, gl } = useThree();
  const islands = useMemo(() => materialIslands(scene, material), [scene, material]);
  const by = picker?.by, tolerance = picker?.tolerance, brushSize = picker?.brushSize ?? 0;
  const [hovered, setHovered] = useState<Dab | null>(null);
  // Dabs of the stroke in progress, drawn live and committed once on release. Once committed the seeds
  // change, and the seeds hold the stroke instead.
  const [drawn, setDrawn] = useState<{ over: SkinRegionSeed[]; dabs: SkinRegionSeed[] }>({ over: seeds, dabs: [] });
  const stroke = drawn.over === seeds ? drawn.dabs : NO_DABS;
  const currentSeeds = useEffectEvent(() => seeds);
  const finishStroke = useEffectEvent((dabs: SkinRegionSeed[]) => { if (dabs.length) picker?.onStroke(dabs); });
  const removing = useEffectEvent(() => !!picker?.remove);
  useEffect(() => {
    if (!islands || !by) return;
    const canvas = gl.domElement;
    const matches = (hit: ViewerPartHit | null): hit is ViewerPartHit & { uv: THREE.Vector2 } => !!hit?.uv && materialBasename(hit.material) === materialBasename(material);
    const dabAt = (hit: ViewerPartHit & { uv: THREE.Vector2 }): Dab => ({ u: hit.uv.x, v: hit.uv.y, radius: Math.min(1000, (hit.unitsPerPixel ?? 0) * brushSize) });
    // Snap the hover so small moves inside one texel cluster do not rerender.
    const step = 4 / SIZE;
    const detach = attachViewerHover(canvas, scene, camera, (hit) => {
      const next = matches(hit) ? { ...dabAt(hit), u: Math.round(hit.uv.x / step) * step, v: Math.round(hit.uv.y / step) * step } : null;
      setHovered((current) => current?.u === next?.u && current?.v === next?.v && current?.radius === next?.radius ? current : next);
    }, 'crosshair');
    if (by !== 'brush') return () => { detach(); setHovered(null); };
    const raycaster = new THREE.Raycaster();
    const round = (value: number) => Math.round(value * 1e5) / 1e5;
    let active: { pointer: number; dabs: SkinRegionSeed[]; x: number; y: number } | null = null;
    let frame = 0;
    let point = { x: 0, y: 0 };
    const dab = (x: number, y: number) => {
      const hit = viewerPartAt(canvas, scene, camera, raycaster, x, y);
      if (!active || !matches(hit)) return;
      const { u, v, radius } = dabAt(hit);
      active.dabs = [...active.dabs, { u: round(u), v: round(v), by: 'brush', radius: round(radius), ...(removing() ? { remove: true as const } : {}) }];
      active.x = x; active.y = y;
      setDrawn({ over: currentSeeds(), dabs: active.dabs });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      active = { pointer: event.pointerId, dabs: [], x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      dab(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.pointer) return;
      point = { x: event.clientX, y: event.clientY };
      // Space dabs by a third of the brush so a stroke reads as a line, not beads.
      if (frame || Math.hypot(point.x - active.x, point.y - active.y) < Math.max(2, brushSize / 3)) return;
      frame = requestAnimationFrame(() => { frame = 0; dab(point.x, point.y); });
    };
    const up = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.pointer) return;
      const dabs = active.dabs;
      active = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      finishStroke(dabs);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      detach(); setHovered(null);
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [islands, by, brushSize, gl, scene, camera, material]);
  const texture = useRef<THREE.DataTexture | null>(null);
  const strokeMask = useRef({ dabs: 0, mask: new Uint8Array(SIZE * SIZE) });
  useEffect(() => {
    const alpha = new THREE.DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE, THREE.RGBAFormat);
    alpha.magFilter = THREE.LinearFilter; alpha.minFilter = THREE.LinearFilter; alpha.generateMipmaps = false;
    // Seeds and masks wrap texture coordinates, so tiled UVs must sample the same texel here.
    alpha.wrapS = THREE.RepeatWrapping; alpha.wrapT = THREE.RepeatWrapping;
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
    const selected = regionMask(scene, material, seeds, SIZE, SIZE, 0) ?? new Uint8Array(SIZE * SIZE);
    const edge = regionOutline(selected, SIZE, SIZE, 2, rasterizeIslandIds(islands, SIZE, SIZE));
    // The stroke only grows while drawing, so add just its new dabs.
    const live = strokeMask.current;
    if (!stroke.length || stroke.length < live.dabs) { if (live.dabs) live.mask.fill(0); live.dabs = 0; }
    for (const seed of stroke.slice(live.dabs)) {
      rasterizeBrush(islands, seed.u, seed.v, seed.radius ?? 0, SIZE, SIZE, live.mask);
    }
    live.dabs = stroke.length;
    let hint: Uint8Array | null = null;
    if (hovered && by === 'brush') hint = rasterizeBrush(islands, hovered.u, hovered.v, hovered.radius, SIZE, SIZE);
    else if (hovered && by && !stroke.length) {
      const color = by === 'color';
      hint = rasterizeSeed(islands, { u: hovered.u, v: hovered.v, ...(color ? { by: 'color' as const, tolerance } : {}) }, SIZE, SIZE,
        color ? materialLab(scene, material, SIZE, SIZE) : null);
    }
    const drawing = stroke.length > 0;
    const data = alpha.image.data as Uint8Array;
    for (let pixel = 0; pixel < selected.length; pixel++) {
      const value = edge[pixel] ? EDGE : (drawing && live.mask[pixel]) || hint?.[pixel] ? HOVER : selected[pixel] ? FILL : 0;
      data[pixel * 4] = data[pixel * 4 + 1] = data[pixel * 4 + 2] = value;
      data[pixel * 4 + 3] = 255;
    }
    alpha.needsUpdate = true;
    invalidate();
  }, [islands, seeds, hovered, stroke, by, tolerance, scene, material, invalidate]);
  return null;
}
