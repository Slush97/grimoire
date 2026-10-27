import { useEffect, useEffectEvent, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { previewTrippySprite } from '../../lib/api';
import { materialBasename } from '../../lib/skinParts';
import { applySkinTransparency, isSkinSurface } from '../../lib/skinPartPreview';
import { GLOW_STRENGTH, glowStrength } from '../../lib/skinFinishes';
import { adjustSkinPixels, hasColorAdjustments, hasRegionLook, isClearRegion, isFinishRegion, isGlowRegion, meanLuminance, ORIGINAL_SKIN_COLOR, repaintSkinPixels } from '../../lib/skinColorAdjustments';
import { blendRegionPixels } from '../../lib/skinRegions';
import { regionMask } from '../../lib/skinRegionScene';
import type { SkinColorAdjustments, SkinPartEdit, SkinPartFinish, SkinPartGlow, SkinPartPattern, SkinPartRegion, SkinRegionSeed } from '../../types/skinEditor';

async function patternImage(pattern: SkinPartPattern): Promise<HTMLImageElement> {
  const { style, phase, colors } = pattern;
  const sprite = await previewTrippySprite({ style, phase, scroll: 0, colors, scale: style === 'moo' ? pattern.scale ?? 1 : 1, intensity: 1, frames: 1, size: style === 'moo' ? 512 : 256 });
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = sprite.dataUrl; });
  return image;
}

/** Paint and adjust only the texels an area covers: the same result as `editRegionPixels` without a pattern, without copying the texture. */
function paintRegionPixels(pixels: Uint8ClampedArray, mask: Uint8Array, paint: string | null, adjustments: SkinColorAdjustments): void {
  const texel = new Uint8ClampedArray(4);
  const mean = paint ? meanLuminance(pixels, mask) : 0;
  for (let index = 0; index < mask.length; index++) {
    const weight = mask[index] / 255;
    if (!weight) continue;
    const offset = index * 4;
    texel.set(pixels.subarray(offset, offset + 4));
    if (paint) repaintSkinPixels(texel, paint, mean);
    adjustSkinPixels(texel, adjustments);
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(pixels[offset + channel] + (texel[channel] - pixels[offset + channel]) * weight);
  }
}

/** Paint, pattern, then adjust a copy of `base`, the same order as the whole-part edit and the export. */
function editRegionPixels(base: ImageData, region: SkinPartRegion, pattern: HTMLImageElement | null, mask: Uint8Array): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = base.width; canvas.height = base.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No region preview context');
  const pixels = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  if (region.paint) repaintSkinPixels(pixels.data, region.paint, meanLuminance(base.data, mask));
  if (pattern && region.pattern) {
    context.putImageData(pixels, 0, 0);
    context.globalCompositeOperation = 'source-atop'; context.globalAlpha = region.pattern.intensity;
    context.drawImage(pattern, 0, 0, canvas.width, canvas.height);
    pixels.data.set(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }
  adjustSkinPixels(pixels.data, region.adjustments ?? ORIGINAL_SKIN_COLOR);
  return pixels.data;
}

function PartTexture({ scene, edit, onError, onPending, onApplied }: { scene: THREE.Object3D; edit: SkinPartEdit; onError: () => void;
  onPending?: (material: string, pending: boolean) => void; onApplied?: () => void }) {
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
  const regionKey = JSON.stringify(edit.regions?.filter(hasRegionLook) ?? []);
  // Paint strokes redraw at once; slider drags still wait a moment so they do not queue redraws.
  const lastRegions = useRef(regionKey);
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
    const delay = regionKey !== lastRegions.current ? 0 : 75;
    lastRegions.current = regionKey;
    const timer = setTimeout(() => {
      void (async () => {
        const wholePattern = style && intensity > 0 ? await patternImage({ style, intensity, phase, scroll: 0, scale, colors }) : null;
        const regions: SkinPartRegion[] = JSON.parse(regionKey);
        const regionPatterns = await Promise.all(regions.map((region) => region.pattern && region.pattern.intensity > 0 ? patternImage(region.pattern) : null));
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
            regions.forEach((region, index) => {
              const mask = regionMask(scene, material, region.seeds, canvas.width, canvas.height, 2, region.id);
              if (!mask) return;
              if (regionPatterns[index]) blendRegionPixels(pixels.data, editRegionPixels(pixels, region, regionPatterns[index], mask), mask);
              else paintRegionPixels(pixels.data, mask, region.paint ?? null, region.adjustments ?? ORIGINAL_SKIN_COLOR);
            });
            context.putImageData(pixels, 0, 0);
            const texture = new THREE.CanvasTexture(canvas);
            // Color selection reads the loaded texture, not this edited copy.
            texture.userData.skinSourceImage = image;
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
        onApplied?.();
      })().catch(() => {
        replacements.forEach(({ texture }) => texture.dispose());
        if (!cancelled) onError();
      }).finally(() => { if (!cancelled) onPending?.(material, false); });
    }, delay);
    return () => { cancelled = true; onPending?.(material, false); clearTimeout(timer); };
  }, [scene, material, style, intensity, phase, colors, scale, hue, saturation, brightness, paintColor, regionKey, onError, onPending, onApplied]);
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

