import type { HeroPoseDevFlags } from './heroPoseRenderFeatures';

export interface HeroPreviewFlags extends HeroPoseDevFlags { animated: boolean; effects: boolean }
export const FULL_EFFECTS_PREVIEW_DEFAULTS: HeroPreviewFlags = {
  unified: true, celV2: true, animated: true, cloth: true, effects: true, bloom: true,
  nprDebug: false, matDebug: false,
};

/** Read at mount only. Hero and sidecar changes retain live user choices. */
export function initialHeroPreviewFlags(): HeroPreviewFlags {
  const storage = typeof window === 'undefined' ? undefined : window.localStorage;
  const read = (name: string, fallback: boolean) => {
    const raw = storage?.getItem(`grimoire.preview.${name}`);
    return raw == null ? fallback : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  };
  return {
    unified: read('unifiedMaterial', true), celV2: read('celV2', true),
    animated: read('animated', true), cloth: read('cloth', true),
    effects: read('effects', true), bloom: read('bloom', true),
    nprDebug: read('nprDebug', false), matDebug: read('matDebug', false),
  };
}
