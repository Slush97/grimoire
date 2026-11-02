import type { HeroPoseSkinSource } from './portrait';
import type { TrippyStyleName } from './mod';
import type { z } from 'zod';
import type { mapProbesSchema, mapPostSchema, mapLutSchema, mapLightDistributionSchema, mapSkySchema, mapFogSchema } from '../lib/source2MapData';

export interface SkinEditSource {
  heroName: string;
  skinSources: HeroPoseSkinSource[];
}

export interface SkinPart {
  material: string;
  /** Models that use this material, including separately editable transformed bodies. */
  modelEntries?: string[];
  /** Authored player forms using this material, including states on the same model. */
  formIds?: string[];
  /** Material-group swaps cannot hide geometry independently of the other state. */
  hideable?: boolean;
  label: string;
  drawCalls: number;
  vertices: number;
  tintable: boolean;
  patternable: boolean;
  finishable?: boolean;
  /** Whether the material can take painted glow: pbr.vfx with a color texture and no animated self-illumination. */
  glowable?: boolean;
  surfaceable?: boolean;
  textureSize?: { width: number; height: number };
}

export interface SkinEditInfo {
  fingerprint: string;
  entry: string;
  parts: SkinPart[];
  forms?: { id: string; available: boolean }[];
}

export interface SkinPartEdit {
  material: string;
  hidden: boolean;
  tint: string | null;
  pattern?: SkinPartPattern | null;
  adjustments?: SkinColorAdjustments;
  colorize?: boolean;
  repaint?: boolean;
  finish?: SkinPartFinish;
  surface?: SkinPartSurface;
  /** Glow over the whole part. A part has one glow, so this and a painted glow area never coexist. */
  glow?: SkinPartGlow;
  /** Smaller areas of this part's color texture, each with its own texture edit. Applied in order over the whole-part edit. */
  regions?: SkinPartRegion[];
}

/**
 * A texture point. The region takes (or, with `remove`, drops) every UV island covering it; with
 * `by: 'color'` the connected texels whose color is within `tolerance` (CIELAB delta E) of the point's;
 * with `by: 'brush'` the texels whose point on the model is within `radius` (mesh units) of it.
 */
export interface SkinRegionSeed {
  u: number;
  v: number;
  remove?: true;
  by?: 'color' | 'brush';
  tolerance?: number;
  radius?: number;
  /** The rest of a brush stroke after this seed's own dab, as flat (u, v, radius) triples: one seed per stroke, not per dab. */
  path?: number[];
  /** The area whose paint cut this remove seed. Removing that area takes the cut back, so what was under it shows again. */
  from?: string;
}

export interface SkinPartRegion {
  id: string;
  /** Optional: an unnamed region is still saved. */
  name?: string;
  seeds: SkinRegionSeed[];
  /** Fingerprint of the texture layout the seeds were picked on. A different layout needs a new selection. */
  layout?: string;
  /** Paint color. Regions always paint: a material tint cannot stop at a texture boundary. */
  paint?: string | null;
  adjustments?: SkinColorAdjustments;
  /** Region patterns never scroll: scrolling moves the whole material. */
  pattern?: SkinPartPattern | null;
  /** Shine painted onto the area. A finish area keeps the colors under it, so it never has paint or a pattern. */
  finish?: SkinPartFinish;
  /** Glow painted onto the area. A material has one glow color, so a part has at most one glow area. */
  glow?: SkinPartGlow;
  /** See-through painted onto the area: its opacity there, 0 (gone) to 1 (solid). */
  surface?: { opacity: number };
}

export type SkinGlowAnimation = 'steady' | 'pulse' | 'rainbow';

export interface SkinPartGlow {
  color: string;
  animation: SkinGlowAnimation;
  /** Self-illumination scale; 4 when unset. */
  strength?: number;
  /** Pulse and rainbow speed; 1 (about a two second pulse) when unset. */
  speed?: number;
  /** Glow in the part's own texture colors instead of `color`. */
  paintColors?: boolean;
}

export interface SkinPartSurface {
  mode: 'translucent' | 'ghost';
  opacity: number;
}

export interface SkinPartFinish {
  roughness: number;
  metalness: number;
}

export interface SkinColorAdjustments {
  hue: number;
  saturation: number;
  brightness: number;
}

export interface SkinPartTexture {
  thumbnail: string;
  width: number;
  height: number;
}

