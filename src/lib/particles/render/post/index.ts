// The Source 2 post process VRF draws its scenes through, for hosts of the particle renderer.

export {
  DEADLOCK_BASE_POST,
  DEADLOCK_HERO_POST,
  VRF_DEFAULT_BLOOM,
  VRF_DEFAULT_TONEMAP,
  SourcePostProcess,
  applyTonemapping,
  exposureForDisplay,
  linearForDisplay,
  postSettingsFromVpost,
  tonemapChannel,
  type BloomBlendMode,
  type SourceBloomSettings,
  type SourcePostSettings,
  type SourceTonemapSettings,
} from './sourcePostProcess';

/** Which post chain the hero viewer draws through: its own preview look, or VRF's Source 2 one. */
export type PostPipeline = 'preview' | 'source2';

/**
 * The post chain the particle runtime is drawn through. The toggle that turns the new particle
 * runtime on passes this to BloomEffect's `pipeline`; with the toggle off the viewer keeps 'preview'.
 */
export const PARTICLE_RUNTIME_POST_PIPELINE: PostPipeline = 'source2';
