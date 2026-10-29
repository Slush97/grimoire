// What every renderer of a tree shares: VRF's RendererContext and Scene as the particle renderers read
// them, reduced to what a three.js host can supply.

import * as THREE from 'three';
import { ParticleSheetCache } from './sheetCache';
import type { ParticleModelSource } from './particleModels';
import type { ParticleTextureSource } from './textures';
import type { RenderView } from './view';

/**
 * The game settings the spritecard renderers read from gameinfo.gi and the game they run for
 * (GameInfo.ParticleShaderFeatureBranching and the Game checks). Deadlock switches its particle shader
 * features at run time.
 */
export interface ParticleGameSettings {
  /** Particles/EnableParticleShaderFeatureBranching. */
  particleShaderFeatureBranching: boolean;
  /** Dota 2 and Steampal ship static combo shaders that still take the blend alpha unsigned. */
  unsignedBlendAlphaGame: boolean;
  /** Every layered shader but Counter-Strike 2's clamps each layer's composite to 0 to 1. */
  clampLayers: boolean;
}

export const DEADLOCK_GAME_SETTINGS: ParticleGameSettings = {
  particleShaderFeatureBranching: true,
  unsignedBlendAlphaGame: false,
  clampLayers: true,
};

/** The opaque scene's depth, for renderers that feather against it. */
export interface ParticleSceneDepth {
  /** A depth texture of the viewport as three.js writes it (perspective, near at 0). */
  texture: THREE.Texture;
  /** The camera's near and far planes, in viewer units. */
  near: number;
  far: number;
}

export class ParticleRendererContext {
  readonly textures: ParticleTextureSource;
  /** The models and materials C_OP_RenderModels draws, or null for a host that supplies none. */
  readonly models: ParticleModelSource | null;

  /** Seconds the host has been drawing, as material shaders read g_flTime (VRF's renderer uptime). */
  time = 0;
  readonly sheets = new ParticleSheetCache();
  readonly game: ParticleGameSettings;

  /** The colour of the sun times its brightness, which every lit particle adds to an ambient of 1. */
  sunColor: [number, number, number];

  /** The opaque scene depth, or null to feather against an infinitely far scene. */
  sceneDepth: ParticleSceneDepth | null = null;

  /** The opaque scene colour refracting renderers draw displaced, or null for black. */
  sceneColor: THREE.Texture | null = null;

  /** The most anisotropy the clamp sampler of a clamping layer filters with. */
  maxAnisotropy = 16;

  /** A one-row cache for draws before any sheet has been added. */
  readonly emptySheetCache: THREE.DataTexture;
  readonly blackTexture: THREE.DataTexture;

  /** The view each camera drawing this frame gives, set by the tree renderer. */
  viewFor: (camera: THREE.Camera) => RenderView;

  constructor(textures: ParticleTextureSource, game: ParticleGameSettings, sunColor: [number, number, number], viewFor: (camera: THREE.Camera) => RenderView,
    models: ParticleModelSource | null = null) {
    this.textures = textures;
    this.models = models;
    this.game = game;
    this.sunColor = sunColor;
    this.viewFor = viewFor;

    this.emptySheetCache = new THREE.DataTexture(new Float32Array(512 * 4), 512, 1, THREE.RGBAFormat, THREE.FloatType);
    this.emptySheetCache.needsUpdate = true;
    this.blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this.blackTexture.needsUpdate = true;
  }

  dispose(): void {
    this.sheets.dispose();
    this.emptySheetCache.dispose();
    this.blackTexture.dispose();
  }
}
