import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rasterizeBrush, rasterizeIslandIds, regionOutline, rasterizeSeed, strokeSeeds } from '../../lib/skinRegions';
import { STROKE_PATH_LENGTH } from '../../lib/skinEditSchema';
import { materialIslands, materialLab, overlayRegion, regionMask } from '../../lib/skinRegionScene';
import { materialBasename } from '../../lib/skinParts';
import { attachViewerHover, viewerPartAt, type ViewerPartHit } from '../../lib/viewerPartPicking';
import type { SkinRegionSeed } from '../../types/skinEditor';

const SIZE = 1024;
/** Alpha over the model: light enough that the texture stays readable under the selection. */
const FILL = 46, HOVER = 96, EDGE = 230;
/** A paint preview is mostly opaque, so it reads as the color it will be. */
const PAINT = 200;

export interface RegionPicker {
  by: 'piece' | 'color' | 'brush';
  tolerance: number;
  /** Brush radius in screen pixels. */
  brushSize: number;
  remove: boolean;
  /** A finished brush stroke, as one dab per seed. */
  onStroke: (seeds: SkinRegionSeed[]) => void;
  /** Show what a click or stroke would paint in this color, instead of the accent. */
  tint?: string | null;
}

type Dab = { u: number; v: number; radius: number };
const NO_DABS: SkinRegionSeed[] = [];

/**
 * While selecting: a light fill and a solid edge for the selection, and a brighter fill for what a click,
 * or the brush under the pointer, would change. Without `picker` it just shows a saved area.
 */
/** How long a finished stroke stays drawn when no edit lands, for a stroke that changed nothing. */
const HOLD_MS = 3000;

