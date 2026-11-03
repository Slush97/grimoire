// The hero particle bundle: everything the renderer process needs to run a hero's ambient particle
// effects with the faithful simulation, exported by the main process (electron/main/services/
// heroParticleBundle.ts) and served over grimoire-hero:. Pure types and readers, no DOM.

import type { KVObject } from '../kv';
import type { SerializedParticleModel } from '../model';
import type { ParticleMaterialData, SerializedModelMesh } from '../render/particleModels';
import type { ParticleTextureInfo } from '../render/sheet';
import type { SerializedSnapshot } from '../snapshotResource';

/** Bump with any change to the bundle's shape or contents. */
export const PARTICLE_BUNDLE_VERSION = 7;

/** Where the game itself says a hero plays an effect, which decides how the effect is bound. */
export type AmbientEffectSourceKind =
  | 'map-entity'
  /** The model's keyvalues: `particle_cfg_list` (system and control point configuration). */
  | 'model-particle-cfg'
  /** The model's keyvalues: `particles_list` (system, attachment type and point), as VRF's CreateModelParticles reads it. */
  | 'model-particles-list'
  /** The model's keyvalues: `CCitadelHeroModelGameData_t.m_hAmbientParticle`. */
  | 'model-ambient'
  /** The hero's scripts/heroes.vdata entry: `m_hAmbientParticle`. */
  | 'hero-ambient'
  /** The hero's primary weapon in scripts/abilities.vdata: `m_PassiveWeaponParticle`. */
  | 'weapon-passive'
  /**
   * A particle the primary weapon names for its own code to spawn on attachments it chooses (Celeste's
   * `m_BatonFlameParticle`), shown through the authored preview system that places it.
   */
  | 'weapon-code'
  /** An AE_CL_CREATE_PARTICLE_EFFECT(_CFG) event of an animation clip. */
  | 'anim-event';

/** An attachment as model particles and animation events name one (`attachment_type`, `attachment_point`). */
export interface EffectAttachment {
  /** The PATTACH_ member without its prefix, lower case (`point_follow`, `absorigin_follow`, ...). */
  type: string;
  point: string;
  offset: [number, number, number];
}

/** One effect a hero plays, with the evidence it was found by. */
export interface BundleEffect {
  id: string;
  /** The root system, `particles/...vpcf`. */
  system: string;
  source: AmbientEffectSourceKind;
  /** The file and member it was read from, for diagnostics and review. */
  evidence: string;
  /** The control point configuration the source names (`preview`, ...), or null. */
  configuration: string | null;
  /** Attachments the source names for control points 0 and 1, when it names them. */
  attachment: EffectAttachment | null;
  attachmentCp1: EffectAttachment | null;
  /**
   * Control points a stage places after the binding (see effectTimeline.ts), in this order: on an
   * attachment of the rig or on the model's origin, following it or as it stood when the effect
   * started, or at a fixed point of the particle world facing `forward`. They stand in for what the game sets from code.
   */
  controlPoints?: StagedControlPoint[];
  /** For animation events: the clip (as the viewer names it) and the event times, normalized to the clip. */
  clip?: { name: string; start: number; stops: { time: number; immediately: boolean; endCap: boolean }[]; stopOnClipChange: boolean };
}

export type StagedControlPoint =
  /** On an attachment; `facing: 'model'` keeps its position but takes the model's orientation. */
  | { cp: number; kind: 'attachment'; attachment: string; follow: boolean; facing?: 'attachment' | 'model' }
  /** On the model's origin (its feet), facing as the model faces. */
  | { cp: number; kind: 'origin'; follow: boolean }
  | { cp: number; kind: 'world'; position: [number, number, number]; forward: [number, number, number] };

export interface BundleSystem {
  /** The definition's KV3 DATA block decoded to JSON, before any upgrade. */
  data: KVObject;
  /** The stored KV3 format name (`vpcf61`, ...), or null when the bundled vpkmerge cannot report it. */
  format: string | null;
}

export interface BundleTexture {
  /** The decoded top mip as a PNG under the bundle's `tex/` directory. */
  file: string;
  /**
   * Every stored mip level as a PNG under `tex/`, largest first (the first is the top level again),
   * when the vpkmerge that exported the bundle can write them (`panorama dump --mips`). Without them
   * the renderer generates the levels from the top one.
   */
  mips?: string[];
  /** The compiled texture's header and sheet, as the renderer's readParticleTextureInfo reads them. */
  info: ParticleTextureInfo;
}

/** A model attachment with every influence (Attachment), for the control point binding. */
export interface BundleAttachment {
  name: string;
  ignoreRotation: boolean;
  influences: { bone: string; offset: [number, number, number]; rotation: [number, number, number, number]; weight: number; rootTransform: boolean }[];
}

export interface BundleDiagnostic {
  kind: 'format-unknown' | 'mips-unavailable' | 'missing-system' | 'missing-texture' | 'missing-snapshot' | 'missing-model' | 'limit' | 'discovery';
  message: string;
}

export interface ParticleBundle {
  version: number;
  hero: string;
  /** The model the effects are bound to, as a compiled path. */
  modelEntry: string;
  effects: BundleEffect[];
  systems: Record<string, BundleSystem>;
  snapshots: Record<string, SerializedSnapshot>;
  textures: Record<string, BundleTexture>;
  /** The models C_OP_RenderModels draws, by particleResourceKey of their path. */
  models?: Record<string, SerializedModelMesh>;
  /** Model draw materials and renderer overrides, by particleResourceKey of their path. */
  materials?: Record<string, ParticleMaterialData>;
  model: SerializedParticleModel;
  attachments: BundleAttachment[];
  diagnostics: BundleDiagnostic[];
}

/** The resource path a definition names (`particles/x.vpcf` or `particles/x.vpcf_c`) as the bundle keys it. */
export function bundleSystemKey(path: string): string {
  return path.replace(/_c$/, '').replace(/\\/g, '/').toLowerCase();
}

/** A file name bundleTextureFile can produce: the top image or one of its stored mip levels. */
export const BUNDLE_TEXTURE_FILE = /^[A-Za-z0-9_]+(?:\.mip[0-9]+)?\.png$/;

/** The PNG file name a texture path is stored under, or one of its stored mip levels. */
export function bundleTextureFile(vtex: string, mip?: number): string {
  return `${vtex.replace(/_c$/, '').replace(/\.vtex$/, '').replace(/[^a-zA-Z0-9]+/g, '_')}${mip === undefined ? '' : `.mip${mip}`}.png`;
}
