import type { HeroPoseSkinSource } from './portrait';
import type { TrippyStyleName } from './mod';

export interface SkinEditSource {
  heroName: string;
  skinSources: HeroPoseSkinSource[];
}

export interface SkinPart {
  material: string;
  label: string;
  drawCalls: number;
  vertices: number;
  tintable: boolean;
  patternable: boolean;
  finishable?: boolean;
  textureSize?: { width: number; height: number };
}

export interface SkinEditInfo {
  fingerprint: string;
  entry: string;
  parts: SkinPart[];
}

export interface SkinPartEdit {
  material: string;
  hidden: boolean;
  tint: string | null;
  pattern?: SkinPartPattern | null;
  adjustments?: SkinColorAdjustments;
  colorize?: boolean;
  finish?: SkinPartFinish;
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
}

export interface SkinEditExport extends SkinEditSource {
  fingerprint: string;
  edits: SkinPartEdit[];
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
  model: string;
  primitive: number | null;
  matrix: number[];
  tint: [number, number, number];
}

export interface HideoutSceneInfo {
  key: string;
  anchor: [number, number, number];
  heading: number;
  instances: HideoutInstance[];
  failures: string[];
  omissions: string[];
  lighting: { kind: 'baked'; file: 'irradiance.hdr'; uvScale: [number, number] } | { kind: 'unavailable' };
  lights: HideoutLight[];
}

export interface HideoutLight {
  position: [number, number, number];
  color: [number, number, number];
  candela: number;
  range: number;
}
