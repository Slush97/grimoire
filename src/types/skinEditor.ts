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
}

export interface SkinEditSaveResult {
  /** Where each mod the save enabled or moved now lives, keyed by its metaKey before the save. */
  renamed: Record<string, HeroPoseSkinSource>;
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
