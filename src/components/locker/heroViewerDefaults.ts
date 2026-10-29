import type { HeroPoseDevFlags } from './heroPoseRenderFeatures';

export interface HeroPreviewFlags extends HeroPoseDevFlags {
  animated: boolean;
  effects: boolean;
  autoRotate: boolean;
  /** Run particles through the faithful Source 2 simulation instead of the curated overlay. On by default;
   *  turning it off falls back to the curated overlay. */
  sourceParticles: boolean;
  /** March the hideout's fog at every pixel instead of at half resolution. Off by default: it costs
   *  about 6 ms a frame at 2560 by 1440 and differs only along depth edges. */
  fullResolutionFog: boolean;
}

export const FULL_EFFECTS_PREVIEW_DEFAULTS: HeroPreviewFlags = {
  unified: true, celV2: true, citadel: true, animated: true, cloth: true, effects: true, bloom: true,
  nprDebug: false, matDebug: false,
  autoRotate: false,
  sourceParticles: true,
  fullResolutionFog: false,
};

// Legacy preview keys were also populated by the old opt-in developer controls.
// Keep production choices separate so those flags cannot turn a fresh preview off.
export function heroPresentationStorageKey(name: string): string {
  return `grimoire.preview.presentation.${name}`;
}

/** Read at mount only. Hero and sidecar changes retain live user choices. */
export function initialHeroPreviewFlags(): HeroPreviewFlags {
  const storage = typeof window === 'undefined' ? undefined : window.localStorage;
  const read = (name: string, fallback: boolean, presentation = false) => {
    const raw = storage?.getItem(presentation ? heroPresentationStorageKey(name) : `grimoire.preview.${name}`);
    return raw == null ? fallback : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  };
  return {
    unified: read('unifiedMaterial', true), celV2: read('celV2', true), citadel: read('citadel', true),
    animated: read('animated', true, true), cloth: read('cloth', true, true),
    effects: read('effects', true, true), bloom: read('bloom', true, true),
    autoRotate: read('autoRotate', false, true),
    sourceParticles: read('sourceParticles', true, true),
    fullResolutionFog: read('fullResolutionFog', false, true),
    nprDebug: read('nprDebug', false), matDebug: read('matDebug', false),
  };
}