type FinishMaterial = THREE.Material & Pick<THREE.MeshStandardMaterial, 'roughness' | 'metalness' | 'roughnessMap' | 'metalnessMap' | 'map'>;

/** One channel of a finish map as 0..255 values: the map's texels times its scalar, or the scalar alone. */
function finishChannel(texture: THREE.Texture | null, scalar: number, channel: number, width: number, height: number): Float32Array {
  const values = new Float32Array(width * height).fill(scalar * 255);
  const source: unknown = texture?.image;
  if (!(source instanceof HTMLImageElement || source instanceof ImageBitmap || source instanceof HTMLCanvasElement)) return values;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return values;
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 0; index < values.length; index++) values[index] = pixels[index * 4 + channel] * scalar;
  return values;
}

/**
 * Shine areas: a roughness and metalness map with each area's finish blended in by its mask, on the
 * same UVs as the color texture. The material scalars become 1 so the map alone decides.
 */
function PartFinish({ scene, material, whole, regions, onApplied }: { scene: THREE.Object3D; material: string; whole?: SkinPartFinish; regions: SkinPartRegion[]; onApplied?: () => void }) {
  const regionKey = JSON.stringify(regions);
  const roughness = whole?.roughness, metalness = whole?.metalness;
  useEffect(() => {
    const areas: SkinPartRegion[] = JSON.parse(regionKey);
    const restore: Array<() => void> = [];
    const seen = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
      for (const mat of (Array.isArray(object.material) ? object.material : [object.material]) as FinishMaterial[]) {
        if (seen.has(mat) || materialBasename(mat.name) !== materialBasename(material) || !('roughnessMap' in mat) || !('metalnessMap' in mat)) continue;
        seen.add(mat);
        const map = mat.map;
        const size: unknown = map?.image;
        const scale = size instanceof HTMLImageElement || size instanceof ImageBitmap || size instanceof HTMLCanvasElement ? Math.min(1, 1024 / Math.max(size.width, size.height)) : 0;
        const width = scale ? Math.max(1, Math.round((size as { width: number }).width * scale)) : 512;
        const height = scale ? Math.max(1, Math.round((size as { height: number }).height * scale)) : 512;
        // The base is the whole-part finish when there is one, else the part's own maps.
        const rough = roughness !== undefined ? new Float32Array(width * height).fill(roughness * 255) : finishChannel(mat.roughnessMap, mat.roughness, 1, width, height);
        const metal = metalness !== undefined ? new Float32Array(width * height).fill(metalness * 255) : finishChannel(mat.metalnessMap, mat.metalness, 2, width, height);
        for (const area of areas) {
          if (!area.finish) continue;
          const mask = regionMask(scene, material, area.seeds, width, height, 2, area.id);
          if (!mask) continue;
          const r = area.finish.roughness * 255, m = area.finish.metalness * 255;
          for (let index = 0; index < mask.length; index++) {
            const weight = mask[index] / 255;
            if (!weight) continue;
            rough[index] += (r - rough[index]) * weight;
            metal[index] += (m - metal[index]) * weight;
          }
        }
        const data = new Uint8Array(width * height * 4);
        for (let index = 0; index < rough.length; index++) {
          data[index * 4 + 1] = rough[index]; data[index * 4 + 2] = metal[index]; data[index * 4 + 3] = 255;
        }
        const texture = new THREE.DataTexture(data, width, height);
        texture.flipY = map?.flipY ?? false;
        texture.wrapS = map?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = map?.wrapT ?? THREE.RepeatWrapping;
        if (map) { texture.repeat.copy(map.repeat); texture.offset.copy(map.offset); texture.rotation = map.rotation; texture.center.copy(map.center); }
        texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
        texture.needsUpdate = true;
        const previous = { roughness: mat.roughness, metalness: mat.metalness, roughnessMap: mat.roughnessMap, metalnessMap: mat.metalnessMap };
        Object.assign(mat, { roughness: 1, metalness: 1, roughnessMap: texture, metalnessMap: texture });
        mat.needsUpdate = true;
        restore.push(() => { Object.assign(mat, previous); mat.needsUpdate = true; texture.dispose(); });
      }
    });
    onApplied?.();
    return () => restore.forEach((reset) => reset());
  }, [scene, material, regionKey, roughness, metalness, onApplied]);
  return null;
}

