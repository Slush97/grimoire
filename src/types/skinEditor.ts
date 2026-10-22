import type { HeroPoseSkinSource } from './portrait';

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
}

export interface SkinEditExport extends SkinEditSource {
  fingerprint: string;
  edits: SkinPartEdit[];
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