export interface SkinPartPattern {
  style: TrippyStyleName;
  intensity: number;
  phase: number;
  scroll: number;
  /** Moo density multiplier. Omitted means the original 1x density. */
  scale?: number;
  colors?: string[];
}

export interface SkinEditExport extends SkinEditSource {
  fingerprint: string;
  edits: SkinPartEdit[];
  /** White-on-black PNG data URLs keyed `material|regionId`, baked by the viewer for each edited region. */
  regionMasks?: Record<string, string>;
}

export interface SkinEditSave extends SkinEditExport {
  name: string;
  thumbnailDataUrl?: string;
}

export interface SkinEditSaveResult {
  /** Where each mod the save enabled or moved now lives, keyed by its metaKey before the save. */
  renamed: Record<string, HeroPoseSkinSource>;
  overlay: HeroPoseSkinSource;
}

export type SkinEditProgress = { stage: 'inspect' | 'install' }
  | { stage: 'build'; completed: number; total: number };

/** Recorded on a skin-editor overlay so saving the same edit target again replaces it. */
export interface SkinEditTarget {
  hero: string;
  /** Canonical sha256 of each source VPK, sorted. Empty when editing the default skin. */
  sources: string[];
}

export interface SkinEditRecord extends SkinEditTarget {
  /** The saved edit set. Missing on overlays saved before edits were recorded. */
  edits?: SkinPartEdit[];
}

/** An editor source stack with any skin-editor overlay swapped for the skins it was made from. */
export interface SkinEditResume {
  skinSources: HeroPoseSkinSource[];
  /** The overlay this session continues. Saving replaces it. */
  overlay?: HeroPoseSkinSource;
  name?: string;
  edits: SkinPartEdit[];
  /** How many of the overlay's sources are no longer installed. */
  missing: number;
}

export interface HideoutInstance {
  opacity?: number;
  /** A skinned model of its own (not in the bundle) that loops this clip. */
  animation?: { clip: string };
  model: string;
  primitive: number | null;
  matrix: number[];
  tint: [number, number, number];
}

export interface HideoutSceneInfo {
  particles: import('../lib/mapParticles').MapParticleScene;
  primaryLightDirection: [number, number, number];
  probes: z.infer<typeof mapProbesSchema>;
  post: z.infer<typeof mapPostSchema> | null;
  lut: z.infer<typeof mapLutSchema>;
  sky?: z.infer<typeof mapSkySchema>;
  fog?: z.infer<typeof mapFogSchema>;
  /** The precomputed shadow atlas the fog lights' `fogShadowTiles` index, as a one-slice R16 volume. */
  fogShadows?: { file: 'fog-shadows.bin' };
  key: string;
  anchor: [number, number, number];
  heading: number;
  bundle: { file: 'models.glb'; models: number; materials: number; images: number; textures: number; bytes: number };
  instances: HideoutInstance[];
  failures: string[];
  omissions: string[];
  exposure: number;
  tonemap: Source2MapTonemap | null;
  reflection: { kind: 'cubemap'; file: 'reflection.bin'; slice: number } | { kind: 'unavailable' };
  lighting: { kind: 'baked'; file: 'irradiance.hdr'; uvScale: [number, number];
    encoding: { kind: 'dc' } | { kind: 'sh2-luminance'; direction: 'direction.png'; shadows: 'shadows.png' } } | { kind: 'unavailable' };
  lights: HideoutLight[];
}

export interface Source2MapTonemap {
  exposureBias: number;
  shoulder: number;
  linear: number;
  angle: number;
  toe: number;
  toeNumerator: number;
  toeDenominator: number;
  white: number;
}

export interface HideoutLight {
  distribution: z.infer<typeof mapLightDistributionSchema>;
  position: [number, number, number];
  color: [number, number, number];
  candela: number;
  range: number;
  shadowChannel: number | null;
  /** The light's fogstrength when its fog mode lets it light the volumetric fog. */
  fogStrength?: number;
  /** Cache file of the light's cookie, an sRGB image projected through a barn light. */
  cookie?: string;
  /** A baked light that only lights the fog: its surface light is in the lightmap. */
  fogOnly?: true;
  /** Source matrix whose unit cube is the only volume the light reaches (its precomputed OBB). */
  bounds?: number[];
  /** A fog light's baked shadow tiles in `fogShadows`, (width, height, x, y) in atlas uv; one per cube face for an omni. */
  fogShadowTiles?: [number, number, number, number][];
}