/** `onApplied` fires each time an edit lands on the model, so a live stroke preview can stay until then. */
type GlowMaterial = THREE.Material & Pick<THREE.MeshStandardMaterial, 'emissive' | 'emissiveMap' | 'emissiveIntensity' | 'map'>;
/** Emissive brightness of painted glow at the default strength, on materials without the hero shader. */
const GLOW_PREVIEW = 2.5;
/** Lights one material: tint (0..1 per channel) and level (1 at the default strength). */
type GlowLight = (r: number, g: number, b: number, level: number) => void;
type SelfIllumNumber = 'uHasSelfIllum' | 'uSelfIllumScale' | 'uSelfIllumPulse' | 'uSelfIllumAlbedoFactor' | 'uSelfIllumCap' | 'uSelfIllumSat' | 'uSelfIllumMaskShaping';
type SelfIllumUniforms = Record<SelfIllumNumber, THREE.IUniform<number>>
  & { uSelfIllumMap: THREE.IUniform<THREE.Texture>; uSelfIllumScroll: THREE.IUniform<THREE.Vector2>; uSelfIllumTint: THREE.IUniform<THREE.Color> };
const SELF_ILLUM_NUMBERS: SelfIllumNumber[] = ['uHasSelfIllum', 'uSelfIllumScale', 'uSelfIllumPulse', 'uSelfIllumAlbedoFactor', 'uSelfIllumCap', 'uSelfIllumSat', 'uSelfIllumMaskShaping'];

/** The hero (toon) shader draws Source 2 self-illumination itself and ignores three's emissive channel. */
function selfIllumUniforms(material: THREE.Material): SelfIllumUniforms | null {
  const uniforms: unknown = Reflect.get(material, 'uniforms');
  return uniforms && typeof uniforms === 'object' && 'uHasSelfIllum' in uniforms && 'uSelfIllumMap' in uniforms ? uniforms as SelfIllumUniforms : null;
}

/** The glow's tint: white when it glows in the paint's own colors. */
function glowTint(color: string, paintColors: boolean): [number, number, number] {
  if (paintColors) return [1, 1, 1];
  const value = new THREE.Color(color);
  return [value.r, value.g, value.b];
}

/** Three.js uniforms are mutable scene state, not React state. */
function setUniform<T>(uniform: THREE.IUniform<T>, value: T): void {
  Reflect.set(uniform, 'value', value);
}

/**
 * Glow over an area, or the whole part without one, pulsing or cycling the way the exported dynamic
 * expressions do. On hero materials it drives the shader's own self-illumination (mask, tint, scale and
 * albedo factor, the parameters the export writes); elsewhere it uses three's emissive map.
 */