export function SkinRegionOverlay({ scene, material, seeds, picker, applied = 0 }: {
  scene: THREE.Object3D; material: string; seeds: SkinRegionSeed[]; picker?: RegionPicker;
  /** Bumped each time an edit lands on the model. A finished stroke stays drawn until then. */
  applied?: number;
}) {
  const { invalidate, camera, gl } = useThree();
  const islands = useMemo(() => materialIslands(scene, material), [scene, material]);
  const by = picker?.by, tolerance = picker?.tolerance, brushSize = picker?.brushSize ?? 0, tint = picker?.tint ?? null;
  const [hovered, setHovered] = useState<Dab | null>(null);
  // Dabs of the stroke in progress, drawn live and committed once on release. Once committed the seeds
  // change, and the seeds hold the stroke instead.
  // A released stroke is held (with the edit count at release) until its paint lands, so it never blinks out.
  const [drawn, setDrawn] = useState<{ over: SkinRegionSeed[]; dabs: SkinRegionSeed[]; held?: number }>({ over: seeds, dabs: [] });
  const stroke = drawn.over === seeds && (drawn.held === undefined || drawn.held === applied) ? drawn.dabs : NO_DABS;
  const appliedNow = useEffectEvent(() => applied);
  useEffect(() => {
    if (drawn.held === undefined) return;
    const timer = setTimeout(() => setDrawn((current) => current === drawn ? { over: current.over, dabs: [] } : current), HOLD_MS);
    return () => clearTimeout(timer);
  }, [drawn]);
  const currentSeeds = useEffectEvent(() => seeds);
  const finishStroke = useEffectEvent((dabs: SkinRegionSeed[]) => { if (dabs.length) picker?.onStroke(strokeSeeds(dabs, STROKE_PATH_LENGTH)); });
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
    }, 'crosshair', true);
    if (by !== 'brush') return () => { detach(); setHovered(null); };
    const raycaster = new THREE.Raycaster();
    const round = (value: number) => Math.round(value * 1e5) / 1e5;
    let active: { pointer: number; dabs: SkinRegionSeed[]; x: number; y: number } | null = null;
    let frame = 0;
    let point = { x: 0, y: 0 };
    const dab = (x: number, y: number) => {
      const hit = viewerPartAt(canvas, scene, camera, raycaster, x, y, true);
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
      // Painting shows the stroke in the texture itself, and its seeds never reach this overlay: keep the
      // stroke drawn until that texture lands.
      setDrawn({ over: currentSeeds(), dabs, held: appliedNow() });
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
  const strokeMask = useRef<{ dabs: number; mask: Uint8Array<ArrayBuffer> } | null>(null);
  const lastFill = useRef<{ islands: unknown; tolerance: number | undefined; texel: number; mask: Uint8Array } | null>(null);
  useEffect(() => {
    const alpha = new THREE.DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE, THREE.RGBAFormat);
    // A paint preview shows the paint color; selection feedback uses the accent.
    alpha.magFilter = THREE.LinearFilter; alpha.minFilter = THREE.LinearFilter; alpha.generateMipmaps = false;
    // Seeds and masks wrap texture coordinates, so tiled UVs must sample the same texel here.
    alpha.wrapS = THREE.RepeatWrapping; alpha.wrapT = THREE.RepeatWrapping;
    texture.current = alpha;
    const color = new THREE.Color();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    if (tint) color.set(tint);
    else if (accent) color.set(accent);
    const restore = overlayRegion(scene, material, alpha, color);
    return () => { restore(); alpha.dispose(); texture.current = null; invalidate(); };
  }, [scene, material, tint, invalidate]);
  // The fill and edge only change with the seeds, so hovering reuses them.
  const base = useMemo(() => {
    if (!islands) return null;
    const selected = regionMask(scene, material, seeds, SIZE, SIZE, 0) ?? new Uint8Array(SIZE * SIZE);
    const edge = regionOutline(selected, SIZE, SIZE, 2, rasterizeIslandIds(islands, SIZE, SIZE));
    const layer = new Uint8Array(SIZE * SIZE);
    for (let pixel = 0; pixel < layer.length; pixel++) layer[pixel] = edge[pixel] ? EDGE : selected[pixel] ? FILL : 0;
    return layer;
  }, [islands, scene, material, seeds]);
  useEffect(() => {
    const alpha = texture.current;
    if (!islands || !base || !alpha) return;
    // The stroke only grows while drawing, so add just its new dabs.
    const live = strokeMask.current ??= { dabs: 0, mask: new Uint8Array(SIZE * SIZE) };
    if (!stroke.length || stroke.length < live.dabs) { if (live.dabs) live.mask.fill(0); live.dabs = 0; }
    for (const seed of stroke.slice(live.dabs)) {
      rasterizeBrush(islands, seed.u, seed.v, seed.radius ?? 0, SIZE, SIZE, live.mask);
    }
    live.dabs = stroke.length;
    let hint: Uint8Array | null = null;
    if (hovered && by === 'brush') hint = rasterizeBrush(islands, hovered.u, hovered.v, hovered.radius, SIZE, SIZE);
    else if (hovered && by === 'color' && !stroke.length) {
      const lab = materialLab(scene, material, SIZE, SIZE);
      const texel = Math.min(SIZE - 1, Math.floor((hovered.v - Math.floor(hovered.v)) * SIZE)) * SIZE + Math.min(SIZE - 1, Math.floor((hovered.u - Math.floor(hovered.u)) * SIZE));
      const last = lastFill.current;
      // Moving within a previewed fill of nearly the same color would fill the same texels: reuse them.
      const near = (a: number, b: number) => !!lab && Math.hypot(lab[a * 3] - lab[b * 3], lab[a * 3 + 1] - lab[b * 3 + 1], lab[a * 3 + 2] - lab[b * 3 + 2]) <= (tolerance ?? 0) / 4;
      if (last && last.islands === islands && last.tolerance === tolerance && last.mask[texel] && near(texel, last.texel)) hint = last.mask;
      else {
        hint = rasterizeSeed(islands, { u: hovered.u, v: hovered.v, by: 'color', tolerance }, SIZE, SIZE, lab);
        lastFill.current = { islands, tolerance, texel, mask: hint };
      }
    } else if (hovered && by && !stroke.length) hint = rasterizeSeed(islands, { u: hovered.u, v: hovered.v }, SIZE, SIZE, null);
    const drawing = stroke.length > 0;
    const data = alpha.image.data as Uint8Array;
    for (let pixel = 0; pixel < base.length; pixel++) {
      const value = base[pixel] === EDGE ? EDGE : (drawing && live.mask[pixel]) || hint?.[pixel] ? (tint ? PAINT : HOVER) : base[pixel];
      data[pixel * 4] = data[pixel * 4 + 1] = data[pixel * 4 + 2] = value;
      data[pixel * 4 + 3] = 255;
    }
    alpha.needsUpdate = true;
    invalidate();
  }, [islands, base, hovered, stroke, by, tolerance, tint, scene, material, invalidate]);
  return null;
}