function PartGlow({ scene, material, region, glow, onApplied }: { scene: THREE.Object3D; material: string; region: SkinPartRegion | null; glow: SkinPartGlow; onApplied?: () => void }) {
  const seedKey = region ? JSON.stringify(region.seeds) : '';
  const regionId = region?.id ?? '';
  const { color, animation, paintColors = false } = glow;
  const level = glowStrength(glow.strength) / GLOW_STRENGTH;
  const speed = glow.speed ?? 1;
  const lights = useRef<GlowLight[]>([]);
  // Color, brightness and animation only retune the lights (below and per frame); they never rebuild the mask.
  const currentTint = useEffectEvent(() => glowTint(color, paintColors));
  const currentLevel = useEffectEvent(() => level);
  useEffect(() => {
    const seeds: SkinRegionSeed[] | null = seedKey ? JSON.parse(seedKey) : null;
    const restore: Array<() => void> = [];
    const seen = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
      for (const mat of (Array.isArray(object.material) ? object.material : [object.material]) as GlowMaterial[]) {
        if (seen.has(mat) || materialBasename(mat.name) !== materialBasename(material)) continue;
        const uniforms = selfIllumUniforms(mat);
        if (!uniforms && !('emissiveMap' in mat && mat.emissive instanceof THREE.Color)) continue;
        seen.add(mat);
        const size: unknown = mat.map?.image;
        const sized = size instanceof HTMLImageElement || size instanceof ImageBitmap || size instanceof HTMLCanvasElement;
        const scale = sized ? Math.min(1, 1024 / Math.max(size.width, size.height)) : 0;
        const width = sized ? Math.max(1, Math.round(size.width * scale)) : 512, height = sized ? Math.max(1, Math.round(size.height * scale)) : 512;
        const mask = seeds ? regionMask(scene, material, seeds, width, height, 2, regionId) : null;
        if (seeds && !mask) continue;
        const data = new Uint8Array(width * height * 4).fill(255);
        if (mask) for (let index = 0; index < mask.length; index++) data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = mask[index];
        // Three's emissive channel has no albedo factor: glowing in the paint's colors bakes them into the map.
        if (!uniforms && paintColors && sized) {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(size, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data;
            for (let index = 0; index < width * height; index++) for (let channel = 0; channel < 3; channel++) {
              data[index * 4 + channel] = data[index * 4 + channel] * pixels[index * 4 + channel] / 255;
            }
          }
        }
        const texture = new THREE.DataTexture(data, width, height);
        const map = mat.map;
        texture.flipY = map?.flipY ?? false;
        texture.wrapS = map?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = map?.wrapT ?? THREE.RepeatWrapping;
        if (map) { texture.repeat.copy(map.repeat); texture.offset.copy(map.offset); texture.rotation = map.rotation; texture.center.copy(map.center); }
        texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
        texture.needsUpdate = true;
        if (uniforms) {
          const previous = { numbers: SELF_ILLUM_NUMBERS.map((key) => uniforms[key].value), map: uniforms.uSelfIllumMap.value,
            scroll: uniforms.uSelfIllumScroll.value.clone(), tint: uniforms.uSelfIllumTint.value.clone() };
          setUniform(uniforms.uHasSelfIllum, 1); setUniform(uniforms.uSelfIllumPulse, 1);
          setUniform(uniforms.uSelfIllumAlbedoFactor, paintColors ? 1 : 0); setUniform(uniforms.uSelfIllumSat, 1);
          setUniform(uniforms.uSelfIllumMaskShaping, 0);
          // The preview caps glow so authored masks never wash out; painted glow gets room to brighten.
          setUniform(uniforms.uSelfIllumCap, 8);
          setUniform(uniforms.uSelfIllumMap, texture);
          uniforms.uSelfIllumScroll.value.set(0, 0);
          lights.current.push((r, g, b, value) => { uniforms.uSelfIllumTint.value.setRGB(r, g, b); setUniform(uniforms.uSelfIllumScale, value); });
          restore.push(() => {
            SELF_ILLUM_NUMBERS.forEach((key, index) => setUniform(uniforms[key], previous.numbers[index]));
            setUniform(uniforms.uSelfIllumMap, previous.map);
            uniforms.uSelfIllumScroll.value.copy(previous.scroll);
            uniforms.uSelfIllumTint.value.copy(previous.tint);
            texture.dispose();
          });
        } else {
          const previous = { emissive: mat.emissive.clone(), emissiveMap: mat.emissiveMap, emissiveIntensity: mat.emissiveIntensity };
          mat.emissiveMap = texture; mat.needsUpdate = true;
          lights.current.push((r, g, b, value) => { mat.emissive.setRGB(r, g, b); Reflect.set(mat, 'emissiveIntensity', value * GLOW_PREVIEW); });
          restore.push(() => {
            mat.emissive.copy(previous.emissive); mat.emissiveMap = previous.emissiveMap; mat.emissiveIntensity = previous.emissiveIntensity;
            mat.needsUpdate = true; texture.dispose();
          });
        }
        lights.current.at(-1)?.(...currentTint(), currentLevel());
      }
    });
    onApplied?.();
    return () => { lights.current = []; restore.forEach((reset) => reset()); };
  }, [scene, material, regionId, seedKey, paintColors, onApplied]);
  useFrame(({ clock }) => {
    if (animation === 'steady') return;
    const time = clock.getElapsedTime();
    for (const light of lights.current) {
      if (animation === 'pulse') light(...glowTint(color, paintColors), level * (0.5 * Math.sin(3 * speed * time) + 0.5));
      else {
        const rate = 2 * speed;
        light(0.5 + 0.5 * Math.sin(rate * time), 0.5 + 0.5 * Math.sin(rate * time + 2.094), 0.5 + 0.5 * Math.sin(rate * time + 4.189), level);
      }
    }
  });
  useEffect(() => {
    if (animation !== 'steady') return;
    for (const light of lights.current) light(...glowTint(color, paintColors), level);
  }, [animation, color, paintColors, level]);
  return null;
}

/**
 * See-through areas: an alpha map that is the area's opacity inside each area and solid elsewhere,
 * times the whole-part opacity, like the exported color alpha and opacity scale.
 */
function PartClear({ scene, material, whole, regions, onApplied }: { scene: THREE.Object3D; material: string; whole?: number; regions: SkinPartRegion[]; onApplied?: () => void }) {
  const regionKey = JSON.stringify(regions);
  useEffect(() => {
    const areas: SkinPartRegion[] = JSON.parse(regionKey);
    const restore: Array<() => void> = [];
    const seen = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.skinPartHighlight) return;
      for (const mat of (Array.isArray(object.material) ? object.material : [object.material]) as Array<THREE.Material & Pick<THREE.MeshStandardMaterial, 'alphaMap' | 'map'>>) {
        if (seen.has(mat) || materialBasename(mat.name) !== materialBasename(material) || !('alphaMap' in mat)) continue;
        seen.add(mat);
        const size: unknown = mat.map?.image;
        const sized = size instanceof HTMLImageElement || size instanceof ImageBitmap || size instanceof HTMLCanvasElement;
        const scale = sized ? Math.min(1, 1024 / Math.max(size.width, size.height)) : 0;
        const width = sized ? Math.max(1, Math.round(size.width * scale)) : 512, height = sized ? Math.max(1, Math.round(size.height * scale)) : 512;
        const alpha = new Float32Array(width * height).fill(255);
        for (const area of areas) {
          if (!area.surface) continue;
          const mask = regionMask(scene, material, area.seeds, width, height, 2, area.id);
          if (!mask) continue;
          for (let index = 0; index < mask.length; index++) alpha[index] *= 1 + (area.surface.opacity - 1) * mask[index] / 255;
        }
        const data = new Uint8Array(width * height * 4);
        for (let index = 0; index < alpha.length; index++) { data[index * 4 + 1] = alpha[index]; data[index * 4 + 3] = 255; }
        const texture = new THREE.DataTexture(data, width, height);
        const map = mat.map;
        texture.flipY = map?.flipY ?? false;
        texture.wrapS = map?.wrapS ?? THREE.RepeatWrapping; texture.wrapT = map?.wrapT ?? THREE.RepeatWrapping;
        if (map) { texture.repeat.copy(map.repeat); texture.offset.copy(map.offset); texture.rotation = map.rotation; texture.center.copy(map.center); }
        texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
        texture.needsUpdate = true;
        const reset = applySkinTransparency(mat, whole ?? 1);
        mat.alphaMap = texture;
        mat.needsUpdate = true;
        restore.push(() => { mat.alphaMap = null; reset(); texture.dispose(); });
      }
    });
    onApplied?.();
    return () => restore.forEach((reset) => reset());
  }, [scene, material, regionKey, whole, onApplied]);
  return null;
}

export function SkinPartPatterns({ scene, edits, onError, onPending, onApplied }: { scene: THREE.Object3D; edits: SkinPartEdit[]; onError: () => void;
  onPending?: (material: string, pending: boolean) => void; onApplied?: () => void }) {
  return edits.map((edit) => {
    if (edit.hidden) return null;
    // Keyed by part so each part's effects keep their state across edits.
    const textured = (edit.pattern?.intensity ?? 0) > 0 || hasColorAdjustments(edit.adjustments) || (edit.repaint && edit.tint) || edit.regions?.some(hasRegionLook);
    const shine = edit.regions?.filter(isFinishRegion) ?? [];
    const glow = edit.regions?.find(isGlowRegion);
    const clear = edit.regions?.filter(isClearRegion) ?? [];
    return [textured ? <PartTexture key={edit.material} scene={scene} edit={edit} onError={onError} onPending={onPending} onApplied={onApplied} /> : null,
      shine.length ? <PartFinish key={`${edit.material}:finish`} scene={scene} material={edit.material} whole={edit.finish} regions={shine} onApplied={onApplied} /> : null,
      glow?.glow || edit.glow ? <PartGlow key={`${edit.material}:glow`} scene={scene} material={edit.material} region={glow?.glow ? glow : null}
        glow={(glow?.glow ?? edit.glow)!} onApplied={onApplied} /> : null,
      clear.length ? <PartClear key={`${edit.material}:clear`} scene={scene} material={edit.material} whole={edit.surface?.opacity} regions={clear} onApplied={onApplied} /> : null];
  });
}
